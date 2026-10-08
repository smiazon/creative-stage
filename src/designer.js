// ---------------------------------------------------------------------------
// CREATE YOUR RIG — a 2D birds-eye editor for the show package.
//
// COORDINATES: the canvas is the world's x-z plane seen from above.
//   canvas x -> world x (stage at the LEFT, negative x)
//   canvas y -> world z
// Everything the user places is stored in metres, in the same rig-local frame
// the 3D builders use, so a plan drops straight into buildRig().
//
// PLAN CONTRACT (v2) — what onUse() receives and SAVE/EXPORT round-trip:
//   { name, version: 2, venue: {curtains, position, catwalk, bstage, farSize},
//     trusses:   [{ x, z, len, rot, axis, y }]    rot = radians, axis kept for v1 readers
//     fixtures:  [{ type, x, z, y, rot, aim }]
//     fx:        [{ type, x, z }]
//     speakers:  [{ type, x, z, y, rot }]
//     barricades:[{ x, z, len, rot, axis }]
//     stages:    [{ x, z, w, d, rot, h }]         custom decks, walkable in 3D
//     screens:   [{ x, z, w, h, rot, y }] }       custom LED, fed by the video source
//
// Every placeable carries a free `rot` in radians. v1 plans (axis 'x'|'z')
// still load — axis is converted on the way in and re-emitted on the way out.
// ---------------------------------------------------------------------------

// --- venue geometry, mirrored from bowl.js / stage.js ----------------------
const BOWL_A = 31.4;    // inner-edge half-width along x (first row of seats)
const BOWL_B = 13.9;    // inner-edge half-width along z
const BOWL_R = 9.4;     // inner-edge corner radius
const FOH = { cx: 24, hd: 3.0, hw: 4.0 };
const CAT_W = 2.8;
const AIM = { x: 0, z: 0 };            // fixtures default to facing the bowl centre

const LS_KEY = 'arena-rig-plans';      // { name -> plan }
const DEF_TRUSS_Y = 15.4;
const TRUSS_Y_MIN = 8, TRUSS_Y_MAX = 22;

const FIXTURE_TYPES = ['spot', 'wash', 'beam', 'strip', 'strobe', 'blinder', 'uv', 'laser'];
const FX_TYPES = ['confetti', 'pyro', 'popper', 'streamer', 'flame'];
const FIX_COLOR = {
  spot: '#ffd98a', wash: '#8ad4ff', beam: '#b79dff', strip: '#7ef0c0',
  strobe: '#ffffff', blinder: '#ffc46b', uv: '#c07bff', laser: '#ff6b8a',
};
const FX_COLOR = {
  confetti: '#ff8ad0', pyro: '#ff9a3c', popper: '#ffd166',
  streamer: '#9ae6b4', flame: '#ff6b3c',
};
const GOLD = '#c49632', GOLD_HI = '#d9b260', CYAN = '#6fd7e4', INK = '#e8e4d8';

// segment kinds are drawn as a run of length `len` about their centre
// Trusses and barricades come in shapes now, not just straight runs. `shape`
// rides on the item; segment shapes use `len`, ring shapes use `r`.
const TRUSS_SHAPES = ['straight', 'circle', 'arc', 'square'];
const BARRICADE_SHAPES = ['straight', 'curve', 'tpit', 'ring'];
const RING_SHAPES = new Set(['circle', 'ring', 'square']);
const SEGMENT_KINDS = new Set(['truss', 'barricade']);
const BOX_KINDS = new Set(['stage', 'screen']);
const LIST = {
  truss: 'trusses', fixture: 'fixtures', fx: 'fx', speaker: 'speakers',
  barricade: 'barricades', stage: 'stages', screen: 'screens',
};
const KIND_LABEL = {
  truss: 'TRUSS', fixture: 'FIXTURE', fx: 'FX', speaker: 'SPEAKER',
  barricade: 'BARRICADE', stage: 'STAGE DECK', screen: 'LED SCREEN',
};

const r2 = (v) => Math.round(v * 100) / 100;
const fmt = (v) => (Math.round(v * 10) / 10).toFixed(1);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const TAU = Math.PI * 2;
const axisToRot = (a) => (a === 'x' ? 0 : Math.PI / 2);
const rotToAxis = (r) => {
  const n = ((r % Math.PI) + Math.PI) % Math.PI;
  return (n < Math.PI / 4 || n > Math.PI * 0.75) ? 'x' : 'z';
};

// endpoints of a segment item, in world metres
function segEnds(it) {
  const c = Math.cos(it.rot) * it.len / 2, s = Math.sin(it.rot) * it.len / 2;
  return { ax: it.x - c, az: it.z - s, bx: it.x + c, bz: it.z + s };
}
function pointSegDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz;
  const t = L > 1e-9 ? clamp(((px - ax) * dx + (pz - az) * dz) / L, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
// is (px,pz) inside a rotated rectangle centred on it?
function inBox(px, pz, it, padW = 0, padD = 0) {
  const c = Math.cos(-it.rot), s = Math.sin(-it.rot);
  const dx = px - it.x, dz = pz - it.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) <= it.w / 2 + padW && Math.abs(lz) <= (it.d ?? 0.4) / 2 + padD;
}

// B-stage outlines, mirrored from stage.js B_SHAPES (world XZ)
function bstagePoints(kind, bX) {
  const pts = [];
  const push = (x, z) => pts.push([bX + x, -z]);
  if (kind === 'circle') {
    for (let i = 0; i <= 48; i++) { const a = (i / 48) * TAU; push(Math.cos(a) * 3.5, Math.sin(a) * 3.5); }
  } else if (kind === 'square') {
    const h = 3.2;
    push(-h, -h); push(h, -h); push(h, h); push(-h, h); push(-h, -h);
  } else if (kind === 'x') {
    const a = 3.9, w = 1.2, k = Math.SQRT1_2;
    const raw = [[w, a], [-w, a], [-w, w], [-a, w], [-a, -w], [-w, -w],
      [-w, -a], [w, -a], [w, -w], [a, -w], [a, w], [w, w]];
    for (const [x, z] of raw) push((x - z) * k, (x + z) * k);
    push((raw[0][0] - raw[0][1]) * k, (raw[0][0] + raw[0][1]) * k);
  } else if (kind === 'heart') {
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * TAU, k = 0.24;
      const hx = 16 * Math.sin(t) ** 3;
      const hz = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      push(hz * k, -hx * k);
    }
  }
  return pts;
}

function rrPath(ctx, a, b, r) {
  ctx.moveTo(-a + r, -b);
  ctx.lineTo(a - r, -b);
  ctx.arcTo(a, -b, a, -b + r, r);
  ctx.lineTo(a, b - r);
  ctx.arcTo(a, b, a - r, b, r);
  ctx.lineTo(-a + r, b);
  ctx.arcTo(-a, b, -a, b - r, r);
  ctx.lineTo(-a, -b + r);
  ctx.arcTo(-a, -b, -a + r, -b, r);
  ctx.closePath();
}

const STYLE = `
/* Create Your Rig — Nocturne Neon. Obsidian, glass, and one laser (cyan) for
   whatever is live. The plan itself keeps its drafting colours. */
#rigDesigner { position: fixed; inset: 0; z-index: 300; display: none;
  --ink: #ffffff; --silver: #a1a1aa; --stealth: #52525b; --cyan: #00f0ff; --magenta: #ff0055;
  --glass: rgba(18,18,24,0.74); --spring: cubic-bezier(0.22, 1, 0.36, 1);
  background: #050507; color: var(--ink);
  font-family: -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; user-select: none; }
#rigDesigner.open { display: flex; flex-direction: column; }
#rigDesigner * { box-sizing: border-box; }
#rigDesigner button { font-family: inherit; }
#rigDesigner kbd { font: 9px ui-monospace, 'SF Mono', Menlo, monospace; border: 1px solid #ffffff22; border-radius: 4px;
  padding: 0 4px; opacity: 0.75; }
/* grain */
#rigDesigner::after { content: ''; position: absolute; inset: -20px; pointer-events: none; z-index: 1;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0.42 0.42 0.42 0 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 160px 160px; opacity: 0.07; mix-blend-mode: overlay; }

.rdTop { position: relative; z-index: 2; flex: 0 0 56px; display: flex; align-items: center; gap: 8px; padding: 0 18px;
  background: rgba(10,10,14,0.7); -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%); }
.rdBrand { font-size: 13px; letter-spacing: 0.02em; font-weight: 500; white-space: nowrap; color: var(--ink); margin-right: 6px; }
.rdBrand b { color: var(--cyan); font-weight: 600; }
.rdVenue { font: 500 10px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.1em; color: var(--silver);
  background: rgba(255,255,255,0.05); border-radius: 999px; padding: 8px 12px; cursor: pointer; white-space: nowrap;
  transition: background 0.18s, color 0.18s; }
.rdVenue:hover { color: var(--ink); background: rgba(0,240,255,0.1); }
.rdSpacer { flex: 1; }
.rdBtn { background: rgba(255,255,255,0.05); color: var(--silver); border: none; border-radius: 999px;
  padding: 10px 16px; font: 600 10px/1 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif;
  letter-spacing: 0.14em; text-transform: uppercase; cursor: pointer; white-space: nowrap;
  transition: background 0.18s, color 0.18s, transform 0.14s var(--spring), box-shadow 0.25s; }
.rdBtn:hover { background: rgba(255,255,255,0.09); color: var(--ink); }
.rdBtn:active { transform: scale(0.97); }
.rdBtn.on { background: rgba(0,240,255,0.14); color: var(--cyan); }
.rdBtn.go { background: var(--cyan); color: #030305; font-weight: 700; margin-left: 8px;
  box-shadow: 0 0 20px rgba(0,240,255,0.25), 0 0 40px rgba(0,240,255,0.1); }
.rdBtn.go:hover { background: #66f6ff; color: #030305; }
.rdBtn.x { padding: 10px 13px; font-size: 12px; background: transparent; }
.rdBtn.x:hover { color: var(--magenta); background: rgba(255,0,85,0.08); }

.rdBody { position: relative; z-index: 2; flex: 1; display: flex; min-height: 0; }
.rdSide { flex: 0 0 236px; overflow-y: auto; background: rgba(10,10,14,0.6);
  -webkit-backdrop-filter: blur(24px); backdrop-filter: blur(24px); padding: 8px 10px 60px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent; }
.rdSide::-webkit-scrollbar { width: 8px; }
.rdSide::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 8px; }

/* the step list: where you are, what is done */
.rdRail { padding: 6px 0 10px; margin-bottom: 6px; }
.rdRail .rs { display: flex; align-items: center; gap: 10px; padding: 7px 10px; cursor: pointer; border-radius: 10px;
  font: 500 11px/1 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif; color: var(--stealth);
  transition: background 0.18s, color 0.18s; }
.rdRail .rs:hover { color: var(--ink); background: rgba(255,255,255,0.04); }
.rdRail .rs .n { width: 16px; height: 16px; line-height: 16px; text-align: center; border-radius: 50%; flex: 0 0 16px;
  font: 600 8.5px/16px ui-monospace, 'SF Mono', Menlo, monospace; background: rgba(255,255,255,0.06); color: var(--stealth); }
.rdRail .rs.ok { color: var(--silver); }
.rdRail .rs.ok .n { color: #030305; background: var(--silver); }
.rdRail .rs.cur { color: var(--ink); background: rgba(0,240,255,0.07); }
.rdRail .rs.cur .n { background: var(--cyan); color: #030305; box-shadow: 0 0 12px rgba(0,240,255,0.6); }
.rdStep { padding: 8px 10px 12px; }
.rdStep .hd { font: 500 9px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.18em; color: var(--stealth); }
.rdStep .ttl { font: 600 15px/1.2 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif; letter-spacing: 0; color: var(--ink);
  margin: 6px 0 8px; text-transform: none; }
.rdStep .bl { font: 400 11.5px/1.55 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif; color: var(--silver); }
.rdStep .st { margin-top: 9px; font: 500 9.5px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.08em; color: var(--cyan); }
.rdQuick { padding: 0 10px 8px; }
.rdQuick .qh { font: 500 9px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.18em; color: var(--stealth); margin: 6px 0 8px; }
.rdStepBtn { display: block; width: calc(100% - 20px); margin: 0 10px 6px; padding: 10px 12px; border: none;
  background: rgba(255,255,255,0.05); border-radius: 12px; color: var(--silver);
  font: 500 11px/1.2 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif; text-align: left; cursor: pointer;
  transition: background 0.18s, color 0.18s, transform 0.14s var(--spring); }
.rdStepBtn:hover { background: rgba(0,240,255,0.1); color: var(--ink); }
.rdStepBtn:active { transform: scale(0.97); }
.rdStepBtn.go { background: var(--cyan); color: #030305; font-weight: 700; text-align: center; letter-spacing: 0.14em;
  text-transform: uppercase; font-size: 10px; box-shadow: 0 0 20px rgba(0,240,255,0.25); }
.rdStepBtn.go:hover { background: #66f6ff; color: #030305; }
.rdCheck { padding: 2px 10px 8px; }
.rdCheck .ck { font: 400 10.5px/1.45 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif; padding: 8px 10px; border-radius: 10px;
  margin-bottom: 5px; background: rgba(255,255,255,0.04); color: var(--silver); border-left: 2px solid var(--stealth); }
.rdCheck .ck.warn { border-color: #ffb800; color: #ffd66b; }
.rdCheck .ck.ok { border-color: #00ff66; color: #8dffbd; }
.rdAll { text-align: center; font: 500 9px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.14em; color: var(--stealth);
  padding: 12px 0; cursor: pointer; margin-top: 6px; }
.rdAll:hover { color: var(--cyan); }
.rdNav { display: flex; gap: 6px; padding: 4px 10px 10px; }
.rdNav button { flex: 1; padding: 11px; border-radius: 999px; background: rgba(255,255,255,0.05); color: var(--silver);
  border: none; font: 600 10px/1 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif; letter-spacing: 0.14em;
  text-transform: uppercase; cursor: pointer; transition: background 0.18s, color 0.18s, transform 0.14s var(--spring); }
.rdNav button:disabled { opacity: 0.3; cursor: default; }
.rdNav button.nx { background: var(--cyan); color: #030305; font-weight: 700; box-shadow: 0 0 18px rgba(0,240,255,0.25); }
.rdNav button:not(:disabled):hover { background: rgba(255,255,255,0.09); color: var(--ink); }
.rdNav button.nx:not(:disabled):hover { background: #66f6ff; color: #030305; }
.rdNav button:not(:disabled):active { transform: scale(0.97); }

/* the palette: this step's tools only */
.rdCat { margin: 4px 0; }
.rdCatHead { display: flex; align-items: center; gap: 6px; padding: 9px 10px; cursor: pointer; border-radius: 10px; }
.rdCatHead:hover { background: rgba(255,255,255,0.04); }
.rdCatHead .tw { font-size: 8px; color: var(--stealth); transition: transform 0.18s var(--spring); }
.rdCat.shut .tw { transform: rotate(-90deg); }
.rdCatHead .nm { flex: 1; font: 500 9px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.18em; color: var(--stealth); }
.rdCatHead .pr { font: 500 8.5px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.1em; color: var(--silver);
  background: rgba(255,255,255,0.05); border-radius: 999px; padding: 4px 8px; }
.rdCatHead .pr:hover { color: var(--ink); background: rgba(0,240,255,0.12); }
.rdCat.shut .rdItems { display: none; }
.rdItem { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 12px; cursor: grab; border-radius: 10px;
  font: 500 11px/1 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif; color: var(--silver); text-transform: none;
  transition: background 0.15s, color 0.15s; }
.rdItem:hover { background: rgba(255,255,255,0.05); color: var(--ink); }
.rdItem.armed { background: rgba(0,240,255,0.12); color: var(--cyan); box-shadow: 0 0 18px rgba(0,240,255,0.15); }
.rdItem svg { flex: 0 0 15px; opacity: 0.8; }

.rdStage { flex: 1; position: relative; min-width: 0; background: #050507; overflow: hidden; }
.rdStage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.rdStage.grabbable { cursor: grab; }
.rdStage.grabbing { cursor: grabbing; }
.rdStage.placing { cursor: crosshair; }

/* floating glass: layers, elevation, zoom */
.rdLayers { position: absolute; right: 16px; top: 16px; width: 172px; background: var(--glass);
  -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%);
  border-radius: 16px; padding: 8px 0 8px; z-index: 3; box-shadow: 0 20px 50px -30px rgba(0,0,0,0.9); }
.rdLayers .hd { font: 500 9px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.18em; color: var(--stealth); padding: 4px 14px 8px; }
.rdLayers .lr { display: flex; align-items: center; gap: 8px; padding: 6px 14px; cursor: pointer;
  font: 500 10.5px/1 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif; color: var(--silver); text-transform: none; }
.rdLayers .lr:hover { background: rgba(255,255,255,0.05); }
.rdLayers .lr.off { color: var(--stealth); }
.rdLayers .lr .ey { font-size: 9px; color: var(--cyan); width: 10px; }
.rdLayers .lr.off .ey { color: var(--stealth); }
.rdLayers .lr .nm { flex: 1; }
.rdLayers .lr .ct { font: 500 9px/1 ui-monospace, 'SF Mono', Menlo, monospace; color: var(--stealth); min-width: 16px; text-align: right; }
.rdLayers .lr .so { font: 500 8px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.08em; color: var(--stealth);
  background: rgba(255,255,255,0.06); border-radius: 999px; padding: 3px 6px; }
.rdLayers .lr .so:hover { color: var(--ink); background: rgba(0,240,255,0.14); }
.rdElev { position: absolute; left: 16px; bottom: 16px; width: 340px; height: 150px;
  background: var(--glass); -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%);
  border-radius: 16px; z-index: 3; overflow: hidden; box-shadow: 0 20px 50px -30px rgba(0,0,0,0.9); }
.rdElev canvas { position: absolute; inset: 26px 0 0 0; width: 100%; height: calc(100% - 26px); }
.rdElev .lb { position: absolute; top: 0; left: 0; right: 0; height: 26px; line-height: 26px;
  padding: 0 12px; font: 500 8.5px/26px ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.14em; color: var(--stealth); }
.rdElev .fl { position: absolute; top: 5px; right: 6px; background: rgba(255,255,255,0.06); border: none;
  color: var(--silver); border-radius: 999px; font: 500 8px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.1em; padding: 4px 8px; cursor: pointer; }
.rdElev .fl:hover { color: var(--ink); background: rgba(0,240,255,0.14); }
.rdZoom { position: absolute; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 4px; z-index: 3;
  padding: 5px; border-radius: 14px; background: var(--glass); -webkit-backdrop-filter: blur(24px); backdrop-filter: blur(24px); }
.rdZoom button { min-width: 32px; height: 32px; border-radius: 10px; background: transparent;
  border: none; color: var(--silver); font-size: 15px; cursor: pointer; line-height: 1; transition: background 0.15s, color 0.15s; }
.rdZoom button:hover { background: rgba(255,255,255,0.08); color: var(--ink); }
.rdZoom .lbl, .rdZoom .rdBtn { font: 600 8.5px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.08em; padding: 0 6px; text-transform: none; box-shadow: none; }
.rdZoom .rdBtn.on { background: rgba(0,240,255,0.14); color: var(--cyan); }
.rdMarq { position: absolute; border: 1px solid var(--cyan); background: rgba(0,240,255,0.08); pointer-events: none; z-index: 2; }

.rdHint { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
  background: var(--glass); -webkit-backdrop-filter: blur(24px); backdrop-filter: blur(24px); border-radius: 999px; padding: 9px 16px;
  font: 500 10px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.04em; color: var(--silver); white-space: nowrap; z-index: 3;
  max-width: min(60vw, 720px); overflow: hidden; text-overflow: ellipsis; }
.rdToast { position: absolute; left: 50%; top: 16px; transform: translateX(-50%);
  background: var(--cyan); color: #030305; border-radius: 999px; padding: 8px 16px;
  font: 700 10px/1 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif; letter-spacing: 0.14em;
  box-shadow: 0 0 24px rgba(0,240,255,0.4); opacity: 0; transition: opacity 0.2s; z-index: 5; }
.rdToast.show { opacity: 1; }

/* the selection chip: a glass card by the thing you picked */
.rdChip { position: absolute; z-index: 4; background: var(--glass); -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%);
  border-radius: 14px; padding: 10px 12px; min-width: 176px; font: 500 10.5px/1 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif;
  box-shadow: 0 0 0 1px rgba(0,240,255,0.25), 0 20px 50px -30px rgba(0,0,0,0.9); }
.rdChip .ttl { color: var(--cyan); font: 500 9px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.16em; margin-bottom: 8px; }
.rdChip .row { display: flex; align-items: center; gap: 6px; margin-top: 6px; color: var(--silver); }
.rdChip .row span { flex: 1; }
.rdChip .stp { display: flex; align-items: center; gap: 3px; }
.rdChip .stp button { width: 22px; height: 22px; border-radius: 7px; background: rgba(255,255,255,0.06);
  border: none; color: var(--ink); cursor: pointer; font-size: 12px; line-height: 1; }
.rdChip .stp button:hover { background: rgba(0,240,255,0.14); color: var(--cyan); }
.rdChip .stp b { min-width: 42px; text-align: center; color: var(--ink); font: 500 10.5px/1 ui-monospace, 'SF Mono', Menlo, monospace; }
.rdChip .del { margin-top: 10px; width: 100%; background: rgba(255,0,85,0.1); border: none;
  color: var(--magenta); border-radius: 999px; padding: 7px; font: 600 9.5px/1 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif;
  letter-spacing: 0.14em; text-transform: uppercase; cursor: pointer; }
.rdChip .del:hover { background: rgba(255,0,85,0.2); }

/* modal sheets */
.rdModal { position: absolute; inset: 0; z-index: 8; display: none; align-items: center;
  justify-content: center; background: rgba(3,3,5,0.6); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.rdModal.open { display: flex; }
.rdWin { width: 500px; max-width: 92vw; max-height: 82vh; overflow-y: auto; background: var(--glass);
  -webkit-backdrop-filter: blur(32px) saturate(200%); backdrop-filter: blur(32px) saturate(200%);
  border-radius: 24px; padding: 26px 26px 24px; box-shadow: 0 50px 120px -40px rgba(0,0,0,0.95), inset 0 1px 0 rgba(255,255,255,0.06);
  animation: rdRise 0.5s var(--spring) both; }
@keyframes rdRise { from { opacity: 0; transform: translateY(14px) scale(0.985); } }
.rdWin h3 { margin: 0 0 4px; font: 600 17px/1.2 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif; letter-spacing: 0; color: var(--ink); text-transform: none; }
.rdWin .sub { font: 400 11.5px/1.5 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif; letter-spacing: 0; color: var(--silver); margin-bottom: 18px; text-transform: none; }
.rdWin h4 { margin: 16px 0 8px; font: 500 9px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.18em; color: var(--stealth); }
.rdOpts { display: flex; flex-wrap: wrap; gap: 6px; }
.rdOpts button { background: rgba(255,255,255,0.05); border: none; border-radius: 999px;
  padding: 9px 14px; font: 500 11px/1 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif; letter-spacing: 0; color: var(--silver); cursor: pointer;
  text-transform: none; transition: background 0.18s, color 0.18s, transform 0.14s var(--spring); }
.rdOpts button:hover { background: rgba(255,255,255,0.09); color: var(--ink); }
.rdOpts button:active { transform: scale(0.97); }
.rdOpts button.sel { background: var(--cyan); color: #030305; font-weight: 600; box-shadow: 0 0 16px rgba(0,240,255,0.3); }
.rdWin .go { width: 100%; margin-top: 22px; padding: 14px; border-radius: 999px; border: none;
  background: var(--cyan); color: #030305; font: 700 11px/1 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif;
  letter-spacing: 0.18em; text-transform: uppercase; cursor: pointer; box-shadow: 0 0 20px rgba(0,240,255,0.25), 0 0 40px rgba(0,240,255,0.1);
  transition: background 0.18s, transform 0.14s var(--spring); }
.rdWin .go:hover { background: #66f6ff; }
.rdWin .go:active { transform: scale(0.98); }
.rdWin input[type=text] { width: 100%; background: rgba(255,255,255,0.05); border: none;
  border-radius: 12px; padding: 11px 13px; color: var(--ink); font: 500 13px/1 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif; }
.rdWin input[type=text]:focus { outline: none; box-shadow: 0 0 0 1.5px var(--cyan), 0 0 18px rgba(0,240,255,0.25); }
.rdRow { display: flex; gap: 8px; margin-top: 10px; }
.rdRow .rdBtn { flex: 1; text-align: center; }
.rdPlan { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 14px;
  background: rgba(255,255,255,0.03); margin-bottom: 7px; cursor: pointer; transition: background 0.18s; }
.rdPlan:hover { background: rgba(0,240,255,0.08); }
.rdPlan canvas { flex: 0 0 62px; height: 40px; border-radius: 8px; background: #050507; }
.rdPlan .info { flex: 1; min-width: 0; }
.rdPlan .info b { display: block; font: 600 12px/1.3 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif; color: var(--ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rdPlan .info span { font: 500 9.5px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.06em; color: var(--stealth); }
.rdPlan .rm { flex: 0 0 auto; border: none; background: rgba(255,0,85,0.08); color: var(--magenta);
  border-radius: 999px; padding: 6px 10px; font: 600 9px/1 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif; letter-spacing: 0.1em; cursor: pointer; }
.rdPlan .rm:hover { background: rgba(255,0,85,0.18); }
.rdEmpty { text-align: center; padding: 28px 10px; color: var(--silver); font: 400 12px/1.5 -apple-system, 'SF Pro Display', Inter, system-ui, sans-serif; }
`;

const ICON = {
  truss: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1 5h14M1 11h14M1 5l4 6M5 5l4 6M9 5l4 6M13 5l2 3"/></svg>',
  dot: (c) => `<svg viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="1.3"><circle cx="8" cy="8" r="4.4"/><path d="M8 12.4V15"/></svg>`,
  square: (c) => `<svg viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="1.3"><rect x="4" y="4" width="8" height="8" rx="1"/></svg>`,
  tri: (c) => `<svg viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="1.3"><path d="M8 3.6 13 12H3z"/></svg>`,
  bar: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2 6h12M2 10h12M4 6v4M12 6v4"/></svg>',
  ring: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="8" cy="8" r="5.4"/></svg>',
  arc: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2.5 11a6.5 6.5 0 0 1 11 0"/></svg>',
  sq: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="3" y="3" width="10" height="10"/></svg>',
  spk: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="4" y="2" width="8" height="12" rx="1.2"/><circle cx="8" cy="6" r="1.8"/><circle cx="8" cy="11" r="1.2"/></svg>',
  deck: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="4" width="12" height="8" rx="1"/><path d="M2 8h12"/></svg>',
  screen: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="3" width="12" height="8" rx="1"/><path d="M6 14h4"/></svg>',
};

export function initDesigner({ onUse } = {}) {
  // --- DOM ------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'rigDesigner';
  root.innerHTML = `
    <div class="rdTop">
      <div class="rdBrand">Create your <b>rig</b></div>
      <div class="rdVenue" id="rdVenueChip"></div>
      <div class="rdSpacer"></div>
      <button class="rdBtn" id="rdPresets">Presets</button>
      <button class="rdBtn" id="rdOpen">Open</button>
      <button class="rdBtn" id="rdSave">Save</button>
      <button class="rdBtn go" id="rdUse">Use this rig</button>
      <button class="rdBtn x" id="rdClose">&#10005;</button>
    </div>
    <div class="rdBody">
      <div class="rdSide" id="rdSide"></div>
      <div class="rdStage" id="rdStage">
        <canvas id="rdCanvas"></canvas>
        <div class="rdZoom">
          <button id="rdZIn" title="Zoom in">+</button>
          <button id="rdZOut" title="Zoom out">&minus;</button>
          <button id="rdZFit" class="lbl" title="Fit the venue (F)">FIT</button>
          <button class="rdBtn" id="rdSnap" title="Snap to the 0.5 m grid">SNAP</button>
        </div>
        <div class="rdHint" id="rdHint"></div>
        <div class="rdToast" id="rdToast"></div>
      </div>
    </div>
    <div class="rdModal" id="rdModal"><div class="rdWin" id="rdWin"></div></div>`;
  document.body.appendChild(root);

  const el = {
    side: root.querySelector('#rdSide'),
    wrap: root.querySelector('#rdStage'),
    hint: root.querySelector('#rdHint'),
    toast: root.querySelector('#rdToast'),
    venueChip: root.querySelector('#rdVenueChip'),
    snap: root.querySelector('#rdSnap'),
    modal: root.querySelector('#rdModal'),
    win: root.querySelector('#rdWin'),
  };
  const canvas = root.querySelector('#rdCanvas');
  // ELEVATION: a second little canvas under the plan showing the room from the
  // FRONT (looking upstage) — the only way to judge trusses, screens and deck
  // heights, which a top-down plan simply cannot show.
  const elevWrap = document.createElement('div');
  elevWrap.className = 'rdElev';
  elevWrap.innerHTML = '<div class="lb">FRONT ELEVATION &mdash; looking at the stage</div><canvas></canvas>'
    + '<button class="fl" title="Flip between front and side elevation">SIDE VIEW</button>';
  root.querySelector('#rdStage').appendChild(elevWrap);
  const elev = elevWrap.querySelector('canvas');
  const ec = elev.getContext('2d');
  let elevSide = false;
  elevWrap.querySelector('.fl').onclick = () => {
    elevSide = !elevSide;
    elevWrap.querySelector('.fl').textContent = elevSide ? 'FRONT VIEW' : 'SIDE VIEW';
    elevWrap.querySelector('.lb').innerHTML = elevSide
      ? 'SIDE ELEVATION &mdash; stage at the left' : 'FRONT ELEVATION &mdash; looking at the stage';
    drawElev();
  };
  const ctx = canvas.getContext('2d');
  // The venue + grid never change while you drag an item, so they are rendered
  // ONCE into this buffer and blitted each frame. Redrawing that path set on
  // every pointermove is what made the old editor feel like mud.
  const bg = document.createElement('canvas');
  const bgc = bg.getContext('2d');
  let bgKey = '';

  let dpr = 1;
  let isOpen = false;
  let everStarted = false;

  // --- state ----------------------------------------------------------------
  const state = {
    name: 'Untitled Rig',
    venue: { curtains: 'full', position: 'far', catwalk: 'standard', bstage: 'circle', farSize: 'default' },
    trusses: [], fixtures: [], fx: [], speakers: [], barricades: [], stages: [], screens: [],
  };
  const view = { cx: 8, cz: 0, s: 6 };
  let geom = {};
  let sel = null, hover = null;
  let multi = [];                   // additional selected refs (shift-click / marquee)
  // LAYERS: one per kind. A hidden layer is not drawn, not hit-tested and not
  // box-selected, so you can peel the rig apart and work on one system at a
  // time instead of reading all of it at once.
  const layers = { stage: true, screen: true, truss: true, fixture: true, fx: true, speaker: true, barricade: true };
  const LAYER_ROWS = [
    ['truss', 'TRUSS'], ['fixture', 'FIXTURES'], ['fx', 'FX'],
    ['speaker', 'SOUND'], ['barricade', 'CROWD'], ['stage', 'STAGE'], ['screen', 'SCREENS'],
  ];
  let snapOn = true;
  let armed = null;                 // palette item armed for click-to-place
  let drag = null;                  // { mode, ... } active pointer gesture
  let spaceDown = false;
  let rafPending = false;

  // --- venue-derived geometry ----------------------------------------------
  function rebuildGeom() {
    const v = state.venue;
    const frontX = v.curtains === 'medium' ? -26.0 : v.curtains === 'large' ? -13.6 : -20.0;
    const backX = v.curtains === 'medium' ? -30.0 : v.curtains === 'large' ? -28.0 : -33.1;
    const rampEnd = frontX + 2.6;
    const catLen = v.catwalk === 'long' ? 22 : 14;
    const hasCat = v.catwalk !== 'none';
    const bX = hasCat ? rampEnd + catLen : rampEnd + 14;
    geom = {
      frontX, backX, rampEnd, hasCat, bX,
      bPts: v.bstage === 'none' ? null : bstagePoints(v.bstage, bX),
    };
    bgKey = '';
  }
  rebuildGeom();

  // --- view transform -------------------------------------------------------
  const w2sX = (x) => (x - view.cx) * view.s + el.wrap.clientWidth / 2;
  const w2sZ = (z) => (z - view.cz) * view.s + el.wrap.clientHeight / 2;
  const s2wX = (px) => (px - el.wrap.clientWidth / 2) / view.s + view.cx;
  const s2wZ = (py) => (py - el.wrap.clientHeight / 2) / view.s + view.cz;
  const lw = (px) => px / view.s;                 // screen px -> world units

  function setWorldTransform(c) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.translate(el.wrap.clientWidth / 2, el.wrap.clientHeight / 2);
    c.scale(view.s, view.s);
    c.translate(-view.cx, -view.cz);
  }

  function invalidate() {
    if (rafPending || !isOpen) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; draw(); });
  }

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = el.wrap.clientWidth, h = el.wrap.clientHeight;
    if (!w || !h) return;
    for (const c of [canvas, bg]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    bgKey = '';
    draw();
  }

  function fitView() {
    const w = el.wrap.clientWidth || 900, h = el.wrap.clientHeight || 600;
    const spanX = (BOWL_A + 12) * 2, spanZ = (BOWL_B + 12) * 2;
    view.s = clamp(Math.min(w / spanX, h / spanZ) * 0.94, 1.2, 160);
    view.cx = 2; view.cz = 0;
    bgKey = '';
  }

  // zoom about a screen point, so the thing under the cursor stays put
  function zoomAt(px, py, factor) {
    const wx = s2wX(px), wz = s2wZ(py);
    view.s = clamp(view.s * factor, 1.2, 160);
    view.cx = wx - (px - el.wrap.clientWidth / 2) / view.s;
    view.cz = wz - (py - el.wrap.clientHeight / 2) / view.s;
    bgKey = '';
    invalidate();
  }
  const zoomCentre = (f) => zoomAt(el.wrap.clientWidth / 2, el.wrap.clientHeight / 2, f);

  // --- snapping -------------------------------------------------------------
  const snapV = (v) => (snapOn ? Math.round(v * 2) / 2 : v);
  // a fixture dropped near a truss adopts its line and height — the way you
  // actually hang units
  function trussSnap(wx, wz) {
    let best = null;
    for (const t of state.trusses) {
      const { ax, az, bx, bz } = segEnds(t);
      const dx = bx - ax, dz = bz - az;
      const L = dx * dx + dz * dz;
      if (L < 1e-9) continue;
      const u = clamp(((wx - ax) * dx + (wz - az) * dz) / L, 0, 1);
      const cx = ax + dx * u, cz = az + dz * u;
      const d = Math.hypot(wx - cx, wz - cz);
      if (d < 0.7 && (!best || d < best.d)) best = { d, x: cx, z: cz, y: t.y, rot: t.rot };
    }
    return best;
  }

  // ============================ DRAWING ====================================
  function drawBackground() {
    const w = el.wrap.clientWidth, h = el.wrap.clientHeight;
    const key = `${w}x${h}|${view.cx.toFixed(2)},${view.cz.toFixed(2)},${view.s.toFixed(3)}|${state.venue.curtains}${state.venue.catwalk}${state.venue.bstage}`;
    if (key === bgKey) return;
    bgKey = key;
    bgc.setTransform(dpr, 0, 0, dpr, 0, 0);
    bgc.clearRect(0, 0, w, h);
    setWorldTransform(bgc);
    const c = bgc;

    // seating band
    c.beginPath();
    rrPath(c, BOWL_A + 9, BOWL_B + 9, BOWL_R + 9);
    rrPath(c, BOWL_A, BOWL_B, BOWL_R);
    c.fillStyle = 'rgba(242,238,226,0.032)';
    c.fill('evenodd');
    c.strokeStyle = 'rgba(242,238,226,0.06)';
    c.lineWidth = lw(1);
    for (const k of [9, 4.5]) { c.beginPath(); rrPath(c, BOWL_A + k, BOWL_B + k, BOWL_R + k); c.stroke(); }

    // event floor
    c.beginPath(); rrPath(c, BOWL_A, BOWL_B, BOWL_R);
    c.fillStyle = '#0a0c13'; c.fill();
    c.strokeStyle = 'rgba(242,238,226,0.22)'; c.lineWidth = lw(1.5); c.stroke();

    // grid, clipped to the floor so it never smears over the seating
    c.save();
    c.beginPath(); rrPath(c, BOWL_A, BOWL_B, BOWL_R); c.clip();
    const x0 = Math.floor(s2wX(0)), x1 = Math.ceil(s2wX(w));
    const z0 = Math.floor(s2wZ(0)), z1 = Math.ceil(s2wZ(h));
    if (view.s > 7) {
      c.strokeStyle = 'rgba(242,238,226,0.045)'; c.lineWidth = lw(1);
      c.beginPath();
      for (let x = x0; x <= x1; x++) { if (x % 5) { c.moveTo(x, z0); c.lineTo(x, z1); } }
      for (let z = z0; z <= z1; z++) { if (z % 5) { c.moveTo(x0, z); c.lineTo(x1, z); } }
      c.stroke();
    }
    c.strokeStyle = 'rgba(242,238,226,0.1)'; c.lineWidth = lw(1);
    c.beginPath();
    for (let x = Math.ceil(x0 / 5) * 5; x <= x1; x += 5) { c.moveTo(x, z0); c.lineTo(x, z1); }
    for (let z = Math.ceil(z0 / 5) * 5; z <= z1; z += 5) { c.moveTo(x0, z); c.lineTo(x1, z); }
    c.stroke();
    c.restore();

    // wizard stage package (context only — not editable here)
    const g = geom;
    c.fillStyle = 'rgba(201,150,50,0.09)';
    c.strokeStyle = `${GOLD}66`;
    c.lineWidth = lw(1.4);
    c.setLineDash([lw(5), lw(4)]);
    const halfW = BOWL_B - 0.35;
    c.beginPath(); c.rect(g.backX, -halfW, g.frontX - g.backX, halfW * 2); c.fill(); c.stroke();
    if (g.hasCat) {
      c.beginPath(); c.rect(g.frontX, -CAT_W / 2, g.bX - g.frontX, CAT_W); c.fill(); c.stroke();
    }
    if (g.bPts) {
      c.beginPath();
      g.bPts.forEach(([x, z], i) => (i ? c.lineTo(x, z) : c.moveTo(x, z)));
      c.closePath(); c.fill(); c.stroke();
    }
    c.setLineDash([]);
    // FOH pen
    c.strokeStyle = 'rgba(242,238,226,0.16)';
    c.beginPath(); c.rect(FOH.cx - FOH.hw, -FOH.hd, FOH.hw * 2, FOH.hd * 2); c.stroke();

    // labels in screen space
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.font = '600 9px "SF Mono", monospace';
    c.fillStyle = `${GOLD}99`;
    c.textAlign = 'center';
    c.fillText('STAGE', w2sX((g.backX + g.frontX) / 2), w2sZ(0));
    c.fillStyle = 'rgba(242,238,226,0.3)';
    c.fillText('FOH', w2sX(FOH.cx), w2sZ(0));
    c.fillText('CROWD', w2sX(6), w2sZ(BOWL_B - 2.4));
  }

  function glyphR() { return clamp(9 / view.s, 0.34, 1.1); }

  // rotation-aware helpers -------------------------------------------------
  function withRot(c, it, fn) {
    c.save(); c.translate(it.x, it.z); c.rotate(it.rot); fn(); c.restore();
  }

  // a ring/square truss is drawn as its outline; everything else is a run
  function shapePath(c, it) {
    const r = it.r || 6;
    if (it.shape === 'square') {
      withRot(c, it, () => { c.rect(-r, -r, r * 2, r * 2); });
      return true;
    }
    if (it.shape === 'circle' || it.shape === 'ring') {
      c.arc(it.x, it.z, r, 0, TAU);
      return true;
    }
    if (it.shape === 'arc' || it.shape === 'curve') {
      const sweep = it.shape === 'arc' ? Math.PI * 0.75 : Math.PI * 0.6;
      c.arc(it.x, it.z, r, it.rot - sweep / 2, it.rot + sweep / 2);
      return true;
    }
    return false;
  }

  function drawSegment(c, it, kind, ghost) {
    const truss = kind === 'truss';
    if (it.shape && it.shape !== 'straight' && it.shape !== 'tpit') {
      c.globalAlpha = ghost ? 0.6 : 1;
      c.strokeStyle = ghost ? `${GOLD_HI}cc` : (truss ? '#9aa3b4' : '#8b94a5');
      c.lineWidth = lw(truss ? 6 : 4);
      c.beginPath();
      if (it.shape === 'square') { c.save(); c.translate(it.x, it.z); c.rotate(it.rot); const r = it.r || 6; c.rect(-r, -r, r * 2, r * 2); c.restore(); }
      else shapePath(c, it);
      c.stroke();
      c.globalAlpha = 1;
      return;
    }
    if (it.shape === 'tpit') {
      // a thrust/T pit: two rails out from the stage plus a cross rail
      c.globalAlpha = ghost ? 0.6 : 1;
      c.strokeStyle = '#8b94a5'; c.lineWidth = lw(3.4);
      withRot(c, it, () => {
        const L = it.len / 2, Wd = (it.r || 5);
        c.beginPath();
        c.moveTo(-L, -Wd); c.lineTo(L, -Wd);
        c.moveTo(-L, Wd); c.lineTo(L, Wd);
        c.moveTo(L, -Wd); c.lineTo(L, Wd);
        c.stroke();
      });
      c.globalAlpha = 1;
      return;
    }
    const { ax, az, bx, bz } = segEnds(it);
    c.globalAlpha = ghost ? 0.6 : 1;
    c.lineCap = 'round';
    if (truss) {
      c.strokeStyle = ghost ? `${GOLD_HI}cc` : '#9aa3b4';
      c.lineWidth = lw(6);
      c.beginPath(); c.moveTo(ax, az); c.lineTo(bx, bz); c.stroke();
      // chord detail reads as truss rather than a fat line
      c.strokeStyle = '#0a0c13'; c.lineWidth = lw(1.1);
      const n = Math.max(2, Math.round(it.len / 1.2));
      c.beginPath();
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        c.moveTo(ax + (bx - ax) * u, az + (bz - az) * u);
        const v = Math.min(1, (i + 0.5) / n);
        const px = -(bz - az) / it.len, pz = (bx - ax) / it.len;
        c.lineTo(ax + (bx - ax) * v + px * lw(3), az + (bz - az) * v + pz * lw(3));
      }
      c.stroke();
    } else {
      c.strokeStyle = ghost ? `${CYAN}cc` : '#57606f';
      c.lineWidth = lw(4);
      c.beginPath(); c.moveTo(ax, az); c.lineTo(bx, bz); c.stroke();
      c.strokeStyle = '#8b94a5'; c.lineWidth = lw(1.4);
      c.beginPath(); c.moveTo(ax, az); c.lineTo(bx, bz); c.stroke();
    }
    c.globalAlpha = 1;
  }

  function drawBox(c, it, kind, ghost) {
    const screen = kind === 'screen';
    c.globalAlpha = ghost ? 0.6 : 1;
    withRot(c, it, () => {
      const d = it.d ?? 0.4;
      if (screen) {
        c.fillStyle = ghost ? `${CYAN}66` : '#1d4c63';
        c.strokeStyle = CYAN;
      } else {
        c.fillStyle = ghost ? `${GOLD}55` : 'rgba(201,150,50,0.22)';
        c.strokeStyle = GOLD_HI;
      }
      c.lineWidth = lw(1.6);
      c.beginPath(); c.rect(-it.w / 2, -d / 2, it.w, d);
      c.fill(); c.stroke();
      if (screen) {
        // tick marks on the viewing face so the facing direction is obvious
        c.strokeStyle = `${CYAN}aa`; c.lineWidth = lw(1);
        c.beginPath();
        for (let i = 1; i < 4; i++) {
          const x = -it.w / 2 + (it.w * i) / 4;
          c.moveTo(x, -d / 2); c.lineTo(x, d / 2);
        }
        c.moveTo(0, d / 2); c.lineTo(0, d / 2 + lw(9));
        c.stroke();
      }
    });
    c.globalAlpha = 1;
  }

  function drawFixture(c, f, r, ghost) {
    const col = FIX_COLOR[f.type] || '#fff';
    c.globalAlpha = ghost ? 0.65 : 1;
    // aim arrow: fixtures always look into the bowl unless rotated
    const ang = f.rot != null ? f.rot : Math.atan2(AIM.z - f.z, AIM.x - f.x);
    c.strokeStyle = `${col}77`; c.lineWidth = lw(1.1);
    c.beginPath();
    c.moveTo(f.x + Math.cos(ang) * r * 1.15, f.z + Math.sin(ang) * r * 1.15);
    c.lineTo(f.x + Math.cos(ang) * r * 2.5, f.z + Math.sin(ang) * r * 2.5);
    c.stroke();
    c.fillStyle = col;
    if (f.type === 'strip') {
      withRot(c, { x: f.x, z: f.z, rot: ang }, () => {
        c.fillRect(-r * 1.5, -r * 0.4, r * 3, r * 0.8);
      });
    } else if (f.type === 'laser') {
      c.beginPath();
      c.moveTo(f.x, f.z - r); c.lineTo(f.x + r, f.z + r * 0.8); c.lineTo(f.x - r, f.z + r * 0.8);
      c.closePath(); c.fill();
    } else if (f.type === 'blinder' || f.type === 'strobe') {
      c.fillRect(f.x - r, f.z - r * 0.75, r * 2, r * 1.5);
    } else {
      c.beginPath(); c.arc(f.x, f.z, r, 0, TAU); c.fill();
      if (f.type === 'beam' || f.type === 'spot') {
        c.fillStyle = '#0a0c13';
        c.beginPath(); c.arc(f.x, f.z, r * 0.42, 0, TAU); c.fill();
      }
    }
    c.globalAlpha = 1;
  }

  function drawFxItem(c, f, r, ghost) {
    const col = FX_COLOR[f.type] || '#fff';
    c.globalAlpha = ghost ? 0.65 : 1;
    c.strokeStyle = col; c.fillStyle = `${col}44`; c.lineWidth = lw(1.4);
    c.beginPath();
    if (f.type === 'confetti' || f.type === 'popper') {
      c.moveTo(f.x, f.z - r * 1.2); c.lineTo(f.x + r, f.z + r * 0.8);
      c.lineTo(f.x - r, f.z + r * 0.8); c.closePath();
    } else if (f.type === 'flame') {
      c.arc(f.x, f.z, r * 0.9, 0, TAU);
    } else {
      c.rect(f.x - r * 0.85, f.z - r * 0.85, r * 1.7, r * 1.7);
    }
    c.fill(); c.stroke();
    // upward burst ticks so FX read differently from fixtures at a glance
    c.beginPath();
    for (const a of [-0.6, 0, 0.6]) {
      c.moveTo(f.x + Math.sin(a) * r * 1.1, f.z - Math.cos(a) * r * 1.1);
      c.lineTo(f.x + Math.sin(a) * r * 2, f.z - Math.cos(a) * r * 2);
    }
    c.stroke();
    c.globalAlpha = 1;
  }

  function drawSpeaker(c, sp, r, ghost) {
    c.globalAlpha = ghost ? 0.65 : 1;
    const ang = sp.rot != null ? sp.rot : Math.atan2(AIM.z - sp.z, AIM.x - sp.x);
    withRot(c, { x: sp.x, z: sp.z, rot: ang }, () => {
      c.fillStyle = sp.type === 'sub' ? '#4a5568' : '#2d3748';
      c.strokeStyle = '#a0aec0'; c.lineWidth = lw(1.2);
      const hw = r * (sp.type === 'sub' ? 1.15 : 0.8), hd = r * 1.5;
      c.beginPath(); c.rect(-hw, -hd, hw * 2, hd * 2); c.fill(); c.stroke();
      c.strokeStyle = '#cbd5e0';
      c.beginPath();
      for (let i = 1; i < 4; i++) { c.moveTo(-hw, -hd + (hd * 2 * i) / 4); c.lineTo(hw, -hd + (hd * 2 * i) / 4); }
      c.stroke();
    });
    c.globalAlpha = 1;
  }

  function drawItem(c, kind, it, r, ghost) {
    if (SEGMENT_KINDS.has(kind)) drawSegment(c, it, kind, ghost);
    else if (BOX_KINDS.has(kind)) drawBox(c, it, kind, ghost);
    else if (kind === 'fixture') drawFixture(c, it, r, ghost);
    else if (kind === 'fx') drawFxItem(c, it, r, ghost);
    else if (kind === 'speaker') drawSpeaker(c, it, r, ghost);
  }

  function drawHighlight(c, ref, isSel) {
    const it = itemOf(ref);
    if (!it) return;
    c.strokeStyle = isSel ? GOLD_HI : `${INK}66`;
    c.lineWidth = lw(isSel ? 2 : 1.4);
    c.setLineDash(isSel ? [] : [lw(4), lw(3)]);
    if (SEGMENT_KINDS.has(ref.kind)) {
      const { ax, az, bx, bz } = segEnds(it);
      c.beginPath(); c.moveTo(ax, az); c.lineTo(bx, bz); c.stroke();
      if (isSel) {
        c.fillStyle = GOLD_HI;
        for (const [hx, hz] of [[ax, az], [bx, bz]]) {
          c.beginPath(); c.arc(hx, hz, lw(4.5), 0, TAU); c.fill();
        }
      }
    } else if (BOX_KINDS.has(ref.kind)) {
      withRot(c, it, () => {
        const d = it.d ?? 0.4;
        c.beginPath(); c.rect(-it.w / 2 - lw(3), -d / 2 - lw(3), it.w + lw(6), d + lw(6)); c.stroke();
      });
    } else {
      const r = glyphR();
      c.beginPath(); c.arc(it.x, it.z, r * 1.9, 0, TAU); c.stroke();
    }
    c.setLineDash([]);
    // rotate handle
    if (isSel && itemRotatable(ref.kind)) {
      const rr = SEGMENT_KINDS.has(ref.kind) ? it.len / 2 + lw(14)
        : BOX_KINDS.has(ref.kind) ? it.w / 2 + lw(14) : glyphR() * 3.2;
      const hx = it.x + Math.cos(it.rot) * rr, hz = it.z + Math.sin(it.rot) * rr;
      c.strokeStyle = `${CYAN}aa`; c.lineWidth = lw(1.2);
      c.beginPath(); c.moveTo(it.x, it.z); c.lineTo(hx, hz); c.stroke();
      c.fillStyle = CYAN;
      c.beginPath(); c.arc(hx, hz, lw(5), 0, TAU); c.fill();
      rotHandle = { x: hx, z: hz };
    }
  }
  let rotHandle = null;
  const itemRotatable = (k) => k !== 'fx';

  // ---- FRONT / SIDE ELEVATION ---------------------------------------------
  // Height is the axis a plan cannot show, so this draws the same items with
  // y up: trusses at their trim, screens at their elevation, decks at rise.
  function drawElev() {
    const W = elev.clientWidth, H = elev.clientHeight;
    if (!W || !H) return;
    elev.width = Math.round(W * dpr); elev.height = Math.round(H * dpr);
    ec.setTransform(dpr, 0, 0, dpr, 0, 0);
    ec.clearRect(0, 0, W, H);
    // world across = z (front view) or x (side view); world up = y
    const span = elevSide ? (BOWL_A + 6) * 2 : (BOWL_B + 6) * 2;
    const topY = 24;
    const s = Math.min(W / span, (H - 24) / topY);
    const ax = (v) => W / 2 + v * s;
    const ay = (y) => H - 14 - y * s;
    const across = (it) => (elevSide ? it.x : it.z);
    // ground + height ruler, labelled in real metres
    ec.strokeStyle = 'rgba(242,238,226,0.16)'; ec.lineWidth = 1;
    ec.beginPath(); ec.moveTo(0, ay(0)); ec.lineTo(W, ay(0)); ec.stroke();
    ec.font = '8px "SF Mono", monospace'; ec.textAlign = 'left';
    for (let y = 5; y <= 20; y += 5) {
      ec.strokeStyle = 'rgba(242,238,226,0.07)';
      ec.beginPath(); ec.moveTo(0, ay(y)); ec.lineTo(W, ay(y)); ec.stroke();
      ec.fillStyle = 'rgba(242,238,226,0.32)';
      ec.fillText(y + ' m', 3, ay(y) - 2);
    }
    // the room's own outline for scale
    ec.strokeStyle = `${GOLD}44`; ec.lineWidth = 1;
    const halfRoom = elevSide ? BOWL_A : BOWL_B;
    ec.strokeRect(ax(-halfRoom), ay(20), halfRoom * 2 * s, 20 * s);
    // decks
    if (layers.stage) for (const st of state.stages) {
      const w = (elevSide ? st.d : st.w);
      ec.fillStyle = 'rgba(201,150,50,0.3)';
      ec.fillRect(ax(across(st) - w / 2), ay(st.h), w * s, st.h * s);
    }
    // screens
    if (layers.screen) for (const sc of state.screens) {
      ec.fillStyle = '#1d4c63'; ec.strokeStyle = CYAN; ec.lineWidth = 1;
      const w = Math.max(1.2, Math.abs(Math.cos(sc.rot)) * (elevSide ? 0.4 : sc.w) + Math.abs(Math.sin(sc.rot)) * (elevSide ? sc.w : 0.4));
      ec.fillRect(ax(across(sc) - w / 2), ay(sc.y + sc.h), w * s, sc.h * s);
      ec.strokeRect(ax(across(sc) - w / 2), ay(sc.y + sc.h), w * s, sc.h * s);
    }
    // trusses: a bar at trim height with its motor drop
    if (layers.truss) for (const t of state.trusses) {
      const half = (t.shape && RING_SHAPES.has(t.shape)) ? (t.r || 6)
        : Math.abs(elevSide ? Math.cos(t.rot) : Math.sin(t.rot)) * t.len / 2;
      const c0 = across(t) - half, c1 = across(t) + half;
      ec.strokeStyle = 'rgba(242,238,226,0.2)'; ec.lineWidth = 1;
      ec.beginPath(); ec.moveTo(ax(across(t)), ay(t.y)); ec.lineTo(ax(across(t)), ay(21)); ec.stroke();
      ec.fillStyle = '#9aa3b4';
      ec.fillRect(ax(c0), ay(t.y) - 2, Math.max(3, (c1 - c0) * s), 4);
    }
    // fixtures hanging off their trim
    if (layers.fixture) for (const f of state.fixtures) {
      ec.fillStyle = FIX_COLOR[f.type] || '#fff';
      ec.beginPath(); ec.arc(ax(across(f)), ay(f.y) + 5, 2, 0, TAU); ec.fill();
    }
    // speakers
    if (layers.speaker) for (const sp of state.speakers) {
      ec.fillStyle = sp.type === 'sub' ? '#4a5568' : '#2d3748';
      ec.strokeStyle = '#a0aec0'; ec.lineWidth = 1;
      const hh = sp.type === 'sub' ? 1.4 : 3.4;
      ec.fillRect(ax(across(sp) - 0.7), ay(sp.y + hh / 2), 1.4 * s, hh * s);
      ec.strokeRect(ax(across(sp) - 0.7), ay(sp.y + hh / 2), 1.4 * s, hh * s);
    }
    // a person for scale — the fastest way to read whether a trim is sane
    ec.fillStyle = 'rgba(242,238,226,0.4)';
    ec.fillRect(ax(halfRoom - 2) - 1, ay(1.75), 2, 1.75 * s);
    ec.beginPath(); ec.arc(ax(halfRoom - 2), ay(1.85), 2.2, 0, TAU); ec.fill();
  }

  function draw() {
    if (!isOpen) return;
    const w = el.wrap.clientWidth, h = el.wrap.clientHeight;
    if (!w || !h) return;
    drawBackground();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bg, 0, 0);
    setWorldTransform(ctx);
    rotHandle = null;
    const r = glyphR();
    if (layers.stage) for (const s of state.stages) drawBox(ctx, s, 'stage', false);
    if (layers.barricade) for (const b of state.barricades) drawSegment(ctx, b, 'barricade', false);
    if (layers.screen) for (const s of state.screens) drawBox(ctx, s, 'screen', false);
    if (layers.fx) for (const f of state.fx) drawFxItem(ctx, f, r, false);
    if (layers.speaker) for (const sp of state.speakers) drawSpeaker(ctx, sp, r, false);
    if (layers.truss) for (const t of state.trusses) drawSegment(ctx, t, 'truss', false);
    if (layers.fixture) for (const f of state.fixtures) drawFixture(ctx, f, r, false);
    if (hover && !(sel && sel.kind === hover.kind && sel.i === hover.i)) drawHighlight(ctx, hover, false);
    if (sel) drawHighlight(ctx, sel, true);
    if (drag && drag.mode === 'new' && drag.valid) drawItem(ctx, drag.kind, drag.it, r, true);
    // multi-selection outlines
    for (const ref of multi) if (!(sel && sel.kind === ref.kind && sel.i === ref.i)) drawHighlight(ctx, ref, false);
    updateChipPos();
    drawElev();
    if (layEl.dataset.n !== String(itemTotal())) {
      layEl.dataset.n = String(itemTotal());
      paintLayers();
      if (!allTools) buildPalette();     // step status + review notes follow the plan
    }
  }

  // ============================ ITEMS ======================================
  const itemOf = (ref) => (ref ? state[LIST[ref.kind]][ref.i] : null);
  const itemTotal = () => Object.values(LIST).reduce((n, k) => n + state[k].length, 0);

  function hitTest(wx, wz) {
    const r = glyphR();
    const pick = (kind, test) => {
      if (!layers[kind]) return null;
      const list = state[LIST[kind]];
      for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return { kind, i };
      return null;
    };
    return pick('fixture', (f) => Math.hypot(f.x - wx, f.z - wz) < r * 1.9)
      || pick('fx', (f) => Math.hypot(f.x - wx, f.z - wz) < r * 1.9)
      || pick('speaker', (s) => Math.hypot(s.x - wx, s.z - wz) < r * 2)
      || pick('truss', (t) => (t.shape && RING_SHAPES.has(t.shape)
        ? Math.abs(Math.hypot(wx - t.x, wz - t.z) - (t.r || 6)) < Math.max(0.6, lw(8))
        : (() => { const e = segEnds(t); return pointSegDist(wx, wz, e.ax, e.az, e.bx, e.bz) < Math.max(0.5, lw(7)); })()))
      || pick('screen', (s) => inBox(wx, wz, s, lw(3), lw(4)))
      || pick('barricade', (b) => { const e = segEnds(b); return pointSegDist(wx, wz, e.ax, e.az, e.bx, e.bz) < Math.max(0.4, lw(6)); })
      || pick('stage', (s) => inBox(wx, wz, s));
  }

  const sameRef = (a, b) => a && b && a.kind === b.kind && a.i === b.i;
  function toggleMulti(ref) {
    if (sameRef(sel, ref)) return;
    const at = multi.findIndex((m) => sameRef(m, ref));
    if (at >= 0) multi.splice(at, 1); else multi.push(ref);
    invalidate();
  }
  const allSel = () => (sel ? [sel, ...multi] : multi.slice());

  function select(ref, keepMulti) {
    if (!keepMulti) multi = [];
    sel = ref;
    if (!ref) { chip.style.display = 'none'; invalidate(); return; }
    buildChip();
    invalidate();
  }

  function deleteSel() {
    const refs = allSel();
    if (!refs.length) return;
    // group by list and splice high indices first, or earlier removals shift
    // the ones still queued
    const byList = {};
    for (const r of refs) (byList[r.kind] ??= []).push(r.i);
    for (const k of Object.keys(byList)) {
      byList[k].sort((a, b) => b - a).forEach((i) => state[LIST[k]].splice(i, 1));
    }
    toast(refs.length > 1 ? `${refs.length} ITEMS REMOVED` : `${KIND_LABEL[refs[0].kind]} REMOVED`);
    select(null);
  }

  function addItem(kind, it) {
    state[LIST[kind]].push(it);
    select({ kind, i: state[LIST[kind]].length - 1 });
    invalidate();
  }

  // --- property chip --------------------------------------------------------
  const layEl = document.createElement('div');
  layEl.className = 'rdLayers';
  el.wrap.appendChild(layEl);
  function paintLayers() {
    layEl.innerHTML = '<div class="hd">LAYERS</div>' + LAYER_ROWS.map(([k, n]) => {
      const cnt = state[LIST[k]].length;
      return `<div class="lr${layers[k] ? '' : ' off'}" data-l="${k}">
        <span class="ey">${layers[k] ? '\u25c9' : '\u25cb'}</span><span class="nm">${n}</span>
        <span class="ct">${cnt}</span><span class="so" data-solo="${k}">SOLO</span></div>`;
    }).join('');
    layEl.querySelectorAll('[data-l]').forEach((row) => {
      row.onclick = (e) => {
        e.stopPropagation();
        const k = row.dataset.l;
        if (e.target.dataset.solo) {
          const only = Object.keys(layers).every((x) => (x === k) === layers[x]);
          for (const x of Object.keys(layers)) layers[x] = only ? true : x === k;
        } else layers[k] = !layers[k];
        // never leave something selected on a layer you just hid
        if (sel && !layers[sel.kind]) select(null);
        multi = multi.filter((m) => layers[m.kind]);
        paintLayers();
        invalidate();
      };
    });
  }

  const marq = document.createElement('div');
  marq.className = 'rdMarq';
  marq.style.display = 'none';
  el.wrap.appendChild(marq);

  const chip = document.createElement('div');
  chip.className = 'rdChip';
  chip.style.display = 'none';
  el.wrap.appendChild(chip);

  function stepper(label, id, val) {
    return `<div class="row"><span>${label}</span><div class="stp">
      <button data-s="${id}:-1">&minus;</button><b id="rdv_${id}">${val}</b><button data-s="${id}:1">+</button>
    </div></div>`;
  }

  function buildChip() {
    const it = itemOf(sel);
    if (!it) { chip.style.display = 'none'; return; }
    const k = sel.kind;
    let rows = `<div class="row"><span>POSITION</span><b id="rdv_pos">${fmt(it.x)}, ${fmt(it.z)}</b></div>`;
    if (SEGMENT_KINDS.has(k)) {
      if (it.shape && it.shape !== 'straight') rows += stepper('RADIUS', 'r', fmt(it.r || 6) + ' m');
      if (!RING_SHAPES.has(it.shape || 'straight')) rows += stepper('LENGTH', 'len', fmt(it.len) + ' m');
    }
    if (BOX_KINDS.has(k)) {
      rows += stepper('WIDTH', 'w', fmt(it.w) + ' m');
      rows += stepper(k === 'screen' ? 'HEIGHT' : 'DEPTH', k === 'screen' ? 'h' : 'd',
        fmt(k === 'screen' ? it.h : it.d) + ' m');
    }
    if (it.y != null) rows += stepper(k === 'stage' ? 'DECK Y' : 'HEIGHT', 'y', fmt(it.y) + ' m');
    if (k === 'stage') rows += stepper('RISE', 'h', fmt(it.h) + ' m');
    if (itemRotatable(k)) rows += stepper('ROTATE', 'rot', Math.round((it.rot * 180 / Math.PI) % 360) + '°');
    chip.innerHTML = `<div class="ttl">${KIND_LABEL[k]}${it.type ? ' · ' + it.type.toUpperCase() : ''}</div>
      ${rows}<button class="del" id="rdDel">DELETE <kbd>DEL</kbd></button>`;
    chip.style.display = 'block';
    chip.querySelector('#rdDel').onclick = (e) => { e.stopPropagation(); deleteSel(); };
    chip.querySelectorAll('[data-s]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const [id, dir] = b.dataset.s.split(':');
        bump(id, +dir);
      };
    });
    updateChipPos();
  }

  function bump(id, dir) {
    const it = itemOf(sel);
    if (!it) return;
    if (id === 'len') it.len = clamp(r2(it.len + dir), 1, 80);
    else if (id === 'r') it.r = clamp(r2((it.r || 6) + dir), 1, 40);
    else if (id === 'w') it.w = clamp(r2(it.w + dir), 1, 80);
    else if (id === 'd') it.d = clamp(r2(it.d + dir * 0.5), 0.5, 40);
    else if (id === 'h') it.h = clamp(r2(it.h + dir * (sel.kind === 'stage' ? 0.2 : 0.5)), 0.2, 20);
    else if (id === 'y') it.y = clamp(r2(it.y + dir * 0.5), 0, TRUSS_Y_MAX);
    else if (id === 'rot') it.rot = (it.rot + dir * Math.PI / 12 + TAU) % TAU;
    buildChip();
    invalidate();
  }

  function updateChipVals() { if (sel) buildChip(); }

  function updateChipPos() {
    if (chip.style.display === 'none') return;
    const it = itemOf(sel);
    if (!it) { chip.style.display = 'none'; return; }
    const px = w2sX(it.x) + 18, py = w2sZ(it.z) + 14;
    chip.style.left = clamp(px, 6, el.wrap.clientWidth - chip.offsetWidth - 6) + 'px';
    chip.style.top = clamp(py, 6, el.wrap.clientHeight - chip.offsetHeight - 6) + 'px';
  }

  // ============================ PALETTE ====================================
  // ------------------------------------------------------------------------
  // THE BUILD ORDER. A rig is not assembled in a random order in real life and
  // it should not be here either: steel, then what the audience looks at, then
  // the lights that hang off the steel, then sound, effects, and the pit. Each
  // step narrows the palette to just its own tools, opens with one-click
  // starting points, and tells you whether you have actually done it.
  // Nothing is locked — SKIP and the step list let you work out of order.
  // ------------------------------------------------------------------------
  const STEPS = [
    { key: 'room', name: 'THE ROOM', tools: [], preset: null,
      blurb: 'Pick the venue and stage shape. Everything else hangs around this.',
      done: () => true,
      status: () => `${state.venue.curtains.toUpperCase()} room, ${state.venue.bstage === 'none' ? 'no B-stage' : state.venue.bstage + ' B-stage'}` },
    { key: 'truss', name: 'HANG THE STEEL', tools: ['truss'], preset: 'truss',
      blurb: 'Trusses come first — lights need something to hang from. Drag a run out over the stage, then drag its ends to size it.',
      done: () => state.trusses.length > 0,
      status: () => `${state.trusses.length} truss${state.trusses.length === 1 ? '' : 'es'} hung` },
    { key: 'scenic', name: 'STAGE & SCREENS', tools: ['stage', 'screen'], preset: 'stage',
      blurb: 'Risers and LED walls — the things the audience actually looks at. Screens show your video content in 3D.',
      done: () => state.stages.length + state.screens.length > 0,
      status: () => `${state.stages.length} deck${state.stages.length === 1 ? '' : 's'}, ${state.screens.length} screen${state.screens.length === 1 ? '' : 's'}` },
    { key: 'fixture', name: 'HANG THE LIGHTS', tools: ['fixture'], preset: 'fixture',
      blurb: 'Drop fixtures onto a truss and they snap onto its line, take its height, and aim into the crowd automatically.',
      done: () => state.fixtures.length > 0,
      status: () => `${state.fixtures.length} fixtures` },
    { key: 'sound', name: 'SOUND', tools: ['speaker'], preset: 'speaker',
      blurb: 'Main hangs go at the stage edges, subs on the deck. These become real speaker stacks you can hear from.',
      done: () => state.speakers.length > 0,
      status: () => `${state.speakers.length} stacks` },
    { key: 'fx', name: 'EFFECTS', tools: ['fx'], preset: 'fx',
      blurb: 'Pyro, flames, confetti and streamers. Place them along the deck lip and they fire from exactly there.',
      done: () => state.fx.length > 0,
      status: () => `${state.fx.length} FX points` },
    { key: 'crowd', name: 'CROWD CONTROL', tools: ['barricade'], preset: 'barricade',
      blurb: 'Barricade the pit. Straight rails, curves, a T-pit down the runway or a ring around the B-stage.',
      done: () => state.barricades.length > 0,
      status: () => `${state.barricades.length} rails` },
    { key: 'review', name: 'REVIEW & USE', tools: [], preset: null,
      blurb: 'Last look before it becomes a real rig.',
      done: () => true, status: () => 'ready when you are' },
  ];
  let stepI = 0;
  const TOOL_STEP = {};
  STEPS.forEach((s, i) => s.tools.forEach((t) => { TOOL_STEP[t] = i; }));

  // Things worth telling someone before they commit. Not errors — a rig with
  // no PA is a legitimate lighting plot — just the gaps a designer would spot.
  function reviewNotes() {
    const n = [];
    if (!state.trusses.length && state.fixtures.length) n.push(['warn', 'Fixtures with no truss — they will hang in mid-air.']);
    if (state.trusses.length && !state.fixtures.length) n.push(['warn', 'Steel is up but nothing is hanging on it.']);
    const loose = state.fixtures.filter((f) => !trussSnapAt(f.x, f.z)).length;
    if (loose) n.push(['warn', `${loose} fixture${loose === 1 ? '' : 's'} not on a truss.`]);
    if (!state.speakers.length) n.push(['info', 'No PA — add main hangs if you want sound from the rig.']);
    if (!state.fx.length) n.push(['info', 'No effects placed.']);
    if (!state.barricades.length) n.push(['info', 'No barricade in front of the stage.']);
    if (!state.screens.length) n.push(['info', 'No LED screens — the house wall still shows your video.']);
    if (!n.length) n.push(['ok', 'Everything checks out. This rig is ready to use.']);
    return n;
  }
  const trussSnapAt = (x, z) => state.trusses.some((t) => {
    const e = segEnds(t);
    return pointSegDist(x, z, e.ax, e.az, e.bx, e.bz) < 0.9;
  });

  const PALETTE = [
    { key: 'truss', name: 'TRUSS', items: [
      { kind: 'truss', shape: 'straight', label: 'STRAIGHT', icon: ICON.truss },
      { kind: 'truss', shape: 'circle', label: 'CIRCLE TRUSS', icon: ICON.ring },
      { kind: 'truss', shape: 'arc', label: 'ARC TRUSS', icon: ICON.arc },
      { kind: 'truss', shape: 'square', label: 'SQUARE TRUSS', icon: ICON.sq },
    ] },
    { key: 'stage', name: 'STAGE & SCREENS', items: [
      { kind: 'stage', label: 'STAGE DECK', icon: ICON.deck },
      { kind: 'screen', label: 'LED SCREEN', icon: ICON.screen },
    ] },
    { key: 'fixture', name: 'FIXTURES', items: FIXTURE_TYPES.map((t) => ({
      kind: 'fixture', type: t, label: t.toUpperCase(),
      icon: t === 'laser' ? ICON.tri(FIX_COLOR[t]) : t === 'strip' || t === 'blinder' || t === 'strobe'
        ? ICON.square(FIX_COLOR[t]) : ICON.dot(FIX_COLOR[t]),
    })) },
    { key: 'fx', name: 'FX', items: FX_TYPES.map((t) => ({
      kind: 'fx', type: t, label: t === 'confetti' ? 'CONFETTI CANNON' : t.toUpperCase(),
      icon: ICON.tri(FX_COLOR[t]),
    })) },
    { key: 'speaker', name: 'SOUND', items: [
      { kind: 'speaker', type: 'main', label: 'MAIN HANG', icon: ICON.spk },
      { kind: 'speaker', type: 'sub', label: 'SUB STACK', icon: ICON.spk },
    ] },
    { key: 'barricade', name: 'CROWD', items: [
      { kind: 'barricade', shape: 'straight', label: 'STRAIGHT RAIL', icon: ICON.bar },
      { kind: 'barricade', shape: 'curve', label: 'CURVED RAIL', icon: ICON.arc },
      { kind: 'barricade', shape: 'tpit', label: 'T-PIT / THRUST', icon: ICON.bar },
      { kind: 'barricade', shape: 'ring', label: 'RING PIT', icon: ICON.ring },
    ] },
  ];

  function newItem(kind, type, x, z, rot = 0, shape) {
    if (kind === 'truss') {
      const sh = shape || 'straight';
      return RING_SHAPES.has(sh) || sh === 'arc'
        ? { x, z, len: 12, r: sh === 'arc' ? 8 : 6, rot, y: DEF_TRUSS_Y, shape: sh }
        : { x, z, len: 12, rot, y: DEF_TRUSS_Y, shape: 'straight' };
    }
    if (kind === 'barricade') {
      const sh = shape || 'straight';
      return { x, z, len: 6, r: sh === 'ring' ? 5 : sh === 'tpit' ? 5 : 8, rot, shape: sh };
    }
    if (kind === 'stage') return { x, z, w: 10, d: 6, rot, h: 1.4 };
    if (kind === 'screen') return { x, z, w: 8, h: 4.5, d: 0.4, rot, y: 3 };
    if (kind === 'fixture') return { type, x, z, y: DEF_TRUSS_Y, rot: null };
    if (kind === 'fx') return { type, x, z };
    if (kind === 'speaker') return { type, x, z, y: type === 'sub' ? 2 : 17, rot: null };
    return null;
  }

  function buildPalette() {
    const st = STEPS[stepI];
    el.side.innerHTML = '';

    // --- the step list: where you are, what is done -----------------------
    const rail = document.createElement('div');
    rail.className = 'rdRail';
    rail.innerHTML = STEPS.map((s, i) => {
      const cls = i === stepI ? 'cur' : (s.done() ? 'ok' : '');
      return `<div class="rs ${cls}" data-step="${i}">
        <span class="n">${i === stepI ? '\u25b8' : (s.done() ? '\u2713' : i + 1)}</span>
        <span class="t">${s.name}</span></div>`;
    }).join('');
    rail.querySelectorAll('[data-step]').forEach((r) => {
      r.onclick = () => goStep(+r.dataset.step);
    });
    el.side.appendChild(rail);

    // --- the current step -------------------------------------------------
    const card = document.createElement('div');
    card.className = 'rdStep';
    card.innerHTML = `<div class="hd">STEP ${stepI + 1} OF ${STEPS.length}</div>
      <div class="ttl">${st.name}</div>
      <div class="bl">${st.blurb}</div>
      <div class="st">${st.status()}</div>`;
    el.side.appendChild(card);

    if (st.key === 'room') {
      const b = document.createElement('button');
      b.className = 'rdStepBtn go';
      b.textContent = 'CHANGE THE ROOM';
      b.onclick = () => openVenue(false);
      el.side.appendChild(b);
    }

    // --- one-click starting points for this step -------------------------
    if (st.preset) {
      const sets = presetSets(st.preset);
      const wrap = document.createElement('div');
      wrap.className = 'rdQuick';
      wrap.innerHTML = '<div class="qh">QUICK START</div>';
      sets.slice(0, 5).forEach((p, i) => {
        const b = document.createElement('button');
        b.className = 'rdStepBtn';
        b.textContent = p.name;
        b.onclick = () => { p.run(); select(null); invalidate(); buildPalette(); toast('ADDED'); };
        wrap.appendChild(b);
      });
      el.side.appendChild(wrap);
    }

    // --- only this step's tools ------------------------------------------
    for (const cat of PALETTE) {
      if (!st.tools.includes(cat.key)) continue;
      const box = document.createElement('div');
      box.className = 'rdCat';
      box.innerHTML = `<div class="rdCatHead"><span class="nm">PLACE BY HAND</span>
        <span class="pr" data-preset="${cat.key}">MORE</span></div><div class="rdItems"></div>`;
      box.querySelector('.pr').onclick = (e) => { e.stopPropagation(); openPresets(cat.key); };
      const items = box.querySelector('.rdItems');
      for (const spec of cat.items) {
        const row = document.createElement('div');
        row.className = 'rdItem';
        row.innerHTML = `${spec.icon}<span>${spec.label}</span>`;
        row.draggable = false;
        row.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          armPalette(spec, row);
          drag = { mode: 'arm', spec, startX: e.clientX, startY: e.clientY };
        });
        items.appendChild(row);
        spec.el = row;
      }
      el.side.appendChild(box);
    }

    // --- review step: the pre-flight check --------------------------------
    if (st.key === 'review') {
      const wrap = document.createElement('div');
      wrap.className = 'rdCheck';
      wrap.innerHTML = reviewNotes().map(([k, m]) => `<div class="ck ${k}">${m}</div>`).join('');
      el.side.appendChild(wrap);
      const b = document.createElement('button');
      b.className = 'rdStepBtn go';
      b.textContent = 'USE THIS RIG';
      b.onclick = () => root.querySelector('#rdUse').click();
      el.side.appendChild(b);
    }

    // --- everything, for when the rails get in the way --------------------
    const all = document.createElement('div');
    all.className = 'rdAll';
    all.textContent = allTools ? 'SHOW ONLY THIS STEP' : 'SHOW ALL TOOLS';
    all.onclick = () => { allTools = !allTools; buildAllOrStep(); };
    el.side.appendChild(all);

    // --- move between steps ----------------------------------------------
    const nav = document.createElement('div');
    nav.className = 'rdNav';
    nav.innerHTML = `<button ${stepI === 0 ? 'disabled' : ''} id="rdBack">BACK</button>
      <button class="nx" id="rdNext">${stepI === STEPS.length - 1 ? 'FINISH' : 'NEXT'}</button>`;
    nav.querySelector('#rdBack').onclick = () => goStep(stepI - 1);
    nav.querySelector('#rdNext').onclick = () => {
      if (stepI === STEPS.length - 1) root.querySelector('#rdUse').click();
      else goStep(stepI + 1);
    };
    el.side.appendChild(nav);
  }

  let allTools = false;
  function buildAllOrStep() {
    if (!allTools) return buildPalette();
    // the flat sandbox, for when you know exactly what you want
    el.side.innerHTML = '';
    for (const cat of PALETTE) {
      const box = document.createElement('div');
      box.className = 'rdCat';
      box.innerHTML = `<div class="rdCatHead"><span class="tw">&#9660;</span><span class="nm">${cat.name}</span>
        <span class="pr" data-preset="${cat.key}">PRESETS</span></div><div class="rdItems"></div>`;
      box.querySelector('.rdCatHead').onclick = (e) => {
        if (e.target.classList.contains('pr')) { e.stopPropagation(); openPresets(cat.key); return; }
        box.classList.toggle('shut');
      };
      const items = box.querySelector('.rdItems');
      for (const spec of cat.items) {
        const row = document.createElement('div');
        row.className = 'rdItem';
        row.innerHTML = `${spec.icon}<span>${spec.label}</span>`;
        row.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          armPalette(spec, row);
          drag = { mode: 'arm', spec, startX: e.clientX, startY: e.clientY };
        });
        items.appendChild(row);
        spec.el = row;
      }
      el.side.appendChild(box);
    }
    const all = document.createElement('div');
    all.className = 'rdAll';
    all.textContent = 'BACK TO THE STEPS';
    all.onclick = () => { allTools = false; buildPalette(); };
    el.side.appendChild(all);
  }

  function goStep(i) {
    stepI = clamp(i, 0, STEPS.length - 1);
    allTools = false;
    disarm();
    // solo the layer this step is about, so you can see what you are doing
    const st = STEPS[stepI];
    if (st.tools.length) {
      for (const k of Object.keys(layers)) layers[k] = true;
    }
    buildPalette();
    paintLayers();
    setHint(st.tools.length ? `${st.name}: ${st.blurb}` : null);
    invalidate();
  }

  function armPalette(spec, row) {
    armed = spec;
    el.side.querySelectorAll('.rdItem').forEach((r) => r.classList.remove('armed'));
    if (row) row.classList.add('armed');
    el.wrap.classList.add('placing');
    setHint(`CLICK THE PLAN TO PLACE ${spec.label} · <kbd>R</kbd> rotates · <kbd>ESC</kbd> cancels`);
  }
  function disarm() {
    armed = null;
    el.side.querySelectorAll('.rdItem').forEach((r) => r.classList.remove('armed'));
    el.wrap.classList.remove('placing');
    setHint();
  }

  let placeRot = 0;
  function placeAt(spec, wx, wz) {
    let x = snapV(wx), z = snapV(wz), rot = placeRot;
    let y = null;
    if (spec.kind === 'fixture') {
      const t = trussSnap(wx, wz);
      if (t) { x = t.x; z = t.z; y = t.y; }
    }
    const it = newItem(spec.kind, spec.type, x, z, rot, spec.shape);
    if (y != null) it.y = y;
    addItem(spec.kind, it);
    toast(`${spec.label} PLACED`);
  }

  // ============================ INTERACTION ================================
  function canvasPos(e) {
    const r = el.wrap.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }

  el.wrap.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas) return;
    el.wrap.setPointerCapture(e.pointerId);
    const { px, py } = canvasPos(e);
    const wx = s2wX(px), wz = s2wZ(py);

    if (armed) { placeAt(armed, wx, wz); if (!e.shiftKey) disarm(); return; }
    if (spaceDown || e.button === 1) {
      drag = { mode: 'pan', px, py, cx: view.cx, cz: view.cz };
      el.wrap.classList.add('grabbing');
      return;
    }
    // rotate handle on the current selection wins over everything
    if (sel && rotHandle && Math.hypot(wx - rotHandle.x, wz - rotHandle.z) < lw(9)) {
      drag = { mode: 'rotate', ref: sel };
      return;
    }
    const hit = hitTest(wx, wz);
    if (hit && e.shiftKey) { toggleMulti(hit); return; }
    if (hit) {
      // dragging any member of a multi-selection moves the whole set
      if (multi.length && (sameRef(sel, hit) || multi.some((m) => sameRef(m, hit)))) {
        drag = { mode: 'moveMany', refs: allSel(), px: wx, pz: wz,
          start: allSel().map((r) => { const t = itemOf(r); return { x: t.x, z: t.z }; }) };
        return;
      }
      select(hit);
      const it = itemOf(hit);
      // grabbing a truss/barricade end resizes it instead of moving it
      if (SEGMENT_KINDS.has(hit.kind)) {
        const en = segEnds(it);
        const dA = Math.hypot(wx - en.ax, wz - en.az), dB = Math.hypot(wx - en.bx, wz - en.bz);
        if (Math.min(dA, dB) < lw(8)) {
          drag = { mode: 'resize', ref: hit, end: dA < dB ? 'a' : 'b' };
          return;
        }
      }
      drag = { mode: 'move', ref: hit, ox: wx - it.x, oz: wz - it.z };
    } else if (e.shiftKey) {
      // shift on empty canvas starts a marquee; plain drag still pans
      drag = { mode: 'marquee', px, py, wx, wz };
      marq.style.display = 'block';
      marq.style.left = px + 'px'; marq.style.top = py + 'px';
      marq.style.width = '0px'; marq.style.height = '0px';
    } else {
      select(null);
      drag = { mode: 'pan', px, py, cx: view.cx, cz: view.cz };
      el.wrap.classList.add('grabbing');
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!isOpen) return;
    const { px, py } = canvasPos(e);
    const wx = s2wX(px), wz = s2wZ(py);

    // dragging out of the palette arms a live ghost
    if (drag && drag.mode === 'arm') {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) {
        drag = { mode: 'new', kind: drag.spec.kind, spec: drag.spec, valid: false, it: null };
      }
    }
    if (drag && drag.mode === 'new') {
      const inside = px > 0 && py > 0 && px < el.wrap.clientWidth && py < el.wrap.clientHeight;
      drag.valid = inside;
      if (inside) {
        let x = snapV(wx), z = snapV(wz), y = null;
        if (drag.spec.kind === 'fixture') {
          const t = trussSnap(wx, wz);
          if (t) { x = t.x; z = t.z; y = t.y; }
        }
        drag.it = newItem(drag.spec.kind, drag.spec.type, x, z, placeRot, drag.spec.shape);
        if (y != null) drag.it.y = y;
      }
      invalidate();
      return;
    }
    if (drag && drag.mode === 'marquee') {
      marq.style.left = Math.min(px, drag.px) + 'px';
      marq.style.top = Math.min(py, drag.py) + 'px';
      marq.style.width = Math.abs(px - drag.px) + 'px';
      marq.style.height = Math.abs(py - drag.py) + 'px';
      return;
    }
    if (drag && drag.mode === 'moveMany') {
      const dx = snapV(wx - drag.px), dz = snapV(wz - drag.pz);
      drag.refs.forEach((r, i) => {
        const it = itemOf(r);
        if (!it) return;
        it.x = r2(drag.start[i].x + dx);
        it.z = r2(drag.start[i].z + dz);
      });
      updateChipVals();
      invalidate();
      return;
    }
    if (drag && drag.mode === 'pan') {
      view.cx = drag.cx - (px - drag.px) / view.s;
      view.cz = drag.cz - (py - drag.py) / view.s;
      bgKey = '';
      invalidate();
      return;
    }
    if (drag && drag.mode === 'move') {
      const it = itemOf(drag.ref);
      if (!it) return;
      let nx = snapV(wx - drag.ox), nz = snapV(wz - drag.oz);
      if (drag.ref.kind === 'fixture') {
        const t = trussSnap(nx, nz);
        if (t) { nx = t.x; nz = t.z; it.y = t.y; }
      }
      it.x = nx; it.z = nz;
      updateChipVals();
      invalidate();
      return;
    }
    if (drag && drag.mode === 'resize') {
      const it = itemOf(drag.ref);
      if (!it) return;
      const en = segEnds(it);
      const fx = drag.end === 'a' ? en.bx : en.ax;
      const fz = drag.end === 'a' ? en.bz : en.az;
      const gx = snapV(wx), gz = snapV(wz);
      const len = Math.max(1, Math.hypot(gx - fx, gz - fz));
      it.len = snapOn ? Math.round(len) : r2(len);
      it.rot = Math.atan2(gz - fz, gx - fx) + (drag.end === 'a' ? Math.PI : 0);
      it.x = fx + Math.cos(it.rot + (drag.end === 'a' ? Math.PI : 0)) * it.len / 2 * (drag.end === 'a' ? -1 : 1);
      it.z = fz + Math.sin(it.rot + (drag.end === 'a' ? Math.PI : 0)) * it.len / 2 * (drag.end === 'a' ? -1 : 1);
      // recentre cleanly: midpoint of the fixed end and the cursor
      it.x = (fx + gx) / 2; it.z = (fz + gz) / 2;
      it.rot = Math.atan2(gz - fz, gx - fx);
      updateChipVals();
      invalidate();
      return;
    }
    if (drag && drag.mode === 'rotate') {
      const it = itemOf(drag.ref);
      if (!it) return;
      let a = Math.atan2(wz - it.z, wx - it.x);
      if (snapOn) a = Math.round(a / (Math.PI / 24)) * (Math.PI / 24);   // 7.5deg steps
      it.rot = (a + TAU) % TAU;
      updateChipVals();
      invalidate();
      return;
    }
    // idle hover
    if (e.target === canvas) {
      const h = hitTest(wx, wz);
      const changed = (h && hover) ? (h.kind !== hover.kind || h.i !== hover.i) : (h !== hover);
      if (changed) { hover = h; invalidate(); }
    } else if (hover) { hover = null; invalidate(); }
  });

  function endDrag(e) {
    if (drag && drag.mode === 'marquee') {
      marq.style.display = 'none';
      const r = el.wrap.getBoundingClientRect();
      const px = (e && e.clientX != null) ? e.clientX - r.left : drag.px;
      const py = (e && e.clientY != null) ? e.clientY - r.top : drag.py;
      const x0 = Math.min(drag.wx, s2wX(px)), x1 = Math.max(drag.wx, s2wX(px));
      const z0 = Math.min(drag.wz, s2wZ(py)), z1 = Math.max(drag.wz, s2wZ(py));
      const picked = [];
      for (const kind of Object.keys(LIST)) {
        if (!layers[kind]) continue;
        state[LIST[kind]].forEach((it, i) => {
          if (it.x >= x0 && it.x <= x1 && it.z >= z0 && it.z <= z1) picked.push({ kind, i });
        });
      }
      if (picked.length) {
        sel = picked[0]; multi = picked.slice(1);
        buildChip();
        toast(`${picked.length} SELECTED`);
      } else select(null);
      drag = null;
      invalidate();
      return;
    }
    if (drag && drag.mode === 'new' && drag.valid && drag.it) {
      addItem(drag.spec.kind, drag.it);
      toast(`${drag.spec.label} PLACED`);
      disarm();
    } else if (drag && drag.mode === 'arm') {
      // a plain click on the palette: stay armed for click-to-place
    }
    if (drag && (drag.mode === 'pan')) el.wrap.classList.remove('grabbing');
    drag = null;
    invalidate();
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  el.wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { px, py } = canvasPos(e);
    // trackpad pinch arrives as ctrl+wheel with small deltas; a mouse notch is
    // ~100. One scale law with a per-source gain keeps both feeling right.
    const gain = e.ctrlKey ? 0.012 : 0.0032;
    zoomAt(px, py, Math.exp(-e.deltaY * gain));
  }, { passive: false });

  el.wrap.addEventListener('dblclick', (e) => {
    if (e.target !== canvas) return;
    const { px, py } = canvasPos(e);
    if (!hitTest(s2wX(px), s2wZ(py))) { fitView(); invalidate(); }
  });

  root.querySelector('#rdZIn').onclick = () => zoomCentre(1.35);
  root.querySelector('#rdZOut').onclick = () => zoomCentre(1 / 1.35);
  root.querySelector('#rdZFit').onclick = () => { fitView(); invalidate(); };

  // --- keyboard -------------------------------------------------------------
  function onKey(e) {
    if (!isOpen) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === ' ') { spaceDown = true; el.wrap.classList.add('grabbable'); e.preventDefault(); return; }
    const k = e.key.toLowerCase();
    if (k === 'g') setSnap(!snapOn);
    else if (k === 'f') { fitView(); invalidate(); }
    else if (e.key === '+' || e.key === '=') zoomCentre(1.35);
    else if (e.key === '-' || e.key === '_') zoomCentre(1 / 1.35);
    else if (k === 'r') {
      const step = (e.shiftKey ? -1 : 1) * Math.PI / 12;   // 15 deg
      if (armed || (drag && drag.mode === 'new')) {
        placeRot = (placeRot + step + TAU) % TAU;
        if (drag && drag.it) drag.it.rot = placeRot;
        toast(`ROTATION ${Math.round(placeRot * 180 / Math.PI)}°`);
        invalidate();
      } else {
        let n = 0;
        for (const r of allSel()) {
          if (!itemRotatable(r.kind)) continue;
          const it = itemOf(r);
          it.rot = (it.rot + step + TAU) % TAU;
          n++;
        }
        if (n) { updateChipVals(); invalidate(); }
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') { deleteSel(); e.preventDefault(); }
    else if (e.key === 'Escape') {
      if (el.modal.classList.contains('open')) closeModal();
      else if (armed) disarm();
      else if (sel) select(null);
    }
  }
  function onKeyUp(e) {
    if (e.key === ' ') { spaceDown = false; if (!drag) el.wrap.classList.remove('grabbable'); }
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', () => { if (isOpen) resizeCanvas(); });

  function setSnap(v) {
    snapOn = v;
    el.snap.classList.toggle('on', snapOn);
    el.snap.textContent = snapOn ? 'SNAP' : 'FREE';
    el.snap.title = snapOn ? 'Snapping to the 0.5 m grid \u2014 click to move freely' : 'Moving freely \u2014 click to snap to the 0.5 m grid';
    toast(snapOn ? 'SNAP ON · 0.5 M GRID' : 'SNAP OFF · FREE PLACEMENT');
  }

  const BASE_HINT = 'Click or drag a palette item to place · <kbd>R</kbd> rotate · '
    + '<kbd>SHIFT</kbd>+drag box-select · <kbd>SHIFT</kbd>+click add · <kbd>G</kbd> snap · <kbd>F</kbd> fit · scroll zoom';
  function setHint(html) { el.hint.innerHTML = html || BASE_HINT; }
  let toastT = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.toast.classList.remove('show'), 1400);
  }

  // ============================ PRESETS ====================================
  function trussRow(x, len, y) { return { x, z: 0, len, rot: Math.PI / 2, y }; }
  function fillTruss(t, types) {
    const out = [];
    const n = Math.max(2, Math.round(t.len / 1.8));
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n - 0.5;
      out.push({
        type: types[i % types.length],
        x: r2(t.x + Math.cos(t.rot) * t.len * u),
        z: r2(t.z + Math.sin(t.rot) * t.len * u),
        y: t.y, rot: null,
      });
    }
    return out;
  }

  function presetSets(cat) {
    const g = geom;
    const deckMid = (g.backX + g.frontX) / 2;
    if (cat === 'truss') return [
      { name: 'SINGLE FRONT TRUSS', run: () => { state.trusses = [trussRow(g.frontX - 2, 26, 15.4)]; } },
      { name: 'CIRCLE OVER B-STAGE', run: () => {
        state.trusses.push({ x: r2(g.bX), z: 0, len: 12, r: 6, rot: 0, y: 13, shape: 'circle' });
      } },
      { name: 'ARC OVER THE PIT', run: () => {
        state.trusses.push({ x: r2(g.frontX + 4), z: 0, len: 12, r: 12, rot: 0, y: 14, shape: 'arc' });
      } },
      { name: 'SQUARE OVER STAGE', run: () => {
        state.trusses.push({ x: r2(deckMid), z: 0, len: 12, r: 9, rot: 0, y: 15.4, shape: 'square' });
      } },
      { name: '3 TRUSS STANDARD', run: () => {
        state.trusses = [trussRow(g.frontX - 2, 26, 15.4), trussRow(g.frontX - 8, 24, 15.4), trussRow(g.frontX - 14, 22, 15.4)];
      } },
      { name: '5 TRUSS FESTIVAL', run: () => {
        state.trusses = [-1, -5, -9, -13, -17].map((d, i) => trussRow(g.frontX + d, 28 - i * 1.5, 15.4));
      } },
      { name: 'BOX GRID', run: () => {
        state.trusses = [
          trussRow(g.frontX - 2, 26, 15.4), trussRow(g.frontX - 16, 26, 15.4),
          { x: deckMid, z: -13, len: 15, rot: 0, y: 15.4 },
          { x: deckMid, z: 13, len: 15, rot: 0, y: 15.4 },
        ];
      } },
    ];
    if (cat === 'fixture') return [
      { name: 'FILL TRUSSES · SPOTS', run: () => {
        state.fixtures = state.trusses.flatMap((t) => fillTruss(t, ['spot']));
      } },
      { name: 'FILL · WASH / BEAM', run: () => {
        state.fixtures = state.trusses.flatMap((t) => fillTruss(t, ['wash', 'beam']));
      } },
      { name: 'FILL · FULL MIX', run: () => {
        state.fixtures = state.trusses.flatMap((t, i) => fillTruss(t, i === 0 ? ['spot', 'beam'] : i === 1 ? ['wash', 'strobe'] : ['beam', 'blinder', 'laser']));
      } },
    ];
    if (cat === 'fx') return [
      { name: 'DECK PYRO LINE', run: () => {
        state.fx = [-12, -6, 0, 6, 12].map((z) => ({ type: 'pyro', x: r2(g.frontX - 1.5), z }));
      } },
      { name: 'CONFETTI + POPPERS', run: () => {
        state.fx = [
          ...[-11, 11].map((z) => ({ type: 'confetti', x: r2(g.frontX - 1), z })),
          ...[-6, 0, 6].map((z) => ({ type: 'popper', x: r2(g.frontX - 2), z })),
        ];
      } },
      { name: 'FULL FINALE', run: () => {
        state.fx = [
          ...[-12, -4, 4, 12].map((z) => ({ type: 'pyro', x: r2(g.frontX - 1.5), z })),
          ...[-9, 9].map((z) => ({ type: 'confetti', x: r2(g.frontX - 1), z })),
          ...[-6, 6].map((z) => ({ type: 'flame', x: r2(g.frontX - 3), z })),
          ...[0].map((z) => ({ type: 'streamer', x: r2(g.frontX - 2), z })),
        ];
      } },
    ];
    if (cat === 'speaker') return [
      { name: 'MAINS + DELAY TOWERS', run: () => {
        state.speakers = [
          ...[-13.5, 13.5].map((z) => ({ type: 'main', x: r2(g.frontX + 0.5), z, y: 17, rot: null })),
          ...[-4, 4].map((z) => ({ type: 'sub', x: r2(g.frontX - 0.5), z, y: 2, rot: null })),
          ...[-12, 12].map((z) => ({ type: 'main', x: 22, z, y: 14, rot: null })),
        ];
      } },
      { name: 'L / R MAINS', run: () => {
        state.speakers = [-13.5, 13.5].map((z) => ({ type: 'main', x: r2(g.frontX + 0.5), z, y: 17, rot: null }));
      } },
      { name: 'MAINS + SUBS', run: () => {
        state.speakers = [
          ...[-13.5, 13.5].map((z) => ({ type: 'main', x: r2(g.frontX + 0.5), z, y: 17, rot: null })),
          ...[-4, 4].map((z) => ({ type: 'sub', x: r2(g.frontX - 0.5), z, y: 2, rot: null })),
        ];
      } },
    ];
    if (cat === 'barricade') return [
      { name: 'RING AROUND B-STAGE', run: () => {
        state.barricades.push({ x: r2(g.bX), z: 0, len: 6, r: 6.5, rot: 0, shape: 'ring' });
      } },
      { name: 'CURVED FRONT RAIL', run: () => {
        state.barricades = [{ x: r2(g.frontX + 9), z: 0, len: 6, r: 11, rot: Math.PI, shape: 'curve' }];
      } },
      { name: 'T-PIT DOWN THE RUNWAY', run: () => {
        state.barricades = [{ x: r2((g.frontX + g.bX) / 2), z: 0, len: Math.max(6, g.bX - g.frontX), r: 3.6, rot: 0, shape: 'tpit' }];
      } },
      { name: 'STAGE FRONT LINE', run: () => {
        state.barricades = [{ x: r2(g.frontX + 2.5), z: 0, len: 28, rot: Math.PI / 2 }];
      } },
      { name: 'FRONT + PIT WINGS', run: () => {
        state.barricades = [
          { x: r2(g.frontX + 2.5), z: 0, len: 28, rot: Math.PI / 2 },
          ...[-14, 14].map((z) => ({ x: r2(g.frontX + 8), z, len: 11, rot: 0 })),
        ];
      } },
    ];
    if (cat === 'stage') return [
      { name: 'THRUST OUT FRONT', run: () => {
        state.stages.push({ x: r2(g.frontX + 3), z: 0, w: 6, d: 6, rot: 0, h: 1.4 });
      } },
      { name: 'BAND RISERS x3', run: () => {
        state.stages = [-7, 0, 7].map((z, i) => ({ x: r2(g.frontX - 7), z, w: 4.5, d: 3.5, rot: 0, h: 0.5 + i % 2 * 0.4 }));
      } },
      { name: 'BIG CENTRE SCREEN', run: () => {
        state.screens.push({ x: r2(g.frontX - 12), z: 0, w: 18, h: 9, d: 0.4, rot: 0, y: 2.5 });
      } },
      { name: 'SCREEN WALL x3', run: () => {
        state.screens = [-9, 0, 9].map((z) => ({ x: r2(g.frontX - 12), z, w: 7.5, h: 8, d: 0.4, rot: 0, y: 2.5 }));
      } },
      { name: 'CENTRE RISER', run: () => {
        state.stages = [{ x: r2(g.frontX - 5), z: 0, w: 8, d: 4, rot: 0, h: 0.8 }];
      } },
      { name: 'DRUM + WINGS', run: () => {
        state.stages = [
          { x: r2(g.frontX - 6), z: 0, w: 6, d: 4, rot: 0, h: 1.0 },
          ...[-9, 9].map((z) => ({ x: r2(g.frontX - 4), z, w: 5, d: 3.5, rot: 0, h: 0.5 })),
        ];
      } },
      { name: 'SIDE LED WALLS', run: () => {
        state.screens = [-11, 11].map((z) => ({ x: r2(g.frontX - 2), z, w: 7, h: 5, d: 0.4, rot: Math.PI / 2, y: 4 }));
      } },
    ];
    return [];
  }

  const FULL_RIGS = [
    { name: 'STADIUM POP', run: () => {
      const g = geom;
      state.trusses = [trussRow(g.frontX - 2, 30, 16), trussRow(g.frontX - 9, 28, 16),
        { x: r2(g.bX), z: 0, len: 12, r: 6.5, rot: 0, y: 13, shape: 'circle' }];
      state.fixtures = state.trusses.flatMap((t, i) => fillTruss(t, i === 2 ? ['spot'] : ['spot', 'beam', 'wash']));
      state.screens = [{ x: r2(g.frontX - 12), z: 0, w: 20, h: 9, d: 0.4, rot: 0, y: 2.5 },
        ...[-13, 13].map((z) => ({ x: r2(g.frontX - 3), z, w: 7, h: 5, d: 0.4, rot: Math.PI / 2, y: 4 }))];
      state.fx = [...[-12, -4, 4, 12].map((z) => ({ type: 'pyro', x: r2(g.frontX - 1.5), z })),
        ...[-10, 10].map((z) => ({ type: 'confetti', x: r2(g.frontX - 1), z }))];
      state.speakers = [...[-14, 14].map((z) => ({ type: 'main', x: r2(g.frontX + 0.5), z, y: 17, rot: null })),
        ...[-4, 4].map((z) => ({ type: 'sub', x: r2(g.frontX - 0.5), z, y: 2, rot: null }))];
      state.barricades = [{ x: r2(g.frontX + 9), z: 0, len: 6, r: 11, rot: Math.PI, shape: 'curve' },
        { x: r2(g.bX), z: 0, len: 6, r: 6.5, rot: 0, shape: 'ring' }];
      state.stages = [{ x: r2(g.frontX - 7), z: 0, w: 8, d: 4.5, rot: 0, h: 1.2 }];
    } },
    { name: 'IN THE ROUND', run: () => {
      const g = geom;
      state.trusses = [
        { x: 0, z: 0, len: 12, r: 11, rot: 0, y: 15, shape: 'circle' },
        { x: 0, z: 0, len: 12, r: 7, rot: 0, y: 17, shape: 'circle' },
        { x: 0, z: 0, len: 12, r: 14, rot: 0, y: 13, shape: 'square' },
      ];
      state.fixtures = state.trusses.flatMap((t) => {
        const out = [];
        const n = t.shape === 'square' ? 16 : 20;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          out.push({ type: i % 2 ? 'beam' : 'spot', x: r2(Math.cos(a) * t.r), z: r2(Math.sin(a) * t.r), y: t.y, rot: null });
        }
        return out;
      });
      state.fx = [0, 1, 2, 3].map((i) => { const a = i / 4 * TAU + 0.4; return { type: 'confetti', x: r2(Math.cos(a) * 8), z: r2(Math.sin(a) * 8) }; });
      state.speakers = [0, 1, 2, 3].map((i) => { const a = i / 4 * TAU; return { type: 'main', x: r2(Math.cos(a) * 9), z: r2(Math.sin(a) * 9), y: 16, rot: null }; });
      state.barricades = [{ x: 0, z: 0, len: 6, r: 9, rot: 0, shape: 'ring' }];
      state.stages = [{ x: 0, z: 0, w: 12, d: 12, rot: 0, h: 1.4 }];
      state.screens = [];
    } },
    { name: 'CLASSIC ARENA', run: () => {
      const g = geom;
      state.trusses = [trussRow(g.frontX - 2, 26, 15.4), trussRow(g.frontX - 8, 24, 15.4), trussRow(g.frontX - 14, 22, 15.4)];
      state.fixtures = state.trusses.flatMap((t, i) => fillTruss(t, i === 0 ? ['spot', 'beam'] : i === 1 ? ['wash', 'beam'] : ['beam', 'strobe']));
      state.fx = [...[-11, 11].map((z) => ({ type: 'confetti', x: r2(g.frontX - 1), z })),
        ...[-6, 0, 6].map((z) => ({ type: 'pyro', x: r2(g.frontX - 1.5), z }))];
      state.speakers = [...[-13.5, 13.5].map((z) => ({ type: 'main', x: r2(g.frontX + 0.5), z, y: 17, rot: null })),
        ...[-4, 4].map((z) => ({ type: 'sub', x: r2(g.frontX - 0.5), z, y: 2, rot: null }))];
      state.barricades = [{ x: r2(g.frontX + 2.5), z: 0, len: 28, rot: Math.PI / 2 }];
      state.stages = [{ x: r2(g.frontX - 6), z: 0, w: 7, d: 4, rot: 0, h: 0.9 }];
      state.screens = [];
    } },
    { name: 'FESTIVAL WRAP', run: () => {
      const g = geom;
      state.trusses = [-1, -5, -9, -13, -17].map((d, i) => trussRow(g.frontX + d, 28 - i * 1.5, 15.4));
      state.fixtures = state.trusses.flatMap((t, i) => fillTruss(t, ['beam', 'wash', 'spot', 'strobe'].slice(i % 2, i % 2 + 2)));
      state.fx = [...[-13, -5, 5, 13].map((z) => ({ type: 'pyro', x: r2(g.frontX - 1.5), z })),
        ...[-9, 9].map((z) => ({ type: 'flame', x: r2(g.frontX - 3), z })),
        ...[-11, 11].map((z) => ({ type: 'confetti', x: r2(g.frontX - 1), z }))];
      state.speakers = [...[-14, 14].map((z) => ({ type: 'main', x: r2(g.frontX + 0.5), z, y: 17, rot: null })),
        ...[-5, 5].map((z) => ({ type: 'sub', x: r2(g.frontX - 0.5), z, y: 2, rot: null }))];
      state.barricades = [{ x: r2(g.frontX + 3), z: 0, len: 30, rot: Math.PI / 2 },
        ...[-15, 15].map((z) => ({ x: r2(g.frontX + 9), z, len: 12, rot: 0 }))];
      state.screens = [-12, 12].map((z) => ({ x: r2(g.frontX - 2), z, w: 8, h: 5.5, d: 0.4, rot: Math.PI / 2, y: 4.5 }));
      state.stages = [{ x: r2(g.frontX - 7), z: 0, w: 8, d: 4.5, rot: 0, h: 1.2 }];
    } },
    { name: 'MINIMAL CLUB', run: () => {
      const g = geom;
      state.trusses = [trussRow(g.frontX - 3, 18, 12), trussRow(g.frontX - 10, 16, 12)];
      state.fixtures = state.trusses.flatMap((t) => fillTruss(t, ['spot', 'wash']));
      state.fx = [{ type: 'confetti', x: r2(g.frontX - 1), z: 0 }];
      state.speakers = [-9, 9].map((z) => ({ type: 'main', x: r2(g.frontX + 0.5), z, y: 14, rot: null }));
      state.barricades = [{ x: r2(g.frontX + 2.5), z: 0, len: 18, rot: Math.PI / 2 }];
      state.stages = []; state.screens = [];
    } },
  ];

  // ============================ MODALS =====================================
  function openModal(html) {
    el.win.innerHTML = html;
    el.modal.classList.add('open');
  }
  function closeModal() { el.modal.classList.remove('open'); }
  el.modal.addEventListener('pointerdown', (e) => { if (e.target === el.modal) closeModal(); });

  function openPresets(cat) {
    const sets = presetSets(cat);
    const label = (PALETTE.find((p) => p.key === cat) || {}).name || cat.toUpperCase();
    openModal(`<h3>${label} PRESETS</h3><div class="sub">DROPS A READY-MADE SET INTO THE PLAN</div>
      <div class="rdOpts" id="rdPs">${sets.map((s, i) => `<button data-i="${i}">${s.name}</button>`).join('')}</div>`);
    el.win.querySelectorAll('#rdPs button').forEach((b) => {
      b.onclick = () => {
        sets[+b.dataset.i].run();
        select(null); closeModal(); invalidate();
        toast('PRESET APPLIED');
      };
    });
  }

  function openFullPresets() {
    openModal(`<h3>FULL RIG PRESETS</h3><div class="sub">A COMPLETE PACKAGE FOR THIS ROOM</div>
      <div class="rdOpts" id="rdFp">${FULL_RIGS.map((s, i) => `<button data-i="${i}">${s.name}</button>`).join('')}</div>
      <h4>OR BY CATEGORY</h4>
      <div class="rdOpts" id="rdCp">${PALETTE.map((p) => `<button data-c="${p.key}">${p.name}</button>`).join('')}</div>`);
    el.win.querySelectorAll('#rdFp button').forEach((b) => {
      b.onclick = () => { FULL_RIGS[+b.dataset.i].run(); select(null); closeModal(); invalidate(); toast('FULL RIG APPLIED'); };
    });
    el.win.querySelectorAll('#rdCp button').forEach((b) => { b.onclick = () => openPresets(b.dataset.c); });
  }

  // --- storage --------------------------------------------------------------
  function readStore() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
  }
  function writeStore(o) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(o)); return true; } catch { return false; }
  }

  // a tiny top-down thumbnail so saved rigs are recognisable at a glance
  function thumb(plan, c) {
    const g = c.getContext('2d');
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const s = Math.min(W / ((BOWL_A + 4) * 2), H / ((BOWL_B + 4) * 2));
    g.save(); g.translate(W / 2, H / 2); g.scale(s, s);
    g.strokeStyle = '#ffffff22'; g.lineWidth = 1 / s;
    g.beginPath(); rrPath(g, BOWL_A, BOWL_B, BOWL_R); g.stroke();
    g.strokeStyle = GOLD; g.lineWidth = 1.6 / s;
    for (const t of plan.trusses || []) {
      const rot = t.rot != null ? t.rot : axisToRot(t.axis);
      const e = segEnds({ x: t.x, z: t.z, len: t.len, rot });
      g.beginPath(); g.moveTo(e.ax, e.az); g.lineTo(e.bx, e.bz); g.stroke();
    }
    g.fillStyle = CYAN;
    for (const f of plan.fixtures || []) { g.beginPath(); g.arc(f.x, f.z, 0.7, 0, TAU); g.fill(); }
    g.fillStyle = '#ff8ad0';
    for (const f of plan.fx || []) { g.beginPath(); g.arc(f.x, f.z, 0.9, 0, TAU); g.fill(); }
    g.restore();
  }

  function openLibrary() {
    const store = readStore();
    const names = Object.keys(store);
    openModal(`<h3>YOUR RIGS</h3><div class="sub">OPEN ONE TO KEEP WORKING ON IT</div>
      <div id="rdList">${names.length ? '' : '<div class="rdEmpty">NOTHING SAVED YET</div>'}</div>
      <div class="rdRow">
        <button class="rdBtn" id="rdImport">IMPORT A FILE</button>
        <button class="rdBtn" id="rdExport">EXPORT CURRENT</button>
      </div>`);
    const list = el.win.querySelector('#rdList');
    for (const nm of names) {
      const p = store[nm];
      const row = document.createElement('div');
      row.className = 'rdPlan';
      row.innerHTML = `<canvas width="124" height="80" style="width:62px;height:40px"></canvas>
        <div class="info"><b></b><span>${(p.trusses || []).length} TRUSS · ${(p.fixtures || []).length} FIXTURES · ${(p.fx || []).length} FX</span></div>
        <button class="rm">DELETE</button>`;
      row.querySelector('b').textContent = nm;
      thumb(p, row.querySelector('canvas'));
      row.onclick = (e) => {
        if (e.target.classList.contains('rm')) {
          e.stopPropagation();
          delete store[nm]; writeStore(store); openLibrary();
          toast('DELETED');
          return;
        }
        loadPlan(p); closeModal(); toast(`OPENED · ${nm.toUpperCase()}`);
      };
      list.appendChild(row);
    }
    el.win.querySelector('#rdImport').onclick = () => fileInput.click();
    el.win.querySelector('#rdExport').onclick = () => {
      const blob = new Blob([JSON.stringify(toPlan(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${state.name.replace(/[^\w -]/g, '') || 'rig'}.rigplan.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('EXPORTED');
    };
  }

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.style.display = 'none';
  root.appendChild(fileInput);
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try { loadPlan(JSON.parse(rd.result)); closeModal(); toast(`IMPORTED · ${state.name.toUpperCase()}`); }
      catch { toast('IMPORT FAILED · BAD JSON'); }
    };
    rd.onerror = () => toast('IMPORT FAILED');
    rd.readAsText(f);
  });

  function openSave() {
    openModal(`<h3>SAVE THIS RIG</h3><div class="sub">STORED IN THIS BROWSER · REOPEN FROM "OPEN"</div>
      <input type="text" id="rdName" maxlength="42" placeholder="Rig name">
      <button class="go" id="rdDoSave">SAVE</button>`);
    const inp = el.win.querySelector('#rdName');
    inp.value = state.name;
    inp.focus(); inp.select();
    const go = () => {
      const nm = inp.value.trim() || 'Untitled Rig';
      state.name = nm;
      const store = readStore();
      store[nm] = toPlan();
      if (writeStore(store)) { closeModal(); toast(`SAVED · ${nm.toUpperCase()}`); }
      else toast('SAVE FAILED · STORAGE FULL');
    };
    el.win.querySelector('#rdDoSave').onclick = go;
    inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  }

  // --- venue picker ---------------------------------------------------------
  const VENUE_OPTS = {
    curtains: [['full', 'FULL ARENA'], ['large', 'LARGE'], ['medium', 'MEDIUM']],
    catwalk: [['none', 'NONE'], ['standard', '14 M'], ['long', '22 M']],
    bstage: [['none', 'NONE'], ['circle', 'CIRCLE'], ['square', 'SQUARE'], ['x', 'X'], ['heart', 'HEART']],
  };
  function openVenue(first) {
    const grp = (key, label) => `<h4>${label}</h4><div class="rdOpts" data-k="${key}">${
      VENUE_OPTS[key].map(([v, n]) => `<button data-v="${v}" class="${state.venue[key] === v ? 'sel' : ''}">${n}</button>`).join('')}</div>`;
    openModal(`<h3>CREATE YOUR RIG</h3><div class="sub">PICK THE ROOM · EVERYTHING IS EDITABLE LATER</div>
      ${grp('curtains', 'ROOM SIZE')}${grp('catwalk', 'CATWALK')}${grp('bstage', 'B-STAGE')}
      <button class="go" id="rdVenueGo">${first ? 'START DESIGNING →' : 'APPLY'}</button>`);
    el.win.querySelectorAll('.rdOpts').forEach((row) => {
      row.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          state.venue[row.dataset.k] = b.dataset.v;
          row.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
        };
      });
    });
    el.win.querySelector('#rdVenueGo').onclick = () => {
      rebuildGeom(); paintVenueChip(); closeModal();
      if (first) { everStarted = true; fitView(); goStep(1); }   // straight into hanging steel
      else buildPalette();
      invalidate();
    };
  }
  function paintVenueChip() {
    const v = state.venue;
    el.venueChip.textContent = `${v.curtains.toUpperCase()} · CAT ${v.catwalk === 'none' ? 'NONE' : v.catwalk === 'long' ? '22M' : '14M'} · B ${v.bstage.toUpperCase()}`;
  }

  // ============================ PLAN I/O ===================================
  function toPlan() {
    const seg = (it) => ({ x: r2(it.x), z: r2(it.z), len: r2(it.len), rot: r2(it.rot),
      axis: rotToAxis(it.rot), shape: it.shape || 'straight', r: r2(it.r || 0) });
    return {
      name: state.name,
      version: 2,
      venue: { ...state.venue, position: 'far', farSize: 'default' },
      trusses: state.trusses.map((t) => ({ ...seg(t), y: r2(t.y) })),
      fixtures: state.fixtures.map((f) => ({
        type: f.type, x: r2(f.x), z: r2(f.z), y: r2(f.y),
        rot: f.rot == null ? null : r2(f.rot), aim: null,
      })),
      fx: state.fx.map((f) => ({ type: f.type, x: r2(f.x), z: r2(f.z) })),
      speakers: state.speakers.map((s) => ({
        type: s.type, x: r2(s.x), z: r2(s.z), y: r2(s.y), rot: s.rot == null ? null : r2(s.rot),
      })),
      barricades: state.barricades.map(seg),
      stages: state.stages.map((s) => ({
        x: r2(s.x), z: r2(s.z), w: r2(s.w), d: r2(s.d), rot: r2(s.rot), h: r2(s.h),
      })),
      screens: state.screens.map((s) => ({
        x: r2(s.x), z: r2(s.z), w: r2(s.w), h: r2(s.h), rot: r2(s.rot), y: r2(s.y),
      })),
    };
  }

  function loadPlan(plan) {
    if (!plan || typeof plan !== 'object') { toast('NOT A RIG PLAN'); return; }
    const arr = (v) => (Array.isArray(v) ? v : []);
    const num = (v, d) => (Number.isFinite(+v) ? +v : d);
    const rotOf = (it) => (Number.isFinite(+it.rot) ? +it.rot : axisToRot(it.axis));
    state.name = typeof plan.name === 'string' && plan.name ? plan.name : 'Untitled Rig';
    const v = plan.venue || {};
    state.venue = {
      curtains: ['full', 'large', 'medium'].includes(v.curtains) ? v.curtains : 'full',
      position: 'far',
      catwalk: ['none', 'standard', 'long'].includes(v.catwalk) ? v.catwalk : 'standard',
      bstage: ['none', 'circle', 'square', 'x', 'heart'].includes(v.bstage) ? v.bstage : 'circle',
      farSize: 'default',
    };
    state.trusses = arr(plan.trusses).map((t) => ({
      x: num(t.x, 0), z: num(t.z, 0), len: Math.max(1, num(t.len, 12)),
      rot: rotOf(t), y: clamp(num(t.y, DEF_TRUSS_Y), TRUSS_Y_MIN, TRUSS_Y_MAX),
      shape: TRUSS_SHAPES.includes(t.shape) ? t.shape : 'straight', r: Math.max(1, num(t.r, 6)),
    }));
    state.fixtures = arr(plan.fixtures).map((f) => ({
      type: FIXTURE_TYPES.includes(f.type) ? f.type : 'spot',
      x: num(f.x, 0), z: num(f.z, 0), y: clamp(num(f.y, DEF_TRUSS_Y), 0, TRUSS_Y_MAX),
      rot: Number.isFinite(+f.rot) ? +f.rot : null,
    }));
    state.fx = arr(plan.fx).map((f) => ({
      type: FX_TYPES.includes(f.type) ? f.type : 'confetti', x: num(f.x, 0), z: num(f.z, 0),
    }));
    state.speakers = arr(plan.speakers).map((s) => ({
      type: s.type === 'sub' ? 'sub' : 'main', x: num(s.x, 0), z: num(s.z, 0),
      y: clamp(num(s.y, s.type === 'sub' ? 2 : 17), 0, TRUSS_Y_MAX),
      rot: Number.isFinite(+s.rot) ? +s.rot : null,
    }));
    state.barricades = arr(plan.barricades).map((b) => ({
      x: num(b.x, 0), z: num(b.z, 0), len: Math.max(1, num(b.len, 6)), rot: rotOf(b),
      shape: BARRICADE_SHAPES.includes(b.shape) ? b.shape : 'straight', r: Math.max(1, num(b.r, 6)),
    }));
    state.stages = arr(plan.stages).map((s) => ({
      x: num(s.x, 0), z: num(s.z, 0), w: Math.max(1, num(s.w, 8)), d: Math.max(1, num(s.d, 4)),
      rot: num(s.rot, 0), h: clamp(num(s.h, 1), 0.2, 20),
    }));
    state.screens = arr(plan.screens).map((s) => ({
      x: num(s.x, 0), z: num(s.z, 0), w: Math.max(1, num(s.w, 8)), h: Math.max(1, num(s.h, 4.5)),
      d: 0.4, rot: num(s.rot, 0), y: clamp(num(s.y, 3), 0, 30),
    }));
    select(null);
    rebuildGeom();
    paintVenueChip();
    everStarted = true;
    fitView();
    invalidate();
  }

  // ============================ TOP BAR ====================================
  el.snap.onclick = () => setSnap(!snapOn);
  root.querySelector('#rdPresets').onclick = openFullPresets;
  root.querySelector('#rdOpen').onclick = openLibrary;
  root.querySelector('#rdSave').onclick = openSave;
  el.venueChip.onclick = () => openVenue(false);
  root.querySelector('#rdClose').onclick = () => close();
  root.querySelector('#rdUse').onclick = () => {
    const p = toPlan();
    if (!p.trusses.length && !p.fixtures.length && !p.stages.length && !p.screens.length) {
      toast('ADD SOMETHING FIRST');
      return;
    }
    const store = readStore();
    store[state.name] = p;
    writeStore(store);
    close();
    onUse && onUse(p);
  };

  buildPalette();
  paintLayers();
  paintVenueChip();
  setHint();
  setSnap(true);

  // ============================ OPEN / CLOSE ===============================
  function open(plan) {
    root.classList.add('open');
    isOpen = true;
    if (plan) loadPlan(plan);
    requestAnimationFrame(() => {
      resizeCanvas();
      if (!everStarted) { fitView(); openVenue(true); }
      draw();
    });
  }
  function close() {
    root.classList.remove('open');
    isOpen = false;
    disarm();
    closeModal();
  }

  return { open, close, loadPlan, toPlan };
}
