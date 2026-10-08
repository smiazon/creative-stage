// FEEDS: every picture in the system, live. The wall shows them all at once;
// any tile pops out into its own window, as many as you like. Every window
// moves by its title bar and resizes from its corner.
//
// A feed is { id, name, source() } where source returns something drawable
// (a canvas or a playing video) or null when there is nothing to show, plus an
// optional `idle` line (or a function giving one) for that case. Optional too: stamp() changes whenever
// the picture does (a feed that has one is only repainted then), box() gives
// the output box to draw over it in green, and want() is called while the
// feed is on screen. The wristband map is drawn here, from the orbs' own
// colours.
import { makeMovable } from './windows.js';
import { drawOutputBox } from './camfx.js';

const FPS_CAP = 30;

export function initFeeds({ feeds, crowd }) {
  const byId = Object.fromEntries(feeds.map((f) => [f.id, f]));
  const views = new Set();   // every canvas on screen that shows a feed

  // --- the wristband map: each orb's colour at its place in the plan ------------
  const crowdCanvas = document.createElement('canvas');
  crowdCanvas.width = 320; crowdCanvas.height = 256;
  const cctx = crowdCanvas.getContext('2d');
  let crowdImg = null, crowdAt = 0, crowdCache = null, crowdStamp = 0;
  function drawCrowd() {
    const now = performance.now();
    if (now - crowdAt < 80) return crowdCanvas;   // 12 a second is plenty for a map
    crowdAt = now;
    crowdStamp++;
    const src = crowd();
    const w = crowdCanvas.width, h = Math.max(2, Math.round((w * src.hh) / src.hw));
    if (crowdCanvas.height !== h) { crowdCanvas.height = h; crowdImg = null; crowdCache = null; }
    if (!crowdImg) crowdImg = cctx.createImageData(w, h);
    const d = crowdImg.data;
    d.fill(0);
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
    // each orb's pixel is worked out once per block and reused
    if (!crowdCache || crowdCache.length !== src.groups.length || crowdCache.some((c, gi) => c.n !== src.groups[gi].n || c.pos !== src.groups[gi].pos)) {
      crowdCache = src.groups.map((g) => {
        const px = new Int32Array(g.n);
        for (let i = 0; i < g.n; i++) {
          const x = Math.floor(((g.pos[i * 3] + src.hw) / (2 * src.hw)) * w);
          const y = Math.floor(((g.pos[i * 3 + 2] + src.hh) / (2 * src.hh)) * h);   // north (-z) at the top, like the bird view
          px[i] = x >= 0 && x < w && y >= 0 && y < h ? (y * w + x) * 4 : -1;
        }
        return { n: g.n, pos: g.pos, px };
      });
    }
    const k = 255 / Math.max(1, src.level);
    src.groups.forEach((g, gi) => {
      if (!src.visible(g)) return;
      const col = g.mesh.instanceColor?.array;
      if (!col) return;
      const px = crowdCache[gi].px;
      for (let i = 0; i < g.n; i++) {
        const p = px[i];
        if (p < 0) continue;
        const r = col[i * 3] * k, gg = col[i * 3 + 1] * k, b = col[i * 3 + 2] * k;
        if (r + gg + b < 6) { if (d[p] < 22) { d[p] = 22; d[p + 1] = 22; d[p + 2] = 26; } continue; }   // unlit band: a faint dot
        d[p] = Math.min(255, r); d[p + 1] = Math.min(255, gg); d[p + 2] = Math.min(255, b);
      }
    });
    cctx.putImageData(crowdImg, 0, 0);
    return crowdCanvas;
  }
  const sourceOf = (f) => (f.id === 'crowd' ? drawCrowd() : f.source());

  // --- drawing ----------------------------------------------------------------------
  function paint(view) {
    const { canvas, ctx, feed } = view;
    const r = canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    feed.want?.();
    const src = sourceOf(feed);
    const box = feed.box?.() || 0;
    // nothing new since the last paint: leave it as it is
    const stamp = feed.id === 'crowd' ? crowdStamp : feed.stamp?.();
    const key = stamp === undefined ? '' : `${w}x${h}|${stamp}|${src ? 1 : 0}|${box}`;
    if (key && key === view.key) return;
    view.key = key;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, w, h);
    const sw = src && (src.videoWidth || src.width), sh = src && (src.videoHeight || src.height);
    view.idleEl.hidden = !!(sw && sh);
    if (!sw || !sh) {
      if (typeof feed.idle === 'function') view.idleEl.textContent = feed.idle();
      return;
    }
    const k = Math.min(w / sw, h / sh);
    const dw = sw * k, dh = sh * k, x = (w - dw) / 2, y = (h - dh) / 2;
    ctx.drawImage(src, x, y, dw, dh);
    if (box) drawOutputBox(ctx, x, y, dw, dh, box, dpr);
  }
  let last = 0, looping = false;
  function loop(t) {
    if (!views.size) { looping = false; return; }
    requestAnimationFrame(loop);
    if (t - last < 1000 / FPS_CAP - 2) return;
    last = t;
    for (const v of views) paint(v);
  }
  const kick = () => { if (!looping && views.size) { looping = true; requestAnimationFrame(loop); } };

  // one feed tile or window body: a canvas and the line shown when it is empty
  function viewFor(feed, host) {
    const canvas = document.createElement('canvas');
    canvas.className = 'fdCanvas';
    const idleEl = document.createElement('span');
    idleEl.className = 'fdIdle';
    idleEl.textContent = (typeof feed.idle === 'function' ? feed.idle() : feed.idle) || 'Nothing on this feed';
    host.append(canvas, idleEl);
    return { canvas, ctx: canvas.getContext('2d'), feed, idleEl };
  }

  // --- the wall ------------------------------------------------------------------------
  const wall = document.createElement('div');
  wall.id = 'feedWall';
  wall.className = 'feedWin';
  wall.innerHTML = `
    <div class="fdHead"><span class="fdTitle">▦ FEEDS</span><span class="fdHint">all at once · drag the corner to resize</span><button class="fdClose" aria-label="Close">✕</button></div>
    <div class="fdGrid"></div>`;
  document.body.appendChild(wall);
  const grid = wall.querySelector('.fdGrid');
  const wallViews = feeds.map((f) => {
    const tile = document.createElement('div');
    tile.className = 'fdTile';
    tile.innerHTML = `<div class="fdTileHead"><span>${f.name}</span><button class="fdPop" title="Open ${f.name} in its own window">↗</button></div><div class="fdBody"></div>`;
    grid.appendChild(tile);
    tile.querySelector('.fdPop').addEventListener('click', (e) => { e.stopPropagation(); popOut(f.id); });
    return viewFor(f, tile.querySelector('.fdBody'));
  });
  makeMovable(wall, { handle: '.fdHead', key: 'feedwall', resizable: true });
  let wallOpen = false;
  function setWall(o) {
    wallOpen = !!o;
    wall.classList.toggle('open', wallOpen);
    fab.classList.toggle('active', wallOpen);
    for (const v of wallViews) (wallOpen ? views.add(v) : views.delete(v));
    kick();
  }
  wall.querySelector('.fdClose').addEventListener('click', (e) => { e.stopPropagation(); setWall(false); });

  // --- single-feed windows ------------------------------------------------------------
  const popped = new Map();   // feed id -> window element
  let cascade = 0;
  function popOut(id) {
    const f = byId[id];
    if (!f) return;
    if (popped.has(id)) { popped.get(id).style.zIndex = String(900 + cascade++); return; }
    const el = document.createElement('div');
    el.className = 'feedWin feedPop open';
    el.dataset.feed = id;
    el.innerHTML = `<div class="fdHead"><span class="fdTitle">${f.name}</span><button class="fdClose" aria-label="Close">✕</button></div><div class="fdBody"></div>`;
    // first time: step each new window down and in from the last
    const n = popped.size;
    el.style.left = `${Math.max(12, innerWidth - 420 - n * 28)}px`;
    el.style.top = `${90 + n * 28}px`;
    document.body.appendChild(el);
    const v = viewFor(f, el.querySelector('.fdBody'));
    views.add(v);
    makeMovable(el, { handle: '.fdHead', key: `feed-${id}`, resizable: true });
    el.querySelector('.fdClose').addEventListener('click', (e) => {
      e.stopPropagation();
      views.delete(v);
      popped.delete(id);
      el.remove();
      savePopped();
    });
    popped.set(id, el);
    savePopped();
    kick();
  }
  // the windows you had open come back with you
  const savePopped = () => { try { localStorage.setItem('ht-feeds-open', JSON.stringify([...popped.keys()])); } catch (_) { /* private mode */ } };

  // --- dock button ------------------------------------------------------------------------
  const fab = document.createElement('button');
  fab.id = 'feedsFab';
  fab.title = 'All the video feeds at once (M)';
  fab.innerHTML = '<span class="cfIcon">▦</span><span class="cfLabel">FEEDS</span><kbd>M</kbd>';
  (document.getElementById('fabDock') || document.body).appendChild(fab);
  fab.addEventListener('click', (e) => { e.stopPropagation(); setWall(!wallOpen); });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.body.classList.contains('menu') || !document.body.classList.contains('builderOn')) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    setWall(!wallOpen);
  });

  // reopen last visit's feed windows once the sim is up
  let restored = false;
  function restore() {
    if (restored) return;
    restored = true;
    try { for (const id of JSON.parse(localStorage.getItem('ht-feeds-open') || '[]')) popOut(id); } catch (_) { /* none */ }
  }
  return {
    open: () => setWall(true), close: () => setWall(false), popOut, restore,
    get isOpen() { return wallOpen; },
  };
}
