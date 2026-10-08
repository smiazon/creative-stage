// Procedural surface textures for the arena — event floor concrete, seat
// shading and blackout tarps. Same conventions as textures.js: everything is
// drawn once at load time on canvases, deterministic PRNG, matte values only
// (bloom gates at channel > 1.25, so nothing here should ever push a material
// toward emissive territory — all maps stay <= 1.0).
import * as THREE from 'three';

// Deterministic PRNG (same as textures.js — it is not exported from there).
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

// Draw a stamp at all nine wrap positions so features crossing an edge
// re-enter on the opposite side — the standard 3x3 trick for tileability.
function wrapped(ctx, W, H, draw) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      ctx.save();
      ctx.translate(dx * W, dy * H);
      draw();
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------------------
// Polished concrete — arena event floor. 1024x1024, tileable.
// Mid-dark grey with soft tonal blotches, speckle, offset expansion joints,
// scuff arcs / tire streaks and faint worn-sealer patches.
// ---------------------------------------------------------------------------
export function makeConcreteFloor() {
  const S = 1024;
  const rand = mulberry32(20260825);
  const [c, ctx] = makeCanvas(S, S);

  // base: #3a3c40 with a very soft drift down toward #2e3033
  ctx.fillStyle = '#34363a';
  ctx.fillRect(0, 0, S, S);

  // large soft tonal blotches — radial gradients, wrap-around
  for (let i = 0; i < 42; i++) {
    const x = rand() * S, y = rand() * S;
    const r = 90 + rand() * 240;
    const light = rand() < 0.5;
    const a = 0.05 + rand() * 0.09;
    const col = light ? '58,60,64' : '46,48,51';
    wrapped(ctx, S, S, () => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${col},${a})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }

  // worn-sealer patches — slightly lighter, broad and very subtle
  for (let i = 0; i < 7; i++) {
    const x = rand() * S, y = rand() * S;
    const r = 130 + rand() * 200;
    wrapped(ctx, S, S, () => {
      const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
      g.addColorStop(0, 'rgba(74,77,82,0.06)');
      g.addColorStop(1, 'rgba(74,77,82,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }

  // fine speckle noise — aggregate flecks, positions taken modulo the tile
  for (let i = 0; i < 9000; i++) {
    const x = (rand() * S) | 0, y = (rand() * S) | 0;
    const dark = rand() < 0.55;
    const v = dark ? 24 + rand() * 18 : 74 + rand() * 26;
    ctx.fillStyle = `rgba(${v | 0},${(v + 1) | 0},${(v + 3) | 0},${0.10 + rand() * 0.16})`;
    const s = rand() < 0.85 ? 1 : 2;
    ctx.fillRect(x % S, y % S, s, s);
  }

  // expansion joints — 2 vertical + 2 horizontal thin darker lines, offset
  // from centre so the repeating grid reads irregular. Full-span lines are
  // tileable by construction.
  const joints = { v: [278, 811], h: [193, 704] };
  for (const x of joints.v) {
    ctx.fillStyle = 'rgba(18,19,21,0.55)';
    ctx.fillRect(x - 1, 0, 2.5, S);
    ctx.fillStyle = 'rgba(88,91,96,0.18)';   // slight sheen on the joint lip
    ctx.fillRect(x + 1.5, 0, 1, S);
  }
  for (const y of joints.h) {
    ctx.fillStyle = 'rgba(18,19,21,0.55)';
    ctx.fillRect(0, y - 1, S, 2.5);
    ctx.fillStyle = 'rgba(88,91,96,0.18)';
    ctx.fillRect(0, y + 1.5, S, 1);
  }

  // scuff arcs — machine / crowd wear, wrap-around
  for (let i = 0; i < 60; i++) {
    const x = rand() * S, y = rand() * S;
    const r = 12 + rand() * 90;
    const a0 = rand() * 6.3, a1 = a0 + 0.5 + rand() * 2.2;
    const dark = rand() < 0.6;
    ctx.strokeStyle = dark
      ? `rgba(22,23,26,${0.04 + rand() * 0.06})`
      : `rgba(96,99,105,${0.03 + rand() * 0.05})`;
    ctx.lineWidth = 0.8 + rand() * 2.0;
    wrapped(ctx, S, S, () => {
      ctx.beginPath();
      ctx.arc(x, y, r, a0, a1);
      ctx.stroke();
    });
  }

  // tire-ish streaks — long, low-alpha, slightly curved dark runs
  for (let i = 0; i < 10; i++) {
    const x = rand() * S, y = rand() * S;
    const ang = rand() * Math.PI;
    const len = 220 + rand() * 420;
    const bow = (rand() - 0.5) * 60;
    ctx.strokeStyle = `rgba(20,21,24,${0.045 + rand() * 0.05})`;
    ctx.lineWidth = 5 + rand() * 9;
    ctx.lineCap = 'round';
    wrapped(ctx, S, S, () => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(
        x + Math.cos(ang) * len * 0.5 - Math.sin(ang) * bow,
        y + Math.sin(ang) * len * 0.5 + Math.cos(ang) * bow,
        x + Math.cos(ang) * len,
        y + Math.sin(ang) * len
      );
      ctx.stroke();
    });
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Seat shading — 256x256 UV-space map for a moulded plastic seat. Multiplies
// the per-instance seat colour, so it is a light-grey/white map: near-white
// where the plastic catches light, darker toward the edges (baked AO).
// NOT tileable — clamped.
// ---------------------------------------------------------------------------
export function makeSeatShading() {
  const S = 256;
  const rand = mulberry32(6161);
  const [c, ctx] = makeCanvas(S, S);

  // base
  ctx.fillStyle = '#e2e2e2';
  ctx.fillRect(0, 0, S, S);

  // soft vertical highlight band down the middle
  const hg = ctx.createLinearGradient(0, 0, S, 0);
  hg.addColorStop(0.00, 'rgba(255,255,255,0)');
  hg.addColorStop(0.34, 'rgba(255,255,255,0.35)');
  hg.addColorStop(0.50, 'rgba(255,255,255,0.75)');
  hg.addColorStop(0.66, 'rgba(255,255,255,0.35)');
  hg.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, S, S);

  // ambient occlusion toward the outer 12% edges
  const edge = S * 0.12;
  const ao = (x0, y0, x1, y1) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(120,120,124,0.55)');
    g.addColorStop(1, 'rgba(120,120,124,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  };
  ao(0, 0, edge, 0);
  ao(S, 0, S - edge, 0);
  ao(0, 0, 0, edge);
  ao(0, S, 0, S - edge);

  // two ergonomic grooves — darker line with a light catch-line under each
  for (const y of [104, 168]) {
    const g = ctx.createLinearGradient(0, y - 4, 0, y + 2);
    g.addColorStop(0, 'rgba(150,150,154,0)');
    g.addColorStop(0.7, 'rgba(150,150,154,0.55)');
    g.addColorStop(1, 'rgba(150,150,154,0.65)');
    ctx.fillStyle = g;
    ctx.fillRect(edge * 0.8, y - 4, S - edge * 1.6, 6);
    // light line just below — the groove's lower lip catching light
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(edge * 0.8, y + 2, S - edge * 1.6, 1.5);
  }

  // faint plastic grain
  for (let i = 0; i < 2600; i++) {
    const x = rand() * S, y = rand() * S;
    const light = rand() < 0.5;
    ctx.fillStyle = light
      ? `rgba(255,255,255,${0.03 + rand() * 0.05})`
      : `rgba(140,140,144,${0.03 + rand() * 0.05})`;
    ctx.fillRect(x, y, 1, 1);
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Blackout tarp — 512x512 tileable black vinyl. Very dark (avg channel must
// stay <= 0.12 — these hide whole seating sections), but with sheen streaks,
// seams with stitching, wrinkle gradients and matte patches so it never reads
// as a flat colour up close.
// ---------------------------------------------------------------------------
export function makeTarpTexture() {
  const S = 512;
  const rand = mulberry32(9090);
  const [c, ctx] = makeCanvas(S, S);

  ctx.fillStyle = '#0b0b0e';
  ctx.fillRect(0, 0, S, S);

  // long horizontal sheen streaks — barely lighter, low alpha, wrap in x
  for (let i = 0; i < 26; i++) {
    const y = rand() * S;
    const x = rand() * S;
    const len = 180 + rand() * 380;
    const h = 1.5 + rand() * 5;
    const a = 0.03 + rand() * 0.05;
    wrapped(ctx, S, S, () => {
      const g = ctx.createLinearGradient(x, 0, x + len, 0);
      g.addColorStop(0, 'rgba(46,47,54,0)');
      g.addColorStop(0.5, `rgba(46,47,54,${a})`);
      g.addColorStop(1, 'rgba(46,47,54,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y - h / 2, len, h);
    });
  }

  // soft wrinkle shading — diagonal low-alpha gradients, light lip + dark fold
  for (let i = 0; i < 18; i++) {
    const x = rand() * S, y = rand() * S;
    const ang = (rand() < 0.5 ? 1 : -1) * (0.5 + rand() * 0.5); // diagonal-ish
    const len = 120 + rand() * 260;
    const w = 10 + rand() * 26;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    wrapped(ctx, S, S, () => {
      const g = ctx.createLinearGradient(x - dy * w, y + dx * w, x + dy * w, y - dx * w);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.42, `rgba(38,39,46,${0.05 + rand() * 0.05})`);
      g.addColorStop(0.58, `rgba(2,2,4,${0.14 + rand() * 0.1})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.translate(-x, -y);
      ctx.fillRect(x - len / 2, y - w, len, w * 2);
      ctx.restore();
    });
  }

  // occasional matte patch — kills the sheen locally
  for (let i = 0; i < 6; i++) {
    const x = rand() * S, y = rand() * S;
    const r = 50 + rand() * 90;
    wrapped(ctx, S, S, () => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(9,9,11,0.5)');
      g.addColorStop(1, 'rgba(9,9,11,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }

  // seam lines every 256px (tileable: 512/256 = 2) with stitch dashes.
  // Offset from 0 so a seam never sits exactly on the tile edge.
  for (const y of [96, 352]) {
    // welded overlap: thin dark shadow line + faint lit edge above
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, y, S, 2);
    ctx.fillStyle = 'rgba(52,53,60,0.22)';
    ctx.fillRect(0, y - 2, S, 1.5);
    // stitch dashes riding the seam
    ctx.fillStyle = 'rgba(40,41,47,0.5)';
    for (let x = 4; x < S; x += 16) {
      ctx.fillRect(x, y + 3, 7, 1.5);
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
