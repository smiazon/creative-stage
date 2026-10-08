// The tutorial: one thing to practise at a time, in plain words, near the
// middle of the screen. The button it is about glows. A bar fills as you
// actually do it (look round, walk a while, fly up...), then a big tick, then
// the next step. Back and Skip are on the card; Enter skips too (Space is
// jump, so it is left alone). If the browser can't hold the mouse, the
// look-around step skips itself. main.js says how far along each step is (tasks).
const KEY = 'ht-tips-seen-v3';
const cap = (k) => `<kbd>${k}</kbd>`;

export function initTips({ studio = () => false, closeAll = () => {}, tasks = {} } = {}) {
  const STEPS = [
    { id: 'camera', title: 'Change the camera angle', text: `Press the button at the top right 3 times.<br>Or use ${cap('&lt; ,')} and ${cap('&gt; .')} on the keyboard.`, target: 'camGroup' },
    { id: 'look', title: 'Look around', text: 'You\'re back on the floor.<br>Click on the screen, then move your mouse to look.' },
    { id: 'walk', title: 'Walk around', text: `Hold ${cap('W')} ${cap('A')} ${cap('S')} ${cap('D')} or the arrow keys.` },
    { id: 'fly', title: 'Fly up', text: `Press ${cap('F')} to fly, then hold ${cap('Space')} to go up.` },
    { id: 'land', title: 'Land again', text: `Press ${cap('F')} to walk again.` },
    { id: 'free', title: 'Get your mouse back', text: `Click again, or press ${cap('Esc')}.` },
    { id: 'freewalk', title: 'You can still move', text: `Your mouse is free for the buttons. You can still walk and change camera angles.<br>Looking around needs a click on the screen.<br>Try it: walk with ${cap('W')} ${cap('A')} ${cap('S')} ${cap('D')} now.` },
    { id: 'show', title: 'Open Show', text: 'Press Show at the bottom left.', target: 'showFab' },
    { id: 'effect', title: 'Try 3 effects', text: 'Tap 3 effects in Show. Watch the crowd!', target: '#showPanel .spPresets' },
    { id: 'colour', title: 'Pick new colours', text: 'Tap a colour set, or a circle to change one colour.', target: '#showPanel .spColRow' },
    { id: 'build', title: 'Open Build', text: 'This is where you change the stage.', target: 'buildFab' },
    { id: 'console', title: 'Open Console', text: 'Every light in the room is in here.', target: 'consoleBtn', studio: true },
    // making a video, last: its window stays open for all of it
    { id: 'video', title: 'Open Video', text: 'This is where you make a video.', target: 'videoFab' },
    { id: 'vadd', title: 'Add 2 effects', text: 'Tap 2 effects. They go into Your video, one after the other.', target: '#videoPanel .vpPick' },
    { id: 'vclip', title: 'Look at a clip', text: 'Tap a clip in Your video to see it.<br>Drag to change the order, ✕ takes it out.', target: '#videoPanel .vpReel' },
    { id: 'vsong', title: 'Pick a song', text: 'Tap Choose a song. It\'s fine to cancel for now.', target: '#videoPanel [data-reelsong]' },
    { id: 'vlen', title: 'Keep it short', text: 'Type 5 in the seconds box.<br>Making a video takes a while, much longer than the video itself, so start short.', target: '#videoPanel .vpLen' },
    { id: 'vrec', title: 'Record it', text: 'Press Record. Give it a moment: it\'s building your video.<br>It saves to your Downloads.', target: '#videoPanel .spRecord' },
  ];
  const card = document.createElement('div');
  card.id = 'tipCard';
  card.setAttribute('role', 'status');
  card.hidden = true;
  document.body.appendChild(card);
  let all = [], at = -1, state = null, timer = 0, poll = 0, ticking = false;

  const unglow = () => document.querySelectorAll('.tutGlow').forEach((el) => el.classList.remove('tutGlow'));
  const dots = () => all.map((s, i) => `<i class="${s.doneOk ? 'ok' : i === at ? 'now' : ''}"></i>`).join('');
  function paint(progress = 0) {
    const step = all[at];
    if (!step) return;
    card.classList.remove('done');
    card.innerHTML = `<b>${step.title}</b><p>${step.text}</p>
      <div class="tpBar"><i style="width:${Math.round(Math.min(1, progress) * 100)}%"></i></div>
      <div class="tpDots">${dots()}</div>
      <div class="tpBtns"><button data-tback ${at === 0 ? 'disabled' : ''}>← Back</button><button data-tskip>Skip →</button></div>
      <span class="tpSkip">${cap('Enter')} to skip</span>`;
  }
  function go(i, dir = 1) {
    clearInterval(poll);
    clearTimeout(timer);
    unglow();
    ticking = false;
    at = i;
    const step = all[at];
    if (!step) { finish(); return; }
    // an id, or a selector (the first one on screen: Show has a set of effects per kind)
    const glowOn = () => {
      if (!step.target) return;
      const el = /^[#.]/.test(step.target)
        ? [...document.querySelectorAll(step.target)].find((x) => x.offsetParent) : document.getElementById(step.target);
      el?.classList.add('tutGlow');
    };
    glowOn();
    const T = tasks[step.id];
    state = T?.start ? T.start() : null;
    paint(0);
    card.hidden = false;
    card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
    if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
    // a browser that can't hold the mouse: nothing to practise here
    if (step.id === 'look' && !('pointerLockElement' in document)) { timer = setTimeout(() => go(at + 1), 400); return; }
    const progress = () => {
      try { const v = T?.done?.(state); return v === true ? 1 : v === false || v == null ? 0 : Number(v) || 0; } catch (_) { return 0; }
    };
    // already true before anything was done (mouse never held, never took off):
    // nothing to practise, so on to the next without a free tick
    if (progress() >= 1) { timer = setTimeout(() => go(at + dir < 0 ? at + 1 : at + dir, at + dir < 0 ? 1 : dir), 0); return; }
    let shown = -1;
    poll = setInterval(() => {
      const p = progress();
      if (p >= 1) { complete(); return; }
      if (step.target && /^[#.]/.test(step.target) && !document.querySelector('.tutGlow')?.offsetParent) { unglow(); glowOn(); }
      const bar = card.querySelector('.tpBar i');
      if (bar && Math.abs(p - shown) > 0.01) { shown = p; bar.style.width = `${Math.round(p * 100)}%`; }
    }, 120);
  }
  function complete() {
    clearInterval(poll);
    unglow();
    const step = all[at];
    if (!step) return;
    step.doneOk = true;
    ticking = true;
    card.classList.add('done');
    card.innerHTML = `<span class="tpTick">✓</span><b>Nice!</b><div class="tpDots">${dots()}</div>`;
    timer = setTimeout(() => go(at + 1), 1100);
  }
  function finish() {
    at = -1;
    card.classList.add('done');
    card.innerHTML = `<span class="tpTick">🎉</span><b>You're ready!</b><p>Have fun.</p>`;
    timer = setTimeout(() => { card.hidden = true; card.classList.remove('done'); }, 2200);
    try { localStorage.setItem(KEY, '1'); } catch (_) { /* private mode */ }
  }
  card.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('[data-tback]') && at > 0) go(at - 1, -1);
    else if (e.target.closest('[data-tskip]') && at >= 0 && !ticking) go(at + 1);
  });
  // Enter skips (Space is jump)
  window.addEventListener('keydown', (e) => {
    if (card.hidden || at < 0 || ticking || (e.code !== 'Enter' && e.code !== 'NumpadEnter')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    go(at + 1);
  }, true);
  // the mouse can't be held (a browser in a frame, a policy): the look step skips itself
  document.addEventListener('pointerlockerror', () => {
    if (!card.hidden && all[at]?.id === 'look' && !ticking) go(at + 1);
  });

  const api = {
    start() {
      closeAll();   // a clear screen to follow along on
      all = STEPS.filter((s) => !s.studio || studio()).map((s) => ({ ...s, doneOk: false }));
      go(0);
    },
    // the first visit only
    firstTime() { if (api.willStart()) api.start(); },
    willStart() {
      try { return localStorage.getItem(KEY) !== '1'; } catch (_) { return true; }   // private mode: show it
    },
    // the main menu took over: the card goes, and so does the glow
    stop() { clearTimeout(timer); clearInterval(poll); at = -1; card.hidden = true; unglow(); },
    get open() { return !card.hidden; },
  };
  return api;
}
