// Trigger pads: ten flash keys, 1 2 3 4 5 6 7 8 9 0, living in the DIRECTOR
// deck. Works like a lighting console's look store: dial in a show state with
// the console (a laser setup, an orb colour, a rig cue, all of it), hit SET on
// a pad, and the pad snapshots everything. Pressing its key recalls the whole
// look instantly. Pads persist in localStorage across reloads.
//
// The number row, not A–L: the letters collided with WASD, so a pad press and
// a strafe were the same keystroke and mouse-look had to win. Nothing else in
// the app binds a digit, so the pads can now fire whenever the pointer is free
// — and the row has ten keys where the home row gave nine.
// A press that cannot do anything says why rather than dying silently.
import * as THREE from 'three';
import { LAYER_PRESETS, CATEGORIES, SEED_IDS, presetById, materialise, SUBSYS, SUBSYS_KEYS, SUBSYS_LABEL } from './layerpresets.js';

const KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
const LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
export const PADS = LABELS.length;

// A vibe is a feeling picked BEFORE the show is built — "warm", "neon", "ocean".
// It is not a look: it is a colour layer laid over every look, the way the
// master switches are an on/off layer over every subsystem. So a preset called
// "Red" comes out in the vibe's colours while a vibe is set; Natural restores it.
export const VIBES = [
  { id: 'natural', name: 'Natural', a: null, b: null, palette: null },
  { id: 'warm',   name: 'Warm',   a: '#ff8a00', b: '#ff2d2d', palette: ['#ffb347', '#ff6a00', '#ff3b30', '#ffd27f'] },
  { id: 'fire',   name: 'Fire',   a: '#ff3b30', b: '#ffc61a', palette: ['#ff3b30', '#ffc61a', '#ff7a00', '#fff1a8'] },
  { id: 'sunset', name: 'Sunset', a: '#ff7a18', b: '#ff3c8e', palette: ['#ff9a3c', '#ff3c8e', '#ffd166', '#c44dff'] },
  { id: 'neon',   name: 'Neon',   a: '#ff2fd6', b: '#39ff88', palette: ['#ff2fd6', '#39ff88', '#00e5ff', '#ffe600'] },
  { id: 'royal',  name: 'Royal',  a: '#7a3cff', b: '#ffc94d', palette: ['#7a3cff', '#ffc94d', '#c084fc', '#ffe08a'] },
  { id: 'ocean',  name: 'Ocean',  a: '#1f6bff', b: '#00d1c1', palette: ['#1f6bff', '#00d1c1', '#7fdbff', '#0a3d91'] },
  { id: 'cool',   name: 'Ice',    a: '#5ac8ff', b: '#ffffff', palette: ['#a8e6ff', '#5ac8ff', '#ffffff', '#7fb2ff'] },
  { id: 'forest', name: 'Forest', a: '#22c55e', b: '#d9f99d', palette: ['#22c55e', '#d9f99d', '#0f766e', '#bef264'] },
  { id: 'mono',   name: 'Mono',   a: '#ffffff', b: '#cfd8e3', palette: ['#ffffff', '#e5e7eb', '#9ca3af', '#ffffff'] },
  { id: 'candy',  name: 'Candy',  a: '#ff5fa2', b: '#5fd8ff', palette: ['#ff5fa2', '#5fd8ff', '#ffe066', '#c77dff'] },
  { id: 'acid',   name: 'Acid',   a: '#c6ff00', b: '#00e5ff', palette: ['#c6ff00', '#00e5ff', '#76ff03', '#eaff6b'] },
  { id: 'blood',  name: 'Blood',  a: '#e00024', b: '#4a0010', palette: ['#e00024', '#8b0018', '#ff4d4d', '#2a0008'] },
  { id: 'gold',   name: 'Gold',   a: '#ffc233', b: '#fff4c2', palette: ['#ffc233', '#fff4c2', '#e09b00', '#ffe9a3'] },
  { id: 'violet', name: 'Violet', a: '#a855f7', b: '#22d3ee', palette: ['#a855f7', '#22d3ee', '#f0abfc', '#6d28d9'] },
  { id: 'dusk',   name: 'Dusk',   a: '#3b2f6b', b: '#ff8fab', palette: ['#5b4b9e', '#ff8fab', '#2a2350', '#ffc3d4'] },
  { id: 'mint',   name: 'Mint',   a: '#5eead4', b: '#fef3c7', palette: ['#5eead4', '#fef3c7', '#2dd4bf', '#ecfeff'] },
  { id: 'ember',  name: 'Ember',  a: '#ff6b1a', b: '#2b0a00', palette: ['#ff6b1a', '#ffae5c', '#8c2a00', '#ffd7a8'] },
  { id: 'cyber',  name: 'Cyber',  a: '#00ffd0', b: '#ff0090', palette: ['#00ffd0', '#ff0090', '#7b2fff', '#00b3ff'] },
  { id: 'pastel', name: 'Pastel', a: '#ffd1dc', b: '#bde0fe', palette: ['#ffd1dc', '#bde0fe', '#d8f3dc', '#ffe5b4'] },
];
export const vibeById = (id) => VIBES.find((v) => v.id === id) ?? VIBES[0];

// The rig's movement patterns a show style can force onto every cue. 'auto'
// leaves each look's own choice alone.
export const MOTIONS = [
  ['auto', 'Auto'], ['park', 'Still'], ['sweep', 'Sweep'], ['fan', 'Fan'],
  ['ballyhoo', 'Circles'], ['crossbeams', 'Cross'], ['tiltwave', 'Tilt wave'],
];
// Layers are stored, shipped in .arenashow files and seeded from presets, all
// of which predate the tenth pad. Every path that takes a layer from outside
// runs it through here, so an old nine-pad layer grows a spare slot instead of
// leaving holes the grid would render past the end of.
const fitLayer = (L) => {
  const out = new Array(PADS).fill(null);
  if (Array.isArray(L)) for (let i = 0; i < Math.min(L.length, PADS); i++) out[i] = L[i] ?? null;
  return out;
};
const fitLayers = (ls) => (Array.isArray(ls) ? ls.map(fitLayer) : []);
const STORE = 'arena-pads-v2';
const STORE_V1 = 'arena-pads-v1';
export const MAX_LAYERS = 9;
// one colour per layer — pads, chips and timeline stamps all speak it
export const LAYER_COLORS = [
  '#d9b260', '#5aa0e6', '#e06fae', '#62c489', '#9a7fe0',
  '#4ac4c4', '#e0854a', '#d96a6a', '#a9b7d0',
];

const hex = (c) => '#' + c.getHexString();

export function initPads({ rigFX, orbFX, fasciaFX, bstageFX, crowdFX, venue, director, showfx, consoleUI = null, show = null }) {

  // --- snapshot / recall ------------------------------------------------------
  function capture() {
    return {
      rig: {
        look: rigFX.look, behaviour: rigFX.behaviour,
        lasersOn: rigFX.lasersOn, uv: rigFX.uv,
        strobeOn: rigFX.strobeOn, blindersOn: rigFX.blindersOn,
        master: rigFX.master, haze: rigFX.haze, beamBudget: rigFX.beamBudget,
        laserPer: rigFX.laserPer, laserSweep: rigFX.laserSweep,
        laserColorMode: rigFX.laserColorMode, laserRing: rigFX.laserRing,
        laserWidth: rigFX.laserMat.uniforms.uWidthPx.value,
        colorA: hex(rigFX.colorA), colorB: hex(rigFX.colorB),
        gain: { ...rigFX.gain },
      },
      orbs: {
        mode: orbFX.mode, speed: orbFX.speed, brightness: orbFX.brightness,
        animMode: orbFX.animMode, animStrength: orbFX.animStrength, animSpeed: orbFX.animSpeed,
        colorA: hex(orbFX.colorA), colorB: hex(orbFX.colorB),
        palette: orbFX.palette.map(hex),
      },
      fascia: {
        mode: fasciaFX.mode, speed: fasciaFX.speed,
        colorA: hex(fasciaFX.colorA), colorB: hex(fasciaFX.colorB),
      },
      bstage: {
        screenMode: bstageFX.screenMode, ringMode: bstageFX.ringMode,
        brightness: bstageFX.brightness, speed: bstageFX.speed,
        colorA: hex(bstageFX.colorA), colorB: hex(bstageFX.colorB),
        ringColor: bstageFX.ringColor ? hex(bstageFX.ringColor) : null,
        catMode: bstageFX.catMode, catColor: hex(bstageFX.catColor),
      },
      crowd: {
        mode: crowdFX.mode, speed: crowdFX.speed,
        level: crowdFX.level, scale: crowdFX.scale,
      },
      showfx: showfx ? showfx.capture() : undefined,
      // the wristband show itself (GRID, WASH, IR or painted zones), while one
      // is playing: without it a pad brought back the mode and not the show
      show: show && orbFX.mode === 'design' ? show.snapshot() : null,
    };
  }

  // `allow` omitted = write everything, which is what a project load, a cue
  // recall and the VR mirror all want. The deck passes the master switches.
  // `params` is what a CUE adds to a look at fire time — its section's colour,
  // the style's energy and motion — so one stored look can serve a cold verse
  // and a hot chorus without a pad per variant.
  // `only`: the parts a trigger takes over (['orbs']: just the wristbands and
  // the moving heads); the rest of the room stays exactly as the trigger
  // before left it. Omitted, it writes everything, as every trigger always has.
  function apply(s, allow = null, params = null, only = null) {
    const on = (k) => !allow || allow[k] !== false;
    const P = params || {};
    if (only && only.length) {
      if (only.includes('orbs')) {
        if (!on('orbs')) orbFX.set({ mode: 'off' });
        else if (show && s.show) { orbFX.set({ mode: 'design' }); show.restore(s.show); }
        else orbFX.set({ mode: s.orbs.mode, speed: s.orbs.speed, brightness: s.orbs.brightness, colorA: new THREE.Color(s.orbs.colorA), colorB: new THREE.Color(s.orbs.colorB) });
      }
      if (only.includes('crowd') && !s.show) crowdFX.set({ ...s.crowd, mode: !on('crowd') ? 'off' : 'idle' });
      if (only.includes('fx') && on('fx') && showfx && s.showfx) showfx.apply({ ...s.showfx });
      syncConsole(capture());
      return;
    }

    if (!on('rig')) {
      rigFX.cue('blackout');
      rigFX.set({ master: 0, lasersOn: false, uv: false, strobeOn: false, blindersOn: false });
      fasciaFX.set({ mode: 'off' });
      bstageFX.set({ screenMode: s.bstage.screenMode, ringMode: 'off', catMode: 'off', brightness: 0 });
    }
    // The crowd's animation is decided HERE, not baked into the preset, so that
    // switching the orbs off drops the figures from hands-up back to idle:
    // arms in the air with no wristband lit reads as a mistake.
    const orbsLit = on('orbs') && s.orbs.mode !== 'off';
    // a pad that keeps a wristband show (the SHOW panel's triggers) leaves the
    // people as the panel's pixel setting has them: it brings back an effect,
    // not who is in the room
    if (!s.show) crowdFX.set({ ...s.crowd, mode: !on('crowd') ? 'off' : orbsLit ? 'handsup' : 'idle' });
    if (!on('orbs')) orbFX.set({ mode: 'off' });
    else if (show && s.show) { orbFX.set({ mode: 'design' }); show.restore(s.show); }
    if (!on('rig')) { syncConsole(s); return; }
    // cue() first: it owns the per-fixture dimmers and RESETS lasers/uv/strobe/
    // blinders, so every captured override must land after it
    // colour: the cue's own section colour wins, then the vibe, then the look
    const cA = P.col?.a ?? vibe.a ?? s.rig.colorA, cB = P.col?.b ?? vibe.b ?? s.rig.colorB;
    rigFX.cue(s.rig.look);
    rigFX.set({
      // the level comes back with the look: a muted trigger sets the master to
      // 0, and nothing brought it back up, so every look after it stayed dark
      master: s.rig.master ?? 1,
      behaviour: P.motion || s.rig.behaviour,
      lasersOn: allowedFx.lasers && s.rig.lasersOn, uv: s.rig.uv,
      strobeOn: allowedFx.strobe && s.rig.strobeOn, blindersOn: allowedFx.blinders && s.rig.blindersOn,
      haze: s.rig.haze, beamBudget: s.rig.beamBudget,
      laserPer: s.rig.laserPer, laserSweep: s.rig.laserSweep,
      laserColorMode: s.rig.laserColorMode, laserRing: s.rig.laserRing,
      colorA: new THREE.Color(cA), colorB: new THREE.Color(cB),
    });
    Object.assign(rigFX.gain, s.rig.gain);   // mutate in place: hot loop keeps its object
    rigFX.laserMat.uniforms.uWidthPx.value = s.rig.laserWidth;

    // animMode 0 ("still") is promoted to 1 ("handheld"). Every preset was
    // materialised while 0 was the engine default, so a stored 0 means
    // "nobody chose" rather than "hold perfectly still" — and a static field
    // of wristbands looks like the render froze. The console can still set
    // Still by hand; it holds until the next pad fires, same as every other
    // pad-driven value.
    if (on('orbs')) orbFX.set({
      mode: s.orbs.mode, speed: s.orbs.speed, brightness: s.orbs.brightness,
      animMode: Math.min(1, s.orbs.animMode || 1), animStrength: s.orbs.animStrength, animSpeed: s.orbs.animSpeed,
      colorA: new THREE.Color(cA), colorB: new THREE.Color(cB),
    });
    if (on('orbs') && (P.col?.palette || vibe.palette || s.orbs.palette)) orbFX.setPalette(P.col?.palette ?? vibe.palette ?? s.orbs.palette);
    fasciaFX.set({
      mode: s.fascia.mode, speed: s.fascia.speed,
      colorA: new THREE.Color(cA), colorB: new THREE.Color(cB),
    });
    bstageFX.set({
      screenMode: s.bstage.screenMode, ringMode: s.bstage.ringMode,
      brightness: s.bstage.brightness, speed: s.bstage.speed,
      colorA: new THREE.Color(s.bstage.colorA), colorB: new THREE.Color(s.bstage.colorB),
      ringColor: s.bstage.ringColor ? new THREE.Color(s.bstage.ringColor) : null,
      catMode: s.bstage.catMode || 'solid',
      catColor: new THREE.Color(s.bstage.catColor || '#ff2412'),
    });
    if (on('fx') && showfx && s.showfx) {
      // the allow mask reaches the one-shots too: a disallowed pyro or confetti
      // simply is not there when the look lands
      const fx = { ...s.showfx };
      if (!allowedFx.pyro) { fx.pyro = false; fx.flames = false; }
      if (!allowedFx.confetti) fx.confettiAmt = 0;
      showfx.apply(fx);
    }
    syncConsole(s);
  }

  // Reflect the recalled look in the console's buttons/sliders so the panel
  // never lies about what is on stage.
  function syncConsole(s) {
    const act = (sel, val) => document.querySelectorAll(sel).forEach((b) => {
      b.classList.toggle('active', String(b.dataset[Object.keys(b.dataset)[0]]) === String(val));
    });
    act('[data-cue]', s.rig.look);
    act('[data-move]', s.rig.behaviour);
    act('[data-orb]', s.orbs.mode);
    act('[data-anim]', s.orbs.animMode);
    act('[data-fascia]', s.fascia.mode);
    act('[data-bscreen]', s.bstage.screenMode);
    act('[data-bring]', s.bstage.ringMode);
    act('[data-catring]', s.bstage.catMode || 'solid');
    act('[data-ofx]', s.orbs.mode);
    if (s.orbs.palette) {
      const chosen = new Set(s.orbs.palette.map((x) => x.toLowerCase()));
      document.querySelectorAll('[data-oswatch]').forEach((b) => {
        b.classList.toggle('active', chosen.has(b.dataset.oswatch.toLowerCase()));
      });
    }
    act('[data-people]', s.crowd.mode);
    act('[data-light]', s.lighting);
    act('[data-lcol]', s.rig.laserColorMode);
    act('[data-lring]', s.rig.laserRing);
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v); };
    setVal('rigA', s.rig.colorA); setVal('rigB', s.rig.colorB);
    setVal('rigMaster', s.rig.master); setVal('rigHaze', s.rig.haze); setVal('rigBeams', s.rig.beamBudget);
    setVal('laserPer', s.rig.laserPer); setVal('laserSweep', s.rig.laserSweep); setVal('laserWidth', s.rig.laserWidth);
    setVal('gainLaser', s.rig.gain.laser); setVal('gainLaser2', s.rig.gain.laser);
    for (const [k, id] of [['spot','gainSpot'],['wash','gainWash'],['beam','gainBeam'],['strip','gainStrip'],['strobe','gainStrobe'],['blinder','gainBlinder'],['uv','gainUv']]) {
      setVal(id, s.rig.gain[k]);
    }
    setVal('orbA', s.orbs.colorA); setVal('orbB', s.orbs.colorB);
    setVal('orbSpeed', s.orbs.speed); setVal('orbBright', s.orbs.brightness);
    setVal('animStrength', s.orbs.animStrength); setVal('animSpeed', s.orbs.animSpeed);
    setVal('fasciaA', s.fascia.colorA); setVal('fasciaB', s.fascia.colorB); setVal('fasciaSpeed', s.fascia.speed);
    setVal('bsColor', s.bstage.colorA); setVal('bsLevel', s.bstage.brightness); setVal('bsSpeed', s.bstage.speed);
    setVal('bringColor', s.bstage.ringColor || s.bstage.colorA); setVal('catColor', s.bstage.catColor || '#ff2412');
    setVal('peopleSpeed', s.crowd.speed); setVal('peopleLevel', s.crowd.level); setVal('peopleScale', s.crowd.scale);
  }

  // A short human name so the pad tells you what it holds at a glance.
  const lookName = (s) =>
    (s.show && show ? show.describe(s.show) : `${s.rig.look} · ${s.orbs.mode}`).toUpperCase();

  // --- storage ----------------------------------------------------------------
  // bank.layers[layer][pad] — each layer is its own set of ten 1–0 triggers.
  let bank = { active: 0, layers: [new Array(PADS).fill(null)] };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (saved?.layers?.length) bank = { ...saved, layers: fitLayers(saved.layers) };
    else {
      // migrate the single-layer v1 bank into layer 1
      const v1 = JSON.parse(localStorage.getItem(STORE_V1));
      if (Array.isArray(v1) && v1.length) bank.layers[0] = fitLayer(v1);
    }
  } catch (_) { /* corrupt store: start clean */ }
  bank.active = Math.min(bank.active, bank.layers.length - 1);
  // A brand-new install opens on ten EMPTY pads and one layer, which looks
  // broken and gives nothing to react to. Seed the belt from the preset
  // library instead — but ONLY when there was no saved bank at all, so a
  // returning user's work is never overwritten.
  let needsSeed = false;
  try { needsSeed = !localStorage.getItem(STORE) && !localStorage.getItem(STORE_V1); } catch (_) { /* private mode */ }
  const pads = () => bank.layers[bank.active];
  // --- master switches ----------------------------------------------------------
  // Four things a trigger can drive, each with a hard on/off the user owns. A
  // preset stops being all-or-nothing: fire a chorus and then drop the crowd,
  // or keep the rig and kill the wristbands. OFF is not "skip writing" — it
  // actively silences that subsystem, or turning it off would leave whatever
  // the last look happened to set.
  const SW_STORE = 'arena-subsys-v1';
  let sw = { rig: true, orbs: true, crowd: true, fx: true };
  try { Object.assign(sw, JSON.parse(localStorage.getItem(SW_STORE)) || {}); } catch (_) { /* private mode */ }
  const VIBE_STORE = 'arena-vibe-v1';
  let vibe = VIBES[0];
  try { vibe = vibeById(localStorage.getItem(VIBE_STORE) || 'natural'); } catch (_) { /* private mode */ }
  let lastFired = null;      // {layer, i} — re-applied when a switch flips
  let lastWrites = null;     // Set of subsystems the last fired pad writes
  // The room as it stood the instant the pad landed — NOT the pad's stored
  // state. The two differ legitimately: a vibe rewrites colours, a master
  // switch silences a subsystem. Diffing live against this is the only way to
  // tell "the user changed something" from "the app did what it was told".
  let lastApplied = null;
  // Effects the show is allowed to use at all. Enforced HERE, at fire time,
  // rather than by filtering recipes: "no lasers" then holds for every cue,
  // hand-fired pads included, and flips live without a rebuild.
  const ALLOW_STORE = 'arena-allow-v1';
  let allowedFx = { lasers: true, strobe: true, blinders: true, pyro: true, confetti: true };
  try { Object.assign(allowedFx, JSON.parse(localStorage.getItem(ALLOW_STORE)) || {}); } catch (_) { /* private mode */ }

  const api = {};   // filled at the bottom; persist() pings api.onChange
  const persist = () => {
    localStorage.setItem(STORE, JSON.stringify(bank));
    api.onChange?.();
  };

  // --- Record: save what is on now onto the next trigger you pick ----------------
  // Like the RECORD key on a lighting desk: arm it, then click a trigger (or
  // press its number) and the look on stage, wristband show and all, is saved
  // there, empty or not. Esc, or pressing Record again, stands it down. The
  // SHOW panel's Record button arms this same state (api.setRecord).
  let recArmed = false;
  function setRecord(on) {
    recArmed = !!on;
    document.body.classList.toggle('padRec', recArmed);
    recBtn?.classList.toggle('on', recArmed);
    api.onRecord?.(recArmed);
  }
  const recBtn = (() => {
    const wrap = document.getElementById('dirPadsWrap');
    if (!wrap) return null;
    const b = document.createElement('button');
    b.id = 'padRecBtn';
    b.innerHTML = '<i></i><span>REC</span>';
    b.title = 'Record: press, then click a trigger (or press its number) to save the look that is on now onto it';
    b.addEventListener('click', (e) => { e.stopPropagation(); setRecord(!recArmed); });
    wrap.insertBefore(b, document.getElementById('dirPads'));
    return b;
  })();
  // a pick while armed: save there, stand down, say so
  function recordInto(i) {
    assign(i);
    setRecord(false);
    hint(`Saved on trigger ${LABELS[i]}`);
  }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && recArmed) setRecord(false); });

  // --- UI -----------------------------------------------------------------------
  const row = document.getElementById('dirPads');
  const els = LABELS.map((label, i) => {
    const pad = document.createElement('div');
    pad.className = 'pad';
    pad.innerHTML = `
      <span class="padKey">${label}</span>
      <span class="padName"></span>
      <span class="padSet" title="Store the current look on ${label}">SET</span>
      <span class="padClear" title="Clear">✕</span>`;
    row.appendChild(pad);

    pad.dataset.i = i;                              // drop target for the rail
    pad.querySelector('.padSet').addEventListener('click', (e) => {
      e.stopPropagation(); assign(i);
    });
    pad.querySelector('.padClear').addEventListener('click', (e) => {
      e.stopPropagation();
      pads()[i] = null; persist(); paint();
    });
    pad.addEventListener('click', () => {
      if (dragMoved) return;                       // a drop is not a press
      if (recArmed) { recordInto(i); return; }     // Record is armed: this is where it goes
      fire(i);
    });
    return pad;
  });

  // console strip: the same ten pads as clickable chips under the console
  // tabs, so a look can be stored the moment it is dialled in — no deck trip
  const strip = document.getElementById('padStripKeys');
  const chips = LABELS.map((label, i) => {
    const chip = document.createElement('span');
    chip.className = 'psKey';
    chip.textContent = label;
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      assign(i);
      chip.classList.remove('stored');
      void chip.offsetWidth;
      chip.classList.add('stored');
    });
    strip.appendChild(chip);
    return chip;
  });

  // --- master switch strip ------------------------------------------------------
  // Sits with the pads, because it belongs to the thing you just fired. A
  // switch the current trigger does not write is DISABLED rather than merely
  // inert: a button that visibly does nothing is worse than no button.
  const swEl = document.getElementById('dirSwitches');
  const swBtns = {};
  function paintSwitches() {
    if (!swEl) return;
    if (!swEl.children.length) {
      for (const k of SUBSYS_KEYS) {
        const b = document.createElement('button');
        b.className = 'dirSw';
        b.dataset.sub = k;
        b.textContent = SUBSYS_LABEL[k];
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (b.classList.contains('dim')) return;
          sw[k] = !sw[k];
          try { localStorage.setItem(SW_STORE, JSON.stringify(sw)); } catch (_) { /* private mode */ }
          if (lastFired) fireAt(lastFired.layer, lastFired.i, { stamp: false });
          else paintSwitches();
        });
        swEl.appendChild(b);
        swBtns[k] = b;
      }
    }
    for (const k of SUBSYS_KEYS) {
      const b = swBtns[k];
      const used = !lastWrites || lastWrites.has(k);
      b.classList.toggle('on', !!sw[k]);
      b.classList.toggle('dim', !used);
      b.title = !used
        ? `${SUBSYS_LABEL[k]} — this trigger does not touch it`
        : sw[k] ? `${SUBSYS_LABEL[k]} is on — click to mute it` : `${SUBSYS_LABEL[k]} is muted — click to bring it back`;
    }
  }

  // layer switcher: numbered colour dots to the left of the pads. Click to
  // switch which set of nine the keys play; + adds the next empty set.
  // Fixed-footprint cycler: one chip showing the active layer, arrows to step
  // through the rest. Adding a seventh layer costs no pixels.
  const layersEl = document.getElementById('dirLayers');
  function paintLayers() {
    layersEl.innerHTML = '';
    const n = bank.layers.length;
    const el = (cls, txt, title, fn) => {
      const e = document.createElement('span');
      e.className = cls; e.textContent = txt; e.title = title;
      e.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
      layersEl.appendChild(e);
      return e;
    };
    el('layerArrow', '▲', 'Previous layer', () => setLayer((bank.active - 1 + n) % n));
    const chip = el('layerChip active', String(bank.active + 1),
      `Layer ${bank.active + 1} of ${n} — its own set of 1–0 triggers`, () => {});
    chip.style.setProperty('--lc', LAYER_COLORS[bank.active]);
    el('layerArrow', '▼', 'Next layer', () => setLayer((bank.active + 1) % n));
    if (n < MAX_LAYERS) {
      el('layerChip add', '+', 'Add a layer', () => {
        bank.layers.push(new Array(PADS).fill(null));
        setLayer(bank.layers.length - 1);
      });
    }
    el('layerChip view', '⊞', 'View all layers', () => toggleView());
    el('layerChip view', '◈', 'Preset banks — ready-made sets of nine triggers', () => toggleRail());
    // Settings moved to the transport row: it is app chrome, not a layer
    // control, and the belt now hides behind ADJUST — which would have taken
    // the audio settings with it.
    const tag = document.getElementById('psLayerTag');
    if (tag) {
      tag.textContent = 'L' + (bank.active + 1);
      tag.style.color = LAYER_COLORS[bank.active];
    }
  }
  function setLayer(li) {
    bank.active = li;
    persist();
    paint();
    if (railOpen) paintRail();     // the USE button names the target layer
  }

  function paint() {
    paintLayers();
    const lc = LAYER_COLORS[bank.active];
    els.forEach((el, i) => {
      const p = pads()[i];
      el.classList.toggle('empty', !p);
      el.style.setProperty('--lc', lc);
      el.querySelector('.padName').textContent = p ? p.name : 'EMPTY';
      el.title = p ? `${p.name} \u2014 click or press ${LABELS[i]} to fire it; drag it onto the timeline to place it`
                   : `Empty \u2014 press Shift+${LABELS[i]} to store the current look here`;
      el.classList.remove('live');
    });
    chips.forEach((chip, i) => {
      const p = pads()[i];
      chip.classList.toggle('full', !!p);
      chip.title = p ? `Overwrite ${LABELS[i]} on layer ${bank.active + 1} — now: ${p.name}`
                     : `Store current look on ${LABELS[i]} (layer ${bank.active + 1})`;
    });
  }

  // --- all-layers overview + reset ------------------------------------------
  // One panel showing every layer's nine slots. Click a filled cell to jump to
  // that layer and fire the look. RESET ALL lives here — you see everything
  // you are about to erase — behind an explicit warning.
  const viewEl = document.getElementById('layerView');
  const gridEl = document.getElementById('lvGrid');
  const confirmEl = document.getElementById('lvConfirm');
  let viewOpen = false;

  function buildGrid() {
    gridEl.innerHTML = '';
    // header row: the key letters
    const head = document.createElement('div');
    head.className = 'lvRow lvHeadRow';
    head.innerHTML = '<span class="lvChip"></span>' +
      LABELS.map((l) => `<span class="lvCell lvKey">${l}</span>`).join('');
    gridEl.appendChild(head);
    bank.layers.forEach((layer, li) => {
      const row = document.createElement('div');
      row.className = 'lvRow' + (li === bank.active ? ' active' : '');
      const chip = document.createElement('span');
      chip.className = 'lvChip';
      chip.textContent = li + 1;
      chip.style.setProperty('--lc', LAYER_COLORS[li]);
      row.appendChild(chip);
      layer.forEach((p, i) => {
        const cell = document.createElement('span');
        cell.className = 'lvCell' + (p ? '' : ' empty');
        cell.dataset.l = li; cell.dataset.i = i;      // drag/drop identity
        cell.textContent = p ? p.name : '—';
        cell.title = p
          ? `${p.name} — click to switch to layer ${li + 1} and play it`
          : `Empty (layer ${li + 1}, key ${LABELS[i]})`;
        if (p) {
          cell.style.setProperty('--lc', LAYER_COLORS[li]);
          cell.addEventListener('click', (e) => {
            e.stopPropagation();
            if (dragMoved) return;          // that was a drag, not a click
            setLayer(li);
            fireAt(li, i);
            buildGrid();
          });
        }
        row.appendChild(cell);
      });
      gridEl.appendChild(row);
    });
  }

  // --- preset rail --------------------------------------------------------------
  // The bank library used to be a tab inside the wide all-layers panel, which
  // sat across the middle of the screen and hid the very effect you were
  // previewing. It is now a narrow rail down the left, and it is DRILLED: pick
  // a category, pick a bank, then see that bank's nine triggers — never 28
  // banks at once. The arena stays visible the whole time.
  //
  // A bank's states are built LAZILY on first use: materialise() drives the
  // console macros, which moves the live rig, so doing all 28 at boot would be
  // both slow and visible. Built banks are cached for the session.
  const railEl = document.getElementById('presetRail');
  const prCats = document.getElementById('prCats');
  const prBody = document.getElementById('prBody');
  const prTitle = document.getElementById('prTitle');
  const prBack = document.getElementById('prBack');
  const prHint = document.getElementById('prHint');
  let railOpen = false;
  let railCat = CATEGORIES[0].key;
  let railBank = null;              // null = the bank list, else a preset id
  const builtCache = new Map();

  // by value: a loaded layer must never share objects with the library cache,
  // or editing one pad would silently rewrite the preset for the session
  const copyBank = (arr) => arr.map((p) => (p ? JSON.parse(JSON.stringify(p)) : null));

  function build(preset) {
    if (builtCache.has(preset.id)) return builtCache.get(preset.id);
    if (!consoleUI?.runPreset) return new Array(PADS).fill(null);
    // the shipped banks curate nine looks; the tenth pad is left for whatever
    // the user dials in themselves, so every layer arrives with a free slot
    const out = fitLayer(materialise(preset, { runPreset: consoleUI.runPreset, capture, apply }));
    builtCache.set(preset.id, out);
    return out;
  }

  function toggleRail(force) {
    railOpen = force !== undefined ? force : !railOpen;
    railEl.classList.toggle('hidden', !railOpen);
    if (railOpen) paintRail();
  }

  function paintRail() {
    // One level. Category chips filter; every bank is a row; the open bank
    // unfolds IN PLACE with its triggers under it. The old rail navigated to a
    // second page per bank and back again — three steps to reach one look, and
    // you lost sight of the other banks while you were there.
    prBack.classList.add('hidden');
    prCats.classList.remove('hidden');
    prTitle.textContent = 'Preset banks';
    prHint.classList.toggle('hidden', !railBank);
    prCats.innerHTML = '';
    for (const c of CATEGORIES) {
      const b = document.createElement('button');
      b.className = 'prCat' + (c.key === railCat ? ' active' : '');
      b.textContent = c.name;
      b.title = `${LAYER_PRESETS.filter((p) => p.category === c.key).length} banks`;
      b.addEventListener('click', (e) => { e.stopPropagation(); railCat = c.key; railBank = null; paintRail(); });
      prCats.appendChild(b);
    }
    prBody.innerHTML = '';
    for (const preset of LAYER_PRESETS.filter((p) => p.category === railCat)) {
      const open = railBank === preset.id;
      const row = document.createElement('button');
      row.className = 'prBank' + (open ? ' open' : '');
      row.innerHTML = '<span class="prBankName"></span><span class="prBankGo">\u203a</span>';
      row.querySelector('.prBankName').textContent = preset.name;
      row.title = preset.blurb;
      row.addEventListener('click', (e) => { e.stopPropagation(); railBank = open ? null : preset.id; paintRail(); });
      prBody.appendChild(row);
      if (!open) continue;

      const fold = document.createElement('div');
      fold.className = 'prFold';
      const blurb = document.createElement('div');
      blurb.className = 'prBlurb';
      blurb.textContent = preset.blurb;
      fold.appendChild(blurb);

      const acts = document.createElement('div');
      acts.id = 'prActions';
      const use = document.createElement('button');
      use.className = 'use';
      use.textContent = `USE ON L${bank.active + 1}`;
      use.title = `Replace layer ${bank.active + 1} with this bank`;
      use.addEventListener('click', (e) => {
        e.stopPropagation();
        bank.layers[bank.active] = copyBank(build(preset));
        persist(); paint(); if (viewOpen) buildGrid();
        hint(`Layer ${bank.active + 1} is now ${preset.name}`);
      });
      const add = document.createElement('button');
      const full = bank.layers.length >= MAX_LAYERS;
      add.textContent = full ? 'BELT FULL' : '+ ADD LAYER';
      add.disabled = full;
      add.title = full
        ? `All ${MAX_LAYERS} layers are in use \u2014 switch to one and press USE to replace it`
        : 'Add this bank as a new layer on the belt';
      if (!full) add.addEventListener('click', (e) => {
        e.stopPropagation();
        bank.layers.push(copyBank(build(preset)));
        setLayer(bank.layers.length - 1);
        if (viewOpen) buildGrid();
        paintRail();
      });
      acts.appendChild(use); acts.appendChild(add);
      fold.appendChild(acts);

      preset.pads.forEach((t, i) => {
        if (!t) return;
        const trig = document.createElement('div');
        trig.className = 'prTrig';
        trig.dataset.pid = preset.id; trig.dataset.i = i;      // drag identity
        trig.innerHTML = '<span class="prTrigKey"></span><span class="prTrigName"></span>';
        trig.querySelector('.prTrigKey').textContent = LABELS[i];
        trig.querySelector('.prTrigName').textContent = t.n;
        trig.title = `${t.n} \u2014 click to try it now, or drag it onto the timeline or a pad`;
        trig.addEventListener('click', (e) => {
          e.stopPropagation();
          if (dragMoved) return;                              // that was a drag
          const st = build(preset)[i];
          if (st?.state) apply(st.state);                     // preview, stores nothing
        });
        fold.appendChild(trig);
      });
      prBody.appendChild(fold);
      // the open bank should be in view, not somewhere below the fold
      requestAnimationFrame(() => row.scrollIntoView({ block: 'nearest' }));
    }
  }
  document.getElementById('prClose').addEventListener('click', (e) => { e.stopPropagation(); toggleRail(false); });
  // The rail lives outside #director (it must anchor to the viewport, and the
  // director carries a transform), so closing the deck has to take it along.
  document.getElementById('directorBtn')?.addEventListener('click', () => {
    if (document.getElementById('director').classList.contains('hidden')) toggleRail(false);
  });
  prBack.addEventListener('click', (e) => { e.stopPropagation(); railBank = null; paintRail(); });

  // --- drag and drop ------------------------------------------------------------
  // Pointer events, not HTML5 drag-and-drop: this app is a WebGL canvas with
  // fixed overlays, and the native API's drag images and dragover semantics
  // fight both. Delegated on document so rebuilding the grid or the rail never
  // has to re-bind anything.
  //
  // Sources: a filled cell in the all-layers grid (move, or swap when the
  // target is taken; hold Alt to copy) and a trigger row in the preset rail
  // (always a copy). Targets: any grid cell, and any pad in the deck row —
  // the deck is always on screen, so a preset can be dropped straight onto a
  // key without opening the grid at all.
  const DRAG_SLOP = 4;
  let dragFrom = null, dragGhost = null, dragMoved = false, dragTarget = null, dragStart = null;

  const srcOf = (el) => {
    // SET and the clear cross sit ON a pad but are buttons, not handles
    if (el.closest?.('.padSet, .padClear')) return null;
    // a deck pad drags like an all-layers cell: onto the timeline to place its
    // cue at the drop time (no recording involved), onto another pad to move it
    const pad = el.closest?.('#dirPads .pad[data-i]');
    if (pad) {
      const i = +pad.dataset.i, p = pads()[i];
      return p ? { kind: 'bank', layer: bank.active, i, el: pad, name: p.name } : null;
    }
    const cell = el.closest?.('.lvCell[data-l]');
    if (cell && !cell.classList.contains('empty')) {
      return { kind: 'bank', layer: +cell.dataset.l, i: +cell.dataset.i, el: cell, name: cell.textContent };
    }
    const trig = el.closest?.('.prTrig[data-pid]');
    if (trig) return { kind: 'preset', pid: trig.dataset.pid, i: +trig.dataset.i, el: trig, name: trig.querySelector('.prTrigName').textContent };
    return null;
  };
  const targetAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const cell = el.closest?.('.lvCell[data-l]');
    if (cell) return { layer: +cell.dataset.l, i: +cell.dataset.i, el: cell };
    const pad = el.closest?.('#dirPads .pad[data-i]');
    if (pad) return { layer: bank.active, i: +pad.dataset.i, el: pad };
    // The timeline takes drops too — but only with a track under it, or the
    // lane would light up promising a stamp addStampAt has to refuse.
    const lane = el.closest?.('#dirWave');
    if (lane && director.engine?.buffer) return { kind: 'timeline', el: lane, x };
    return null;
  };
  // A pad already holding this exact preset trigger. Repeat drops of one look
  // then share a single pad — and because the belt is seeded from these very
  // presets, a drop usually finds its pad already sitting there and costs
  // nothing. Without this the belt runs out after a handful of drops.
  function heldSlot(pid, name) {
    for (const [l, L] of bank.layers.entries()) {
      const i = L.findIndex((p) => p && p.from === pid && p.name === name);
      if (i >= 0) return [l, i];
    }
    return null;
  }
  // Nowhere to reuse: prefer a free pad on the layer being worked on, then any
  // other, then grow the belt — refusing the drop is the last resort.
  function freeSlot() {
    const order = [...new Set([bank.active, ...bank.layers.keys()])];
    for (const l of order) {
      const i = bank.layers[l].findIndex((p) => !p);
      if (i >= 0) return [l, i];
    }
    if (bank.layers.length < MAX_LAYERS) {
      bank.layers.push(new Array(PADS).fill(null));
      return [bank.layers.length - 1, 0];
    }
    return null;
  }
  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  // Find or place a pad holding one preset trigger, and say where it landed.
  // A stamp is only a reference to { layer, pad }, so anything that schedules a
  // preset — a drop on the lane, the director's auto-build — needs this first.
  function padForPreset(pid, i) {
    const preset = presetById(pid);
    const st = preset && build(preset)[i];
    if (!st) return null;
    const held = heldSlot(pid, st.name);
    if (held) return held;
    const slot = freeSlot();
    if (!slot) return null;
    bank.layers[slot[0]][slot[1]] = JSON.parse(JSON.stringify(st));
    persist(); paint();
    if (viewOpen) buildGrid();
    return slot;
  }

  const clearTarget = () => {
    if (dragTarget) dragTarget.el.classList.remove('dropOk', 'dropSwap', 'dropTime');
    dragTarget = null;
  };
  function endDrag(commit) {
    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
    if (dragFrom) dragFrom.el.classList.remove('dragSrc');
    document.body.classList.remove('dragging');
    const from = dragFrom, to = dragTarget;
    clearTarget();
    dragFrom = null; dragStart = null;
    if (!commit || !from || !to) { setTimeout(() => { dragMoved = false; }, 0); return; }
    if (from.kind === 'bank' && from.layer === to.layer && from.i === to.i) { setTimeout(() => { dragMoved = false; }, 0); return; }

    // Dropping on the lane SCHEDULES the look rather than storing it. The pad it
    // points at has to survive either way: Alt has nothing to copy here and a
    // plain drag has nothing to vacate, or the stamp would aim at an empty pad.
    if (to.kind === 'timeline') {
      let { layer, i, name } = from;
      if (from.kind === 'preset') {
        const slot = padForPreset(from.pid, from.i);
        if (!slot) {
          hint(`Every pad on all ${MAX_LAYERS} layers is taken — free one, or drop this on a pad to replace it`);
          setTimeout(() => { dragMoved = false; }, 0);
          return;
        }
        [layer, i] = slot;
      }
      const raw = director.timeAtClientX?.(to.x) ?? 0;
      const m = director.addStampAt?.(director.snapTime?.(raw) ?? raw, layer, i);
      if (m) {
        hint(`${(name || LABELS[i]).toUpperCase()} at ${mmss(m.t)} \u00b7 pad ${LABELS[i]}, layer ${layer + 1}`);
        const settled = viewOpen
          ? document.querySelector(`.lvCell[data-l="${layer}"][data-i="${i}"]`)
          : document.querySelector(`#dirPads .pad[data-i="${i}"]`);
        if (settled) { settled.classList.add('dropSettle'); setTimeout(() => settled.classList.remove('dropSettle'), 160); }
      }
      setTimeout(() => { dragMoved = false; }, 0);
      return;
    }

    if (from.kind === 'preset') {
      const st = build(presetById(from.pid))[from.i];
      if (st) bank.layers[to.layer][to.i] = JSON.parse(JSON.stringify(st));
    } else {
      const moving = bank.layers[from.layer][from.i];
      const displaced = bank.layers[to.layer][to.i];
      // a copy has to be a real copy: handing both slots the same object made
      // editing one of them silently rewrite the other
      bank.layers[to.layer][to.i] = from.copy ? JSON.parse(JSON.stringify(moving)) : moving;
      // a move vacates its slot; Alt copies, so the source stays put. An
      // occupied target SWAPS rather than being silently overwritten.
      if (!from.copy) bank.layers[from.layer][from.i] = displaced ?? null;
    }
    persist(); paint();
    if (viewOpen) buildGrid();
    const settled = viewOpen
      ? document.querySelector(`.lvCell[data-l="${to.layer}"][data-i="${to.i}"]`)
      : document.querySelector(`#dirPads .pad[data-i="${to.i}"]`);
    if (settled) { settled.classList.add('dropSettle'); setTimeout(() => settled.classList.remove('dropSettle'), 160); }
    setTimeout(() => { dragMoved = false; }, 0);
  }

  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const src = srcOf(e.target);
    if (!src) return;
    dragFrom = src; dragStart = { x: e.clientX, y: e.clientY }; dragMoved = false;
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (!dragFrom || !dragStart) return;
    if (!dragMoved) {
      if (Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) < DRAG_SLOP) return;
      dragMoved = true;                                  // past the slop: it is a drag
      dragFrom.el.classList.add('dragSrc');
      document.body.classList.add('dragging');
      dragGhost = document.createElement('div');
      dragGhost.id = 'dragGhost';
      dragGhost.textContent = dragFrom.name;
      document.body.appendChild(dragGhost);
    }
    dragFrom.copy = e.altKey;
    dragGhost.style.left = `${e.clientX}px`;
    dragGhost.style.top = `${e.clientY}px`;
    const t = targetAt(e.clientX, e.clientY);
    if (t?.el !== dragTarget?.el) {
      clearTarget();
      if (t) {
        dragTarget = t;
        if (t.kind === 'timeline') {
          t.el.classList.add('dropTime');
        } else {
          const taken = !!bank.layers[t.layer]?.[t.i];
          const self = dragFrom.kind === 'bank' && dragFrom.layer === t.layer && dragFrom.i === t.i;
          t.el.classList.add(taken && !self ? 'dropSwap' : 'dropOk');
        }
      }
    }
    // sliding along the lane never changes the target element, so the drop time
    // has to follow the pointer instead of the target swap
    if (dragTarget?.kind === 'timeline') dragTarget.x = e.clientX;
  });

  document.addEventListener('pointerup', () => { if (dragFrom) endDrag(true); });
  document.addEventListener('pointercancel', () => { if (dragFrom) endDrag(false); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dragFrom) endDrag(false); });

  function toggleView(force) {
    viewOpen = force !== undefined ? force : !viewOpen;
    viewEl.classList.toggle('hidden', !viewOpen);
    confirmEl.classList.add('hidden');
    if (viewOpen) buildGrid();
  }
  document.getElementById('lvClose').addEventListener('click', (e) => {
    e.stopPropagation(); toggleView(false);
  });
  document.getElementById('lvReset').addEventListener('click', (e) => {
    e.stopPropagation();
    confirmEl.classList.remove('hidden');   // warn first, wipe second
  });
  document.getElementById('lvConfirmNo').addEventListener('click', (e) => {
    e.stopPropagation(); confirmEl.classList.add('hidden');
  });
  document.getElementById('lvConfirmYes').addEventListener('click', (e) => {
    e.stopPropagation();
    bank = { active: 0, layers: [new Array(PADS).fill(null)] };
    persist();
    paint();
    buildGrid();
    confirmEl.classList.add('hidden');
  });
  document.addEventListener('pointerdown', (e) => {
    if (dragFrom) return;      // dragging out of a panel must not close it
    if (viewOpen && !viewEl.contains(e.target) && !layersEl.contains(e.target)) toggleView(false);
    if (railOpen && !railEl.contains(e.target) && !layersEl.contains(e.target)) toggleRail(false);
  });

  // store the look on now on pad i of a layer (the one up, unless a cue says)
  // only: store the trigger as taking over just those parts (see apply)
  function assign(i, layer = bank.active, { only = null } = {}) {
    const L = bank.layers[layer];
    if (!L) return;
    const state = capture();
    // A trigger keeps the master switches as they stand too: a look stored
    // with the rig muted stays rig-less, whatever the switches say later.
    state.allow = { ...sw };
    // the MH collecting sweep always takes over from the trigger before it,
    // however it is stored (the SHOW panel, Record, the director's cue card)
    if (!only && state.show?.demo === 'ir' && state.show.ir?.motion === 'collect') only = ['orbs'];
    // the fade line belongs to the trigger, not the look: replacing the look keeps it
    const part = Array.isArray(only) && only.length ? { only: [...only] } : {};
    L[i] = { name: lookName(state), state, ...part, ...(L[i]?.fade ? { fade: L[i].fade } : {}) };
    // The trigger just stored is the one on stage now. Changes made after
    // this belong to IT: before, they were pinned on whatever pad was fired
    // last, so dialling up the next look quietly rewrote the previous one.
    lastFired = { layer, i };
    lastWrites = new Set(part.only || SUBSYS_KEYS);
    lastApplied = capture();
    director.padStored?.(layer, i);
    persist(); paint(); paintSwitches();
    if (viewOpen) buildGrid();
    if (layer === bank.active) flash(i, 'stored');
  }

  // fire a pad on ANY layer — the cue engine replays stamps from every layer
  // regardless of which one is currently up on the deck
  // cueT: the song time of the cue that fired it (the director), so its fade
  // line runs in song time and a scrub lands at the right level
  function fireAt(layer, i, { stamp = true, params = null, cueT = null } = {}) {
    const p = bank.layers[layer]?.[i];
    if (!p) return false;          // empty pad — the caller says so out loud
    const st = p.state ?? p;       // tolerate a flat state from an older bank
    if (!st?.rig) return false;    // never take the cue engine down mid-show
    lastFired = { layer, i };
    lastWrites = new Set(p.only || p.writes || SUBSYS_KEYS);
    // what the trigger was stored with stays muted; the switches can only mute more
    const allow = st.allow ? Object.fromEntries(SUBSYS_KEYS.map((k) => [k, sw[k] && st.allow[k] !== false])) : sw;
    apply(st, allow, params, p.only);
    lastApplied = capture();
    api.onFire?.(layer, i, p, { cueT, refire: !stamp });
    paintSwitches();
    // stamp:false is a re-apply after a master switch flipped — the timeline
    // must not gain a second hit for a press that never happened
    if (stamp) director.notifyTrigger?.(layer, i);
    if (layer === bank.active) {
      els.forEach((el) => el.classList.remove('live'));
      els[i].classList.add('live');
      flash(i, 'hit');
    }
    return true;
  }
  const fire = (i) => fireAt(bank.active, i);

  function flash(i, cls) {
    const el = els[i];
    el.classList.remove('hit', 'stored');
    void el.offsetWidth;              // restart the CSS animation
    el.classList.add(cls);
  }

  paint();

  // Every dead end in the key handler used to be silent, which is exactly what
  // made the pads feel broken. One short line, auto-dismissed.
  let hintEl = null, hintTimer = 0;
  function hint(msg) {
    if (!hintEl) {
      hintEl = document.createElement('div');
      hintEl.id = 'padHint';
      document.body.appendChild(hintEl);
    }
    hintEl.textContent = msg;
    hintEl.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hintEl.classList.remove('show'), 2600);
  }

  // --- keys ---------------------------------------------------------------------
  // Fire on keydown for zero latency; ignore auto-repeat so holding a key
  // doesn't re-trigger. Shift+key stores the current look on that pad.
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const i = KEYS.indexOf(e.code);
    if (i === -1 || e.repeat) return;
    const key = LABELS[i];       // 'Digit4'.slice(3) is 'it4', not '4'
    if (document.body.classList.contains('menu')) return;   // still on the chooser
    // Fires with the mouse captured too. On A–L it could not: those keys were
    // WASD strafe and F/G flew and aimed, so the avatar had to win and cueing
    // meant pressing Esc — losing the very view you were cueing to. Nothing
    // else in the app binds a digit, so the pads now work from inside the show.
    e.preventDefault();
    if (e.shiftKey) { assign(i); return; }
    if (recArmed) { recordInto(i); return; }
    // Firing used to require the DIRECTOR to be open, which made the keys look
    // broken everywhere else. The pads are a live surface: if the mouse is free
    // and you are in the show, they fire.
    if (!fire(i)) hint(`Pad ${key} is empty — press Shift+${key} to store the current look on it`);
  });

  // project save/load: the whole bank in, the whole bank out
  function getBank() { return bank; }
  function setBank(b) {
    if (!b?.layers?.length) return false;
    const layers = b.layers.slice(0, MAX_LAYERS).map(fitLayer);
    bank = { active: Math.min(b.active ?? 0, layers.length - 1), layers };
    persist(); paint();
    if (viewOpen) buildGrid();
    return true;
  }

  // seed the belt on a first run, now that capture/apply and the console exist
  if (needsSeed && consoleUI?.runPreset) {
    const seeded = SEED_IDS.map(presetById).filter(Boolean)
      .map((p) => fitLayer(materialise(p, { runPreset: consoleUI.runPreset, capture, apply })));
    if (seeded.length) {
      bank = { active: 0, layers: seeded.slice(0, MAX_LAYERS) };
      persist();
      paint();
    }
  }

  paintSwitches();

  Object.assign(api, {
    fire, fireAt, assign, toggleView, toggleRail, getBank, setBank,
    clear: (i) => { pads()[i] = null; persist(); paint(); if (viewOpen) buildGrid(); },
    // Record, armed from anywhere: the next trigger picked takes the look on now
    setRecord, recordInto,
    // a trigger's fade line: { dur: seconds, pts: [[t 0..1, level 0..1], ...] }, or null
    fadeOf: (layer, i) => bank.layers[layer]?.[i]?.fade ?? null,
    setFade: (i, fade) => api.setFadeAt(bank.active, i, fade),
    setFadeAt: (layer, i, fade) => {
      const p0 = bank.layers[layer]?.[i];
      if (!p0) return false;
      if (fade) p0.fade = JSON.parse(JSON.stringify(fade)); else delete p0.fade;
      persist(); paint();
      return true;
    },
    subsystems: () => ({ ...sw }),
    setSubsystem: (k, v) => { if (k in sw) { sw[k] = !!v; if (lastFired) fireAt(lastFired.layer, lastFired.i, { stamp: false }); else paintSwitches(); } },
    // the whole-show snapshot pair, also used by VR REMOTE to mirror this
    // machine's look onto a phone (see the relay in main.js)
    capture, apply,
    resetAll: () => document.getElementById('lvConfirmYes').click(),
    pads,                                     // active layer's nine slots
    layers: () => bank.layers,
    activeLayer: () => bank.active,
    padName: (layer, i) => bank.layers[layer]?.[i]?.name ?? null,
    padKey: (i) => LABELS[i] ?? '?',
    capture, apply,
    allowed: () => ({ ...allowedFx }),
    setAllowed: (o) => {
      Object.assign(allowedFx, o);
      try { localStorage.setItem(ALLOW_STORE, JSON.stringify(allowedFx)); } catch (_) { /* private mode */ }
      if (lastFired) fireAt(lastFired.layer, lastFired.i, { stamp: false });   // the room follows the rule now
    },
    // which pad is responsible for what is on stage right now, the state keys
    // it owns, and the baseline to diff against
    activePad: () => (lastFired ? { ...lastFired } : null),
    // The wristbands are watched whatever the trigger writes: a show played in
    // the SHOW panel over any cue is an edit of that cue, to keep or revert.
    activeKeys: () => [...new Set([...(lastWrites || SUBSYS_KEYS), 'orbs'].flatMap((k) => SUBSYS[k] || []))],
    activeBaseline: () => lastApplied,
    // the same three plus the master switches, for undo (history.js), which
    // turns them to JSON at once: put back, the director's edit watcher diffs
    // against the trigger that was really on stage, not a later one
    liveState: () => ({ fired: lastFired, writes: lastWrites ? [...lastWrites] : null, base: lastApplied, sw }),
    setLiveState: (s) => {
      if (!s) return;
      lastFired = s.fired ?? null;
      lastWrites = s.writes ? new Set(s.writes) : null;
      lastApplied = s.base ?? null;
      if (s.sw) {
        Object.assign(sw, s.sw);
        try { localStorage.setItem(SW_STORE, JSON.stringify(sw)); } catch (_) { /* private mode */ }
      }
      els.forEach((el, i) => el.classList.toggle('live', !!lastFired && lastFired.layer === bank.active && lastFired.i === i));
      paintSwitches();
    },
    padStoredState: (layer, i) => bank.layers[layer]?.[i]?.state ?? null,
    refire: (layer, i) => fireAt(layer, i, { stamp: false }),
    // Overwrite one pad in place. "Keep on pad 3" has to mean pad 3 — stashing a
    // copy on a free pad instead left the edited pad holding its old look, so
    // going back to it replayed exactly what the user had just changed.
    writePad: (layer, i, state, name, subs = null) => {
      const p0 = bank.layers[layer]?.[i];
      if (!p0) return false;
      p0.state = JSON.parse(JSON.stringify(state));
      if (name) p0.name = name;
      // a trigger that wrote only some parts now writes what was kept on it too
      if (p0.writes && subs) p0.writes = [...new Set([...p0.writes, ...subs])];
      persist(); paint();
      if (viewOpen) buildGrid();
      return true;
    },
    // Park a look on a free pad and say where it went. The per-cue edit needs a
    // pad of its own so the original stays untouched for its other stamps.
    stashLook: (state, name) => {
      const slot = freeSlot();
      if (!slot) return null;
      bank.layers[slot[0]][slot[1]] = { name, state: JSON.parse(JSON.stringify(state)) };
      persist(); paint();
      if (viewOpen) buildGrid();
      return slot;
    },
    hint,
    vibe: () => vibe.id,
    setVibe: (id) => {
      vibe = vibeById(id);
      try { localStorage.setItem(VIBE_STORE, vibe.id); } catch (_) { /* private mode */ }
      // the room should change the moment the feeling does, not on the next cue
      if (lastFired) fireAt(lastFired.layer, lastFired.i, { stamp: false });
    },
    padForPreset,
    // the song-section banks, named — the director's auto-build offers these
    sectionPresets: () => LAYER_PRESETS.filter((p) => p.category === 'sections')
      .map((p) => ({ id: p.id, name: p.name })),
    // the bank's display name, so the timeline strip reads "Chorus" not "chorus"
    sectionName: (pid) => presetById(pid)?.name ?? pid,
    layerColor: (layer) => LAYER_COLORS[layer] ?? LAYER_COLORS[0],
  });
  // a live getter: Object.assign would have copied the value once
  Object.defineProperty(api, 'recording', { get: () => recArmed, enumerable: true });
  return api;
}
