// PixMob Stage main menu.
// Landing (PIXMOB STAGE + ENTER), then how you want to work, then the venue:
//   QUICK SHOWCASE  presets only, ready in seconds: you land in a concert with
//                   the SHOW panel open and a show already on the wristbands
//   SHOW STUDIO     the whole toolset, built to a song: you land with the
//                   director's deck open, ready for a track
// Every venue walks straight into creative mode, where the builder panel
// (builder.js) swaps what is on the floor live. main.js does what each way of
// working means once inside (onEnter).
//
// The world is built once at boot for one building, so picking the other one
// reloads the page. The builder leaves a boot intent behind, and this module
// reads it on the way back up and walks straight into the sim.

const MODE_KEY = 'ht-app-mode';
export const APP_MODES = { quick: 'Quick Showcase', studio: 'Show Studio' };

export function initMenu({ controls, builder, spawn }) {
  const overlay = document.getElementById('overlay');
  let mode = 'quick';
  try { const m = localStorage.getItem(MODE_KEY); if (APP_MODES[m]) mode = m; } catch (_) { /* private mode */ }
  const api = { show: null, onEnter: null, get mode() { return mode; } };
  function setMode(m) {
    if (!APP_MODES[m]) return;
    mode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch (_) { /* private mode */ }
    const tag = document.querySelector('.vnModeTag');
    if (tag) tag.textContent = APP_MODES[m];
    // a quick showcase offers the arena and the stadium only
    document.body.classList.toggle('pick-quick', m === 'quick');
  }
  api.setMode = setMode;

  // --- Show Studio is behind a PIN ------------------------------------------------
  // Four boxes, a tiny lock. Once it is right, Studio stays open until the app
  // is closed (sessionStorage). It keeps a demo's audience in Quick Showcase;
  // it is not a lock on the files themselves.
  const PIN = '0000', PIN_KEY = 'ht-studio-ok';
  let unlocked = false;
  try { unlocked = sessionStorage.getItem(PIN_KEY) === '1'; } catch (_) { /* private mode */ }
  const LOCK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="currentColor"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  const gate = document.createElement('div');
  gate.id = 'pinGate';
  gate.hidden = true;
  gate.innerHTML = `<div class="pgBox" role="dialog" aria-label="Show Studio code">
    <span class="pgLock">${LOCK_SVG}</span>
    <div class="pgDigits">${[0, 1, 2, 3].map((i) => `<input inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="off" aria-label="Digit ${i + 1}" data-pin="${i}">`).join('')}</div>
  </div>`;
  document.body.appendChild(gate);
  const boxes = [...gate.querySelectorAll('input')];
  let onOpen = null;
  const clear = () => { boxes.forEach((b) => { b.value = ''; }); boxes[0].focus(); };
  function closeGate() { gate.hidden = true; onOpen = null; }
  function check() {
    const code = boxes.map((b) => b.value).join('');
    if (code.length < 4) return;
    if (code === PIN) {
      unlocked = true;
      try { sessionStorage.setItem(PIN_KEY, '1'); } catch (_) { /* private mode */ }
      document.body.classList.add('studio-open');
      const go = onOpen;
      closeGate();
      go?.();
    } else {
      gate.querySelector('.pgBox').classList.remove('shake');
      void gate.offsetWidth;
      gate.querySelector('.pgBox').classList.add('shake');
      setTimeout(clear, 260);
    }
  }
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => {
      b.value = b.value.replace(/\D/g, '').slice(-1);
      if (b.value && i < 3) boxes[i + 1].focus();
      check();
    });
    b.addEventListener('keydown', (e) => {
      e.stopPropagation();   // the room's and the menu's keys stay out of it
      if (e.key === 'Backspace' && !b.value && i > 0) { boxes[i - 1].focus(); boxes[i - 1].value = ''; }
      if (e.key === 'Escape') closeGate();
    });
    b.addEventListener('paste', (e) => {
      const d = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 4);
      if (!d) return;
      e.preventDefault();
      d.split('').forEach((c, k) => { if (boxes[k]) boxes[k].value = c; });
      boxes[Math.min(3, d.length)].focus();
      check();
    });
  });
  gate.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === gate) closeGate(); });
  // run `then` once Studio is open: straight away, or after the right code
  api.requestStudio = (then) => {
    if (unlocked) { then?.(); return; }
    onOpen = then;
    gate.hidden = false;
    clear();
  };
  api.lockIcon = LOCK_SVG;
  if (unlocked) document.body.classList.add('studio-open');
  // a Studio left open last time is closed again until the code is given
  if (mode === 'studio' && !unlocked) mode = 'quick';
  const screens = [...document.querySelectorAll('.mScreen')];
  const bgVideo = document.getElementById('mBgVideo');
  const texVideo = document.getElementById('ringVid');   // shared texture clip

  // --- the second word of the title is a window onto the texture video --------
  // The span's glyphs are drawn onto a canvas as a mask, then the video is
  // composited through them (source-in). The same <video> element also shows
  // through the ENTER pill's ring mask, so one decode feeds both. The word is
  // read from the span itself, so the markup is the only place it lives.
  const wordSpan = document.getElementById('stageWord');
  const wordCanvas = document.getElementById('stageCanvas');
  const wordCtx = wordCanvas.getContext('2d');
  const WORD = wordSpan.textContent.trim();
  let landingLive = true;
  function drawWord() {
    requestAnimationFrame(drawWord);
    if (!landingLive || texVideo.videoWidth === 0) return;
    const r = wordSpan.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (wordCanvas.width !== W || wordCanvas.height !== H) {
      wordCanvas.width = W; wordCanvas.height = H;
    }
    const cs = getComputedStyle(wordSpan);
    wordCtx.clearRect(0, 0, W, H);
    // glyphs first (the mask), video composited through them
    wordCtx.font = `900 ${parseFloat(cs.fontSize) * dpr}px 'Arial Black', system-ui, sans-serif`;
    wordCtx.letterSpacing = `${parseFloat(cs.letterSpacing) * dpr || 0}px`;
    const asc = wordCtx.measureText(WORD).fontBoundingBoxAscent ?? parseFloat(cs.fontSize) * dpr * 0.8;
    wordCtx.fillStyle = '#fff';
    wordCtx.fillText(WORD, 0, asc);
    wordCtx.globalCompositeOperation = 'source-in';
    // cover-fit the video into the word box
    const vw = texVideo.videoWidth, vh = texVideo.videoHeight;
    const s = Math.max(W / vw, H / vh);
    wordCtx.drawImage(texVideo, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
    wordCtx.globalCompositeOperation = 'source-over';
  }
  drawWord();

  // --- ENTER ring: a hairline window onto the same clip ----------------------
  function fitRingMask() {
    const b = document.getElementById('mEnter').getBoundingClientRect();
    if (!b.width) return;
    const w = b.width + 6, hgt = b.height + 6;
    const rx = hgt / 2 - 2;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${hgt}'>` +
      `<rect x='2' y='2' width='${w - 4}' height='${hgt - 4}' rx='${rx}' fill='none' stroke='white' stroke-width='1.6'/></svg>`;
    const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    texVideo.style.webkitMaskImage = url;
    texVideo.style.maskImage = url;
    texVideo.style.webkitMaskSize = '100% 100%';
    texVideo.style.maskSize = '100% 100%';
    texVideo.classList.add('ready');
  }
  window.addEventListener('resize', fitRingMask);

  // hold the whole lockup until the texture clip can paint, then reveal both
  // words and ENTER in the same breath
  const reveal = () => {
    const land = document.querySelector('.mScreen[data-ms=landing]');
    if (land.classList.contains('ready')) return;
    land.classList.add('ready');
    fitRingMask();
    requestAnimationFrame(fitRingMask);   // once more with settled layout
  };
  texVideo.addEventListener('canplay', reveal, { once: true });
  setTimeout(reveal, 3000);               // never hold the page hostage

  function show(name) {
    screens.forEach((s) => s.classList.toggle('active', s.dataset.ms === name));
    if (overlay.style.display !== 'none') document.body.classList.add('menu');
    // the backdrop clips only need to run while they are actually on screen
    landingLive = name === 'landing';
    if (landingLive) { bgVideo.play().catch(() => {}); texVideo.play().catch(() => {}); }
    else { bgVideo.pause(); texVideo.pause(); }
  }

  document.getElementById('mEnter').addEventListener('click', (e) => {
    e.stopPropagation();
    // push-through: the landing scales toward the viewer as the picker rises,
    // so ENTER reads as walking into the building rather than a crossfade
    const land = document.querySelector('.mScreen[data-ms=landing]');
    land?.classList.add('zoom');
    setTimeout(() => land?.classList.remove('zoom'), 520);
    show('mode');
  });

  // --- how you want to work ---------------------------------------------------------
  const modeCards = [...document.querySelectorAll('.mdCard')];
  for (const card of modeCards) {
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const go = () => { setMode(card.dataset.mode); show('chooser'); };
      if (card.dataset.mode === 'studio') api.requestStudio(go); else go();
    });
    // the Studio card wears a tiny lock until it is opened
    if (card.dataset.mode === 'studio') card.insertAdjacentHTML('beforeend', `<span class="mdLock" title="Needs the code">${LOCK_SVG}</span>`);
  }
  document.getElementById('mdBack').addEventListener('click', (e) => { e.stopPropagation(); show('landing'); });

  // --- the venue picker ---------------------------------------------------------
  const cards = [...document.querySelectorAll('.vnCard')];
  function pickVenue(venue, card) {
    if (!venue || document.body.classList.contains('vnLeaving')) return;
    // another building, or a rig this page was not built with: reload into it
    // and come straight back inside
    if (builder.needsReboot(venue)) {
      document.body.classList.add('vnLeaving');
      card?.classList.add('loading');
      builder.reboot({ venue, open: false });
      return;
    }
    enterSim();
  }
  for (const card of cards) {
    card.addEventListener('click', (e) => { e.stopPropagation(); pickVenue(card.dataset.venue, card); });
  }
  // proximity lighting: the photo lights up under the cursor like a followspot
  document.querySelector('.vnGrid')?.addEventListener('pointermove', (e) => {
    const art = e.target.closest('.vnArt');
    if (!art) return;
    const r = art.getBoundingClientRect();
    art.style.setProperty('--px', `${e.clientX - r.left}px`);
    art.style.setProperty('--py', `${e.clientY - r.top}px`);
  });
  // the number keys pick while a picker is up
  window.addEventListener('keydown', (e) => {
    if (overlay.style.display === 'none' || overlay.classList.contains('lightsDown')) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const list = document.querySelector('.mScreen[data-ms=chooser].active') ? cards
      : document.querySelector('.mScreen[data-ms=mode].active') ? modeCards : null;
    const shown = list?.filter((c) => getComputedStyle(c).display !== 'none');
    const card = shown?.[parseInt(e.key, 10) - 1];
    if (card) card.click();
  });
  document.getElementById('chCancel').addEventListener('click', (e) => {
    e.stopPropagation(); show('mode');
  });

  // --- walking in ---------------------------------------------------------------
  function enterSim({ open = false } = {}) {
    bgVideo.pause();
    texVideo.pause();
    landingLive = false;
    // every entry is creative mode: the builder owns what is on the floor; a
    // quick showcase is always a show, so it starts with the concert in
    builder.setEnabled(true);
    if (mode === 'quick' && builder.state.mode !== 'concert') builder.state.mode = 'concert';
    builder.apply();
    // house lights down: the room above is already built. Dim the picker away
    // and reveal it standing there, then hand over the camera.
    overlay.classList.add('lightsDown');
    document.body.classList.remove('menu');
    // every entry lands you in the house facing the floor, never wherever the
    // camera happened to be left
    spawn?.();
    // Pointer lock needs the click that got us here. After a reload there is
    // none, so leave RESUME up for the next click instead of failing silently.
    const gesture = navigator.userActivation ? navigator.userActivation.isActive : true;
    if (gesture && !open) controls.lock();
    else document.getElementById('menuBar').style.display = 'flex';
    if (open) builder.open();
    setTimeout(() => {
      overlay.style.display = 'none';
      overlay.classList.remove('lightsDown');
    }, 700);
    // what this way of working means inside (main.js)
    setTimeout(() => api.onEnter?.(mode), 60);
  }

  // in-sim MAIN MENU button: back to how you want to work
  // (the MAIN MENU dropdown's Return to main menu, and Settings' own)
  for (const id of ['mmReturn', 'settingsMenuBtn']) {
    document.getElementById(id)?.addEventListener('click', () => {
      document.body.classList.add('menu');
      show('mode');
    });
  }

  // --- boot intent: a reload for another building (or the sphere's rig) -------
  // initMenu runs while main.js is still evaluating, and entering the sim
  // touches module constants declared further down, so let the module finish
  const intent = builder.takeBootIntent();
  if (intent) {
    document.body.classList.add('menu');
    queueMicrotask(() => enterSim({ open: !!intent.open }));
  } else {
    show('landing');
  }
  setMode(mode);
  api.show = show;
  // straight into the room, no clicks (the desktop app's hidden video maker)
  api.enter = (m) => { if (m) setMode(m); enterSim(); };
  return api;
}
