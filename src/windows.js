// Movable windows. Drag a window by its title bar and it floats where you
// leave it, remembered for the next visit. Double-click the title bar to send
// it home. Floating windows stay open alongside everything else; the ones
// still at home in the bottom-left dock take turns in that corner.
//
// The drag is delegated from the window itself, so a panel that re-renders
// its own title bar (the builder does, on every change) keeps working.
let zTop = 80;
const CONTROL = 'button, input, select, textarea, a, label, [contenteditable]';
// Windows make room for each other: when one opens or is dragged onto another,
// the other slides out of the way. A window may hang up to 75% off the screen
// but never under the header bar.
const HEADER = 52, OFF = 0.75;
const all = new Set();   // every movable window: { win, place, z }
const shown = (el) => {
  if (!el.isConnected || el.offsetWidth === 0) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05;
};
// the room a window has: its left/top limits for a given size
function limits(w, h) {
  return { x0: -w * OFF, x1: innerWidth - w * (1 - OFF), y0: HEADER + 6, y1: innerHeight - h * (1 - OFF) };
}
// push every other shown window clear of `fixed` (the one being dragged, or the newest)
const zOf = (o) => Number(o.win.style.zIndex) || 0;
function makeRoom(fixed, onlyBehind = false) {
  const a = fixed.win.getBoundingClientRect();
  if (!a.width) return;
  for (const o of all) {
    if (o === fixed || !shown(o.win) || o.dragging) continue;
    if (onlyBehind && zOf(o) >= zOf(fixed)) continue;   // only windows behind it move
    const b = o.win.getBoundingClientRect();
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox <= 0 || oy <= 0) continue;
    const L = limits(b.width, b.height), gap = 8;
    // the four ways out, the shortest that stays within the room wins
    const moves = [
      [a.left - b.width - gap, b.top], [a.right + gap, b.top],
      [b.left, a.top - b.height - gap], [b.left, a.bottom + gap],
    ].map(([x, y]) => [x, y, Math.hypot(x - b.left, y - b.top)])
      .filter(([x, y]) => x >= L.x0 && x <= L.x1 && y >= L.y0 && y <= L.y1)
      .sort((p, q) => p[2] - q[2]);
    const m = moves[0] || [Math.min(Math.max(a.right + gap, L.x0), L.x1), b.top, 0];
    o.place({ left: m[0], top: m[1], width: b.width, height: b.height });
  }
}
// newly opened windows (or ones resized open) settle without overlapping:
// the most recently brought to the front keeps its place
setInterval(() => {
  const vis = [...all].filter((o) => shown(o.win)).sort((p, q) => (Number(q.win.style.zIndex) || 0) - (Number(p.win.style.zIndex) || 0));
  for (const o of vis) if (!o.dragging) makeRoom(o, true);
}, 500);

export function makeMovable(win, { handle, key, resizable = false, onHome } = {}) {
  const storeKey = `ht-win:${key}`;
  const front = () => { win.style.zIndex = String(++zTop); };
  const me = { win, place: null, dragging: false };
  all.add(me);
  // opening a window brings it to the front, so it is the one the others make room for
  new MutationObserver(() => { if (shown(win) && !me.wasShown) front(); me.wasShown = shown(win); })
    .observe(win, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
  win.addEventListener('pointerdown', front, true);

  function place({ left, top, width, height }) {
    win.style.left = `${Math.round(left)}px`;
    win.style.top = `${Math.round(top)}px`;
    win.style.right = 'auto';
    win.style.bottom = 'auto';
    if (resizable && width) win.style.width = `${Math.round(width)}px`;
    if (resizable && height) win.style.height = `${Math.round(height)}px`;
    win.classList.add('floating');
  }
  me.place = (r) => { place(r); keepOnScreen(); };
  // keep at least a grabbable strip of the title bar on screen
  function keepOnScreen() {
    if (!win.classList.contains('floating')) return;
    const r = win.getBoundingClientRect();
    if (!r.width) return;
    const L = limits(r.width, r.height);
    const left = Math.min(Math.max(L.x0, r.left), L.x1);
    const top = Math.min(Math.max(L.y0, r.top), L.y1);
    if (left !== r.left) win.style.left = `${Math.round(left)}px`;
    if (top !== r.top) win.style.top = `${Math.round(top)}px`;
  }
  function save() {
    const r = win.getBoundingClientRect();
    try {
      localStorage.setItem(storeKey, JSON.stringify({
        left: r.left, top: r.top, ...(resizable ? { width: r.width, height: r.height } : {}),
      }));
    } catch (_) { /* private mode: the position lasts this visit */ }
  }
  function home() {
    for (const p of ['left', 'top', 'right', 'bottom', 'width', 'height']) win.style[p] = '';
    win.classList.remove('floating');
    try { localStorage.removeItem(storeKey); } catch (_) { /* private mode */ }
    onHome?.();
  }
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey) || 'null');
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      place(saved);
      requestAnimationFrame(keepOnScreen);
    }
  } catch (_) { /* corrupt entry: start at home */ }

  const onHandle = (e) => {
    const h = typeof handle === 'string' ? e.target.closest(handle) : (handle.contains(e.target) ? handle : null);
    return h && win.contains(h) && !e.target.closest(CONTROL);
  };
  let drag = null;
  win.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !onHandle(e)) return;
    const r = win.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false };
    // capture keeps the drag alive when the pointer outruns the title bar; a
    // pointer the browser does not track (pen hand-off, synthetic) just skips it
    try { win.setPointerCapture(e.pointerId); } catch (_) { /* drag without capture */ }
    e.preventDefault();
  });
  win.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;   // a click, not a drag
      const r = win.getBoundingClientRect();
      place({ left: r.left, top: r.top, width: r.width, height: r.height });
      win.classList.add('dragging');
      drag.moved = true;
      me.dragging = true;
    }
    const r = win.getBoundingClientRect();
    const L = limits(r.width, r.height);
    const left = Math.min(Math.max(L.x0, e.clientX - drag.dx), L.x1);
    const top = Math.min(Math.max(L.y0, e.clientY - drag.dy), L.y1);
    win.style.left = `${Math.round(left)}px`;
    win.style.top = `${Math.round(top)}px`;
    makeRoom(me);   // the others slide out of its way as it goes
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved) { win.classList.remove('dragging'); save(); }
    drag = null;
    me.dragging = false;
  };
  win.addEventListener('pointerup', end);
  win.addEventListener('pointercancel', end);
  win.addEventListener('dblclick', (e) => { if (onHandle(e)) home(); });

  if (resizable && 'ResizeObserver' in window) {
    let t = 0;
    new ResizeObserver(() => {
      if (!win.classList.contains('floating') || drag) return;
      clearTimeout(t);
      t = setTimeout(save, 250);
    }).observe(win);
  }
  window.addEventListener('resize', keepOnScreen);

  return {
    home, front, place, save,
    get floating() { return win.classList.contains('floating'); },
  };
}
