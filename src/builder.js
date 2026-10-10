// Creative mode: the live venue builder. Every visit to either building lands
// here (the menu only picks the building), and this panel swaps what is on the
// floor on the fly: empty, a concert, hockey, basketball or football. Think
// Minecraft creative. Every change goes through the same functions the scene
// uses everywhere else (setMode, setStageConfig, applyCurtain, applyCovers,
// setBasketballFloor), so the panel can never disagree with the room about
// what a setting means.
//
// Two changes cannot happen in place, because the world is built once at
// boot: moving to the other building, and the stadium's giant sphere, which
// flies its own 360-degree ring rig. Those reload the page with the builder's
// state in a boot intent, and the menu walks straight back into the sim.
import { CURTAIN_CUT, CAT_H } from './stage.js';
import { VENUE, VENUES, IS_STADIUM, IS_FESTIVAL, SPEC, reloadIntoVenue } from './venue.js';
import { makeRingRigPlan } from './ringrig.js';
import { makeMovable } from './windows.js';

const STADIUM = IS_STADIUM;   // open air: no curtains, no C-stage
// Seat tarps go wherever there are stands: the arena, the stadium and the
// cricket ground. The festival field has none.
const TARPS = !IS_FESTIVAL;
const MODE_NAMES = {
  creative: 'Empty', concert: 'Concert', hockey: 'Hockey',
  basketball: 'Basketball', football: 'Football', cricket: 'Cricket',
};
const MODES = Object.keys(MODE_NAMES);
// What each building can host. A 100 x 64 m pitch does not fit under the
// arena's roof, so there the Football button is a door to the stadium.
const HOSTS = {
  arena: ['creative', 'concert', 'hockey', 'basketball'],
  stadium: ['creative', 'concert', 'hockey', 'basketball', 'football'],
  cricket: ['creative', 'concert', 'cricket', 'hockey', 'basketball'],
  festival: ['concert'],            // a festival is always a show
};
// the building a mode needs when this one cannot host it
const homeOf = (mode) => (mode === 'football' ? 'stadium' : mode === 'cricket' ? 'cricket' : 'arena');
const ROOMS = [
  ['full', 'Full'], ['large', 'Large'], ['medium', 'Medium'],
  ['small', 'Small'], ['theatre', 'Theatre'], ['hemicycle', 'Hemi'],
];
// A reload hands the builder state across in BOOT_KEY. main.js reads the rig
// plan from RIG_KEY while it builds the world, before any of this runs.
const BOOT_KEY = 'arena-boot-intent';
const RIG_KEY = 'arena-active-rigplan';

const isSphere = (cfg) => cfg.position === 'middle' && cfg.middleShape === 'sphere';

export function initBuilder(api) {
  const st = {
    mode: 'creative',            // every building opens empty
    curtains: 'full',
    cfg: {
      curtains: 'full', position: 'far', farSize: 'default',
      middleShape: 'circle', catwalk: 'standard', bstage: 'circle',
      cstage: false, floor: 'seat', screen: 'wall',
    },
    // a far stage tarps the seats behind it the way a real show does
    covers: { behind: SPEC.bowl.defaultBehind || 'none', rings: [] },
    bfloor: 'seat',
  };
  let enabled = false;
  let open = false;
  let leaving = false;           // a reload is under way: ignore further clicks

  // --- the physical rules the room enforces -----------------------------------
  function gate() {
    if (!HOSTS[VENUE].includes(st.mode)) st.mode = HOSTS[VENUE][0];
    if (IS_FESTIVAL) {
      // the crowd stands on the grass in front of one big end stage
      Object.assign(st.cfg, { position: 'far', floor: 'ga', cstage: false });
      if (st.cfg.middleShape === 'sphere') st.cfg.middleShape = 'circle';
    }
    if (STADIUM) {
      // an open bowl has no curtains to draw, no seat tarps and no C-stage riser
      st.curtains = 'full';
      st.cfg.cstage = false;
      if (st.cfg.floor === 'none') st.cfg.floor = 'seat';
    } else if (st.cfg.middleShape === 'sphere') {
      st.cfg.middleShape = 'circle';   // the globe is a stadium stage
    }
    const c = st.curtains;
    st.cfg.curtains = c;
    if (c === 'hemicycle') {
      Object.assign(st.cfg, {
        position: 'far', farSize: 'huge', catwalk: 'none',
        bstage: 'none', cstage: false, floor: 'none',
      });
    } else {
      if (st.cfg.farSize === 'huge') st.cfg.farSize = 'default';
      if (st.cfg.floor === 'none') st.cfg.floor = 'seat';
      if (['medium', 'small', 'theatre'].includes(c)) {
        Object.assign(st.cfg, { position: 'far', catwalk: 'none', bstage: 'none', cstage: false });
        if (c !== 'medium') st.cfg.farSize = 'default';
      }
    }
    if (st.cfg.position === 'middle') {
      Object.assign(st.cfg, { catwalk: 'none', bstage: 'none', cstage: false });
    }
    if (c !== 'full') st.covers.behind = 'none';
  }

  // push the whole state into the running scene
  function apply() {
    gate();
    const concert = st.mode === 'concert';
    if (concert) api.setStageConfig({ ...st.cfg });
    api.applyCurtain(concert ? (CURTAIN_CUT[st.curtains] ?? null) : null);
    // behind-stage tarps only mean something while a far stage is standing,
    // and only where the stands take a tarp (TARPS)
    const behindOn = TARPS && concert && st.cfg.position === 'far' && st.curtains === 'full';
    api.applyCovers({
      behind: behindOn ? st.covers.behind : 'none',
      rings: TARPS ? [...st.covers.rings] : [],
    });
    api.setBasketballFloor(st.bfloor === 'seat');
    api.setMode(st.mode);
    api.settle?.();
    render();
    // gold handshake: the border flashes as the room morphs behind the panel
    root.classList.add('applied');
    clearTimeout(apply._t);
    apply._t = setTimeout(() => root.classList.remove('applied'), 320);
  }

  // --- reloads: the other building, or the sphere's own rig -------------------
  // the rig a building needs for the current stage: the sphere brings its ring
  // rig, everything else flies the house rig (no plan)
  function wantRig(venue) {
    if (venue !== 'stadium' || !SPEC.sphere || !isSphere(st.cfg)) return null;
    return makeRingRigPlan(SPEC.sphere, CAT_H);
  }
  const sameRig = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  function needsReboot(venue = VENUE) {
    gate();
    return venue !== VENUE || !sameRig(api.currentRig?.(), wantRig(venue));
  }
  const snapshot = () => JSON.parse(JSON.stringify({
    venue: VENUE, mode: st.mode, curtains: st.curtains, cfg: st.cfg, covers: st.covers, bfloor: st.bfloor,
  }));
  function reboot({ venue = VENUE, open: keepOpen = open } = {}) {
    if (leaving) return;
    leaving = true;
    const plan = wantRig(venue);
    try {
      if (plan) localStorage.setItem(RIG_KEY, JSON.stringify(plan));
      else localStorage.removeItem(RIG_KEY);
      localStorage.setItem(BOOT_KEY, JSON.stringify({ creative: snapshot(), open: !!keepOpen }));
    } catch (_) { /* storage blocked: the reload lands on the menu instead */ }
    const where = venue !== VENUE ? `Opening the ${venue}` : 'Hanging the rig';
    root.classList.add('leaving');
    fab.classList.add('leaving');
    const hint = root.querySelector('.bHint');
    if (hint) hint.textContent = `${where}…`;
    // anything that should survive the reload (a running camera) says so now
    document.dispatchEvent(new CustomEvent('venuereboot', { detail: { venue } }));
    if (venue !== VENUE) reloadIntoVenue(venue);
    else location.reload();
  }
  // read (and clear) what the last page left for us; restores the state
  function takeBootIntent() {
    let intent = null;
    try { intent = JSON.parse(localStorage.getItem(BOOT_KEY) || 'null'); } catch (_) { /* corrupt */ }
    try { localStorage.removeItem(BOOT_KEY); } catch (_) { /* private mode */ }
    if (!intent || typeof intent.creative !== 'object' || !intent.creative) return null;
    const c = intent.creative;
    if (MODES.includes(c.mode)) st.mode = c.mode;
    if (ROOMS.some(([k]) => k === c.curtains)) st.curtains = c.curtains;
    if (c.cfg && typeof c.cfg === 'object') Object.assign(st.cfg, c.cfg);
    // the tarps belong to the building: another one starts with its own
    if (c.covers && (!c.venue || c.venue === VENUE)) {
      st.covers = {
        behind: c.covers.behind || 'none',
        rings: Array.isArray(c.covers.rings) ? [...c.covers.rings] : [],
      };
    }
    if (c.bfloor === 'seat' || c.bfloor === 'none') st.bfloor = c.bfloor;
    return intent;
  }

  // --- DOM -------------------------------------------------------------------
  const root = document.createElement('div');
  root.id = 'buildPanel';
  root.className = 'dockPanel';
  document.body.appendChild(root);
  const fab = document.createElement('button');
  fab.id = 'buildFab';
  fab.title = 'Creative mode: change what is on the floor (B)';
  fab.innerHTML = '<span class="bfLabel">BUILD</span>'
    + '<span class="bfMode"></span><kbd>B</kbd>';
  // the last of the bottom pills: Show, Video, Build (the top right is the camera's)
  (document.getElementById('fabDock') || document.body).appendChild(fab);
  // drag it out by its title bar to keep it open alongside the other windows
  const win = makeMovable(root, { handle: '.bHead', key: 'build' });

  // one row of segmented options. `f` names the field the row edits; each
  // option is [value, label, { title, tag }]
  // a row this room can't change right now isn't shown at all: the builder
  // only offers what can be edited here
  const row = (f, label, opts, value, { multi = false, on = () => true } = {}) => {
    const dis = !on();
    if (dis) return '';
    const just = st._just === f;
    return `
      <div class="bRow${dis ? ' off' : ''}" data-f="${f}"${dis ? ' title="Locked by room size or mode"' : ''}>
        <span class="bLabel">${label}${dis ? ' <span class="bAuto">AUTO</span>' : ''}</span>
        <div class="bSeg">${opts.map(([k, name, x = {}]) => {
          const sel = multi ? value.includes(k) : value === k;
          return `
          <button class="bOpt${sel ? ' sel' : ''}${sel && just ? ' just' : ''}" data-k="${k}"${x.title ? ` title="${x.title}"` : ''}>${name}${x.tag ? ` <span class="bTag">${x.tag}</span>` : ''}</button>`;
        }).join('')}
        </div>
      </div>`;
  };

  // The builder in pages, one thing each, with the tabs along the top. A page
  // only appears when there is something on it to change here.
  let page = null;
  try { page = localStorage.getItem('ht-build-page'); } catch (_) { /* private mode */ }
  const PAGES = [
    ['setup', 'Setup', 'What the venue is set up for.'],
    ['stage', 'Stage', 'The main stage: the room around it, where it stands, its size.'],
    ['runway', 'Runway', 'The catwalk out into the crowd, and the stages on it.'],
    ['screens', 'Screens', 'The big screen behind the stage.'],
    ['floor', 'Floor', 'How the crowd on the floor stands or sits.'],
    ['seats', 'Seats', 'Cover parts of the seating with tarps.'],
  ];
  function render() {
    const concert = st.mode === 'concert';
    const far = st.cfg.position === 'far';
    const c = st.curtains;
    const openRoom = !['medium', 'small', 'theatre', 'hemicycle'].includes(c);
    const pages = {};
    const put = (p, html) => { if (html) (pages[p] = pages[p] || []).push(html); };

    // the phone showcase has no main menu: the venue is picked here (the arena or the stadium)
    if (window.PIXMOB_MOBILE) put('setup', row('venue', 'Venue', [['arena', 'Arena'], ['stadium', 'Stadium']], VENUE === 'arena' ? 'arena' : 'stadium'));
    // only what this building hosts: the venue itself is picked in the main menu
    const modeOpts = MODES.filter((k) => HOSTS[VENUE].includes(k)).map((k) => [k, MODE_NAMES[k]]);
    if (modeOpts.length > 1) put('setup', row('mode', 'Set up for', modeOpts, st.mode));

    if (concert) {
      if (!STADIUM) put('stage', row('curtains', 'Room size', ROOMS, c));
      if (!IS_FESTIVAL) put('stage', row('position', 'Where the stage stands', [['far', 'At one end'], ['middle', 'In the middle']], st.cfg.position, { on: () => openRoom }));
      if (!far && openRoom) {
        const shapes = [['circle', 'Circle'], ['square', 'Square']];
        if (SPEC.sphere) {
          shapes.push(['sphere', 'Sphere', { title: 'A 47 m video globe with its own 360° ring rig. The page reloads to hang it.', tag: '↻' }]);
        }
        put('stage', row('middleShape', 'Shape', shapes, st.cfg.middleShape));
      } else {
        put('stage', row('farSize', 'Stage size', [['default', 'Standard'], ['large', 'Large']], st.cfg.farSize,
          { on: () => far && ['full', 'large', 'medium'].includes(c) }));
      }
      put('runway', row('catwalk', 'Catwalk',
        [['none', 'None'], ['standard', `${SPEC.catStd} m`], ['long', `${SPEC.catLong} m`]],
        st.cfg.catwalk, { on: () => far && openRoom }));
      put('runway', row('bstage', st.cfg.catwalk === 'none' ? 'Satellite stage' : 'B-stage (at the end of the catwalk)',
        [['none', 'None'], ['circle', 'Circle'], ['square', 'Square'], ['x', 'X'], ['heart', 'Heart']],
        st.cfg.bstage, { on: () => far && openRoom }));
      if (!STADIUM) {
        put('runway', row('cstage', 'C-stage (at the back of the floor)', [['off', 'Off'], ['on', 'On']], st.cfg.cstage ? 'on' : 'off',
          { on: () => far && openRoom }));
      }
      put('screens', row('screen', 'Screen shape', far
        ? [['wall', 'Wall'], ['circle', 'Circle'], ['heart', 'Heart']]
        : [['cyl', 'Cylinder'], ['circle', 'Circle'], ['heart', 'Heart']],
        far ? (st.cfg.screen === 'cyl' ? 'wall' : st.cfg.screen) : (st.cfg.screen === 'wall' ? 'cyl' : st.cfg.screen),
        { on: () => !isSphere(st.cfg) }));   // the globe brings its own screens
      if (!IS_FESTIVAL) put('floor', row('floor', 'Floor crowd', [['seat', 'Seated'], ['ga', 'Standing'], ['hybrid', 'Both']], st.cfg.floor,
        { on: () => c !== 'hemicycle' }));
    }
    if (st.mode === 'basketball') put('floor', row('bfloor', 'Courtside seats', [['seat', 'Full'], ['none', 'None']], st.bfloor));
    if (TARPS) {
      // seat tarps: wherever there are stands (see TARPS)
      if (concert && far && c === 'full') {
        put('seats', row('behind', 'Behind the stage', [['none', 'None'], ['small', 'Small'], ['medium', 'Medium'], ['full', 'Full']], st.covers.behind));
      }
      put('seats', row('rings', 'Cover a tier', (SPEC.bowl.tiers || []).map((t) => [t.name, `${t.name}s`]), st.covers.rings, { multi: true }));
    }
    const have = PAGES.filter(([id]) => pages[id]?.length);
    if (!have.some(([id]) => id === page)) page = have[0]?.[0] || null;
    const P = PAGES.find(([id]) => id === page);
    root.innerHTML = `
      <div class="bHead"><button class="bClose" aria-label="Close">✕</button><span class="bTitle">Build</span><span class="bHint"></span></div>
      <div class="bTabs" role="tablist">${have.map(([id, name]) => `<button class="bTab${id === page ? ' sel' : ''}" data-page="${id}" role="tab">${name}</button>`).join('')}</div>
      <div class="bBody">${P ? `<p class="bAbout">${P[2]}</p><div class="bSection" data-s="${page}">${pages[page].join('')}</div>` : ''}</div>`;
    fab.querySelector('.bfMode').textContent = MODE_NAMES[st.mode] || '';
  }

  // one delegated handler: the row names the field, data-k carries the value
  root.addEventListener('click', (e) => {
    if (e.target.closest('.bClose')) { setOpen(false); return; }
    const tab = e.target.closest('[data-page]');
    if (tab) {
      page = tab.dataset.page;
      try { localStorage.setItem('ht-build-page', page); } catch (_) { /* private mode */ }
      render();
      return;
    }
    const btn = e.target.closest('.bOpt');
    if (!btn || leaving) return;
    const rowEl = btn.closest('.bRow');
    if (rowEl.classList.contains('off')) return;
    const f = rowEl.dataset.f, k = btn.dataset.k;
    st._just = f;
    if (f === 'venue') {
      if (k !== VENUE) reboot({ venue: k, open: true });
      return;
    }
    if (f === 'mode' && !HOSTS[VENUE].includes(k)) {
      // football from the arena: the pitch is in the other building
      st.mode = k;
      reboot({ venue: homeOf(k), open: true });
      return;
    }
    switch (f) {
      case 'mode': st.mode = k; break;
      case 'curtains': st.curtains = k; break;
      case 'bfloor': st.bfloor = k; break;
      case 'behind': st.covers.behind = k; break;
      case 'cstage': st.cfg.cstage = k === 'on'; break;
      case 'rings': {
        const set = new Set(st.covers.rings);
        set.has(k) ? set.delete(k) : set.add(k);
        st.covers.rings = [...set].sort();
        break;
      }
      default:
        if (f in st.cfg) st.cfg[f] = k;   // position, farSize, middleShape, catwalk, bstage, screen, floor
    }
    // hanging the sphere's ring rig (or taking it down again) needs a reload
    if (needsReboot(VENUE)) { reboot({ open: true }); return; }
    apply();
  });

  function setOpen(o) {
    if (open && !(o && enabled)) { page = null; render(); }   // closed: it opens on its first page (Setup) next time
    open = o && enabled;
    root.classList.toggle('open', open);
    fab.classList.toggle('active', open);
    // pointer lock owns the cursor in-sim: hand it back while the panel is up
    if (open) api.controls?.unlock?.();
    // one docked panel at a time in the corner; a floated window stays put
    if (open && !win.floating) document.dispatchEvent(new CustomEvent('dockpanel', { detail: 'build' }));
  }
  document.addEventListener('dockpanel', (e) => { if (e.detail !== 'build' && open && !win.floating) setOpen(false); });
  fab.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyB' || !enabled || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.body.classList.contains('menu')) return;   // the menu is up
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    setOpen(!open);
  });

  // The director deck spans the bottom of the screen; while it is open the
  // button and panel stand on top of it instead of covering its controls.
  const dirEl = document.getElementById('director');
  // Measured from the deck's TOP edge, not its height: the deck floats above
  // the bottom of the window, so a lift of its height left the buttons sitting
  // on its top rows. 18 px is the dock's own resting gap; 10 px clears the deck.
  const syncDock = () => {
    const up = dirEl && document.body.classList.contains('director');
    const top = up ? dirEl.getBoundingClientRect().top : innerHeight;
    const lift = up ? Math.max(0, Math.ceil(innerHeight - top) + 10 - 18) : 0;
    document.body.style.setProperty('--buildLift', `${lift}px`);
  };
  new MutationObserver(syncDock).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (dirEl && 'ResizeObserver' in window) new ResizeObserver(syncDock).observe(dirEl);
  window.addEventListener('resize', syncDock);

  function setEnabled(on) {
    enabled = on;
    document.body.classList.toggle('builderOn', on);
    if (!on) setOpen(false);
    render();
  }
  render();
  // a saved show's room: its mode, stage, curtains and tarps, applied as if
  // chosen here (a stage that needs another rig reloads into it)
  function setState(c) {
    if (!c || typeof c !== 'object') return;
    if (MODES.includes(c.mode)) st.mode = c.mode;
    if (ROOMS.some(([k]) => k === c.curtains)) st.curtains = c.curtains;
    if (c.cfg && typeof c.cfg === 'object') Object.assign(st.cfg, c.cfg);
    if (c.covers) st.covers = { behind: c.covers.behind || 'none', rings: Array.isArray(c.covers.rings) ? [...c.covers.rings] : [] };
    if (c.bfloor === 'seat' || c.bfloor === 'none') st.bfloor = c.bfloor;
    if (needsReboot()) reboot();
    else apply();
  }
  return {
    setEnabled, apply, needsReboot, reboot, takeBootIntent, setState,
    get enabled() { return enabled; }, get isOpen() { return open && !win.floating; },
    open: () => setOpen(true), close: () => setOpen(false),
    state: st,
  };
}
