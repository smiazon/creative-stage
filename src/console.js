// Show-control console: wires the DOM panel to the effect engines.
import * as THREE from 'three';

export function initConsole({ orbFX, fasciaFX, crowdFX, jumbo, lights, venue, rigFX, bstageFX, sphere, controls }) {
  const panel = document.getElementById('console');
  const btn = document.getElementById('consoleBtn');
  panel.dataset.pg = 'looks';

  function toggle(force) {
    const show = force !== undefined ? force : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !show);
    // the layout manager keys off this: with the director also open, the
    // director slides left so the two never overlap
    document.body.classList.toggle('console', show);
    if (show && controls.isLocked) controls.unlock();
  }
  btn.addEventListener('click', () => toggle());
  document.getElementById('conClose').addEventListener('click', (e) => {
    e.stopPropagation(); toggle(false);
  });

  // --- paged navigation: only one section is on screen at a time ----------
  document.querySelectorAll('[data-page]').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      e.stopPropagation();
      const pg = tab.dataset.page;
      document.querySelectorAll('[data-page]').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.conPage').forEach((p) => p.classList.toggle('active', p.dataset.pg === pg));
      panel.dataset.pg = pg;   // the frame takes the page's colour
      document.getElementById('conBody').scrollTop = 0;
    });
  });

  const activate = (selector, el) => {
    document.querySelectorAll(selector).forEach((b) => b.classList.toggle('active', b === el));
  };
  const hex = (id) => new THREE.Color(document.getElementById(id).value);
  const num = (id) => parseFloat(document.getElementById(id).value);

  // --- crowd orbs -----------------------------------------------------------
  const orbApply = () => orbFX.set({
    colorA: hex('orbA'), colorB: hex('orbB'),
    speed: num('orbSpeed'), brightness: num('orbBright'),
  });
  document.querySelectorAll('[data-orb]').forEach((b) => {
    b.addEventListener('click', () => {
      orbApply();
      orbFX.set({ mode: b.dataset.orb });
      activate('[data-orb]', b);
      document.querySelectorAll('[data-ofx]').forEach((x) => x.classList.remove('active'));
    });
  });
  for (const id of ['orbA', 'orbB', 'orbSpeed', 'orbBright']) {
    document.getElementById(id).addEventListener('input', orbApply);
  }
  document.getElementById('orbSize').addEventListener('input', (e) => {
    orbFX.setSize(parseFloat(e.target.value));
  });
  document.getElementById('orbVisBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    orbFX.setVisible(orbFX.orbsVisible === false);
    e.target.classList.toggle('active', orbFX.orbsVisible !== false);
  });

  // --- orb show: palette swatches + effect + tempo -------------------------
  const palBtns = Array.from(document.querySelectorAll('[data-oswatch]'));
  const pushPal = () => {
    const on = palBtns.filter((b) => b.classList.contains('active')).map((b) => b.dataset.oswatch);
    if (on.length) orbFX.setPalette(on);
  };
  palBtns.forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const active = b.classList.contains('active');
    const count = palBtns.filter((x) => x.classList.contains('active')).length;
    if (active && count === 1) return;    // the last colour stays
    if (!active && count >= 10) return;   // palette caps at ten
    b.classList.toggle('active');
    pushPal();
  }));
  document.querySelectorAll('[data-ofx]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      pushPal();
      orbFX.set({ mode: b.dataset.ofx, brightness: num('orbBright') });
      activate('[data-ofx]', b);
      document.querySelectorAll('[data-orb]').forEach((x) => x.classList.remove('active'));
    });
  });
  document.querySelectorAll('[data-ospd]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      orbFX.set({ speed: parseFloat(b.dataset.ospd) });
      document.getElementById('orbSpeed').value = b.dataset.ospd;
      activate('[data-ospd]', b);
    });
  });

  // --- animate orbs: physical crowd motion --------------------------------
  const animApply = () => orbFX.set({
    animStrength: num('animStrength'),
    animSpeed: num('animSpeed'),
  });
  document.querySelectorAll('[data-anim]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      animApply();
      orbFX.set({ animMode: parseInt(b.dataset.anim, 10) });
      activate('[data-anim]', b);
    });
  });
  for (const id of ['animStrength', 'animSpeed']) {
    document.getElementById(id).addEventListener('input', animApply);
  }

  // --- 2D crowd figures ---------------------------------------------------
  const peopleApply = () => crowdFX.set({
    speed: num('peopleSpeed'), level: num('peopleLevel'), scale: num('peopleScale'),
  });
  document.querySelectorAll('[data-people]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      peopleApply();
      crowdFX.set({ mode: b.dataset.people });
      activate('[data-people]', b);
    });
  });
  for (const id of ['peopleSpeed', 'peopleLevel', 'peopleScale']) {
    document.getElementById(id).addEventListener('input', peopleApply);
  }

  // --- house lights -----------------------------------------------------------
  // (the GAME / HOUSE ON preset buttons are wired in main.js via [data-light])
  for (const [id, key] of [
    ['hlMaster', 'master'], ['hlWarmth', 'warmth'],
    ['hlWashN', 'washN'], ['hlWashS', 'washS'], ['hlWashE', 'washE'], ['hlWashW', 'washW'],
  ]) {
    document.getElementById(id).addEventListener('input', (e) => {
      lights.set(key, parseFloat(e.target.value));
    });
  }

  // --- jumbotron ----------------------------------------------------------------
  const jumboApply = () => jumbo.set({
    color: document.getElementById('jumboColor').value,
    text: document.getElementById('jumboText').value || 'GO VOLTS!',
  });
  document.querySelectorAll('[data-jumbo]').forEach((b) => {
    b.addEventListener('click', () => {
      jumboApply();
      jumbo.set({ mode: b.dataset.jumbo });
      activate('[data-jumbo]', b);
    });
  });
  document.getElementById('jumboColor').addEventListener('input', jumboApply);
  document.getElementById('jumboText').addEventListener('input', jumboApply);
  // typing in the message field must not trigger WASD/fly/mode keys
  document.getElementById('jumboText').addEventListener('keydown', (e) => e.stopPropagation());

  // --- LED fascia rings ------------------------------------------------------------
  const fasciaApply = () => fasciaFX.set({
    colorA: hex('fasciaA'), colorB: hex('fasciaB'), speed: num('fasciaSpeed'),
  });
  document.querySelectorAll('[data-fascia]').forEach((b) => {
    b.addEventListener('click', () => {
      fasciaApply();
      fasciaFX.set({ mode: b.dataset.fascia });
      activate('[data-fascia]', b);
    });
  });
  for (const id of ['fasciaA', 'fasciaB', 'fasciaSpeed']) {
    document.getElementById(id).addEventListener('input', () => {
      fasciaApply();
      fasciaFX.set({}); // reapply current mode with new colors
    });
  }

  // --- show rig -----------------------------------------------------------
  const GAINS = { spot: 'gainSpot', wash: 'gainWash', beam: 'gainBeam', laser: 'gainLaser',
                  strip: 'gainStrip', strobe: 'gainStrobe', blinder: 'gainBlinder', uv: 'gainUv' };
  const rigApply = () => {
    rigFX.set({
      colorA: hex('rigA'), colorB: hex('rigB'),
      master: num('rigMaster'), haze: num('rigHaze'),
      beamBudget: Math.max(0, Math.round(num('rigBeams'))),
    });
    // per-fixture strength: mutate in place so the hot loop keeps its object
    for (const [k, id] of Object.entries(GAINS)) rigFX.gain[k] = num(id);
    document.getElementById('gainLaser2').value = String(num('gainLaser'));
  };
  document.querySelectorAll('[data-cue]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      rigApply();
      rigFX.cue(b.dataset.cue);
      activate('[data-cue]', b);
      // a cue owns the movement + laser/UV state, so reflect it in the UI
      document.querySelectorAll('[data-move]').forEach((m) => {
        m.classList.toggle('active', m.dataset.move === rigFX.behaviour);
      });
      document.getElementById('toggleLasers').classList.toggle('active', rigFX.lasersOn);
      document.getElementById('toggleLasers2').classList.toggle('active', rigFX.lasersOn);
      document.getElementById('toggleUV').classList.toggle('active', rigFX.uv);
    });
  });
  document.querySelectorAll('[data-move]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      rigFX.set({ behaviour: b.dataset.move });
      activate('[data-move]', b);
    });
  });
  document.getElementById('fireConfetti').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!window.__presetQuiet) rigFX.fireConfetti();   // not while a bank is being built
  });
  document.getElementById('toggleLasers').addEventListener('click', (e) => {
    e.stopPropagation();
    rigFX.set({ lasersOn: !rigFX.lasersOn });
    document.getElementById('toggleLasers').classList.toggle('active', rigFX.lasersOn);
    document.getElementById('toggleLasers2').classList.toggle('active', rigFX.lasersOn);
  });
  document.getElementById('toggleUV').addEventListener('click', (e) => {
    e.stopPropagation();
    rigFX.set({ uv: !rigFX.uv });
    e.target.classList.toggle('active', rigFX.uv);
  });
  for (const id of ['rigA', 'rigB', 'rigMaster', 'rigHaze', 'rigBeams', ...Object.values(GAINS)]) {
    document.getElementById(id).addEventListener('input', rigApply);
  }

  // --- lasers page --------------------------------------------------------
  const laserApply = () => {
    rigFX.set({
      laserPer: num('laserPer'),
      laserSweep: num('laserSweep'),
      laserSpread: num('laserSpread'),
      laserTilt: num('laserTilt'),
      laserPan: num('laserPan'),
    });
    rigFX.laserMat.uniforms.uWidthPx.value = num('laserWidth');
    rigFX.gain.laser = num('gainLaser2');
    // keep the FIXTURES page slider in sync so the two never disagree
    document.getElementById('gainLaser').value = String(num('gainLaser2'));
  };
  for (const id of ['laserPer', 'laserWidth', 'laserSweep', 'laserSpread', 'laserTilt', 'laserPan', 'gainLaser2']) {
    document.getElementById(id).addEventListener('input', laserApply);
  }
  // movement pattern: how the fans move (sweep, breathing fan, scan line, orbit, wave, chase, still, sky)
  document.querySelectorAll('[data-lpat]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      rigFX.set({ laserPattern: b.dataset.lpat });
      activate('[data-lpat]', b);
    });
  });
  document.querySelectorAll('[data-lcol]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      rigFX.set({ laserColorMode: b.dataset.lcol });
      activate('[data-lcol]', b);
    });
  });
  document.querySelectorAll('[data-lring]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      rigFX.set({ laserRing: parseInt(b.dataset.lring, 10) });
      activate('[data-lring]', b);
    });
  });
  const syncLaserBtns = () => {
    document.getElementById('toggleLasers').classList.toggle('active', rigFX.lasersOn);
    document.getElementById('toggleLasers2').classList.toggle('active', rigFX.lasersOn);
  };
  document.getElementById('toggleLasers2').addEventListener('click', (e) => {
    e.stopPropagation();
    rigFX.set({ lasersOn: !rigFX.lasersOn });
    syncLaserBtns();
  });

  // --- B-stage floor screen + LED ring ------------------------------------
  const bsApply = () => bstageFX.set({
    colorA: hex('bsColor'),
    ringColor: hex('bringColor'),
    catColor: hex('catColor'),
    brightness: num('bsLevel'),
    speed: num('bsSpeed'),
  });
  document.querySelectorAll('[data-bscreen]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      bsApply();
      bstageFX.set({ screenMode: b.dataset.bscreen });
      activate('[data-bscreen]', b);
    });
  });
  document.querySelectorAll('[data-bring]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      bsApply();
      bstageFX.set({ ringMode: b.dataset.bring });
      activate('[data-bring]', b);
    });
  });
  document.querySelectorAll('[data-catring]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      bsApply();
      bstageFX.set({ catMode: b.dataset.catring });
      activate('[data-catring]', b);
    });
  });
  for (const id of ['bsColor', 'bringColor', 'catColor', 'bsLevel', 'bsSpeed']) {
    document.getElementById(id).addEventListener('input', bsApply);
  }

  // real-light pool size: the biggest single perf lever in the app
  document.querySelectorAll('[data-track]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      rigFX.setTrackerCount(parseInt(b.dataset.track, 10));
      activate('[data-track]', b);
    });
  });

  // --- disclosure: 'More' folds -------------------------------------------------
  document.querySelectorAll('[data-more]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); b.closest('.more').classList.toggle('open');
  }));

  // --- fixture groups: one truss (or the floor) gets its own movement, colour,
  // level and gobo. 'Follow rig' hands a property back to the whole-rig setting.
  let curGrp = 'all';
  const syncGroupUI = () => {
    const g = rigFX.getGroup(curGrp);
    document.querySelectorAll('[data-gmove]').forEach((b) => b.classList.toggle('active', (g.behaviour || 'follow') === b.dataset.gmove));
    document.querySelectorAll('[data-gobo]').forEach((b) => b.classList.toggle('active', String(g.gobo) === b.dataset.gobo));
    const lv = document.getElementById('grpLevel'); if (lv) lv.value = String(g.level);
    const gc = document.getElementById('grpColor'); if (gc && g.color) gc.value = '#' + g.color.getHexString();
    document.getElementById('grpColorClear')?.classList.toggle('active', !g.color);
  };
  document.querySelectorAll('[data-grp]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); curGrp = b.dataset.grp; activate('[data-grp]', b); syncGroupUI();
  }));
  document.querySelectorAll('[data-gmove]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    rigFX.setGroup(curGrp, { behaviour: b.dataset.gmove === 'follow' ? null : b.dataset.gmove });
    activate('[data-gmove]', b);
  }));
  document.querySelectorAll('[data-gobo]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); rigFX.setGroup(curGrp, { gobo: parseInt(b.dataset.gobo, 10) }); activate('[data-gobo]', b);
  }));
  document.getElementById('grpColor')?.addEventListener('input', (e) => {
    rigFX.setGroup(curGrp, { color: new THREE.Color(e.target.value) });
    document.getElementById('grpColorClear')?.classList.remove('active');
  });
  document.getElementById('grpColorClear')?.addEventListener('click', (e) => {
    e.stopPropagation(); rigFX.setGroup(curGrp, { color: null }); e.currentTarget.classList.add('active');
  });
  document.getElementById('grpLevel')?.addEventListener('input', (e) => rigFX.setGroup(curGrp, { level: parseFloat(e.target.value) }));

  // --- Simple / Advanced -----------------------------------------------------
  // Simple shows only the preset decks. Advanced reveals every section under
  // them. Remembered per browser.
  const ADV_KEY = 'cs-advanced';
  const setAdvanced = (on) => {
    document.body.classList.toggle('advancedMode', on);
    document.getElementById('advToggle')?.classList.toggle('on', on);
    const m = document.getElementById('conMode'); if (m) m.textContent = on ? 'Advanced' : 'Simple';
    const k = document.querySelector('#advMenuBtn kbd'); if (k) k.textContent = on ? 'on' : 'off';
    try { localStorage.setItem(ADV_KEY, on ? '1' : '0'); } catch (_) { /* private mode */ }
  };
  const flipAdvanced = (e) => { e.stopPropagation(); setAdvanced(!document.body.classList.contains('advancedMode')); };
  document.getElementById('advToggle')?.addEventListener('click', flipAdvanced);
  document.getElementById('advMenuBtn')?.addEventListener('click', flipAdvanced);
  try { setAdvanced(localStorage.getItem(ADV_KEY) === '1'); } catch (_) { setAdvanced(false); }

  // --- presets: plain-language macros over the real controls -----------------
  const $ = (sel) => document.querySelector(sel);
  const fire = (sel) => { const el = $(sel); if (el) el.click(); };
  const set = (sel, v) => { const el = $(sel); if (!el) return; el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const setMax = (sel) => { const el = $(sel); if (el) set(sel, el.max); };
  const setMin = (sel) => { const el = $(sel); if (el) set(sel, el.min); };
  const want = (sel, on) => { const el = $(sel); if (!el) return; const is = el.classList.contains('active') || el.classList.contains('on'); if (is !== on) el.click(); };
  const colours = (a, b) => { set('#rigA', a); set('#rigB', b); };
  const PRESETS = {
    // lights
    'lights:soft':   () => { fire('[data-move="park"]'); want('#toggleLasers', false); colours('#ffb070', '#ff8a5a'); set('#rigMaster', 0.85); set('#gainWash', 1.4); set('#gainSpot', 0.35); set('#gainBeam', 0.2); set('#rigHaze', 0.7); },
    'lights:sweep':  () => { fire('[data-move="sweep"]'); want('#toggleLasers', false); set('#rigMaster', 1); set('#gainBeam', 1.2); set('#gainSpot', 0.9); set('#gainWash', 0.7); set('#rigHaze', 1.1); },
    'lights:party':  () => { fire('[data-move="ballyhoo"]'); set('#rigMaster', 1); set('#gainBeam', 1.3); set('#gainSpot', 1); set('#gainWash', 0.8); set('#rigHaze', 1.2); },
    'lights:lasers': () => fire('[data-cue="lasershow"]'),
    'lights:white':  () => { fire('[data-move="park"]'); colours('#ffffff', '#ffffff'); set('#gainSpot', 1.2); set('#gainBeam', 0.6); set('#gainWash', 0.5); },
    'lights:strobe': () => fire('[data-cue="hit"]'),
    'lights:blue':   () => { fire('[data-move="sweep"]'); colours('#2f7bff', '#35c8ff'); set('#gainBeam', 1.1); set('#gainWash', 0.9); },
    'lights:sunset': () => { fire('[data-move="fan"]'); colours('#ff7a1a', '#ff2fb4'); set('#gainWash', 1.2); set('#gainBeam', 0.8); },
    'lights:fire':   () => { fire('[data-move="ballyhoo"]'); colours('#ff3b30', '#ffc61a'); set('#gainBeam', 1.2); set('#gainWash', 1); },
    'lights:rainbow':() => fire('[data-cue="rainbow"]'),
    // laser movement: all four leave the rig where it is and only take the lasers
    'lights:lasersky':   () => { want('#toggleLasers', true); fire('[data-lpat="sky"]'); set('#laserSweep', 0.8); set('#laserSpread', 1.2); set('#gainLaser2', 1.3); },
    'lights:laserfan':   () => { want('#toggleLasers', true); fire('[data-lpat="fan"]'); set('#laserSpread', 2.4); set('#laserTilt', 0.15); set('#laserSweep', 1); },
    'lights:laserscan':  () => { want('#toggleLasers', true); fire('[data-lpat="scan"]'); set('#laserSweep', 1.2); set('#laserSpread', 1.8); set('#laserTilt', 0); },
    'lights:lasertunnel':() => { want('#toggleLasers', true); fire('[data-lpat="circle"]'); set('#laserSpread', 0.9); set('#laserSweep', 0.9); set('#laserTilt', 0.3); },
    'lights:uv':     () => fire('[data-cue="preshow"]'),
    'lights:dark':   () => fire('[data-cue="blackout"]'),
    // screens
    'video:wall':     () => { fire('[data-sidescr="off"]'); fire('[data-flownb="off"]'); fire('[data-flownf="off"]'); fire('[data-vroute="both"]'); },
    'video:sides':    () => { fire('[data-sidescr="flat"]'); fire('[data-flownb="off"]'); fire('[data-flownf="off"]'); fire('[data-vroute="both"]'); },
    'video:surround': () => { fire('[data-sidescr="flat"]'); fire('[data-flownb="rect"]'); fire('[data-flownf="rect"]'); fire('[data-vroute="both"]'); },
    'video:dark':     () => { fire('[data-vroute="orbs"]'); fire('[data-sidescr="off"]'); fire('[data-flownb="off"]'); fire('[data-flownf="off"]'); },
    'video:play':     () => { fire('[data-vpreset="off"]'); fire('[data-vroute="both"]'); fire('[data-video="play"]'); },
    'video:aurora':   () => fire('[data-vpreset="aurora"]'),
    'video:stars':    () => fire('[data-vpreset="starfield"]'),
    'video:waves':    () => fire('[data-vpreset="waves"]'),
    // the giant sphere's skin (stadium middle stage)
    'sphere:earth': () => sphere?.set('earth'),
    'sphere:night': () => sphere?.set('night'),
    'sphere:moon':  () => sphere?.set('moon'),
    'sphere:sun':   () => sphere?.set('sun'),
    'sphere:plasma': () => sphere?.set('plasma'),
    'sphere:candy':  () => sphere?.set('candy'),
    'sphere:disco':  () => sphere?.set('disco'),
    'sphere:lava':   () => sphere?.set('lava'),
    'sphere:ripple': () => sphere?.set('ripple'),
    'sphere:matrix': () => sphere?.set('matrix'),
    'sphere:neon':   () => sphere?.set('neon'),
    'sphere:nebula': () => sphere?.set('nebula'),
    'sphere:video': () => sphere?.set('video'),
    'sphere:rig':   () => sphere?.set('rig'),
    'sphere:off':   () => sphere?.set('off'),
    'pose:flat':  () => { set('#scrDepth', 0); set('#scrHeight', 0); set('#scrTilt', 0); set('#scrTurn', 0); },
    'pose:risen': () => { set('#scrDepth', 0); set('#scrHeight', 6); set('#scrTilt', 0); set('#scrTurn', 0); },
    'pose:over':  () => { set('#scrDepth', 2); set('#scrHeight', 7); set('#scrTilt', 28); set('#scrTurn', 0); },
    'pose:flown': () => { set('#scrDepth', 4); set('#scrHeight', 12); set('#scrTilt', 40); set('#scrTurn', 0); },
    'pose:left':  () => { set('#scrTurn', -30); },
    'pose:right': () => { set('#scrTurn', 30); },
    // crowd
    'crowd:off':       () => { fire('[data-orb="off"]'); fire('[data-people="off"]'); },
    // the live camera owns its device and panel (livecam.js): ask it to start
    'crowd:camera':    () => document.dispatchEvent(new CustomEvent('livecam', { detail: 'start' })),
    'crowd:glow':      () => { fire('[data-ofx="psolid"]'); fire('[data-ospd="0.55"]'); fire('[data-people="idle"]'); },
    'crowd:wave':      () => { fire('[data-orb="wave"]'); fire('[data-people="wave"]'); },
    'crowd:rainbow':   () => { fire('[data-orb="rainbow"]'); fire('[data-people="cheer"]'); },
    'crowd:strobe':    () => { fire('[data-ofx="pstrobe"]'); fire('[data-ospd="3.6"]'); },
    'crowd:hands':     () => { fire('[data-ofx="psolid"]'); fire('#handsUpBtn'); },
    'crowd:twinkle':   () => { fire('[data-ofx="ptwinkle"]'); fire('[data-ospd="1"]'); },
    'crowd:heartbeat': () => { fire('[data-orb="heartbeat"]'); fire('[data-people="idle"]'); },
    'crowd:fire':      () => fire('[data-orb="fire"]'),
    'crowd:cheer':     () => { fire('[data-people="cheer"]'); fire('[data-sfx="roar"]'); },
    'crowd:jump':      () => { fire('[data-people="jump"]'); fire('[data-orb="pulse"]'); },
    'crowd:balloons':  () => { want('#toggleBalloons', true); },
    'crowd:calm':      () => { fire('[data-people="idle"]'); fire('[data-ofx="psolid"]'); fire('[data-ospd="0.25"]'); },
    // effects
    'fx:confetti':  () => { fire('#fireConfetti'); fire('#firePoppers'); },
    'fx:streamers': () => fire('#fireStreamers'),
    'fx:poppers':   () => fire('#fireArenaPop'),
    'fx:fire':      () => { want('#toggleFlames', true); fire('#firePyroBtn'); },
    'fx:pyro':      () => { want('#togglePyro', true); },
    // outdoor pyro: the stadium's fireworks (the arena hides these tiles)
    'fx:fireworks': () => fire('#fireFireworks'),
    'fx:fwshow':    () => { want('#toggleFireworks', true); },
    'fx:fwfinale':  () => fire('#fireFinale'),
    'fx:flamesoff': () => { want('#toggleFlames', false); want('#togglePyro', false); want('#toggleFireworks', false); },
    'fx:fog':       () => { want('#toggleFog', true); set('#fogDensity', 1.1); },
    'fx:co2':       () => fire('#fireJets'),
    'fx:finale':    () => { want('#toggleFlames', true); fire('#firePyroBtn'); fire('#fireConfetti'); fire('#fireArenaPop'); fire('#fireJets'); },
    'fx:risersup':  () => { setMax('#aLiftSlider'); setMax('#bLiftSlider'); },
    'fx:risersdown':() => { setMin('#aLiftSlider'); setMin('#bLiftSlider'); },
    // sound
    'sound:arena':   () => fire('[data-sndp="arena"]'),
    'sound:stadium': () => fire('[data-sndp="stadium"]'),
    'sound:club':    () => fire('[data-sndp="club"]'),
    'sound:clean':   () => fire('[data-sndp="dry"]'),
    'sound:warm':    () => { set('[data-desk="bass"]', 0.4); set('[data-desk="mid"]', 0); set('[data-desk="treble"]', -0.2); set('[data-desk="reverb"]', 1.2); set('[data-desk="punch"]', 0.2); },
    'sound:bass':    () => { set('[data-desk="bass"]', 0.8); set('[data-desk="punch"]', 0.6); set('[data-desk="sub"]', 1.5); set('[data-desk="reverb"]', 0.8); },
    'sound:voice':   () => { set('[data-desk="bass"]', -0.2); set('[data-desk="mid"]', 0.4); set('[data-desk="treble"]', 0.3); set('[data-desk="reverb"]', 0.7); set('[data-desk="punch"]', 0.3); },
    'sound:flat':    () => fire('#sfxFlat'),
    'sound:roar':    () => fire('[data-sfx="roar"]'),
    'sound:ole':     () => fire('[data-sfx="ole"]'),
    'sound:clap':    () => fire('[data-sfx="clap"]'),
    'sound:ambience':() => fire('#crowdLoopBtn'),
    // room
    'venue:crimson':  () => set('#seatColor', '#8a1220'),
    'venue:royal':    () => set('#seatColor', '#1e4fb8'),
    'venue:black':    () => set('#seatColor', '#141418'),
    'venue:charcoal': () => set('#seatColor', '#3a3c42'),
    'venue:green':    () => set('#seatColor', '#1f6b3a'),
    'venue:purple':   () => set('#seatColor', '#4a2a8a'),
    'venue:suiteson': () => want('#suiteLightsBtn', true),
    'venue:suitesoff':() => want('#suiteLightsBtn', false),
    'venue:banners':  () => fire('#bannersBtn'),
    'venue:planets':  () => fire('[data-props="planets"]'),
    'venue:hearts':   () => fire('[data-props="hearts"]'),
    'venue:noprops':  () => fire('[data-props="off"]'),
    'venue:ca':       () => fire('[data-flag="ca"]'),
    'venue:us':       () => fire('[data-flag="us"]'),
    'venue:noflag':   () => fire('[data-flag="off"]'),
    // setup
    'perf:fastest':   () => { fire('[data-track="0"]'); want('#seatLowBtn', true); set('#rigBeams', 24); },
    'perf:balanced':  () => { fire('[data-track="2"]'); want('#seatLowBtn', false); set('#rigBeams', 48); },
    'perf:cinematic': () => { fire('[data-track="6"]'); want('#seatLowBtn', false); set('#rigBeams', 72); },
  };
  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const run = PRESETS[b.dataset.preset];
    if (!run) return;
    run();
    // momentary: the tile lights, then settles — the state it set is what stays
    b.classList.add('active'); setTimeout(() => b.classList.remove('active'), 900);
  }));

  // --- venue --------------------------------------------------------------------
  document.getElementById('seatColor').addEventListener('input', (e) => {
    venue.setSeatColor(e.target.value);
  });
  document.getElementById('bannersBtn').addEventListener('click', (e) => {
    e.target.classList.toggle('active', venue.toggleBanners());
  });
  document.getElementById('jumboVisBtn').addEventListener('click', (e) => {
    e.target.classList.toggle('active', venue.toggleJumbo());
  });

  // The layer-preset banks are built by composing these macros (see
  // layerpresets.js), so the map has to be reachable from outside.
  return {
    toggle,
    runPreset: (key) => { const run = PRESETS[key]; if (run) run(); return !!run; },
    presetKeys: () => Object.keys(PRESETS),
  };
}
