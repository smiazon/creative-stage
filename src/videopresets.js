// Built-in animated screen visuals for the LED walls.
//
// Everything renders into ONE 512x288 2D canvas exposed as a CanvasTexture.
// These frames end up on a ~24 m wide wall, so every preset is built from
// BIG saturated shapes with hard contrast — no fine detail, no text.
//
// Budget: each preset's draw must stay well under ~1 ms. Gradients that do
// not change frame-to-frame are built once and reused; the only persistent
// per-frame state is a small fixed-size particle array (embers, starfield).
import * as THREE from 'three';

const W = 512, H = 288;
const TAU = Math.PI * 2;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// ---------------------------------------------------------------------------
// waves — layered sine ribbons scrolling horizontally.
// ---------------------------------------------------------------------------
function makeWaves(ctx) {
  const layers = [
    { col: 'rgba(120,40,255,0.85)', amp: 46, freq: 1.6, speed: 0.55, yc: 0.62, w: 46 },
    { col: 'rgba(255,0,180,0.9)',   amp: 60, freq: 1.1, speed: 0.9,  yc: 0.48, w: 34 },
    { col: 'rgba(0,230,255,0.95)',  amp: 40, freq: 2.1, speed: 1.4,  yc: 0.38, w: 22 },
  ];
  const STEP = 16; // coarse polyline — reads identically at wall scale
  return (t) => {
    ctx.fillStyle = '#050008';
    ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const L of layers) {
      ctx.strokeStyle = L.col;
      ctx.lineWidth = L.w;
      ctx.beginPath();
      const ph = t * L.speed * TAU * 0.35;
      for (let x = -STEP; x <= W + STEP; x += STEP) {
        const y = H * L.yc
          + Math.sin((x / W) * L.freq * TAU + ph) * L.amp
          + Math.sin((x / W) * L.freq * 2.7 * TAU - ph * 1.7) * L.amp * 0.25;
        if (x <= -STEP + 0.5) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  };
}

// ---------------------------------------------------------------------------
// aurora — vertical curtains of green/teal/purple slowly waving.
// ---------------------------------------------------------------------------
function makeAurora(ctx) {
  // Base sky, built once.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#020411');
  sky.addColorStop(1, '#000206');
  const curtains = [
    { col0: 'rgba(0,255,140,0.0)', col1: 'rgba(0,255,140,0.55)', xc: 0.22, w: 150, sway: 60, sp: 0.13, top: 0.02 },
    { col0: 'rgba(0,220,210,0.0)', col1: 'rgba(0,220,210,0.5)',  xc: 0.52, w: 190, sway: 80, sp: 0.09, top: 0.1 },
    { col0: 'rgba(170,60,255,0.0)', col1: 'rgba(170,60,255,0.5)', xc: 0.8, w: 140, sway: 55, sp: 0.17, top: 0.06 },
  ];
  // Each curtain's vertical gradient is static; only its x position moves.
  for (const c of curtains) {
    const g = ctx.createLinearGradient(0, H * c.top, 0, H);
    g.addColorStop(0, c.col0);
    g.addColorStop(0.35, c.col1);
    g.addColorStop(1, c.col0);
    c.grad = g;
  }
  // Curtains are drawn as 6 vertical slabs, each sin-warped sideways.
  return (t) => {
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const c of curtains) {
      ctx.fillStyle = c.grad;
      for (let i = 0; i < 6; i++) {
        const yy = H * c.top + (i / 6) * H * (1 - c.top);
        const hh = H / 6 + 2;
        const wob = Math.sin(t * c.sp * TAU + i * 0.9) * c.sway
          + Math.sin(t * c.sp * 2.3 * TAU + i * 1.7 + c.xc * 9) * c.sway * 0.35;
        const x = W * c.xc + wob - c.w / 2;
        ctx.fillRect(x, yy, c.w, hh);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  };
}

// ---------------------------------------------------------------------------
// rings — concentric pulse rings expanding from centre, hue cycling.
// ---------------------------------------------------------------------------
function makeRings(ctx) {
  const N = 5;               // rings alive at once
  const PERIOD = 1.6;        // seconds between births
  const MAXR = Math.hypot(W, H) * 0.55;
  return (t) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < N; i++) {
      // phase in [0,1): each ring is a fixed slot re-emitted forever
      const born = Math.floor(t / PERIOD - i / N) * PERIOD + (i / N) * PERIOD;
      const age = t - born;
      const p = age / (PERIOD * N * 0.55);
      if (p <= 0 || p >= 1) continue;
      const r = 8 + p * MAXR;
      const hue = ((born * 47) % 360 + 360) % 360;
      const alpha = (1 - p) * 0.95;
      ctx.strokeStyle = `hsla(${hue},100%,60%,${alpha})`;
      ctx.lineWidth = 26 * (1 - p * 0.6);
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r, 0, TAU);
      ctx.stroke();
    }
    // hot core pulse
    const pulse = 0.5 + 0.5 * Math.sin((t / PERIOD) * TAU);
    ctx.fillStyle = `hsla(${((t * 47) % 360)},100%,70%,${0.25 + pulse * 0.4})`;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 14 + pulse * 10, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  };
}

// ---------------------------------------------------------------------------
// bars — bold vertical colour bars sliding, occasional white flash.
// ---------------------------------------------------------------------------
function makeBars(ctx) {
  const COLS = ['#ff0055', '#ff9500', '#ffee00', '#00e676', '#00b0ff', '#7c4dff', '#ff00cc', '#00ffd0'];
  const NB = 8;
  const BW = W / NB;
  return (t) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const scroll = (t * 60) % (BW * 2);
    for (let i = -2; i < NB + 2; i++) {
      const x = i * BW + scroll;
      const ci = ((i % COLS.length) + COLS.length) % COLS.length;
      ctx.fillStyle = COLS[ci];
      ctx.fillRect(x, 0, BW - 6, H);
    }
    // beat flash: a random-ish bar blows out white roughly twice a second
    const beat = Math.floor(t * 2.2);
    const flashP = t * 2.2 - beat;
    if (flashP < 0.18) {
      const bi = ((beat * 5 + 3) % NB + NB) % NB;
      ctx.fillStyle = `rgba(255,255,255,${1 - flashP / 0.18})`;
      ctx.fillRect(bi * BW + scroll - BW * 2, 0, BW - 6, H);
    }
    // full-frame strobe hit every ~4 s
    const hit = t % 4.1;
    if (hit < 0.08) {
      ctx.fillStyle = `rgba(255,255,255,${1 - hit / 0.08})`;
      ctx.fillRect(0, 0, W, H);
    }
  };
}

// ---------------------------------------------------------------------------
// embers — rising warm particles over a deep red-black gradient.
// ---------------------------------------------------------------------------
function makeEmbers(ctx) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0a0002');
  bg.addColorStop(0.62, '#2a040a');
  bg.addColorStop(1, '#571007');
  const N = 70;
  const ps = new Array(N);
  for (let i = 0; i < N; i++) {
    ps[i] = {
      x: Math.random() * W,
      y: Math.random() * H,
      r: 2 + Math.random() * 7,
      vy: 14 + Math.random() * 42,
      drift: (Math.random() - 0.5) * 1.6,
      ph: Math.random() * TAU,
      hot: Math.random(),
    };
  }
  // Pre-rendered blurred ember sprite: one radial-gradient stamp reused N times
  // (per-particle createRadialGradient every frame is an allocation storm).
  const [spr, sctx] = makeCanvas(32, 32);
  const g = sctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,240,200,1)');
  g.addColorStop(0.3, 'rgba(255,150,40,0.9)');
  g.addColorStop(0.7, 'rgba(255,60,10,0.35)');
  g.addColorStop(1, 'rgba(255,40,0,0)');
  sctx.fillStyle = g;
  sctx.fillRect(0, 0, 32, 32);
  return (t, dt) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < N; i++) {
      const p = ps[i];
      p.y -= p.vy * dt;
      p.x += Math.sin(t * 1.3 + p.ph) * p.drift;
      if (p.y < -12) {
        p.y = H + 12;
        p.x = Math.random() * W;
        p.vy = 14 + Math.random() * 42;
      }
      const flick = 0.55 + 0.45 * Math.sin(t * 7 + p.ph * 3);
      const s = p.r * 2.6 * (0.7 + p.hot * 0.6);
      ctx.globalAlpha = flick * (0.5 + p.hot * 0.5);
      ctx.drawImage(spr, p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };
}

// ---------------------------------------------------------------------------
// starfield — white/blue stars streaming outward from centre (warp).
// ---------------------------------------------------------------------------
function makeStarfield(ctx) {
  const N = 110;
  const st = new Array(N);
  const spawn = (s) => {
    const a = Math.random() * TAU;
    s.ax = Math.cos(a); s.ay = Math.sin(a);
    s.d = 2 + Math.random() * 30;      // distance from centre
    s.sp = 60 + Math.random() * 240;   // outward speed
    s.blue = Math.random() < 0.4;
  };
  for (let i = 0; i < N; i++) { st[i] = {}; spawn(st[i]); st[i].d = Math.random() * 260; }
  const MAXD = Math.hypot(W, H) * 0.55;
  return (t, dt) => {
    ctx.fillStyle = '#000004';
    ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round';
    const cx = W / 2, cy = H / 2;
    for (let i = 0; i < N; i++) {
      const s = st[i];
      const d0 = s.d;
      s.d += s.sp * dt * (0.4 + s.d / 90);   // accelerate outward
      if (s.d > MAXD) { spawn(s); continue; }
      const near = Math.min(1, s.d / 120);
      const streak = Math.max(2, (s.d - d0) * 2.2);
      const x1 = cx + s.ax * d0, y1 = cy + s.ay * d0 * (H / W) * 1.4;
      const x2 = cx + s.ax * (d0 + streak), y2 = cy + s.ay * (d0 + streak) * (H / W) * 1.4;
      ctx.strokeStyle = s.blue
        ? `rgba(120,180,255,${0.25 + near * 0.75})`
        : `rgba(255,255,255,${0.25 + near * 0.75})`;
      ctx.lineWidth = 1 + near * 3.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  };
}

// ---------------------------------------------------------------------------

export function initVideoPresets() {
  const [canvas, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const draws = {
    waves: makeWaves(ctx),
    aurora: makeAurora(ctx),
    rings: makeRings(ctx),
    bars: makeBars(ctx),
    embers: makeEmbers(ctx),
    starfield: makeStarfield(ctx),
  };
  const names = ['waves', 'aurora', 'rings', 'bars', 'embers', 'starfield'];

  const state = { preset: null };
  let t = 0;

  function setPreset(nameOrNull) {
    if (nameOrNull !== null && !draws[nameOrNull]) return;
    state.preset = nameOrNull;
    t = 0;
    if (nameOrNull === null) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      texture.needsUpdate = true;
    }
  }

  function update(dt) {
    if (state.preset === null) return;
    t += dt;
    draws[state.preset](t, dt);
    texture.needsUpdate = true;
  }

  // a visual drawn by someone else (main.js: the show itself): draw(ctx, t, dt, W, H)
  function addPreset(name, draw) { draws[name] = (t, dt) => draw(ctx, t, dt, W, H); }

  return { canvas, texture, setPreset, update, names, state, addPreset };
}
