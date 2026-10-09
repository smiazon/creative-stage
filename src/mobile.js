// The phone and tablet showcase: the same room, made for fingers.
// - a 4-digit code first (a casual gate, nothing more), then straight into the arena
// - the top: small round buttons down each side (left: Settings, full screen, Focus
//   mode; right: the bird's-eye map, Build) and the camera bar between them
// - the bottom, laid out like a mobile game: the joystick left; the menus in the
//   middle (SHOW, and FX for the special effects); the actions right (jump / up,
//   FLY, down). Menus and actions apart, so SHOW is never mistaken for FLY.
// - drag anywhere on the view to look round; leave it alone a few seconds and the
//   buttons fade away, leaving only the show; any touch brings them back
// Everything else is the desktop app's own code, styled by mobile.css.
import * as THREE from 'three';
import { FONTS } from './showlooks.js';

const CODE = '0000';
const OK_KEY = 'pm-mobile-ok';
const IDLE_MS = 5000;   // a showcase on the spot: long enough not to flicker, short enough to feel clean

// act the moment a finger touches the button. A phone won't make a "click" from a
// second finger while the first is still down (walking on the joystick), so buttons
// that must work mid-walk listen for the touch itself; the click that may follow is ignored.
function onTouch(el, fn) {
  let at = 0;
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); at = performance.now(); fn(e); });
  el.addEventListener('click', (e) => { e.stopPropagation(); if (performance.now() - at > 600) fn(e); });   // a keyboard or mouse click still works
}
const svg = (body, { fill = false, w = 1.9 } = {}) => `<svg viewBox="0 0 24 24" ${fill ? 'fill="currentColor"' : `fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`} aria-hidden="true">${body}</svg>`;

export function initMobile({
  camera, view, controls, nextAngle, touchMove, menuUI, overlay, closeAll = () => {},
  toggleFly, isFlying = () => false, keys = {}, focus, bird, fx = {}, designer,
}) {
  const root = document.documentElement;
  // phones have no mouse to hold: looking round is the drag below
  if (controls) controls.lock = () => {};

  // --- the code -------------------------------------------------------------------------
  let unlocked = false;
  try { unlocked = sessionStorage.getItem(OK_KEY) === '1'; } catch (_) { /* private mode */ }
  const inMenu = () => document.body.classList.contains('menu') && !overlay.classList.contains('lightsDown');
  const goIn = () => { if (inMenu()) menuUI.enter?.('quick'); };
  if (unlocked) setTimeout(goIn, 200);   // a venue switch reloads the page: straight back in
  else gate(() => {
    try { sessionStorage.setItem(OK_KEY, '1'); } catch (_) { /* private mode */ }
    goIn();
  });

  // --- the camera bar: the arrows never move; the view's name fits between them ------------
  const top = document.createElement('div');
  top.id = 'mCam';
  top.innerHTML = '<button class="mPrev" aria-label="Previous camera angle">‹</button>'
    + '<div class="mName"><small>Camera angle</small><b></b></div>'
    + '<button class="mNext" aria-label="Next camera angle">›</button>';
  document.body.appendChild(top);
  onTouch(top.querySelector('.mPrev'), () => nextAngle(-1));
  onTouch(top.querySelector('.mNext'), () => nextAngle(1));
  const nameEl = top.querySelector('.mName b'), src = document.getElementById('angleName');
  // the whole name, always: one line, smaller if it must; two lines if it's very long
  const fitName = () => {
    nameEl.classList.remove('two');
    for (let px = 14; px >= 10.5; px -= 0.5) {
      nameEl.style.fontSize = `${px}px`;
      if (nameEl.scrollWidth <= nameEl.clientWidth + 1) return;
    }
    nameEl.classList.add('two');
    nameEl.style.fontSize = '11px';
  };
  const showName = () => { nameEl.textContent = src?.textContent || 'Tap › to change'; fitName(); };
  showName();
  if (src) new MutationObserver(showName).observe(src, { childList: true, characterData: true, subtree: true });
  window.addEventListener('resize', () => setTimeout(fitName, 120));

  // --- the joystick: walk ------------------------------------------------------------------
  const joy = document.createElement('div');
  joy.id = 'mJoy';
  joy.innerHTML = '<i></i>';
  document.body.appendChild(joy);
  const knob = joy.firstElementChild;
  let joyId = null;
  const joyAt = (e) => {
    const r = joy.getBoundingClientRect(), R = r.width / 2;
    let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
    const d = Math.hypot(dx, dy), max = R * 0.62;
    if (d > max) { dx *= max / d; dy *= max / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    touchMove.x = dx / max;
    touchMove.y = -dy / max;
  };
  const joyEnd = () => { joyId = null; touchMove.x = 0; touchMove.y = 0; knob.style.transform = ''; joy.classList.remove('on'); };
  joy.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    joyId = e.pointerId;
    try { joy.setPointerCapture(e.pointerId); } catch (_) { /* a pointer the browser already let go */ }
    joy.classList.add('on');
    joyAt(e);
  });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyAt(e); });
  joy.addEventListener('pointerup', (e) => { if (e.pointerId === joyId) joyEnd(); });
  joy.addEventListener('pointercancel', (e) => { if (e.pointerId === joyId) joyEnd(); });

  // --- the actions, bottom right: up (jump on foot, rise while flying), FLY, down ----------
  const acts = document.getElementById('fabDock') || document.body;
  const ARROW = (d) => svg(`<path d="${d}"/>`, { w: 2.6 });
  const up = document.createElement('button');
  up.id = 'mUp';
  up.innerHTML = `${ARROW('M6 15l6-6 6 6')}<small>JUMP</small>`;
  const fly = document.createElement('button');
  fly.id = 'mFly';
  fly.innerHTML = '<b>FLY</b>';
  const down = document.createElement('button');
  down.id = 'mDown';
  down.setAttribute('aria-label', 'Fly down');
  down.innerHTML = `${ARROW('M6 9l6 6 6-6')}<small>DOWN</small>`;
  acts.prepend(up, fly, down);
  onTouch(fly, () => toggleFly?.());   // works while the other thumb walks
  // up and down press the keyboard's keys (Space up, C down) for as long as the finger is down
  const hold = (btn, code) => {
    let id = null;
    const lift = (e) => { if (e.pointerId !== id) return; id = null; keys[code] = false; btn.classList.remove('held'); };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      id = e.pointerId;
      try { btn.setPointerCapture(e.pointerId); } catch (_) { /* already let go */ }
      keys[code] = true;
      btn.classList.add('held');
      if (code === 'Space' && !isFlying()) setTimeout(() => { if (id === null) keys.Space = false; }, 120);   // a jump is a tap
    });
    btn.addEventListener('pointerup', lift);
    btn.addEventListener('pointercancel', lift);
    btn.addEventListener('click', (e) => e.stopPropagation());
  };
  hold(up, 'Space');
  hold(down, 'KeyC');
  setInterval(() => {   // camera angles and landings change it too: the buttons always say where you are
    const on = isFlying();
    fly.classList.toggle('on', on);
    fly.querySelector('b').textContent = on ? 'LAND' : 'FLY';
    root.classList.toggle('mFlying', on);
    up.querySelector('small').textContent = on ? 'UP' : 'JUMP';
    up.setAttribute('aria-label', on ? 'Fly up' : 'Jump');
  }, 150);

  // --- the menus, bottom centre: FX over SHOW ----------------------------------------------
  const hot = document.createElement('div');
  hot.id = 'mHot';
  const fxBtn = document.createElement('button');
  fxBtn.id = 'mFxBtn';
  fxBtn.innerHTML = `${svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 3v4M17 5h4"/>')}<b>FX</b>`;
  hot.appendChild(fxBtn);
  const showBtn = document.getElementById('showFab');
  if (showBtn) hot.appendChild(showBtn);   // SHOW joins the middle: a menu, away from the actions
  document.body.appendChild(hot);
  let showAt = 0;
  showBtn?.addEventListener('pointerdown', () => { if (joyId !== null) { showAt = performance.now(); showBtn.click(); } });
  // the click a phone may still send after that touch: swallowed, or Show would open and shut
  showBtn?.addEventListener('click', (e) => { if (e.isTrusted && performance.now() - showAt < 600) e.stopImmediatePropagation(); }, true);

  // --- the special effects tray -------------------------------------------------------------
  // One tap fires; FIRE and LASERS stay on until tapped again (lit while on). The tray
  // sits low with the room in view above it, so you see what you fire.
  const FX = [
    fx.fireworks && { id: 'fireworks', name: 'Fireworks', icon: '<path d="M12 12v9"/><path d="M12 12l-4-6M12 12l4-6M12 12l-6-1M12 12l6-1M12 12l-3 4M12 12l3 4"/>', go: fx.fireworks },
    !fx.fireworks && { id: 'pyro', name: 'Pyro', icon: '<path d="M8 21h8M12 21V11"/><path d="M12 11c-3-2-3-5 0-8 3 3 3 6 0 8z"/>', go: fx.pyro },
    { id: 'fire', name: 'Fire', toggle: true, icon: '<path d="M12 21c4 0 6-2.5 6-6 0-4-3-5-3-9-2 1.5-3.5 3.5-3.5 6-1-1-1.5-2-1.5-3-2 2-4 4.5-4 6 0 3.5 2.5 6 6 6z"/>', go: () => fx.fire?.(!fx.isFire?.()), lit: () => fx.isFire?.() },
    { id: 'lasers', name: 'Lasers', toggle: true, icon: '<path d="M12 20L4 4M12 20l3-16M12 20l8-14M12 20L8 4"/><circle cx="12" cy="20" r="1.4"/>', go: () => fx.lasers?.(!fx.isLasers?.()), lit: () => fx.isLasers?.() },
    { id: 'confetti', name: 'Confetti', icon: '<path d="M4 20l5-12 7 7z"/><path d="M14 4l1 2M19 7l-2 1M18 12h2M11 3v2"/>', go: fx.confetti },
    { id: 'streamers', name: 'Streamers', icon: '<path d="M5 20c2-6 6-6 6-12M12 20c1-5 5-6 5-12M19 20c-1-4 1-6 1-10"/>', go: fx.streamers },
    { id: 'smoke', name: 'Smoke jets', icon: '<path d="M8 21v-5M16 21v-5"/><path d="M5 12a3 3 0 0 1 3-3 4 4 0 0 1 8 0 3 3 0 0 1 3 3H5z"/>', go: fx.smoke },
    { id: 'poppers', name: 'Poppers', icon: '<path d="M6 20l4-10 4 4z"/><circle cx="16" cy="6" r="1"/><circle cx="19" cy="10" r="1"/><circle cx="13" cy="4" r="1"/>', go: fx.poppers },
    { id: 'finale', name: 'Everything', big: true, icon: '<path d="M12 2l2.4 6.6L21 9l-5 4.3L17.5 21 12 17.3 6.5 21 8 13.3 3 9l6.6-.4z"/>', go: fx.finale },
  ].filter(Boolean);
  const tray = document.createElement('div');
  tray.id = 'mFxTray';
  tray.innerHTML = `<div class="mCardHead"><button class="mCardClose" aria-label="Close"></button><span>Special effects</span></div>
    <div class="mFxGrid">${FX.map((f) => `<button class="mFxTile${f.big ? ' big' : ''}" data-fx="${f.id}"><i>${svg(f.icon)}</i><span>${f.name}</span></button>`).join('')}</div>`;
  document.body.appendChild(tray);
  const trayOpen = (on) => {
    if (on) closeAll();
    root.classList.toggle('mTray', on);
    fxBtn.classList.toggle('on', on);
  };
  onTouch(fxBtn, () => trayOpen(!root.classList.contains('mTray')));
  tray.querySelector('.mCardClose').addEventListener('click', (e) => { e.stopPropagation(); trayOpen(false); });
  tray.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-fx]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    FX.find((f) => f.id === b.dataset.fx)?.go?.();
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');   // a small burst where you tapped
  });
  tray.addEventListener('click', (e) => e.stopPropagation());
  setInterval(() => { for (const f of FX) if (f.lit) tray.querySelector(`[data-fx="${f.id}"]`)?.classList.toggle('lit', !!f.lit()); }, 300);

  // --- drag to look ------------------------------------------------------------------------
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  let lookId = null, lx = 0, ly = 0;
  view.addEventListener('pointerdown', (e) => {
    if (lookId !== null || focus?.on) return;
    lookId = e.pointerId; lx = e.clientX; ly = e.clientY;
    try { view.setPointerCapture?.(e.pointerId); } catch (_) { /* a pointer the browser already let go */ }
  });
  view.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    const k = 0.0042 * (window.innerWidth > 900 ? 0.8 : 1);   // a tablet's longer swipe turns the same
    euler.setFromQuaternion(camera.quaternion);
    euler.y -= (e.clientX - lx) * k;   // as in a game: swipe right, look right
    euler.x -= (e.clientY - ly) * k;
    euler.x = Math.max(-1.45, Math.min(1.45, euler.x));
    camera.quaternion.setFromEuler(euler);
    lx = e.clientX; ly = e.clientY;
  });
  const lookEnd = (e) => { if (e.pointerId === lookId) lookId = null; };
  view.addEventListener('pointerup', lookEnd);
  view.addEventListener('pointercancel', lookEnd);

  // a hint the first time in: what the joystick and the drag do
  const hint = document.createElement('div');
  hint.id = 'mHint';
  hint.innerHTML = '<span>Walk</span><span>Drag to look around</span>';
  document.body.appendChild(hint);
  const dropHint = () => hint.classList.add('gone');
  setTimeout(dropHint, 7000);
  joy.addEventListener('pointerdown', dropHint, { once: true });
  view.addEventListener('pointerdown', dropHint, { once: true });

  // --- Show: the kind, the sliders and the colours stay put; only the effects scroll --------
  const body = document.querySelector('#showPanel .spBody');
  const panel = document.getElementById('showPanel');
  if (body) {
    const stick = document.createElement('div');
    stick.className = 'mStick';
    const kind = body.querySelector(':scope > .spKind');
    if (kind) stick.appendChild(kind);
    for (const row of body.querySelectorAll(':scope > .spSpeedRow')) stick.appendChild(row);   // speed, gobo size, moving heads
    const cols = body.querySelector(':scope > .spColRow');
    if (cols) stick.appendChild(cols);   // the sliders above the colours
    body.prepend(stick);
    // the effects in a column of their own: on its side the panel scrolls each half by itself
    const fxCol = document.createElement('div');
    fxCol.className = 'mFx';
    for (const el of [...body.children]) if (el !== stick) fxCol.appendChild(el);
    body.appendChild(fxCol);
  }
  if (body && panel) {
    const rail = document.createElement('div');
    rail.className = 'mRail';
    rail.innerHTML = '<i></i>';
    const more = document.createElement('button');
    more.className = 'mMore';
    more.innerHTML = 'More effects <span aria-hidden="true">⌄</span>';
    panel.append(rail, more);
    const fxCol = body.querySelector('.mFx');
    const scroller = () => (fxCol && getComputedStyle(fxCol).overflowY !== 'visible' ? fxCol : body);
    more.addEventListener('click', (e) => { e.stopPropagation(); const sc = scroller(); sc.scrollBy({ top: sc.clientHeight * 0.7, behavior: 'smooth' }); });
    const paintRail = () => {
      const stick = body.querySelector('.mStick');
      const sc = scroller(), own = sc !== body;
      const pr = panel.getBoundingClientRect(), br = sc.getBoundingClientRect();
      const topY = br.top - pr.top + (stick && !own ? stick.offsetHeight : 0) + 6;
      const h = Math.max(20, br.bottom - pr.top - topY - 10);
      rail.style.top = `${topY}px`;
      rail.style.height = `${h}px`;
      const max = sc.scrollHeight - sc.clientHeight;
      const seen = Math.max(0.12, Math.min(1, sc.clientHeight / Math.max(1, sc.scrollHeight)));
      const th = h * seen, at = max > 0 ? sc.scrollTop / max : 0;
      rail.firstElementChild.style.height = `${th}px`;
      rail.firstElementChild.style.transform = `translateY(${(h - th) * at}px)`;
      rail.classList.toggle('none', max < 8);
      more.classList.toggle('gone', max < 8 || sc.scrollTop > max - 30);
      panel.classList.toggle('mEnd', max < 8 || sc.scrollTop > max - 30);
    };
    body.addEventListener('scroll', paintRail, { passive: true });
    fxCol?.addEventListener('scroll', paintRail, { passive: true });
    window.addEventListener('resize', () => setTimeout(paintRail, 120));
    setInterval(() => { if (panel.classList.contains('open')) paintRail(); }, 400);
  }
  // the colour strip fades on the right while there are more colours to swipe to
  const strip = document.querySelector('#showPanel .mStick .spColRow');
  if (strip) {
    const edge = () => strip.classList.toggle('atEnd', strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 4);
    strip.addEventListener('scroll', edge, { passive: true });
    setInterval(edge, 600);
  }

  // --- Your message: tap it once to play it; tap it again to write your own --------------------
  messageEditor(designer);

  // --- the corner buttons ---------------------------------------------------------------------
  const corner = (id, label, icon) => {
    const b = document.createElement('button');
    b.id = id;
    b.className = 'mIcon';
    b.setAttribute('aria-label', label);
    b.innerHTML = icon;
    document.body.appendChild(b);
    return b;
  };
  // right: the bird's-eye map (the lights from above, or the whole arena) and Build
  const map = corner('mMap', "Bird's-eye view", svg([[6, 6], [12, 6], [18, 6], [6, 12], [12, 12], [18, 12], [6, 18], [12, 18], [18, 18]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.1"/>`).join(''), { fill: true }));
  const build = corner('mBuild', 'Build', svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3.6 17.2a1.6 1.6 0 1 0 2.3 2.3l5.7-5.7a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.1-.6-.6-2.1z"/>'));
  build.addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('buildFab')?.click(); });
  const birdPanel = document.getElementById('birdPanel');
  const birdView = document.getElementById('birdView');
  // the map card in the same style as the others: a close, a title, and Lights / Arena
  if (birdPanel && birdView) {
    const head = document.createElement('div');
    head.className = 'mCardHead';
    head.innerHTML = '<button class="mCardClose" aria-label="Close"></button><span>Bird\'s-eye view</span>';
    const seg = document.createElement('div');
    seg.className = 'mSeg';
    seg.innerHTML = '<button data-mbird="orbs">Lights</button><button data-mbird="arena">Arena</button>';
    birdPanel.insertBefore(head, birdView);
    birdPanel.insertBefore(seg, birdView);
    head.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); bird?.set('off'); });
    seg.addEventListener('click', (e) => { const b = e.target.closest('[data-mbird]'); if (b) { e.stopPropagation(); bird?.set(b.dataset.mbird); } });
  }
  const openMap = (mode) => { closeAll(); root.classList.remove('mTray'); fxBtn.classList.remove('on'); bird?.set(mode); };
  map.addEventListener('click', (e) => { e.stopPropagation(); if (bird?.mode === 'off') openMap('orbs'); else bird?.set('off'); });
  // Settings' Bird's-eye view opens the same card (the whole arena)
  document.getElementById('birdBtn')?.addEventListener('click', (e) => { e.stopImmediatePropagation(); e.preventDefault(); openMap('arena'); }, true);

  // left: Settings, full screen, Focus mode
  const set = document.getElementById('settingsPanel');
  const gear = corner('mSet', 'Settings', svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', { w: 1.8 }));
  if (set) {
    document.body.appendChild(set);   // out of the hidden top bar: a card of its own
    const head = document.createElement('div');
    head.className = 'mCardHead mSetHead';
    head.innerHTML = '<button class="mCardClose" aria-label="Close"></button><span>Settings</span>';
    set.prepend(head);
    head.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); set.classList.add('hidden'); });
    gear.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = set.classList.contains('hidden');
      closeAll();
      root.classList.remove('mTray'); fxBtn.classList.remove('on');
      set.classList.toggle('hidden', !opening);
      // always opens tidy: every group folded
      if (opening) for (const sec of set.querySelectorAll('.aqSec:not(.shut) > .aqSecHead')) sec.click();
      set.scrollTop = 0;
    });
  }
  fullScreenButton(corner);
  const focusBtn = corner('mFocus', 'Focus mode', `${svg('<path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3"/>')}<i class="mFocusDot"></i>`);

  // --- Focus mode: the UI goes, the camera drifts through cinematic shots, endlessly ---------
  // The first touch shows a thin "exit" line; a second touch (within a few seconds) leaves,
  // with the camera kept where the shot was and the lens easing back.
  const exitLine = document.createElement('div');
  exitLine.id = 'mFocusExit';
  exitLine.textContent = 'Exit focus mode · tap again';
  document.body.appendChild(exitLine);
  let armedAt = 0, exitT = 0;
  const leaveFocus = () => {
    focus?.stop();
    root.classList.remove('mFocus');
    exitLine.classList.remove('on');
    armedAt = 0;
    wake();
  };
  const focusInput = (e) => {
    if (!root.classList.contains('mFocus')) return;
    e.preventDefault?.(); e.stopPropagation();
    if (performance.now() - armedAt < 4000) { leaveFocus(); return; }
    armedAt = performance.now();
    exitLine.classList.add('on');
    clearTimeout(exitT);
    exitT = setTimeout(() => { exitLine.classList.remove('on'); armedAt = 0; }, 4000);
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, focusInput, { capture: true, passive: false });
  window.addEventListener('mousemove', (e) => { if (e.movementX || e.movementY) focusInput(e); }, true);   // a mouse moved (desktop)
  onTouch(focusBtn, () => {
    closeAll();
    root.classList.remove('mTray'); fxBtn.classList.remove('on');
    if (bird?.mode !== 'off') bird?.set('off');
    if (!focus?.start()) return;
    joyEnd();
    setTimeout(() => root.classList.add('mFocus'), 0);   // after this touch, so it doesn't count as the first exit tap
  });

  // --- tap away from a card to close it -------------------------------------------------------
  const scrim = document.createElement('div');
  scrim.id = 'mScrim';
  document.body.appendChild(scrim);
  scrim.addEventListener('click', (e) => { e.stopPropagation(); closeAll(); });

  // what's open: the layout steps aside for a card, the tray, the map
  setInterval(() => {
    const sheet = ['showPanel', 'buildPanel'].some((id) => document.getElementById(id)?.classList.contains('open'))
      || (set && !set.classList.contains('hidden'));
    root.classList.toggle('mSheet', !!sheet);
    if (sheet && root.classList.contains('mTray')) trayOpen(false);
    if (sheet && bird && bird.mode !== 'off') bird.set('off');   // never both
    build.classList.toggle('on', !!document.getElementById('buildPanel')?.classList.contains('open'));
    const mapOn = !!bird && bird.mode !== 'off';
    map.classList.toggle('on', mapOn);
    root.classList.toggle('mMap', mapOn);
    for (const b of document.querySelectorAll('[data-mbird]')) b.classList.toggle('sel', b.dataset.mbird === bird?.mode);
  }, 150);

  // --- leave it alone and only the show remains --------------------------------------------
  let idleT = 0;
  function wake() {
    root.classList.remove('mIdle');
    clearTimeout(idleT);
    idleT = setTimeout(() => {
      const busy = root.classList.contains('mSheet') || root.classList.contains('mTray') || root.classList.contains('mMap')
        || root.classList.contains('mFocus') || joyId !== null || lookId !== null || inMenu() || document.activeElement?.tagName === 'INPUT';
      if (busy) wake(); else root.classList.add('mIdle');
    }, IDLE_MS);
  }
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel']) window.addEventListener(ev, wake, { passive: true, capture: true });
  wake();

  // --- the lens: wider upright; the Settings slider sets it -----------------------------------
  // main.js calls this whenever it refits the view (a turn included), before drawing
  const fovIn = document.getElementById('fovRange');
  const fitLens = (w = window.innerWidth, h = window.innerHeight) => {
    const base = Number(fovIn?.value) || 72;
    camera.fov = h > w ? Math.min(118, base * 1.28) : base;   // 72° on its side, 92° upright
    camera.updateProjectionMatrix();
  };
  window.__fitLens = fitLens;
  fitLens();
  fovIn?.addEventListener('input', () => fitLens());   // after the desktop's own handler has set it
}

// full screen: hide the browser's address bar and tabs. Android and iPad can go full
// screen from a button; an iPhone can't (Safari allows it for video only), but from the
// home screen it opens with no browser round it: the button says how.
function fullScreenButton(corner) {
  const standalone = window.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone;
  const IN = svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', { w: 2 });
  const OUT = svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>', { w: 2 });
  const full = corner('mFull', 'Full screen', IN);
  if (standalone) { full.classList.add('gone'); return; }   // already full screen: the slot stays, so nothing shifts
  const root = document.documentElement;
  const can = !!(root.requestFullscreen || root.webkitRequestFullscreen);
  const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const tip = document.createElement('div');
  tip.id = 'mFullTip';
  tip.innerHTML = 'For full screen on iPhone: tap <b>Share</b>, then <b>Add to Home Screen</b>, and open Creative Stage from there.';
  document.body.appendChild(tip);
  full.addEventListener('click', async (e) => {
    e.stopPropagation();
    const showTip = () => { tip.classList.add('on'); setTimeout(() => tip.classList.remove('on'), 6000); };
    if (can) {
      if (isFull()) { try { await (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (_) { /* already out */ } return; }
      setTimeout(() => { if (!isFull()) showTip(); }, 1000);   // some browsers neither go full screen nor say no
      try { await (root.requestFullscreen || root.webkitRequestFullscreen).call(root, { navigationUI: 'hide' }); } catch (_) { /* refused: the tip shows */ }
      return;
    }
    showTip();
  });
  tip.addEventListener('click', () => tip.classList.remove('on'));
  const paint = () => { full.innerHTML = isFull() ? OUT : IN; };
  document.addEventListener('fullscreenchange', paint);
  document.addEventListener('webkitfullscreenchange', paint);
}

// Your message (the Grid tab): the first tap plays it, like any effect. Selected, it asks
// for a second tap (a soft pulse); that opens a small editor right under it: the words
// shown straight, the effect playing live beneath, then the words, a colour and a lettering.
function messageEditor(designer) {
  const tile = document.querySelector('#showPanel [data-pane="grid"] [data-demo="message"]');
  if (!tile || !designer?.setText) return;
  const COLOURS = ['#ffffff', '#d8ff3a', '#ff3b5c', '#ffb020', '#2fd16a', '#2f8bff', '#a64dff', '#ff4fd8'];
  const ed = document.createElement('div');
  ed.className = 'mMsgEd';
  ed.hidden = true;
  ed.innerHTML = `<div class="mMsgPrev"></div>
    <canvas class="mMsgLive" width="320" height="180"></canvas>
    <input class="mMsgIn" type="text" maxlength="40" spellcheck="false" autocomplete="off" aria-label="Your message">
    <div class="mMsgRow mMsgCols">${COLOURS.map((c) => `<button data-mcol="${c}" style="--c:${c}" aria-label="Colour"></button>`).join('')}</div>
    <div class="mMsgRow mMsgFonts">${FONTS.map(([k, n, css]) => `<button data-mfont="${k}" style="font:${css.replace('{px}', '13')}">${n}</button>`).join('')}</div>
    <button class="mMsgDone">Done</button>`;
  tile.after(ed);
  tile.insertAdjacentHTML('beforeend', '<em class="mAgainTag">Tap to write</em>');
  const prev = ed.querySelector('.mMsgPrev'), input = ed.querySelector('.mMsgIn'), live = ed.querySelector('.mMsgLive');
  const lg = live.getContext('2d');
  const paint = () => {
    const T = designer.text;
    const face = (FONTS.find((f) => f[0] === T.font) || FONTS[0])[2];
    prev.textContent = T.str || ' ';
    prev.style.font = face.replace('{px}', '26');
    prev.style.color = T.a || '#fff';
    for (const b of ed.querySelectorAll('[data-mcol]')) b.classList.toggle('sel', b.dataset.mcol.toLowerCase() === String(T.a).toLowerCase());
    for (const b of ed.querySelectorAll('[data-mfont]')) b.classList.toggle('sel', b.dataset.mfont === T.font);
  };
  let raf = 0;
  const loop = () => {   // the tile's own live picture, copied in
    const src = tile.querySelector('canvas');
    if (src && src.width) { lg.fillStyle = '#000'; lg.fillRect(0, 0, live.width, live.height); lg.drawImage(src, 0, 0, live.width, live.height); }
    raf = ed.hidden ? 0 : requestAnimationFrame(loop);
  };
  const open = (on) => {
    ed.hidden = !on;
    tile.classList.toggle('editing', on);
    if (on) { input.value = designer.text.str || ''; paint(); if (!raf) raf = requestAnimationFrame(loop); }
    else if (document.activeElement === input) input.blur();
  };
  // selected, then tapped again: the editor. Tapped while open: it closes
  tile.addEventListener('click', (e) => {
    if (!tile.classList.contains('sel') && !tile.classList.contains('editing')) return;   // the first tap: play it, as normal
    if (designer.demo !== 'message') return;
    e.stopImmediatePropagation(); e.preventDefault();
    open(ed.hidden);
  }, true);
  let typeT = 0;
  input.addEventListener('input', () => {
    prev.textContent = input.value || ' ';
    clearTimeout(typeT);
    typeT = setTimeout(() => designer.setText({ str: input.value.trim() || 'WELCOME' }), 180);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); e.stopPropagation(); });
  ed.addEventListener('click', (e) => {
    e.stopPropagation();
    const c = e.target.closest('[data-mcol]'), f = e.target.closest('[data-mfont]');
    if (c) designer.setText({ a: c.dataset.mcol });
    else if (f) designer.setText({ font: f.dataset.mfont });
    else if (e.target.closest('.mMsgDone')) { open(false); return; }
    paint();
  });
  // another effect picked (or another tab): the editor folds away; the pulse follows the selection
  setInterval(() => {
    const mine = designer.demo === 'message' && tile.classList.contains('sel');
    tile.classList.toggle('mAgain', mine && ed.hidden);
    if (!mine && !ed.hidden) open(false);
  }, 300);
}

// four big number keys and four dots: 0000 lets you in
function gate(onOk) {
  const g = document.createElement('div');
  g.id = 'mGate';
  g.innerHTML = `<div class="mgBox">
    <h1 class="mgName">CREATIVE <b>STAGE</b></h1>
    <p>Enter the code</p>
    <div class="mgDots"><i></i><i></i><i></i><i></i></div>
    <div class="mgPad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map((k) => (k === '' ? '<span></span>' : `<button data-k="${k}">${k}</button>`)).join('')}</div>
  </div>`;
  document.body.appendChild(g);
  let typed = '';
  const dots = [...g.querySelectorAll('.mgDots i')];
  const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < typed.length));
  g.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (k === '⌫') typed = typed.slice(0, -1);
    else if (typed.length < 4) typed += k;
    paint();
    if (typed.length === 4) {
      if (typed === CODE) { g.classList.add('ok'); setTimeout(() => { g.remove(); onOk(); }, 250); }
      else { g.classList.add('no'); setTimeout(() => { g.classList.remove('no'); typed = ''; paint(); }, 450); }
    }
  });
}
