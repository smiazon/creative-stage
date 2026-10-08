// Set dressing — non-performing objects that make the room read as a real
// production: the front-of-house control island (lighting + audio desks) and
// a big national-flag banner flown from the house steel.
//
// Both builders are parented to the SCENE in WORLD coordinates (never the
// show-rig group, which stage configs translate and x-scale). Everything is
// static geometry; the only runtime work is initFlag's canvas redraw when the
// flag country code changes.
//
// Materials follow the house rules: MeshBasicMaterial for anything that
// emits (desk button panels, monitors), MeshLambertMaterial for matte parts.
// Bloom gates on max(r,g,b) > 1.25 — the hot desk buttons peak ~1.4-1.6 so a
// few of them bloom, the monitors sit ~1.3 (barely over), the flag cloth is
// self-lit at 0.9 (never blooms), and rack LEDs stay well under the gate.
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const ROOF_Y = 38.5;                       // house steel

// deterministic PRNG (same recipe as textures.js) so FOH looks identical
// every visit
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

function canvasTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// FOH textures
// ---------------------------------------------------------------------------
// Angled control-surface face. Canvas u = desk depth (0.56 m), v = desk
// length (1.5 m). Drawn dark with saturated button dots; the material colour
// multiplier (1.6) is what pushes the HOT buttons to ~1.4-1.6 so they bloom,
// while dim buttons (drawn at low lightness) stay far under the gate.
function makeDeskPanel(kind) {
  const W = 256, H = 1024;
  const rand = mulberry32(kind === 'audio' ? 2024 : 4077);
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#0a0b0f';
  ctx.fillRect(0, 0, W, H);
  // module seams
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 3;
  for (let y = 0; y <= H; y += 128) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(90,95,110,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, W - 12, H - 12);

  const hues = kind === 'audio' ? [200, 160, 45, 0] : [0, 30, 120, 200, 280, 320];
  // button grid (lighting desk gets the bigger grid, audio a narrower one)
  const bx1 = kind === 'audio' ? 96 : 140;
  for (let y = 24; y < H - 20; y += 26) {
    for (let x = 22; x < bx1; x += 24) {
      const h = hues[(rand() * hues.length) | 0];
      const hot = rand() < 0.16;
      // hot: ~0.9 canvas value * 1.6 material = ~1.45 -> blooms
      // dim: ~0.5 canvas value * 1.6 material = ~0.8 -> matte glow
      ctx.fillStyle = hot ? `hsl(${h},100%,62%)` : `hsl(${h},85%,${20 + rand() * 8}%)`;
      ctx.beginPath();
      ctx.arc(x, y, hot ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // fader bank: slots run along the desk depth (u), caps parked at random
  const fx0 = bx1 + 18, fLen = W - fx0 - 22;
  const step = kind === 'audio' ? 34 : 58;
  for (let y = 30; y < H - 24; y += step) {
    ctx.fillStyle = '#000';
    ctx.fillRect(fx0, y - 2, fLen, 4);
    ctx.fillStyle = '#383b44';
    ctx.fillRect(fx0 + rand() * (fLen - 12), y - 9, 12, 18);
    ctx.fillStyle = 'rgba(120,126,140,0.5)';
    ctx.fillRect(fx0 + 2, y - 1, fLen - 4, 1);
  }
  // a couple of small amber readouts (0.75 * 1.6 = 1.2, just under the gate)
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = 'rgb(190,120,30)';
    ctx.fillRect(20 + rand() * 60, 40 + rand() * (H - 110), 46, 14);
  }
  return canvasTexture(c);
}

// Small production monitor: dark UI with blueish rows and a bright header.
// Material colour ~(0.95,1.15,1.35): the near-white pixels land ~1.3.
function makeMonitorFace() {
  const rand = mulberry32(808);
  const W = 256, H = 160;
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#050a12';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#12293e';
  ctx.fillRect(0, 0, W, 20);
  ctx.fillStyle = '#dff2ff';
  ctx.fillRect(8, 7, 60, 6);
  // cue-list rows
  for (let y = 30; y < H - 34; y += 14) {
    ctx.fillStyle = rand() < 0.25 ? '#9fd0f0' : '#1c4a72';
    ctx.fillRect(8, y, 40 + rand() * 150, 7);
  }
  // meter strip along the bottom
  for (let x = 8; x < W - 8; x += 12) {
    const v = rand();
    ctx.fillStyle = v > 0.8 ? '#eafaff' : '#2e7fae';
    ctx.fillRect(x, H - 10 - v * 22, 8, 4 + v * 22);
  }
  return canvasTexture(c);
}

// 19-inch rack faceplate: unit seams + faint green/amber LEDs (all < 1.0,
// material multiplier 1.0 -> never blooms).
function makeRackFace() {
  const rand = mulberry32(1919);
  const W = 128, H = 256;
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#0a0b0d';
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 24) {
    ctx.fillStyle = '#101216';
    ctx.fillRect(4, y + 2, W - 8, 20);
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeRect(4, y + 2, W - 8, 20);
    // rack-ear screws
    ctx.fillStyle = '#23262c';
    ctx.fillRect(7, y + 9, 4, 4);
    ctx.fillRect(W - 11, y + 9, 4, 4);
    // LEDs
    const n = 2 + (rand() * 5) | 0;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = rand() < 0.75 ? 'rgb(60,205,110)' : 'rgb(215,150,40)';
      ctx.beginPath();
      ctx.arc(22 + i * 10, y + 12, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvasTexture(c);
}

// ---------------------------------------------------------------------------
// 1. FOH CONSOLES
//
// Footprint ~4.6 m (z) x 3.2 m (x), centred on the group origin, operators on
// the +x side facing the stage at -x. Two desks side by side (lighting z<0,
// audio z>0), a rack beside the audio desk, two stools. All matte geometry is
// merged into ONE Lambert mesh; the emitting faces are 4 more meshes — 5 draw
// calls total.
// ---------------------------------------------------------------------------
export function buildFOH(scene) {
  const group = new THREE.Group();
  group.name = 'foh';

  const TILT = (18 * Math.PI) / 180;         // control-surface rake
  const nx = Math.sin(TILT), ny = Math.cos(TILT);   // tilted-face normal
  const DESKS = [
    { z: -1.32, kind: 'lighting' },
    { z: 0.66, kind: 'audio' },
  ];
  const RACK_Z = 1.98;

  const matte = new THREE.MeshLambertMaterial({ color: 0x24262b });   // dark grey furniture
  const geos = [];
  const box = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    geos.push(g);
  };
  const cyl = (r, h, x, y, z, seg = 12) => {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    g.translate(x, y, z);
    geos.push(g);
  };

  const screenGeos = [];
  for (const d of DESKS) {
    // table: top at y 0.85, four legs, modesty panel on the stage side
    box(0.9, 0.05, 1.9, 0, 0.825, d.z);
    for (const sx of [-0.38, 0.38]) {
      for (const sz of [-0.86, 0.86]) box(0.05, 0.8, 0.05, sx, 0.4, d.z + sz);
    }
    box(0.02, 0.55, 1.7, -0.42, 0.52, d.z);

    // angled control-surface body (the glowing face is a separate plane)
    {
      const g = new THREE.BoxGeometry(0.62, 0.07, 1.6);
      g.rotateZ(-TILT);                      // top tips up toward the operator (+x)
      g.translate(0.02, 0.94, d.z);
      geos.push(g);
    }

    // two monitors on stands along the upstage edge of the desk
    for (const mz of [d.z - 0.42, d.z + 0.42]) {
      box(0.05, 0.34, 0.56, -0.33, 1.14, mz);        // bezel
      box(0.05, 0.2, 0.08, -0.33, 0.94, mz);         // stand
      box(0.18, 0.02, 0.26, -0.32, 0.86, mz);        // foot
      const s = new THREE.PlaneGeometry(0.5, 0.3);   // 0.5 x 0.3 screen
      s.rotateY(Math.PI / 2);                        // faces +x, at the operator
      s.translate(-0.302, 1.14, mz);
      screenGeos.push(s);
    }

    // stool behind the desk
    cyl(0.17, 0.05, 0.85, 0.66, d.z);
    cyl(0.03, 0.55, 0.85, 0.38, d.z, 8);
    cyl(0.19, 0.03, 0.85, 0.1, d.z, 12);
  }

  // 19-inch rack beside the audio desk (0.6 wide, 1.4 tall, 0.7 deep)
  box(0.7, 1.4, 0.6, 0, 0.7, RACK_Z);

  const struct = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(geos), matte);
  struct.matrixAutoUpdate = false;
  group.add(struct);

  // glowing desk faces — one per desk so lighting/audio read differently
  for (const d of DESKS) {
    const g = new THREE.PlaneGeometry(0.56, 1.5);
    g.rotateX(-Math.PI / 2);                 // face up (u = depth, v = length)
    g.rotateZ(-TILT);
    g.translate(0.02 + nx * 0.04, 0.94 + ny * 0.04, d.z);
    const m = new THREE.MeshBasicMaterial({ map: makeDeskPanel(d.kind) });
    m.color.setScalar(1.6);                  // hot buttons -> ~1.45, over the gate
    group.add(new THREE.Mesh(g, m));
  }

  // monitors: all four screens share one face texture, merged to one mesh
  {
    const m = new THREE.MeshBasicMaterial({ map: makeMonitorFace() });
    m.color.setRGB(0.95, 1.15, 1.35);        // blueish, brightest pixels ~1.3
    group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(screenGeos), m));
  }

  // rack front: faint LEDs, stays matte
  {
    const g = new THREE.PlaneGeometry(0.56, 1.32);
    g.rotateY(Math.PI / 2);
    g.translate(0.352, 0.72, RACK_Z);
    group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: makeRackFace() })));
  }

  function setPosition(x, z) {
    group.position.set(x, 0, z);             // rotation fixed: always faces -x
  }

  scene.add(group);
  return { group, setPosition };
}

// ---------------------------------------------------------------------------
// 2. CEILING FLAG — drawn flags
//
// Every flag is painted full-bleed onto the cloth canvas with plain canvas
// primitives (rects, paths, arcs) so the artwork is identical on every
// platform (no emoji font dependency). All colours are ordinary 8-bit canvas
// values (<= 1.0 in linear terms) and the cloth material multiplies by 0.9,
// so the flag never crosses the 1.25 bloom gate.
// ---------------------------------------------------------------------------

// filled 5-point star, point-up, outer radius r
function star(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.382 : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

// 11-point maple-leaf silhouette traced as one polygon in a 0..100 box
// (y down, symmetric about x=50, stem at the bottom)
const MAPLE = [
  [50, 0], [55, 13], [63, 9], [60, 22], [74, 15], [71, 25], [86, 22],
  [80, 36], [100, 32], [94, 44], [100, 52], [82, 60], [86, 72], [58, 64],
  [53, 100], [47, 100], [42, 64], [14, 72], [18, 60], [0, 52], [6, 44],
  [0, 32], [20, 36], [14, 22], [29, 25], [26, 15], [40, 22], [37, 9],
  [45, 13],
];

// FLAGS: lowercase country code -> draw(ctx, w, h), painting the full canvas
const FLAGS = {
  ca(ctx, w, h) {
    ctx.fillStyle = '#d52b1e';
    ctx.fillRect(0, 0, w, h);                // red field (both outer bands)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(w / 4, 0, w / 2, h);        // white centre band (1:2:1)
    // maple leaf: ~60% of band height, centred in the white band
    const leafH = 0.6 * h;
    const sy = leafH / 100, sx = sy * 0.92;  // slightly slimmer than tall
    const y0 = (h - leafH) / 2;
    ctx.fillStyle = '#d52b1e';
    ctx.beginPath();
    MAPLE.forEach(([px, py], i) => {
      const x = w / 2 + (px - 50) * sx, y = y0 + py * sy;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  },

  us(ctx, w, h) {
    const sh = h / 13;
    for (let i = 0; i < 13; i++) {           // 13 stripes, red first
      ctx.fillStyle = i % 2 ? '#ffffff' : '#b22234';
      ctx.fillRect(0, i * sh, w, sh + 1);
    }
    const cw = 0.4 * w, ch = 7 * sh;         // canton: 7 stripes tall, 40% wide
    ctx.fillStyle = '#3c3b6e';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#ffffff';
    const r = ch / 22;
    for (let row = 0; row < 9; row++) {      // 9 offset rows: 6,5,6,5...
      const six = row % 2 === 0;
      const n = six ? 6 : 5;
      for (let i = 0; i < n; i++) {
        const cx = ((i + (six ? 0.5 : 1)) * cw) / 6;
        star(ctx, cx, ((row + 1) * ch) / 10, r);
      }
    }
  },

  gb(ctx, w, h) {
    ctx.fillStyle = '#012169';
    ctx.fillRect(0, 0, w, h);
    // white diagonals (St Andrew), thick
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = h / 5;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(w, h);
    ctx.moveTo(w, 0); ctx.lineTo(0, h);
    ctx.stroke();
    // red diagonals (St Patrick), thin, offset per quadrant (counterclockwise)
    ctx.strokeStyle = '#c8102e';
    ctx.lineWidth = h / 15;
    const o = h / 22;
    ctx.beginPath();
    ctx.moveTo(0, o); ctx.lineTo(w / 2, h / 2 + o);          // TL half, low side
    ctx.moveTo(w / 2, h / 2 - o); ctx.lineTo(w, h - o);      // BR half, high side
    ctx.moveTo(w, o); ctx.lineTo(w / 2, h / 2 + o);          // TR half, low side
    ctx.moveTo(w / 2, h / 2 - o); ctx.lineTo(0, h - o);      // BL half, high side
    ctx.stroke();
    // white cross (St George fimbriation) then red cross on top
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(w / 2 - h / 6, 0, h / 3, h);
    ctx.fillRect(0, h / 2 - h / 6, w, h / 3);
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(w / 2 - h / 10, 0, h / 5, h);
    ctx.fillRect(0, h / 2 - h / 10, w, h / 5);
  },

  fr(ctx, w, h) {
    ctx.fillStyle = '#002395'; ctx.fillRect(0, 0, w / 3, h);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(w / 3, 0, w / 3, h);
    ctx.fillStyle = '#ed2939'; ctx.fillRect((2 * w) / 3, 0, w / 3 + 1, h);
  },

  de(ctx, w, h) {
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h / 3);
    ctx.fillStyle = '#dd0000'; ctx.fillRect(0, h / 3, w, h / 3);
    ctx.fillStyle = '#ffce00'; ctx.fillRect(0, (2 * h) / 3, w, h / 3 + 1);
  },

  jp(ctx, w, h) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#bc002d';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, (0.6 * h) / 2, 0, Math.PI * 2);    // disc d = 3/5 h
    ctx.fill();
  },

  se(ctx, w, h) {
    ctx.fillStyle = '#006aa7';
    ctx.fillRect(0, 0, w, h);
    const t = h / 5, vx = (5 * w) / 16;      // bar thickness; vertical at 5/16 w
    ctx.fillStyle = '#fecc00';
    ctx.fillRect(vx - t / 2, 0, t, h);
    ctx.fillRect(0, h / 2 - t / 2, w, t);
  },

  br(ctx, w, h) {
    ctx.fillStyle = '#009739';
    ctx.fillRect(0, 0, w, h);
    // yellow rhombus, points at edge midpoints inset ~8%
    const ix = 0.08 * w, iy = 0.08 * h;
    ctx.fillStyle = '#fedd00';
    ctx.beginPath();
    ctx.moveTo(ix, h / 2);
    ctx.lineTo(w / 2, iy);
    ctx.lineTo(w - ix, h / 2);
    ctx.lineTo(w / 2, h - iy);
    ctx.closePath();
    ctx.fill();
    // blue circle with a white band arcing across it
    const r = 0.25 * h, cx = w / 2, cy = h / 2;
    ctx.fillStyle = '#012169';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = r * 0.18;
    ctx.beginPath();
    ctx.arc(cx - r * 0.2, cy + r * 2.2, r * 2.35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },

  mx(ctx, w, h) {
    ctx.fillStyle = '#006341'; ctx.fillRect(0, 0, w / 3, h);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(w / 3, 0, w / 3, h);
    ctx.fillStyle = '#c8102e'; ctx.fillRect((2 * w) / 3, 0, w / 3 + 1, h);
    // stylised eagle emblem: brown body over a green laurel arc
    const cx = w / 2, cy = h / 2, r = 0.1 * h;
    ctx.strokeStyle = '#006341';
    ctx.lineWidth = 0.022 * h;
    ctx.beginPath();
    ctx.arc(cx, cy + 0.03 * h, r * 1.25, Math.PI * 0.12, Math.PI * 0.88);
    ctx.stroke();
    ctx.fillStyle = '#6b4423';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 0.01 * h, r * 0.75, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();                          // head/beak hint, offset right
    ctx.ellipse(cx + r * 0.55, cy - r * 0.85, r * 0.32, r * 0.24, -0.4, 0, Math.PI * 2);
    ctx.fill();
  },
};

// available flags, in display order
export const FLAG_CODES = ['ca', 'us', 'gb', 'fr', 'de', 'jp', 'se', 'br', 'mx'];

// ---------------------------------------------------------------------------
// A 9 x 5.4 m national-flag banner at x=14, z=0 (clear of the centre
// scoreboard): two cables drop from the house steel to a horizontal batten at
// y=26, the cloth hangs below it with a gentle static sine wave. The flag art
// comes from the FLAGS table above, painted full-bleed onto the cloth canvas.
// Cloth is MeshBasicMaterial at 0.9 (self-lit, under the bloom gate) and
// DoubleSided, so the reverse shows the mirror image exactly like real
// bunting.
// ---------------------------------------------------------------------------
export function initFlag(scene) {
  const group = new THREE.Group();
  group.name = 'ceilingFlag';
  group.visible = false;

  const FX = 14, BATTEN_Y = 26;
  const FLAG_W = 9, FLAG_H = 5.4;
  const steel = new THREE.MeshLambertMaterial({ color: 0x14161a });

  // batten + the two hoist cables up to the roof steel
  const rigGeos = [];
  {
    const b = new THREE.CylinderGeometry(0.045, 0.045, FLAG_W + 0.6, 8);
    b.rotateX(Math.PI / 2);                  // along z
    b.translate(FX, BATTEN_Y, 0);
    rigGeos.push(b);
    for (const s of [-1, 1]) {
      const c = new THREE.CylinderGeometry(0.015, 0.015, ROOF_Y - BATTEN_Y, 5);
      c.translate(FX, (ROOF_Y + BATTEN_Y) / 2, s * (FLAG_W / 2 - 0.1));
      rigGeos.push(c);
    }
  }
  group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(rigGeos), steel));

  // --- cloth: plane with a static sine wave baked into the vertices --------
  // Built in the xy plane (x = flag width), displaced in z, then rotated so
  // it faces +/-x and the wave travels along world z.
  const WAVE_K = 1.4, WAVE_P = 0.5;          // wave frequency / phase (per metre)
  const geo = new THREE.PlaneGeometry(FLAG_W, FLAG_H, 10, 6);
  {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const hang = 0.12 + 0.88 * ((FLAG_H / 2 - y) / FLAG_H);   // pinned at the batten
      pos.setZ(i, Math.sin(x * WAVE_K + WAVE_P) * 0.24 * hang);
    }
    geo.computeVertexNormals();
    geo.rotateY(Math.PI / 2);                // face +x, wave now runs along z
    geo.translate(FX, BATTEN_Y - 0.12 - FLAG_H / 2, 0);
  }

  const W = 1024, H = 640;
  const [canvas, ctx] = makeCanvas(W, H);
  const tex = canvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  mat.color.setScalar(0.9);                  // self-lit cloth, never blooms
  group.add(new THREE.Mesh(geo, mat));

  const state = { flag: null };

  function draw(code) {
    FLAGS[code](ctx, W, H);                  // flag art, full-bleed
    // fabric shading: column-wise light/shadow matching the baked wave, so
    // the folds read even though the cloth is unlit
    for (let px = 0; px < W; px += 4) {
      const wx = (px / W - 0.5) * FLAG_W;                 // metres across the flag
      const slope = Math.cos(wx * WAVE_K + WAVE_P);       // wave derivative
      if (slope > 0) ctx.fillStyle = `rgba(255,255,255,${(0.07 * slope).toFixed(3)})`;
      else ctx.fillStyle = `rgba(0,0,0,${(0.16 * -slope).toFixed(3)})`;
      ctx.fillRect(px, 0, 4, H);
    }
    tex.needsUpdate = true;
  }

  function set(codeOrNull) {
    if (!codeOrNull) {
      state.flag = null;
      group.visible = false;
      return;
    }
    if (!FLAGS[codeOrNull]) return;          // unknown code: ignore
    state.flag = codeOrNull;
    draw(codeOrNull);
    group.visible = true;
  }

  scene.add(group);
  return { group, set, state };
}
