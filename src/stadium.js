// Stadium venue: a Wembley-like open-air bowl around a regulation football
// pitch. The seating bowl itself comes from bowl.js (the same parametric
// sweep the arena uses, driven by the stadium spec in venue.js). This module
// builds what an arena does not have: the grass and its markings, the goals,
// the concert cover that goes down over the turf, the open sky over the bowl
// with corner floodlight pylons, and the ground-support roof a stadium
// show brings in over its stage.
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { boxTruss } from './truss.js';
import { BOWL_A, BOWL_B, topEdgeAt } from './bowl.js';
import { PITCH, SPEC } from './venue.js';
import { drawLogo, onLogo, LOGO_ASPECT } from './logo.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The grass plane runs wall to wall inside the bowl; the pitch sits centred
// on it, the run-off is grass too, and the last couple of metres before the
// first row are the dark rubber track.
export const FIELD_L = BOWL_A * 2 + 3, FIELD_W = BOWL_B * 2 + 3;

// ---------------------------------------------------------------------------
// Pitch texture: mown stripes, wear, and every line from the diagram drawn at
// its metre value (px per metre is exact, so a 120 mm line is a 120 mm line).
// ---------------------------------------------------------------------------
export function makePitchTexture(anisotropy) {
  const W = 4096, H = Math.round(W * FIELD_W / FIELD_L);
  const ppm = W / FIELD_L;
  const [c, ctx] = makeCanvas(W, H);
  const rand = mulberry32(4242);
  const X = (x) => W / 2 + x * ppm, Y = (z) => H / 2 + z * ppm, M = (m) => m * ppm;
  const { L, W: PW } = PITCH;

  // track beyond the run-off, then the turf
  ctx.fillStyle = '#2a2c31';
  ctx.fillRect(0, 0, W, H);
  const turfL = L + 2 * PITCH.runEnd, turfW = PW + 2 * PITCH.runSide;
  ctx.fillStyle = '#2f7a2c';
  ctx.fillRect(X(-turfL / 2), Y(-turfW / 2), M(turfL), M(turfW));
  // mown bands across the width, 21 over the length like the real pattern
  const bands = 21, bandW = L / bands;
  ctx.save();
  ctx.beginPath(); ctx.rect(X(-turfL / 2), Y(-turfW / 2), M(turfL), M(turfW)); ctx.clip();
  for (let i = -2; i < bands + 2; i++) {
    ctx.fillStyle = (i & 1) ? '#2b7328' : '#378f33';
    ctx.fillRect(X(-L / 2 + i * bandW), 0, M(bandW) + 1, H);
  }
  // blade noise: thousands of tiny tonal flecks, denser than the eye resolves
  for (let i = 0; i < 42000; i++) {
    const g = 96 + rand() * 60;
    ctx.fillStyle = `rgba(${g * 0.42},${g},${g * 0.36},${0.05 + rand() * 0.08})`;
    ctx.fillRect(rand() * W, rand() * H, 2 + rand() * 5, 1 + rand() * 3);
  }
  // wear: goalmouths and the centre go pale and a little brown
  const wear = (x, z, r, a) => {
    const g = ctx.createRadialGradient(X(x), Y(z), 0, X(x), Y(z), M(r));
    g.addColorStop(0, `rgba(122,108,60,${a})`); g.addColorStop(1, 'rgba(122,108,60,0)');
    ctx.fillStyle = g; ctx.fillRect(X(x - r), Y(z - r), M(2 * r), M(2 * r));
  };
  wear(-L / 2 + 3, 0, 9, 0.28); wear(L / 2 - 3, 0, 9, 0.28); wear(0, 0, 7, 0.16);
  ctx.restore();

  // --- lines ------------------------------------------------------------------
  ctx.strokeStyle = '#f3f5f1'; ctx.fillStyle = '#f3f5f1';
  ctx.lineWidth = M(PITCH.line); ctx.lineCap = 'butt';
  ctx.strokeRect(X(-L / 2), Y(-PW / 2), M(L), M(PW));                 // touch + goal lines
  ctx.beginPath(); ctx.moveTo(X(0), Y(-PW / 2)); ctx.lineTo(X(0), Y(PW / 2)); ctx.stroke();  // halfway
  ctx.beginPath(); ctx.arc(X(0), Y(0), M(PITCH.circleR), 0, Math.PI * 2); ctx.stroke();   // centre circle
  ctx.beginPath(); ctx.arc(X(0), Y(0), M(0.16), 0, Math.PI * 2); ctx.fill();               // centre mark
  for (const s of [-1, 1]) {
    const gx = s * L / 2;                                        // this end's goal line
    const inner = (d) => gx - s * d;                             // d metres into the pitch
    const boxX = Math.min(gx, inner(PITCH.penL));
    ctx.strokeRect(X(boxX), Y(-PITCH.penW / 2), M(PITCH.penL), M(PITCH.penW));    // penalty area
    const gaX = Math.min(gx, inner(PITCH.goalL));
    ctx.strokeRect(X(gaX), Y(-PITCH.goalW / 2), M(PITCH.goalL), M(PITCH.goalW));  // goal area
    ctx.beginPath(); ctx.arc(X(inner(PITCH.spot)), Y(0), M(0.16), 0, Math.PI * 2); ctx.fill();  // penalty mark
    // penalty arc: the part of the 9.15 m circle outside the area. The box
    // edge is 5.5 m from the mark, so the arc opens +-acos(5.5/9.15) around
    // the direction toward the centre of the pitch.
    const half = Math.acos((PITCH.penL - PITCH.spot) / PITCH.arcR);
    const toward = s > 0 ? Math.PI : 0;
    ctx.beginPath(); ctx.arc(X(inner(PITCH.spot)), Y(0), M(PITCH.arcR), toward - half, toward + half); ctx.stroke();
    // corner arcs: quarter circles inside the pitch
    for (const t of [-1, 1]) {
      const cz = t * PW / 2;
      const a0 = s > 0 ? (t > 0 ? Math.PI : Math.PI / 2) : (t > 0 ? -Math.PI / 2 : 0);
      ctx.beginPath(); ctx.arc(X(gx), Y(cz), M(PITCH.cornerR), a0, a0 + Math.PI / 2); ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

// concert cover: interlocking dark floor panels over the turf (the black
// deck in the stadium-show reference photo)
export function makeCoverTexture() {
  const [c, ctx] = makeCanvas(1024, 1024);
  const rand = mulberry32(99);
  ctx.fillStyle = '#23252a'; ctx.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 6000; i++) {
    const g = 28 + rand() * 30;
    ctx.fillStyle = `rgba(${g},${g + 2},${g + 6},${0.08 + rand() * 0.1})`;
    ctx.fillRect(rand() * 1024, rand() * 1024, 1 + rand() * 40, 1 + rand() * 3);
  }
  ctx.strokeStyle = 'rgba(8,9,12,0.9)'; ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {                 // 4 x 4 panels per tile
    ctx.beginPath(); ctx.moveTo(i * 256, 0); ctx.lineTo(i * 256, 1024); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 256); ctx.lineTo(1024, i * 256); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeNetTexture() {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(235,238,240,1)'; ctx.lineWidth = 3;
  for (let i = 0; i <= 8; i++) {
    ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 32); ctx.lineTo(256, i * 32); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------------------------------------------------------------------------
export function buildPitch(scene, anisotropy) {
  const group = new THREE.Group();
  // Lambert on purpose: a Standard material picks up the room environment at
  // grazing angles and the whole near half of the pitch washed out to pale
  // mint at eye level. Turf is about as diffuse as surfaces get.
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_L, FIELD_W),
    new THREE.MeshLambertMaterial({ map: makePitchTexture(anisotropy) }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = 0.02;    // clear of the slab below at 150 m depth precision
  grass.receiveShadow = true;
  group.add(grass);

  const coverTex = makeCoverTexture();
  coverTex.anisotropy = anisotropy;
  coverTex.repeat.set(FIELD_L / 4.8, FIELD_W / 4.8);      // 1.2 m panels
  const cover = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_L - 4, FIELD_W - 4),
    new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.62 }));
  cover.rotation.x = -Math.PI / 2;
  cover.position.y = 0.05;
  cover.receiveShadow = true;
  cover.visible = false;
  group.add(cover);

  // --- goals: 7.32 x 2.44 m, posts on the goal line, net raked back --------------
  const goals = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.45 });
  const netTex = makeNetTexture();
  const netMat = new THREE.MeshBasicMaterial({ map: netTex, alphaTest: 0.5, side: THREE.DoubleSide, color: 0xdfe3e6 });
  const post = (x, z, h, r = 0.06) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), white);
    m.position.set(x, h / 2, z); m.castShadow = true; return m;
  };
  const bar = (x0, z0, x1, z1, y, r = 0.06) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), white);
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    m.rotation.set(0, 0, Math.PI / 2);
    m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    return m;
  };
  const netPlane = (w, h, x, y, z, ry, rx = 0) => {
    const g = new THREE.PlaneGeometry(w, h);
    const m = new THREE.Mesh(g, netMat.clone());
    m.material.map = netTex.clone(); m.material.map.repeat.set(w / 0.9, h / 0.9); m.material.map.needsUpdate = true;
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0);
    return m;
  };
  const hz = PITCH.goalMouth / 2, GH = PITCH.goalH, DEPTH = 2.0, TOP_DEPTH = 0.9;
  for (const s of [-1, 1]) {
    const gx = s * PITCH.L / 2, bx = gx + s * DEPTH, tx = gx + s * TOP_DEPTH;
    goals.add(post(gx, -hz, GH), post(gx, hz, GH));
    goals.add(bar(gx, -hz - 0.06, gx, hz + 0.06, GH + 0.06));
    // back frame and stays
    goals.add(post(bx, -hz, 1.2, 0.03), post(bx, hz, 1.2, 0.03));
    goals.add(bar(bx, -hz, bx, hz, 1.2, 0.03));
    for (const t of [-1, 1]) goals.add(bar(gx, t * hz, tx, t * hz, GH + 0.02, 0.025));
    // net: back sheet, roof sheet, two sides
    goals.add(netPlane(PITCH.goalMouth, 1.25, bx, 0.62, 0, Math.PI / 2));
    const backLean = new THREE.Mesh(new THREE.PlaneGeometry(PITCH.goalMouth, Math.hypot(DEPTH - TOP_DEPTH, GH - 1.2)), netMat.clone());
    backLean.material.map = netTex.clone(); backLean.material.map.repeat.set(8, 2); backLean.material.map.needsUpdate = true;
    backLean.position.set((bx + tx) / 2, (1.2 + GH) / 2, 0);
    backLean.rotation.set(0, Math.PI / 2, 0);
    backLean.rotateX(-s * Math.atan2(DEPTH - TOP_DEPTH, GH - 1.2));
    goals.add(backLean);
    goals.add(netPlane(TOP_DEPTH, PITCH.goalMouth, (gx + tx) / 2, GH, 0, 0, -Math.PI / 2));
    for (const t of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(DEPTH, GH), netMat.clone());
      side.material.map = netTex.clone(); side.material.map.repeat.set(2.2, 2.7); side.material.map.needsUpdate = true;
      side.position.set((gx + bx) / 2, GH / 2, t * hz);
      goals.add(side);
    }
  }
  // corner flags
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    const pole = post(s * PITCH.L / 2, t * PITCH.W / 2, 1.5, 0.02);
    goals.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xffcc00, side: THREE.DoubleSide }));
    flag.position.set(s * PITCH.L / 2 - s * 0.2, 1.35, t * PITCH.W / 2);
    goals.add(flag);
  }
  group.add(goals);
  scene.add(group);

  return {
    group, grass, cover, goals,
    // what the floor is for each mode: turf with the goals in for football,
    // bare turf for the empty bowl, and protective decking over the whole
    // pitch for anything that brings its own floor (a show, the outdoor
    // rink, a court)
    setSurface(mode) {
      cover.visible = mode === 'concert' || mode === 'hockey' || mode === 'basketball';
      goals.visible = mode === 'football';
    },
  };
}

function makeSkyTexture() {
  // equirectangular, so the Milky Way can be painted as a tilted great circle
  // (a sine wave in these coordinates) and the horizon glow as a band
  const W = 2048, H = 1024;
  const [c, ctx] = makeCanvas(W, H);
  const rand = mulberry32(2024);
  const g = ctx.createLinearGradient(0, 0, 0, H);      // top → bottom
  // a deep night: near black overhead, only a low glow of light pollution
  g.addColorStop(0.00, '#000102');
  g.addColorStop(0.30, '#010307');
  g.addColorStop(0.46, '#040812');
  g.addColorStop(0.50, '#0c0c18');    // horizon: light pollution
  g.addColorStop(0.53, '#1d1614');
  g.addColorStop(0.56, '#080606');
  g.addColorStop(1.00, '#020203');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // city glow: warm patches sitting on the horizon, uneven like real skylines
  for (let i = 0; i < 14; i++) {
    const x = rand() * W, r = 120 + rand() * 260;
    const gg = ctx.createRadialGradient(x, H * 0.505, 0, x, H * 0.505, r);
    gg.addColorStop(0, `rgba(255,${150 + rand() * 60},${70 + rand() * 40},${0.07 + rand() * 0.06})`);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg; ctx.fillRect(x - r, H * 0.505 - r, r * 2, r);
  }
  // the Milky Way: a band along a tilted great circle, dust lane down its middle
  const band = (u) => 0.36 + 0.13 * Math.sin(u * Math.PI * 2 + 0.9);
  for (let i = 0; i < 2600; i++) {
    const u = rand(), spread = (rand() + rand() + rand() - 1.5) * 0.06;
    const x = u * W, y = (band(u) + spread) * H;
    const r = 10 + rand() * 60;
    const blue = rand() < 0.35;
    const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
    gg.addColorStop(0, blue ? `rgba(150,180,255,${0.008 + rand() * 0.011})` : `rgba(235,225,210,${0.007 + rand() * 0.011})`);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 700; i++) {   // dust: dark lanes threading the band
    const u = rand(), x = u * W, y = (band(u) + (rand() - 0.5) * 0.025) * H, r = 8 + rand() * 40;
    const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
    gg.addColorStop(0, `rgba(4,5,12,${0.12 + rand() * 0.18})`); gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // a couple of faint nebulae
  for (const [u, dv, col] of [[0.22, -0.02, '255,120,150'], [0.61, 0.03, '120,160,255'], [0.84, -0.04, '255,200,150']]) {
    const x = u * W, y = (band(u) + dv) * H, r = 70;
    const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
    gg.addColorStop(0, `rgba(${col},0.02)`); gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Stars as a point cloud with a magnitude distribution, colour temperature
// and a per-star twinkle, thicker along the Milky Way band. The shader draws
// each as a soft disc so bright stars bloom a little and faint ones stay pin
// sharp — flat white dots of one size are what made the old sky read as fake.
function makeStars(count = 3000) {   // a dark sky shows few: only the brighter stars
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count), phase = new Float32Array(count);
  const rand = mulberry32(77);
  const band = (u) => 0.36 + 0.13 * Math.sin(u * Math.PI * 2 + 0.9);
  const R = 1100;
  for (let i = 0; i < count; i++) {
    let u, v;
    if (rand() < 0.3) { u = rand(); v = band(u) + (rand() + rand() + rand() - 1.5) * 0.08; }    // in the band
    else { u = rand(); v = rand() * 0.5; }                                                     // anywhere above the horizon
    v = Math.min(0.495, Math.max(0.005, v));
    const lon = u * Math.PI * 2, lat = (0.5 - v) * Math.PI;   // v 0 = zenith, 0.5 = horizon
    pos[i * 3] = Math.cos(lon) * Math.cos(lat) * R;
    pos[i * 3 + 1] = Math.sin(lat) * R + 20;
    pos[i * 3 + 2] = Math.sin(lon) * Math.cos(lat) * R;
    // magnitude: most stars faint, a handful bright. Real stars are points —
    // the brightest few reach ~2 px, the rest sit at a pixel and glimmer
    const m = Math.pow(rand(), 3.4);
    size[i] = 0.55 + m * 1.55;
    // colour temperature: blue-white through white to warm
    const t = rand();
    const r = t < 0.25 ? 0.72 + t * 0.6 : 1.0, gch = t < 0.25 ? 0.8 + t * 0.4 : 1.0 - (t - 0.25) * 0.25, b = t < 0.25 ? 1.0 : 1.0 - (t - 0.25) * 0.7;
    col[i * 3] = r; col[i * 3 + 1] = gch; col[i * 3 + 2] = b;
    phase[i] = rand() * 6.283;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uPx: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aSize; attribute float aPhase;
      uniform float uTime; uniform float uPx;
      varying vec3 vCol; varying float vTw; varying float vB;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float tw = 0.86 + 0.14 * sin(uTime * (0.8 + fract(aPhase) * 2.2) + aPhase * 7.0);
        float m = clamp((aSize - 0.55) / 1.55, 0.0, 1.0);   // magnitude 0 faint .. 1 bright
        vTw = tw; vCol = aColor; vB = 0.32 + 0.68 * pow(m, 0.7);
        gl_PointSize = max(1.0, aSize * uPx * (0.92 + 0.16 * tw));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol; varying float vTw; varying float vB; uniform float uFade;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.3, d);
        gl_FragColor = vec4(vCol * (0.7 + 0.5 * vTw) * vB * 0.7 * uFade, a * uFade);
      }`,
  });
  return new THREE.Points(geo, mat);
}

// ---------------------------------------------------------------------------
// Open air. No roof and no roof structure at all — the bowl ends at its top
// row under the sky, and four corner pylons light the pitch like a classic
// uncovered ground. Returns the same shape buildCeiling does so
// main.js treats both rooms alike (banners empty, lampLenses = the floods).
// ---------------------------------------------------------------------------
export function buildStadiumSky(scene, lightPositions) {
  const group = new THREE.Group();

  // --- ground outside the bowl, sky, stars -----------------------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200),
    new THREE.MeshLambertMaterial({ color: 0x14161a }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.3;   // well under the turf: no depth fighting from the far stands
  group.add(ground);

  const skyMat = new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1150, 64, 32), skyMat);
  sky.rotation.y = 0.6;
  sky.renderOrder = -20;
  group.add(sky);
  const stars = makeStars();
  stars.rotation.y = 0.6;                    // the band and the star field share a sky
  stars.renderOrder = -19;
  group.add(stars);
  const starMat = stars.material;
  starMat.uniforms.uPx.value = Math.min(2, window.devicePixelRatio || 1);

  // --- corner pylons -----------------------------------------------------------
  // Tapered lattice masts outside the bowl, a railed maintenance platform, and
  // a bank of 32 luminaires per head, every one aimed at that pylon's quadrant
  // of the pitch. Aim comes from the spec's light TARGETS, not the pylon's own
  // position (which is how the first pass ended up facing outward).
  const steelGeos = [], darkGeos = [], lensGeos = [], shaftGeos = [];
  const halos = [];
  const haloTex = (() => {
    const [c, ctx] = makeCanvas(256, 256);
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,246,225,0.55)');
    g.addColorStop(0.15, 'rgba(255,240,210,0.22)');
    g.addColorStop(0.45, 'rgba(255,230,190,0.05)');
    g.addColorStop(1, 'rgba(255,220,170,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  // glare, not a moon: a small soft sprite whose opacity setLighting() owns
  const haloMat = new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, color: 0xfff4dd, opacity: 0.7 });
  const pylons = SPEC.houseLights.map(([x, z, , , tx, tz]) => ({ x, z, y: SPEC.lightY, tx, tz }));
  // a festival's lighting towers are scaffold, a third the height, with a
  // smaller bank of lamps (venue.js towerStyle)
  const short = SPEC.towerStyle === 'festival', K = short ? 0.42 : 1;
  for (const p of pylons) {
    // --- mast: three lattice segments, narrowing as they climb -----------------
    const segs = short ? [[0, p.y - 1.2, 1.5]] : [[0, 26, 4.4], [26, 50, 3.4], [50, p.y - 2.2, 2.5]];
    for (const [y0, y1, sec] of segs) {
      const t = boxTruss(y1 - y0, sec, 3.0);
      t.rotateZ(Math.PI / 2);
      t.translate(p.x, (y0 + y1) / 2, p.z);
      steelGeos.push(t);
    }
    const plinth = new THREE.BoxGeometry(7 * K, 1.6 * K, 7 * K);
    plinth.translate(p.x, 0.8 * K, p.z);
    darkGeos.push(plinth);
    // --- aim: yaw toward the target, pitch down to it ---------------------------
    const dx = p.tx - p.x, dz = p.tz - p.z, dh = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);                       // local +z → toward the target
    const tilt = Math.atan2(p.y, dh);                     // rotateX(+tilt) points +z downward
    const aim = (g) => { if (K !== 1) g.scale(K, K, K); g.rotateX(tilt); g.rotateY(yaw); g.translate(p.x, p.y, p.z); return g; };
    // --- platform under the head, railed ---------------------------------------
    const deck = new THREE.BoxGeometry(13, 0.18, 4.2);
    deck.translate(0, -2.2, 0.6);
    steelGeos.push(aim(deck));
    for (const sx of [-6.4, -3.2, 0, 3.2, 6.4]) for (const sz of [-1.4, 2.6]) {
      const post = new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6);
      post.translate(sx, -1.6, sz);
      steelGeos.push(aim(post));
    }
    for (const sz of [-1.4, 2.6]) for (const ry of [-1.1, -1.55]) {
      const rail = new THREE.BoxGeometry(12.9, 0.05, 0.05);
      rail.translate(0, ry, sz);
      steelGeos.push(aim(rail));
    }
    // --- the bank: 4 rows x 8 luminaires on two horizontal frame rails ----------
    for (const ry of [-0.9, 0.9]) {
      const rail = new THREE.CylinderGeometry(0.11, 0.11, 12.6, 8);
      rail.rotateZ(Math.PI / 2);
      rail.translate(0, ry, -0.35);
      steelGeos.push(aim(rail));
    }
    for (let col = 0; col < 8; col++) for (let row = 0; row < 4; row++) {
      const lx = (col - 3.5) * 1.55, ly = (row - 1.5) * 0.95;
      const body = new THREE.BoxGeometry(1.35, 0.8, 0.5);
      body.translate(lx, ly, 0);
      darkGeos.push(aim(body));
      const face = new THREE.PlaneGeometry(1.15, 0.62);
      face.translate(lx, ly, 0.26);
      lensGeos.push(aim(face));
    }
    // --- glare + beam: a soft halo at the head, a faint shaft toward the pitch --
    const halo = new THREE.Sprite(haloMat);
    const dir = new THREE.Vector3(dx, -p.y, dz).normalize();
    halo.position.set(p.x + dir.x * 2.5, p.y + dir.y * 2.5, p.z + dir.z * 2.5);
    halo.scale.set(9, 9, 1);
    group.add(halo);
    halos.push(halo);
    const len = Math.hypot(dh, p.y);
    const cone = new THREE.ConeGeometry(Math.tan(SPEC.spotAngle ?? 0.44) * len * 0.35, len, 28, 1, true);
    // ConeGeometry points +y with its tip at +len/2: swing +y onto the
    // head-ward direction so the tip sits at the lamps and the base at the pitch
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
    cone.applyQuaternion(q);
    cone.translate((p.x + p.tx) / 2, p.y / 2, (p.z + p.tz) / 2);
    shaftGeos.push(cone);
  }
  group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(steelGeos), new THREE.MeshLambertMaterial({ color: 0x9aa0a8, emissive: 0x1a1c20 })));
  group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(darkGeos), new THREE.MeshLambertMaterial({ color: 0x23262b })));
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xfff4dd, toneMapped: false, side: THREE.DoubleSide });
  lensMat.color.multiplyScalar(4);
  const lensMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(lensGeos), lensMat);
  group.add(lensMesh);
  // shafts share the arena's recipe: additive, strongest at the source, fading
  // out toward the pitch and at the silhouette so there is no hard edge
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uIntensity: { value: 0.014 } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv; vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; uniform float uIntensity;
      void main() {
        float t = clamp(vUv.y, 0.0, 1.0);
        float a = t * t * t * uIntensity * smoothstep(0.0, 0.1, t);
        a *= pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.4);
        gl_FragColor = vec4(1.0, 0.94, 0.82, a);
      }`,
  });
  const shafts = new THREE.Group();
  shafts.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(shaftGeos), shaftMat));
  group.add(shafts);

  // --- press box on the south sideline rim (the long building in the reference) --
  if (SPEC.key !== 'festival') {
    const top = topEdgeAt(1, true);
    const par = SPEC.bowl.parapet ?? 3.4;
    const z = -(BOWL_B + top.off + 1.2 + 3.5), y0 = top.y + par + 0.6;
    const L = 74, D = 8.5, H = 7.2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(L, H, D), new THREE.MeshLambertMaterial({ color: 0x353942 }));
    body.position.set(0, y0 + H / 2, z);
    group.add(body);
    // a lit window band facing the pitch, broken into panes
    const paneMat = new THREE.MeshBasicMaterial({ color: 0xd8cdb2 });
    for (let i = 0; i < 18; i++) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.0), paneMat);
      pane.position.set(-L / 2 + 2.8 + i * 3.95, y0 + H / 2 + 0.4, z + D / 2 + 0.03);
      group.add(pane);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(L + 5, 0.5, D + 5), new THREE.MeshLambertMaterial({ color: 0x9aa0a8, emissive: 0x15171b }));
    roof.position.set(0, y0 + H + 0.25, z);
    group.add(roof);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x5a5f68 });
    for (const x of [-32, -11, 11, 32]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.3, y0 - top.y, 1.3), legMat);
      leg.position.set(x, (y0 + top.y) / 2, z);
      group.add(leg);
    }
  }

  scene.add(group);
  return {
    group, banners: new THREE.Group(), lampLenses: [lensMesh], sky, shafts,
    tick(dt) { starMat.uniforms.uTime.value += dt; },
    // the sky follows the room's lighting state: dusk with the house up,
    // deep night for the show, near-black in a blackout
    setLighting(state) {
      const k = state === 'dark' ? 0.08 : state === 'house' ? 0.85 : 0.34;
      skyMat.color.setScalar(k);
      starMat.uniforms.uFade.value = state === 'house' ? 0.3 : 1.0;
      haloMat.opacity = state === 'dark' ? 0 : state === 'house' ? 0.45 : 0.7;   // glare follows the lamps
    },
  };
}

// ---------------------------------------------------------------------------
// Video boards over both end stands, standing on the parapet behind the last
// row like the reference stadium's end-zone screens. They share the video
// wall's material, so whatever the show routes to the screens plays here too.
// ---------------------------------------------------------------------------
// the PIXMOB logo and STADIUM, white with a blue glow on black: the board's name strip
function stadiumNameTexture(aspect) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = Math.round(2048 / aspect);
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  function paint() {
    g.fillStyle = '#05060a';
    g.fillRect(0, 0, c.width, c.height);
    // the PIXMOB logo, then STADIUM in the same white
    const lh = c.height * 0.56, lw = lh * LOGO_ASPECT, gap = c.height * 0.3;
    g.font = `900 ${Math.round(lh * 1.36)}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    const sw = g.measureText('STADIUM').width;
    const x0 = (c.width - (lw + gap + sw)) / 2;
    drawLogo(g, x0 + lw / 2, c.height * 0.5, lh, { glow: '#7f8cff', blur: c.height * 0.25 });
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.shadowColor = '#7f8cff';
    g.shadowBlur = c.height * 0.25;
    g.fillStyle = '#ffffff';
    g.fillText('STADIUM', x0 + lw + gap, c.height * 0.53);
    g.shadowBlur = 0;
    tex.needsUpdate = true;
  }
  paint();
  onLogo(paint);
  return tex;
}
export function buildEndBoards(scene, screenMat) {
  const group = new THREE.Group();
  const top = topEdgeAt(0);                          // the rim behind a goal
  const W = 36, H = 13.5;
  const x0 = BOWL_A + top.off + 1.2 + 1.6, y0 = top.y + (SPEC.bowl.parapet ?? 3.4) + 1.2 + H / 2;
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x1c1f24 });
  const steelMat = new THREE.MeshLambertMaterial({ color: 0x5a5f68 });
  // the house name, lit, in a strip along the top of each board
  const SH = 3.2;
  const nameMat = new THREE.MeshBasicMaterial({ map: stadiumNameTexture(W / SH), toneMapped: false });
  nameMat.color.setScalar(1.35);   // past the bloom gate: the letters glow like the arena's board
  for (const s of [-1, 1]) {
    const name = new THREE.Mesh(new THREE.PlaneGeometry(W, SH), nameMat);
    name.position.set(s * (x0 - 0.02), y0 + H / 2 + 0.8 + SH / 2, 0);
    name.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(name);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.4, SH + 0.6, W + 1.8), frameMat);
    back.position.set(s * (x0 + 0.75), name.position.y, 0);
    group.add(back);
  }
  for (const s of [-1, 1]) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), screenMat);
    face.position.set(s * x0, y0, 0);
    face.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;   // face the pitch
    group.add(face);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.4, H + 1.6, W + 1.8), frameMat);
    frame.position.set(s * (x0 + 0.75), y0, 0);
    group.add(frame);
    for (const z of [-W * 0.32, W * 0.32]) {          // legs down to the parapet
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, y0 - H / 2 - top.y + 0.2, 0.9), steelMat);
      leg.position.set(s * (x0 + 0.6), (y0 - H / 2 + top.y - 0.2) / 2, z);
      group.add(leg);
    }
  }
  scene.add(group);
  return group;
}

// ---------------------------------------------------------------------------
// Ground-support roof over the end stage: four towers and a flat truss grid
// at the rig's hoist height, with a skin on top. Stadium shows bring their
// own steel; the house roof is open over the pitch.
// ---------------------------------------------------------------------------
export function buildStageRoof(scene) {
  const g = new THREE.Group();
  const back = SPEC.stageBack + 0.8, front = SPEC.downstageX + 7.0, hz = 22.0, y = SPEC.roofY;
  const mat = new THREE.MeshLambertMaterial({ color: 0x2e3136, emissive: 0x0c0d10 });
  const geos = [];
  for (const x of [back, front]) for (const z of [-hz, hz]) {
    const t = boxTruss(y + 1.4, 1.3, 2.0);
    t.rotateZ(Math.PI / 2);                    // +x → up
    t.translate(x, (y + 1.4) / 2, z);
    geos.push(t);
  }
  const span = front - back;
  for (let x = back; x <= front + 0.01; x += span / 4) {
    const t = boxTruss(hz * 2, 1.4, 2.0);
    t.rotateY(Math.PI / 2);
    t.translate(x, y + 0.7, 0);
    geos.push(t);
  }
  for (const z of [-hz, 0, hz]) {
    const t = boxTruss(span, 1.4, 2.0);
    t.translate((back + front) / 2, y + 0.7, z);
    geos.push(t);
  }
  g.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(geos), mat));
  const skin = new THREE.Mesh(new THREE.BoxGeometry(span + 2.4, 0.3, hz * 2 + 2.4),
    new THREE.MeshLambertMaterial({ color: 0x1c1e23 }));
  skin.position.set((back + front) / 2, y + 1.55, 0);
  g.add(skin);
  g.visible = false;
  scene.add(g);
  return g;
}
