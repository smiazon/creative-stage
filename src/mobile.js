// The phone and tablet showcase: the same room, made for fingers.
// - a 4-digit code first (a casual gate, nothing more), then straight into the arena
// - two big camera buttons along the top, the view's name between them; small
//   round buttons in the corners: Settings and full screen (left), the 2D lights
//   map and Build (right)
// - a joystick bottom left to walk; drag anywhere else on the view to look round
// - FLY and a big SHOW bottom right; nothing else (no video, no menu)
// Everything else is the desktop app's own code, styled by mobile.css.
import * as THREE from 'three';

const CODE = '0000';
const OK_KEY = 'pm-mobile-ok';

// act the moment a finger touches the button. A phone won't make a "click" from a
// second finger while the first is still down (walking on the joystick), so buttons
// that must work mid-walk listen for the touch itself; the click that may follow is ignored.
function onTouch(el, fn) {
  let at = 0;
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); at = performance.now(); fn(e); });
  el.addEventListener('click', (e) => { e.stopPropagation(); if (performance.now() - at > 600) fn(e); });   // a keyboard or mouse click still works
}

export function initMobile({ camera, view, controls, nextAngle, touchMove, menuUI, overlay, closeAll = () => {}, toggleFly, isFlying = () => false }) {
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

  // --- the camera buttons ------------------------------------------------------------------
  const top = document.createElement('div');
  top.id = 'mCam';
  top.innerHTML = '<button class="mPrev" aria-label="Previous camera angle">‹</button>'
    + '<div class="mName"><small>Camera angle</small><b></b></div>'
    + '<button class="mNext" aria-label="Next camera angle">›</button>';
  document.body.appendChild(top);
  onTouch(top.querySelector('.mPrev'), () => nextAngle(-1));
  onTouch(top.querySelector('.mNext'), () => nextAngle(1));
  const nameEl = top.querySelector('.mName b'), src = document.getElementById('angleName');
  const showName = () => { nameEl.textContent = src?.textContent || 'Tap › to change'; };
  showName();
  if (src) new MutationObserver(showName).observe(src, { childList: true, characterData: true, subtree: true });

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

  // --- Fly: up you go, and stay up; again, and down you drop ---------------------------------
  const fly = document.createElement('button');
  fly.id = 'mFly';
  fly.innerHTML = '<b>FLY</b>';
  // in the same stack as SHOW, so the two can never overlap
  (document.getElementById('fabDock') || document.body).prepend(fly);
  onTouch(fly, () => toggleFly?.());   // works while the other thumb walks
  // camera angles and landings change it too: the button always says where you are
  setInterval(() => {
    const on = isFlying();
    fly.classList.toggle('on', on);
    fly.querySelector('b').textContent = on ? 'LAND' : 'FLY';
  }, 150);

  const showBtn = document.getElementById('showFab');
  let showAt = 0;
  showBtn?.addEventListener('pointerdown', () => { if (joyId !== null) { showAt = performance.now(); showBtn.click(); } });
  // the click a phone may still send after that touch: swallowed, or Show would open and shut
  showBtn?.addEventListener('click', (e) => { if (e.isTrusted && performance.now() - showAt < 600) e.stopImmediatePropagation(); }, true);

  // --- drag to look ------------------------------------------------------------------------
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  let lookId = null, lx = 0, ly = 0;
  view.addEventListener('pointerdown', (e) => {
    if (lookId !== null) return;
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

  // --- Show: the kind, the colours and the sliders stay put; only the effects scroll ------------
  const body = document.querySelector('#showPanel .spBody');
  if (body) {
    const stick = document.createElement('div');
    stick.className = 'mStick';
    for (const sel of ['.spKind', '.spColRow', '.spSpeedRow:not(.spGoboRow)', '.spGoboRow']) {
      const el = body.querySelector(`:scope > ${sel}`);
      if (el) stick.appendChild(el);
    }
    body.prepend(stick);
  }

  // the effects scroll: a lime rail shows where you are, and a pill says there are more below
  const panel = document.getElementById('showPanel');
  if (body && panel) {
    const rail = document.createElement('div');
    rail.className = 'mRail';
    rail.innerHTML = '<i></i>';
    const more = document.createElement('button');
    more.className = 'mMore';
    more.innerHTML = 'More effects <span aria-hidden="true">⌄</span>';
    panel.append(rail, more);
    more.addEventListener('click', (e) => { e.stopPropagation(); body.scrollBy({ top: body.clientHeight * 0.7, behavior: 'smooth' }); });
    const paintRail = () => {
      const stick = body.querySelector('.mStick');
      const pr = panel.getBoundingClientRect(), br = body.getBoundingClientRect();
      const sideways = stick && getComputedStyle(stick).position === 'sticky' && stick.getBoundingClientRect().width < br.width * 0.6;
      const topY = br.top - pr.top + (stick && !sideways ? stick.offsetHeight : 0) + 6;
      const h = Math.max(20, br.bottom - pr.top - topY - 10);
      rail.style.top = `${topY}px`;
      rail.style.height = `${h}px`;
      const max = body.scrollHeight - body.clientHeight;
      const view = Math.max(0.12, Math.min(1, body.clientHeight / Math.max(1, body.scrollHeight)));
      const th = h * view, at = max > 0 ? body.scrollTop / max : 0;
      rail.firstElementChild.style.height = `${th}px`;
      rail.firstElementChild.style.transform = `translateY(${(h - th) * at}px)`;
      rail.classList.toggle('none', max < 8);
      more.classList.toggle('gone', max < 8 || body.scrollTop > max - 30);
      panel.classList.toggle('mEnd', max < 8 || body.scrollTop > max - 30);
    };
    body.addEventListener('scroll', paintRail, { passive: true });
    window.addEventListener('resize', () => setTimeout(paintRail, 120));
    setInterval(() => { if (panel.classList.contains('open')) paintRail(); }, 400);
  }

  // --- small round buttons on the right: the 2D lights map, and Build --------------------------
  const corner = (id, label, svg) => {
    const b = document.createElement('button');
    b.id = id;
    b.className = 'mIcon';
    b.setAttribute('aria-label', label);
    b.innerHTML = svg;
    document.body.appendChild(b);
    return b;
  };
  const map = corner('mMap', 'Lights from above', '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
    + [[6, 6], [12, 6], [18, 6], [6, 12], [12, 12], [18, 12], [6, 18], [12, 18], [18, 18]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.1"/>`).join('') + '</svg>');
  const birdPanel = document.getElementById('birdPanel');
  map.addEventListener('click', (e) => {
    e.stopPropagation();
    if (birdPanel?.classList.contains('hidden')) {
      closeAll();
      document.getElementById('birdBtn')?.click();
      document.querySelector('[data-bird="orbs"]')?.click();
    } else document.getElementById('birdClose')?.click();
  });
  const build = corner('mBuild', 'Build', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3.6 17.2a1.6 1.6 0 1 0 2.3 2.3l5.7-5.7a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.1-.6-.6-2.1z"/></svg>');
  build.addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('buildFab')?.click(); });
  // which corner buttons are lit, and whether a panel is open (the layout steps aside for it)
  setInterval(() => {
    const sheet = ['showPanel', 'buildPanel'].some((id) => document.getElementById(id)?.classList.contains('open'))
      || !document.getElementById('settingsPanel')?.classList.contains('hidden');
    document.documentElement.classList.toggle('mSheet', sheet);
    if (sheet && birdPanel && !birdPanel.classList.contains('hidden')) document.getElementById('birdClose')?.click();   // never both
    build.classList.toggle('on', !!document.getElementById('buildPanel')?.classList.contains('open'));
    map.classList.toggle('on', !!birdPanel && !birdPanel.classList.contains('hidden'));
  }, 150);

  // --- tap away from a sheet to close it ------------------------------------------------------
  const scrim = document.createElement('div');
  scrim.id = 'mScrim';
  document.body.appendChild(scrim);
  scrim.addEventListener('click', (e) => { e.stopPropagation(); closeAll(); });

  // --- full screen: hide the browser's address bar and tabs -------------------------------------
  // Android and iPad can go full screen from a button. An iPhone can't (Safari
  // allows it for videos only), but from the home screen it opens with no browser
  // round it at all: the button says how, once.
  const standalone = window.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone;
  if (!standalone) {
    const full = document.createElement('button');
    full.id = 'mFull';
    full.setAttribute('aria-label', 'Full screen');
    const ICON_IN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
    const ICON_OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
    full.innerHTML = ICON_IN;
    document.body.appendChild(full);
    const root = document.documentElement;
    const can = !!(root.requestFullscreen || root.webkitRequestFullscreen);
    const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    const tip = document.createElement('div');
    tip.id = 'mFullTip';
    tip.innerHTML = 'For full screen on iPhone: tap <b>Share</b> <span aria-hidden="true">⬆︎</span>, then <b>Add to Home Screen</b>, and open Creative Stage from there.';
    document.body.appendChild(tip);
    full.addEventListener('click', async (e) => {
      e.stopPropagation();
      const showTip = () => { tip.classList.add('on'); setTimeout(() => tip.classList.remove('on'), 6000); };
      if (can) {
        if (isFull()) { try { await (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (_) { /* already out */ } return; }
        // some browsers neither go full screen nor say no: after a second, the tip
        setTimeout(() => { if (!isFull()) showTip(); }, 1000);
        try { await (root.requestFullscreen || root.webkitRequestFullscreen).call(root, { navigationUI: 'hide' }); } catch (_) { /* refused: the tip shows */ }
        return;
      }
      showTip();
    });
    tip.addEventListener('click', () => tip.classList.remove('on'));
    const paintFull = () => { full.innerHTML = isFull() ? ICON_OUT : ICON_IN; };
    document.addEventListener('fullscreenchange', paintFull);
    document.addEventListener('webkitfullscreenchange', paintFull);
  }

  // --- Settings: a small gear in the corner -----------------------------------------------------
  const set = document.getElementById('settingsPanel');
  if (set) {
    document.body.appendChild(set);   // out of the hidden top bar: a sheet of its own
    const gear = document.createElement('button');
    gear.id = 'mSet';
    gear.setAttribute('aria-label', 'Settings');
    gear.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    document.body.appendChild(gear);
    gear.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = set.classList.contains('hidden');
      closeAll();
      set.classList.toggle('hidden', !opening);
    });
    const head = document.createElement('div');
    head.className = 'mSetHead';
    head.innerHTML = '<button class="mSetClose" aria-label="Close"></button><span>Settings</span>';
    set.prepend(head);
    head.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); set.classList.add('hidden'); });
  }

  // upright, a phone sees a narrow slice of the room at the desktop's lens: wider when tall
  const fitLens = () => { camera.fov = window.innerHeight > window.innerWidth ? 92 : 72; camera.updateProjectionMatrix(); };
  fitLens();
  window.addEventListener('resize', () => setTimeout(fitLens, 80));

  // only Arena and Stadium here (Build's venue row)
  document.documentElement.classList.add('mobileReady');
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
