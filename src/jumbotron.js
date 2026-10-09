// The centre-hung video board: a big oval HALO in the style of the modern
// NBA boards. Screens run all the way round the outside, a second ring of
// screens faces in (the view from the floor, looking up into it), a smaller
// ring hangs underneath, and a 360-degree ring screen on top reads
// PIXMOB ARENA. The long sides carry the live scoreboard canvas from
// textures.js (so the console's jumbotron modes still drive it); the ends
// carry the Limitless Center mark; behind everything runs a field of moving
// light streaks.
//
// Every band is one strip of triangles following a rounded rectangle, with
// its texture wrapped round it. The screens share one small shader: the
// streaks scroll on the GPU, and the panels on top only re-upload when the
// scoreboard itself redraws (once a second).
import * as THREE from 'three';
import { drawLogo, onLogo, LOGO_ASPECT } from './logo.js';

const A = 7.2, B = 4.6, R = 3.0;   // plan of the main board: half length, half width, corner radius (m)
const H = 6.0;                      // main screen height
const T = 0.7;                      // depth of the ring between the outer and inner screens
const GLOW = 1.1;                   // screen level: bright, just under the bloom gate

// --- the rounded rectangle ------------------------------------------------------
const perimeter = (a, b, r) => 4 * (a - r) + 4 * (b - r) + 2 * Math.PI * r;
// the point `d` metres round, starting an eighth of the way before the middle
// of the +z side (so every side's middle lands on an eighth of the texture,
// clear of its seam), with its outward normal
function pointAt(a, b, r, d) {
  const sx = a - r, sz = b - r, q = (Math.PI / 2) * r;
  const L = [2 * sx, q, 2 * sz, q, 2 * sx, q, 2 * sz, q];
  const P = perimeter(a, b, r);
  d = (((d - P / 8 + sx) % P) + P) % P;
  let i = 0;
  while (i < 7 && d > L[i]) { d -= L[i]; i++; }
  const t = L[i] ? d / L[i] : 0;
  const arc = (cx, cz, a0) => { const g = a0 + (t * Math.PI) / 2; return { x: cx + Math.cos(g) * r, z: cz + Math.sin(g) * r, nx: Math.cos(g), nz: Math.sin(g) }; };
  switch (i) {
    case 0: return { x: sx - 2 * sx * t, z: b, nx: 0, nz: 1 };
    case 1: return arc(-sx, sz, Math.PI / 2);
    case 2: return { x: -a, z: sz - 2 * sz * t, nx: -1, nz: 0 };
    case 3: return arc(-sx, -sz, Math.PI);
    case 4: return { x: -sx + 2 * sx * t, z: -b, nx: 0, nz: -1 };
    case 5: return arc(sx, -sz, -Math.PI / 2);
    case 6: return { x: a, z: -sz + 2 * sz * t, nx: 1, nz: 0 };
    default: return arc(sx, sz, 0);
  }
}
// A band round the rectangle from y0 to y1. Facing out, its texture reads
// left to right from outside; facing in, left to right from inside.
function band(a, b, r, y0, y1, inward, n = 160) {
  const P = perimeter(a, b, r);
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const p = pointAt(a, b, r, (i / n) * P);
    pos.push(p.x, y0, p.z, p.x, y1, p.z);
    const u = inward ? i / n : 1 - i / n;
    uv.push(u, 0, u, 1);
  }
  for (let i = 0; i < n; i++) {
    const k = i * 2;
    if (inward) idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    else idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// the flat ring between two rounded rectangles (or the whole inner one), at y
function cap(a, b, r, hole, y, up) {
  const shape = (aa, bb, rr) => {
    const s = new THREE.Shape();
    const n = 48;
    const P = perimeter(aa, bb, rr);
    for (let i = 0; i <= n; i++) {
      const p = pointAt(aa, bb, rr, (i / n) * P);
      if (i === 0) s.moveTo(p.x, -p.z); else s.lineTo(p.x, -p.z);
    }
    return s;
  };
  const outer = shape(a, b, r);
  if (hole) outer.holes.push(shape(a - hole, b - hole, r - hole));
  const g = new THREE.ShapeGeometry(outer);
  g.rotateX(-Math.PI / 2);
  if (!up) g.rotateX(Math.PI);   // facing down
  g.translate(0, y, 0);
  return g;
}

// --- what the screens show -------------------------------------------------------
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
// Light streaks on deep blue, tiling left to right: the board's background.
function makeStreaks() {
  const W = 1024, Hh = 256;
  const [c, g] = canvas(W, Hh);
  const base = g.createLinearGradient(0, 0, 0, Hh);
  base.addColorStop(0, '#15185c');
  base.addColorStop(0.5, '#2c34a8');
  base.addColorStop(1, '#101149');
  g.fillStyle = base;
  g.fillRect(0, 0, W, Hh);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cols = ['#ffffff', '#d7d2ff', '#9aaaff', '#6f7dff', '#ffbe55', '#ff8a2a'];
  for (let i = 0; i < 90; i++) {
    const y = rnd() * Hh, len = 120 + rnd() * 560, th = 2 + rnd() * 16, x = rnd() * W;
    const col = cols[Math.floor(rnd() * cols.length)];
    g.globalAlpha = 0.25 + rnd() * 0.65;
    for (const ox of [0, -W]) {   // drawn twice so a streak crossing the edge wraps
      const lg = g.createLinearGradient(x + ox, 0, x + ox + len, 0);
      lg.addColorStop(0, 'rgba(0,0,0,0)');
      lg.addColorStop(0.55, col);
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = lg;
      g.fillRect(x + ox, y - th / 2, len, th);
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
// the PIXMOB ARENA mark, centred at (x, y), `h` tall
function drawMark(g, x, y, h) {
  g.save();
  g.translate(x, y);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  drawLogo(g, 0, -h * 0.12, h * 0.26, { glow: '#7f8cff', blur: h * 0.18 });   // the PIXMOB logo
  g.shadowBlur = h * 0.18;
  g.shadowColor = '#ffb347';
  g.fillStyle = '#ffc56a';
  g.font = `800 ${Math.round(h * 0.17)}px "Helvetica Neue", Arial, sans-serif`;
  g.fillText('A R E N A', 0, h * 0.24);
  g.restore();
}
// The panels over the streaks: the scoreboard on the long sides, the mark on
// the ends. Outside and inside the sides fall at different places round the
// texture, so each gets its own.
function makePanels(inward) {
  const W = 2048, Hh = Math.round((W * H) / perimeter(A, B, R));
  const [c, g] = canvas(W, Hh);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  // where each side's middle lands: an eighth in, then every quarter
  // (outside the long sides are at 3/8 and 7/8; inside at 1/8 and 5/8)
  const long = inward ? [1 / 8, 5 / 8] : [3 / 8, 7 / 8];
  const ends = inward ? [3 / 8, 7 / 8] : [1 / 8, 5 / 8];
  let last = null;
  function draw(score) {
    last = score;
    g.clearRect(0, 0, W, Hh);
    const sh = Hh * 0.86, sw = sh * 1.6;
    for (const u of long) {
      const x = u * W - sw / 2, y = (Hh - sh) / 2;
      g.fillStyle = 'rgba(4,5,12,0.92)';
      g.fillRect(x - 8, y - 8, sw + 16, sh + 16);
      if (score) g.drawImage(score, x, y, sw, sh);
    }
    for (const u of ends) drawMark(g, u * W, Hh / 2, Hh * 0.9);
    t.needsUpdate = true;
  }
  onLogo(() => draw(last));   // the ends get the logo as soon as it has loaded
  return { texture: t, draw };
}
// The 360 ring on top: PIXMOB ARENA, one pass of it per repeat.
function makeCrownText() {
  const [c, g] = canvas(2048, 200);
  function paint() {
    const bg = g.createLinearGradient(0, 0, 0, 200);
    bg.addColorStop(0, '#070a26');
    bg.addColorStop(0.5, '#0d1450');
    bg.addColorStop(1, '#070a26');
    g.fillStyle = bg;
    g.fillRect(0, 0, 2048, 200);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    // the PIXMOB logo, then ARENA in the same weight, the pair 1500 px wide
    const lh = 96, lw = lh * LOGO_ASPECT, gap = 44;
    g.font = `900 ${Math.round(lh * 1.36)}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    const aw = g.measureText('ARENA').width;
    const x0 = 1024 - 60 - (lw + gap + aw) / 2;
    drawLogo(g, x0 + lw / 2, 104, lh, { glow: '#8fa0ff', blur: 26 });
    g.shadowColor = '#8fa0ff';
    g.shadowBlur = 26;
    g.fillStyle = '#ffffff';
    g.fillText('ARENA', x0 + lw + gap, 106);
    g.textAlign = 'center';
    g.shadowColor = '#ffb347';
    g.fillStyle = '#ffc56a';
    g.font = `900 ${Math.round(lh * 0.85)}px Arial, sans-serif`;
    g.fillText('◆', 1024 + 790, 104);
    g.fillText('◆', 1024 - 910, 104);
    g.shadowBlur = 0;
    if (t) t.needsUpdate = true;
  }
  let t = null;
  paint();
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  onLogo(paint);   // redrawn with the logo once it has loaded
  return t;
}

// the screen material: scrolling streaks with a panel texture over them
function screenMaterial(streaks, panels, repeat, videoRepeat = repeat) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uStreaks: { value: streaks }, uPanels: { value: panels },
      uTime: { value: 0 }, uRepeat: { value: repeat }, uLevel: { value: GLOW },
      // a real film instead of the board's graphics (setVideo): one 16:9 frame per stretch of screen
      uVideo: { value: null }, uUseVideo: { value: 0 }, uVRepeat: { value: videoRepeat },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uStreaks;
      uniform sampler2D uPanels;
      uniform float uTime;
      uniform float uRepeat;
      uniform float uLevel;
      uniform sampler2D uVideo;
      uniform float uUseVideo;
      uniform float uVRepeat;
      varying vec2 vUv;
      void main() {
        vec3 bg = texture2D(uStreaks, vec2(vUv.x * uRepeat - uTime * 0.045, vUv.y)).rgb;
        vec4 p = texture2D(uPanels, vUv);
        vec3 col = mix(bg, p.rgb, p.a);
        if (uUseVideo > 0.5) col = texture2D(uVideo, vec2(fract(vUv.x * uVRepeat), vUv.y)).rgb;
        gl_FragColor = vec4(col * uLevel, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function buildJumbotron(scene, scoreTex) {
  const grp = new THREE.Group();
  grp.name = 'jumbotron';
  const housing = new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.6, metalness: 0.45 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1b1d23, roughness: 0.35, metalness: 0.8 });
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); grp.add(m); return m; };

  const streaks = makeStreaks();
  const outerPanels = makePanels(false), innerPanels = makePanels(true);
  const repeatFor = (a, b, r, h) => Math.max(1, Math.round(perimeter(a, b, r) / h / 4));
  const filmsFor = (a, b, r, h) => Math.max(1, Math.round(perimeter(a, b, r) / (h * 16 / 9)));   // 16:9 frames round the band
  const outerMat = screenMaterial(streaks, outerPanels.texture, repeatFor(A, B, R, H), filmsFor(A, B, R, H));
  const innerMat = screenMaterial(streaks, innerPanels.texture, repeatFor(A - T, B - T, R - T, H), filmsFor(A - T, B - T, R - T, H));

  // the main board: screens outside, screens inside, a housing ring between
  add(band(A, B, R, -H / 2, H / 2, false), outerMat);
  add(band(A - T, B - T, R - T, -H / 2 + 0.25, H / 2 - 0.25, true), innerMat);
  add(cap(A + 0.06, B + 0.06, R + 0.06, T + 0.12, H / 2 + 0.02, true), housing);
  add(cap(A + 0.06, B + 0.06, R + 0.06, T + 0.12, -H / 2 - 0.02, false), housing);
  add(cap(A - T, B - T, R - T, 0, H / 2 - 0.25, false), housing);   // the lid over the inside, seen from below
  // bezels at the screen's top and bottom edges
  for (const y of [H / 2, -H / 2]) add(band(A + 0.05, B + 0.05, R + 0.05, y - 0.09, y + 0.09, false), trim);

  // the 360 ring screen on top, on a short plinth
  const ca = A - 0.35, cb = B - 0.35, cr = R - 0.35, cy0 = H / 2 + 0.35, CH = 1.3;
  add(band(ca + 0.02, cb + 0.02, cr + 0.02, H / 2, cy0, false), housing);
  const crownTex = makeCrownText();
  crownTex.repeat.x = Math.max(2, Math.round(perimeter(ca, cb, cr) / 13.5));
  const crownMat = new THREE.MeshBasicMaterial({ map: crownTex });
  crownMat.color.setScalar(1.15);
  add(band(ca, cb, cr, cy0, cy0 + CH, false), crownMat);
  add(band(ca - 0.08, cb - 0.08, cr - 0.08, cy0, cy0 + CH, true), housing);
  add(cap(ca + 0.06, cb + 0.06, cr + 0.06, 0, cy0 + CH + 0.02, true), housing);
  for (const y of [cy0, cy0 + CH]) add(band(ca + 0.04, cb + 0.04, cr + 0.04, y - 0.05, y + 0.05, false), trim);

  // the ring hanging underneath: smaller screens, the mark on every side
  const ba = 4.4, bb = 2.9, br = 1.9, by1 = -H / 2 - 0.55, BH = 1.6;
  const [bc, bg] = canvas(2048, Math.round((2048 * BH) / perimeter(ba, bb, br)));
  for (const u of [1 / 8, 3 / 8, 5 / 8, 7 / 8]) drawMark(bg, u * 2048, bc.height / 2, bc.height * 0.95);
  const bellyTex = new THREE.CanvasTexture(bc);
  bellyTex.colorSpace = THREE.SRGBColorSpace;
  const bellyMat = screenMaterial(streaks, bellyTex, repeatFor(ba, bb, br, BH) * 2);
  add(band(ba, bb, br, by1 - BH, by1, false), bellyMat);
  add(band(ba - 0.1, bb - 0.1, br - 0.1, by1 - BH, by1, true), housing);
  add(cap(ba + 0.05, bb + 0.05, br + 0.05, 0, by1 - BH - 0.02, false), housing);
  for (const y of [by1, by1 - BH]) add(band(ba + 0.04, bb + 0.04, br + 0.04, y - 0.06, y + 0.06, false), trim);
  // what the belly hangs from
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.16), trim);
    post.position.set(sx * (ba - 1.2), -H / 2 - 0.27, sz * (bb - 0.8));
    grp.add(post);
  }

  // rigging up into the grid
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.5, metalness: 0.8 });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 20, 6), cableMat);
    cable.position.set(sx * ca * 0.55, cy0 + CH + 10, sz * cb * 0.55);
    grp.add(cable);
  }

  // the scoreboard canvas feeds the panels whenever it redraws
  const score = scoreTex?.image || null;
  let seen = -1;
  function refresh() {
    outerPanels.draw(score);
    innerPanels.draw(score);
    seen = scoreTex ? scoreTex.version : 0;
  }
  refresh();

  let t = 0, on = true;
  grp.tick = (dt) => {
    t += dt;
    for (const m of [outerMat, innerMat, bellyMat]) m.uniforms.uTime.value = t;
    crownTex.offset.x = (t * 0.012) % 1;
    if (scoreTex && scoreTex.version !== seen) refresh();
  };
  // screens on or off (off: black, the board a dark shape in a dark room),
  // and how bright they are drawn when on (the panel's screen glow)
  let level = 1;
  const show = () => {
    for (const m of [outerMat, innerMat, bellyMat]) m.uniforms.uLevel.value = on ? GLOW * level : 0;
    crownMat.color.setScalar(on ? 1.15 * level : 0);
  };
  grp.setScreens = (v) => { on = !!v; show(); };
  // the screens play a film (a VideoTexture), or go back to the board's own graphics (null)
  grp.setVideo = (tex) => {
    for (const m of [outerMat, innerMat, bellyMat]) { m.uniforms.uVideo.value = tex || null; m.uniforms.uUseVideo.value = tex ? 1 : 0; }
  };
  grp.setLevel = (k) => { level = Math.max(0, +k || 0); show(); };
  Object.defineProperty(grp, 'screensOn', { get: () => on });

  scene.add(grp);
  return grp;
}
