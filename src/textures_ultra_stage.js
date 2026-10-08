// Ultra stage texture set — deck, skirt, truss, barricade. Canvas-baked like
// textures.js: deterministic, asset-free, caller sets repeat/anisotropy.
import * as THREE from 'three';

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

// Draw fn at all 9 wrap offsets so features crossing an edge tile cleanly.
function wrapped(ctx, W, H, fn) {
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    ctx.save(); ctx.translate(dx * W, dy * H); fn(); ctx.restore();
  }
}

// Horizontal-only variant for faces that tile in X but clamp in Y.
function wrappedX(ctx, W, fn) {
  for (let dx = -1; dx <= 1; dx++) {
    ctx.save(); ctx.translate(dx * W, 0); fn(); ctx.restore();
  }
}

function albedoTex(canvas, wrapT = THREE.RepeatWrapping) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = wrapT;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function linearTex(canvas, wrapT = THREE.RepeatWrapping) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = wrapT;
  return t;
}

const g = (v, a = 1) => `rgba(${v},${v},${v},${a})`;

// ---------------------------------------------------------------------------
// Stage deck — matte-black painted ply. Albedo stays nearly flat; the mop
// streaks and scuffs live in the roughness map.
// ---------------------------------------------------------------------------
// `marks` draws the one-off dressing: gaff tape strips, a spike-tape L and two
// dance-number dots. They are OFF by default because this texture is tiled once
// per 2.44 m ply sheet, so a marked tile repeats its "unique" features across
// the whole deck in an obvious grid. That grid was the thing that read as fake.
export function makeUltraStageDeck({ marks = false } = {}) {
  const W = 1024, H = 1024;
  const rand = mulberry32(48151);
  const [canvas, ctx] = makeCanvas(W, H);
  const [rCanvas, rctx] = makeCanvas(W, H);
  const [bCanvas, bctx] = makeCanvas(W, H);

  ctx.fillStyle = '#0b0c0e'; ctx.fillRect(0, 0, W, H);
  rctx.fillStyle = g(200); rctx.fillRect(0, 0, W, H);
  bctx.fillStyle = g(128); bctx.fillRect(0, 0, W, H);

  // large-scale paint mottle
  for (let i = 0; i < 42; i++) {
    const x = rand() * W, y = rand() * H, r = 90 + rand() * 220;
    const up = rand() < 0.6;
    wrapped(ctx, W, H, () => {
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, up ? 'rgba(20,21,24,0.16)' : 'rgba(9,10,12,0.16)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  // soft ply undulation in the bump only
  for (let i = 0; i < 14; i++) {
    const x = rand() * W, y = rand() * H, r = 150 + rand() * 250;
    const v = 128 + (rand() - 0.5) * 12;
    wrapped(bctx, W, H, () => {
      const gr = bctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, g(v | 0, 0.35));
      gr.addColorStop(1, g(v | 0, 0));
      bctx.fillStyle = gr;
      bctx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }

  // glossier mopped swathes (down to 110) and dull worn patches (up to 245)
  for (let i = 0; i < 5; i++) {
    const x = rand() * W, y = rand() * H, r = 200 + rand() * 200;
    wrapped(rctx, W, H, () => {
      const gr = rctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, g(110, 0.75));
      gr.addColorStop(1, g(110, 0));
      rctx.fillStyle = gr;
      rctx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  for (let i = 0; i < 6; i++) {
    const x = rand() * W, y = rand() * H, r = 90 + rand() * 150;
    wrapped(rctx, W, H, () => {
      const gr = rctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, g(245, 0.6));
      gr.addColorStop(1, g(245, 0));
      rctx.fillStyle = gr;
      rctx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }

  // boot scuffs — faint lighter arcs on albedo, dull on roughness
  for (let i = 0; i < 26; i++) {
    const x = rand() * W, y = rand() * H, r = 12 + rand() * 48;
    const a0 = rand() * Math.PI * 2, a1 = a0 + 0.5 + rand() * 1.6;
    const lw = 1 + rand() * 2.5, alpha = 0.05 + rand() * 0.08;
    wrapped(ctx, W, H, () => {
      ctx.strokeStyle = `rgba(46,48,54,${alpha})`;
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.stroke();
    });
    wrapped(rctx, W, H, () => {
      rctx.strokeStyle = g(245, 0.25);
      rctx.lineWidth = lw + 1;
      rctx.beginPath(); rctx.arc(x, y, r, a0, a1); rctx.stroke();
    });
  }

  // gaff tape strips — matte, so they read in roughness more than color
  const tapes = marks ? 5 : 0;
  for (let i = 0; i < tapes; i++) {
    const x = rand() * W, y = rand() * H;
    const len = 180 + rand() * 320, rot = (rand() - 0.5) * 0.08 + (rand() < 0.5 ? 0 : Math.PI / 2);
    const draw = (c, fill, edge) => wrapped(c, W, H, () => {
      c.save(); c.translate(x, y); c.rotate(rot);
      c.fillStyle = fill; c.fillRect(-len / 2, -12, len, 24);
      if (edge) {
        c.fillStyle = edge;
        c.fillRect(-len / 2, -12, len, 1.2);
        c.fillRect(-len / 2, 10.8, len, 1.2);
      }
      c.restore();
    });
    draw(ctx, '#1a1a1c', 'rgba(38,40,46,0.35)');
    draw(rctx, g(235, 0.9), null);
    draw(bctx, g(134, 0.5), null); // tape sits proud of the paint
  }

  // spike-tape L-mark + two dance-number dots
  if (marks) {
    wrapped(ctx, W, H, () => {
      ctx.fillStyle = 'rgba(225,224,218,0.92)';
      ctx.fillRect(300, 640, 64, 12);
      ctx.fillRect(300, 640, 12, 64);
    });
    for (const [dx, dy] of [[720, 210], [520, 860]]) {
      wrapped(ctx, W, H, () => {
        ctx.fillStyle = 'rgba(225,224,218,0.88)';
        ctx.beginPath(); ctx.arc(dx, dy, 5, 0, Math.PI * 2); ctx.fill();
      });
    }
  }

  // countersunk screw grid, 256px pitch
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const x = 128 + i * 256 + (rand() - 0.5) * 5;
    const y = 128 + j * 256 + (rand() - 0.5) * 5;
    ctx.fillStyle = 'rgba(4,4,6,0.55)';
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(150,155,162,0.4)';
    ctx.fillRect(x - 1.2, y - 1.2, 1.2, 1.2);
    bctx.fillStyle = g(52, 0.9);
    bctx.beginPath(); bctx.arc(x, y, 2.5, 0, Math.PI * 2); bctx.fill();
    bctx.fillStyle = g(210, 0.7);
    bctx.fillRect(x - 1.4, y - 1.4, 1.2, 1.2);
    rctx.fillStyle = g(130, 0.8);
    rctx.beginPath(); rctx.arc(x, y, 2.8, 0, Math.PI * 2); rctx.fill();
  }

  // fine grain
  for (let i = 0; i < 9000; i++) {
    const x = rand() * W, y = rand() * H;
    ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.04)';
    ctx.fillRect(x, y, 1, 1);
  }
  for (let i = 0; i < 7000; i++) {
    rctx.fillStyle = g(rand() < 0.5 ? 255 : 0, 0.03);
    rctx.fillRect(rand() * W, rand() * H, 1, 1);
  }

  return {
    map: albedoTex(canvas),
    roughnessMap: linearTex(rCanvas),
    bumpMap: linearTex(bCanvas),
  };
}

// ---------------------------------------------------------------------------
// Stage skirt — black serge, box pleats every 64px. Tiles in X only.
// ---------------------------------------------------------------------------
export function makeUltraStageSkirt() {
  const W = 512, H = 512;
  const rand = mulberry32(7741);
  const [canvas, ctx] = makeCanvas(W, H);
  const [rCanvas, rctx] = makeCanvas(W, H);

  // sinusoidal pleat shading, base #08090b nudged +-5
  for (let x = 0; x < W; x++) {
    const o = Math.round(5 * Math.sin((x / 64) * Math.PI * 2));
    ctx.fillStyle = `rgb(${8 + o},${9 + o},${11 + o})`;
    ctx.fillRect(x, 0, 1, H);
  }

  // fabric weave — barely-there speck noise
  for (let i = 0; i < 5000; i++) {
    const x = rand() * W, y = rand() * H;
    ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.03)';
    ctx.fillRect(x, y, 1, 1);
  }

  // dust catch at the hem
  const dust = ctx.createLinearGradient(0, H * 0.94, 0, H);
  dust.addColorStop(0, 'rgba(96,92,86,0)');
  dust.addColorStop(1, 'rgba(96,92,86,0.12)');
  ctx.fillStyle = dust;
  ctx.fillRect(0, H * 0.94, W, H * 0.06);

  rctx.fillStyle = g(250); rctx.fillRect(0, 0, W, H);

  return {
    map: albedoTex(canvas, THREE.ClampToEdgeWrapping),
    roughnessMap: linearTex(rCanvas, THREE.ClampToEdgeWrapping),
  };
}

// ---------------------------------------------------------------------------
// Box-truss aluminium — light maps: they multiply a lit standard material.
// ---------------------------------------------------------------------------
export function makeUltraTrussMetal() {
  const W = 512, H = 512;
  const rand = mulberry32(29304);
  const [canvas, ctx] = makeCanvas(W, H);
  const [rCanvas, rctx] = makeCanvas(W, H);
  const [bCanvas, bctx] = makeCanvas(W, H);

  ctx.fillStyle = '#8d9095'; ctx.fillRect(0, 0, W, H);
  rctx.fillStyle = g(90); rctx.fillRect(0, 0, W, H);
  bctx.fillStyle = g(128); bctx.fillRect(0, 0, W, H);

  // horizontal brushed grain, +-10 around base
  for (let i = 0; i < 1500; i++) {
    const x = rand() * W, y = rand() * H, len = 30 + rand() * 150;
    const v = 141 + ((rand() - 0.5) * 20) | 0;
    const alpha = 0.2 + rand() * 0.25;
    const rv = 90 + ((rand() - 0.5) * 24) | 0;
    const bv = rand() < 0.5 ? 124 : 132, drawB = rand() < 0.3;
    wrapped(ctx, W, H, () => {
      ctx.fillStyle = `rgba(${v},${v + 3},${v + 8},${alpha})`;
      ctx.fillRect(x, y, len, 1);
    });
    wrapped(rctx, W, H, () => {
      rctx.fillStyle = g(rv, 0.3);
      rctx.fillRect(x, y, len, 1);
    });
    if (drawB) wrapped(bctx, W, H, () => {
      bctx.fillStyle = g(bv, 0.3);
      bctx.fillRect(x, y, len, 1);
    });
  }

  // grubby handling patches — same spots darker AND rougher
  for (let i = 0; i < 7; i++) {
    const x = rand() * W, y = rand() * H, r = 40 + rand() * 90;
    wrapped(ctx, W, H, () => {
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(112,114,118,0.28)');
      gr.addColorStop(1, 'rgba(112,114,118,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    });
    wrapped(rctx, W, H, () => {
      const gr = rctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, g(170, 0.6));
      gr.addColorStop(1, g(170, 0));
      rctx.fillStyle = gr;
      rctx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }

  // weld dimple rows near top and bottom edges
  for (const yRow of [11, H - 11]) {
    for (let x = 10 + rand() * 6; x < W; x += 20 + rand() * 8) {
      const y = yRow + (rand() - 0.5) * 3;
      wrapped(ctx, W, H, () => {
        ctx.fillStyle = 'rgba(118,120,124,0.5)';
        ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(170,173,178,0.5)';
        ctx.beginPath(); ctx.arc(x - 0.6, y - 0.6, 0.8, 0, Math.PI * 2); ctx.fill();
      });
      wrapped(bctx, W, H, () => {
        bctx.fillStyle = g(168, 0.8);
        bctx.beginPath(); bctx.arc(x, y, 2, 0, Math.PI * 2); bctx.fill();
        bctx.fillStyle = g(96, 0.6);
        bctx.beginPath(); bctx.arc(x + 0.7, y + 0.7, 1, 0, Math.PI * 2); bctx.fill();
      });
      wrapped(rctx, W, H, () => {
        rctx.fillStyle = g(120, 0.7);
        rctx.beginPath(); rctx.arc(x, y, 2.4, 0, Math.PI * 2); rctx.fill();
      });
    }
  }

  return {
    map: albedoTex(canvas),
    roughnessMap: linearTex(rCanvas),
    bumpMap: linearTex(bCanvas),
  };
}

// ---------------------------------------------------------------------------
// Crowd barricade face — brushed alu, kicked along the bottom. Tiles in X.
// ---------------------------------------------------------------------------
export function makeUltraBarricade() {
  const W = 512, H = 512;
  const rand = mulberry32(60613);
  const [canvas, ctx] = makeCanvas(W, H);
  const [rCanvas, rctx] = makeCanvas(W, H);

  ctx.fillStyle = '#a6a9ad'; ctx.fillRect(0, 0, W, H);
  rctx.fillStyle = g(110); rctx.fillRect(0, 0, W, H);

  // vertical brushed grain
  for (let i = 0; i < 1200; i++) {
    const x = rand() * W, y = rand() * H, len = 25 + rand() * 120;
    const v = 166 + ((rand() - 0.5) * 16) | 0;
    const alpha = 0.2 + rand() * 0.2;
    const rv = 110 + ((rand() - 0.5) * 20) | 0;
    wrappedX(ctx, W, () => {
      ctx.fillStyle = `rgba(${v},${v + 3},${v + 7},${alpha})`;
      ctx.fillRect(x, y, 1, len);
    });
    wrappedX(rctx, W, () => {
      rctx.fillStyle = g(rv, 0.25);
      rctx.fillRect(x, y, 1, len);
    });
  }

  // extrusion lines, 32px pitch (512/32 exact, so it tiles)
  for (let x = 0; x < W; x += 32) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x, 0, 2, H);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(x + 2, 0, 1, H);
    rctx.fillStyle = g(130, 0.5);
    rctx.fillRect(x, 0, 2, H);
  }

  // kick scuffs and rubber marks, bottom third
  for (let i = 0; i < 34; i++) {
    const x = rand() * W, y = H * (0.68 + rand() * 0.3);
    const r = 8 + rand() * 30, a0 = rand() * Math.PI * 2, a1 = a0 + 0.4 + rand() * 1.4;
    const lw = 1.5 + rand() * 3, rubber = rand() < 0.4;
    const alpha = rubber ? 0.2 + rand() * 0.2 : 0.12 + rand() * 0.12;
    wrappedX(ctx, W, () => {
      ctx.strokeStyle = rubber
        ? `rgba(30,30,34,${alpha})`
        : `rgba(120,122,126,${alpha})`;
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.stroke();
    });
    wrappedX(rctx, W, () => {
      rctx.strokeStyle = g(180, 0.5);
      rctx.lineWidth = lw + 1;
      rctx.beginPath(); rctx.arc(x, y, r, a0, a1); rctx.stroke();
    });
  }
  // general grime pull toward the bottom edge
  const grime = ctx.createLinearGradient(0, H * 0.6, 0, H);
  grime.addColorStop(0, 'rgba(60,60,64,0)');
  grime.addColorStop(1, 'rgba(60,60,64,0.1)');
  ctx.fillStyle = grime; ctx.fillRect(0, H * 0.6, W, H * 0.4);
  const rGrime = rctx.createLinearGradient(0, H * 0.6, 0, H);
  rGrime.addColorStop(0, g(180, 0));
  rGrime.addColorStop(1, g(180, 0.3));
  rctx.fillStyle = rGrime; rctx.fillRect(0, H * 0.6, W, H * 0.4);

  return {
    map: albedoTex(canvas, THREE.ClampToEdgeWrapping),
    roughnessMap: linearTex(rCanvas, THREE.ClampToEdgeWrapping),
  };
}
