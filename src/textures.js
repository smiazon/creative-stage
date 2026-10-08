// Procedural texture generation — everything is drawn at load time on canvases
// so the app needs zero external assets.
import * as THREE from 'three';

// Deterministic PRNG so the floor looks identical every visit.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// ---------------------------------------------------------------------------
// Court floor — color map, roughness map and bump map.
// World size covered by the texture: 36m (x) by 22m (z), court centered.
// ---------------------------------------------------------------------------
// Both surfaces are now true regulation. COURT_SCALE stays as the single knob
// if the court ever needs nudging again, but it sits at 1.0 — an NBA court is
// 94 x 50 ft and should measure it. FLOOR_* is the portable deck the court is
// painted on: a real one runs ~125 x 72 ft, leaving an apron for benches,
// scorer's table and camera positions.
export const COURT_SCALE = 1.0;
export const FLOOR_W = 38, FLOOR_H = 22;
const CW = 28.65, CH = 15.24;                  // NBA regulation, pre-scale
export const COURT_W = CW * COURT_SCALE, COURT_H = CH * COURT_SCALE;
const LINE = 0.05;

export function makeCourtTextures(anisotropy) {
  const W = 4096, H = Math.round(4096 * FLOOR_H / FLOOR_W); // 2503
  const ppm = W / FLOOR_W;
  const rand = mulberry32(1337);

  const [canvas, ctx] = makeCanvas(W, H);
  const [rCanvas, rctx] = makeCanvas(W / 2, H / 2);
  const [bCanvas, bctx] = makeCanvas(W / 2, H / 2);

  // --- base maple planks -------------------------------------------------
  ctx.fillStyle = '#c9a468';
  ctx.fillRect(0, 0, W, H);
  rctx.fillStyle = '#565656'; // mid roughness base (0.34)
  rctx.fillRect(0, 0, rCanvas.width, rCanvas.height);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, bCanvas.width, bCanvas.height);

  const plankH = 0.105 * ppm; // ~10.5 cm boards
  const rows = Math.ceil(H / plankH);
  for (let r = 0; r < rows; r++) {
    const y0 = r * plankH;
    let x = -rand() * 1.4 * ppm;
    while (x < W) {
      const len = (0.7 + rand() * 1.1) * ppm;
      // per-plank tone: maple with subtle hue/lightness jitter
      const hue = 32 + (rand() - 0.5) * 7;
      const sat = 42 + (rand() - 0.5) * 10;
      const lig = 65 + (rand() - 0.5) * 9 - (rand() < 0.06 ? 7 : 0);
      ctx.fillStyle = `hsl(${hue},${sat}%,${lig}%)`;
      ctx.fillRect(x, y0, len + 1, plankH + 1);

      // grain: faint wavy streaks along the plank
      const grains = 4 + (rand() * 4) | 0;
      for (let g = 0; g < grains; g++) {
        const gy = y0 + rand() * plankH;
        ctx.strokeStyle = `hsla(${hue - 6},48%,${lig - 14}%,${0.05 + rand() * 0.08})`;
        ctx.lineWidth = 0.6 + rand() * 1.1;
        ctx.beginPath();
        ctx.moveTo(x, gy);
        const segs = 4;
        for (let s = 1; s <= segs; s++) {
          ctx.quadraticCurveTo(
            x + (len * (s - 0.5)) / segs, gy + (rand() - 0.5) * 4,
            x + (len * s) / segs, gy + (rand() - 0.5) * 2.5
          );
        }
        ctx.stroke();
      }
      // rare knot
      if (rand() < 0.02) {
        const kx = x + len * (0.2 + rand() * 0.6), ky = y0 + plankH * (0.3 + rand() * 0.4);
        const kr = 2 + rand() * 4;
        const grad = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
        grad.addColorStop(0, 'rgba(70,45,20,0.55)');
        grad.addColorStop(1, 'rgba(70,45,20,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(kx - kr, ky - kr, kr * 2, kr * 2);
      }
      // butt-joint seam
      ctx.fillStyle = 'rgba(60,38,18,0.35)';
      ctx.fillRect(x + len, y0, 1.2, plankH);
      bctx.fillStyle = 'rgba(0,0,0,0.5)';
      bctx.fillRect((x + len) / 2, y0 / 2, 1, plankH / 2);
      x += len;
    }
    // row seam
    ctx.fillStyle = 'rgba(60,38,18,0.30)';
    ctx.fillRect(0, y0 + plankH - 0.6, W, 1.2);
    bctx.fillStyle = 'rgba(0,0,0,0.55)';
    bctx.fillRect(0, (y0 + plankH) / 2 - 0.5, bCanvas.width, 1);
  }

  // --- helpers in court coordinates (meters, origin at center) -----------
  const SC = COURT_SCALE;
  const X = (x) => W / 2 + x * ppm * SC;
  const Y = (z) => H / 2 + z * ppm * SC;
  const M = (m) => m * ppm * SC;

  const cream = '#f2eee2';
  const navy = 'rgba(15,30,72,0.90)';
  const gold = 'rgba(196,150,60,0.92)';

  // --- painted apron (outside the playing rectangle) ----------------------
  ctx.fillStyle = navy;
  const cw2 = CW / 2, ch2 = CH / 2;   // regulation; X/Y/M scale them
  ctx.fillRect(0, 0, W, Y(-ch2));
  ctx.fillRect(0, Y(ch2), W, H - Y(ch2));
  ctx.fillRect(0, Y(-ch2), X(-cw2), Y(ch2) - Y(-ch2));
  ctx.fillRect(X(cw2), Y(-ch2), W - X(cw2), Y(ch2) - Y(-ch2));
  // gold pinstripe just outside the boundary
  ctx.strokeStyle = gold;
  ctx.lineWidth = M(0.04);
  ctx.strokeRect(X(-cw2 - 0.35), Y(-ch2 - 0.35), M(CW + 0.7), M(CH + 0.7));

  // apron wordmarks
  ctx.save();
  ctx.fillStyle = 'rgba(240,235,220,0.85)';
  ctx.font = `900 ${M(1.15)}px Arial Black, Arial`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('M E R I D I A N   A R E N A', X(0), Y(ch2 + 1.75));
  ctx.fillText('M E R I D I A N   A R E N A', X(0), Y(-ch2 - 1.75));
  ctx.restore();
  // baseline wordmarks (rotated)
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(X(side * (cw2 + 1.9)), Y(0));
    ctx.rotate(side * Math.PI / 2);
    ctx.fillStyle = 'rgba(196,150,60,0.9)';
    ctx.font = `900 ${M(1.0)}px Arial Black, Arial`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('V O L T S', 0, 0);
    ctx.restore();
  }

  // --- markings ------------------------------------------------------------
  ctx.strokeStyle = cream;
  ctx.lineWidth = M(LINE);

  // boundary + halfcourt
  ctx.strokeRect(X(-cw2), Y(-ch2), M(CW), M(CH));
  ctx.beginPath(); ctx.moveTo(X(0), Y(-ch2)); ctx.lineTo(X(0), Y(ch2)); ctx.stroke();

  // center circle: navy fill, gold ring, white ring
  ctx.fillStyle = navy;
  ctx.beginPath(); ctx.arc(X(0), Y(0), M(1.8), 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = gold; ctx.lineWidth = M(0.09);
  ctx.beginPath(); ctx.arc(X(0), Y(0), M(1.55), 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = cream; ctx.lineWidth = M(LINE);
  ctx.beginPath(); ctx.arc(X(0), Y(0), M(1.8), 0, Math.PI * 2); ctx.stroke();

  // center logo — lightning bolt "V"
  ctx.save();
  ctx.translate(X(0), Y(0));
  ctx.fillStyle = 'rgba(238,232,215,0.95)';
  ctx.font = `900 ${M(1.7)}px Arial Black, Arial`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('V', 0, M(0.06));
  ctx.fillStyle = gold;
  ctx.font = `700 ${M(0.34)}px Arial`;
  ctx.fillText('M E R I D I A N', 0, M(-1.02));
  ctx.fillText('V O L T S', 0, M(1.05));
  ctx.restore();

  // keys, free-throw circles, 3pt lines — one per half
  const hoopX = cw2 - 1.575;
  for (const s of [-1, 1]) {
    const bx = s * cw2;               // baseline x
    const kx0 = s * (cw2 - 5.79);     // free-throw line x
    // painted key
    ctx.fillStyle = navy;
    ctx.fillRect(Math.min(X(bx), X(kx0)), Y(-2.44), Math.abs(X(bx) - X(kx0)), M(4.88));
    ctx.strokeStyle = cream; ctx.lineWidth = M(LINE);
    ctx.strokeRect(Math.min(X(bx), X(kx0)), Y(-2.44), Math.abs(X(bx) - X(kx0)), M(4.88));
    // free-throw circle
    ctx.beginPath(); ctx.arc(X(kx0), Y(0), M(1.8), 0, Math.PI * 2); ctx.stroke();
    // restricted-area arc
    ctx.beginPath();
    ctx.arc(X(s * hoopX), Y(0), M(1.22), s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? Math.PI * 1.5 : Math.PI / 2, s > 0);
    ctx.stroke();
    // 3-point line
    const r3 = 7.24, zc = 6.71;
    const dx = Math.sqrt(r3 * r3 - zc * zc);
    ctx.beginPath();
    ctx.moveTo(X(bx), Y(-zc));
    ctx.lineTo(X(s * hoopX - s * dx), Y(-zc));
    ctx.stroke();
    ctx.beginPath();
    const start = Math.atan2(-zc, -s * dx);
    const end = Math.atan2(zc, -s * dx);
    ctx.arc(X(s * hoopX), Y(0), M(r3), start, end, s > 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(X(bx), Y(zc));
    ctx.lineTo(X(s * hoopX - s * dx), Y(zc));
    ctx.stroke();
  }

  // --- wear & tear ---------------------------------------------------------
  for (let i = 0; i < 240; i++) {
    const sx = X(-cw2) + rand() * M(CW), sy = Y(-ch2) + rand() * M(CH);
    ctx.strokeStyle = `rgba(${rand() < 0.5 ? '30,20,10' : '250,248,240'},${0.02 + rand() * 0.035})`;
    ctx.lineWidth = 0.8 + rand() * 1.6;
    ctx.beginPath();
    ctx.arc(sx, sy, 4 + rand() * 40, rand() * 6.3, rand() * 6.3);
    ctx.stroke();
  }
  // gentle vignette so the middle reads brighter under the rigs
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(8,6,12,0.16)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // --- roughness detail: painted areas slightly glossier, mottled scuffs ---
  rctx.save();
  rctx.scale(0.5, 0.5);
  rctx.fillStyle = 'rgba(70,70,70,0.9)'; // paint = a touch glossier
  rctx.fillRect(0, 0, W, Y(-ch2));
  rctx.fillRect(0, Y(ch2), W, H - Y(ch2));
  rctx.fillRect(0, Y(-ch2), X(-cw2), Y(ch2) - Y(-ch2));
  rctx.fillRect(X(cw2), Y(-ch2), W - X(cw2), Y(ch2) - Y(-ch2));
  rctx.restore();
  for (let i = 0; i < 900; i++) {
    const v = 60 + rand() * 60;
    rctx.fillStyle = `rgba(${v},${v},${v},${0.05 + rand() * 0.09})`;
    rctx.beginPath();
    rctx.arc(rand() * rCanvas.width, rand() * rCanvas.height, 3 + rand() * 26, 0, Math.PI * 2);
    rctx.fill();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  const bumpMap = new THREE.CanvasTexture(bCanvas);
  for (const t of [map, roughnessMap, bumpMap]) {
    t.anisotropy = anisotropy;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  }
  return { map, roughnessMap, bumpMap };
}

// ---------------------------------------------------------------------------
// Backboard decal (white frame + shooter's square) — transparent PNG-style.
// ---------------------------------------------------------------------------
export function makeBackboardDecal() {
  const [c, ctx] = makeCanvas(1024, 600); // board is 1.83 x 1.07
  ctx.clearRect(0, 0, 1024, 600);
  const px = 1024 / 1.83;
  ctx.strokeStyle = 'rgba(248,248,248,0.95)';
  ctx.lineWidth = 0.05 * px;
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, 1024 - ctx.lineWidth, 600 - ctx.lineWidth);
  // shooter square: 0.59 x 0.45, bottom edge 0.15 above board bottom
  const sw = 0.59 * px, sh = 0.45 * px;
  ctx.strokeRect((1024 - sw) / 2, 600 - 0.15 * px - sh, sw, sh);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Center-hung jumbotron — live scoreboard plus show modes (solid / logo /
// scrolling text / strobe). Returns texture + per-frame updater + setter.
// ---------------------------------------------------------------------------
export function makeScoreboard() {
  const W = 1024, H = 640;
  const [c, ctx] = makeCanvas(W, H);
  const state = {
    clock: 7 * 60 + 14, q: 3, home: 68, away: 64, acc: 0,
    mode: 'score', color: '#c49632', text: 'GO VOLTS!',
    t: 0, strobeOn: false, dirty: true,
  };

  function bezel() {
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 18;
    ctx.strokeRect(9, 9, W - 18, H - 18);
  }

  function drawScore() {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, W, H);
    bezel();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const m = Math.floor(state.clock / 60), s = Math.floor(state.clock % 60);
    ctx.shadowBlur = 42;
    ctx.shadowColor = '#ff2a1a';
    ctx.fillStyle = '#ff3b28';
    ctx.font = '700 190px "Courier New", monospace';
    ctx.fillText(`${m}:${String(s).padStart(2, '0')}`, 512, 180);
    ctx.shadowColor = '#ffb020';
    ctx.fillStyle = '#ffb020';
    ctx.font = '700 64px "Courier New", monospace';
    ctx.fillText(`Q${state.q}`, 512, 330);
    ctx.shadowColor = '#2fd06a';
    ctx.fillStyle = '#33e673';
    ctx.font = '700 150px "Courier New", monospace';
    ctx.fillText(String(state.home), 250, 470);
    ctx.fillText(String(state.away), 774, 470);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#cfd6e4';
    ctx.font = '700 46px Arial';
    ctx.fillText('VOLTS', 250, 580);
    ctx.fillText('COMETS', 774, 580);
    ctx.fillStyle = '#222';
    ctx.fillRect(504, 380, 16, 220);
  }

  function drawSolid(col = state.color) {
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, W, H);
    bezel();
  }

  function drawLogo() {
    ctx.fillStyle = '#060608';
    ctx.fillRect(0, 0, W, H);
    bezel();
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.strokeStyle = state.color;
    ctx.lineWidth = 20;
    ctx.beginPath(); ctx.arc(0, 0, 230, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#f2eee2';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = state.color; ctx.shadowBlur = 40;
    ctx.font = '900 300px Arial Black, Arial';
    ctx.fillText('V', 0, 10);
    ctx.shadowBlur = 0;
    ctx.fillStyle = state.color;
    ctx.font = '700 52px Arial';
    ctx.fillText('MERIDIAN VOLTS', 0, 250);
    ctx.restore();
  }

  function drawText() {
    ctx.fillStyle = '#050507';
    ctx.fillRect(0, 0, W, H);
    bezel();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '900 220px Arial Black, Arial';
    const tw = ctx.measureText(state.text).width;
    const x = W - ((state.t * 260) % (W + tw + 200));
    ctx.shadowColor = state.color; ctx.shadowBlur = 46;
    ctx.fillStyle = state.color;
    ctx.fillText(state.text, x, H / 2);
    ctx.shadowBlur = 0;
  }

  // LED physicality: a 4px pixel-pitch grid multiplied over every frame, plus
  // faint horizontal module seams every 64px — up close the face reads as a
  // wall of LED cabinets instead of a backlit poster.
  const ledPattern = (() => {
    const [pc, px] = makeCanvas(4, 4);
    px.fillStyle = 'rgba(255,255,255,1)';
    px.fillRect(0, 0, 4, 4);
    px.fillStyle = 'rgba(180,185,195,1)';
    px.fillRect(3, 0, 1, 4);
    px.fillRect(0, 3, 4, 1);
    return ctx.createPattern(pc, 'repeat');
  })();
  function ledOverlay() {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = ledPattern;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 64; y < H; y += 64) ctx.fillRect(0, y, W, 1);
    for (let x = 64; x < W; x += 64) ctx.fillRect(x, 0, 1, H);
  }

  function draw() {
    if (state.mode === 'score') drawScore();
    else if (state.mode === 'solid') drawSolid();
    else if (state.mode === 'logo') drawLogo();
    else if (state.mode === 'text') drawText();
    else if (state.mode === 'strobe') drawSolid(state.strobeOn ? state.color : '#030303');
    ledOverlay();
  }
  draw();

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;

  function update(dt, rand = Math.random) {
    state.t += dt;
    state.acc += dt;
    let redraw = state.dirty;
    state.dirty = false;
    if (state.acc >= 1) {
      state.acc = 0;
      state.clock -= 1;
      if (state.clock <= 0) { state.clock = 12 * 60; state.q = Math.min(4, state.q + 1); }
      if (rand() < 0.045) state.home += rand() < 0.7 ? 2 : 3;
      if (rand() < 0.045) state.away += rand() < 0.7 ? 2 : 3;
      if (state.mode === 'score') redraw = true;
    }
    if (state.mode === 'text') redraw = true;
    if (state.mode === 'strobe') {
      const on = Math.floor(state.t * 6) % 2 === 0;
      if (on !== state.strobeOn) { state.strobeOn = on; redraw = true; }
    }
    if (redraw) { draw(); texture.needsUpdate = true; }
  }

  function set(opts) { Object.assign(state, opts); state.dirty = true; }

  return { texture, update, set };
}

// ---------------------------------------------------------------------------
// LED ribbon (scorer's table / ad boards) — long strip that scrolls in x.
// ---------------------------------------------------------------------------
export function makeRibbon() {
  const [c, ctx] = makeCanvas(2048, 128);
  const ads = [
    ['MERIDIAN VOLTS', '#0f1e48', '#f2eee2'],
    ['FABLE  AIR', '#101010', '#5ec8ff'],
    ['MAPLE & CO.', '#20150a', '#ffb020'],
    ['VOLT ENERGY', '#081a10', '#33e673'],
  ];
  const w = 2048 / ads.length;
  ads.forEach(([text, bg, fg], i) => {
    ctx.fillStyle = bg;
    ctx.fillRect(i * w, 0, w, 128);
    ctx.fillStyle = fg;
    ctx.shadowColor = fg;
    ctx.shadowBlur = 22;
    ctx.font = '900 62px Arial Black, Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, i * w + w / 2, 68);
    ctx.shadowBlur = 0;
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Championship banner.
// ---------------------------------------------------------------------------
export function makeBanner(title, year, color = '#12204a') {
  const [c, ctx] = makeCanvas(512, 768);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 768);
  ctx.strokeStyle = '#c49632';
  ctx.lineWidth = 14;
  ctx.strokeRect(22, 22, 468, 724);
  ctx.fillStyle = '#f2eee2';
  ctx.textAlign = 'center';
  ctx.font = '900 118px Arial Black, Arial';
  ctx.fillText(year, 256, 300);
  ctx.font = '700 54px Arial';
  ctx.fillStyle = '#c49632';
  ctx.fillText(title, 256, 420);
  ctx.font = '700 40px Arial';
  ctx.fillStyle = '#f2eee2';
  ctx.fillText('CHAMPIONS', 256, 500);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Basketball — pebbled leather + seams (equirect mapping).
// ---------------------------------------------------------------------------
export function makeBallTextures() {
  const rand = mulberry32(99);
  const [c, ctx] = makeCanvas(1024, 512);
  const [b, bctx] = makeCanvas(1024, 512);
  ctx.fillStyle = '#b3521a';
  ctx.fillRect(0, 0, 1024, 512);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 26000; i++) {
    const x = rand() * 1024, y = rand() * 512, r = 0.6 + rand() * 1.1;
    const l = rand();
    ctx.fillStyle = l < 0.5 ? 'rgba(60,25,8,0.25)' : 'rgba(255,160,90,0.18)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
    bctx.fillStyle = l < 0.5 ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.3)';
    bctx.beginPath(); bctx.arc(x, y, r, 0, 6.3); bctx.fill();
  }
  // seams: equator + verticals
  ctx.strokeStyle = '#1a1210';
  bctx.strokeStyle = '#000';
  ctx.lineWidth = 6; bctx.lineWidth = 6;
  for (const g of [ctx, bctx]) {
    g.beginPath(); g.moveTo(0, 256); g.lineTo(1024, 256); g.stroke();
    for (const x of [0, 256, 512, 768, 1024]) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke();
    }
    // curved side seams
    for (const off of [128, 640]) {
      g.beginPath();
      for (let t = 0; t <= 64; t++) {
        const px = off + Math.sin((t / 64) * Math.PI * 2) * 110;
        const py = (t / 64) * 512;
        t === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.stroke();
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const bumpMap = new THREE.CanvasTexture(b);
  return { map, bumpMap };
}

// ---------------------------------------------------------------------------
// NHL ice sheet — white ice with regulation-ish markings, 61 x 26 m.
// ---------------------------------------------------------------------------
export const RINK_W = 60.96, RINK_H = 25.91, RINK_R = 8.53;

export function makeIceTexture(anisotropy, iceW = RINK_W, iceH = RINK_H) {
  const W = 4096, H = Math.round(4096 * iceH / iceW);
  const ppm = W / iceW;
  const rand = mulberry32(777);
  const [c, ctx] = makeCanvas(W, H);

  // ice base: bright but not blinding, slightly cold
  ctx.fillStyle = '#dce4ea';
  ctx.fillRect(0, 0, W, H);
  // subtle mottling + skate marks
  for (let i = 0; i < 1600; i++) {
    const v = 225 + rand() * 25;
    ctx.fillStyle = `rgba(${v - 8},${v},${v + 4},${0.05 + rand() * 0.06})`;
    ctx.beginPath();
    ctx.arc(rand() * W, rand() * H, 6 + rand() * 60, 0, 6.3);
    ctx.fill();
  }
  for (let i = 0; i < 700; i++) {
    ctx.strokeStyle = `rgba(160,175,190,${0.04 + rand() * 0.07})`;
    ctx.lineWidth = 0.6 + rand() * 1.2;
    ctx.beginPath();
    const sx = rand() * W, sy = rand() * H, a = rand() * 6.3, l = 30 + rand() * 200;
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx + Math.cos(a + 0.4) * l * 0.5, sy + Math.sin(a + 0.4) * l * 0.5, sx + Math.cos(a) * l, sy + Math.sin(a) * l);
    ctx.stroke();
  }

  const X = (x) => W / 2 + x * ppm;
  const Y = (z) => H / 2 + z * ppm;
  const M = (m) => m * ppm;
  const red = '#c8102e', blue = '#0033a0';

  // center red line (dashed look: solid + white ticks)
  ctx.fillStyle = red;
  ctx.fillRect(X(0) - M(0.15), 0, M(0.3), H);
  // blue lines
  for (const s of [-1, 1]) {
    ctx.fillStyle = blue;
    ctx.fillRect(X(s * 7.62) - M(0.15), 0, M(0.3), H);   // 25 ft from centre
  }
  // goal lines (thin red) — stop at rounded corners, close enough full-width
  for (const s of [-1, 1]) {
    ctx.fillStyle = red;
    ctx.fillRect(X(s * 27.13) - M(0.025), M(1.2), M(0.05), H - M(2.4));
  }

  const circle = (x, z, r, color, lw) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(X(x), Y(z), M(r), 0, Math.PI * 2);
    ctx.stroke();
  };
  const dot = (x, z, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(X(x), Y(z), M(r), 0, Math.PI * 2);
    ctx.fill();
  };

  // center circle + dot
  circle(0, 0, 4.57, blue, M(0.05));
  dot(0, 0, 0.15, blue);
  // zone + neutral faceoff spots/circles
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const fx = sx * 20.57, fz = sz * 7.01;
      circle(fx, fz, 4.57, red, M(0.05));
      dot(fx, fz, 0.3, red);
      // hash marks
      ctx.fillStyle = red;
      for (const hx of [-1, 1]) {
        for (const hz of [-1, 1]) {
          ctx.fillRect(X(fx + hx * 0.85) - M(0.025), Y(fz + hz * 4.57) - (hz > 0 ? 0 : M(0.6)), M(0.05), M(0.6));
        }
      }
      dot(sx * 6.1, sz * 7.01, 0.3, red); // neutral zone spots
    }
  }
  // goal creases
  for (const s of [-1, 1]) {
    const gx = s * 27.13;
    ctx.fillStyle = 'rgba(70,140,220,0.35)';
    ctx.strokeStyle = red;
    ctx.lineWidth = M(0.05);
    ctx.beginPath();
    ctx.arc(X(gx), Y(0), M(1.83), s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? Math.PI * 1.5 : Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // trapezoid
    ctx.strokeStyle = red;
    ctx.beginPath();
    ctx.moveTo(X(gx), Y(-3.35)); ctx.lineTo(X(s * 30.48), Y(-4.27));
    ctx.moveTo(X(gx), Y(3.35)); ctx.lineTo(X(s * 30.48), Y(4.27));
    ctx.stroke();
  }

  // center logo (fictional)
  ctx.save();
  ctx.translate(X(0), Y(0));
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = '#0f1e48';
  ctx.beginPath(); ctx.arc(0, 0, M(2.6), 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#c49632'; ctx.lineWidth = M(0.12);
  ctx.beginPath(); ctx.arc(0, 0, M(2.25), 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#f2eee2';
  ctx.font = `900 ${M(2.4)}px Arial Black, Arial`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('V', 0, M(0.1));
  ctx.restore();

  // sponsor marks near blue lines
  ctx.globalAlpha = 0.85;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [x, z, txt, col] of [[-5.5, -4.5, 'VOLT ENERGY', '#0f4a2a'], [5.5, 4.5, 'FABLE AIR', '#123a5c'], [-5.5, 4.5, 'MAPLE & CO.', '#5c3a10'], [5.5, -4.5, 'MERIDIAN', '#0f1e48']]) {
    ctx.save();
    ctx.translate(X(x), Y(z));
    ctx.fillStyle = col;
    ctx.font = `900 ${M(0.55)}px Arial Black, Arial`;
    ctx.fillText(txt, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  return map;
}

// ---------------------------------------------------------------------------
// Concert / changeover floor — dark gray protective decking over concrete.
// ---------------------------------------------------------------------------
// The arena's deck gray, matching the average panel tone painted by
// makeConcertFloor() below (base #2e2f33, panels rgb 46..59). Anything that
// should read as part of the arena structure uses this rather than near-black.
export const ARENA_GRAY = 0x343539;

export function makeConcertFloor(anisotropy) {
  const W = 2048, H = 1024;
  const rand = mulberry32(4242);
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#26272b';
  ctx.fillRect(0, 0, W, H);
  // deck panel grid (4x8 ft sheets)
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';   // softer seams
  ctx.lineWidth = 1.2;
  const px = W / 64, py = H / 32;
  for (let i = 0; i <= 64; i++) { ctx.beginPath(); ctx.moveTo(i * px, 0); ctx.lineTo(i * px, H); ctx.stroke(); }
  for (let j = 0; j <= 32; j++) { ctx.beginPath(); ctx.moveTo(0, j * py); ctx.lineTo(W, j * py); ctx.stroke(); }
  // per-panel tone variance + scuffs
  for (let i = 0; i < 64; i++) {
    for (let j = 0; j < 32; j++) {
      const v = 34 + rand() * 12;
      ctx.fillStyle = `rgba(${v},${v + 1},${v + 4},0.45)`;
      ctx.fillRect(i * px + 1, j * py + 1, px - 2, py - 2);
    }
  }
  for (let i = 0; i < 420; i++) {
    ctx.strokeStyle = `rgba(${rand() < 0.75 ? '14,15,18' : '62,64,70'},${0.04 + rand() * 0.07})`;
    ctx.lineWidth = 0.8 + rand() * 2.4;
    ctx.beginPath();
    const sx = rand() * W, sy = rand() * H;
    ctx.arc(sx, sy, 10 + rand() * 80, rand() * 6.3, rand() * 6.3);
    ctx.stroke();
  }
  // Subtle dark tape marks only. The previous near-white runs read as random
  // white lines streaking across the floor.
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = 'rgba(26,27,31,0.5)';
    ctx.fillRect(rand() * W * 0.5, rand() * H, W * (0.15 + rand() * 0.35), 2 + rand() * 2);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  return map;
}

// ---------------------------------------------------------------------------
// Rink board ads — long strip texture wrapped around the dasher boards.
// ---------------------------------------------------------------------------
export function makeBoardsTexture() {
  const [c, ctx] = makeCanvas(8192, 128);
  ctx.fillStyle = '#f4f4f2';
  ctx.fillRect(0, 0, 8192, 128);
  const ads = [
    ['VOLT ENERGY', '#0f4a2a', '#e9f6ee'], ['MERIDIAN VOLTS', '#0f1e48', '#f2eee2'],
    ['FABLE AIR', '#ffffff', '#123a5c'], ['MAPLE & CO.', '#f7efe2', '#5c3a10'],
    ['NORTHSIDE BANK', '#ffffff', '#7a1220'], ['COMET COLA', '#12060a', '#ff4b6e'],
    ['HARBOR TELECOM', '#eef4ff', '#0a4a8f'], ['GRANITE TOOLS', '#f2f2f2', '#333333'],
  ];
  const w = 8192 / 16;
  for (let i = 0; i < 16; i++) {
    const [text, bg, fg] = ads[i % ads.length];
    ctx.fillStyle = bg;
    ctx.fillRect(i * w + 2, 0, w - 4, 104);
    ctx.fillStyle = fg;
    ctx.font = '900 44px Arial Black, Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, i * w + w / 2, 52);
  }
  // yellow kickplate along the bottom
  ctx.fillStyle = '#e8c02a';
  ctx.fillRect(0, 104, 8192, 24);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// LED fascia ring content.
//
// The rings are 300-390 m long and 0.9 m tall — an aspect around 380:1, while
// an 8192x128 texture is 64:1. Mapping one texture around the whole ring
// therefore stretched every letter ~6x wide. Instead the texture is TILED, and
// the caller sets repeat.x = perimeter / (height * 64) so each tile lands at
// its natural aspect. Real fascia loops its ad reel around the bowl the same
// way. Section numbers were dropped from this texture: they cannot tile.
// ---------------------------------------------------------------------------
export const FASCIA_TILE_M = 57.6;   // metres covered by one 8192x128 tile

export function makeFasciaTexture(seed = 0) {
  const W = 8192, H = 128;
  const [c, ctx] = makeCanvas(W, H);
  const ads = [
    ['MERIDIAN VOLTS', '#0f1e48', '#f2eee2'],
    ['VOLT ENERGY', '#06140c', '#33e673'],
    ['FABLE AIR', '#08131f', '#5ec8ff'],
    ['MAPLE & CO.', '#1c1206', '#ffb020'],
    ['COMET COLA', '#160309', '#ff4b6e'],
    ['HARBOR TELECOM', '#04101f', '#4b9fff'],
  ];
  const PER_TILE = 3;                 // 3 ads per tile -> ~19 m each, readable
  const w = W / PER_TILE;
  for (let i = 0; i < PER_TILE; i++) {
    const [text, bg, fg] = ads[(i + seed) % ads.length];
    ctx.fillStyle = bg;
    ctx.fillRect(i * w, 0, w, H);
    // thin accent rule top and bottom, like a real ad plate
    ctx.fillStyle = fg;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(i * w + 24, 10, w - 48, 3);
    ctx.fillRect(i * w + 24, H - 13, w - 48, 3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = fg;
    ctx.shadowColor = fg;
    ctx.shadowBlur = 20;
    ctx.font = '900 74px Arial Black, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, i * w + w / 2, H / 2 + 2);
    ctx.shadowBlur = 0;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Section-number plaques, one atlas cell per section: white digits on a plate
// in the club colour, the way the reference building paints its tier fronts.
// An atlas rather than a long band texture because a band spanning a 400 m
// ring gives a number about 9 px of width to live in — unreadable. Each plaque
// is its own quad with its own cell, so the digits get real resolution.
export function makeSectionNumberAtlas(n, cols, rows, labelOf, plate = '#a8102a') {
  const CW = 256, CH = 96;
  const [c, ctx] = makeCanvas(cols * CW, rows * CH);
  ctx.fillStyle = plate;
  ctx.fillRect(0, 0, cols * CW, rows * CH);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let j = 0; j < n; j++) {
    const cx = (j % cols) * CW, cy = Math.floor(j / cols) * CH;
    // thin white rule top and bottom: a painted plate, not floating digits
    ctx.fillStyle = 'rgba(244,241,234,0.34)';
    ctx.fillRect(cx + 14, cy + 8, CW - 28, 2);
    ctx.fillRect(cx + 14, cy + CH - 10, CW - 28, 2);
    ctx.fillStyle = '#f4f1ea';
    ctx.font = '800 62px Arial Black, Arial';
    ctx.fillText(String(labelOf(j)), cx + CW / 2, cy + CH / 2 + 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Extra ring content: moving diagonal stripes and a twinkling cell pattern.
export function makeFasciaStripes() {
  const W = 1024, H = 128;
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, W, H);
  for (let i = -8; i < 24; i++) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64 + 46, 0);
    ctx.lineTo(i * 64 + 46 - 52, H); ctx.lineTo(i * 64 - 52, H);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? '#ffffff' : '#8fb4ff';
    ctx.globalAlpha = i % 3 === 0 ? 0.95 : 0.55;
    ctx.fill();
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function makeFasciaSparkle() {
  const rand = mulberry32(771);
  const W = 1024, H = 128;
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#04050a';
  ctx.fillRect(0, 0, W, H);
  const cells = 96;
  for (let i = 0; i < cells; i++) {
    for (let r = 0; r < 3; r++) {
      if (rand() < 0.45) continue;
      const g = ctx.createRadialGradient(
        (i + 0.5) * (W / cells), (r + 0.5) * (H / 3), 0,
        (i + 0.5) * (W / cells), (r + 0.5) * (H / 3), W / cells);
      const hue = (rand() * 360) | 0;
      g.addColorStop(0, `hsla(${hue},100%,70%,1)`);
      g.addColorStop(1, `hsla(${hue},100%,60%,0)`);
      ctx.fillStyle = g;
      ctx.fillRect(i * (W / cells) - 6, r * (H / 3), (W / cells) + 12, H / 3);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Suite band — dark wall with warm lit windows.
// ---------------------------------------------------------------------------
export function makeSuiteTexture() {
  const W = 4096, H = 256;
  const rand = mulberry32(88);
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, W, H);
  const n = 64;
  const w = W / n;
  for (let i = 0; i < n; i++) {
    const x = i * w;
    const lit = rand() < 0.74;
    // suite interior: warm ceiling-lit room with a back wall gradient
    if (lit) {
      const warm = 0.6 + rand() * 0.4;
      const g = ctx.createLinearGradient(0, 40, 0, 196);
      g.addColorStop(0, `rgba(${225 * warm | 0},${180 * warm | 0},${115 * warm | 0},0.95)`);
      g.addColorStop(0.55, `rgba(${170 * warm | 0},${125 * warm | 0},${78 * warm | 0},0.9)`);
      g.addColorStop(1, `rgba(${90 * warm | 0},${62 * warm | 0},${40 * warm | 0},0.9)`);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = '#111114';
    }
    ctx.fillRect(x + 8, 40, w - 16, 156);
    if (lit) {
      // downlights along the suite ceiling
      ctx.fillStyle = 'rgba(255,235,190,0.95)';
      for (let k = 0; k < 3; k++) ctx.fillRect(x + 14 + k * ((w - 30) / 2), 44, 7, 4);
      // bar counter + TV glow
      ctx.fillStyle = 'rgba(40,26,16,0.85)';
      ctx.fillRect(x + 10, 160, w - 20, 12);
      if (rand() < 0.6) {
        ctx.fillStyle = `rgba(${90 + rand() * 60 | 0},${140 + rand() * 60 | 0},${200 + rand() * 55 | 0},0.9)`;
        ctx.fillRect(x + 14 + rand() * (w - 60), 78, 26, 16);
      }
      // people silhouettes, varied heights/positions
      const ppl = 1 + (rand() * 3 | 0);
      for (let k = 0; k < ppl; k++) {
        const px = x + 14 + rand() * (w - 44);
        const ph = 46 + rand() * 18;
        ctx.fillStyle = 'rgba(18,12,9,0.8)';
        ctx.beginPath();
        ctx.arc(px + 7, 196 - ph, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(px, 196 - ph + 6, 15, ph - 6);
      }
    }
    // glass: mullion frame + a diagonal reflection streak
    ctx.strokeStyle = '#232329';
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 8, 40, w - 16, 156);
    ctx.strokeStyle = '#1a1a1f';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + w / 2, 40); ctx.lineTo(x + w / 2, 196); ctx.stroke();
    const rg = ctx.createLinearGradient(x, 40, x + w, 196);
    rg.addColorStop(0.32, 'rgba(180,200,235,0)');
    rg.addColorStop(0.45, 'rgba(180,200,235,0.13)');
    rg.addColorStop(0.5, 'rgba(180,200,235,0.05)');
    rg.addColorStop(0.62, 'rgba(180,200,235,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x + 8, 40, w - 16, 156);
    // concrete band above/below the glass line
    ctx.fillStyle = '#141419';
    ctx.fillRect(x, 0, w, 40);
    ctx.fillRect(x, 196, w, 60);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(x, 196, w, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Ceiling deck — dark corrugated steel roof decking, tiled.
// ---------------------------------------------------------------------------
export function makeCeilingDeck() {
  const rand = mulberry32(3131);
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#101114';
  ctx.fillRect(0, 0, 512, 512);
  // corrugation ribs
  for (let x = 0; x < 512; x += 16) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x, 0, 4, 512);
    ctx.fillStyle = 'rgba(90,95,105,0.22)';
    ctx.fillRect(x + 9, 0, 2, 512);
  }
  // panel seams
  for (let y = 0; y < 512; y += 128) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, y, 512, 2);
  }
  // grime patches
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(${rand() < 0.5 ? '5,5,7' : '45,48,55'},${0.05 + rand() * 0.1})`;
    ctx.beginPath();
    ctx.arc(rand() * 512, rand() * 512, 20 + rand() * 90, 0, 6.3);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 14);
  return t;
}

// ---------------------------------------------------------------------------
// Stage deck — matte black touring platform: 4x8ft panel seams, scuffs,
// gaffer-tape marks. Tiles in world meters (repeat set by the caller).
// ---------------------------------------------------------------------------
export function makeStageDeck() {
  const rand = mulberry32(5150);
  const [c, ctx] = makeCanvas(1024, 1024);
  // one tile = 2.44m x 2.44m (two 4ft-wide panels)
  ctx.fillStyle = '#2e2f33';
  ctx.fillRect(0, 0, 1024, 1024);

  // per-panel tone variance (4ft x 8ft decks laid in a running bond)
  const pw = 512, ph = 1024 / 4;
  for (let row = 0; row < 4; row++) {
    for (let col = -1; col < 3; col++) {
      const x = col * pw + (row % 2 ? pw / 2 : 0);
      const v = 46 + rand() * 13;
      ctx.fillStyle = `rgb(${v},${v},${v + 1})`;
      ctx.fillRect(x + 2, row * ph + 2, pw - 4, ph - 4);
      // seam shadow
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, row * ph, pw, ph);
    }
  }

  // scuffs and footfall wear
  for (let i = 0; i < 700; i++) {
    ctx.strokeStyle = `rgba(${120 + rand() * 90},${120 + rand() * 90},${125 + rand() * 90},${0.02 + rand() * 0.05})`;
    ctx.lineWidth = 0.7 + rand() * 2.2;
    ctx.beginPath();
    ctx.arc(rand() * 1024, rand() * 1024, 5 + rand() * 60, rand() * 6.3, rand() * 6.3);
    ctx.stroke();
  }
  // gaffer tape / spike marks
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = rand() < 0.55 ? 'rgba(220,220,215,0.5)' : 'rgba(230,190,40,0.42)';
    const x = rand() * 1024, y = rand() * 1024;
    if (rand() < 0.5) ctx.fillRect(x, y, 40 + rand() * 90, 5);
    else ctx.fillRect(x, y, 5, 40 + rand() * 90);
  }

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return map;
}

// ---------------------------------------------------------------------------
// Crowd-barrier infill — expanded-metal diamond mesh with transparent holes.
// Used with alphaTest so many panels sort correctly without blending.
// ---------------------------------------------------------------------------
export function makeBarrierMesh() {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = '#26282c';
  ctx.lineCap = 'square';
  ctx.lineWidth = 8;
  const step = 32;
  for (let i = -S; i < S * 2; i += step) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + S, S); ctx.stroke();       // +45°
    ctx.beginPath(); ctx.moveTo(i, S); ctx.lineTo(i + S, 0); ctx.stroke();       // -45°
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// LED video-wall panel structure — dark bezel seams + pixel grid, drawn as
// opaque lines over transparent gaps. Overlaid just in front of the video
// surface so the wall reads as tiled LED panels rather than a flat TV.
// cols/rows = panel count; pxPerPanel = LED pixels drawn per panel edge.
// ---------------------------------------------------------------------------
export function makeLedPanelGrid(cols, rows, pxPerPanel = 16) {
  const CELL = 64;                      // canvas px per panel
  const [c, ctx] = makeCanvas(CELL, CELL);
  ctx.clearRect(0, 0, CELL, CELL);
  // pixel grid: thin dark lattice between LEDs
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  const step = CELL / pxPerPanel;
  for (let i = 1; i < pxPerPanel; i++) {
    const p = Math.round(i * step) + 0.5;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, CELL); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(CELL, p); ctx.stroke();
  }
  // panel bezel: heavier seam around the tile edge
  ctx.strokeStyle = 'rgba(0,0,0,0.92)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, CELL - 3, CELL - 3);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(cols, rows);
  return t;
}

// ---------------------------------------------------------------------------
// Line-array speaker cabinet face — perforated grille cloth over drivers,
// with rigging hardware shading. One texture serves every box in a hang.
// ---------------------------------------------------------------------------
export function makeSpeakerGrille() {
  const rand = mulberry32(606);
  const W = 256, H = 128;
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#0b0b0d';
  ctx.fillRect(0, 0, W, H);
  // perforated grille: staggered dot lattice
  for (let y = 4; y < H - 3; y += 5) {
    for (let x = 4 + ((y / 5) % 2) * 2.5; x < W - 3; x += 5) {
      ctx.fillStyle = `rgba(${28 + rand() * 14},${28 + rand() * 14},${32 + rand() * 14},1)`;
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 6.3); ctx.fill();
    }
  }
  // driver shadows behind the grille: two mids and a horn slot
  const blob = (cx, cy, r) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  blob(58, 64, 42); blob(198, 64, 42);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(112, 44, 32, 40);
  // frame edge
  ctx.strokeStyle = '#1e2024';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// LED wall idle content — what the wall shows before any video is loaded.
// Deliberately dim and moody so the pre-show look reads correctly; the wall
// only becomes the brightest object in the room once real content plays.
// ---------------------------------------------------------------------------
export function makeWallIdle() {
  const rand = mulberry32(2049);
  const W = 1024, H = Math.round(1024 * 13 / 24); // matches the 24 x 13 m wall
  const [c, ctx] = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0a1130');
  g.addColorStop(0.55, '#141a3c');
  g.addColorStop(1, '#05060f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // soft pool of light behind the wordmark
  const glow = ctx.createRadialGradient(W / 2, H * 0.46, 0, W / 2, H * 0.46, W * 0.42);
  glow.addColorStop(0, 'rgba(80,110,220,0.30)');
  glow.addColorStop(1, 'rgba(80,110,220,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Band name in a rainbow sweep. The gradient spans the measured text width
  // so the hue ramp lands across the letters rather than the whole canvas.
  const titleSize = Math.round(H * 0.2);
  ctx.font = `900 ${titleSize}px Arial Black, Arial`;
  const title = 'COLDPLAY';
  const tw = ctx.measureText(title).width;
  const grad = ctx.createLinearGradient(W / 2 - tw / 2, 0, W / 2 + tw / 2, 0);
  const stops = ['#ff2f5e', '#ff8a1e', '#ffe12a', '#3ddc6b', '#2fb8ff', '#7a5cff', '#ff42c8'];
  stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c));
  ctx.shadowColor = 'rgba(255,255,255,0.5)';
  ctx.shadowBlur = Math.round(H * 0.05);
  ctx.fillStyle = grad;
  ctx.fillText(title, W / 2, H * 0.44);
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(226,232,255,0.72)';
  ctx.font = `700 ${Math.round(H * 0.055)}px Arial`;
  ctx.fillText('W O R L D   T O U R', W / 2, H * 0.62);

  // faint scanlines so it reads as a panel wall rather than flat paint
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  // a few dead/hot pixels, as every real wall has
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.55)' : 'rgba(180,200,255,0.35)';
    ctx.fillRect((rand() * W) | 0, (rand() * H) | 0, 2, 2);
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Fixture lamp faces. Flat-coloured quads read as solid squares; a real lamp
// is a hot core inside a dark housing with a soft halo, so every emissive
// fixture gets a proper face texture with alpha.
// ---------------------------------------------------------------------------

// Soft round glow with a hot core — lens flares and beam ground pools.
export function makeLampGlow(coreStop = 0.14) {
  const S = 128;
  const [c, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(coreStop, 'rgba(255,255,255,0.86)');
  g.addColorStop(0.38, 'rgba(255,255,255,0.28)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 4-cell molefay blinder: four hot PAR lamps in a dark box.
export function makeBlinderLamps() {
  const S = 128;
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  for (const [cx, cy] of [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]]) {
    const x = cx * S, y = cy * S, r = S * 0.235;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,242,214,0.82)');
    g.addColorStop(0.75, 'rgba(255,226,170,0.18)');
    g.addColorStop(1, 'rgba(255,220,160,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Strobe bar: a line of discrete LED cells, like a JDC1 tube.
export function makeStrobeBar(cells = 14) {
  const W = 512, H = 64;
  const [c, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const cw = W / cells;
  for (let i = 0; i < cells; i++) {
    const x = i * cw + cw / 2;
    const g = ctx.createRadialGradient(x, H / 2, 0, x, H / 2, cw * 0.58);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(240,248,255,0.7)');
    g.addColorStop(1, 'rgba(220,235,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - cw * 0.6, 0, cw * 1.2, H);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Crowd-orb disc. A sphere with enough segments to look round up close costs
// ~120 triangles; times 26,610 orbs that is the single largest geometry cost
// in the scene. A camera-facing disc is 2 triangles and is perfectly round at
// EVERY distance — better quality and ~60x cheaper.
// ---------------------------------------------------------------------------
export function makeOrbDiscTexture() {
  const S = 64;
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  // opaque core with a short ramp at the rim so alphaTest cuts a smooth circle
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.82, 'rgba(255,255,255,1)');
  g.addColorStop(0.95, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, 6.3); ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Shared animation uniforms for every orb mesh. The SAME uniform objects are
// handed to all four orb materials, so one write drives the whole crowd in sync.

// ONE arm model, compiled into both the crowd sprite and the wristband orb, on
// the crowd's clock. A person's pose, body hop, lean and how far the arm is
// raised (0 down .. 1 straight up) all come from here, so the band above a
// figure computes the SAME raise for the SAME seat at the SAME moment and sits
// in the hand instead of floating at a fixed height while the arms move.
export const CROWD_POSE_GLSL = `
  float cpHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void crowdPose(vec3 c, float ct, int cm, float waveMute, float handsT0,
                 out float frame, out float hop, out float rock, out float raise) {
    float ch1 = cpHash(c);
    float ch2 = cpHash(c + 5.31);
    float ch3 = cpHash(c + 11.7);
    if (cm == 5 && waveMute > 0.5) cm = 2;          // floor claps along, no wave
    if (cm == 6) {                                   // MIX: each person keeps one behaviour
      int sub = int(ch2 * 3.0);
      cm = sub == 0 ? 1 : (sub == 1 ? 2 : 4);
    }
    frame = 0.0; hop = 0.0; rock = 0.0; raise = 0.0;
    if (cm == 1) {                                   // IDLE — shift weight, clap now and then
      float s = sin(ct * (0.45 + ch1 * 0.5) + ch1 * 6.283);
      raise = clamp((s - 0.55) / 0.45, 0.0, 1.0) * 0.5;
      rock = sin(ct * (0.5 + ch1 * 0.35) + ch2 * 6.283) * 0.03;
    } else if (cm == 2) {                            // CHEER — clap / arms-up with a bounce
      float f = 1.15 + ch1 * 0.7;
      raise = 0.5 + 0.5 * (0.5 + 0.5 * sin(6.283 * (ct * f + ch2)));
      hop = abs(sin(ct * f * 3.14159 + ch2 * 6.283)) * 0.055;
      rock = sin(ct * (0.9 + ch1 * 0.5) + ch3 * 6.283) * 0.05;
    } else if (cm == 3) {
      // JUMP — people, not pistons. Each has their own tempo drift and a
      // quarter-beat of phase to themselves, roughly a fifth sit any given beat
      // out, the arc is a parabola, and nobody clears more than a real arena
      // hop. The old version put every figure 42 cm up on the same 1.85 Hz
      // clock within 5% of each other, and read as one machine.
      float per = 1.0 / (1.55 + (ch1 - 0.5) * 0.3);          // 1.4 .. 1.7 Hz
      float bt = ct / per - ch2 * 0.25;
      float beat = fract(bt);
      float on = step(0.2, cpHash(vec3(ch1, floor(bt) * 0.37, ch3)));
      float x = beat / 0.46;
      float air = beat < 0.46 ? 4.0 * x * (1.0 - x) : 0.0;
      hop = air * on * (0.14 + ch3 * 0.16);                  // 14 .. 30 cm
      raise = 0.3 + 0.5 * air * on;
      frame = (air > 0.05 && on > 0.5) ? 4.0 : (on > 0.5 ? 0.0 : 1.0);
      rock = sin(ct * (0.7 + ch1 * 0.4) + ch2 * 6.283) * 0.02;
      return;
    } else if (cm == 4) {                            // TOWEL — continuous whirl
      float k = fract(ct * (1.35 + ch1 * 0.6) + ch2);
      frame = k < 0.25 ? 5.0 : (k < 0.5 ? 6.0 : (k < 0.75 ? 7.0 : 6.0));
      rock = sin(k * 6.28318) * 0.18;
      hop = abs(sin(k * 6.28318)) * 0.07;
      raise = 0.85;
      return;
    } else if (cm == 7) {                            // HANDS UP — staggered raise, then hold
      raise = clamp((ct - handsT0) * 0.55 - ch1 * 1.0, 0.0, 1.0);
      hop = raise * 0.028 * (0.6 + ch2 * 0.8);
      rock = sin(ct * (0.45 + ch1 * 0.35) + ch3 * 6.283) * 0.055 * raise;
    } else if (cm == 5) {                            // MEXICAN WAVE — crest by bearing
      float ang = atan(c.z, c.x);
      float crest = sin(ct * 0.8 - ang * 2.0);
      raise = smoothstep(0.0, 0.85, crest);
      hop = smoothstep(0.1, 1.0, crest) * 0.2;
      rock = crest * 0.02;
    }
    // the sprite has three arm frames; the band moves continuously between them
    frame = raise > 0.72 ? 3.0 : (raise > 0.28 ? 2.0 : 0.0);
  }
`;

export const ORB_ANIM = {
  uOrbTime: { value: 0 },
  uOrbStrength: { value: 0 },
  uOrbMode: { value: 0 },
  // metres added to every orb's height: with the 2D crowd up this puts the band
  // in a RESTING hand (phone at the chest), and crowdPose's `raise` adds up to
  // uArmRise more when that person's arm goes up. It used to park every band at
  // raised-hand height permanently, arms up or not. 0 whenever the crowd is off.
  uOrbLift: { value: 0 },
  uArmRise: { value: 0 },
};

// Turn an instanced material into a view-aligned billboard, and displace it
// with the crowd-motion model. Both happen in the vertex shader: moving 29k
// orbs by rewriting instanceMatrix would cost ~1.9 MB of uploads per frame,
// whereas this costs nothing and needs no per-instance attributes — the
// per-orb randomness is hashed from the orb's own position.
// `follow` is per material, and live through material.userData.follow.value:
//   0  still: the band never moves, crowd or no crowd (with a crowd up it
//      rests at hand height, where the person holds it, and stays there)
//   1  in a hand when the crowd is up (and handheld when the orb mode says so)
//   2  always in a hand: the audience's own smaller bands, which sway, and
//      ride the arms when the crowd is up
export function billboardInstanced(material, { waveMute = 0, follow = 1 } = {}) {
  if (material.userData.follow) material.userData.follow.value = follow;
  else material.userData.follow = { value: follow };
  // REQUIRED alongside onBeforeCompile: three caches programs by material type
  // and defines, so without a distinct cache key these patched materials can be
  // handed a program compiled from an unpatched MeshBasicMaterial — the shader
  // edits then silently do nothing.
  material.customProgramCacheKey = () => 'orb-billboard-arms-v5-' + waveMute;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFollow = material.userData.follow;
    shader.uniforms.uOrbTime = ORB_ANIM.uOrbTime;
    shader.uniforms.uOrbStrength = ORB_ANIM.uOrbStrength;
    shader.uniforms.uOrbMode = ORB_ANIM.uOrbMode;
    shader.uniforms.uOrbLift = ORB_ANIM.uOrbLift;
    shader.uniforms.uArmRise = ORB_ANIM.uArmRise;
    // the crowd's uniforms by reference: the band reads the same clock, mode and
    // hands-up stamp the figure under it is posed from
    Object.assign(shader.uniforms, CROWD_ANIM);
    shader.uniforms.uWaveMute = { value: waveMute };
    shader.vertexShader = `
      uniform float uOrbTime;
      uniform float uOrbStrength;
      uniform float uOrbMode;
      uniform float uOrbLift;
      uniform float uArmRise;
      uniform float uCrowdTime;
      uniform float uCrowdMode;
      uniform float uHandsT0;
      uniform float uCrowdScale;
      uniform float uWaveMute;
      uniform float uFollow;
      float orbHash(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      }
      ${CROWD_POSE_GLSL}
      // HANDHELD: a slow wander plus a fine tremor, like a phone in a hand. The
      // only movement the band has of its own — everything larger (arms up,
      // the wave, a jump) is the person's, and comes from crowdPose below.
      vec3 handheld(vec3 p) {
        float t = uOrbTime;
        float h1 = orbHash(p), h2 = orbHash(p + 7.77), h3 = orbHash(p + 13.13);
        float f = 0.45 + h1 * 0.75;
        vec3 w = vec3(
          sin(t * f + h1 * 6.283) * 0.11,
          sin(t * f * 1.31 + h3 * 6.283) * 0.075,
          cos(t * f * 0.83 + h2 * 6.283) * 0.11);
        vec3 tremor = 0.016 * vec3(
          sin(t * 7.1 + h1 * 31.0), sin(t * 6.3 + h2 * 27.0), sin(t * 8.2 + h3 * 19.0));
        return (w + tremor) * uOrbStrength;
      }
      // Per-orb world offset. RULE: with a crowd up the band is always in a hand
      // (handheld), whatever the orb mode says — a still band over a moving arm
      // is the thing that looked wrong. With no crowd, Still means still.
      vec3 orbAnim(vec3 p, vec3 camRight) {
        if (uFollow < 0.5) return vec3(0.0);   // still: never moves, whatever the crowd does
        int cm = int(uCrowdMode + 0.5);
        bool crowdUp = cm > 0;
        bool held = crowdUp || uOrbMode > 0.5 || uFollow > 1.5;
        vec3 o = held && uOrbStrength > 0.001 ? handheld(p) : vec3(0.0);
        // an audience band with nobody drawn holding it: at chest height,
        // clear of the seat's own band
        if (!crowdUp && uFollow > 1.5) o.y += 0.55;
        if (crowdUp) {
          float frame, hop, rock, raise;
          crowdPose(p, uCrowdTime, cm, uWaveMute, uHandsT0, frame, hop, rock, raise);
          // the body lifts (hop), the arm goes up (raise), and the whole figure
          // leans about its feet (rock) — the hand at its height moves with all three
          float handH = uOrbLift + 0.82 + raise * uArmRise;
          o += vec3(0.0, hop + raise * uArmRise, 0.0) + camRight * (sin(rock) * handH);
          // the audience's own band rides a little above the still one resting there
          if (uFollow > 1.5) o.y += 0.3;
        }
        return o;
      }
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 orbCenter = vec4(0.0, 0.0, 0.0, 1.0);
       // The billboard is built from the instance TRANSLATION plus camera-aligned
       // corner offsets, so the instance matrix's scale never reached the corners.
       // Culling in this app works by zero-scaling an instance matrix — which for
       // these orbs did not shrink anything, it just moved the quad to the origin
       // and drew it full size. Every culled orb (about 6,000 of them behind the
       // stage tarps) stacked up into one black disc sitting in the floor at dead
       // centre ice. Carry the scale through so a zero-scaled orb collapses to a
       // point and genuinely disappears.
       float orbScale = 1.0;
       #ifdef USE_INSTANCING
         orbCenter = instanceMatrix * orbCenter;
         orbScale = length(instanceMatrix[0].xyz);
       #endif
       vec3 orbCamRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
       orbCenter.xyz += orbAnim(orbCenter.xyz, orbCamRight);
       orbCenter.y += uOrbLift;
       vec4 mvPosition = modelViewMatrix * orbCenter;
       mvPosition.xyz += vec3(transformed.x, transformed.y, 0.0) * orbScale;
       gl_Position = projectionMatrix * mvPosition;`
    );
  };
}


// ---------------------------------------------------------------------------
// B-stage circular floor screen — the round LED floor the band plays on at the
// end of the thrust. Square canvas; the circle geometry samples the inscribed
// disc, so content is drawn to fill the frame and cropped by the mesh.
// ---------------------------------------------------------------------------
export function makeBStageIdle() {
  const rand = mulberry32(9182);
  const S = 1024;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#0a0714';
  ctx.fillRect(0, 0, S, S);

  // soft overlapping colour fields, like the abstract content these floors run
  const blobs = [
    ['#ff2f6e', 0.34, 0.36, 0.42], ['#2fb8ff', 0.66, 0.34, 0.38],
    ['#ffd12a', 0.5, 0.66, 0.34], ['#7a5cff', 0.3, 0.68, 0.32],
    ['#3ddc6b', 0.72, 0.68, 0.3], ['#ff8a1e', 0.5, 0.28, 0.26],
  ];
  ctx.globalCompositeOperation = 'lighter';
  for (const [col, cx, cy, r] of blobs) {
    const g = ctx.createRadialGradient(cx * S, cy * S, 0, cx * S, cy * S, r * S);
    g.addColorStop(0, col);
    g.addColorStop(0.45, col + '66');
    g.addColorStop(1, col + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  ctx.globalCompositeOperation = 'source-over';

  // concentric rings so the disc reads as a designed floor, not a blur
  ctx.strokeStyle = 'rgba(255,255,255,0.13)';
  for (let i = 1; i <= 7; i++) {
    ctx.lineWidth = i % 2 ? 3 : 1.5;
    ctx.beginPath(); ctx.arc(S / 2, S / 2, (i / 8) * S * 0.48, 0, Math.PI * 2); ctx.stroke();
  }
  // radial spokes
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(S / 2 + Math.cos(a) * S * 0.1, S / 2 + Math.sin(a) * S * 0.1);
    ctx.lineTo(S / 2 + Math.cos(a) * S * 0.48, S / 2 + Math.sin(a) * S * 0.48);
    ctx.stroke();
  }
  // LED pixel speckle
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.02 + rand() * 0.06})`;
    ctx.fillRect(rand() * S, rand() * S, 2, 2);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// 2D crowd: a sprite atlas of humanoid poses, billboarded and instanced one
// per seat. 4 columns x 2 rows of 128x256 cells:
//   0 stand · 1 stand (weight shifted) · 2 clap · 3 arms up
//   4 jump  · 5 towel left            · 6 towel overhead · 7 towel right
// The shirt is drawn PURE WHITE and everything else clearly darker, so the
// fragment shader can tint only the shirt per person (see crowdBillboard).
// ---------------------------------------------------------------------------
export const CROWD_CELL_W = 160, CROWD_CELL_H = 256;
const SKIN = '#cf9f78', HAIR = '#2a2018', TROUSER = '#33343c', SHOE = '#17171b';

// One limb segment. `ang` is measured from straight down, so 0 hangs at the
// side and PI points straight up; `side` mirrors it for the left/right limb.
// An elbow/knee angle past PI swings the next segment back toward the body,
// which is how the clap pose brings the hands together in front.
function limb(ctx, x, y, ang, len, side, w, col) {
  const x2 = x + Math.sin(ang) * len * side, y2 = y + Math.cos(ang) * len;
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
  return [x2, y2];
}

function drawPerson(ctx, ox, oy, p) {
  const cx = ox + CROWD_CELL_W / 2;
  const crouch = p.crouch || 0;
  const hipY = oy + 150 - crouch, shoulderY = oy + 78 - crouch * 0.6;
  const sx = cx + (p.lean || 0);

  // legs first so the torso overlaps them at the hip
  for (const side of [-1, 1]) {
    const [kx, ky] = limb(ctx, sx + side * 9, hipY, p.legA, 46, side, 17, TROUSER);
    const [fx, fy] = limb(ctx, kx, ky, p.shinA || 0, 50, side, 14, TROUSER);
    ctx.strokeStyle = SHOE; ctx.lineWidth = 13; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + side * 7, fy); ctx.stroke();
  }
  // torso — the only pure-white region, so the only part that takes the tint
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(sx - 31, shoulderY - 4); ctx.lineTo(sx + 31, shoulderY - 4);
  ctx.lineTo(sx + 24, hipY + 6); ctx.lineTo(sx - 24, hipY + 6);
  ctx.closePath(); ctx.fill();

  // arms: white short sleeve to the elbow, then skin
  for (const [side, ang, elb] of [[-1, p.aL, p.eL || 0], [1, p.aR, p.eR || 0]]) {
    const [ex, ey] = limb(ctx, sx + side * 28, shoulderY + 4, ang, 42, side, 15, '#ffffff');
    const [hx, hy] = limb(ctx, ex, ey, ang + elb, 40, side, 12, SKIN);
    if (p.towel === side) drawTowel(ctx, hx, hy, ang + elb, side);
  }
  // head
  ctx.fillStyle = SKIN;
  ctx.beginPath(); ctx.arc(sx, shoulderY - 36, 21, 0, 6.3); ctx.fill();
  ctx.fillStyle = HAIR;
  ctx.beginPath(); ctx.arc(sx, shoulderY - 40, 21, Math.PI, 2 * Math.PI); ctx.fill();
}

// A rally towel: slack cloth hanging off the hand, drawn as a wavy strip.
// Drawn in a pure-yellow KEY colour the figures never wear; the fragment
// shader swaps the key for plain white and keeps it out of the shirt tint,
// so every towel in the building is white regardless of the shirt under it.
function drawTowel(ctx, hx, hy, ang, side) {
  let dx = Math.sin(ang) * side, dy = Math.cos(ang);
  // trail the cloth inward/horizontal so it stays inside the atlas cell —
  // along the forearm it left the clip rect and got cut to nothing
  dx = dx * 0.25 - side * 0.75; dy = dy * 0.25 + 0.26;
  const nrm = Math.hypot(dx, dy); dx /= nrm; dy /= nrm;
  const L = 62;
  ctx.fillStyle = '#ffff00';
  ctx.beginPath();
  const edge = (sign) => {
    for (let i = 0; i <= 6; i++) {
      const t = sign > 0 ? i / 6 : (6 - i) / 6;
      const w = (6 + t * 20) * sign, sag = Math.sin(t * 3.2) * 8 * side;
      ctx.lineTo(hx + dx * L * t + sag - w * dy, hy + dy * L * t + w * dx);
    }
  };
  ctx.moveTo(hx, hy);
  edge(1); edge(-1);
  ctx.closePath(); ctx.fill();
}

export function makeCrowdAtlas() {
  const W = CROWD_CELL_W * 4, H = CROWD_CELL_H * 2;
  const [c, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.lineJoin = 'round';
  const P = Math.PI;
  const poses = [
    { aL: 0.20, aR: 0.20, eL: 0.10, eR: 0.10, legA: 0.10 },                 // 0 stand
    { aL: 0.32, aR: 0.10, eL: 0.18, eR: 0.05, legA: 0.13, lean: 4 },        // 1 sway
    { aL: 2.25, aR: 2.25, eL: 1.15, eR: 1.15, legA: 0.11 },                 // 2 clap
    { aL: P - 0.28, aR: P - 0.28, eL: 0.08, eR: 0.08, legA: 0.12 },         // 3 arms up
    // knees out, shins swung back so the feet tuck under — a jump read from
    // the front, not a star jump
    { aL: P - 0.12, aR: P - 0.12, legA: 0.85, shinA: -0.75, crouch: 22 },   // 4 jump
    { aL: 0.24, aR: 2.50, eR: 0.30, legA: 0.12, towel: 1, lean: -3 },       // 5 towel right
    { aL: 0.24, aR: P - 0.20, eR: 0.05, legA: 0.10, towel: 1 },             // 6 towel overhead
    { aL: 2.50, aR: 0.24, eL: 0.30, legA: 0.12, towel: -1, lean: 3 },       // 7 towel left
  ];
  poses.forEach((p, i) => {
    const ox = (i % 4) * CROWD_CELL_W, oy = Math.floor(i / 4) * CROWD_CELL_H;
    // Hard clip to the cell. Arms-out and towel poses reach near the edge, and
    // without this a wide pose paints into the neighbouring frame.
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, CROWD_CELL_W, CROWD_CELL_H); ctx.clip();
    drawPerson(ctx, ox, oy, p);
    ctx.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Shared uniforms — one write drives every crowd mesh, exactly like ORB_ANIM.
export const CROWD_ANIM = {
  uCrowdTime: { value: 0 },
  uCrowdMode: { value: 0 },
  // HANDS UP: the clock reading when the cue fired. Everyone ramps from their
  // current pose to arms-up on their own stagger and HOLDS there.
  uHandsT0: { value: -1e9 },
  uCrowdBright: { value: 1 },
  uCrowdScale: { value: 1 },
  uCrowdTint: { value: new THREE.Color(0, 0, 0) },  // live wash bounce
};

// Billboard + pose-select + per-person shirt tint, all in the shaders. The
// pose is picked per instance per frame from a hash of the person's position,
// so 30k figures animate with zero per-frame CPU work and zero uploads.
export function crowdBillboard(material, { waveMute = 0 } = {}) {
  material.customProgramCacheKey = () => 'crowd-sprite-arms-v8-' + waveMute;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, CROWD_ANIM);
    // share the orb uniforms by reference so sync reads the same clock the
    // wristbands are actually being animated on
    Object.assign(shader.uniforms, ORB_ANIM);
    // per-material, deliberately NOT in CROWD_ANIM: floor/courtside blocks sit
    // this one out when the bowl does the wave
    shader.uniforms.uWaveMute = { value: waveMute };
    shader.vertexShader = `
      uniform float uCrowdTime;
      uniform float uCrowdMode;
      uniform float uHandsT0;
      uniform float uCrowdScale;
      uniform float uWaveMute;
      attribute vec3 aShirt;
      attribute vec3 aSkin;
      varying vec3 vShirt;
      varying vec3 vSkin;
      float cHash(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      }
      ${CROWD_POSE_GLSL}
    ` + shader.vertexShader;

    // Pose frame -> UV cell, plus continuous motion. The atlas frames are the
    // skeleton of the animation; the life comes from `hop` (world-space lift)
    // and `rock` (whole-body lean about the feet), both smooth functions of
    // time so nothing between frame switches ever holds still.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
       vShirt = aShirt;
       vSkin = aSkin;
       vec3 cCenter = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
       float ch3 = cHash(cCenter + 11.7);
       // pose, body hop, lean and arm raise all from the shared model — the
       // wristband over this seat is computed from the very same call
       float frame, hop, rock, raise;
       crowdPose(cCenter, uCrowdTime, int(uCrowdMode + 0.5), uWaveMute, uHandsT0, frame, hop, rock, raise);
       float fcol = mod(frame, 4.0);
       float frow = floor(frame / 4.0);
       vMapUv = (uv + vec2(fcol, 1.0 - frow)) * vec2(0.25, 0.5);`
    );

    // billboard, anchored at the feet, with a per-person height and lean.
    // Built in world space so every vertex carries its true height (correct
    // depth vs the raked bowl); the up-axis leans back toward the camera on
    // steep pitches so figures never go edge-on when viewed from above.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `vec3 wPos = (modelMatrix * vec4(cCenter, 1.0)).xyz;
       wPos.y += hop;
       vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
       vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
       float steep = smoothstep(0.30, 0.85, 1.0 - abs(camUp.y));
       vec3 upAxis = normalize(mix(vec3(0.0, 1.0, 0.0), camUp, steep));
       // culled seats have zero-scaled instance matrices; without this every
       // culled person collapses to a full-size sprite at the world origin
       float cAlive = step(0.0001, length(vec3(instanceMatrix[0].x, instanceMatrix[0].y, instanceMatrix[0].z)));
       float csc = (0.90 + ch3 * 0.22) * uCrowdScale * cAlive;
       float crk = cos(rock), srk = sin(rock);
       vec2 rp = vec2(transformed.x * crk - transformed.y * srk,
                      transformed.x * srk + transformed.y * crk);
       vec4 mvPosition = viewMatrix * vec4(wPos + (camRight * rp.x + upAxis * rp.y) * csc, 1.0);
       gl_Position = projectionMatrix * mvPosition;`
    );

    shader.fragmentShader = `
      uniform float uCrowdBright;
      uniform vec3 uCrowdTint;
      varying vec3 vShirt;
      varying vec3 vSkin;
    ` + shader.fragmentShader;
    // Masks read the ORIGINAL texel. Towel key (yellow) becomes plain white
    // and never takes the shirt tint. The shirt mask is a smoothstep, not a
    // hard step, so the antialiased rim of the shirt tints proportionally
    // instead of staying behind as a white outline.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       vec3 cBase = diffuseColor.rgb;
       float towelKey = smoothstep(0.30, 0.55, min(cBase.r, cBase.g) - cBase.b);
       float shirtMask = smoothstep(0.55, 0.82, min(min(cBase.r, cBase.g), cBase.b)) * (1.0 - towelKey);
       cBase = mix(cBase, vec3(1.0), towelKey);
       cBase *= mix(vec3(1.0), vShirt, shirtMask);
       // skin key: the atlas paints all skin one warm tone (#cf9f78); this
       // band-passes it and applies the person's own complexion multiplier
       float skinMask = smoothstep(0.18, 0.26, cBase.r - cBase.b)
                      * (1.0 - smoothstep(0.48, 0.6, cBase.r - cBase.b))
                      * smoothstep(0.07, 0.13, cBase.r - cBase.g)
                      * (1.0 - towelKey) * (1.0 - shirtMask);
       cBase *= mix(vec3(1.0), vSkin, skinMask);
       diffuseColor.rgb = cBase * (vec3(uCrowdBright) + uCrowdTint);`
    );
  };
}

// ---------------------------------------------------------------------------
// Confetti silhouettes, one 2x2 atlas: square / heart / star / butterfly.
// White-on-transparent; the particle shaders pick a cell from their seed and
// discard outside the alpha, so every confetti system shares this texture.
// ---------------------------------------------------------------------------
export function makeConfettiAtlas() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(24, 24, 80, 80);                              // square
  x.save(); x.translate(192, 70); x.scale(1.5, 1.5);       // heart
  x.beginPath();
  x.moveTo(0, 30);
  x.bezierCurveTo(-40, -4, -18, -34, 0, -12);
  x.bezierCurveTo(18, -34, 40, -4, 0, 30);
  x.fill(); x.restore();
  x.save(); x.translate(64, 192); x.beginPath();           // star
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 21 : 50, a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    x[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  x.closePath(); x.fill(); x.restore();
  x.save(); x.translate(192, 192);                         // butterfly
  for (const s of [-1, 1]) {
    x.beginPath(); x.ellipse(s * 24, -12, 22, 27, s * 0.5, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(s * 17, 20, 14, 18, s * -0.4, 0, Math.PI * 2); x.fill();
  }
  x.fillRect(-4, -42, 8, 82);
  x.restore();
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------------------
// Suite finishes, baked lit (MeshBasic): a plush patterned carpet for the
// room floor and warm walnut panelling with a cove-lit top for the back wall.
// Both tile along the ring strip's u axis.
// ---------------------------------------------------------------------------
export function makeSuiteCarpet() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  // baked LIT: MeshBasic shows these values as-is, and the room around them
  // is dark — bake the lamplight into the pile or it reads as a black pit
  x.fillStyle = '#6b3a40';
  x.fillRect(0, 0, 256, 256);
  let seed = 11;
  const rnd = () => (seed = (16807 * seed) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) {
    x.fillStyle = `rgba(${50 + rnd() * 60}, ${24 + rnd() * 26}, ${28 + rnd() * 28}, 0.35)`;
    x.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 3, 2 + rnd() * 3);
  }
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      const px = gx * 32 + (gy % 2) * 16, py = gy * 32;
      x.fillStyle = 'rgba(196, 118, 108, 0.8)';
      x.beginPath(); x.arc(px + 8, py + 8, 3.4, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(236, 196, 96, 0.6)';
      x.beginPath(); x.arc(px + 8, py + 8, 1.3, 0, Math.PI * 2); x.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function makeSuiteWall() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  // v runs floor (0) to ceiling (1) on the ring strip -> canvas y flipped
  const g = x.createLinearGradient(0, 256, 0, 0);
  g.addColorStop(0, '#5a4430');
  g.addColorStop(0.72, '#8a6a48');
  g.addColorStop(0.88, '#b08c5e');
  g.addColorStop(1, '#eddcb6');            // cove light washing down from the ceiling
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  // walnut slats with seams and grain
  let seed = 5;
  const rnd = () => (seed = (16807 * seed) % 2147483647) / 2147483647;
  for (let sx = 0; sx < 256; sx += 32) {
    x.fillStyle = `rgba(0,0,0,${0.28 + rnd() * 0.14})`;
    x.fillRect(sx, 26, 2, 230);
    for (let i = 0; i < 5; i++) {
      x.fillStyle = `rgba(${70 + rnd() * 46}, ${50 + rnd() * 34}, ${30 + rnd() * 22}, 0.3)`;
      x.fillRect(sx + 4 + rnd() * 24, 30 + rnd() * 200, 2, 14 + rnd() * 40);
    }
  }
  // dark baseboard at the floor line
  x.fillStyle = '#2c2118';
  x.fillRect(0, 236, 256, 20);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------------------------------------------------------------------------
// SEAT BILLBOARD ATLAS — a 2x1 sheet: left half is a seat seen from the front
// (down the rake, toward the show), right half is the same seat from behind.
// Feeds the low-poly seat mode, where each seat is ONE quad instead of a pan
// and a backrest: 2 triangles per seat instead of ~24, which is the whole
// point of the mode. Painted white so instanceColor still tints every seat.
// ---------------------------------------------------------------------------
export function makeSeatBillboard() {
  const W = 512, H = 256;
  const [c, x] = makeCanvas(W, H);
  x.clearRect(0, 0, W, H);
  const half = W / 2;

  const seat = (ox, back) => {
    const cx = ox + half / 2;
    // backrest slab
    const bw = 150, bh = 120, by = 26;
    const grd = x.createLinearGradient(cx - bw / 2, by, cx + bw / 2, by + bh);
    if (back) { grd.addColorStop(0, '#6c6c74'); grd.addColorStop(0.5, '#8a8a93'); grd.addColorStop(1, '#5a5a62'); }
    else { grd.addColorStop(0, '#d6d6de'); grd.addColorStop(0.45, '#ffffff'); grd.addColorStop(1, '#b8b8c2'); }
    x.fillStyle = grd;
    x.beginPath();
    x.roundRect(cx - bw / 2, by, bw, bh, [16, 16, 6, 6]);
    x.fill();
    if (!back) {
      // moulded flutes down the backrest, only visible from the front
      x.strokeStyle = 'rgba(0,0,0,0.16)';
      x.lineWidth = 3;
      for (let i = -2; i <= 2; i++) {
        x.beginPath();
        x.moveTo(cx + i * 26, by + 16);
        x.lineTo(cx + i * 26, by + bh - 12);
        x.stroke();
      }
    } else {
      x.strokeStyle = 'rgba(0,0,0,0.22)';
      x.lineWidth = 4;
      x.beginPath();
      x.roundRect(cx - bw / 2 + 12, by + 14, bw - 24, bh - 28, 10);
      x.stroke();
    }
    // seat pan, tipped up the way an empty arena seat sits
    const pw = 158, ph = 56, py = by + bh - 4;
    const pg = x.createLinearGradient(0, py, 0, py + ph);
    if (back) { pg.addColorStop(0, '#54545c'); pg.addColorStop(1, '#3a3a42'); }
    else { pg.addColorStop(0, '#efeff5'); pg.addColorStop(1, '#9d9da8'); }
    x.fillStyle = pg;
    x.beginPath();
    x.roundRect(cx - pw / 2, py, pw, ph, [10, 10, 4, 4]);
    x.fill();
    // shadow under the pan grounds the sprite on its tread
    x.fillStyle = 'rgba(0,0,0,0.34)';
    x.beginPath();
    x.ellipse(cx, py + ph + 8, pw / 2.1, 11, 0, 0, Math.PI * 2);
    x.fill();
  };
  seat(0, false);
  seat(half, true);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
