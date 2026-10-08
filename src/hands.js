// The HANDS window: hand tracking and the shapes it draws. It edits the camera
// pipeline's settings (camfx.js) in place; the pipeline reads them on its next
// frame, so every change reaches the wristbands at once.
import { SHAPES, SHAPE_NOTES, EDGES, COLOR_MODES } from './shapes.js';
import { HAND_DEFAULTS, BOX_COLOR, drawOutputBox } from './camfx.js';
import { makeMovable } from './windows.js';

const PREFS_KEY = 'ht-hands';
const FEEDS = [['tracking', 'Tracking'], ['shapes', 'Shapes'], ['output', 'Output']];

export function initHandsPanel({ pipe, camera, controls, goToMark }) {
  const h = pipe.cfg.hands;
  const tracker = pipe.tracker;
  // settings survive a reload; tracking itself is switched on by hand each time
  let view = 'output';
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
    for (const k of Object.keys(HAND_DEFAULTS)) if (p[k] !== undefined && typeof p[k] === typeof HAND_DEFAULTS[k]) h[k] = p[k];
    if (typeof p.blackout === 'boolean') pipe.cfg.blackout = p.blackout;
    if (Number.isFinite(p.mix)) pipe.cfg.mix = p.mix;
    if (Number.isFinite(p.smoothing)) tracker.smoothing = p.smoothing;
    if (FEEDS.some(([k]) => k === p.view)) view = p.view;
  } catch (_) { /* first visit */ }
  const save = () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        ...h, blackout: pipe.cfg.blackout, mix: pipe.cfg.mix, smoothing: tracker.smoothing, view,
      }));
    } catch (_) { /* private mode */ }
  };

  const seg = (f, opts, cls = '') => `<div class="bSeg ${cls}">${opts.map(([k, n]) => `<button class="bOpt" data-k="${k}">${n}</button>`).join('')}</div>`;
  const slider = (k, label, min, max, step, unit = '%') =>
    `<div class="bRow" data-f="${k}"><span class="bLabel">${label} <span class="camVal"></span></span><input type="range" class="camRange" data-k="${k}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" aria-label="${label}"></div>`;

  const root = document.createElement('div');
  root.id = 'handsPanel';
  root.className = 'dockPanel';
  root.innerHTML = `
    <div class="bHead"><span class="bTitle">✋ HANDS</span><span class="bHint">tracking and shapes</span><button class="bClose" aria-label="Close">✕</button></div>
    <div class="bBody">
      <div class="camStage hStage"><canvas class="hView"></canvas>
        <div class="hFeedTabs">${FEEDS.map(([k, n]) => `<button data-feed="${k}">${n}</button>`).join('')}</div></div>
      <button class="camGo hGo"></button>
      <p class="camMsg hMsg"></p>
      <div class="bSection">
        <div class="bRow" data-f="shape"><span class="bLabel">Shape</span>${seg('shape', SHAPES, 'hGrid hGrid5')}<p class="camAimNote hShapeNote"></p></div>
        <div class="bRow" data-f="edge"><span class="bLabel">Edge</span>${seg('edge', EDGES, 'hGrid')}</div>
        ${slider('size', 'Size', 0.4, 2.5, 0.05)}
        ${slider('softness', 'Softness', 0, 1, 0.02)}
        ${slider('line', 'Line', 1, 30, 1, 'px')}
      </div>
      <div class="bSection">
        <div class="bRow" data-f="colorMode"><span class="bLabel">Colour</span>${seg('colorMode', COLOR_MODES, 'hGrid4')}</div>
        <div class="bRow hColors"><label>Colour A <input type="color" data-k="colorA"></label><label>Colour B <input type="color" data-k="colorB"></label></div>
        ${slider('opacity', 'Opacity', 0.1, 1, 0.05)}
      </div>
      <div class="bSection">
        <div class="bRow" data-f="blackout"><span class="bLabel">Camera picture</span>${seg('blackout', [['off', 'Showing'], ['on', 'Blacked out']])}</div>
        ${slider('mix', 'Camera mix', 0, 1, 0.05)}
        <div class="bRow" data-f="skeleton"><span class="bLabel">Skeleton on the wristbands</span>${seg('skeleton', [['off', 'Off'], ['on', 'On']])}</div>
        ${slider('smoothing', 'Smoothing', 0, 0.9, 0.05)}
      </div>
      <p class="camNote">H opens this window. Tracking runs on this computer; the first start downloads the hand model, about 10 MB.</p>
    </div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const go = $('.hGo'), msg = $('.hMsg'), viewCanvas = $('.hView');
  const vctx = viewCanvas.getContext('2d');

  const fab = document.createElement('button');
  fab.id = 'handsFab';
  fab.title = 'Hand tracking and shapes (H)';
  fab.innerHTML = '<span class="cfDot"></span><span class="cfLabel">HANDS</span><kbd>H</kbd>';
  (document.getElementById('fabDock') || document.body).appendChild(fab);
  const win = makeMovable(root, { handle: '.bHead', key: 'hands' });

  // --- reading and writing the settings ----------------------------------------
  const get = (k) => (k === 'mix' ? pipe.cfg.mix : k === 'smoothing' ? tracker.smoothing : h[k]);
  const set = (k, v) => {
    if (k === 'mix') pipe.cfg.mix = v;
    else if (k === 'smoothing') tracker.smoothing = v;
    else h[k] = v;
  };
  const showVal = (r) => {
    const v = get(r.dataset.k);
    r.closest('.bRow').querySelector('.camVal').textContent = r.dataset.unit === 'px' ? `${Math.round(v)} px` : `${Math.round(v * 100)}%`;
  };

  function render() {
    const tracking = tracker.enabled;
    root.classList.toggle('live', tracking);
    fab.classList.toggle('live', tracking);
    go.textContent = tracking ? 'Stop hand tracking' : 'Start hand tracking';
    for (const b of root.querySelectorAll('.bOpt')) {
      const f = b.closest('.bRow').dataset.f;
      const val = f === 'blackout' ? (pipe.cfg.blackout ? 'on' : 'off') : f === 'skeleton' ? (h.skeleton ? 'on' : 'off') : h[f];
      b.classList.toggle('sel', b.dataset.k === val);
    }
    for (const b of root.querySelectorAll('[data-feed]')) b.classList.toggle('sel', b.dataset.feed === view);
    for (const r of root.querySelectorAll('.camRange')) { r.value = String(get(r.dataset.k)); showVal(r); }
    for (const c of root.querySelectorAll('input[type=color]')) if (document.activeElement !== c) c.value = h[c.dataset.k];
    $('.hShapeNote').textContent = SHAPE_NOTES[h.shape] || '';
    root.querySelector('.bRow[data-f=mix]').classList.toggle('off', pipe.cfg.blackout);
    renderStatus();
  }
  // the status line alone: the tracker reports many times a second, and
  // redoing every control that often would cost the room frames
  function renderStatus() {
    const tracking = tracker.enabled;
    root.classList.toggle('live', tracking);
    fab.classList.toggle('live', tracking);
    const s = tracker.status;
    msg.classList.toggle('err', s.state === 'error');
    if (!tracking) msg.textContent = 'Tracks both hands through the camera and draws shapes from your fingers.';
    else if (!camera.live) msg.textContent = 'Waiting for the camera.';
    else if (!pipe.cfg.pickup) msg.innerHTML = 'You’re off the X, so the camera can’t see your hands. <button class="hToX">Take me to the X</button>';
    else if (s.state === 'loading') msg.textContent = 'Loading hand tracking. The first time downloads the hand model.';
    else if (s.state === 'warming') msg.textContent = 'Warming up the tracker…';
    else if (s.state === 'error') msg.textContent = `Hand tracking couldn’t start: ${s.error}. It needs an internet connection the first time.`;
    else if (!s.count) msg.textContent = 'No hands in view. Hold them up to the camera.';
    else msg.textContent = `Tracking ${s.count === 1 ? 'one hand' : 'both hands'} · ${Math.round(s.fps)} fps`;
  }
  let statusAt = 0, lastState = '';
  pipe.onTrackerStatus = (s) => {
    fab.classList.toggle('live', tracker.enabled);
    if (!open) return;
    const now = performance.now();
    if (s.state === lastState && now - statusAt < 250) return;
    lastState = s.state;
    statusAt = now;
    renderStatus();
  };

  root.addEventListener('click', (e) => {
    if (e.target.closest('.bClose')) { setOpen(false); return; }
    if (e.target.closest('.hGo')) { toggleTracking(); return; }
    if (e.target.closest('.hToX')) { goToMark?.(); return; }
    const feedBtn = e.target.closest('[data-feed]');
    if (feedBtn) { view = feedBtn.dataset.feed; save(); render(); return; }
    const btn = e.target.closest('.bOpt');
    if (!btn) return;
    const f = btn.closest('.bRow').dataset.f, k = btn.dataset.k;
    if (f === 'blackout') pipe.cfg.blackout = k === 'on';
    else if (f === 'skeleton') h.skeleton = k === 'on';
    else h[f] = k;
    save();
    render();
  });
  for (const r of root.querySelectorAll('.camRange')) {
    r.addEventListener('input', () => { set(r.dataset.k, parseFloat(r.value)); showVal(r); save(); });
  }
  for (const c of root.querySelectorAll('input[type=color]')) {
    c.addEventListener('input', () => { h[c.dataset.k] = c.value; save(); });
  }

  // hand tracking needs the camera: starting it starts the camera too
  function toggleTracking() {
    if (tracker.enabled) { tracker.setEnabled(false); render(); return; }
    tracker.setEnabled(true);
    if (!camera.live) camera.start();
    render();
  }

  // --- the preview: one pipeline picture, redrawn while the window is open -------
  // Only when the pipeline has a new frame (or the view changed): the camera
  // gives 30 a second, the display may ask for 120.
  let drawnKey = '';
  function drawView() {
    if (!open) return;
    requestAnimationFrame(drawView);
    if (view === 'tracking') pipe.want('tracking');
    const src = pipe.canvases[view];
    const r = viewCanvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr)), hh = Math.max(2, Math.round(r.height * dpr));
    const live = camera.live && pipe.running;
    const key = `${view}|${w}x${hh}|${live ? pipe.frame : -1}|${pipe.cfg.box}|${pipe.cfg.pickup}`;
    if (key === drawnKey) return;
    drawnKey = key;
    if (viewCanvas.width !== w || viewCanvas.height !== hh) { viewCanvas.width = w; viewCanvas.height = hh; }
    vctx.fillStyle = '#07080b';
    vctx.fillRect(0, 0, w, hh);
    if (!live) return;
    if (!pipe.cfg.pickup) {
      // the camera sees an empty spot: say why the picture is black
      vctx.textAlign = 'center';
      vctx.fillStyle = '#ff9aa2';
      vctx.font = `800 ${Math.round(13 * dpr)}px -apple-system, system-ui, sans-serif`;
      vctx.fillText('OFF THE X', w / 2, hh / 2 - 4 * dpr);
      vctx.fillStyle = '#8f8a7c';
      vctx.font = `600 ${Math.round(10.5 * dpr)}px -apple-system, system-ui, sans-serif`;
      vctx.fillText('Stand on the X on stage to be picked up', w / 2, hh / 2 + 14 * dpr);
      vctx.textAlign = 'start';
      return;
    }
    const k = Math.min(w / src.width, hh / src.height);
    const dw = src.width * k, dh = src.height * k, x = (w - dw) / 2, y = (hh - dh) / 2;
    vctx.drawImage(src, x, y, dw, dh);
    if (view === 'output') {
      // the output is the green box's contents: framed in the same green
      vctx.strokeStyle = BOX_COLOR;
      vctx.lineWidth = 2 * dpr;
      vctx.strokeRect(x + dpr, y + dpr, dw - 2 * dpr, dh - 2 * dpr);
    } else {
      drawOutputBox(vctx, x, y, dw, dh, pipe.cfg.box, dpr);
    }
  }

  let open = false;
  function setOpen(o) {
    open = !!o;
    root.classList.toggle('open', open);
    fab.classList.toggle('active', open);
    if (open) {
      controls?.unlock?.();
      if (!win.floating) document.dispatchEvent(new CustomEvent('dockpanel', { detail: 'hands' }));
      render();
      drawnKey = '';
      requestAnimationFrame(drawView);
    }
  }
  // one docked panel at a time in the corner; a floated one stays put
  document.addEventListener('dockpanel', (e) => { if (e.detail !== 'hands' && open && !win.floating) setOpen(false); });
  fab.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyH' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.body.classList.contains('menu') || !document.body.classList.contains('builderOn')) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    setOpen(!open);
  });
  setInterval(() => { if (open && tracker.enabled) renderStatus(); }, 500);
  render();

  return {
    open: () => setOpen(true), close: () => setOpen(false),
    refresh: () => { if (open) renderStatus(); },
    get isOpen() { return open && !win.floating; },
    get visible() { return open; },
    toggleTracking,
  };
}
