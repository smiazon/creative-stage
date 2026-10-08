// Ultra-detail arena surface bakes — concourse concrete, seating riser,
// deck underside, precast wall. Same conventions as textures.js: canvas 2D,
// deterministic, caller sets anisotropy/repeat.
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

// Draw fn at the 3x3 (or 3x1) wrapped offsets so edge-crossing features tile.
function wrapped(ctx, w, h, fn, tileY = true) {
  for (let dy = tileY ? -1 : 0; dy <= (tileY ? 1 : 0); dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      ctx.save();
      ctx.translate(dx * w, dy * h);
      fn(ctx);
      ctx.restore();
    }
  }
}

function tex(canvas, { srgb = false, tileX = true, tileY = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (tileX) t.wrapS = THREE.RepeatWrapping;
  if (tileY) t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Power-trowelled concourse concrete. Joints at 0 and 512 so the caller's
// repeat reads as 2x2m saw-cut panels.
// ---------------------------------------------------------------------------
export function makeUltraConcrete() {
  const W = 1024, H = 1024;
  const rand = mulberry32(9021);
  const [c, ctx] = makeCanvas(W, H);
  const [rc, rctx] = makeCanvas(W, H);
  const [bc, bctx] = makeCanvas(W, H);

  ctx.fillStyle = '#17181c'; ctx.fillRect(0, 0, W, H);
  rctx.fillStyle = 'rgb(235,235,235)'; rctx.fillRect(0, 0, W, H);
  bctx.fillStyle = 'rgb(128,128,128)'; bctx.fillRect(0, 0, W, H);

  // large trowel blotches — the same set drives polished patches in roughness
  const blotches = [];
  for (let i = 0; i < 26; i++) {
    blotches.push({ x: rand() * W, y: rand() * H, r: 40 + rand() * 160, a: 0.08 + rand() * 0.14 });
  }
  for (const b of blotches) {
    wrapped(ctx, W, H, (g) => {
      const gr = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      gr.addColorStop(0, `rgba(35,37,41,${b.a})`);
      gr.addColorStop(1, 'rgba(35,37,41,0)');
      g.fillStyle = gr;
      g.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    });
    wrapped(rctx, W, H, (g) => {
      const gr = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      gr.addColorStop(0, `rgba(150,150,150,${Math.min(0.95, 0.25 + b.a * 3.5)})`);
      gr.addColorStop(1, 'rgba(150,150,150,0)');
      g.fillStyle = gr;
      g.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    });
  }

  // dolly / forklift scuff arcs
  const scuffs = 6 + (rand() * 4) | 0;
  for (let i = 0; i < scuffs; i++) {
    const cx = rand() * W, cy = rand() * H;
    const r = 90 + rand() * 320;
    const a0 = rand() * Math.PI * 2, sweep = 0.4 + rand() * 1.2;
    const lw = 2 + rand() * 4;
    const sa = 0.04 + rand() * 0.05;
    wrapped(ctx, W, H, (g) => {
      g.strokeStyle = `rgba(200,205,215,${sa})`;
      g.lineWidth = lw;
      g.beginPath(); g.arc(cx, cy, r, a0, a0 + sweep); g.stroke();
    });
    wrapped(rctx, W, H, (g) => {
      g.strokeStyle = 'rgba(175,175,175,0.55)';
      g.lineWidth = lw;
      g.beginPath(); g.arc(cx, cy, r, a0, a0 + sweep); g.stroke();
    });
  }

  // faint dark stains
  const stains = 3 + ((rand() * 2) | 0);
  for (let i = 0; i < stains; i++) {
    const x = rand() * W, y = rand() * H, r = 50 + rand() * 120;
    wrapped(ctx, W, H, (g) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(12,13,16,0.14)');
      gr.addColorStop(1, 'rgba(12,13,16,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    });
    wrapped(rctx, W, H, (g) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(190,190,190,0.35)');
      gr.addColorStop(1, 'rgba(190,190,190,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }

  // fine speckle grain
  for (let i = 0; i < 30000; i++) {
    const x = rand() * W, y = rand() * H;
    const lit = rand() < 0.5;
    ctx.fillStyle = lit
      ? `rgba(46,48,54,${0.05 + rand() * 0.10})`
      : `rgba(12,13,16,${0.05 + rand() * 0.10})`;
    ctx.fillRect(x, y, 1, 1);
    const bv = 128 + (rand() * 13 - 6) | 0;
    bctx.fillStyle = `rgb(${bv},${bv},${bv})`;
    bctx.fillRect(x, y, 1, 1);
  }

  // saw-cut expansion joints, centered on 0 and 512 in both axes
  for (const p of [0, 512]) {
    wrapped(ctx, W, H, (g) => {
      g.fillStyle = 'rgba(10,11,13,0.75)';
      g.fillRect(p - 1, 0, 2, H);
      g.fillRect(0, p - 1, W, 2);
    });
    wrapped(bctx, W, H, (g) => {
      g.fillStyle = 'rgb(52,52,52)';
      g.fillRect(p - 1, 0, 2, H);
      g.fillRect(0, p - 1, W, 2);
    });
    wrapped(rctx, W, H, (g) => {
      g.fillStyle = 'rgba(248,248,248,0.8)';
      g.fillRect(p - 1, 0, 2, H);
      g.fillRect(0, p - 1, W, 2);
    });
  }

  return {
    map: tex(c, { srgb: true }),
    roughnessMap: tex(rc),
    bumpMap: tex(bc),
  };
}

// ---------------------------------------------------------------------------
// Seating-tier step face + tread, tiled along the row (wrapS only).
// ---------------------------------------------------------------------------
export function makeUltraRiser() {
  const W = 512, H = 512;
  const rand = mulberry32(4477);
  const [c, ctx] = makeCanvas(W, H);
  const [rc, rctx] = makeCanvas(W, H);

  ctx.fillStyle = '#131418'; ctx.fillRect(0, 0, W, H);
  rctx.fillStyle = 'rgb(232,232,232)'; rctx.fillRect(0, 0, W, H);

  // mottle within #101114..#1a1c20
  for (let i = 0; i < 22; i++) {
    const x = rand() * W, y = rand() * H, r = 30 + rand() * 110;
    const col = rand() < 0.5 ? '16,17,20' : '26,28,32';
    const a = 0.10 + rand() * 0.15;
    wrapped(ctx, W, H, (g) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${col},${a})`);
      gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }, false);
  }

  // fine grain
  for (let i = 0; i < 8000; i++) {
    const lit = rand() < 0.5;
    ctx.fillStyle = lit
      ? `rgba(40,42,48,${0.05 + rand() * 0.08})`
      : `rgba(9,10,12,${0.05 + rand() * 0.08})`;
    ctx.fillRect(rand() * W, rand() * H, 1, 1);
  }

  // foot-polished nosing along the top 8%
  const nose = H * 0.08;
  let g2 = ctx.createLinearGradient(0, 0, 0, nose);
  g2.addColorStop(0, 'rgba(185,190,200,0.15)');
  g2.addColorStop(1, 'rgba(185,190,200,0)');
  ctx.fillStyle = g2; ctx.fillRect(0, 0, W, nose);
  g2 = rctx.createLinearGradient(0, 0, 0, nose);
  g2.addColorStop(0, 'rgba(120,120,120,1)');
  g2.addColorStop(1, 'rgba(120,120,120,0)');
  rctx.fillStyle = g2; rctx.fillRect(0, 0, W, nose);

  // grime settles into the bottom 20%
  g2 = ctx.createLinearGradient(0, H * 0.8, 0, H);
  g2.addColorStop(0, 'rgba(8,9,11,0)');
  g2.addColorStop(1, 'rgba(8,9,11,0.42)');
  ctx.fillStyle = g2; ctx.fillRect(0, H * 0.8, W, H * 0.2);
  g2 = rctx.createLinearGradient(0, H * 0.8, 0, H);
  g2.addColorStop(0, 'rgba(248,248,248,0)');
  g2.addColorStop(1, 'rgba(248,248,248,0.6)');
  rctx.fillStyle = g2; rctx.fillRect(0, H * 0.8, W, H * 0.2);

  // gum specks
  for (let i = 0; i < 12; i++) {
    const x = rand() * W, y = H * (0.15 + rand() * 0.8), r = 1.5 + rand() * 2.5;
    wrapped(ctx, W, H, (g) => {
      g.fillStyle = 'rgba(9,10,11,0.7)';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }, false);
    wrapped(rctx, W, H, (g) => {
      g.fillStyle = 'rgba(160,160,160,0.8)';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }, false);
  }

  // drink stains running down the face
  for (let i = 0; i < 4; i++) {
    const x = rand() * W, y0 = H * (0.1 + rand() * 0.3);
    const len = H * (0.2 + rand() * 0.45), w = 6 + rand() * 14;
    wrapped(ctx, W, H, (g) => {
      const gr = g.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, 'rgba(22,18,13,0.12)');
      gr.addColorStop(1, 'rgba(22,18,13,0)');
      g.fillStyle = gr;
      g.fillRect(x - w / 2, y0, w, len);
    }, false);
  }

  const map = tex(c, { srgb: true, tileY: false });
  const roughnessMap = tex(rc, { tileY: false });
  return { map, roughnessMap };
}

// ---------------------------------------------------------------------------
// Painted-steel underside of a seating deck: corrugation ribs run vertically,
// C-channel girders run horizontally with bolt rows and rust weeps.
// ---------------------------------------------------------------------------
export function makeUltraUnderdeck() {
  const W = 1024, H = 1024;
  const rand = mulberry32(6603);
  const RIB = 64, GIRDER = 256, GH = 32;
  const [c, ctx] = makeCanvas(W, H);
  const [rc, rctx] = makeCanvas(W, H);
  const [bc, bctx] = makeCanvas(W, H);

  ctx.fillStyle = '#14161a'; ctx.fillRect(0, 0, W, H);
  rctx.fillStyle = 'rgb(205,205,205)'; rctx.fillRect(0, 0, W, H);

  // corrugation: bump carries the wave, albedo only a whisper of shading
  for (let x = 0; x < W; x++) {
    const s = Math.sin((x / RIB) * Math.PI * 2);
    const bv = Math.round(128 + 42 * s);
    bctx.fillStyle = `rgb(${bv},${bv},${bv})`;
    bctx.fillRect(x, 0, 1, H);
    const a = s * 0.035;
    ctx.fillStyle = a >= 0 ? `rgba(220,225,235,${a})` : `rgba(0,0,0,${-a})`;
    ctx.fillRect(x, 0, 1, H);
  }

  // fine dust grain
  for (let i = 0; i < 16000; i++) {
    const lit = rand() < 0.5;
    ctx.fillStyle = lit
      ? `rgba(40,44,52,${0.04 + rand() * 0.07})`
      : `rgba(8,9,11,${0.04 + rand() * 0.07})`;
    ctx.fillRect(rand() * W, rand() * H, 1, 1);
  }

  // paint sheen patches
  for (let i = 0; i < 7; i++) {
    const x = rand() * W, y = rand() * H, r = 60 + rand() * 150;
    const a = 0.3 + rand() * 0.4;
    wrapped(rctx, W, H, (g) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(140,140,140,${a})`);
      gr.addColorStop(1, 'rgba(140,140,140,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }

  // girders + bolt rows; remember bolt spots for the rust weeps
  const bolts = [];
  for (let gy = 128; gy < H; gy += GIRDER) {
    ctx.fillStyle = '#101216';
    ctx.fillRect(0, gy - GH / 2, W, GH);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, gy - GH / 2, W, 2);
    ctx.fillRect(0, gy + GH / 2 - 2, W, 2);
    bctx.fillStyle = 'rgb(202,202,202)';
    bctx.fillRect(0, gy - GH / 2, W, GH);
    bctx.fillStyle = 'rgb(90,90,90)';
    bctx.fillRect(0, gy - GH / 2, W, 2);
    bctx.fillRect(0, gy + GH / 2 - 2, W, 2);
    rctx.fillStyle = 'rgba(185,185,185,0.7)';
    rctx.fillRect(0, gy - GH / 2, W, GH);

    for (let bx = 32; bx < W; bx += 64) {
      ctx.fillStyle = 'rgba(8,9,11,0.9)';
      ctx.beginPath(); ctx.arc(bx, gy, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(175,185,200,0.55)';
      ctx.fillRect(bx - 2, gy - 2, 1, 1);
      bctx.fillStyle = 'rgb(225,225,225)';
      bctx.beginPath(); bctx.arc(bx, gy, 2.5, 0, Math.PI * 2); bctx.fill();
      bolts.push([bx, gy]);
    }
  }

  // rust weeps bleeding down from bolt rows
  for (let i = 0; i < 3; i++) {
    const [bx, by] = bolts[(rand() * bolts.length) | 0];
    const len = 70 + rand() * 160;
    const streaks = 3 + (rand() * 3) | 0;
    for (let s = 0; s < streaks; s++) {
      const ox = (rand() - 0.5) * 6, w = 1 + rand() * 2.5;
      const sl = len * (0.5 + rand() * 0.5);
      const ra = 0.14 + rand() * 0.10;
      wrapped(ctx, W, H, (g) => {
        const gr = g.createLinearGradient(0, by, 0, by + sl);
        gr.addColorStop(0, `rgba(58,46,38,${ra})`);
        gr.addColorStop(1, 'rgba(58,46,38,0)');
        g.fillStyle = gr;
        g.fillRect(bx + ox - w / 2, by, w, sl);
      });
      wrapped(rctx, W, H, (g) => {
        const gr = g.createLinearGradient(0, by, 0, by + sl);
        gr.addColorStop(0, 'rgba(242,242,242,0.5)');
        gr.addColorStop(1, 'rgba(242,242,242,0)');
        g.fillStyle = gr;
        g.fillRect(bx + ox - w / 2, by, w, sl);
      });
    }
  }

  return {
    map: tex(c, { srgb: true }),
    roughnessMap: tex(rc),
    bumpMap: tex(bc),
  };
}

// ---------------------------------------------------------------------------
// Precast wall panel: 512px seam grid, form-tie divots inset 128px, broad
// vertical casting bands.
// ---------------------------------------------------------------------------
export function makeUltraWallPanel() {
  const W = 1024, H = 1024;
  const rand = mulberry32(7741);
  const [c, ctx] = makeCanvas(W, H);
  const [rc, rctx] = makeCanvas(W, H);
  const [bc, bctx] = makeCanvas(W, H);

  ctx.fillStyle = '#1d1f24'; ctx.fillRect(0, 0, W, H);
  rctx.fillStyle = 'rgb(222,222,222)'; rctx.fillRect(0, 0, W, H);
  bctx.fillStyle = 'rgb(128,128,128)'; bctx.fillRect(0, 0, W, H);

  // broad vertical casting bands — periodic in W so the seam is invisible
  for (let x = 0; x < W; x++) {
    const t = Math.sin((x / W) * Math.PI * 4 + 1.3) + 0.6 * Math.sin((x / W) * Math.PI * 10 + 4.0);
    ctx.fillStyle = t >= 0 ? `rgba(230,232,238,${t * 0.030})` : `rgba(0,0,0,${-t * 0.035})`;
    ctx.fillRect(x, 0, 1, H);
    rctx.fillStyle = t >= 0 ? `rgba(255,255,255,${t * 0.02})` : `rgba(0,0,0,${-t * 0.02})`;
    rctx.fillRect(x, 0, 1, H);
  }

  // soft tonal mottling
  for (let i = 0; i < 18; i++) {
    const x = rand() * W, y = rand() * H, r = 60 + rand() * 180;
    const col = rand() < 0.5 ? '24,26,31' : '36,38,44';
    const a = 0.06 + rand() * 0.10;
    wrapped(ctx, W, H, (g) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${col},${a})`);
      gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }

  // very fine pore speckle
  for (let i = 0; i < 24000; i++) {
    const x = rand() * W, y = rand() * H;
    const lit = rand() < 0.45;
    ctx.fillStyle = lit
      ? `rgba(48,51,58,${0.04 + rand() * 0.08})`
      : `rgba(14,15,18,${0.04 + rand() * 0.08})`;
    ctx.fillRect(x, y, 1, 1);
    const bv = 128 + (rand() * 11 - 5) | 0;
    bctx.fillStyle = `rgb(${bv},${bv},${bv})`;
    bctx.fillRect(x, y, 1, 1);
  }

  // panel seam grooves every 512px, centered on 0 and 512
  for (const p of [0, 512]) {
    wrapped(ctx, W, H, (g) => {
      g.fillStyle = 'rgba(11,12,15,0.6)';
      g.fillRect(p - 1.5, 0, 3, H);
      g.fillRect(0, p - 1.5, W, 3);
    });
    wrapped(bctx, W, H, (g) => {
      g.fillStyle = 'rgb(45,45,45)';
      g.fillRect(p - 1.5, 0, 3, H);
      g.fillRect(0, p - 1.5, W, 3);
    });
    wrapped(rctx, W, H, (g) => {
      g.fillStyle = 'rgba(245,245,245,0.7)';
      g.fillRect(p - 1.5, 0, 3, H);
      g.fillRect(0, p - 1.5, W, 3);
    });
  }

  // form-tie divots inset 128px from every seam
  for (let dx = 128; dx < W; dx += 256) {
    for (let dy = 128; dy < H; dy += 256) {
      const gr = ctx.createRadialGradient(dx, dy, 0, dx, dy, 6);
      gr.addColorStop(0, 'rgba(13,14,17,0.5)');
      gr.addColorStop(0.8, 'rgba(13,14,17,0.35)');
      gr.addColorStop(1, 'rgba(13,14,17,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(dx, dy, 6, 0, Math.PI * 2); ctx.fill();
      const bg = bctx.createRadialGradient(dx, dy, 0, dx, dy, 6);
      bg.addColorStop(0, 'rgb(60,60,60)');
      bg.addColorStop(1, 'rgb(128,128,128)');
      bctx.fillStyle = bg;
      bctx.beginPath(); bctx.arc(dx, dy, 6, 0, Math.PI * 2); bctx.fill();
      rctx.fillStyle = 'rgba(190,190,190,0.6)';
      rctx.beginPath(); rctx.arc(dx, dy, 6, 0, Math.PI * 2); rctx.fill();
    }
  }

  return {
    map: tex(c, { srgb: true }),
    roughnessMap: tex(rc),
    bumpMap: tex(bc),
  };
}
