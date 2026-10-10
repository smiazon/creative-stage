// AUTO SHOW (dev mode): pick a song, press play, and the room runs itself.
// The song is listened to live (Web Audio) and split three ways:
//   LOWS   the kick drum: they're counted into beats and bars (a guess at the tempo), and
//          the effect changes on a downbeat every 8 to 16 bars, at once on a drop
//   MIDS   the feel: how fast the effect runs (the show's tempo follows them)
//   HIGHS  the colour and the shimmer: hi-hats move the colours on, a cymbal crash
//          throws a white sparkle across the crowd, the treble sprinkles glints on the screens
// One style at a time (Grid, Unifying, Grouping or MH), in the colours picked (up to four,
// or the rainbow), at an energy (Low, Medium, High, Extreme). Colours are only ever bright
// and saturated, one at a time or several together, now and then white.
// The screens get an abstract visual of their own (blooms, rings, ribbons, rays, colour
// fields) on the main stage and round on the B-stage. The song can play from the arena's PA
// (its speaker stacks and the room's acoustics, heard from where you stand), or straight.
import * as THREE from 'three';
import { MOTIONS } from './irheads.js';

// the colours to pick from: bright and saturated only, and white
export const AUTO_COLOURS = [
  ['#ff1430', 'Red'], ['#ff7a00', 'Orange'], ['#ffe600', 'Yellow'], ['#7dff1a', 'Lime'], ['#00ff6a', 'Green'],
  ['#00e5ff', 'Cyan'], ['#1e5aff', 'Blue'], ['#8a2bff', 'Purple'], ['#ff2bd6', 'Magenta'], ['#ffffff', 'White'],
];
export const AUTO_ENERGY = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['extreme', 'Extreme']];
export const AUTO_STYLES = [['grid', 'Grid'], ['wash', 'Unifying'], ['group', 'Grouping'], ['ir', 'MH']];

// what each energy means: how many bars an effect lasts (8 to 16 on average), the tempo range
// the mids move in, the shortest wait between colour changes (seconds), how much the highs
// shimmer, how often a crash may sparkle, how lively the screens are
const ENERGY = {
  low: { k: 0, bars: [16, 16], tempo: [0.3, 0.7], colour: 9, shimmer: 0.35, glint: 0, vis: 0.55 },
  medium: { k: 1, bars: [12, 16], tempo: [0.55, 1.15], colour: 4.5, shimmer: 0.6, glint: 20, vis: 1 },
  high: { k: 2, bars: [8, 12], tempo: [0.95, 1.8], colour: 2.2, shimmer: 0.85, glint: 10, vis: 1.45 },
  extreme: { k: 3, bars: [8, 8], tempo: [1.5, 2.7], colour: 1.1, shimmer: 1, glint: 5, vis: 2.1 },
};

// the effects of each style, calm to wild. GRID: the Show presets that wear the picked
// colours (none with words; the BLEND ones run one colour into another, so one colour only)
const GRID = [
  ['flow', 'northern', 'softripple', 'wave', 'ribbon1', 'sweep', 'tierblocks', 'glitter', 'ripple'],
  ['march', 'comets', 'ripple', 'zigzagall', 'ribbons', 'sweep', 'tiers', 'dotfloor', 'countercomets', 'stripes2', 'pulsering', 'team', 'rain', 'scanner'],
  ['equalizer', 'checker', 'teams', 'zigzag', 'scanner', 'tiers', 'heartbeat', 'bassfloor', 'pulsering', 'countercomets', 'halves', 'march'],
  ['strobe', 'equalizer', 'checker', 'teams', 'heartbeat', 'bassfloor', 'pulsering', 'zigzag'],
];
const BLEND = new Set(['flow', 'northern']);
const SPARKLY = new Set(['glitter', 'dotfloor', 'rain', 'comets', 'countercomets', 'team']);
const WASHES = [
  [['solid', 0.6], ['fade', 0.5], ['fade', 0.8]],
  [['fade', 1], ['pulse', 0.8], ['open', 0.9], ['close', 0.9]],
  [['pulse', 1.3], ['close', 1.4], ['open', 1.3], ['pulse', 1.7], ['strobe', 0.7]],
  [['strobe', 1], ['pulse', 2.2], ['close', 2.2], ['strobe', 1.4]],
];
const GROUPS = [
  { order: ['all', 'around', 'climb'], inner: ['together'], fx: ['solid', 'fade'], step: [0.5, 0.9], groups: [1, 2] },
  { order: ['around', 'pingpong', 'sides', 'climb', 'stage'], inner: ['together', 'chase'], fx: ['pulse', 'fade', 'open'], step: [0.22, 0.36], groups: [2, 3] },
  { order: ['snake', 'alternate', 'random', 'build', 'sides'], inner: ['chase', 'alternate'], fx: ['pulse', 'close', 'comets', 'sparkle'], step: [0.11, 0.18], groups: [3, 4] },
  { order: ['random', 'alternate', 'snake'], inner: ['random', 'alternate'], fx: ['strobe', 'pulse', 'close'], step: [0.05, 0.09], groups: [4, 4] },
];
const IRS = [
  ['sweep', 'wave', 'rise', 'focus'],
  ['circles', 'figure8', 'lighthouse', 'search', 'wave'],
  ['cross', 'snap', 'search', 'circles', 'figure8'],
  ['snap', 'cross', 'lighthouse'],
];
const SCENES = [
  ['bloom', 'ribbons', 'field'],
  ['bloom', 'ribbons', 'rings', 'rays', 'field'],
  ['rings', 'rays', 'ribbons', 'field', 'bloom'],
  ['rings', 'rays', 'field'],
];

const KEY = 'pm-auto';
const TAU = Math.PI * 2;
const pickOf = (a) => a[(Math.random() * a.length) | 0];
const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const toRGB = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hueHex = (h) => `#${new THREE.Color().setHSL(((h % 1) + 1) % 1, 1, 0.5).getHexString()}`;
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export function initAutoShow({ designer, setScreens, pa = null }) {
  // --- what was picked (kept between visits) ---------------------------------------------------
  const cfg = { colours: ['#ff2bd6', '#00e5ff'], rainbow: false, energy: 'medium', style: 'grid', pa: true };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) {
      if (Array.isArray(s.colours)) cfg.colours = s.colours.filter((c) => AUTO_COLOURS.some(([h]) => h === c)).slice(0, 4);
      cfg.rainbow = !!s.rainbow;
      if (ENERGY[s.energy]) cfg.energy = s.energy;
      if (AUTO_STYLES.some(([id]) => id === s.style)) cfg.style = s.style;
      if (typeof s.pa === 'boolean') cfg.pa = s.pa;
    }
  } catch (_) { /* private mode */ }
  if (!cfg.colours.length && !cfg.rainbow) cfg.colours = ['#ff2bd6'];
  const saveCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (_) { /* private mode */ } };
  const EN = () => ENERGY[cfg.energy];

  // --- the song ---------------------------------------------------------------------------------
  const audio = new Audio();
  audio.preload = 'auto';
  audio.playsInline = true;
  let ctx = null, analyser = null, freq = null, url = null, name = '';
  let playing = false, onChange = () => {};
  const ensureAudio = () => {
    if (ctx) return;
    // the PA's own context, so the song can go through it (dry while the PA is off)
    ctx = pa?.context?.() || new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.35;   // quick enough to catch a kick; the screens smooth on their own
    src.connect(analyser);
    if (pa?.attach) pa.attach(analyser); else analyser.connect(ctx.destination);
    freq = new Uint8Array(analyser.frequencyBinCount);
  };
  // the PA: on while a show plays if the switch says so; switched back off after, if we switched it on
  let paOurs = false;
  function routePA() {
    if (!pa) return;
    if (playing && cfg.pa && !pa.on) { pa.set(true); paOurs = true; }
    else if ((!playing || !cfg.pa) && pa.on && (paOurs || cfg.pa === false)) { pa.set(false); paOurs = false; }
  }
  audio.addEventListener('ended', () => stop());

  // --- listening: lows, mids, highs ----------------------------------------------------------------
  const A = {
    low: 0, mid: 0, high: 0, lowPrev: 0, lowAvg: 0.2, highPrev: 0,
    highFlux: 0.005, highDev: 0.005, highAvg: 0.05,
    midSm: 0, midPeak: 0.2, midFloor: 0.1, midN: 0.5, highSm: 0, highPeak: 0.1, highN: 0.3,
    eShort: 0, eLong: 0.2, peak: 0.25, songT: 0,
    lastKick: 0, kicks: 0, lastAccent: 0, lastGlint: 0, changedAt: 0, colourAt: 0, tempoAt: 0, tempoSent: -1,
    // the guess at the beat: the gaps between kicks, the beat's length, and where we are
    gaps: [], beat: 0.5, beats: 0, bars: 12,
  };
  // the beat's length from the last kicks: each gap folded into one beat (80 to 170 a minute), the middle one
  function guessBeat() {
    const f = A.gaps.map((g) => { while (g > 0.75) g /= 2; while (g < 0.35) g *= 2; return g; }).sort((a, b) => a - b);
    if (f.length >= 3) A.beat += (f[f.length >> 1] - A.beat) * 0.35;
  }
  const band = (lo, hi) => {   // the average of a frequency range, 0..1
    const ny = ctx.sampleRate / 2, n = freq.length;
    const a = Math.max(1, Math.floor((lo / ny) * n)), b = Math.min(n - 1, Math.ceil((hi / ny) * n));
    let s = 0;
    for (let i = a; i <= b; i++) s += freq[i];
    return s / ((b - a + 1) * 255);
  };

  // --- the screens' state (the colours live here too) ----------------------------------------------
  const V = { scene: 'bloom', cols: [[255, 43, 214]], ci: 0, kick: 0, glint: 0, flash: 0, t: 0, rot: 0, rings: [], parts: [], spec: new Float32Array(32) };
  const colAt = (i) => V.cols[((i % V.cols.length) + V.cols.length) % V.cols.length];

  // --- the colours ----------------------------------------------------------------------------------
  // a scheme: one colour, a few together, or the whole rainbow; now and then a white accent
  let scheme = { mode: 'mono', cols: ['#ff2bd6'] }, pi = -1, hue = Math.random();
  function nextScheme() {
    const P = cfg.rainbow ? null : cfg.colours;
    if (!P) {
      if (Math.random() < 0.45) scheme = { mode: 'rainbow', cols: [0, 0.25, 0.5, 0.75].map((o) => hueHex(hue + o)) };
      else { hue = (hue + 0.22 + Math.random() * 0.25) % 1; scheme = { mode: 'mono', cols: [hueHex(hue)] }; }
    } else if (P.length === 1 || Math.random() < 0.55) {
      pi = (pi + 1) % P.length;
      scheme = { mode: 'mono', cols: [P[pi]] };
    } else {
      pi = (pi + 1) % P.length;
      scheme = { mode: 'multi', cols: [...P.slice(pi), ...P.slice(0, pi)] };
    }
    // sometimes white: a single colour gets a white partner
    if (scheme.mode === 'mono' && scheme.cols[0] !== '#ffffff' && Math.random() < 0.16) scheme = { mode: 'multi', cols: [scheme.cols[0], '#ffffff'] };
    V.cols = scheme.cols.map(toRGB);
    V.ci = 0;
  }

  // --- the effect: one style, chosen by the energy, in the scheme's colours ---------------------------
  let effect = null;
  const shimmer = () => EN().shimmer * A.highN;   // the highs, as a share 0..1
  function pickEffect() {
    const k = EN().k, st = cfg.style;
    if (st === 'grid') {
      let pool = GRID[k].filter((id) => id !== effect?.id);
      if (scheme.mode !== 'mono') pool = pool.filter((id) => !BLEND.has(id));
      if (shimmer() > 0.5) { const sp = pool.filter((id) => SPARKLY.has(id)); if (sp.length && Math.random() < 0.6) pool = sp; }
      return { style: st, id: pickOf(pool) };
    }
    if (st === 'wash') { const [fx, speed] = pickOf(WASHES[k]); return { style: st, id: `${fx}${speed}`, fx, speed }; }
    if (st === 'group') {
      const G = GROUPS[k];
      return {
        style: st, id: `g${Math.random()}`, order: pickOf(G.order), inner: pickOf(G.inner), step: lerp(G.step[0], G.step[1], Math.random()),
        groups: G.groups[0] + ((Math.random() * (G.groups[1] - G.groups[0] + 1)) | 0), fx: [0, 1, 2, 3].map(() => pickOf(G.fx)),
      };
    }
    return { style: 'ir', id: pickOf(IRS[k].filter((m) => m !== effect?.id)) };
  }
  // put the effect on the wristbands, with the colours as they are now
  function apply() {
    if (!effect) return;
    const { mode, cols } = scheme, rainbow = mode === 'rainbow';
    const prob = Math.max(0.5, 1 - shimmer() * 0.5);   // the highs turn a share of the bands into glints
    if (effect.style === 'grid') {
      designer.setBrand?.(rainbow ? { rainbow: true } : { a: cols[0], b: cols[1] || cols[0], extra: cols.slice(2), rainbow: false });
      if (designer.demo !== effect.id) designer.playDemo?.(effect.id);
    } else if (effect.style === 'wash') {
      designer.setWash?.({ fx: effect.fx, speed: effect.speed, prob, a: cols[0], pal: cols, cmode: rainbow ? pickOf(['rainbow', 'cycle']) : cols.length > 1 ? 'pal' : 'a' });
    } else if (effect.style === 'group') {
      designer.setGroup?.({
        order: effect.order, inner: effect.inner, step: effect.step, groups: effect.groups, gsplit: 'across', speed: 1,
        cmode: rainbow ? 'rainbow' : 'group', fx: effect.fx.map((fx, k) => ({ fx: shimmer() > 0.6 && k === 3 ? 'twinkle' : fx, a: cols[k % cols.length] })),
        floor: { fx: effect.fx[0], cols: cols.slice(0, 4), mode: 'chase' },
      });
    } else {
      const m = MOTIONS.find((o) => o.id === effect.id) || MOTIONS[0];
      designer.setIR?.({ motion: m.id, fx: m.fx || 'solid', gobo: m.gobo || 'circle', size: m.size || 1, heads: 0, prob, a: cols[0], pal: cols, cmode: rainbow ? 'rainbow' : cols.length > 1 ? 'pal' : 'a' });
    }
  }
  function change(now, { colours = true } = {}) {
    if (colours) { nextScheme(); A.colourAt = now; }
    effect = pickEffect();
    apply();
    A.changedAt = now;
    A.kicks = 0;
    A.beats = 0;   // this is bar 1, beat 1
    const [b0, b1] = EN().bars;
    A.bars = b0 + Math.round(Math.random() * ((b1 - b0) / 4)) * 4;   // 8, 12 or 16: phrases come in fours
    V.scene = pickOf(SCENES[EN().k].filter((s) => s !== V.scene));
  }
  // a cymbal crash: a white sparkle runs across the crowd for a moment, then the effect comes back
  let glintT = 0;
  function glint(now) {
    A.lastGlint = now;
    const st = cfg.style;
    if (st === 'grid') designer.playDemo?.('phones');
    else if (st === 'wash') designer.setWash?.({ fx: 'solid', speed: 3, prob: 0.22, a: '#ffffff', cmode: 'a' });
    else if (st === 'group') designer.setGroup?.({ fx: [0, 1, 2, 3].map(() => ({ fx: 'twinkle', a: '#ffffff' })), cmode: 'group' });
    else designer.setIR?.({ fx: 'strobe', a: '#ffffff', cmode: 'a' });
    clearTimeout(glintT);
    glintT = setTimeout(() => { if (playing) apply(); }, 650);
  }

  // --- each frame: listen, decide, draw ---------------------------------------------------------------
  let raf = 0, last = 0, drawn = 0, lastAt = 0;
  function frame(now) {
    raf = playing ? requestAnimationFrame(frame) : 0;
    if (!analyser) return;
    const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
    // the counting runs on the song's own clock, so a slow frame never loses a beat
    const at = audio.currentTime, adt = Math.max(0, Math.min(0.5, at - lastAt)); lastAt = at;
    analyser.getByteFrequencyData(freq);
    const E = EN();
    A.low = band(35, 140); A.mid = band(300, 2000); A.high = band(5000, 14000);

    A.songT = at;
    const warm = A.songT > 6;   // the first seconds only learn what the song sounds like
    // LOWS: a kick is the bass rising well over its recent average
    const rising = A.low > A.lowPrev; A.lowPrev = A.low;
    const kick = rising && A.low > A.lowAvg * 1.28 && A.low > 0.16 && at - A.lastKick > Math.max(0.23, A.beat * 0.55);
    A.lowAvg += (A.low - A.lowAvg) * Math.min(1, dt * 1.6);
    // MIDS: how busy the middle is, between the song's own quietest and loudest
    A.midSm += (A.mid - A.midSm) * Math.min(1, dt * 1.5);
    A.midPeak = Math.max(A.midSm, A.midPeak * (1 - dt * 0.03));
    A.midFloor = Math.min(A.midSm, A.midFloor + dt * 0.004);
    A.midN = clamp01((A.midSm - A.midFloor) / Math.max(0.04, A.midPeak - A.midFloor));
    // HIGHS: the treble's level, and its sudden bursts (hats; a crash when it's big)
    const hf = Math.max(0, A.high - A.highPrev); A.highPrev = A.high;
    const accent = hf > A.highFlux + A.highDev * 3 && A.high > 0.06 && now - A.lastAccent > 120;
    A.highFlux += (hf - A.highFlux) * 0.06; A.highDev += (Math.abs(hf - A.highFlux) - A.highDev) * 0.06;
    A.highSm += (A.high - A.highSm) * Math.min(1, dt * 2);
    A.highPeak = Math.max(A.highSm, A.highPeak * (1 - dt * 0.03));
    A.highN = clamp01(A.highSm / Math.max(0.03, A.highPeak));
    const crash = warm && accent && A.high > A.highAvg * 2.2 && A.high > 0.2;
    A.highAvg += (A.high - A.highAvg) * Math.min(1, dt * 0.5);
    // the whole: a drop is loud straight after quiet
    const level = A.low * 0.5 + A.mid * 0.35 + A.high * 0.15;
    A.peak = Math.max(level, A.peak * (1 - dt * 0.02));
    const e = Math.min(1, level / Math.max(0.12, A.peak));
    A.eShort += (e - A.eShort) * Math.min(1, dt * 2.5);
    A.eLong += (e - A.eLong) * Math.min(1, dt * 0.25);
    // counting: the beat clock runs on its guess, and every kick pulls it back in line
    A.beats += adt / A.beat;
    if (kick) {
      const gap = at - A.lastKick;
      if (A.lastKick && gap < 2.5) { A.gaps.push(gap); if (A.gaps.length > 12) A.gaps.shift(); guessBeat(); }
      A.lastKick = at; A.kicks++;
      if (Math.abs(A.beats - Math.round(A.beats)) < 0.35) A.beats = Math.round(A.beats);   // on the beat: lock to it
      V.kick = 1; V.ci++; V.rot += 0.18 + 0.1 * E.k; spawnRing();
    }
    if (accent) { A.lastAccent = now; V.glint = Math.min(1, V.glint + 0.5); }

    // the lows change the effect: on the downbeat after 8 to 16 bars (a bar late if the drums
    // have stopped), and at once on a drop (loud straight after quiet, a kick on it)
    const due = A.bars * 4;
    const drop = warm && kick && A.beats >= 16 && A.eShort > A.eLong * 1.45 && A.eShort > 0.55;
    if (!effect || drop || (kick && A.beats >= due - 0.5) || A.beats >= due + 4) change(now);
    // the highs change the colour, on a hi-hat, not too often
    else if (accent && (now - A.colourAt) / 1000 > E.colour * (cfg.style === 'grid' ? 1.6 : 1) * (1.3 - A.highN * 0.5)) { nextScheme(); A.colourAt = now; apply(); }
    // a crash: a white sparkle, now and then
    if (crash && E.glint && (now - A.lastGlint) / 1000 > E.glint) { glint(now); burst(); }
    // the mids set the pace
    if (now - A.tempoAt > 180) {
      A.tempoAt = now;
      const t = lerp(E.tempo[0], E.tempo[1], A.midN ** 1.2);
      if (Math.abs(t - A.tempoSent) > 0.03) { A.tempoSent = t; designer.setTempo?.(t); }
    }
    if (now - drawn > 33) { drawn = now; drawWall(0.033); drawRing(); wallTex.needsUpdate = true; ringTex.needsUpdate = true; }   // 30 a second is plenty for a screen
  }

  // --- the screens: abstract, in the scheme's colours -----------------------------------------------
  const wallC = document.createElement('canvas'); wallC.width = 1024; wallC.height = 576;
  const wg = wallC.getContext('2d');
  const ringC = document.createElement('canvas'); ringC.width = 512; ringC.height = 512;
  const rg = ringC.getContext('2d');
  const wallTex = new THREE.CanvasTexture(wallC); wallTex.colorSpace = THREE.SRGBColorSpace;
  const ringTex = new THREE.CanvasTexture(ringC); ringTex.colorSpace = THREE.SRGBColorSpace;
  function spawnRing() { V.rings.push({ r: 0, c: colAt(V.ci), w: 0.4 + A.low }); if (V.rings.length > 14) V.rings.shift(); }
  function burst() {
    V.flash = 1;
    const x = 0.2 + Math.random() * 0.6, y = 0.25 + Math.random() * 0.5;
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * TAU, s = 0.15 + Math.random() * 0.5;
      V.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7 + Math.random() * 0.5, age: 0, c: Math.random() < 0.5 ? [255, 255, 255] : colAt(i), s: 2 + Math.random() * 3 });
    }
  }
  function sparkles(dt) {
    // the highs: glints, white and in colour, as many as the treble asks for
    const want = Math.min(10, A.highN ** 1.6 * EN().shimmer * 7 + V.glint * 6);
    const n = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      V.parts.push({ x: Math.random(), y: Math.random(), vx: 0, vy: 0, life: 0.25 + Math.random() * 0.5, age: 0, c: Math.random() < 0.45 ? [255, 255, 255] : colAt(i + V.ci), s: 1.2 + Math.random() * 2.6 });
    }
    if (V.parts.length > 420) V.parts.splice(0, V.parts.length - 420);
    for (const p of V.parts) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; }
    V.parts = V.parts.filter((p) => p.age < p.life);
  }
  function drawParts(g, W, H) {
    for (const p of V.parts) {
      const k = 1 - p.age / p.life, s = p.s * (W / 1024) * (0.6 + k);
      g.fillStyle = rgba(p.c, k);
      g.beginPath(); g.arc(p.x * W, p.y * H, s, 0, TAU); g.fill();
      if (p.s > 3) { g.fillRect(p.x * W - s * 3, p.y * H - 0.6, s * 6, 1.2); g.fillRect(p.x * W - 0.6, p.y * H - s * 3, 1.2, s * 6); }   // a star's cross
    }
  }
  function spectrum() {   // 32 log-spaced bands, smoothed, for the rays
    const n = freq.length;
    for (let i = 0; i < 32; i++) {
      const a = Math.floor(2 * Math.pow(n / 3, i / 32)), b = Math.max(a + 1, Math.floor(2 * Math.pow(n / 3, (i + 1) / 32)));
      let s = 0;
      for (let k = a; k < b; k++) s += freq[k];
      V.spec[i] += ((s / ((b - a) * 255)) ** 1.3 - V.spec[i]) * 0.4;
    }
  }
  function drawWall(dt) {
    const W = wallC.width, H = wallC.height, E = EN();
    if (scheme.mode === 'rainbow') { hue = (hue + dt * 0.04 * (1 + A.highN)) % 1; V.cols = [0, 0.25, 0.5, 0.75].map((o) => toRGB(hueHex(hue + o))); }
    V.t += dt * (0.35 + A.midN * 1.3) * E.vis;
    V.kick *= Math.exp(-dt * (5 + E.k * 2)); V.glint *= Math.exp(-dt * 4); V.flash *= Math.exp(-dt * 7);
    spectrum(); sparkles(dt);
    const fade = { bloom: 0.22, rings: 0.32, ribbons: 0.28, rays: 0.34, field: 0.45 }[V.scene];
    wg.globalCompositeOperation = 'source-over';
    wg.fillStyle = `rgba(0,0,0,${fade})`; wg.fillRect(0, 0, W, H);
    wg.globalCompositeOperation = 'lighter';
    const n = V.cols.length;
    if (V.scene === 'bloom') {
      const m = Math.min(6, Math.max(3, n * 2));
      for (let i = 0; i < m; i++) {
        const c = colAt(i), x = W * (0.5 + 0.4 * Math.sin(V.t * 0.7 * (1 + i * 0.13) + i * 2.1)), y = H * (0.5 + 0.36 * Math.sin(V.t * 0.53 * (1 + i * 0.17) + i * 1.3));
        const r = H * (0.26 + 0.1 * Math.sin(V.t + i)) * (1 + 0.55 * V.kick);
        const g = wg.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(c, 0.8)); g.addColorStop(0.5, rgba(c, 0.3)); g.addColorStop(1, rgba(c, 0));
        wg.fillStyle = g; wg.fillRect(x - r, y - r, r * 2, r * 2);
      }
    } else if (V.scene === 'rings') {
      for (const R of V.rings) {
        R.r += dt * H * 0.55 * (0.6 + A.midN) * E.vis;
        const k = Math.max(0, 1 - R.r / (W * 0.62));
        for (const [w, a] of [[26, 0.14], [7, 0.85]]) {
          wg.strokeStyle = rgba(R.c, a * k); wg.lineWidth = w * (0.6 + R.w);
          wg.beginPath(); wg.arc(W / 2, H / 2, R.r, 0, TAU); wg.stroke();
        }
      }
      V.rings = V.rings.filter((R) => R.r < W * 0.62);
      const c = colAt(V.ci), r = H * (0.08 + 0.12 * V.kick);
      const g = wg.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, r * 2);
      g.addColorStop(0, rgba(c, 0.9)); g.addColorStop(1, rgba(c, 0));
      wg.fillStyle = g; wg.fillRect(W / 2 - r * 2, H / 2 - r * 2, r * 4, r * 4);
    } else if (V.scene === 'ribbons') {
      const k = n > 1 ? n : 3;
      for (let i = 0; i < k; i++) {
        const c = colAt(i), off = (i - (k - 1) / 2) * H * 0.13, amp = H * (0.07 + 0.24 * A.midN) * (1 + 0.45 * V.kick);
        for (const [w, a] of [[24, 0.13], [6, 0.9]]) {
          wg.strokeStyle = rgba(c, a); wg.lineWidth = w;
          wg.beginPath();
          for (let x = -10; x <= W + 10; x += 14) {
            const y = H / 2 + off + Math.sin(x * 0.0062 * (1 + i * 0.22) + V.t * 2.2 * (1 + i * 0.12) + i * 1.7) * amp;
            if (x < 0) wg.moveTo(x, y); else wg.lineTo(x, y);
          }
          wg.stroke();
        }
      }
    } else if (V.scene === 'rays') {
      V.rot += dt * (0.15 + A.midN * 1.1) * E.vis;
      const m = 18 + E.k * 8, cx = W / 2, cy = H / 2;
      wg.lineCap = 'round';
      for (let i = 0; i < m; i++) {
        const a = (i / m) * TAU + V.rot, v = V.spec[(Math.abs((i % 16) - 8) * 2) % 32];
        const L = H * (0.12 + v * 0.95) * (1 + 0.3 * V.kick), c = colAt(i);
        for (const [w, al] of [[16, 0.14], [4, 0.9]]) {
          wg.strokeStyle = rgba(c, al); wg.lineWidth = w;
          wg.beginPath(); wg.moveTo(cx + Math.cos(a) * H * 0.07, cy + Math.sin(a) * H * 0.07); wg.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); wg.stroke();
        }
      }
    } else {   // field: one colour at a time, stepping on the kick, a soft bar sweeping through
      const c = colAt(V.ci);
      wg.fillStyle = rgba(c, 0.1 + 0.7 * V.kick); wg.fillRect(0, 0, W, H);
      const x = (((V.t * 0.35) % 1.4) - 0.2) * W, bw = W * 0.28;
      const g = wg.createLinearGradient(x - bw, 0, x + bw, 0);
      g.addColorStop(0, rgba(c, 0)); g.addColorStop(0.5, rgba(colAt(V.ci + 1), 0.55)); g.addColorStop(1, rgba(c, 0));
      wg.fillStyle = g; wg.fillRect(x - bw, 0, bw * 2, H);
    }
    drawParts(wg, W, H);
    if (V.flash > 0.02) { wg.fillStyle = `rgba(255,255,255,${V.flash * 0.32})`; wg.fillRect(0, 0, W, H); }
  }
  // the B-stage: round — a bloom at the centre, the rings, rays or orbiting blooms, the glints
  function drawRing() {
    const S = ringC.width, c = S / 2;
    rg.globalCompositeOperation = 'source-over';
    rg.fillStyle = 'rgba(0,0,0,0.3)'; rg.fillRect(0, 0, S, S);
    rg.globalCompositeOperation = 'lighter';
    if (V.scene === 'field') { rg.fillStyle = rgba(colAt(V.ci), 0.1 + 0.6 * V.kick); rg.beginPath(); rg.arc(c, c, S / 2, 0, TAU); rg.fill(); }
    const col = colAt(V.ci), R = S * (0.14 + 0.14 * V.kick + 0.05 * A.low);
    const g = rg.createRadialGradient(c, c, 0, c, c, R * 1.8);
    g.addColorStop(0, rgba(col, 0.95)); g.addColorStop(1, rgba(col, 0));
    rg.fillStyle = g; rg.fillRect(c - R * 2, c - R * 2, R * 4, R * 4);
    for (const Rg of V.rings) {
      const r = (Rg.r / (wallC.width * 0.62)) * S * 0.5, k = Math.max(0, 1 - r / (S * 0.5));
      rg.strokeStyle = rgba(Rg.c, 0.85 * k); rg.lineWidth = 6 * (0.6 + Rg.w);
      rg.beginPath(); rg.arc(c, c, r, 0, TAU); rg.stroke();
    }
    if (V.scene === 'bloom' || V.scene === 'ribbons') {
      for (let i = 0; i < 3; i++) {
        const a = V.t * 0.8 + (i / 3) * TAU, x = c + Math.cos(a) * S * 0.3, y = c + Math.sin(a) * S * 0.3, r = S * 0.16 * (1 + 0.4 * V.kick), cc = colAt(i);
        const gg = rg.createRadialGradient(x, y, 0, x, y, r);
        gg.addColorStop(0, rgba(cc, 0.75)); gg.addColorStop(1, rgba(cc, 0));
        rg.fillStyle = gg; rg.fillRect(x - r, y - r, r * 2, r * 2);
      }
    } else {
      rg.lineCap = 'round';
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU + V.rot, v = V.spec[(i * 2) % 32];
        rg.strokeStyle = rgba(colAt(i), 0.9); rg.lineWidth = 5;
        rg.beginPath(); rg.moveTo(c + Math.cos(a) * S * 0.16, c + Math.sin(a) * S * 0.16);
        rg.lineTo(c + Math.cos(a) * S * (0.2 + v * 0.3), c + Math.sin(a) * S * (0.2 + v * 0.3)); rg.stroke();
      }
    }
    drawParts(rg, S, S);
    if (V.flash > 0.02) { rg.fillStyle = `rgba(255,255,255,${V.flash * 0.3})`; rg.fillRect(0, 0, S, S); }
  }

  // --- play and stop -----------------------------------------------------------------------------------
  let before = null;   // the show that was on, back when it stops
  async function play() {
    if (!url) return false;
    ensureAudio();
    try { await ctx.resume(); await audio.play(); } catch (_) { return false; }
    playing = true;
    routePA();
    before = { show: designer.snapshot?.(), tempo: designer.tempo };
    effect = null; A.changedAt = 0; A.kicks = 0; A.peak = 0.25; A.midPeak = 0.2; A.highPeak = 0.1; A.tempoSent = -1;
    A.songT = 0; A.gaps = []; A.beat = 0.5; A.beats = 0; A.lastKick = 0; A.eLong = 0.2; lastAt = audio.currentTime;
    wg.fillStyle = '#000'; wg.fillRect(0, 0, wallC.width, wallC.height);
    setScreens?.({ wall: wallTex, b: ringTex });
    if (!raf) raf = requestAnimationFrame(frame);
    onChange();
    return true;
  }
  function stop() {
    if (!playing) return;
    playing = false;
    clearTimeout(glintT);
    audio.pause();
    routePA();
    setScreens?.(null);
    if (before?.show) designer.restore?.(before.show);
    if (before && Number.isFinite(before.tempo)) designer.setTempo?.(before.tempo);
    before = null;
    onChange();
  }
  return {
    load(file) {
      if (!file) return;
      const was = playing;
      stop();
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(file);
      audio.src = url;
      name = (file.name || 'Song').replace(/\.[^.]+$/, '');
      audio.currentTime = 0;
      onChange();
      if (was) play();   // a new song while one plays: straight on with it
    },
    play, stop,
    // inside a tap: wake the sound up now (a phone only lets it start from a touch)
    prime() { ensureAudio(); ctx.resume?.().catch?.(() => {}); },
    // the guess at the music, for the card: beats a minute, the bar it's on, the bars this effect lasts
    get count() { return playing && A.kicks + A.gaps.length > 2 ? { bpm: Math.round(60 / A.beat), bar: Math.floor(A.beats / 4) + 1, of: A.bars } : null; },
    // what was picked: colours (up to four) or the rainbow, the energy, the style. A change
    // while playing shows at once: new colours now, a new effect for a new energy or style
    get settings() { return { ...cfg, colours: [...cfg.colours] }; },
    set(patch) {
      Object.assign(cfg, patch);
      if (!cfg.colours.length && !cfg.rainbow) cfg.colours = ['#ff2bd6'];
      saveCfg();
      if ('pa' in patch) { routePA(); return; }
      if (!playing) return;
      const now = performance.now();
      if ('style' in patch || 'energy' in patch) change(now);
      else { pi = -1; nextScheme(); A.colourAt = now; apply(); }
    },
    get playing() { return playing; },
    get hasSong() { return !!url; },
    get name() { return name; },
    get time() { return audio.currentTime || 0; },
    get duration() { return Number.isFinite(audio.duration) ? audio.duration : 0; },
    set onChange(fn) { onChange = fn || (() => {}); },
  };
}
