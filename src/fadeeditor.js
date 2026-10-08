// The fade editor: a trigger's fade line (pads.js keeps it with the trigger,
// main.js plays it as a grand master) drawn on a little graph you can shape.
// The SHOW panel's triggers and the director's cue card each open one.
//
//   time runs across, level up; low on the line is black
//   drag the points; tap the line to add one, double-tap one to take it out
//   presets (fade out, fade in, dip...), a length, and what the line fades
//   (everything, or any of the wristbands, rig, lights, video and crowd)
//   while the trigger plays, a playhead runs along the line
//
// The host gets every change through onChange(fade) and decides where it
// lives; Play, Done and Remove are the host's too.

// [time 0..1, level 0..1] points
export const FADE_PRESETS = [
  ['out', 'Fade out', [[0, 1], [1, 0]]],
  ['in', 'Fade in', [[0, 0], [1, 1]]],
  ['tail', 'Hold, then out', [[0, 1], [0.65, 1], [1, 0]]],
  ['dip', 'Dip to black', [[0, 1], [0.38, 0], [0.62, 0], [1, 1]]],
  ['swell', 'Swell', [[0, 0.15], [0.5, 1], [1, 0.15]]],
  ['flat', 'Flat', [[0, 1], [1, 1]]],
];
export const FADE_TARGETS = [['orbs', 'Wristbands'], ['rig', 'Rig'], ['lights', 'Lights'], ['video', 'Video'], ['crowd', 'Crowd']];
const sameLine = (a, b) => a.length === b.length && a.every((p, k) => Math.abs(p[0] - b[k][0]) < 1e-3 && Math.abs(p[1] - b[k][1]) < 1e-3);
const clone = (o) => JSON.parse(JSON.stringify(o));
// the length slider runs 0..1, evenly by ear from half a second to thirty
const LEN = { lo: 0.5, hi: 30 };
const lenTo = (v) => LEN.lo * (LEN.hi / LEN.lo) ** v;
const lenFrom = (s) => Math.min(1, Math.max(0, Math.log(s / LEN.lo) / Math.log(LEN.hi / LEN.lo)));
const fmtLen = (s) => `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
const snapV = (v) => (v < 0.04 ? 0 : v > 0.96 ? 1 : Math.round(v * 100) / 100);

export function createFadeEditor({ onChange, onPlay, onDone, onRemove, fadeNow }) {
  const el = document.createElement('div');
  el.className = 'spFadeEd';
  el.hidden = true;
  el.innerHTML = `
    <div class="spFadeEdHead"><b></b><button class="aqBtn" data-fe="done">Done</button></div>
    <span class="spSub">What it fades</span>
    <div class="aqChips spFadeTargets"><button class="aqChip" data-ftarget="all">Everything</button>${FADE_TARGETS.map(([k, n]) => `<button class="aqChip" data-ftarget="${k}">${n}</button>`).join('')}</div>
    <canvas class="spFadeCanvas" title="Drag the points. Tap the line to add one; double-tap one to take it out."></canvas>
    <div class="aqChips spFadePresets">${FADE_PRESETS.map(([id, n]) => `<button class="aqChip" data-fpreset="${id}">${n}</button>`).join('')}</div>
    <label class="aqSlider"><span>Length</span><input type="range" min="0" max="1" step="0.001" aria-label="Length"><em></em></label>
    <div class="spFadeEdBtns"><button class="aqBtn spPrimary" data-fe="play">▶ Play the trigger</button><button class="aqBtn spDanger" data-fe="none">Remove the fade</button></div>
    <p class="spHint">Drag the points. Tap the line to add a point; double-tap one to take it out. Where the line is low, what it fades goes to black, while the look keeps running underneath. Video is every screen and ribbon board; Crowd is the people themselves.</p>`;
  const canvas = el.querySelector('canvas'), lenIn = el.querySelector('input[type=range]'), lenEm = el.querySelector('.aqSlider em');
  let draft = null, who = null, drag = -1, raf = 0;

  const changed = () => onChange?.(clone(draft));
  function syncControls() {
    if (!draft) return;
    if (document.activeElement !== lenIn) lenIn.value = String(lenFrom(draft.dur));
    lenIn.style.setProperty('--fill', `${(parseFloat(lenIn.value) * 100).toFixed(1)}%`);
    lenEm.textContent = fmtLen(draft.dur);
    for (const b of el.querySelectorAll('[data-fpreset]')) {
      b.classList.toggle('sel', sameLine(FADE_PRESETS.find(([id]) => id === b.dataset.fpreset)[2], draft.pts));
    }
    const T = draft.targets;
    for (const b of el.querySelectorAll('[data-ftarget]')) {
      const k = b.dataset.ftarget;
      b.classList.toggle('sel', k === 'all' ? !T : !T || T[k] !== false);
    }
  }

  // the graph's frame: time across, level up; the ends are pinned to the start and the end
  function frame() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const P = 12 * dpr, W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    return { r, dpr, W, H, x0: P, x1: W - P, y0: P, y1: H - P };
  }
  function draw() {
    if (!draft || el.hidden) return;
    const F = frame();
    if (!F.W || !F.H) return;
    if (canvas.width !== F.W || canvas.height !== F.H) { canvas.width = F.W; canvas.height = F.H; }
    const g = canvas.getContext('2d'), { dpr, W, H, x0, x1, y0, y1 } = F;
    const X = (t) => x0 + t * (x1 - x0), Y = (v) => y1 - v * (y1 - y0);
    g.clearRect(0, 0, W, H);
    // the grid: quarter levels, and a mark every second (or two)
    g.lineWidth = dpr;
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    for (const v of [0.25, 0.5, 0.75]) { g.beginPath(); g.moveTo(x0, Y(v)); g.lineTo(x1, Y(v)); g.stroke(); }
    const dur = draft.dur, step = dur > 12 ? 2 : dur > 5 ? 1 : 0.5;
    for (let s = step; s < dur - 1e-6; s += step) { g.beginPath(); g.moveTo(X(s / dur), y0); g.lineTo(X(s / dur), y1); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    g.fillStyle = 'rgba(255,255,255,0.42)';
    g.font = `600 ${9 * dpr}px -apple-system, system-ui, sans-serif`;
    g.fillText('100%', x0 + 4 * dpr, y0 + 11 * dpr);
    g.fillText('Black', x0 + 4 * dpr, y1 - 4 * dpr);
    const lab = fmtLen(dur);
    g.fillText(lab, x1 - g.measureText(lab).width - 4 * dpr, y1 - 4 * dpr);
    // under the line, the light that gets through; the line itself in gel blue
    const pts = draft.pts;
    const grad = g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, 'rgba(216,255,58,0.42)');
    grad.addColorStop(1, 'rgba(216,255,58,0.03)');
    g.beginPath();
    g.moveTo(X(pts[0][0]), y1);
    for (const [t, v] of pts) g.lineTo(X(t), Y(v));
    g.lineTo(X(pts[pts.length - 1][0]), y1);
    g.closePath();
    g.fillStyle = grad;
    g.fill();
    g.beginPath();
    pts.forEach(([t, v], k) => (k ? g.lineTo(X(t), Y(v)) : g.moveTo(X(t), Y(v))));
    g.strokeStyle = '#5aaeff';
    g.lineWidth = 2.2 * dpr;
    g.lineJoin = 'round';
    g.stroke();
    // where the trigger is on its line right now, while it plays
    const now = fadeNow?.();
    if (now && now.k >= 0 && who && now.pad === who.pad && now.layer === who.layer) {
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = dpr;
      g.beginPath(); g.moveTo(X(now.k), y0); g.lineTo(X(now.k), y1); g.stroke();
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(X(now.k), Y(now.level), 3.5 * dpr, 0, Math.PI * 2); g.fill();
    }
    // the points: pearls you can drag
    pts.forEach(([t, v], k) => {
      const r = (k === drag ? 6.5 : 5.5) * dpr;
      const pg = g.createRadialGradient(X(t), Y(v) - r * 0.4, 0, X(t), Y(v), r);
      pg.addColorStop(0, '#ffffff'); pg.addColorStop(0.5, '#dfe3e9'); pg.addColorStop(1, '#8e949c');
      g.fillStyle = pg;
      g.beginPath(); g.arc(X(t), Y(v), r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = dpr; g.stroke();
    });
  }
  // the playhead moves while the editor is open, so it draws itself every frame
  function loop() {
    if (el.hidden) { raf = 0; return; }
    if (drag < 0) draw();
    raf = requestAnimationFrame(loop);
  }

  // --- shaping the line --------------------------------------------------------------
  function pointerOnLine(e) {
    const F = frame();
    const px = (e.clientX - F.r.left) * F.dpr, py = (e.clientY - F.r.top) * F.dpr;
    const t = Math.min(1, Math.max(0, (px - F.x0) / (F.x1 - F.x0)));
    const v = Math.min(1, Math.max(0, (F.y1 - py) / (F.y1 - F.y0)));
    return { F, px, py, t, v };
  }
  function nearestPoint(F, px, py, within) {
    const X = (t) => F.x0 + t * (F.x1 - F.x0), Y = (v) => F.y1 - v * (F.y1 - F.y0);
    let best = -1, bd = within * F.dpr;
    draft.pts.forEach(([t, v], k) => { const d = Math.hypot(X(t) - px, Y(v) - py); if (d < bd) { bd = d; best = k; } });
    return best;
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!draft || e.button !== 0) return;
    const { F, px, py, t, v } = pointerOnLine(e);
    let k = nearestPoint(F, px, py, 14);
    if (k < 0) {   // a new point where you tapped, between the two around it
      const at = draft.pts.findIndex(([pt]) => pt > t);
      if (at <= 0) return;
      draft.pts.splice(at, 0, [t, snapV(v)]);
      k = at;
    }
    drag = k;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* fine without */ }
    e.preventDefault();
    e.stopPropagation();
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag < 0 || !draft) return;
    const { t, v } = pointerOnLine(e), pts = draft.pts, k = drag;
    const end = k === 0 || k === pts.length - 1;
    const lo = k > 0 ? pts[k - 1][0] + 0.01 : 0, hi = k < pts.length - 1 ? pts[k + 1][0] - 0.01 : 1;
    pts[k] = [end ? pts[k][0] : Math.min(hi, Math.max(lo, t)), snapV(v)];
    draw();
  });
  const endDrag = () => { if (drag >= 0) { drag = -1; changed(); syncControls(); draw(); } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', (e) => {
    if (!draft) return;
    const { F, px, py } = pointerOnLine(e);
    const k = nearestPoint(F, px, py, 14);
    if (k > 0 && k < draft.pts.length - 1) { draft.pts.splice(k, 1); changed(); syncControls(); draw(); }
  });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const t = e.target;
    const pr = t.closest('[data-fpreset]');
    if (pr) { draft.pts = clone(FADE_PRESETS.find(([id]) => id === pr.dataset.fpreset)[2]); changed(); syncControls(); draw(); return; }
    // what it fades: everything, or a choice of parts (never nothing)
    const ft = t.closest('[data-ftarget]');
    if (ft) {
      const k = ft.dataset.ftarget;
      const T = draft.targets ? { ...draft.targets } : Object.fromEntries(FADE_TARGETS.map(([x]) => [x, true]));
      if (k === 'all') for (const [x] of FADE_TARGETS) T[x] = true;
      else T[k] = T[k] === false;
      if (!FADE_TARGETS.some(([x]) => T[x] !== false)) for (const [x] of FADE_TARGETS) T[x] = true;
      if (FADE_TARGETS.every(([x]) => T[x] !== false)) delete draft.targets; else draft.targets = T;
      changed(); syncControls(); draw();
      return;
    }
    const fe = t.closest('[data-fe]');
    if (!fe) return;
    if (fe.dataset.fe === 'done') { close(); onDone?.(); }
    else if (fe.dataset.fe === 'play') { changed(); onPlay?.(); }
    else if (fe.dataset.fe === 'none') { close(); onRemove?.(); }
  });
  // the length: the graph follows the slider; the trigger keeps it when you let go
  lenIn.addEventListener('input', (e) => {
    e.stopPropagation();
    if (!draft) return;
    draft.dur = lenTo(parseFloat(lenIn.value));
    syncControls();
    draw();
  });
  lenIn.addEventListener('change', () => { if (draft) changed(); });
  // a slider's arrow keys are the editor's, not the camera's
  el.addEventListener('keydown', (e) => { if (e.target.matches('input')) e.stopPropagation(); });

  function edit({ title, fade, layer, pad }) {
    draft = clone(fade || { dur: 4, pts: FADE_PRESETS[0][2] });
    who = { layer, pad };
    el.querySelector('.spFadeEdHead b').textContent = title || 'Fade';
    el.hidden = false;
    syncControls();
    if (!raf) raf = requestAnimationFrame(loop);
    // a brand-new fade is a fade already: the trigger has it from the moment the editor opens
    if (!fade) changed();
  }
  function close() { el.hidden = true; draft = null; who = null; drag = -1; }
  // the trigger's line changed somewhere else (an undo): show it as it is
  // now, or shut if the trigger no longer has one
  function sync(fade) {
    if (el.hidden || drag >= 0) return;
    if (!fade) { close(); return; }
    draft = clone(fade);
    syncControls();
  }
  return {
    el, edit, close, sync,
    get open() { return !el.hidden; },
    get who() { return who; },
  };
}
