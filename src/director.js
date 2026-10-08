import { createFadeEditor } from './fadeeditor.js';
import { SUBSYS, SUBSYS_KEYS } from './layerpresets.js';
import { songMap } from './songmap.js';

// DIRECTOR mode: the show-design surface. This iteration is the foundation —
// load an audio track and get a clean scrubbable waveform timeline along the
// bottom of the screen. Cue markers and effect automation build on top later.
//
// Playback runs on Web Audio (not an <audio> tag) so the timeline's clock is
// sample-accurate: AudioBufferSourceNodes are throwaway objects, so play /
// pause / seek recreate one each time and track position as
// offset + (ctx.currentTime - startedAt).

class AudioEngine {
  constructor(router = null) {
    this.ctx = null;
    this.buffer = null;
    this.node = null;
    this.playing = false;
    this.offset = 0;        // seconds into the track when paused
    this.startedAt = 0;     // ctx time the current node started
    this.onended = null;
    this.router = router;   // audioFX — shares its context so the PA can take the feed
    this.virtual = null;    // seconds: the song's time during an offline render, which plays nothing
    this.out = null;        // persistent gain the throwaway sources connect through
  }

  async load(file) {
    if (!this.ctx) {
      if (this.router) {
        this.ctx = this.router.getContext();
        this.out = this.ctx.createGain();
        this.router.attachNode(this.out);   // dry when the PA is off, venue chain when on
      } else {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
    }
    this.stop();
    const raw = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(raw);
    this.offset = 0;
    this.file = file;   // kept so a project export can embed the original bytes
    return this.buffer;
  }

  get duration() { return this.buffer ? this.buffer.duration : 0; }

  time() {
    if (!this.buffer) return 0;
    // an offline video render runs the song on its own clock, silently (main.js)
    if (this.virtual != null) return Math.min(Math.max(0, this.virtual), this.duration);
    const t = this.playing ? this.offset + this.ctx.currentTime - this.startedAt : this.offset;
    return Math.min(t, this.duration);
  }

  play() {
    if (!this.buffer || this.playing) return;
    if (this.offset >= this.duration - 0.01) this.offset = 0;   // replay from top
    this.ctx.resume();
    const node = this.ctx.createBufferSource();
    node.buffer = this.buffer;
    node.connect(this.out || this.ctx.destination);
    node.onended = () => {
      // fires for natural end AND for our own stop(); only act on the former
      if (this.node === node && this.playing) {
        this.playing = false;
        this.offset = this.duration;
        this.onended?.();
      }
    };
    node.start(0, this.offset);
    this.node = node;
    this.startedAt = this.ctx.currentTime;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.time();
    this.stop();
  }

  stop() {
    if (this.node) {
      const n = this.node;
      this.node = null;       // clear first so onended sees it's ours
      this.playing = false;
      try { n.stop(); } catch (_) {}
    }
    this.playing = false;
  }

  seek(t) {
    const was = this.playing;
    if (was) this.stop();
    this.offset = Math.max(0, Math.min(t, this.duration));
    if (was) this.play();
  }
}

// Peak extraction: fixed-resolution max-abs buckets over all channels, computed
// once per file. Drawing resamples nearest, so resizes never re-read samples.
// --- song sections ------------------------------------------------------------
// The waveform's peaks array is PEAK amplitude, which is useless for finding
// sections: one snare hit makes a quiet verse read as loud as a chorus. Average
// energy is what separates a verse from a drop, so this takes its own RMS pass.
function rmsEnvelope(buffer, buckets) {
  const env = new Float32Array(buckets);
  const len = buffer.length, step = len / buckets;
  const ch = Math.min(2, buffer.numberOfChannels);
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c);
    for (let b = 0; b < buckets; b++) {
      const i0 = Math.floor(b * step), i1 = Math.min(len, Math.ceil((b + 1) * step));
      let sum = 0, n = 0;
      for (let i = i0; i < i1; i += 8) { sum += data[i] * data[i]; n++; }
      if (n) env[b] += Math.sqrt(sum / n) / ch;
    }
  }
  return env;
}

// One colour per kind, so the strip becomes readable at a glance rather than a
// gradient you have to decode: gold is always the chorus, red always the drop.
const SECTION_COLORS = {
  intro: '#5b83bd', verse: '#4f9c85', build: '#c9913f', chorus: '#d9b260',
  drop: '#e2574a', breakdown: '#7a6aa8', bridge: '#a3729c', outro: '#6b7d90',
  default: '#8b8b8b',
};

const SECTION_MIN = 11;    // seconds. Below this it is a fill, not a section
const SECTION_MAX = 14;    // rows. More than this is a list, not a decision

// Cut the track where its energy settles at a new plateau, then name each
// stretch from how loud it is and where it falls. Every row is a GUESS the
// panel lets you overrule — but a guess beats nine empty dropdowns.
// Kept after a scan so a dragged boundary can re-measure its section's energy
// without another pass over the audio. Rebuilt lazily when a reload brought the
// sections back from storage but not the envelope that produced them.
let envelope = null;      // { lvl: number[], per: seconds-per-bucket }
function buildEnvelope(buffer) {
  const dur = buffer?.duration || 0;
  if (!dur) return null;
  const buckets = Math.max(60, Math.min(900, Math.round(dur * 4)));
  const per = dur / buckets;
  const env = rmsEnvelope(buffer, buckets);
  // smooth over ~2s, or a single bar of drums reads as a section boundary
  const w = Math.max(2, Math.round(2 / per));
  const sm = new Float32Array(buckets);
  for (let i = 0; i < buckets; i++) {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(buckets - 1, i + w); j++) { sum += env[j]; n++; }
    sm[i] = sum / n;
  }
  let lo = Infinity, hi = 0;
  for (const v of sm) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return { lvl: Array.from(sm, (v) => (v - lo) / Math.max(1e-6, hi - lo)), per };
}

function detectSections(buffer) {
  const dur = buffer?.duration || 0;
  if (dur < SECTION_MIN * 2) return [];
  envelope = buildEnvelope(buffer);          // still wanted: edited edges re-measure level
  // Timbre and repetition first. Loudness plateaus only find the parts of a
  // song that happen to differ in volume, which on a modern master is few of
  // them; the spectral map finds the part that RECURS, which is the chorus.
  try {
    const m = songMap(buffer, { minSec: SECTION_MIN, maxSections: SECTION_MAX });
    if (m.length >= 3) return m;
  } catch (err) {
    console.warn('spectral song map failed, falling back to loudness', err);
  }
  if (!envelope) return [];
  const { lvl, per } = envelope;
  const buckets = lvl.length;

  const minB = Math.max(2, Math.round(SECTION_MIN / per));
  const cuts = [0];
  let runSum = lvl[0], runN = 1;
  for (let i = 1; i < buckets; i++) {
    if (i - cuts[cuts.length - 1] >= minB && Math.abs(lvl[i] - runSum / runN) > 0.22) {
      cuts.push(i); runSum = lvl[i]; runN = 1;
    } else { runSum += lvl[i]; runN++; }
  }
  const mean = (a, b) => {
    let sum = 0;
    for (let i = a; i < b; i++) sum += lvl[i];
    return sum / Math.max(1, b - a);
  };
  const mk = () => cuts.map((a, k) => {
    const b = k + 1 < cuts.length ? cuts[k + 1] : buckets;
    // rise across thirds, not end buckets: a section's first bucket still holds
    // the transition into it, which read every loud chorus as a build
    const third = Math.max(1, Math.round((b - a) / 3));
    return { t: a * per, end: b * per, level: mean(a, b), rise: mean(b - third, b) - mean(a, a + third) };
  });
  let secs = mk();
  // too many rows is a list, not a decision: fold the shortest away until it fits
  while (secs.length > SECTION_MAX) {
    let worst = 1;
    for (let k = 1; k < secs.length; k++) {
      if (secs[k].end - secs[k].t < secs[worst].end - secs[worst].t) worst = k;
    }
    cuts.splice(worst, 1);
    secs = mk();
  }
  // Rank the sections against EACH OTHER, not against the smoothing floor. Fixed
  // thresholds on the raw envelope mean a song's loudest quiet passage decides
  // what counts as a verse — on one test song a real verse scored 0.28 and got
  // called a breakdown. Relative to its own siblings it is plainly the middle.
  const n = secs.length;
  let sLo = Infinity, sHi = 0;
  for (const sec of secs) { if (sec.level < sLo) sLo = sec.level; if (sec.level > sHi) sHi = sec.level; }
  const relOf = (sec) => (sec.level - sLo) / Math.max(1e-6, sHi - sLo);
  return secs.map((sec, k) => {
    const rel = relOf(sec);
    return {
      t: sec.t,
      len: sec.end - sec.t,
      level: rel,
      // a build RISES and is not already loud all through — checking the rise
      // first, unqualified, labelled the biggest chorus in the song a build
      id: k === 0 ? (rel < 0.45 ? 'intro' : 'chorus')
        : k === n - 1 ? (rel < 0.5 ? 'outro' : 'chorus')
        : sec.rise > 0.28 && rel < 0.7 ? 'build'
        : rel > 0.8 ? 'drop'
        : rel > 0.55 ? 'chorus'
        : rel < 0.18 ? 'breakdown'
        : 'verse',
      // the banks rise left to right, so a loud stretch takes a loud trigger
      trig: Math.max(0, Math.min(8, Math.round(rel * 8))),
    };
  });
}

function computePeaks(buffer, buckets = 2048) {
  const peaks = new Float32Array(buckets);
  const len = buffer.length;
  const step = len / buckets;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let b = 0; b < buckets; b++) {
      let m = 0;
      const i0 = Math.floor(b * step), i1 = Math.min(len, Math.ceil((b + 1) * step));
      // sparse inner scan: at 44.1kHz a bucket spans ~4000 samples; every 8th
      // is indistinguishable in a 64px-tall waveform and 8x cheaper
      for (let i = i0; i < i1; i += 8) {
        const v = Math.abs(data[i]);
        if (v > m) m = v;
      }
      if (m > peaks[b]) peaks[b] = m;
    }
  }
  // headroom-normalise quiet recordings so the wave always fills the lane
  let max = 0;
  for (let b = 0; b < buckets; b++) if (peaks[b] > max) max = peaks[b];
  if (max > 0.001) for (let b = 0; b < buckets; b++) peaks[b] /= max;
  return peaks;
}

function fmtTime(s) {
  s = Math.max(0, s);
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function initDirector({ controls, audio = null }) {
  const panel = document.getElementById('director');
  const btn = document.getElementById('directorBtn');
  const empty = document.getElementById('dirEmpty');
  const deck = document.getElementById('dirDeck');
  const playBtn = document.getElementById('dirPlay');
  const nameEl = document.getElementById('dirName');
  const timeEl = document.getElementById('dirTime');
  const wave = document.getElementById('dirWave');
  const recBtn = document.getElementById('dirRec');
  const clearBtn = document.getElementById('dirClear');
  const input = document.getElementById('audio-input');
  const wctx = wave.getContext('2d');

  const engine = new AudioEngine(audio);
  let peaks = null;
  let open = false;
  let needsDraw = true;
  let hoverT = -1;          // hovered position in seconds, -1 = not hovering
  let scrubbing = false;

  // --- cue stamps: recorded pad hits pinned to track time -------------------
  // markers = [{ t, pad }] sorted by t. While recording, live pad presses are
  // stamped onto the timeline; on playback the cue engine fires each pad as
  // the playhead crosses its stamp — the recorded performance replays itself.
  let markers = [];
  let recording = false;
  let lastCueT = 0;          // playhead position the cue engine has consumed up to
  let trackKey = null;       // name|duration — stamps persist per track
  let autoFiring = false;    // suppresses re-stamping when the cue engine fires
  let padHooks = null;       // { fire(i) } — installed by main.js once pads exist
  let changeListener = null; // menu's auto-save: told on any stamp/track change
  let markerHits = [];       // screen-space tag rects for right-click delete
  let secHits = [];          // screen-space section bands, rebuilt every draw
  let secDrag = null;        // { k, moved } while a boundary is being dragged
  let hoverEdge = null;      // boundary index under the cursor
  let secStripH = 0;         // the strip's height in canvas px, as last drawn
  const CUE_STORE = 'arena-cues-v1';
  const SEC_STORE = 'arena-sections-v1';
  const PEND_STORE = 'arena-pending-v1';
  const STYLE_STORE = 'arena-style-v1';
  // THE STYLE LAYER. BUILD used to turn sections straight into presets with
  // nothing in between for a human to say what kind of show this is. These
  // three dials (plus the colour family and the allowed-effects mask, which
  // live in pads.js) are that layer; the compiler below reads them.
  let style = { energy: 0.6, motion: 'auto', density: 'steady' };
  const loadStyle = () => {
    try { style = { ...style, ...(JSON.parse(localStorage.getItem(STYLE_STORE))?.[trackKey] || {}) }; } catch (_) { /* corrupt */ }
  };
  const saveStyle = () => {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(STYLE_STORE)) ?? {}; } catch (_) {}
    all[trackKey] = style;
    try { localStorage.setItem(STYLE_STORE, JSON.stringify(all)); } catch (_) { /* private mode */ }
  };
  // LIVE EDIT: tweak the room while the show runs and the change used to be a
  // lie — it held until the next stamp crossed, then cueTick re-applied the
  // pad's snapshot and silently threw the work away, often a minute later.
  // A divergence is now HELD against the cue that was playing, with no deadline:
  // keep it, revert it, or leave it pending across a reload.
  let liveCue = null;        // the marker the cue engine last fired
  // MANUAL BUILD. The song plays and the designer taps Space where the lights
  // should change; those are empty marks until Finish gives each one a look.
  // Space only means "mark" while this is true — afterwards it is play/pause.
  let marking = false;
  // A LIST, not one slot: a single unresolved edit used to make the watcher
  // return early, so tweaking a second trigger before resolving the first was
  // silently ignored. One entry per pad; the bar shows the active one.
  let pendings = [];         // [{ t, layer, pad, name, state }]
  // The section map is the song's shape, not a look — it belongs with the stamps
  // and it has to survive a reload, or the strip vanishes and the auto-build
  // forgets every boundary the user corrected by hand.
  let sections = [];
  const loadPending = () => {
    try {
      const v = JSON.parse(localStorage.getItem(PEND_STORE))?.[trackKey];
      pendings = Array.isArray(v) ? v : (v ? [v] : []);      // tolerate the single-slot format
    } catch (_) { pendings = []; }
  };
  const savePending = () => {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(PEND_STORE)) ?? {}; } catch (_) {}
    if (pendings.length) all[trackKey] = pendings; else delete all[trackKey];
    try { localStorage.setItem(PEND_STORE, JSON.stringify(all)); } catch (_) { /* private mode */ }
    needsDraw = true;
  };
  // the one the bar acts on: whichever matches the pad on stage, else the oldest
  const shownPending = () => {
    const ap = padHooks?.activePad?.();
    return (ap && pendings.find((p) => p.layer === ap.layer && p.pad === ap.i)) || pendings[0] || null;
  };
  // the marker an edit belongs to, re-found by value so it survives a reload
  // (object identity does not)
  const pendingMarkerOf = (p) => (p && p.t >= 0
    ? markers.find((m) => m.layer === p.layer && m.pad === p.pad && Math.abs(m.t - p.t) < 0.02)
    : null);
  const loadSections = () => {
    try { sections = JSON.parse(localStorage.getItem(SEC_STORE))?.[trackKey] ?? []; }
    catch (_) { sections = []; }
  };
  const saveSections = () => {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(SEC_STORE)) ?? {}; } catch (_) {}
    all[trackKey] = sections;
    try { localStorage.setItem(SEC_STORE, JSON.stringify(all)); } catch (_) { /* private mode */ }
    needsDraw = true;
  };
  // Re-measure one stretch after its edges moved, so the energy bar and the
  // trigger it would pick stay honest about what is actually in there.
  const sectionLevel = (t0, t1) => {
    if (!envelope) envelope = buildEnvelope(engine.buffer);
    if (!envelope) return 0.5;
    const { lvl, per } = envelope;
    const a = Math.max(0, Math.round(t0 / per)), b = Math.min(lvl.length, Math.round(t1 / per));
    let sum = 0;
    for (let i = a; i < b; i++) sum += lvl[i];
    return b > a ? sum / (b - a) : 0.5;
  };
  // lengths are derived from the neighbours, so a moved edge fixes both sides
  const relenSections = () => {
    for (const [k, sec] of sections.entries()) {
      const end = k + 1 < sections.length ? sections[k + 1].t : engine.duration;
      sec.len = Math.max(0, end - sec.t);
      sec.level = sectionLevel(sec.t, end);
      sec.trig = Math.max(0, Math.min(8, Math.round(sec.level * 8)));
    }
  };

  const loadStamps = () => {
    try { markers = JSON.parse(localStorage.getItem(CUE_STORE))?.[trackKey] ?? []; }
    catch (_) { markers = []; }
    for (const m of markers) delete m.params;     // looks resolve at fire time now; shows saved before carry dead weight
    for (const m of markers) m.layer ??= 0;   // stamps from before layers existed
  };
  const saveStamps = () => {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(CUE_STORE)) ?? {}; } catch (_) {}
    all[trackKey] = markers;
    localStorage.setItem(CUE_STORE, JSON.stringify(all));
    clearBtn.classList.toggle('hidden', !markers.length);
    syncBuildBtn();
    changeListener?.();
  };

  // On any seek the cue engine must not sweep-fire everything in between:
  // jump the consumed pointer, then recall the nearest stamp behind the new
  // position so the show state matches where the track now stands.
  function cueResync(t) {
    lastCueT = t;
    if (!padHooks) return;
    let last = null;
    for (const m of markers) { if (m.t <= t) last = m; else break; }
    if (last) {
      autoFiring = true;
      liveCue = last;
      fireMarker(last);
      autoFiring = false;
    }
  }

  // --- panel open/close ------------------------------------------------------
  function toggle(force) {
    open = force !== undefined ? force : !open;
    if (!open) { document.getElementById('secPop')?.classList.add('hidden'); }
    panel.classList.toggle('hidden', !open);
    document.body.classList.toggle('director', open);
    btn.classList.toggle('active', open);
    if (open) {
      if (controls.isLocked) controls.unlock();
      resize();
      needsDraw = true;
    }
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });

  // --- settings drawer ----------------------------------------------------------
  // PA, crowd noise, screens-follow-music and the phone mirror used to sit in a
  // row along the deck's foot, four buttons of permanent chrome for things you
  // set once. They are the same elements, moved — the id-bound handlers in
  // main.js keep working untouched — just folded behind one gear and grouped.
  const drawer = document.getElementById('dirSettings');
  let gearChip = null;                      // the button that opens it, so an
                                            // outside-click closer can spare it
  const setDrawer = (open) => {
    drawer.classList.toggle('hidden', !open);
    gearChip?.classList.toggle('active', open);
  };
  // Takes the button that opened it. It used to be a chip on the layer belt,
  // which pads.js rebuilds on every repaint — hence the hand-over rather than
  // reaching into the belt. The gear now lives in the transport row, which the
  // ADJUST collapse cannot hide, but the hand-over still costs nothing.
  function toggleSettings(chip) {
    if (chip) gearChip = chip;
    setDrawer(drawer.classList.contains('hidden'));
  }
  document.getElementById('dsClose')?.addEventListener('click', (e) => {
    e.stopPropagation(); setDrawer(false);
  });
  document.addEventListener('pointerdown', (e) => {
    if (drawer.classList.contains('hidden')) return;
    if (drawer.contains(e.target) || (gearChip && gearChip.contains(e.target))) return;
    setDrawer(false);
  });

  // --- drag the deck where you want it -----------------------------------------
  // The panel is placed by CSS (centred, or shifted clear of the console), and
  // no default suits every screen. Dragging sets explicit left/top and adds
  // .moved so the layout rules stop fighting it; the position persists.
  //
  // Grabbed from the panel's own background — pressing a control never starts a
  // drag — with a 4px threshold so a click still reads as a click. Double-click
  // the background to hand it back to the automatic layout.
  const POS_STORE = 'arena-dirpos-v1';
  const GRABBABLE = 'button, input, select, textarea, canvas, .pad, .lvCell, .prTrig, .prBank, .prCat, .lvTab, .layerChip, .layerArrow, .dirSw, .psKey, #spBtns, #lvGrid, #prBody, #secPop, #vibePop, #dirStyle';
  const place = (x, y) => {
    panel.classList.add('moved');
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  };
  const clampToView = (x, y) => {
    const r = panel.getBoundingClientRect();
    return [
      Math.max(8 - r.width + 120, Math.min(x, window.innerWidth - 120)),   // keep a grabbable strip on screen
      Math.max(8, Math.min(y, window.innerHeight - 44)),
    ];
  };
  try {
    const saved = JSON.parse(localStorage.getItem(POS_STORE));
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      requestAnimationFrame(() => place(...clampToView(saved.x, saved.y)));
    }
  } catch (_) { /* private mode */ }

  let dragFrom = null, dragBase = null, dragMoved = false;
  panel.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest(GRABBABLE)) return;
    const r = panel.getBoundingClientRect();
    dragFrom = { x: e.clientX, y: e.clientY };
    dragBase = { x: r.left, y: r.top };
    dragMoved = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragFrom) return;
    if (!dragMoved) {
      if (Math.hypot(e.clientX - dragFrom.x, e.clientY - dragFrom.y) < 4) return;
      dragMoved = true;
      panel.classList.add('dragging');
      document.body.style.userSelect = 'none';
    }
    place(...clampToView(dragBase.x + (e.clientX - dragFrom.x), dragBase.y + (e.clientY - dragFrom.y)));
  });
  window.addEventListener('pointerup', () => {
    if (!dragFrom) return;
    if (dragMoved) {
      const r = panel.getBoundingClientRect();
      try { localStorage.setItem(POS_STORE, JSON.stringify({ x: r.left, y: r.top })); } catch (_) { /* private mode */ }
    }
    dragFrom = null;
    panel.classList.remove('dragging');
    document.body.style.userSelect = '';
  });
  panel.addEventListener('dblclick', (e) => {
    if (e.target.closest(GRABBABLE)) return;
    panel.classList.remove('moved');
    panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = '';
    try { localStorage.removeItem(POS_STORE); } catch (_) { /* private mode */ }
  });

  // --- loading ---------------------------------------------------------------
  async function loadFile(file) {
    if (!file) return;
    nameEl.textContent = 'Decoding…';
    empty.classList.add('hidden');
    deck.classList.remove('hidden');
    try {
      const buffer = await engine.load(file);
      peaks = computePeaks(buffer);
      nameEl.textContent = file.name.replace(/\.[^.]+$/, '');
      trackKey = `${file.name}|${buffer.duration.toFixed(2)}`;
      loadStamps();
      loadSections();
      loadPending();
      loadStyle();
      if (sections.length) assignSectionColours();   // the card's swatches and Mirror are live before BUILD
      marking = false;
      setTimeout(paintMarkBar, 0);
      liveCue = null;
      setTimeout(paintEditBar, 0);       // the bar is defined further down
      viewT0 = viewT1 = 0;          // a new track opens at full width
      envelope = null;              // a new track invalidates the old envelope
      clearBtn.classList.toggle('hidden', !markers.length);
      syncBuildBtn();
      recording = false; lastCueT = 0; syncRec();
      syncPlayIcon();
      resize();
      needsDraw = true;
      changeListener?.();
    } catch (err) {
      nameEl.textContent = 'Could not read this file';
      console.error('audio decode failed', err);
    }
  }
  document.getElementById('dirAdd').addEventListener('click', (e) => {
    e.stopPropagation(); input.click();
  });
  document.getElementById('dirReplace').addEventListener('click', (e) => {
    e.stopPropagation(); input.click();
  });
  input.addEventListener('change', (e) => loadFile(e.target.files[0]));

  // drag a file anywhere onto the timeline
  panel.addEventListener('dragover', (e) => { e.preventDefault(); panel.classList.add('drop'); });
  panel.addEventListener('dragleave', () => panel.classList.remove('drop'));
  panel.addEventListener('drop', (e) => {
    e.preventDefault();
    panel.classList.remove('drop');
    const files = [...e.dataTransfer.files];
    const proj = files.find((f) => f.name.endsWith('.arenashow'));
    if (proj) { openProject(proj); return; }
    const f = files.find((f) => f.type.startsWith('audio/'));
    if (f) loadFile(f);
  });

  // --- transport ---------------------------------------------------------------
  function syncPlayIcon() {
    playBtn.classList.toggle('playing', engine.playing);
  }
  function togglePlay() {
    if (!engine.buffer) return;
    engine.playing ? engine.pause() : engine.play();
    syncPlayIcon();
    needsDraw = true;
  }
  playBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });
  engine.onended = () => {
    if (recording) { recording = false; syncRec(); }
    if (marking) finishMarking();
    syncPlayIcon(); needsDraw = true;
  };

  // --- record ---------------------------------------------------------------
  function syncRec() {
    recBtn.classList.toggle('recording', recording);
    deck.classList.toggle('recording', recording);
  }
  function toggleRec() {
    if (!engine.buffer) return;
    recording = !recording;
    if (recording) {
      // arm from wherever the playhead stands and roll immediately
      lastCueT = engine.time();
      if (!engine.playing) { engine.play(); syncPlayIcon(); }
    }
    syncRec();
    needsDraw = true;
  }
  recBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleRec(); });
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    markers = [];
    saveStamps();
    needsDraw = true;
  });

  // --- project files: audio + trigger bank + stamps in one .arenashow -------
  // Binary layout: 8-byte magic, uint32 JSON length, JSON metadata, then the
  // untouched original audio bytes — no base64 bloat, loads back bit-perfect.
  const MAGIC = 'ARSHOW1\0';
  async function exportProject() {
    if (!engine.file || !padHooks?.getBank) return;
    const audio = await engine.file.arrayBuffer();
    const meta = {
      kind: 'creative-arena-show', version: 1,
      audioName: engine.file.name,
      audioType: engine.file.type || 'audio/mpeg',
      bank: padHooks.getBank(),
      markers,
      // additive since v1: a reader that predates them just ignores them
      sections,
      vibe: padHooks.vibe?.() ?? 'natural',
    };
    const json = new TextEncoder().encode(JSON.stringify(meta));
    const head = new Uint8Array(12);
    for (let i = 0; i < 8; i++) head[i] = MAGIC.charCodeAt(i);
    new DataView(head.buffer).setUint32(8, json.length, true);
    const blob = new Blob([head, json, audio], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = meta.audioName.replace(/\.[^.]+$/, '') + '.arenashow';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  async function loadProjectParts(audioFile, stampList) {
    await loadFile(audioFile);            // decode, peaks, track key
    // the project's stamps override whatever this browser had for the track
    markers = (stampList ?? []).map((m) => ({ t: m.t, pad: m.pad, layer: m.layer ?? 0, ...(m.auto ? { auto: true } : {}), ...(m.own ? { own: true } : {}), ...(m.manual ? { manual: true } : {}), ...(m.empty ? { empty: true } : {}) }));
    markers.sort((a, b) => a.t - b.t);
    saveStamps();
    lastCueT = 0;
    needsDraw = true;
  }
  async function importProject(file) {
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < 8; i++) {
        if (bytes[i] !== MAGIC.charCodeAt(i)) throw new Error('bad magic');
      }
      const jlen = new DataView(buf).getUint32(8, true);
      const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jlen)));
      if (meta.kind !== 'creative-arena-show') throw new Error('bad kind');
      if (meta.bank && padHooks?.setBank) padHooks.setBank(meta.bank);
      await loadProjectParts(
        new File([buf.slice(12 + jlen)], meta.audioName, { type: meta.audioType }),
        meta.markers);
      if (Array.isArray(meta.sections)) { sections = meta.sections; saveSections(); }
      if (meta.vibe) setVibe(meta.vibe);
    } catch (err) {
      empty.classList.add('hidden');
      deck.classList.remove('hidden');
      nameEl.textContent = 'Not a saved show file';
      console.error('project import failed', err);
    }
  }
  // main.js saves and opens the whole show (the room, the screens' video, the
  // lights, every switch) when it hands its handlers over; until then, the
  // track, its triggers and cues only
  let projectHandlers = null;
  const openProject = (file) => (projectHandlers?.open ? projectHandlers.open(file) : importProject(file));
  const projectInput = document.getElementById('project-input');
  projectInput.addEventListener('change', (e) => {
    if (e.target.files[0]) openProject(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('dirSave').addEventListener('click', (e) => {
    e.stopPropagation();
    if (projectHandlers?.save) projectHandlers.save(); else exportProject();
  });
  document.getElementById('dirOpen').addEventListener('click', (e) => {
    e.stopPropagation(); projectInput.click();
  });
  document.getElementById('dirOpenEmpty').addEventListener('click', (e) => {
    e.stopPropagation(); projectInput.click();
  });

  // called by the pads module on every live pad fire
  function notifyTrigger(layer, i) {
    if (autoFiring || !recording || !engine.buffer || !engine.playing) return;
    markers.push({ t: engine.time(), pad: i, layer });
    markers.sort((a, b) => a.t - b.t);
    lastCueT = Math.max(lastCueT, engine.time());  // don't refire our own stamp
    saveStamps();
    needsDraw = true;
  }

  // space = play/pause while the deck is open and the pointer is free
  window.addEventListener('keydown', (e) => {
    if (!open || controls.isLocked) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); if (marking) addMark(); else togglePlay(); }
    if (marking && e.code === 'Backspace') { e.preventDefault(); undoMark(); }
    if (marking && e.code === 'Enter') { e.preventDefault(); finishMarking(); }
  });

  // --- scrub / hover -----------------------------------------------------------
  // One owner for the lane's x -> time maths. The deck is draggable and the
  // canvas reflows, so a second copy of this in pads.js would drift apart the
  // first time either one moved.
  // --- zoom ---------------------------------------------------------------------
  // The lane shows [viewT0, viewT1]; 0,0 means the whole track. Scroll over it to
  // zoom about the time under the cursor, scroll sideways to pan, double-click the
  // waveform to see everything again. Every time<->pixel conversion goes through
  // tx()/xt(), so the zoomed view and the full one are the same code path — the
  // alternative was fourteen copies of `/ dur * W` each quietly assuming "whole".
  let viewT0 = 0, viewT1 = 0;
  const zoomed = () => viewT1 > viewT0 && viewT1 - viewT0 < engine.duration - 1e-6;
  const v0 = () => (zoomed() ? viewT0 : 0);
  const span = () => (zoomed() ? viewT1 - viewT0 : engine.duration);
  const tx = (t, Wpx) => ((t - v0()) / Math.max(1e-6, span())) * Wpx;   // seconds -> px, any width basis
  const xt = (x, Wpx) => v0() + (x / Math.max(1, Wpx)) * span();          // px -> seconds
  const timeAtClientX = (clientX) => {
    const r = wave.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return Math.max(0, Math.min(engine.duration, xt(f * r.width, r.width)));
  };
  const MIN_SPAN = 4;              // seconds across the whole lane at full zoom: a bar or two
  function setView(a, s2) {
    const dur = engine.duration;
    s2 = Math.max(Math.min(MIN_SPAN, dur), Math.min(dur, s2));
    a = Math.max(0, Math.min(dur - s2, a));
    if (s2 >= dur - 1e-6) { viewT0 = 0; viewT1 = 0; } else { viewT0 = a; viewT1 = a + s2; }
    needsDraw = true;
  }
  wave.addEventListener('wheel', (e) => {
    if (!engine.buffer || !engine.duration) return;
    e.preventDefault();                                   // the page must not scroll under the deck
    followPlay = false;                                   // you are looking elsewhere on purpose;
                                                          // draw() re-arms it the moment the playhead is back in view
    const r = wave.getBoundingClientRect();
    const s2 = span(), a = v0();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) {
      setView(a + (e.deltaX / r.width) * s2, s2);         // sideways: pan by a fraction of the view
    } else {
      // zoom about the cursor: the time under the pointer stays under the pointer.
      // A pinch arrives as a wheel with ctrlKey and small deltas, hence the two rates.
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const anchor = a + f * s2;
      const ns = s2 * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0035));
      setView(anchor - f * Math.max(Math.min(MIN_SPAN, engine.duration), Math.min(engine.duration, ns)), ns);
    }
    hoverT = posToTime(e);
  }, { passive: false });
  const posToTime = (e) => timeAtClientX(e.clientX);
  // Placing a cue "exactly at the chorus" by hand is a pixel-hunt. Within a few
  // pixels of a section start the cue snaps to it — the start is what you meant.
  let snapK = -1;               // the section start a drag is currently snapped to, for the draw
  // Pause on the beat and the playhead becomes the most precise target there is:
  // a boundary or a cue dragged near it locks to that exact time. Only while the
  // track is stopped — a moving playhead would jitter as it passed under the
  // pointer, and nobody means "wherever it happens to be when I let go".
  let snapPlay = false;         // a drag is currently locked to the playhead, for the draw
  const snapTol = () => (9 / Math.max(1, wave.getBoundingClientRect().width)) * span();
  const playheadSnap = (t) => {
    snapPlay = false;
    if (engine.playing || !engine.buffer) return t;
    const ph = engine.time();
    if (Math.abs(ph - t) <= snapTol()) { snapPlay = true; return ph; }
    return t;
  };
  const snapTime = (t) => {
    snapK = -1; snapPlay = false;
    if (!engine.duration) return t;
    const tol = snapTol();
    let best = -1, bd = tol;
    for (const [k, sec] of sections.entries()) {
      const d = Math.abs(sec.t - t);
      if (d < bd) { bd = d; best = k; }
    }
    // the paused playhead is a target too, and wins when it is the nearer one
    if (!engine.playing && engine.buffer) {
      const d = Math.abs(engine.time() - t);
      if (d <= tol && (best < 0 || d < bd)) { snapPlay = true; return engine.time(); }
    }
    if (best < 0) return t;
    snapK = best;
    return sections[best].t;
  };
  // The view pages along with the playhead until you zoom or pan while it is
  // playing — then it is YOUR view, and a gold tab at the edge shows where the
  // playhead went. Follow comes back when you seek, click the tab, or the
  // playhead wanders back into the part you are looking at.
  let followPlay = true;
  let playTabHit = null;        // { x0, x1, y0, y1 } of the edge tab, in canvas px, or null
  const showPlayhead = (t) => {
    if (zoomed() && (t < viewT0 || t > viewT1)) setView(t - span() * 0.1, span());
  };
  const seekTo = (t) => { engine.seek(t); cueResync(t); followPlay = true; showPlayhead(t); };

  // --- stamp popover: one click on a tag = see it, hear it, delete it -------
  const pop = document.getElementById('stampPop');
  const spList = document.getElementById('spList');
  const spSave = document.getElementById('spSave');
  // the cue card's fade: the trigger's own line, shaped right here (fadeeditor.js)
  const spFade = document.getElementById('spFade');
  const cueFade = createFadeEditor({
    onChange: (fade) => { if (popMarker) { padHooks?.setFade?.(popMarker.layer, popMarker.pad, fade); paintFadeBtn(); needsDraw = true; } },
    onPlay: () => { if (popMarker) padHooks?.fireNow?.(popMarker.layer, popMarker.pad); },
    onDone: () => { pop.classList.remove('withFade'); paintFadeBtn(); },
    onRemove: () => {
      if (popMarker) padHooks?.setFade?.(popMarker.layer, popMarker.pad, null);
      pop.classList.remove('withFade'); paintFadeBtn(); needsDraw = true;
    },
    fadeNow: () => padHooks?.fadeNow?.(),
  });
  document.getElementById('spFadeMount')?.appendChild(cueFade.el);
  function paintFadeBtn() {
    const m = popMarker;
    const has = m && !m.empty && padHooks?.fadeOf?.(m.layer, m.pad);
    spFade.classList.toggle('hidden', !m || m.empty || cueFade.open);
    spFade.innerHTML = has ? '&#12336; Edit fade' : '&#12336; Add fade';
  }
  spFade.addEventListener('click', (e) => {
    e.stopPropagation();
    const m = popMarker;
    if (!m || m.empty) return;
    const name = padHooks?.name?.(m.layer, m.pad) ?? 'LOOK';
    pop.classList.add('withFade');
    cueFade.edit({ title: `${padKey(m.pad)} · ${name} · fade`, fade: padHooks?.fadeOf?.(m.layer, m.pad), layer: m.layer, pad: m.pad });
    paintFadeBtn();
    clampPop();
    needsDraw = true;
  });
  const spBtns = document.getElementById('spBtns');
  const spNudge = document.getElementById('spNudge');
  let popMarker = null;           // single-card target, held by reference so
                                  // deletes elsewhere can't retarget the card
  const deleteStamp = (m) => {
    const k = markers.indexOf(m);
    if (k >= 0) { markers.splice(k, 1); saveStamps(); needsDraw = true; }
  };
  // Place a look at an arbitrary time. notifyTrigger is the live path and can
  // only stamp while the track rolls, which means the only way to author a show
  // is to perform it — impossible for anyone who has not run a lighting desk.
  // This is the other door: same marker shape, no playback required.
  const addStampAt = (t, layer, pad) => {
    if (!engine.buffer) return null;
    const m = { t: Math.max(0, Math.min(t, engine.duration)), pad, layer };
    markers.push(m);
    markers.sort((a, b) => a.t - b.t);
    saveStamps();
    needsDraw = true;
    return m;
  };
  // the pads module owns the key row — asking it beats keeping a second copy
  // here that would quietly disagree the next time the row changes
  const padKey = (i) => padHooks?.key?.(i) ?? String(i + 1);
  const previewStamp = (m) => {
    if (!padHooks) return;
    autoFiring = true; fireMarker(m); autoFiring = false;
  };
  function placePop(tagCssX) {
    pop.classList.remove('hidden');
    const dr = panel.getBoundingClientRect(), wr = wave.getBoundingClientRect();
    const px = wr.left - dr.left + tagCssX;
    // the room between the top bar and the deck: a taller card scrolls in it
    pop.style.setProperty('--popRoom', `${Math.max(160, Math.round(dr.top - 8 - 66))}px`);
    pop.style.left = Math.max(10, Math.min(dr.width - pop.offsetWidth - 10, px - pop.offsetWidth / 2)) + 'px';
  }
  // the card got wider (its fade editor opened): keep it inside the deck
  function clampPop() {
    const dr = panel.getBoundingClientRect();
    pop.style.left = Math.max(10, Math.min(dr.width - pop.offsetWidth - 10, parseFloat(pop.style.left) || 10)) + 'px';
  }
  // The card is the only readout for a 0.1s nudge, and fmtTime floors to whole
  // seconds — so +0.1s appeared to do nothing. Tenths live here and nowhere
  // else: the transport clock and the hover chip read better without them.
  const fmtTenths = (s) => {
    const t = Math.round(Math.max(0, s) * 10) / 10;   // round first, or 59.96 prints 0:60.0
    const m = Math.floor(t / 60);
    return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
  };
  const popSub = (m) => `${fmtTenths(m.t)} · KEY ${padKey(m.pad)} · LAYER ${m.layer + 1}`;
  function openPop(m, tagCssX) {
    popMarker = m;
    spList.classList.add('hidden');
    spBtns.classList.remove('hidden');
    spNudge.classList.remove('hidden');
    spSave.classList.remove('hidden', 'done');
    spSave.innerHTML = '&#10515; Save the look on now to this trigger';
    cueFade.close();
    pop.classList.remove('withFade');
    paintFadeBtn();
    document.getElementById('spDot').style.background = padHooks?.color?.(m.layer) ?? '#d9b260';
    document.getElementById('spName').textContent = m.empty ? 'EMPTY MARK' : (padHooks?.name?.(m.layer, m.pad) ?? 'EMPTY PAD');
    document.getElementById('spSub').textContent = m.empty ? `${fmtTime(m.t)} \u00b7 gets a look when you Finish` : popSub(m);
    placePop(tagCssX);
  }
  // After a nudge the card is showing the old time and standing where the tag
  // used to be. Ride along with it instead — otherwise ten taps of an arrow key
  // leave the card behind, pointing at nothing.
  function followPop(m) {
    document.getElementById('spSub').textContent = popSub(m);
    const r = wave.getBoundingClientRect();
    placePop(engine.duration ? tx(m.t, r.width) : 0);
  }
  // Nudge: dragging is for coarse moves, this is for the last tenth of a second.
  // A mouse is a clumsy way to ask for 0.1s, so the arrow keys do it too.
  const NUDGE = 0.1;
  function nudgeStamp(delta) {
    if (!popMarker) return;
    popMarker.t = Math.max(0, Math.min(popMarker.t + delta, engine.duration));
    markers.sort((a, b) => a.t - b.t);
    saveStamps();
    followPop(popMarker);
    needsDraw = true;
  }
  // bunched stamps open as a list, first-to-last, so the order is legible
  function openPopList(members, tagCssX) {
    popMarker = null;
    spSave.classList.add('hidden');   // a bunch has no single trigger to save onto
    cueFade.close();
    pop.classList.remove('withFade');
    spFade.classList.add('hidden');
    spBtns.classList.add('hidden');
    spNudge.classList.add('hidden');   // no single stamp here to nudge
    spList.classList.remove('hidden');
    document.getElementById('spDot').style.background = 'rgba(242,238,226,0.65)';
    const head = () => {
      document.getElementById('spName').textContent = `${members.length} effects, in order`;
      document.getElementById('spSub').textContent =
        `${fmtTime(members[0].t)} – ${fmtTime(members[members.length - 1].t)}`;
    };
    head();
    spList.innerHTML = '';
    for (const m of members) {
      const row = document.createElement('div');
      row.className = 'spRow';
      row.innerHTML = `
        <span class="spRowDot"></span>
        <span class="spRowKey">${padKey(m.pad)}</span>
        <span class="spRowName"></span>
        <span class="spRowT">${fmtTime(m.t)}</span>
        <button class="spRowBtn" title="Show this effect now">&#9654;</button>
        <button class="spRowBtn del" title="Delete this stamp">&#10005;</button>`;
      row.querySelector('.spRowDot').style.background = padHooks?.color?.(m.layer) ?? '#d9b260';
      row.querySelector('.spRowName').textContent = padHooks?.name?.(m.layer, m.pad) ?? 'EMPTY PAD';
      row.querySelector('.spRowBtn:not(.del)').addEventListener('click', (e) => {
        e.stopPropagation(); previewStamp(m);
      });
      row.querySelector('.spRowBtn.del').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteStamp(m);
        row.remove();
        members.splice(members.indexOf(m), 1);
        members.length ? head() : closePop();
      });
      spList.appendChild(row);
    }
    placePop(tagCssX);
  }
  function closePop() { popMarker = null; cueFade.close(); pop.classList.remove('withFade'); pop.classList.add('hidden'); }
  // Overwrite the cue's trigger with the look on stage now: the card opens
  // without firing anything, so what you just built is still what is on.
  spSave.addEventListener('click', (e) => {
    e.stopPropagation();
    const m = popMarker;
    if (!m || !padHooks?.saveTo) return;
    if (m.empty) delete m.empty;                       // a mark waiting for a look gets this one
    padHooks.saveTo(m.layer, m.pad);
    saveStamps();
    document.getElementById('spName').textContent = padHooks?.name?.(m.layer, m.pad) ?? 'LOOK';
    spSave.classList.add('done');
    spSave.innerHTML = '&#10003; Saved on this trigger';
    padHooks.hint?.(`Saved on trigger ${padKey(m.pad)}: every cue on it plays this look now`);
    needsDraw = true;
  });
  document.getElementById('spPreview').addEventListener('click', (e) => {
    e.stopPropagation();
    if (popMarker) previewStamp(popMarker);
  });
  document.getElementById('spGo').addEventListener('click', (e) => {
    e.stopPropagation();
    if (popMarker) { seekTo(popMarker.t); needsDraw = true; }
  });
  document.getElementById('spDelete').addEventListener('click', (e) => {
    e.stopPropagation();
    if (popMarker) deleteStamp(popMarker);
    closePop();
  });
  document.getElementById('spBack').addEventListener('click', (e) => {
    e.stopPropagation(); nudgeStamp(-NUDGE);
  });
  document.getElementById('spFwd').addEventListener('click', (e) => {
    e.stopPropagation(); nudgeStamp(NUDGE);
  });
  document.getElementById('spDup').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!popMarker) return;
    const copy = addStampAt(popMarker.t + 0.5, popMarker.layer, popMarker.pad);
    // hand the card to the copy: it is the one you just made and the one you
    // are most likely about to place
    if (copy) { popMarker = copy; followPop(copy); }
  });
  // --- copy / paste ----------------------------------------------------------------
  // Cmd/Ctrl+C on a selected cue, Cmd/Ctrl+V to drop another. The source is
  // whatever you last clicked on the lane, falling back to the pad that is
  // currently live — "click a trigger, copy it" should work either way.
  let clip = null;             // { layer, pad, name, t } — t is where to paste NEXT
  window.addEventListener('keydown', (e) => {
    if (!open || controls.isLocked || !engine.buffer) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (!(e.metaKey || e.ctrlKey)) return;
    const code = e.code;
    if (code === 'KeyC') {
      const src = popMarker
        ? { layer: popMarker.layer, pad: popMarker.pad, t: popMarker.t }
        : (() => { const ap = padHooks?.activePad?.(); return ap ? { layer: ap.layer, pad: ap.i, t: -1 } : null; })();
      if (!src) return;
      e.preventDefault();
      clip = { ...src, name: padHooks?.name?.(src.layer, src.pad) ?? 'LOOK' };
      padHooks?.hint?.(`Copied ${clip.name} \u2014 Cmd+V drops it on the timeline`);
      return;
    }
    if (code !== 'KeyV' || !clip) return;
    e.preventDefault();
    // the cursor wins if it is over the lane, because that is where you are
    // pointing; otherwise it lands just after the last one, so repeat pastes
    // walk along instead of stacking in one place
    const at = hoverT >= 0 ? hoverT : (clip.t >= 0 ? clip.t + 0.5 : engine.time());
    const m = addStampAt(snapTime(at), clip.layer, clip.pad);
    snapK = -1; snapPlay = false;
    if (!m) return;
    clip.t = m.t;                       // next paste steps on from here
    showPlayhead(m.t);
    padHooks?.hint?.(`${clip.name} at ${fmtTime(m.t)}`);
    needsDraw = true;
  });

  // Arrow nudge, deliberately NOT a global bind: it answers only while a single
  // stamp's card is open, which is also the only time the pointer is free. The
  // arena owns the keyboard the rest of the time.
  window.addEventListener('keydown', (e) => {
    if (!popMarker || pop.classList.contains('hidden')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
    e.preventDefault();
    nudgeStamp(e.code === 'ArrowLeft' ? -NUDGE : NUDGE);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!pop.classList.contains('hidden') && !pop.contains(e.target)) closePop();
  });

  // --- auto-build ---------------------------------------------------------------
  // One press. It used to open a panel with a dropdown per section — six to
  // fourteen decisions before anything happened, which is the wall of choices
  // this feature exists to remove. Now BUILD reads the song if it has not been
  // read, lays a cue at the start of every section, and gets out of the way.
  // Corrections happen where the sections ARE: on the strip above the waveform.
  const buildBtn = document.getElementById('dirBuild');

  // Cues that BUILD placed carry `auto`, so a rebuild replaces its own work and
  // never touches a cue you dragged on by hand. Old shows have no flag, which
  // reads as "hand-placed" — the safe default.
  const autoAt = (t) => markers.find((m) => m.auto && Math.abs(m.t - t) < 0.05);

  // A section owns the cue at its start: renaming the section re-picks the look,
  // moving its edge moves the cue, merging it away removes it. That is the
  // model a non-technical person already has — "the chorus look starts where
  // the chorus starts" — implemented without a new kind of marker.
  function syncSectionCue(k) {
    const sec = sections[k];
    if (!sec) return;
    const m = autoAt(sec.t);
    if (sec.id === 'skip') { if (m) deleteStamp(m); return; }
    const slot = padHooks?.padForPreset?.(sec.id, sec.trig);
    if (!slot) return;
    if (m) { m.layer = slot[0]; m.pad = slot[1]; saveStamps(); }
    else { const nm = addStampAt(sec.t, slot[0], slot[1]); if (nm) { nm.auto = true; saveStamps(); } }
    needsDraw = true;
  }

  function buildShow({ auto = false } = {}) {
    if (!engine.buffer) return;
    closeBuildPop();
    const marked = markers.some((m) => m.manual || m.empty);
    if (marked && !auto) { fillMarks(); return; }   // your moments, our looks — re-picked
    if (marked) { markers = markers.filter((m) => !m.manual && !m.empty); marking = false; paintMarkBar(); }
    if (!sections.length) { sections = detectSections(engine.buffer); saveSections(); }
    if (!sections.length) {
      padHooks?.hint?.('This track is too short to break into sections \u2014 drag looks onto the timeline by hand instead');
      return;
    }
    markers = markers.filter((m) => !m.auto);      // redo our own work, keep yours
    assignSectionColours();
    let placed = 0, short = 0;
    // SAME PART, SAME LOOK. The map knows chorus 1, 2 and 3 are one part; if
    // each got its own trigger the show would read as a slideshow of presets.
    const partTrig = {};
    const yours = markers.filter((m) => !m.auto);       // placed, moved, pasted or kept by hand
    const alt = (b) => (b >= 4 ? b - 1 : b + 1);          // a neighbour in the bank
    // one cue per section never moved; a section is 20-40s and a real show
    // changes every few bars. Density is how many points each section gets.
    const PATTERN = {
      calm:   [[0, 'base']],
      steady: [[0, 'base'], [0.5, 'alt']],
      busy:   [[0, 'base'], [0.33, 'alt'], [0.66, 'base'], [0.88, 'lift']],
    };
    for (const sec of sections) {
      if (sec.id === 'skip') continue;
      const key = sec.part !== undefined ? `p${sec.part}` : `${sec.id}:${Math.round(sec.level * 8)}`;
      const base = partTrig[key] ??= Math.max(0, Math.min(8, Math.round((sec.level * 0.5 + style.energy * 0.5) * 8)));
      const end = sec.t + sec.len;
      for (const [frac, which] of PATTERN[style.density] || PATTERN.steady) {
        const t = sec.t + frac * sec.len;
        if (frac > 0 && end - t < 3) continue;           // nothing crammed against the next section
        if (yours.some((u) => Math.abs(u.t - t) < 3)) continue;   // you already have a cue here
        // a lift is one step up; at the top of the bank it falls back to the neighbour,
        // since re-firing the look already running would change nothing
        const trig = which === 'base' ? base : which === 'alt' ? alt(base) : (base < 8 ? base + 1 : alt(base));
        const slot = padHooks?.padForPreset?.(sec.id, trig);
        if (!slot) { short++; continue; }
        const m = addStampAt(t, slot[0], slot[1]);
        if (m) { m.auto = true; placed++; }
      }
    }
    saveStamps();
    lastCueT = engine.time();                        // do not sweep-fire the new stamps
    needsDraw = true;
    padHooks?.hint?.(short
      ? `Placed ${placed} cues \u2014 ${short} had no free pad left`
      : `${placed} cues placed. Click a section on the strip to rename it, drag its edge to move it.`);
    syncBuildBtn();
  }
  // primed while the song has no cues at all: that is the moment this is the
  // obvious next move, and afterwards it should stop shouting
  function syncBuildBtn() {
    paintStyle();
    buildBtn.classList.toggle('hidden', !engine.buffer);
    vibeBtn.classList.toggle('hidden', !engine.buffer);
    buildBtn.classList.toggle('primed', !!engine.buffer && !markers.length);
  }
  // --- BUILD's question, and the manual pass ---------------------------------------
  const buildPop = document.getElementById('buildPop');
  function closeBuildPop() { buildPop.classList.add('hidden'); }
  buildBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (marking) { finishMarking(); return; }
    const opening = buildPop.classList.contains('hidden');
    vibePop.classList.add('hidden');
    buildPop.classList.toggle('hidden', !opening);
    if (!opening) return;
    const dr = panel.getBoundingClientRect(), br = buildBtn.getBoundingClientRect();
    buildPop.style.left = `${Math.max(8, br.left - dr.left)}px`;
    const marked = markers.some((m) => m.manual || m.empty);
    const [man, aut] = buildPop.querySelectorAll('.bpOpt');
    man.querySelector('span').innerHTML = marked
      ? 'Keep marking from where the playhead is. Tap <kbd>Space</kbd> every time the lights should change, then Finish.'
      : 'The song plays from the top. Tap <kbd>Space</kbd> every time the lights should change. Finish, and every mark gets a look.';
    aut.querySelector('span').innerHTML = marked
      ? 'Replaces your marks with cues read from the song\u2019s sections \u2014 the peaks and the quiet.'
      : 'Reads the song\u2019s sections \u2014 the peaks and the quiet \u2014 and lays cues over them for you.';
  });
  buildPop.querySelector('[data-build="manual"]').addEventListener('click', (e) => { e.stopPropagation(); startMarking(); });
  buildPop.querySelector('[data-build="auto"]').addEventListener('click', (e) => { e.stopPropagation(); buildShow({ auto: true }); });
  document.addEventListener('pointerdown', (e) => {
    if (!buildPop.classList.contains('hidden') && !buildPop.contains(e.target) && e.target !== buildBtn) closeBuildPop();
  });

  const markBar = document.getElementById('markBar');
  const emptyMarks = () => markers.filter((m) => m.empty);
  function startMarking() {
    if (!engine.buffer) return;
    closeBuildPop();
    if (recording) { recording = false; syncRec(); }
    if (!sections.length) { sections = detectSections(engine.buffer); saveSections(); }
    assignSectionColours();
    marking = true;
    // a first pass starts at the top; a continued one picks up where you are
    if (!markers.some((m) => m.manual || m.empty)) seekTo(0);
    if (!engine.playing) { engine.play(); syncPlayIcon(); }
    followPlay = true;
    paintMarkBar();
    padHooks?.hint?.('Marking \u2014 tap Space where the lights should change');
    needsDraw = true;
  }
  let lastMarkT = -1;
  function addMark() {
    if (!marking) return;
    const t = engine.time();
    if (Math.abs(t - lastMarkT) < 0.15) return;         // a double-tap is one moment
    lastMarkT = t;
    markers.push({ t, pad: -1, layer: 0, empty: true });
    markers.sort((a, b) => a.t - b.t);
    saveStamps();
    paintMarkBar();
    needsDraw = true;
  }
  function undoMark() {
    const es = emptyMarks();
    if (!es.length) return;
    markers.splice(markers.indexOf(es[es.length - 1]), 1);
    saveStamps(); paintMarkBar(); needsDraw = true;
  }
  function cancelMarking() {
    marking = false;
    if (engine.playing) { engine.pause(); syncPlayIcon(); }
    markers = markers.filter((m) => !m.empty);
    saveStamps(); paintMarkBar(); syncBuildBtn(); needsDraw = true;
  }
  function finishMarking() {
    marking = false;
    if (engine.playing) { engine.pause(); syncPlayIcon(); }
    const n = emptyMarks().length;
    if (!n) { paintMarkBar(); padHooks?.hint?.('No marks to fill \u2014 play and tap Space where the lights should change'); return; }
    fillMarks();
    syncBuildBtn();
    padHooks?.hint?.(`${n} mark${n === 1 ? '' : 's'} filled \u2014 press play. Change Energy or the Vibe and they re-fill.`);
  }
  // Give every mark a look. Yours are the moments; the section each one sits in,
  // the style's Energy and the part map decide the look, alternating inside a
  // section so two marks in one chorus never fire the same thing twice.
  function fillMarks() {
    if (!sections.length) { sections = detectSections(engine.buffer); saveSections(); }
    assignSectionColours();
    const alt = (b) => (b >= 4 ? b - 1 : b + 1);
    const partTrig = {};
    const perSec = new Map();
    const marks = markers.filter((m) => m.empty || m.manual).sort((a, b) => a.t - b.t);
    let short = 0;
    for (const m of marks) {
      const sec = sectionFor(m.t) || sections[0];
      if (!sec) { short++; continue; }
      const key = sec.part !== undefined ? `p${sec.part}` : `${sec.id}:${Math.round(sec.level * 8)}`;
      const base = partTrig[key] ??= Math.max(0, Math.min(8, Math.round((sec.level * 0.5 + style.energy * 0.5) * 8)));
      const k = perSec.get(sec) || 0; perSec.set(sec, k + 1);
      const seq = [base, alt(base), base < 8 ? base + 1 : alt(base), alt(base)];
      const slot = padHooks?.padForPreset?.(sec.id === 'skip' ? 'default' : sec.id, seq[k % seq.length]);
      if (!slot) { short++; continue; }
      m.layer = slot[0]; m.pad = slot[1];
      delete m.empty; m.manual = true; delete m.auto;
    }
    saveStamps(); paintMarkBar(); paintStyle(); needsDraw = true;
    if (short) padHooks?.hint?.(`${short} mark${short === 1 ? '' : 's'} left empty \u2014 every pad is taken`);
  }
  function paintMarkBar() {
    if (!markBar) return;
    const es = emptyMarks().length;
    const show = marking || es > 0;
    markBar.classList.toggle('hidden', !show);
    if (!show) return;
    markBar.classList.toggle('waiting', !marking);
    markBar.querySelector('.mkWhat').innerHTML = marking
      ? 'Marking \u2014 tap <kbd>Space</kbd> every time the lights should change'
      : `${es} mark${es === 1 ? '' : 's'} waiting for looks`;
    markBar.querySelector('.mkCount').textContent = marking ? `${es} mark${es === 1 ? '' : 's'}` : '';
    markBar.querySelector('.mkUndo').disabled = !es;
    markBar.querySelector('.mkUndo').textContent = marking ? 'Undo' : 'Continue';
    markBar.querySelector('.mkCancel').textContent = marking ? 'Cancel' : 'Discard';
    markBar.querySelector('.mkFinish').textContent = marking ? 'Finish' : 'Fill now';
    markBar.querySelector('.mkFinish').disabled = !es;
  }
  markBar?.querySelector('.mkUndo')?.addEventListener('click', (e) => { e.stopPropagation(); if (marking) undoMark(); else startMarking(); });
  markBar?.querySelector('.mkCancel')?.addEventListener('click', (e) => { e.stopPropagation(); cancelMarking(); });
  markBar?.querySelector('.mkFinish')?.addEventListener('click', (e) => { e.stopPropagation(); finishMarking(); });

  // --- section colours -------------------------------------------------------------
  // Every section gets its OWN colour from the family, rotating so neighbours
  // differ — one palette over a whole song cannot tell a story. The card can
  // override one section, and mirror it onto its namesakes.
  // Natural has no family, so it spreads the basics: the story still varies
  const BASICS = ['#ff3b30', '#ff8a00', '#ffd166', '#22c55e', '#00d1c1', '#1f6bff', '#7a3cff', '#ff2fd6'];
  const familyPalette = () => {
    const fam = (padHooks?.vibes?.() ?? []).find((v) => v.id === (padHooks?.vibe?.() ?? 'natural'));
    if (!fam?.a) return BASICS;
    return [fam.a, ...(fam.palette || []), fam.b].filter((c, i, a) => c && a.indexOf(c) === i);
  };
  function assignSectionColours(force = false) {
    const pal = familyPalette();
    sections.forEach((sec, k) => {
      if (sec.col !== undefined && !force) return;     // null = "pad's own", chosen on purpose
      sec.col = { a: pal[k % pal.length], b: pal[(k + 2) % pal.length] };
    });
    saveSections();
  }
  const sectionAt = (t) => { let s = null; for (const x of sections) { if (x.t <= t + 1e-6) s = x; else break; } return s; };
  // A cue dragged a beat ahead of the chorus announces the chorus; it should not
  // flip to the verse's colour for landing two seconds early.
  const ANTICIPATE = 2;
  const sectionFor = (t) => {
    const next = sections.find((x) => x.t > t + 1e-6);
    if (next && next.t - t <= ANTICIPATE) return next;
    return sectionAt(t);
  };
  // The look is resolved WHEN THE CUE FIRES: the pad's state, the section's
  // colour over it, the style's motion over that. Nothing is baked into the
  // marker, so a recolour reaches every cue in the section at once — moved,
  // pasted or hand-placed alike. A cue you dialled live and kept is `own`:
  // it plays exactly as you left it.
  const paramsOf = (m) => {
    if (m.own) return undefined;
    const p = {};
    const col = sectionFor(m.t)?.col;
    if (col) p.col = col;
    if (style.motion !== 'auto') p.motion = style.motion;
    return Object.keys(p).length ? p : undefined;
  };
  // A cue always plays its trigger exactly as stored. It used to play an
  // unkept edit in its place, so scrubbing back to a cue brought back
  // whatever had been dialled in since (the next look's rig, say) as if it
  // were that cue's own. An edit only becomes the cue when you Keep it.
  function fireMarker(m) {
    if (m.empty) return;                                // a mark with no look yet
    padHooks.fire(m.layer, m.pad, paramsOf(m), m.t);
  }
  // colour and motion resolve at fire time, so a change only needs the live
  // cue re-fired to be seen; markers are untouched and your moves stand
  function restyle() {
    if (liveCue) { autoFiring = true; fireMarker(liveCue); autoFiring = false; }
    needsDraw = true;
  }

  // --- the style strip ----------------------------------------------------------------
  const styleEl = document.getElementById('dirStyle');
  function chipRow(host, items, isActive, onPick) {
    host.innerHTML = '';
    for (const [id, name] of items) {
      const b = document.createElement('button');
      b.className = 'stChip' + (isActive(id) ? ' active' : '');
      b.textContent = name;
      b.addEventListener('click', (e) => { e.stopPropagation(); onPick(id); });
      host.appendChild(b);
    }
  }
  function paintStyle() {
    if (!styleEl) return;
    styleEl.classList.toggle('hidden', !engine.buffer);
    if (!engine.buffer) return;
    styleEl.classList.toggle('manual', markers.some((m) => m.manual || m.empty));
    document.getElementById('stEnergy').value = String(style.energy);
    document.getElementById('stEnergyVal').textContent = String(Math.round(style.energy * 10));
    chipRow(document.getElementById('stMotion'), padHooks?.motions?.() ?? [], (id) => style.motion === id,
      (id) => { style.motion = id; saveStyle(); paintStyle(); restyle(); });
    chipRow(document.getElementById('stDensity'), [['calm', 'Calm'], ['steady', 'Steady'], ['busy', 'Busy']], (id) => style.density === id,
      (id) => { style.density = id; saveStyle(); paintStyle(); if (markers.some((m) => m.auto)) buildShow(); });
    const allowed = padHooks?.allowed?.() ?? {};
    chipRow(document.getElementById('stAllow'),
      [['lasers', 'Lasers'], ['strobe', 'Strobe'], ['blinders', 'Blinders'], ['pyro', 'Pyro'], ['confetti', 'Confetti']],
      (k) => allowed[k] !== false,
      (k) => { padHooks?.setAllowed?.({ [k]: allowed[k] === false }); paintStyle(); });
  }
  const energyEl = document.getElementById('stEnergy');
  energyEl?.addEventListener('input', (e) => {
    style.energy = parseFloat(e.target.value);
    document.getElementById('stEnergyVal').textContent = String(Math.round(style.energy * 10));
  });
  energyEl?.addEventListener('change', () => { saveStyle(); if (markers.some((m) => m.auto || m.manual)) buildShow(); });   // re-place, or re-fill your marks

  // --- vibe --------------------------------------------------------------------------
  // The colour of the whole show, chosen as a feeling before BUILD rather than as
  // a hex value per look afterwards. The chip shows the two colours; the card
  // shows ten swatches. pads.js owns the override itself.
  const vibeBtn = document.getElementById('dirVibe');
  const vibePop = document.getElementById('vibePop');
  function paintVibe() {
    const id = padHooks?.vibe?.() ?? 'natural';
    const v = (padHooks?.vibes?.() ?? []).find((x) => x.id === id);
    vibeBtn.querySelector('.vbName').textContent = v ? v.name : 'Vibe';
    // the row only has room for the swatch, so the name rides in the tooltip
    vibeBtn.title = v && v.a ? `Vibe: ${v.name} \u2014 every look in these colours` : 'Vibe: natural \u2014 pick a feeling to colour the whole show';
    const sw = vibeBtn.querySelector('.vbSwatch');
    sw.style.background = v && v.a ? `linear-gradient(135deg, ${v.a}, ${v.b})` : 'conic-gradient(#ff2d2d, #ffc61a, #39ff88, #1f6bff, #ff2fd6, #ff2d2d)';
    vibeBtn.classList.toggle('set', !!(v && v.a));
    for (const c of vibePop.querySelectorAll('.vbChip')) c.classList.toggle('active', c.dataset.vibe === id);
  }
  function setVibe(id) {
    padHooks?.setVibe?.(id); paintVibe();
    if (sections.length) { assignSectionColours(true); restyle(); if (popSec >= 0) openSecPop(popSec, popSecT, lastPopX); }
  }
  let lastPopX = 0;
  function paintVibePop() {
    vibePop.innerHTML = '';
    for (const v of padHooks?.vibes?.() ?? []) {
      const c = document.createElement('button');
      c.className = 'vbChip'; c.dataset.vibe = v.id;
      c.innerHTML = `<span class="vbDot"></span><span>${v.name}</span>`;
      c.querySelector('.vbDot').style.background = v.a ? `linear-gradient(135deg, ${v.a}, ${v.b})` : 'conic-gradient(#ff2d2d, #ffc61a, #39ff88, #1f6bff, #ff2fd6, #ff2d2d)';
      c.title = v.a ? `Colour every look ${v.name.toLowerCase()}` : 'Every look in its own colours';
      c.addEventListener('click', (e) => { e.stopPropagation(); setVibe(v.id); vibePop.classList.add('hidden'); });
      vibePop.appendChild(c);
    }
    paintVibe();
  }
  vibeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = vibePop.classList.contains('hidden');
    vibePop.classList.toggle('hidden', !open);
    if (open) {
      paintVibePop();
      const dr = panel.getBoundingClientRect(), br = vibeBtn.getBoundingClientRect();
      vibePop.style.left = Math.max(10, Math.min(dr.width - vibePop.offsetWidth - 10, br.left - dr.left + br.width / 2 - vibePop.offsetWidth / 2)) + 'px';
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!vibePop.classList.contains('hidden') && !vibePop.contains(e.target) && e.target !== vibeBtn && !vibeBtn.contains(e.target)) vibePop.classList.add('hidden');
  });

  // --- live edit ------------------------------------------------------------------
  const editBar = document.getElementById('cueEdit');
  const pick = (o, keys) => { const r = {}; for (const k of keys) r[k] = o?.[k]; return r; };
  // Diff the room against the BASELINE captured when the pad landed, not
  // against the pad's stored snapshot: a vibe rewrites colours and a master
  // switch silences a subsystem, both legitimately, and both would otherwise
  // read as "the user edited this".
  function divergedKeys() {
    const ap = padHooks?.activePad?.();
    const base = padHooks?.activeBaseline?.();
    if (!ap || !base) return null;
    const keys = padHooks.activeKeys?.() ?? [];
    if (!keys.length) return null;
    const live = padHooks.capture?.();
    if (!live) return null;
    const changed = keys.filter((k) => JSON.stringify(live[k]) !== JSON.stringify(base[k]));
    return changed.length ? { ap, live, changed } : null;
  }
  function paintEditBar() {
    if (!editBar) return;
    const p0 = shownPending();
    editBar.classList.toggle('hidden', !p0);
    if (!p0) return;
    const where = p0.t >= 0 ? ` at ${fmtTime(p0.t)}` : '';
    const more = pendings.length > 1 ? `  \u00b7  +${pendings.length - 1} more` : '';
    editBar.querySelector('.ceWhat').textContent = `${p0.name}${where} \u2014 edited${more}`;
    editBar.querySelector('.ceKeep').textContent = p0.t >= 0 ? 'Keep for this cue' : `Keep on pad ${padHooks?.key?.(p0.pad) ?? ''}`;
    editBar.querySelector('.ceGo').style.display = p0.t >= 0 ? '' : 'none';
  }
  // Called on a timer: the console has no dispatcher, every control calls its
  // setter directly, so polling the snapshot is the only non-invasive way to
  // notice a change. 220ms is under a beat and costs one capture().
  function watchLiveEdit() {
    if (!engine.buffer) return;
    const d = divergedKeys();
    if (!d) return;
    const stored = padHooks.padStoredState?.(d.ap.layer, d.ap.i);
    if (!stored) return;
    // only the subsystems that actually moved get taken from the live room; the
    // rest keep the pad's original values, vibe and all
    const state = { ...JSON.parse(JSON.stringify(stored)) };
    for (const k of d.changed) state[k] = JSON.parse(JSON.stringify(d.live[k]));
    // the parts that were changed play when the trigger fires, even ones it
    // was stored muted for (a SHOW panel show over a no-wristbands cue)
    const subs = SUBSYS_KEYS.filter((s) => SUBSYS[s].some((g) => d.changed.includes(g)));
    if (state.allow) for (const s of subs) state.allow[s] = true;
    const orig = padHooks.name?.(d.ap.layer, d.ap.i) ?? 'LOOK';
    // a cue is being played -> the edit belongs to THAT cue; a hand-fired pad
    // has no stamp to isolate, so it belongs to the pad
    const onCue = liveCue && liveCue.layer === d.ap.layer && liveCue.pad === d.ap.i;
    // already tracking this pad? keep the entry current instead of piling up
    const at = pendings.findIndex((p) => p.layer === d.ap.layer && p.pad === d.ap.i);
    if (at >= 0) { pendings[at].state = state; pendings[at].subs = subs; savePending(); paintEditBar(); return; }
    pendings.push({ t: onCue ? liveCue.t : -1, layer: d.ap.layer, pad: d.ap.i, name: orig, state, subs });
    savePending();
    paintEditBar();
    padHooks.hint?.(`${orig} edited \u2014 keep it or revert, no rush`);
  }
  setInterval(watchLiveEdit, 220);

  const dropPending = (p) => { pendings = pendings.filter((x) => x !== p); savePending(); paintEditBar(); };
  function keepEdit() {
    const pending = shownPending();
    if (!pending) return;
    const m = pendingMarkerOf(pending);
    if (!m) {
      // No cue to isolate, so this IS the pad's look: write it back in place.
      // "Keep on pad 3" must change pad 3 — parking a copy elsewhere left the
      // edited pad holding its old look and the change appeared to vanish.
      const ok = padHooks?.writePad?.(pending.layer, pending.pad, pending.state, undefined, pending.subs);
      // every cue on this pad now plays the pad as you left it, colours included
      if (ok) for (const x of markers) if (x.layer === pending.layer && x.pad === pending.pad) { x.own = true; delete x.auto; }
      saveStamps();
      dropPending(pending);
      if (ok) padHooks?.refire?.(pending.layer, pending.pad);
      padHooks?.hint?.(ok ? `Kept on pad ${padHooks?.key?.(pending.pad) ?? ''}` : 'That pad is gone');
      return;
    }
    // per-cue scope: the look goes on a pad of its own and ONLY this stamp is
    // re-pointed, so the original trigger keeps serving its other stamps
    const bank = padHooks?.getBank?.();
    const names = new Set((bank?.layers || []).flat().filter(Boolean).map((x) => x.name));
    const base = pending.name.replace(/ \d+$/, '');
    let n = 2; while (names.has(`${base} ${n}`)) n++;
    const slot = padHooks?.stashLook?.(pending.state, `${base} ${n}`);
    if (!slot) { padHooks?.hint?.('Every pad is taken \u2014 clear one, then keep this'); return; }
    m.layer = slot[0]; m.pad = slot[1];
    delete m.auto;                        // yours now — a rebuild must leave it alone
    m.own = true;                         // and it plays exactly as you dialled it
    saveStamps();
    dropPending(pending);
    padHooks?.refire?.(slot[0], slot[1]);
    padHooks?.hint?.(`This cue is now ${base} ${n} \u2014 the others still use ${base}`);
  }
  function revertEdit() {
    const pending = shownPending();
    if (!pending) return;
    dropPending(pending);
    padHooks?.refire?.(pending.layer, pending.pad);
    padHooks?.hint?.('Reverted');
  }
  editBar?.querySelector('.ceKeep')?.addEventListener('click', (e) => { e.stopPropagation(); keepEdit(); });
  editBar?.querySelector('.ceRevert')?.addEventListener('click', (e) => { e.stopPropagation(); revertEdit(); });
  editBar?.querySelector('.ceGo')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const p0 = shownPending();
    if (p0 && p0.t >= 0) { seekTo(p0.t); needsDraw = true; }
  });

  // --- section card ---------------------------------------------------------------
  // Click a section on the strip: rename it from a chip row, split it where you
  // clicked, or fold it into the one before. Same visual language as the stamp
  // card, so the second one teaches itself.
  const secPop = document.getElementById('secPop');
  const scChips = document.getElementById('scChips');
  let popSec = -1, popSecT = 0;   // which section, and where in it the click landed
  function openSecPop(k, clickT, cssX) {
    closePop();
    popSec = k; popSecT = clickT;
    const sec = sections[k];
    const end = k + 1 < sections.length ? sections[k + 1].t : engine.duration;
    document.getElementById('scDot').style.background = SECTION_COLORS[sec.id] ?? '#8b8b8b';
    document.getElementById('scName').textContent = (padHooks?.sectionName?.(sec.id) ?? sec.id).toUpperCase();
    document.getElementById('scSub').textContent = `${fmtTime(sec.t)} \u2013 ${fmtTime(end)} \u00b7 ${Math.round(end - sec.t)}s`;
    scChips.innerHTML = '';
    for (const pr of padHooks?.sectionPresets?.() ?? []) {
      const c = document.createElement('button');
      c.className = 'scChip' + (pr.id === sec.id ? ' active' : '');
      c.textContent = pr.name;
      c.style.setProperty('--sc', SECTION_COLORS[pr.id] ?? '#8b8b8b');
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        sections[k].id = pr.id;
        saveSections();
        syncSectionCue(k);
        openSecPop(k, clickT, cssX);      // repaint the card in place
      });
      scChips.appendChild(c);
    }
    lastPopX = cssX;
    // this section's colour, from the family (or a spread of basics with no family)
    const cols = document.getElementById('scCols');
    cols.innerHTML = '';
    const opts = [...familyPalette(), '#ffffff'];
    for (const c of opts) {
      const b = document.createElement('button');
      b.className = 'scSw' + (sec.col?.a === c ? ' active' : '');
      b.style.background = c; b.title = c;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const j = opts.indexOf(c);
        sections[k].col = { a: c, b: opts[(j + 2) % opts.length] };
        saveSections(); restyle();
        openSecPop(k, clickT, cssX);
      });
      cols.appendChild(b);
    }
    const none = document.createElement('button');   // let each pad keep its own colours here
    none.className = 'scSw scSwNone' + (sec.col === null ? ' active' : '');
    none.title = "Pad's own colours"; none.textContent = '×';
    none.addEventListener('click', (e) => {
      e.stopPropagation();
      sections[k].col = null; saveSections(); restyle(); openSecPop(k, clickT, cssX);
    });
    cols.appendChild(none);
    const mirror = document.getElementById('scMirror');
    mirror.textContent = `Mirror to all ${(padHooks?.sectionName?.(sec.id) ?? sec.id)}`;
    const twins = sections.filter((x) => x.id === sec.id).length - 1;
    mirror.disabled = twins < 1;
    mirror.title = twins < 1
      ? `This is the only ${padHooks?.sectionName?.(sec.id) ?? sec.id} — rename another section to match it`
      : `Give ${twins === 1 ? 'the other' : `all ${twins} other`} ${padHooks?.sectionName?.(sec.id) ?? sec.id} section${twins === 1 ? '' : 's'} this colour`;
    document.getElementById('scMerge').disabled = k === 0;
    document.getElementById('scToPlay').disabled = k === 0;
    document.getElementById('scSplit').disabled = clickT - sec.t < 2 || end - clickT < 2;
    secPop.classList.remove('hidden');
    const dr = panel.getBoundingClientRect(), wr = wave.getBoundingClientRect();
    const px = wr.left - dr.left + cssX;
    secPop.style.left = Math.max(10, Math.min(dr.width - secPop.offsetWidth - 10, px - secPop.offsetWidth / 2)) + 'px';
  }
  function closeSecPop() { popSec = -1; secPop.classList.add('hidden'); }
  document.getElementById('scSplit').addEventListener('click', (e) => {
    e.stopPropagation();
    if (popSec < 0) return;
    const host = sections[popSec];
    sections.splice(popSec + 1, 0, { t: popSecT, len: 0, level: host.level, id: host.id, trig: host.trig, part: host.part, col: host.col ? { ...host.col } : null });
    relenSections(); saveSections();
    openSecPop(popSec + 1, popSecT + 1, tx(popSecT, wave.getBoundingClientRect().width));
  });
  document.getElementById('scMerge').addEventListener('click', (e) => {
    e.stopPropagation();
    if (popSec <= 0) return;
    const m = autoAt(sections[popSec].t);
    if (m) deleteStamp(m);                // the stretch before grows and keeps its cue
    sections.splice(popSec, 1);
    relenSections(); saveSections();
    closeSecPop();
  });
  // the card's time line is also "take me there" — it already reads as a time
  document.getElementById('scSub').addEventListener('click', (e) => {
    e.stopPropagation();
    if (popSec >= 0 && sections[popSec]) { seekTo(sections[popSec].t); needsDraw = true; }
  });
  document.getElementById('scToPlay').addEventListener('click', (e) => {
    e.stopPropagation();
    if (popSec <= 0) return;                     // the first section always starts at 0:00
    const k = popSec, prev = sections[k - 1].t + 1;
    const next = k + 1 < sections.length ? sections[k + 1].t - 1 : engine.duration - 1;
    const nt = Math.max(prev, Math.min(next, engine.time()));
    const m = autoAt(sections[k].t);             // the section's cue comes with it
    sections[k].t = nt;
    if (m) { m.t = nt; markers.sort((a, b) => a.t - b.t); }
    relenSections(); saveStamps(); saveSections();
    openSecPop(k, nt + 1, tx(nt, wave.getBoundingClientRect().width));
  });
  document.getElementById('scMirror').addEventListener('click', (e) => {
    e.stopPropagation();
    const sec = sections[popSec];
    if (!sec) return;
    let n = 0;
    for (const x of sections) if (x.id === sec.id && x !== sec) { x.col = sec.col ? { ...sec.col } : null; n++; }
    saveSections(); restyle();
    const nm = padHooks?.sectionName?.(sec.id) ?? sec.id;
    padHooks?.hint?.(n ? `Every ${nm} now plays in this colour` : `This is the only ${nm} in the song`);
  });
  document.getElementById('scRescan').addEventListener('click', (e) => {
    e.stopPropagation();
    sections = []; closeSecPop();
    buildShow();                          // a clean read, then the cues to match
  });
  document.addEventListener('pointerdown', (e) => {
    if (!secPop.classList.contains('hidden') && !secPop.contains(e.target)) closeSecPop();
  });

  // --- adjust ------------------------------------------------------------------
  // The console wall is now behind one click. Remembered, because a user who
  // wants a lighting desk in front of them should only have to say so once —
  // and a first-timer should never be shown one they did not ask for.
  const ADJ_STORE = 'arena-adjust-v1';
  let adjustOn = false;
  try { adjustOn = localStorage.getItem(ADJ_STORE) === '1'; } catch (_) { /* private mode */ }
  const adjustBtn = document.getElementById('dirAdjust');
  function syncAdjust() {
    panel.classList.toggle('adjust', adjustOn);
    adjustBtn.title = adjustOn
      ? 'Hide the triggers, layers and subsystem switches'
      : 'Show the triggers, layers and subsystem switches';
  }
  const gearBtn = document.getElementById('dirGear');
  gearBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSettings(gearBtn); });
  adjustBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    adjustOn = !adjustOn;
    try { localStorage.setItem(ADJ_STORE, adjustOn ? '1' : '0'); } catch (_) { /* private mode */ }
    syncAdjust();
  });
  syncAdjust();


  const tagHitAt = (e) => {
    const r = wave.getBoundingClientRect();
    const sx = wave.width / r.width, sy = wave.height / r.height;
    const x = (e.clientX - r.left) * sx, y = (e.clientY - r.top) * sy;
    for (let k = markerHits.length - 1; k >= 0; k--) {
      const h = markerHits[k];
      if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) return h;
    }
    return null;
  };

  // A cue used to be fixed in place: get it wrong and the only repair was to
  // delete it and perform the pass again. A press on a tag is now HELD instead
  // of acted on — past the slop it drags the stamp, under it, it opens the card
  // exactly as before. Same gesture, two outcomes, decided by the pointer.
  const DRAG_SLOP = 4;        // matches the deck's pad drag in pads.js
  let tagDrag = null;         // { m, startX, cssX, group, moved }
  // The strip lives in its own band at the top of the canvas, so everything here
  // keys off y and the tag handlers below never have to know about it.
  const stripAt = (e) => {
    if (!sections.length || !engine.duration) return null;
    const r = wave.getBoundingClientRect();
    const sy = wave.height / r.height;
    const y = (e.clientY - r.top) * sy;
    if (!secStripH || y > secStripH) return null;
    const x = ((e.clientX - r.left) / r.width) * wave.width;
    const grab = 5 * (wave.width / r.width);
    for (let k = 1; k < sections.length; k++) {
      const ex = tx(sections[k].t, wave.width);
      if (Math.abs(x - ex) <= grab) return { kind: 'edge', k };
    }
    const band = secHits.find((h) => x >= h.x0 && x < h.x1);
    return band ? { kind: 'band', k: band.k } : null;
  };

  const tabAt = (e) => {
    if (!playTabHit) return false;
    const r = wave.getBoundingClientRect();
    const x = (e.clientX - r.left) * (wave.width / r.width), y = (e.clientY - r.top) * (wave.height / r.height);
    return x >= playTabHit.x0 && x <= playTabHit.x1 && y >= playTabHit.y0 && y <= playTabHit.y1;
  };
  wave.addEventListener('pointerdown', (e) => {
    if (!engine.buffer) return;
    if (tabAt(e)) {                                       // the edge tab: take me to the playhead
      e.stopPropagation();
      followPlay = true;
      setView(engine.time() - span() * 0.5, span());
      return;
    }
    // a boundary is a drag; the band itself is a jump to where that part starts
    const sh = stripAt(e);
    if (sh) {
      e.stopPropagation();
      if (sh.kind === 'edge') {
        // the cue at this edge belongs to it and rides along
        secDrag = { k: sh.k, moved: false, startX: e.clientX, stamp: autoAt(sections[sh.k].t) ?? null };
        wave.setPointerCapture(e.pointerId);
        closeSecPop();
      } else {
        const r = wave.getBoundingClientRect();
        openSecPop(sh.k, posToTime(e), e.clientX - r.left);
      }
      needsDraw = true;
      return;
    }
    const hit = tagHitAt(e);
    if (hit) {
      e.stopPropagation();   // …or the document-level closer would shut it instantly
      if (hit.kind === 'zone') return;   // gap inside a fanned bunch: not a seek
      const r = wave.getBoundingClientRect();
      const cssX = (hit.x0 + hit.x1) / 2 / (wave.width / r.width);
      // a bunch has no single time to drag to, so it still opens on the press
      if (hit.kind === 'stack') { openPopList([...hit.ms], cssX); return; }
      tagDrag = { m: hit.ms[0], startX: e.clientX, cssX, group: hit.groupKey, moved: false };
      wave.setPointerCapture(e.pointerId);
      return;
    }
    closePop();
    scrubbing = true;
    wave.setPointerCapture(e.pointerId);
    seekTo(posToTime(e));
    needsDraw = true;
  });
  let hoverKey = null;        // the individual tag under the cursor
  let hoverGroupKey = null;   // the bunch under the cursor — fans it open
  wave.addEventListener('pointermove', (e) => {
    hoverT = engine.buffer ? posToTime(e) : -1;
    if (secDrag) {
      if (e.buttons === 0) { endSecDrag(); return; }
      if (!secDrag.moved && Math.abs(e.clientX - secDrag.startX) < DRAG_SLOP) return;
      secDrag.moved = true;
      // stay inside the neighbours: a boundary that crosses one would reorder
      // the map, and the strip is only legible while it stays in time order
      const prev = sections[secDrag.k - 1].t + 1;
      const next = secDrag.k + 1 < sections.length ? sections[secDrag.k + 1].t - 1 : engine.duration - 1;
      const nt = Math.max(prev, Math.min(next, playheadSnap(hoverT)));
      sections[secDrag.k].t = nt;
      if (secDrag.stamp) { secDrag.stamp.t = nt; markers.sort((a, b) => a.t - b.t); }
      relenSections();
      wave.style.cursor = 'ew-resize';
      needsDraw = true;
      return;
    }
    if (tagDrag) {
      // the button can be released off-canvas; without this the tag would keep
      // following the cursor with nothing held down
      if (e.buttons === 0) { endTagDrag(); return; }
      if (!tagDrag.moved && Math.abs(e.clientX - tagDrag.startX) < DRAG_SLOP) return;
      if (!tagDrag.moved) { tagDrag.moved = true; closePop(); }   // its card would show a stale time
      tagDrag.m.t = snapTime(hoverT);
      markers.sort((a, b) => a.t - b.t);
      // saving on every move would hammer localStorage and fire the project
      // change listener a hundred times for one gesture — pointerup saves once
      hoverKey = tagDrag.m;              // keep its name chip under the cursor
      hoverGroupKey = tagDrag.group;     // and hold a fanned bunch open mid-drag
      wave.style.cursor = 'grabbing';
      needsDraw = true;
      return;
    }
    if (!scrubbing && tabAt(e)) { wave.style.cursor = 'pointer'; needsDraw = true; return; }
    const sh = scrubbing ? null : stripAt(e);
    hoverEdge = sh?.kind === 'edge' ? sh.k : null;
    if (sh) {
      wave.style.cursor = sh.kind === 'edge' ? 'ew-resize' : 'pointer';
      needsDraw = true;
      return;
    }
    if (scrubbing) seekTo(hoverT);
    const hit = scrubbing ? null : tagHitAt(e);
    hoverGroupKey = hit ? hit.groupKey : null;
    hoverKey = hit && hit.kind === 'tag' ? hit.ms[0] : null;
    // 'grab' on a tag is the only thing advertising that stamps can be moved
    wave.style.cursor = hit?.kind === 'tag' ? 'grab' : hit && hit.kind !== 'zone' ? 'pointer' : 'crosshair';
    needsDraw = true;
  });
  // right-click a stamp tag to remove it
  wave.addEventListener('contextmenu', (e) => {
    e.preventDefault();   // never show the browser menu over the deck
    const sh = stripAt(e);
    if (sh) {
      if (sh.kind === 'edge') {
        sections.splice(sh.k, 1);     // the stretch before it simply grows
        relenSections();
        saveSections();
      }
      return;
    }
    const hit = tagHitAt(e);
    if (!hit || hit.kind === 'zone') return;
    if (hit.kind === 'tag') {
      deleteStamp(hit.ms[0]);
      closePop();
    } else {
      const r = wave.getBoundingClientRect();
      openPopList([...hit.ms], (hit.x0 + hit.x1) / 2 / (wave.width / r.width));
    }
  });
  // A press that never moved is a click: open the card, as it always did.
  function endTagDrag() {
    if (!tagDrag) return;
    const { m, moved, cssX } = tagDrag;
    tagDrag = null; snapK = -1; snapPlay = false;
    if (moved && m.auto) {
      // you placed it: BUILD's rebuilds leave it alone from here (it keeps its look)
      delete m.auto;
      padHooks?.hint?.(`Moved to ${fmtTime(m.t)} — this cue is yours now, BUILD will leave it there`);
    }
    if (moved) saveStamps();
    else openPop(m, cssX);
    // the tag came to rest under the pointer, so it is grabbable again — without
    // this the cursor stays 'grabbing' until the mouse happens to move
    if (moved) wave.style.cursor = 'grab';
    needsDraw = true;
  }
  function endSecDrag() {
    if (!secDrag) return;
    const moved = secDrag.moved;
    secDrag = null; snapPlay = false;
    if (moved) { relenSections(); saveStamps(); saveSections(); }
    wave.style.cursor = 'ew-resize';
    needsDraw = true;
  }
  wave.addEventListener('pointerup', () => { scrubbing = false; endSecDrag(); endTagDrag(); });
  wave.addEventListener('pointercancel', () => { scrubbing = false; endSecDrag(); endTagDrag(); });
  // Split where the detector missed one (a smooth build has no plateau to find),
  // and right-click an edge to merge two it invented.
  wave.addEventListener('dblclick', (e) => {
    const sh = stripAt(e);
    if (!sh) { if (zoomed()) setView(0, engine.duration); return; }   // the waveform: zoom back out
    if (sh.kind !== 'band') return;
    e.preventDefault(); e.stopPropagation();
    const t = posToTime(e);
    const host = sections[sh.k];
    if (t - host.t < 2 || (sh.k + 1 < sections.length ? sections[sh.k + 1].t : engine.duration) - t < 2) return;
    sections.splice(sh.k + 1, 0, { t, len: 0, level: host.level, id: host.id, trig: host.trig, part: host.part, col: host.col ? { ...host.col } : null });
    relenSections();
    saveSections();
  });
  wave.addEventListener('pointerleave', () => {
    if (tagDrag) return;      // pointer capture keeps the drag alive off-canvas
    hoverT = -1; hoverKey = null; hoverGroupKey = null; needsDraw = true;
  });

  // --- waveform ---------------------------------------------------------------
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = wave.getBoundingClientRect();
    if (!r.width) return;
    W = Math.round(r.width * dpr); H = Math.round(r.height * dpr);
    if (wave.width !== W || wave.height !== H) { wave.width = W; wave.height = H; }
    needsDraw = true;
  }
  window.addEventListener('resize', resize);
  // the deck's flex row reflows when buttons appear (e.g. the clear-stamps
  // trash after a first recording) — the window never resizes, so watch the
  // canvas itself
  new ResizeObserver(() => resize()).observe(wave);

  function draw() {
    if (!peaks || !W) return;
    wctx.clearRect(0, 0, W, H);
    const t = engine.time(), dur = engine.duration;
    // while playing, a zoomed view pages along so the playhead never runs off it
    const offView = zoomed() && (t < viewT0 || t > viewT1);
    if (!offView) followPlay = true;                    // it came back to you: resume following
    if (offView && engine.playing && followPlay) setView(t - span() * 0.1, span());

    const barW = 2 * dpr, gap = 1.5 * dpr;
    const n = Math.floor(W / (barW + gap));
    // section strip on top, then the two tag rows. laneH stays the BOTTOM of the
    // tag lane so every stem, chip and hit rect below reads unchanged; only the
    // tags' own vertical centring has to know the lane no longer starts at 0.
    const stripH = sections.length && dur ? 22 * dpr : 0;
    secStripH = stripH;       // hit testing must use exactly what was drawn
    const laneTop = stripH;
    const laneH = stripH + 31 * dpr;
    const mid = laneH + (H - laneH) / 2, maxH = (H - laneH) * 0.86;
    const playedX = tx(t, W);

    // Section strip: the whole point is that the track reads as
    // intro / verse / chorus instead of as a shape you have to interpret.
    secHits = [];
    if (stripH) {
      wctx.font = `700 ${9.5 * dpr}px -apple-system, system-ui, Arial`;
      for (const [k, sec] of sections.entries()) {
        // clipped to the view: a section half off-screen still shows its visible half
        const x0 = Math.max(0, tx(sec.t, W));
        const x1 = Math.min(W, k + 1 < sections.length ? tx(sections[k + 1].t, W) : W);
        const w = Math.max(0, x1 - x0);
        if (w <= 0) { secHits.push({ k, x0: -1, x1: -1 }); continue; }
        const col = SECTION_COLORS[sec.id] ?? 'rgba(242,238,226,0.30)';
        const skipped = sec.id === 'skip';
        const active = popSec === k;
        wctx.globalAlpha = skipped ? 0.12 : active ? 0.85 : 0.55;
        wctx.fillStyle = skipped ? 'rgba(242,238,226,0.5)' : col;
        wctx.beginPath();
        wctx.roundRect(x0 + 0.5 * dpr, 0, Math.max(0, w - dpr), stripH - 4 * dpr, 4 * dpr);
        wctx.fill();
        wctx.globalAlpha = 1;
        // a faint rule down the whole lane: the boundary matters below too
        wctx.fillStyle = 'rgba(242,238,226,0.10)';
        if (k) wctx.fillRect(x0 - 0.5 * dpr, 0, dpr, H);
        const label = (padHooks?.sectionName?.(sec.id) ?? sec.id).toUpperCase();
        if (w > wctx.measureText(label).width + 8 * dpr) {
          wctx.fillStyle = skipped ? 'rgba(242,238,226,0.45)' : '#10121e';
          wctx.fillText(label, x0 + 6 * dpr, stripH - 10 * dpr);
        }
        // the section's own colour, as a bar under the label: the colour story at a glance
        if (sec.col?.a && !skipped) {
          wctx.fillStyle = sec.col.a;
          wctx.fillRect(x0 + 3 * dpr, stripH - 7.5 * dpr, Math.max(0, w - 6 * dpr), 3 * dpr);
        }
        secHits.push({ k, x0, x1 });
      }
      // grab handles on every inner edge, always visible: a handle you have to
      // hover to discover is not a handle. A snapped drag lights its target.
      for (let k = 1; k < sections.length; k++) {
        const x = tx(sections[k].t, W);
        if (x < 0 || x > W) continue;
        const on = (secDrag ? secDrag.k === k : hoverEdge === k) || snapK === k;
        wctx.fillStyle = on ? '#f2eee2' : 'rgba(242,238,226,0.7)';
        wctx.fillRect(x - (on ? 2 : 1.25) * dpr, 0, (on ? 4 : 2.5) * dpr, stripH - 4 * dpr);
        if (on) {   // a little cap so the lit handle reads as "this one"
          wctx.beginPath(); wctx.arc(x, stripH - 4 * dpr, 3 * dpr, 0, Math.PI * 2); wctx.fill();
        }
      }
    }

    for (let i = 0; i < n; i++) {
      // the bar at this x shows the peak at the TIME it represents in the view
      const p = peaks[Math.min(peaks.length - 1, Math.floor((xt(i * (barW + gap), W) / dur) * peaks.length))];
      const h = Math.max(2 * dpr, p * maxH);
      const x = i * (barW + gap);
      const played = x + barW <= playedX;
      const partial = !played && x < playedX;
      wctx.fillStyle = played
        ? 'rgba(217,178,96,0.95)'
        : partial ? 'rgba(217,178,96,0.55)' : 'rgba(242,238,226,0.22)';
      wctx.beginPath();
      wctx.roundRect(x, mid - h / 2, barW, h, barW / 2);
      wctx.fill();
    }
    // The playhead as a line. Paused, it is the beat you stopped on and the thing
    // a boundary or cue locks to — so it brightens and runs the full height,
    // strip included, while a drag is held on it.
    if (dur) {
      wctx.fillStyle = snapPlay ? '#f2eee2' : 'rgba(242,238,226,0.35)';
      wctx.fillRect(playedX - (snapPlay ? 1 : 0.5) * dpr, snapPlay ? 0 : laneTop, (snapPlay ? 2 : 1) * dpr, H - (snapPlay ? 0 : laneTop));
    }
    // Off-screen playhead: a gold tab at the edge it went past, with the time,
    // breathing so it reads as live. Click it to go there. Without this, zooming
    // out of the playhead's way while the track runs would leave you lost.
    playTabHit = null;
    if (dur && zoomed() && (t < viewT0 || t > viewT1)) {
      const left = t < viewT0;
      const label = left ? `\u25c2 ${fmtTime(t)}` : `${fmtTime(t)} \u25b8`;
      wctx.font = `700 ${10 * dpr}px -apple-system, system-ui, Arial`;
      const tw4 = wctx.measureText(label).width + 16 * dpr, th4 = 20 * dpr;
      const x0 = left ? 5 * dpr : W - tw4 - 5 * dpr, y0 = mid - th4 / 2;
      const pulse = engine.playing ? 0.8 + 0.2 * Math.sin(performance.now() * 0.006) : 0.9;
      wctx.globalAlpha = pulse;
      wctx.fillStyle = '#d9b260';
      wctx.beginPath(); wctx.roundRect(x0, y0, tw4, th4, 6 * dpr); wctx.fill();
      // and a hairline down the edge itself: "the playhead is beyond here"
      wctx.fillRect(left ? 0 : W - 2 * dpr, laneTop, 2 * dpr, H - laneTop);
      wctx.globalAlpha = 1;
      wctx.fillStyle = '#10121e';
      wctx.fillText(label, x0 + 8 * dpr, y0 + th4 / 2 + 3.5 * dpr);
      playTabHit = { x0, x1: x0 + tw4, y0, y1: y0 + th4 };
      if (engine.playing) needsDraw = true;             // keep the pulse alive while it runs
    }

    // Each cue's fade line over the wave: its trigger's line from the cue on,
    // cut where the next cue takes over, and held level (dashed) after it ends
    // until then. Low on the line is the room in blackout (main.js plays it).
    if (dur && markers.length && padHooks?.fadeOf) {
      const yTop = laneH + 5 * dpr, yH = Math.max(4, H - laneH - 10 * dpr);
      const Y = (v) => yTop + (1 - v) * yH;
      for (let mi = 0; mi < markers.length; mi++) {
        const m = markers[mi];
        if (m.empty) continue;
        const f = padHooks.fadeOf(m.layer, m.pad);
        if (!f || !Array.isArray(f.pts) || f.pts.length < 2 || !(f.dur > 0)) continue;
        const tEnd = mi + 1 < markers.length ? markers[mi + 1].t : dur;
        if (tEnd < v0() || m.t > v0() + span()) continue;
        const stop = Math.min(tEnd, m.t + f.dur);
        const pts = [];
        for (let k = 0; k < f.pts.length; k++) {
          const [pt, pv] = f.pts[k], tt = m.t + pt * f.dur;
          if (tt >= stop && k > 0) {
            const [qt, qv] = f.pts[k - 1], t0 = m.t + qt * f.dur;
            pts.push([stop, qv + (pv - qv) * ((stop - t0) / Math.max(1e-6, tt - t0))]);
            break;
          }
          pts.push([tt, pv]);
        }
        const col = padHooks?.color?.(m.layer) ?? '#d9b260';
        wctx.save();
        wctx.beginPath();
        pts.forEach(([tt, v], k) => (k ? wctx.lineTo(tx(tt, W), Y(v)) : wctx.moveTo(tx(tt, W), Y(v))));
        wctx.lineTo(tx(pts[pts.length - 1][0], W), yTop + yH);
        wctx.lineTo(tx(pts[0][0], W), yTop + yH);
        wctx.closePath();
        wctx.globalAlpha = 0.13;
        wctx.fillStyle = col;
        wctx.fill();
        wctx.globalAlpha = 0.95;
        wctx.strokeStyle = col;
        wctx.lineWidth = 1.6 * dpr;
        wctx.beginPath();
        pts.forEach(([tt, v], k) => (k ? wctx.lineTo(tx(tt, W), Y(v)) : wctx.moveTo(tx(tt, W), Y(v))));
        wctx.stroke();
        const last = pts[pts.length - 1];
        if (last[0] < tEnd - 1e-3) {
          wctx.setLineDash([3 * dpr, 3 * dpr]);
          wctx.globalAlpha = 0.55;
          wctx.beginPath();
          wctx.moveTo(tx(last[0], W), Y(last[1]));
          wctx.lineTo(tx(tEnd, W), Y(last[1]));
          wctx.stroke();
          wctx.setLineDash([]);
        }
        wctx.restore();
      }
    }

    // cue stamps. Tags that would collide collapse into a dark count pill —
    // and HOVERING the pill fans the bunch open into its individual tags,
    // spread left-to-right in time order, each one directly clickable. Moving
    // away collapses it again. No click needed just to see what's in there.
    markerHits = [];
    let hoverName = null;   // name chip for the hovered tag, drawn last
    if (dur && markers.length) {
      const tw = 13 * dpr, th = 13 * dpr;
      const groups = [];
      // only what the view can show, with a tag's width of slack either side
      const slack = xt(tw, W) - xt(0, W);
      for (const m of markers) {
        if (m.t < v0() - slack || m.t > v0() + span() + slack) continue;
        const mx = tx(m.t, W);
        const g = groups[groups.length - 1];
        if (g && mx - g.x1 < tw * 1.15) { g.ms.push(m); g.x1 = mx; }
        else groups.push({ ms: [m], x0: mx, x1: mx });
      }
      const drawTag = (m, x0, y0, w, h, alpha) => {
        wctx.globalAlpha = alpha;
        if (m.empty) {
          // a mark with no look yet: the outline of a tag, waiting to be filled
          wctx.strokeStyle = '#d9b260'; wctx.lineWidth = 1.2 * dpr;
          wctx.beginPath(); wctx.roundRect(x0 + 0.6 * dpr, y0 + 0.6 * dpr, w - 1.2 * dpr, h - 1.2 * dpr, 4 * dpr); wctx.stroke();
          wctx.fillStyle = '#d9b260';
          wctx.beginPath(); wctx.arc(x0 + w / 2, y0 + h / 2, 1.6 * dpr, 0, Math.PI * 2); wctx.fill();
          wctx.globalAlpha = 1;
          return;
        }
        wctx.fillStyle = padHooks?.color?.(m.layer) ?? '#d9b260';
        wctx.beginPath();
        wctx.roundRect(x0, y0, w, h, 4 * dpr);
        wctx.fill();
        wctx.globalAlpha = 1;
        wctx.fillStyle = '#10121e';
        wctx.font = `700 ${8.5 * (h / th) * dpr}px -apple-system, system-ui, Arial`;
        const label = padKey(m.pad);
        wctx.fillText(label, x0 + w / 2 - wctx.measureText(label).width / 2, y0 + h / 2 + 3 * (h / th) * dpr);
      };
      for (const gp of groups) {
        const key = gp.ms[0];
        const cx = (gp.x0 + gp.x1) / 2;
        const stack = gp.ms.length > 1;
        const fanned = stack && hoverGroupKey === key;
        // stems always at TRUE positions, so grouping never hides real timing
        for (const m of gp.ms) {
          wctx.globalAlpha = 0.3;
          wctx.fillStyle = padHooks?.color?.(m.layer) ?? '#d9b260';
          wctx.fillRect(tx(m.t, W) - 0.5 * dpr, laneH, dpr, H - laneH);
        }
        wctx.globalAlpha = 1;
        if (fanned) {
          // spread the bunch: one tag per stamp, oldest on the left
          const n2 = gp.ms.length;
          const step = tw + 4 * dpr;
          const totalW = n2 * tw + (n2 - 1) * 4 * dpr;
          const startX = Math.max(2 * dpr, Math.min(W - totalW - 2 * dpr, cx - totalW / 2));
          // keep-alive zone so the fan survives the cursor moving between tags
          markerHits.push({ kind: 'zone', ms: gp.ms, groupKey: key,
            x0: startX - 8 * dpr, x1: startX + totalW + 8 * dpr, y0: laneTop, y1: laneH });
          gp.ms.forEach((m, mi) => {
            const hov = hoverKey === m;
            const scT = hov ? 1.22 : 1;
            const w = tw * scT, h = th * scT;
            const x0 = startX + mi * step - (w - tw) / 2;
            const y0 = laneTop + (laneH - laneTop - h) / 2;
            // connector down to the stamp's true position on the wave
            wctx.strokeStyle = padHooks?.color?.(m.layer) ?? '#d9b260';
            wctx.globalAlpha = 0.4;
            wctx.lineWidth = dpr;
            wctx.beginPath();
            wctx.moveTo(x0 + w / 2, y0 + h);
            wctx.lineTo(tx(m.t, W), laneH + 3 * dpr);
            wctx.stroke();
            wctx.globalAlpha = 1;
            drawTag(m, x0, y0, w, h, 1);
            if (hov) hoverName = { m, x: x0 + w / 2 };
            markerHits.push({ kind: 'tag', ms: [m], groupKey: key,
              x0: x0 - 2 * dpr, x1: x0 + w + 2 * dpr, y0: laneTop, y1: laneH });
          });
        } else if (stack) {
          // collapsed: a count pill with one colour segment per stamp
          const hovered = hoverGroupKey === key;
          const sc = hovered ? 1.15 : 1;
          const w = tw * 1.7 * sc, h = th * sc;
          const x0 = Math.max(0, Math.min(W - w, cx - w / 2));
          const y0 = laneTop + (laneH - laneTop - h) / 2;
          wctx.fillStyle = 'rgba(24,27,34,0.96)';
          wctx.beginPath();
          wctx.roundRect(x0, y0, w, h, 4 * dpr);
          wctx.fill();
          wctx.strokeStyle = 'rgba(242,238,226,0.4)';
          wctx.lineWidth = dpr;
          wctx.stroke();
          const seg = (w - 4 * dpr) / gp.ms.length;
          gp.ms.forEach((m, si) => {
            wctx.fillStyle = padHooks?.color?.(m.layer) ?? '#d9b260';
            wctx.fillRect(x0 + 2 * dpr + si * seg, y0 + h - 3 * dpr, seg - (si < gp.ms.length - 1 ? dpr : 0), 2 * dpr);
          });
          wctx.fillStyle = '#f2eee2';
          wctx.font = `700 ${8.5 * sc * dpr}px -apple-system, system-ui, Arial`;
          const label = `${gp.ms.length}▾`;
          wctx.fillText(label, x0 + w / 2 - wctx.measureText(label).width / 2, y0 + h / 2 + 3 * sc * dpr);
          markerHits.push({ kind: 'stack', ms: gp.ms, groupKey: key,
            x0: x0 - 2 * dpr, x1: x0 + w + 2 * dpr, y0: laneTop, y1: laneH });
        } else {
          const m = gp.ms[0];
          const hov = hoverKey === m;
          const sc = hov ? 1.3 : 1;
          const w = tw * sc, h = th * sc;
          const x0 = Math.max(0, Math.min(W - w, cx - w / 2));
          const y0 = laneTop + (laneH - laneTop - h) / 2;
          drawTag(m, x0, y0, w, h, hov ? 1 : (m.t <= t ? 1 : 0.62));
          if (hov) hoverName = { m, x: x0 + w / 2 };
          markerHits.push({ kind: 'tag', ms: [m], groupKey: key,
            x0: x0 - 2 * dpr, x1: x0 + w + 2 * dpr, y0: laneTop, y1: laneH });
        }
      }
      wctx.globalAlpha = 1;
    }

    // playhead: hairline with a soft cap — red while recording
    if (dur) {
      wctx.fillStyle = recording ? 'rgba(226,74,74,0.95)' : 'rgba(242,238,226,0.9)';
      wctx.fillRect(playedX - 0.5 * dpr, mid - maxH / 2, dpr, maxH);
      wctx.beginPath();
      wctx.arc(playedX, mid - maxH / 2, 2.5 * dpr, 0, 6.3);
      wctx.fill();
    }

    // hovered tag: its full name in a chip just under the lane
    if (hoverName && padHooks) {
      const label = `${padHooks.name?.(hoverName.m.layer, hoverName.m.pad) ?? ''} · ${fmtTime(hoverName.m.t)}`;
      wctx.font = `600 ${9.5 * dpr}px -apple-system, system-ui, Arial`;
      const tw2 = wctx.measureText(label).width + 12 * dpr;
      const bx = Math.max(2, Math.min(W - tw2 - 2, hoverName.x - tw2 / 2));
      wctx.fillStyle = 'rgba(10,12,18,0.94)';
      wctx.beginPath();
      wctx.roundRect(bx, laneH + 2 * dpr, tw2, 15 * dpr, 7.5 * dpr);
      wctx.fill();
      wctx.fillStyle = 'rgba(242,238,226,0.92)';
      wctx.fillText(label, bx + 6 * dpr, laneH + 13 * dpr);
    }

    // hover ghost + time chip
    if (hoverT >= 0 && dur && !scrubbing && (tagDrag?.moved || (!hoverKey && !hoverGroupKey))) {
      const hx = tx(hoverT, W);
      wctx.fillStyle = 'rgba(242,238,226,0.28)';
      wctx.fillRect(hx - 0.5 * dpr, mid - maxH / 2, dpr, maxH);
      const label = fmtTime(hoverT);
      wctx.font = `${10 * dpr}px -apple-system, system-ui, Arial`;
      const tw = wctx.measureText(label).width + 10 * dpr;
      const bx = Math.max(2, Math.min(W - tw - 2, hx - tw / 2));
      wctx.fillStyle = 'rgba(10,12,18,0.92)';
      wctx.beginPath();
      wctx.roundRect(bx, 2, tw, 14 * dpr, 7 * dpr);
      wctx.fill();
      wctx.fillStyle = 'rgba(242,238,226,0.85)';
      wctx.fillText(label, bx + 5 * dpr, 2 + 10.5 * dpr);
    }

    // where you are in the song while zoomed, and how to get out again
    if (zoomed()) {
      const label = `${fmtTime(viewT0)} \u2013 ${fmtTime(viewT1)}  \u00b7  dbl-click to see all`;
      wctx.font = `600 ${9 * dpr}px -apple-system, system-ui, Arial`;
      const tw3 = wctx.measureText(label).width + 12 * dpr;
      wctx.fillStyle = 'rgba(10,12,18,0.85)';
      wctx.beginPath(); wctx.roundRect(W - tw3 - 4 * dpr, H - 17 * dpr, tw3, 14 * dpr, 7 * dpr); wctx.fill();
      wctx.fillStyle = 'rgba(242,238,226,0.7)';
      wctx.fillText(label, W - tw3 + 2 * dpr, H - 6.5 * dpr);
    }
    timeEl.textContent = `${fmtTime(t)} / ${fmtTime(dur)}`;
  }

  // Cue engine: fire every stamp the playhead crossed since the last frame.
  // Runs whether or not the panel is on screen — the show follows the music,
  // not the UI. A backwards jump (seek, replay-from-top) resyncs instead.
  function cueTick() {
    if (!engine.playing || !padHooks || !markers.length) return;
    const t = engine.time();
    if (t < lastCueT) { cueResync(t); return; }
    for (const m of markers) {
      if (m.t > lastCueT && m.t <= t) {
        autoFiring = true;
        liveCue = m;
        // an edited cue plays YOUR version when it comes round again, which is
        // the whole point of editing in context
        fireMarker(m);
        autoFiring = false;
      }
    }
    lastCueT = t;
  }

  // Self-driven UI loop, independent of the WebGL loop: redraws only while
  // audible time is advancing or something changed under the cursor.
  (function tick() {
    cueTick();
    if (open && (engine.playing || needsDraw)) {
      needsDraw = false;
      draw();
      syncPlayIcon();
    }
    requestAnimationFrame(tick);
  })();

  return {
    toggle, engine, notifyTrigger, exportProject, importProject, loadProjectParts,
    toggleSettings, addStampAt, timeAtClientX, snapTime,
    setChangeListener(fn) { changeListener = fn; },
    setPadHooks(h) { padHooks = h; paintVibe(); },
    // a look was just stored on a pad: edits in flight were for that look,
    // and it is now kept exactly, so none of them stand any more
    padStored() { pendings = []; savePending(); paintEditBar(); },
    // something drawn on the lane changed elsewhere (a trigger: its look or
    // its fade line, maybe by an undo): the lane and an open cue card follow
    redraw() {
      needsDraw = true;
      if (cueFade.open && cueFade.who) cueFade.sync(padHooks?.fadeOf?.(cueFade.who.layer, cueFade.who.pad));
      if (popMarker) { paintFadeBtn(); if (!cueFade.open) pop.classList.remove('withFade'); }
    },
    // the track's cues, sections and held edits, for undo (history.js), which
    // turns them to JSON at once, so no copy here
    getCues() {
      if (!engine.buffer) return null;
      return { key: trackKey, markers, sections, pendings };
    },
    setCues(c) {
      if (!c || !engine.buffer || c.key !== trackKey) return;
      closePop();   // the card holds a stamp by reference; that stamp is gone
      markers = JSON.parse(JSON.stringify(c.markers || []));
      sections = JSON.parse(JSON.stringify(c.sections || []));
      pendings = JSON.parse(JSON.stringify(c.pendings || []));
      saveStamps(); saveSections(); savePending();
      paintEditBar();
      needsDraw = true;
    },
    get open() { return open; },
    get markers() { return markers; },
    fireCue: (m) => { autoFiring = true; fireMarker(m); autoFiring = false; },   // a cue as it would play now
    // the playhead was moved from outside (a recording starting the song from
    // the top): the cue on at that moment comes on, and the rest follow from there
    resyncCues: (t) => cueResync(t),
    // one step of the cue engine, for an offline render that moves the song's clock itself
    tickCues: () => cueTick(),
    // the whole-show file (showfile.js, main.js): what the timeline holds, and putting it back
    setProjectHandlers(h) { projectHandlers = h; },
    getProject() {
      return { audioFile: engine.file || null, markers, sections, style, pendings };
    },
    async loadProject({ audioFile = null, markers: ms = [], sections: secs = null, style: sty = null, pendings: pend = null } = {}) {
      if (!audioFile) return false;
      await loadProjectParts(audioFile, ms);
      if (Array.isArray(secs)) { sections = JSON.parse(JSON.stringify(secs)); saveSections(); }
      if (sty && typeof sty === 'object') { style = { ...style, ...sty }; saveStyle(); }
      pendings = Array.isArray(pend) ? JSON.parse(JSON.stringify(pend)) : [];
      savePending();
      paintEditBar();
      paintStyle();
      needsDraw = true;
      return true;
    },
    get sections() { return sections; },
    get style() { return style; },
    get recording() { return recording; },
  };
}
