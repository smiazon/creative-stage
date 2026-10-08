// Arena PA — imported media played through virtual speaker stacks. Pure
// Web Audio, no assets, no three import (the camera is only read through
// matrixWorld, so this file stays renderer-agnostic).
//
// initAudioFX(camera) -> {
//   state              { on, preset, volume } — live object, mutated in place
//   presets            [{ key, name }] for building the UI
//   setEnabled(on)     THE switch — builds the graph lazily on first enable
//   setPreset(key)     live acoustic swap, ~80ms crossfade
//   setVolume(v)       0..1 master
//   attachElement(el)  register a <video>/<audio>; idempotent, elements mix
//   update(dt)         per-frame: the listener follows the camera
// }
//
// signal flow (once built):
//
//   media el ──┬── bypass gain ──────────────────────────────► destination
//              └── inputBus ── preset chain ── speakerBus ──┬─ main L (panner)
//                  (eq/comp, dry + convolver wet)           ├─ main R (panner)
//                                                           ├─ sub    (LP 120)
//                                                           ├─ rear L (delayed)
//                                                           └─ rear R (delayed)
//                                                                └► master ► destination
//
// Two traps this module exists to dodge:
//  * Autoplay policy — an AudioContext started outside a user gesture sits
//    suspended forever. Nothing is constructed until the first
//    setEnabled(true), which main.js only calls from a click handler.
//  * createMediaElementSource permanently detaches the element from its
//    default output (and throws if called twice on the same element). Once
//    we touch an element it would go mute forever with the PA off — so every
//    attached element also feeds a plain "bypass" gain straight to
//    destination, held at 1 while the system is off and crossfaded to 0 when
//    the spatial rig takes over. An attached element is never left silent.

import { SPEC } from './venue.js';

const XFADE = 0.08; // enable/preset crossfade — long enough to hide clicks

// Venue geometry (y-up metres, floor y=0, stage at negative x — matches the
// world in main.js). Mains hang left/right of the stage, subs sit on the
// deck, and two delay towers cover the back of the room.
const A = SPEC.audio;   // the stadium's mains hang at its own stage, delay towers mid-pitch
const POS_MAIN_L = [A.mainX, A.mainY, -A.mainZ];
const POS_MAIN_R = [A.mainX, A.mainY, A.mainZ];
const POS_SUB = [A.subX, 2.0, 0];
const POS_REAR_L = [A.rearX, A.rearY, -A.rearZ];
const POS_REAR_R = [A.rearX, A.rearY, A.rearZ];
// for the video's sound, rendered offline in the same places (main.js)
export const PA_POSITIONS = { mainL: POS_MAIN_L, mainR: POS_MAIN_R, sub: POS_SUB, rearL: POS_REAR_L, rearR: POS_REAR_R };
// The speakers' throw, shared by the live PA and the video's offline one so
// they sound the same: full level within ref metres, then the fall-off
const SPK = { mainRef: 5, subRef: 22, rearRef: 8, rolloff: 1.35, maxDist: 160, rearDelay: 0.07, rearTrim: 0.5 };
// a convolver's (normalised) tail is far quieter than the dry signal: lift it
// so the room is heard, not just felt
const WET_BOOST = 4.5;
// The PA's level, made up so that switching the venue's speakers on keeps the
// song as loud as it was without them (measured offline in the arena, room
// echo 100%: within ±0.5 dB on the X and mid-floor, about -7 dB in the far
// 400s, which is the distance you're meant to hear). A limiter after it
// catches the stacks when the camera stands right in front of them.
export let PA_MAKEUP = 1.05;

// Acoustic presets. `wet` is the convolver's share (dry = 1 - wet, so
// overall loudness stays roughly constant across presets); `ir.tone` is a
// one-pole lowpass coefficient on the IR noise — lower = darker room.
// Same-shaped IRs share one buffer via the cache below.
const PRESET_DEFS = [
  { key: 'dry', name: 'DIRECT', wet: 0 },
  { key: 'arena', name: 'ARENA', wet: 0.5, ir: { dur: 2.6, tone: 0.5 } },
  {
    key: 'stadium', name: 'STADIUM', wet: 0.5, ir: { dur: 4.2, tone: 0.22 },
    // long tails pile energy up around 250Hz — dip it or everything is mud
    eq: [{ type: 'peaking', freq: 250, gain: -4, q: 1.0 }],
  },
  {
    key: 'club', name: 'CLUB', wet: 0.25, ir: { dur: 0.8, tone: 0.85 },
    eq: [{ type: 'lowshelf', freq: 60, gain: 3 }],
  },
  {
    key: 'bass', name: 'HEAVY BASS', wet: 0.3, ir: { dur: 2.2, tone: 0.5 },
    eq: [{ type: 'lowshelf', freq: 90, gain: 9 }],
    // squash hard so the boosted lows read as pressure, not clipping
    comp: { threshold: -28, knee: 6, ratio: 8, attack: 0.004, release: 0.18 },
  },
  {
    key: 'voice', name: 'VOCAL', wet: 0.3, ir: { dur: 2.2, tone: 0.5 },
    eq: [
      { type: 'highpass', freq: 90 }, // rumble under speech is just noise
      { type: 'peaking', freq: 2800, gain: 6, q: 1.1 }, // presence/intelligibility
    ],
  },
];

// The room's impulse response, the same every time (a seeded noise): the live
// PA and the video's render get the very same room, and its level never drifts
function fillIR(buf, tone, seed = 7) {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = buf.length;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);   // independent noise per side = width
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += tone * (rnd() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-6.9 * (i / n));   // e^-6.9 ~ -60dB at the end
    }
  }
  return buf;
}
function makeLimiter(ctx) {
  const l = ctx.createDynamicsCompressor();
  l.threshold.value = -3; l.knee.value = 0; l.ratio.value = 20; l.attack.value = 0.002; l.release.value = 0.12;
  return l;
}
// The same PA as the live one, built in any context (the video's offline
// render): input -> desk -> the room preset -> the five stacks -> master ->
// limiter -> returned output. preset/fx/volume as the live PA has them now,
// so what you mixed while listening is what the video gets.
export function renderPA(ctx, input, { preset = 'arena', fx = {}, volume = 0.8 } = {}) {
  const F = { bass: 0, mid: 0, treble: 0, reverb: 1, sub: 1, rear: 1, punch: 0, ...fx };
  const def = PRESET_DEFS.find((p) => p.key === preset) || PRESET_DEFS[1];
  const eq = ({ type, freq, gain = 0, q = 1 }) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.gain.value = gain; f.Q.value = q; return f; };
  // the desk
  let head = input;
  for (const e of [{ type: 'lowshelf', freq: 90, gain: F.bass * 12 }, { type: 'peaking', freq: 1000, gain: F.mid * 10, q: 0.9 }, { type: 'highshelf', freq: 6000, gain: F.treble * 12 }]) {
    const f = eq(e); head.connect(f); head = f;
  }
  const dc = ctx.createDynamicsCompressor(), mk = ctx.createGain();
  dc.knee.value = 8; dc.attack.value = 0.005; dc.release.value = 0.16;
  dc.threshold.value = -32 * F.punch; dc.ratio.value = 1 + 11 * F.punch; mk.gain.value = 1 + 1.1 * F.punch;
  head.connect(dc); dc.connect(mk); head = mk;
  // the room
  for (const e of def.eq || []) { const f = eq(e); head.connect(f); head = f; }
  if (def.comp) {
    const c = ctx.createDynamicsCompressor();
    Object.entries(def.comp).forEach(([k, v]) => { c[k].value = v; });
    head.connect(c); head = c;
  }
  const bus = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 1 - def.wet * 0.5;
  head.connect(dry); dry.connect(bus);
  if (def.wet > 0) {
    const n = Math.max(1, Math.floor(ctx.sampleRate * def.ir.dur));
    const conv = ctx.createConvolver(); conv.buffer = fillIR(ctx.createBuffer(2, n, ctx.sampleRate), def.ir.tone);
    const wet = ctx.createGain(); wet.gain.value = def.wet * F.reverb * WET_BOOST;
    head.connect(conv); conv.connect(wet); wet.connect(bus);
  }
  // the stacks
  const master = ctx.createGain(); master.gain.value = volume * PA_MAKEUP;
  const panner = ([x, y, z], ref) => {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.maxDistance = SPK.maxDist; p.rolloffFactor = SPK.rolloff;
    p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
    p.connect(master);
    return p;
  };
  bus.connect(panner(POS_MAIN_L, SPK.mainRef)); bus.connect(panner(POS_MAIN_R, SPK.mainRef));
  const lp = eq({ type: 'lowpass', freq: 120 }), sg = ctx.createGain(); sg.gain.value = F.sub;
  bus.connect(lp); lp.connect(sg); sg.connect(panner(POS_SUB, SPK.subRef));
  const dl = ctx.createDelay(0.3); dl.delayTime.value = SPK.rearDelay;
  const sh = eq({ type: 'highshelf', freq: 4000, gain: -4 }), tr = ctx.createGain(); tr.gain.value = SPK.rearTrim * F.rear;
  bus.connect(dl); dl.connect(sh); sh.connect(tr);
  tr.connect(panner(POS_REAR_L, SPK.rearRef)); tr.connect(panner(POS_REAR_R, SPK.rearRef));
  const limiter = makeLimiter(ctx);
  master.connect(limiter);
  return limiter;
}
export function setPaMakeup(v) { PA_MAKEUP = v; }

export function initAudioFX(camera) {
  const state = { on: false, preset: 'arena', volume: 0.8 };
  const presets = PRESET_DEFS.map(({ key, name }) => ({ key, name }));

  let ctx = null;         // AudioContext, lazily created in setEnabled(true)
  let master = null;      // spatial rig master gain -> destination
  let preBus = null;      // every source mixes in HERE, ahead of the tone stack
  let inputBus = null;    // tone-stack output -> the preset chains
  let chains = null;      // preset key -> { input, out, wet, baseWet }
  let activeChain = null;
  let offTimer = 0;
  // Live-adjustable desk controls, on top of whatever room preset is loaded.
  // Ranges are what the UI sends; every one is applied through ramp() so a
  // dragged slider never zippers.
  const fx = {
    bass: 0,      // -1..1  -> +-12 dB lowshelf @ 90 Hz
    mid: 0,       // -1..1  -> +-10 dB peaking @ 1 kHz
    treble: 0,    // -1..1  -> +-12 dB highshelf @ 6 kHz
    reverb: 1,    // 0..2   -> scales the room preset's wet share
    sub: 1,       // 0..2   -> sub stack level
    rear: 1,      // 0..2   -> delay-tower level
    punch: 0,     // 0..1   -> compression amount (threshold + ratio together)
  };
  const fxNodes = { bass: null, mid: null, treble: null, comp: null, sub: null, rear: null };
  const attached = new Map(); // el -> { src, bypass } | { failed: true }
  const pending = new Set();  // elements registered before the ctx exists
  const irCache = new Map();  // 'dur|tone' -> AudioBuffer

  // Click-free param moves: pin the current value, then ramp. Cancelling
  // first means rapid toggles / preset mashing never fight old automation.
  function ramp(param, target, dur = XFADE) {
    const t = ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(target, t + dur);
  }

  // Procedural impulse response: stereo noise under an exponential decay
  // (about -60dB by the tail) with a one-pole lowpass setting the room's
  // colour. Plain buffer math — even the 4.2s stadium IR fills in a few ms,
  // no OfflineAudioContext ceremony needed.
  function makeIR({ dur, tone }) {
    const key = dur + '|' + tone;
    let buf = irCache.get(key);
    if (buf) return buf;
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    buf = fillIR(ctx.createBuffer(2, n, ctx.sampleRate), tone);
    irCache.set(key, buf);
    return buf;
  }

  function makeEq({ type, freq, gain = 0, q = 1 }) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.gain.value = gain;
    f.Q.value = q;
    return f;
  }

  // One preset = input -> (eq/comp) -> dry + convolver wet -> out.
  // Every chain exists up front so switching is just a gain crossfade.
  function buildChain(def) {
    const input = ctx.createGain();
    const out = ctx.createGain();
    out.gain.value = 0; // the active one gets 1 after the build
    let head = input;
    for (const e of def.eq || []) {
      const f = makeEq(e);
      head.connect(f);
      head = f;
    }
    if (def.comp) {
      const c = ctx.createDynamicsCompressor();
      c.threshold.value = def.comp.threshold;
      c.knee.value = def.comp.knee;
      c.ratio.value = def.comp.ratio;
      c.attack.value = def.comp.attack;
      c.release.value = def.comp.release;
      head.connect(c);
      head = c;
    }
    const dry = ctx.createGain();
    dry.gain.value = 1 - def.wet * 0.5;
    head.connect(dry).connect(out);
    let wet = null;
    if (def.wet > 0) {
      const conv = ctx.createConvolver();
      conv.buffer = makeIR(def.ir);
      wet = ctx.createGain();
      wet.gain.value = def.wet * fx.reverb * WET_BOOST;   // the REVERB knob scales every room
      head.connect(conv).connect(wet).connect(out);
    }
    return { input, out, wet, baseWet: def.wet };
  }

  // The desk: a tone stack + optional squash that sits between the sources
  // and the room simulation, so it colours the show the same way in every
  // preset. preBus -> bass -> mid -> treble -> comp -> inputBus.
  function buildDesk() {
    const bass = makeEq({ type: 'lowshelf', freq: 90, gain: fx.bass * 12 });
    const mid = makeEq({ type: 'peaking', freq: 1000, gain: fx.mid * 10, q: 0.9 });
    const treble = makeEq({ type: 'highshelf', freq: 6000, gain: fx.treble * 12 });
    const comp = ctx.createDynamicsCompressor();
    comp.knee.value = 8;
    comp.attack.value = 0.005;
    comp.release.value = 0.16;
    // WebAudio's compressor has no makeup gain of its own — without one,
    // turning PUNCH up would just read as "quieter", not "denser"
    const makeup = ctx.createGain();
    fxNodes.comp = comp; fxNodes.makeup = makeup;
    applyPunch(false);
    preBus.connect(bass).connect(mid).connect(treble).connect(comp).connect(makeup).connect(inputBus);
    fxNodes.bass = bass; fxNodes.mid = mid; fxNodes.treble = treble;
  }

  // punch 0 is a true bypass (ratio 1, threshold at the ceiling); at 1 it is
  // a hard bus squash with matching makeup so only the density changes.
  function applyPunch(smooth = true) {
    const c = fxNodes.comp, m = fxNodes.makeup;
    if (!c) return;
    const th = -32 * fx.punch, ratio = 1 + 11 * fx.punch, mk = 1 + 1.1 * fx.punch;
    if (smooth) { ramp(c.threshold, th, 0.05); ramp(c.ratio, ratio, 0.05); ramp(m.gain, mk, 0.05); }
    else { c.threshold.value = th; c.ratio.value = ratio; m.gain.value = mk; }
  }

  // HRTF + inverse distance. refDistance 8 means "full level within 8m of
  // the stack"; rolloff 0.9 is a touch gentler than physics so the far
  // corners of the room don't drop to nothing.
  function makePanner([x, y, z], refDistance) {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    // full level within refDistance of the stack, then a clear fall-off: walk
    // away from the PA and you hear it go distant (the room's reverb stays)
    p.refDistance = refDistance;
    p.maxDistance = SPK.maxDist;
    p.rolloffFactor = SPK.rolloff;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      p.setPosition(x, y, z); // older webkit
    }
    return p;
  }

  function buildSpeakers(bus) {
    // mains — full range, one hang per side of the stage
    bus.connect(makePanner(POS_MAIN_L, SPK.mainRef)).connect(master);
    bus.connect(makePanner(POS_MAIN_R, SPK.mainRef)).connect(master);

    // sub — lowpassed, sitting on the deck. Long wavelengths don't beam,
    // so a fat refDistance flattens its level curve across the floor: the
    // bass "fills the room" instead of pinpointing the box, like real subs.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 120;
    const subGain = ctx.createGain();
    subGain.gain.value = fx.sub;
    fxNodes.sub = subGain;
    bus.connect(lp).connect(subGain).connect(makePanner(POS_SUB, SPK.subRef)).connect(master);

    // rear delay towers — real arenas delay these electronically: the mains'
    // wavefront needs ~130ms to cross the floor, so towers firing "on time"
    // would arrive way early at the back and read as a second, separate PA.
    // Feeding them ~70ms late and ~6dB down keeps the precedence effect
    // pointing at the stage while the back rows stay loud and in time.
    // The highshelf cut fakes the air absorption of a distant source.
    const delay = ctx.createDelay(0.2);
    delay.delayTime.value = SPK.rearDelay;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 4000;
    shelf.gain.value = -4;
    const trim = ctx.createGain();
    trim.gain.value = SPK.rearTrim * fx.rear; // ~ -6dB at the knob's centre detent
    fxNodes.rear = trim;
    bus.connect(delay).connect(shelf).connect(trim);
    trim.connect(makePanner(POS_REAR_L, SPK.rearRef)).connect(master);
    trim.connect(makePanner(POS_REAR_R, SPK.rearRef)).connect(master);
  }

  function ensureGraph() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0; // setEnabled ramps it up — never pop on first build
    const limiter = makeLimiter(ctx);
    master.connect(limiter).connect(ctx.destination);
    preBus = ctx.createGain();
    inputBus = ctx.createGain();
    buildDesk();                 // preBus -> tone/punch -> inputBus
    const speakerBus = ctx.createGain();
    buildSpeakers(speakerBus);
    chains = new Map();
    for (const def of PRESET_DEFS) {
      const chain = buildChain(def);
      chain.out.connect(speakerBus);
      chains.set(def.key, chain);
    }
    activeChain = chains.get(state.preset) || chains.get('arena');
    activeChain.out.gain.value = 1;
    // media elements registered before the first enable get wired now
    for (const el of pending) wireElement(el);
    pending.clear();
  }

  function wireElement(el) {
    let src;
    try {
      src = ctx.createMediaElementSource(el);
    } catch (e) {
      // already claimed (by another context, or a double-wire we somehow
      // missed) — remember the failure so we never retry into the same throw
      attached.set(el, { failed: true });
      return;
    }
    // Once routed through Web Audio the element's own mute no longer silences
    // it, so the screens' muted tour video would play its soundtrack. A gate
    // follows the element's muted/volume instead.
    const gate = ctx.createGain();
    const follow = () => { gate.gain.value = el.muted ? 0 : el.volume; };
    follow();
    el.addEventListener('volumechange', follow);
    src.connect(gate);
    const bypass = ctx.createGain();
    bypass.gain.value = state.on ? 0 : 1;
    gate.connect(bypass).connect(ctx.destination); // the "off" path — see header
    gate.connect(preBus);                          // the spatial path, via the desk
    attached.set(el, { src, bypass });
  }

  function setEnabled(on) {
    on = !!on;
    state.on = on;
    if (on) {
      ensureGraph(); // lazy: we're inside the user's click, so this ctx runs
      if (ctx.state === 'suspended') ctx.resume();
      clearTimeout(offTimer);
      inputBus.connect(activeChain.input); // duplicate connects are no-ops
      ramp(master.gain, state.volume * PA_MAKEUP);
      for (const rec of attached.values()) {
        if (rec.bypass) ramp(rec.bypass.gain, 0);
      }
    } else {
      if (!ctx) return; // never built — everything is already silent/dry
      ramp(master.gain, 0);
      for (const rec of attached.values()) {
        if (rec.bypass) ramp(rec.bypass.gain, 1);
      }
      // once the fade lands, starve the chain: convolvers that keep getting
      // input keep burning CPU even into a zero gain, so cut them off
      clearTimeout(offTimer);
      offTimer = setTimeout(() => {
        if (!state.on && inputBus) {
          try { inputBus.disconnect(); } catch (e) { /* already cut */ }
        }
      }, XFADE * 1000 + 60);
    }
  }

  function setPreset(key) {
    if (!PRESET_DEFS.some((p) => p.key === key)) return;
    state.preset = key;
    if (!ctx) return; // applied when the graph is first built
    const next = chains.get(key);
    if (!next || next === activeChain) return;
    const old = activeChain;
    activeChain = next;
    if (state.on) {
      // feed both chains through the fade so nothing clicks, then starve
      // the loser — its convolver tail rings out through a gain that's
      // already at zero, so the cut is inaudible
      inputBus.connect(next.input);
      ramp(next.out.gain, 1);
      ramp(old.out.gain, 0);
      setTimeout(() => {
        if (activeChain !== old) {
          try { inputBus.disconnect(old.input); } catch (e) { /* already cut */ }
        }
      }, XFADE * 1000 + 60);
    } else {
      // off = inaudible anyway, just swap instantly for the next enable
      old.out.gain.value = 0;
      next.out.gain.value = 1;
    }
  }

  function setVolume(v) {
    v = Math.min(2, Math.max(0, +v || 0));   // past 1: the music slider's 200% (the limiter catches it)
    state.volume = v;
    // short ramp, not .value — slider drags would zipper otherwise
    if (ctx && state.on) ramp(master.gain, v * PA_MAKEUP, 0.03);
  }

  // Live desk controls. Every key is clamped and stored even before the
  // graph exists, so the UI can be restored from a project file and the
  // values apply the moment the PA is first switched on.
  const FX_RANGE = {
    bass: [-1, 1], mid: [-1, 1], treble: [-1, 1],
    reverb: [0, 2], sub: [0, 2], rear: [0, 2], punch: [0, 1],
  };
  function setFX(key, v) {
    const r = FX_RANGE[key];
    if (!r) return;
    fx[key] = Math.min(r[1], Math.max(r[0], +v || 0));
    if (!ctx) return;   // stored; buildDesk/buildChain read fx at build time
    switch (key) {
      case 'bass': ramp(fxNodes.bass.gain, fx.bass * 12, 0.05); break;
      case 'mid': ramp(fxNodes.mid.gain, fx.mid * 10, 0.05); break;
      case 'treble': ramp(fxNodes.treble.gain, fx.treble * 12, 0.05); break;
      case 'punch': applyPunch(); break;
      case 'sub': ramp(fxNodes.sub.gain, fx.sub, 0.05); break;
      case 'rear': ramp(fxNodes.rear.gain, 0.5 * fx.rear, 0.05); break;
      case 'reverb':
        // every room keeps its own character; the knob scales all of them
        for (const c of chains.values()) if (c.wet) ramp(c.wet.gain, c.baseWet * fx.reverb * WET_BOOST, 0.05);
        break;
    }
  }

  function attachElement(el) {
    if (!el || attached.has(el) || pending.has(el)) return; // idempotent
    if (!ctx) {
      pending.add(el); // no ctx yet — element keeps its default output
      return;
    }
    wireElement(el);
  }

  // The DIRECTOR plays sample-accurate BufferSources, not a media element —
  // it asks for OUR context and hands us its output gain, which then routes
  // exactly like an element: dry to the speakers when the PA is off, through
  // the venue acoustics when it's on.
  function getContext() {
    ensureGraph();
    return ctx;
  }
  function attachNode(node) {
    if (!node || attached.has(node)) return;
    const bypass = ctx.createGain();
    bypass.gain.value = state.on ? 0 : 1;
    node.connect(bypass).connect(ctx.destination);
    node.connect(preBus);
    attached.set(node, { src: node, bypass });
  }

  // dt is unused — listener writes are absolute, taken from the camera's
  // world matrix each frame. Cheap enough to skip smoothing entirely.
  function update(dt) {
    if (!ctx || !state.on) return;
    if (!camera || !camera.matrixWorld) return;
    if (typeof camera.updateMatrixWorld === 'function') camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    if (!e) return;
    const px = e[12], py = e[13], pz = e[14];
    const fx = -e[8], fy = -e[9], fz = -e[10]; // cameras look down local -Z
    const ux = e[4], uy = e[5], uz = e[6];
    // a dead matrix (NaN teleport, disposed camera) must never reach the
    // listener params — a poisoned position silences the whole rig for good
    const fin = Number.isFinite;
    if (!(fin(px) && fin(py) && fin(pz) &&
          fin(fx) && fin(fy) && fin(fz) &&
          fin(ux) && fin(uy) && fin(uz))) return;
    if (fx * fx + fy * fy + fz * fz < 1e-12) return; // degenerate basis
    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.value = px; L.positionY.value = py; L.positionZ.value = pz;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
      L.upX.value = ux; L.upY.value = uy; L.upZ.value = uz;
    } else {
      // older webkit has no listener AudioParams
      L.setPosition(px, py, pz);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  return { state, presets, fx, setFX, setEnabled, setPreset, setVolume, attachElement, getContext, attachNode, update };
}
