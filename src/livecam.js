// Live camera: a webcam, or any other video input the browser can see (a
// capture card, OBS's virtual camera, a phone used as a continuity camera),
// turned into a live video source. The camera pipeline (camfx.js) turns each
// frame into the adjusted picture, the hand tracking and the shapes; main.js
// lays the result over the crowd by one of seven aims and puts it on the
// screens when asked. This module owns the device, its settings and the
// CAMERA window.
//
// The picture never leaves the browser: nothing here touches the network.
import { makeMovable } from './windows.js';
import { PICTURE_DEFAULTS, BOX_DEFAULT } from './camfx.js';

const PREFS_KEY = 'ht-livecam';
// sessionStorage, so it survives the reload of a venue switch and nothing else
const RESUME_KEY = 'ht-livecam-resume';

const ERRORS = {
  insecure: 'This page can’t reach a camera from here. Open it on localhost or over https.',
  NotAllowedError: 'Camera access is blocked. Allow the camera for this page in the browser’s site settings, then press Start again.',
  SecurityError: 'Camera access is blocked. Allow the camera for this page in the browser’s site settings, then press Start again.',
  NotFoundError: 'No camera found. Plug one in, then press Start again.',
  OverconstrainedError: 'That camera is not available any more. Pick another one, then press Start again.',
  NotReadableError: 'The camera is busy. Close any other app that is using it, then press Start again.',
  AbortError: 'The camera is busy. Close any other app that is using it, then press Start again.',
  ended: 'The camera disconnected.',
};

// How the picture lands on the crowd; main.js (remapVideo) does the mapping.
// The first five lay it over the seating sections and leave the floor dark.
const AIMS = ['stage', 'front', 'farend', 'sides', 'round', 'view', 'plan'];
const AIM_NAMES = {
  stage: 'Stage', front: 'Out front', farend: 'Far end', sides: 'Each side',
  round: 'All round', view: 'My view ⟳', plan: 'Top-down',
};
const AIM_NOTES = {
  stage: 'Seen from the stage: wrapped across the stands and stretched from the front row of the 100s to the back row of the 400s. The floor stays dark.',
  front: 'Every section out in front of the stage, 100s to 400s, seen from the stage. Nothing beside or behind the stage, and the floor stays dark.',
  farend: 'One big picture on the stands facing the stage, the easiest to read from the stage. The rest stays dark.',
  sides: 'The whole picture on every side of the bowl, upright as you face that side.',
  round: 'One picture wrapped all the way round the bowl, with the seam behind the stage.',
  view: 'From where you are standing now, flat to your eye. Click My view again, or press Shift + V, to re-aim.',
  plan: 'Over the plan of the venue, the way show video is mapped. The floor lights too.',
};
// the stage-based aims get a button that walks you up there to look
const FROM_STAGE = new Set(['stage', 'front', 'farend']);
const RESOLUTIONS = { 480: [854, 480], 720: [1280, 720], 1080: [1920, 1080] };
// what a camera may let the browser control, and what to call it
const HARDWARE = [
  ['exposureMode', 'Exposure'], ['exposureCompensation', 'Exposure level'], ['exposureTime', 'Shutter'],
  ['iso', 'ISO'], ['whiteBalanceMode', 'White balance'], ['colorTemperature', 'Colour temperature'],
  ['focusMode', 'Focus'], ['focusDistance', 'Focus distance'], ['brightness', 'Brightness'],
  ['contrast', 'Contrast'], ['saturation', 'Saturation'], ['sharpness', 'Sharpness'], ['zoom', 'Zoom'],
];
// a manual value only takes when its mode is manual: set both together
const NEEDS_MANUAL = { exposureTime: 'exposureMode', colorTemperature: 'whiteBalanceMode', focusDistance: 'focusMode' };

function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (_) { return {}; }
}

export function initLiveCam(api) {
  const prefs = readPrefs();
  const pic = { ...PICTURE_DEFAULTS };
  if (prefs.picture && typeof prefs.picture === 'object') {
    for (const k of Object.keys(pic)) if (Number.isFinite(prefs.picture[k])) pic[k] = prefs.picture[k];
  }
  const st = {
    live: false,
    starting: false,
    error: '',
    devices: [],
    deviceId: typeof prefs.deviceId === 'string' ? prefs.deviceId : '',
    res: RESOLUTIONS[prefs.res] ? String(prefs.res) : '720',
    fps: prefs.fps === 60 ? 60 : 30,
    mirror: prefs.mirror !== false,                     // selfie view by default
    // Stage is the default. Settings saved before it existed are moved onto it
    // once, instead of keeping the old My view default forever.
    aim: prefs.v >= 2 && AIMS.includes(prefs.aim) ? prefs.aim : 'stage',
    spread: Number.isFinite(prefs.spread) ? prefs.spread : 240,   // degrees round the bowl
    screens: prefs.screens === true,
    contrast: Number.isFinite(prefs.contrast) ? prefs.contrast : 1.35,   // "Punch" on the wristbands
    glow: Number.isFinite(prefs.glow) ? prefs.glow : 1.7,
    tab: ['source', 'picture', 'crowd'].includes(prefs.tab) ? prefs.tab : 'source',
    // the output box: only the middle of the picture goes out, framed in green
    box: Number.isFinite(prefs.box) ? Math.min(1, Math.max(0.25, prefs.box)) : BOX_DEFAULT,
    // 'mark': the camera is aimed at the X on stage and only sees you there
    pickup: prefs.pickup === 'anywhere' ? 'anywhere' : 'mark',
  };
  let pipe = null;   // the camera pipeline, attached by main.js
  const savePrefs = () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        v: 3, deviceId: st.deviceId, res: st.res, fps: st.fps, mirror: st.mirror,
        aim: st.aim, spread: st.spread, screens: st.screens, contrast: st.contrast, glow: st.glow,
        picture: pipe ? pipe.cfg.picture : pic, tab: st.tab, box: st.box, pickup: st.pickup,
      }));
    } catch (_) { /* private mode: settings last for this visit */ }
  };

  // The raw camera. The pipeline reads it; it stays in the page (under the
  // preview) so browsers keep decoding its frames while the window is closed.
  const video = document.createElement('video');
  video.className = 'camVideo';
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video._frameSeq = undefined;   // the pipeline processes a frame only when this moves
  let stream = null;

  // --- new-frame counter ----------------------------------------------------
  // requestVideoFrameCallback fires once per camera frame, so the pipeline and
  // the orbs work 30 times a second instead of once per render. If the
  // callbacks stop (some browsers pause them for a video nobody can see), the
  // counter is dropped and the pipeline watches the video clock instead.
  const RVFC = typeof video.requestVideoFrameCallback === 'function';
  let lastFrameAt = 0;
  function onFrame() {
    if (!stream) return;
    video._frameSeq = (video._frameSeq ?? 0) + 1;
    lastFrameAt = performance.now();
    video.requestVideoFrameCallback(onFrame);
  }
  setInterval(() => {
    if (stream && RVFC && performance.now() - lastFrameAt > 400) video._frameSeq = undefined;
  }, 250);

  // --- the device -------------------------------------------------------------
  const sizeOf = () => {
    const [w, h] = RESOLUTIONS[st.res];
    return { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: st.fps } };
  };
  const constraints = (id) => ({ audio: false, video: { ...sizeOf(), ...(id ? { deviceId: { exact: id } } : {}) } });
  const track = () => stream?.getVideoTracks()[0] || null;
  function release() {
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
  async function listDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      // labels stay blank until the page has been allowed a camera once
      st.devices = all.filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
    } catch (_) { st.devices = []; }
    render();
  }
  async function start(deviceId = st.deviceId) {
    if (st.starting) return;
    if (!navigator.mediaDevices?.getUserMedia) { st.error = ERRORS.insecure; render(); return; }
    st.starting = true;
    st.error = '';
    render();
    try {
      let s;
      try {
        s = await navigator.mediaDevices.getUserMedia(constraints(deviceId));
      } catch (err) {
        // the remembered camera is gone: take whichever one the browser offers
        if (!deviceId || !['OverconstrainedError', 'NotFoundError'].includes(err?.name)) throw err;
        s = await navigator.mediaDevices.getUserMedia(constraints(''));
      }
      release();                          // the previous camera, when switching
      stream = s;
      video.srcObject = s;
      await video.play().catch(() => { /* autoplay of a muted stream: plays on its own */ });
      const t = s.getVideoTracks()[0];
      st.deviceId = t?.getSettings?.().deviceId || deviceId || '';
      t?.addEventListener('ended', () => { if (stream === s) stop('ended'); });
      st.live = true;
      if (RVFC) {
        video._frameSeq = 0;
        lastFrameAt = performance.now();
        video.requestVideoFrameCallback(onFrame);
      }
      savePrefs();
      listDevices();
      buildHardware();
      api.onChange?.({ reaim: st.aim === 'view' });
    } catch (err) {
      st.error = ERRORS[err?.name] || `The camera couldn’t start (${err?.name || 'unknown error'}).`;
    } finally {
      st.starting = false;
      render();
    }
  }
  function stop(reason) {
    const was = st.live;
    release();
    video.srcObject = null;
    video._frameSeq = undefined;
    st.live = false;
    st.error = reason === 'ended' ? ERRORS.ended : '';
    buildHardware();
    render();
    if (was) api.onChange?.({});
  }
  // a new resolution or frame rate: ask the running camera, restart if it refuses
  async function applySize() {
    savePrefs();
    const t = track();
    if (!t) return;
    try { await t.applyConstraints(sizeOf()); } catch (_) { await start(st.deviceId); }
    render();
  }
  // paint the picture on the crowd in front of you, from where you stand
  function aimAtView() {
    if (!st.live) return;
    st.aim = 'view';
    savePrefs();
    api.onChange?.({ reaim: true });
    render();
    toast('Camera aimed at your view');
  }
  navigator.mediaDevices?.addEventListener?.('devicechange', () => listDevices());

  // --- window ---------------------------------------------------------------------
  const seg = (opts) => `<div class="bSeg">${opts.map(([k, n, title]) => `<button class="bOpt" data-k="${k}"${title ? ` title="${title}"` : ''}>${n}</button>`).join('')}</div>`;
  const slider = (k, label, min, max, step, unit) =>
    `<div class="bRow" data-f="${k}"><span class="bLabel">${label} <span class="camVal"></span></span><input type="range" class="camRange" data-k="${k}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" aria-label="${label}"></div>`;
  const root = document.createElement('div');
  root.id = 'camPanel';
  root.className = 'dockPanel';
  root.innerHTML = `
    <div class="bHead"><span class="bTitle">◉ LIVE CAMERA</span><span class="bHint">on the wristbands</span><button class="bClose" aria-label="Close">✕</button></div>
    <div class="bBody">
      <div class="camStage">
        <div class="camIdle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3l2-3h8l2 3h3v12H3z"/><circle cx="12" cy="13" r="4"/></svg><span>Camera off</span></div>
        <div class="camBox"><span>OUTPUT</span></div>
        <div class="camOffX"><b>OFF THE X</b><span>The camera only sees the X on stage</span><button class="camToX">Take me to the X</button></div>
        <span class="camBadge">● LIVE</span>
      </div>
      <button class="camGo"></button>
      <p class="camMsg"></p>
      <div class="camTabs">${[['source', 'Source'], ['picture', 'Picture'], ['crowd', 'Crowd']].map(([k, n]) => `<button data-tab="${k}">${n}</button>`).join('')}</div>
      <div class="bSection camTab" data-tab="source">
        <div class="bRow" data-f="pickup"><span class="bLabel">Picks you up</span>${seg([['mark', 'Only on the X', 'The camera is aimed at the X on stage'], ['anywhere', 'Anywhere']])}
          <p class="camAimNote">A camera aimed at the X on stage: it only sees you, and tracks your hands, while you stand on the X. <button class="camToX">Take me to the X</button></p></div>
        <div class="bRow" data-f="device"><span class="bLabel">Camera</span><select class="camSelect" aria-label="Camera"></select></div>
        <div class="bRow" data-f="res"><span class="bLabel">Resolution</span>${seg([['480', '480p'], ['720', '720p'], ['1080', '1080p']])}</div>
        <div class="bRow" data-f="fps"><span class="bLabel">Frame rate</span>${seg([['30', '30 fps'], ['60', '60 fps']])}</div>
        <div class="bRow" data-f="mirror"><span class="bLabel">Mirror</span>${seg([['on', 'On', 'Flip it like a selfie view'], ['off', 'Off']])}</div>
        <div class="bRow camHw"><span class="bLabel">Camera hardware</span><div class="camHwRows"></div></div>
      </div>
      <div class="bSection camTab" data-tab="picture">
        ${slider('brightness', 'Brightness', 0.3, 2.5, 0.02, '%')}
        ${slider('contrast', 'Contrast', 0.3, 2.5, 0.02, '%')}
        ${slider('saturation', 'Saturation', 0, 3, 0.02, '%')}
        ${slider('hue', 'Hue', -180, 180, 1, 'deg')}
        ${slider('zoom', 'Zoom', 1, 4, 0.05, 'x')}
        <button class="camReset">Reset the picture</button>
        <p class="camAimNote camNoFilter" hidden>This browser can’t adjust the picture itself. Zoom and mirror still work.</p>
      </div>
      <div class="bSection camTab" data-tab="crowd">
        <div class="bRow" data-f="box"><span class="bLabel">Output box <span class="camVal"></span></span><input type="range" class="camRange" data-k="box" data-unit="%" min="0.25" max="1" step="0.05" aria-label="Output box">
          <p class="camAimNote">Only what’s inside the green box goes to the wristbands and screens.</p></div>
        <div class="bRow" data-f="aim"><span class="bLabel">Aim</span><div class="bSeg camAims">
          ${AIMS.map((k) => `<button class="bOpt" data-k="${k}">${AIM_NAMES[k]}</button>`).join('')}</div>
          <p class="camAimNote"><span class="camAimText"></span> <button class="camFromStage">See it from the stage</button></p></div>
        ${slider('spread', 'Spread', 60, 300, 5, 'deg')}
        <div class="bRow" data-f="screens"><span class="bLabel">Screens</span>${seg([['off', 'Wristbands only'], ['on', 'Screens too', 'The video screens show the camera too']])}</div>
        ${slider('glow', 'Glow', 0.6, 2.6, 0.05, '%')}
        ${slider('punch', 'Punch', 0.8, 2.2, 0.05, '%')}
      </div>
      <p class="camNote">V opens this window, Shift + V aims the picture where you look. It never leaves this computer.</p>
    </div>`;
  const stage = root.querySelector('.camStage');
  stage.prepend(video);
  document.body.appendChild(root);
  const $ = (sel) => root.querySelector(sel);
  const goBtn = $('.camGo'), msg = $('.camMsg'), select = $('.camSelect'), hwRows = $('.camHwRows');
  const ranges = [...root.querySelectorAll('.camRange')];

  const fab = document.createElement('button');
  fab.id = 'camFab';
  fab.title = 'Live camera on the wristbands (V)';
  fab.innerHTML = '<span class="cfDot"></span><span class="cfLabel">CAMERA</span><kbd>V</kbd>';
  (document.getElementById('fabDock') || document.body).appendChild(fab);
  const win = makeMovable(root, { handle: '.bHead', key: 'camera' });

  // sliders read and write the right place: the picture lives in the pipeline
  const PICTURE = new Set(Object.keys(PICTURE_DEFAULTS));
  const get = (k) => (PICTURE.has(k) ? (pipe ? pipe.cfg.picture[k] : pic[k]) : k === 'punch' ? st.contrast : st[k]);
  const set = (k, v) => {
    if (PICTURE.has(k)) { if (pipe) pipe.cfg.picture[k] = v; else pic[k] = v; }
    else if (k === 'punch') st.contrast = v;
    else st[k] = v;
    if (k === 'box' && pipe) pipe.cfg.box = v;
  };
  // the green box over the preview, which takes the picture's own shape so
  // the box sits exactly where the output is cut from
  const boxEl = root.querySelector('.camBox');
  function placeBox() {
    const m = `${(((1 - st.box) / 2) * 100).toFixed(2)}%`;
    boxEl.style.inset = `${m} ${m}`;
    if (pipe?.height) stage.style.aspectRatio = `${pipe.width} / ${pipe.height}`;
  }
  const showVal = (r) => {
    const v = get(r.dataset.k), u = r.dataset.unit;
    r.closest('.bRow').querySelector('.camVal').textContent =
      u === 'deg' ? `${Math.round(v)}°` : u === 'x' ? `${v.toFixed(2)}×` : `${Math.round(v * 100)}%`;
  };

  let open = false;
  let offX = false;
  function render() {
    // live, aimed at the X, and nobody on it: the camera sees an empty spot
    offX = st.live && st.pickup === 'mark' && (api.status?.() || {}).onMark === false;
    root.classList.toggle('offx', offX);
    root.classList.toggle('live', st.live);
    fab.classList.toggle('live', st.live);
    goBtn.textContent = st.starting ? 'Starting…' : st.live ? 'Stop camera' : 'Start camera';
    goBtn.disabled = st.starting;
    for (const b of root.querySelectorAll('.bOpt')) {
      const f = b.closest('.bRow')?.dataset.f;
      if (!f) continue;
      const val = f === 'pickup' ? st.pickup : f === 'mirror' ? (st.mirror ? 'on' : 'off')
        : f === 'screens' ? (st.screens ? 'on' : 'off') : String(st[f]);
      b.classList.toggle('sel', b.dataset.k === val);
    }
    for (const b of root.querySelectorAll('[data-tab]')) {
      if (b.tagName === 'BUTTON') b.classList.toggle('sel', b.dataset.tab === st.tab);
      else b.hidden = b.dataset.tab !== st.tab;
    }
    // the device list: keep the open dropdown alone while it is being used
    if (document.activeElement !== select) {
      const opts = st.devices.length ? st.devices : [{ id: '', label: 'Default camera' }];
      select.innerHTML = opts.map((d) => `<option value="${d.id.replace(/"/g, '&quot;')}">${d.label.replace(/</g, '&lt;')}</option>`).join('');
      select.value = opts.some((d) => d.id === st.deviceId) ? st.deviceId : opts[0].id;
    }
    for (const r of ranges) { if (document.activeElement !== r) r.value = String(get(r.dataset.k)); showVal(r); }
    $('.camAimText').textContent = AIM_NOTES[st.aim];
    $('.camFromStage').hidden = !FROM_STAGE.has(st.aim);
    root.querySelector('.bRow[data-f=spread]').hidden = st.aim !== 'stage';
    $('.camNoFilter').hidden = !pipe || pipe.FILTER_OK;
    placeBox();
    // the one line that says what is happening
    msg.classList.remove('err');
    if (st.error) {
      msg.textContent = st.error;
      msg.classList.add('err');
    } else if (st.starting) {
      msg.textContent = 'Waiting for the camera. Allow it if the browser asks.';
    } else if (st.live) {
      const s = api.status?.() || {};
      if (offX) {
        msg.innerHTML = 'You’re off the X, so the camera isn’t picking you up. <button class="camToX">Take me to the X</button>';
      } else if (s.onOrbs === false) {
        msg.innerHTML = 'The wristbands moved on to another effect. <button class="camBack">Put the camera back on them</button>';
      } else {
        const n = (s.lit || 0).toLocaleString();
        const cur = track()?.getSettings?.() || {};
        const size = cur.width ? ` · ${cur.width}×${cur.height}${cur.frameRate ? ` at ${Math.round(cur.frameRate)} fps` : ''}` : '';
        msg.textContent = `${st.aim === 'view' ? `Live on ${n} wristbands in your view` : `Live on ${n} wristbands`}${size}.`;
      }
    } else {
      msg.textContent = 'Turns the crowd into a live picture of your camera.';
    }
  }

  // --- the camera's own controls, whatever this camera offers -------------------
  function buildHardware() {
    const t = track();
    const caps = t?.getCapabilities?.() || {};
    const now = t?.getSettings?.() || {};
    const rows = [];
    for (const [key, label] of HARDWARE) {
      const c = caps[key];
      if (!c) continue;
      if (Array.isArray(c) && c.length > 1) {
        rows.push(`<div class="camHwRow" data-hw="${key}"><span>${label}</span><div class="bSeg">${c.map((m) => `<button class="bOpt${now[key] === m ? ' sel' : ''}" data-hwv="${m}">${m[0].toUpperCase() + m.slice(1).replace('-', ' ')}</button>`).join('')}</div></div>`);
      } else if (typeof c === 'object' && Number.isFinite(c.min) && Number.isFinite(c.max) && c.max > c.min) {
        const val = Number.isFinite(now[key]) ? now[key] : c.min;
        rows.push(`<div class="camHwRow" data-hw="${key}"><span>${label} <em>${+val.toFixed(2)}</em></span><input type="range" min="${c.min}" max="${c.max}" step="${c.step || (c.max - c.min) / 100}" value="${val}" aria-label="${label}"></div>`);
      }
    }
    hwRows.innerHTML = rows.length ? rows.join('')
      : `<p class="camAimNote">${t ? 'This camera doesn’t offer any hardware controls to the browser. The Picture tab still adjusts the image.' : 'Start the camera to see what it lets you control.'}</p>`;
  }
  async function setHardware(key, value) {
    const t = track();
    if (!t) return;
    const c = { [key]: value };
    const mode = NEEDS_MANUAL[key];
    if (mode && (t.getCapabilities?.()[mode] || []).includes('manual')) c[mode] = 'manual';
    try { await t.applyConstraints({ advanced: [c] }); } catch (_) { /* the camera refused: leave it */ }
    const now = t.getSettings?.() || {};
    for (const row of hwRows.querySelectorAll('.camHwRow')) {
      const k = row.dataset.hw;
      for (const b of row.querySelectorAll('[data-hwv]')) b.classList.toggle('sel', now[k] === b.dataset.hwv);
      const em = row.querySelector('em');
      if (em && Number.isFinite(now[k])) em.textContent = String(+now[k].toFixed(2));
    }
  }
  hwRows.addEventListener('input', (e) => {
    const row = e.target.closest('.camHwRow');
    if (row && e.target.type === 'range') setHardware(row.dataset.hw, parseFloat(e.target.value));
  });
  hwRows.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hwv]');
    if (b) setHardware(b.closest('.camHwRow').dataset.hw, b.dataset.hwv);
  });

  root.addEventListener('click', (e) => {
    if (e.target.closest('.bClose')) { setOpen(false); return; }
    if (e.target.closest('.camGo')) { st.live ? stop() : start(); return; }
    if (e.target.closest('.camBack')) { api.showOnOrbs?.(); render(); return; }
    if (e.target.closest('.camFromStage')) { api.viewFromStage?.(); return; }
    if (e.target.closest('.camToX')) { api.goToMark?.(); return; }
    if (e.target.closest('.camReset')) {
      for (const k of PICTURE) set(k, PICTURE_DEFAULTS[k]);
      savePrefs(); render();
      return;
    }
    const tab = e.target.closest('button[data-tab]');
    if (tab) { st.tab = tab.dataset.tab; savePrefs(); render(); return; }
    const btn = e.target.closest('.bOpt');
    if (!btn || btn.closest('.camHwRows')) return;
    const f = btn.closest('.bRow')?.dataset.f, k = btn.dataset.k;
    if (!f) return;
    // My view aims at wherever you are looking at the moment you pick it
    if (f === 'aim' && k === 'view') { st.aim = 'view'; savePrefs(); if (st.live) aimAtView(); else render(); return; }
    if (f === 'res' || f === 'fps') {
      if (f === 'res') st.res = k; else st.fps = Number(k);
      applySize();
      render();
      return;
    }
    if (f === 'pickup') { st.pickup = k === 'anywhere' ? 'anywhere' : 'mark'; savePrefs(); api.onPickup?.(); render(); return; }
    if (f === 'mirror') { st.mirror = k === 'on'; if (pipe) pipe.cfg.mirror = st.mirror; }
    else if (f === 'screens') st.screens = k === 'on';
    else if (f === 'aim' && AIMS.includes(k)) st.aim = k;
    savePrefs();
    if (st.live) api.onChange?.({});   // remap first, so the count below is the new one
    render();
  });
  select.addEventListener('change', () => {
    const id = select.value;
    if (st.live) start(id);
    else { st.deviceId = id; savePrefs(); }
  });
  for (const r of ranges) {
    r.addEventListener('input', () => {
      const k = r.dataset.k;
      set(k, parseFloat(r.value));
      showVal(r);
      savePrefs();
      if (k === 'box') placeBox();
      if (PICTURE.has(k) || k === 'box') return;   // the pipeline picks these up next frame
      if (st.live) api.onChange?.({});
      // a dragged Spread re-fits on the next frame: refresh the count after it
      if (st.live && k === 'spread') requestAnimationFrame(() => requestAnimationFrame(render));
    });
  }

  function setOpen(o) {
    open = !!o;
    root.classList.toggle('open', open);
    fab.classList.toggle('active', open);
    if (open) {
      // pointer lock owns the cursor in-sim: hand it back while the window is up
      api.controls?.unlock?.();
      if (!win.floating) document.dispatchEvent(new CustomEvent('dockpanel', { detail: 'cam' }));
      if (navigator.mediaDevices?.enumerateDevices) listDevices();
    }
    render();
  }
  // one docked panel at a time in the corner; a floated window stays put
  document.addEventListener('dockpanel', (e) => { if (e.detail !== 'cam' && open && !win.floating) setOpen(false); });
  fab.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  // the status line tracks the wristbands (a cue can move them off the camera)
  setInterval(() => { if (open && st.live) render(); }, 700);

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyV' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.body.classList.contains('menu') || !document.body.classList.contains('builderOn')) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    if (e.shiftKey && st.live) { aimAtView(); return; }
    setOpen(!open);
  });
  // the console's "Live camera" tile
  document.addEventListener('livecam', (e) => {
    if (e.detail === 'start') { setOpen(true); if (!st.live) start(); }
  });
  // a venue switch reloads the page: bring the camera back up on the far side
  document.addEventListener('venuereboot', () => {
    try { if (st.live) sessionStorage.setItem(RESUME_KEY, '1'); } catch (_) { /* private mode */ }
  });

  // a short note over the scene; the pads' hint pill is the house style
  let toastT = 0;
  function toast(text) {
    const el = document.getElementById('padHint');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), 1600);
  }

  // main.js hands over the pipeline once it exists: the preview becomes its
  // adjusted picture, and the picture and mirror settings move into it
  function attachPipeline(p) {
    pipe = p;
    Object.assign(p.cfg.picture, pic);
    p.cfg.mirror = st.mirror;
    p.cfg.box = st.box;
    const preview = p.canvases.camera;
    preview.classList.add('camPreview');
    stage.insertBefore(preview, stage.querySelector('.camIdle'));
    render();
  }

  buildHardware();
  render();
  let resume = false;
  try { resume = sessionStorage.getItem(RESUME_KEY) === '1'; sessionStorage.removeItem(RESUME_KEY); } catch (_) { /* private mode */ }
  if (resume) start();

  return {
    video, start, stop, aimAtView, attachPipeline,
    open: () => setOpen(true), close: () => setOpen(false),
    refresh: () => render(),
    get pickup() { return st.pickup; },
    get isOpen() { return open && !win.floating; },
    get live() { return st.live; },
    get mirror() { return st.mirror; },
    get aim() { return st.aim; },
    get spread() { return st.spread; },
    get screens() { return st.screens; },
    get contrast() { return st.contrast; },
    get glow() { return st.glow; },
    state: st,
  };
}
