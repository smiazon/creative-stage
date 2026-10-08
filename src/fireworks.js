// Real-scale fireworks for the open-air stadium — the OUTDOOR pyro. Shells
// fire from mortar racks ringed round the outside of the bowl, climb for four
// or five seconds on a twisting glitter tail, and break 150-320 m up into
// bursts 80-220 m across: peonies, chrysanthemums with glitter trails,
// willows that droop for eight seconds, palms, rings, hearts, crossettes that
// split in flight, strobes, colour-change shells and salutes. Every star is
// physics: gravity plus linear drag toward the wind, solved in closed form in
// the vertex shader, so a quarter-million sparks cost one draw call and no
// per-frame upload beyond what was just born.
//
//   v(t) = w + g/k + (v0 - w - g/k) e^{-kt}
//   p(t) = p0 + (w + g/k) t + (v0 - w - g/k)(1 - e^{-kt}) / k
//
// The stage pyro (pyrofx.js) stays the INDOOR package: this module never
// touches the rig. Sound is its own tiny synth (a thump and a low boom, each
// delayed by distance at 343 m/s), so a far shell is heard after it is seen.
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { BOWL_A, BOWL_B, BOWL_R, BOWL_OUTER_OFF, roundedRectPath } from './bowl.js';

const G = 9.81;
const POOL = 327680;              // sparks alive at once (ring buffer)
const SHELL_K = 0.32;             // a lifting shell's drag: fast off the mortar, slow at the top
const WIND = new THREE.Vector3(1.1, 0, 0.55);

// bloom gates on max(r,g,b) > 1.25: everything here is written well above it
const PAL = {
  red: [2.4, 0.32, 0.28], gold: [2.3, 1.5, 0.55], green: [0.45, 2.2, 0.6], blue: [0.5, 0.9, 2.5],
  purple: [1.9, 0.5, 2.4], silver: [2.1, 2.1, 2.25], orange: [2.4, 1.0, 0.28], pink: [2.4, 0.7, 1.5],
  cyan: [0.45, 2.1, 2.4], lime: [1.5, 2.4, 0.4], white: [2.5, 2.4, 2.2], amber: [2.3, 1.15, 0.32],
};
const MIXED = ['red', 'blue', 'green', 'purple', 'pink', 'orange', 'cyan', 'lime'];

// Shell recipes. n stars, v burst speed (m/s), k star drag, life (s), size
// (m, apparent glow), trail = glitter samples behind each star, lag = seconds
// between samples. Speeds and counts scale with the shell's calibre.
const TYPES = {
  peony:     { n: 1000, v: 44, k: 1.05, life: 3.4, size: 1.6, two: 0.45, pal: MIXED, boom: 1 },
  chrys:     { n: 900, v: 42, k: 1.0, life: 3.9, size: 1.5, trail: 5, lag: 0.07, glitter: 1, pal: ['gold', 'silver', 'amber', 'white'], boom: 1 },
  willow:    { n: 480, v: 24, k: 0.5, life: 8.0, size: 1.3, trail: 8, lag: 0.13, glitter: 1, pal: ['gold', 'amber'], boom: 0.8 },
  palm:      { n: 16, v: 40, k: 0.85, life: 3.4, size: 3.4, trail: 12, lag: 0.05, glitter: 1, pal: ['gold', 'amber', 'orange'], hemi: 1,
               core: { n: 220, v: 18, k: 1.2, life: 2.2, size: 1.2, pal: ['gold', 'white'] }, boom: 1 },
  ring:      { n: 260, v: 48, k: 1.2, life: 3.2, size: 1.8, shape: 'ring', pal: ['red', 'blue', 'cyan', 'pink', 'lime', 'purple'], boom: 0.9 },
  saturn:    { n: 240, v: 50, k: 1.2, life: 3.2, size: 1.7, shape: 'ring', pal: ['cyan', 'pink', 'lime'],
               core: { n: 480, v: 26, k: 1.1, life: 3.0, size: 1.4, pal: ['gold', 'white'] }, boom: 1 },
  crossette: { n: 60, v: 30, k: 0.9, life: 1.15, size: 2.6, trail: 6, lag: 0.05, glitter: 1, pal: ['gold', 'silver'],
               split: { n: 4, v: 15, k: 1.2, life: 1.7, size: 1.5 }, boom: 0.9 },
  kamuro:    { n: 850, v: 30, k: 0.85, life: 6.5, size: 1.3, trail: 7, lag: 0.1, glitter: 1, pal: ['gold'], boom: 1 },
  strobe:    { n: 520, v: 36, k: 1.0, life: 5.0, size: 1.9, strobe: 1, pal: ['white', 'silver', 'cyan'], boom: 0.9 },
  dahlia:    { n: 300, v: 56, k: 1.3, life: 3.4, size: 2.6, pal: ['red', 'orange', 'blue', 'purple'], boom: 1.1 },
  change:    { n: 950, v: 42, k: 1.05, life: 3.9, size: 1.6, change: 1.3, pal: ['red', 'blue', 'green', 'purple'], pal2: ['gold', 'silver', 'white', 'cyan'], boom: 1 },
  heart:     { n: 320, v: 46, k: 1.2, life: 3.2, size: 1.8, shape: 'heart', pal: ['red', 'pink'], boom: 0.9 },
  star5:     { n: 340, v: 46, k: 1.2, life: 3.2, size: 1.8, shape: 'star', pal: ['gold', 'cyan', 'white'], boom: 0.9 },
  horsetail: { n: 90, v: 16, k: 0.45, life: 6.5, size: 1.8, trail: 10, lag: 0.12, glitter: 1, pal: ['silver', 'white'], boom: 0.7 },
  salute:    { n: 36, v: 30, k: 1.5, life: 0.6, size: 2.2, flash: 3, pal: ['white'], boom: 1.6 },
};
// calibre (inches) -> break height (m) and the scale of everything else
const CAL = { 6: { h: 165, s: 0.8 }, 8: { h: 215, s: 1.0 }, 10: { h: 265, s: 1.25 }, 12: { h: 320, s: 1.55 } };

// muzzle speed that tops out at h under gravity + linear drag (bisection)
function v0ForHeight(h, k) {
  const apex = (v0) => {
    const T = Math.log((v0 + G / k) / (G / k)) / k;
    return -(G / k) * T + (v0 + G / k) * (1 - Math.exp(-k * T)) / k;
  };
  let lo = 20, hi = 400;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (apex(mid) < h) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
function apexTime(v0, k) { return Math.log((v0 + G / k) / (G / k)) / k; }

// --- the spark pool ------------------------------------------------------------------
function makeSparks() {
  const geo = new THREE.BufferGeometry();
  const p0 = new Float32Array(POOL * 3), v0 = new Float32Array(POOL * 3);
  const tt = new Float32Array(POOL * 4), qq = new Float32Array(POOL * 4);
  const c1 = new Float32Array(POOL * 3), c2 = new Float32Array(POOL * 3);
  // born in the far past, so nothing draws until it is written
  for (let i = 0; i < POOL; i++) { tt[i * 4] = -1e6; tt[i * 4 + 1] = 1; }
  const A = {
    p0: new THREE.BufferAttribute(p0, 3), v0: new THREE.BufferAttribute(v0, 3),
    tt: new THREE.BufferAttribute(tt, 4), qq: new THREE.BufferAttribute(qq, 4),
    c1: new THREE.BufferAttribute(c1, 3), c2: new THREE.BufferAttribute(c2, 3),
  };
  for (const a of Object.values(A)) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', A.p0);
  geo.setAttribute('aV0', A.v0);
  geo.setAttribute('aT', A.tt);
  geo.setAttribute('aQ', A.qq);
  geo.setAttribute('aC1', A.c1);
  geo.setAttribute('aC2', A.c2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uWind: { value: WIND } },
    vertexShader: /* glsl */`
      attribute vec3 aV0; attribute vec4 aT; attribute vec4 aQ; attribute vec3 aC1; attribute vec3 aC2;
      uniform float uTime; uniform float uScale; uniform vec3 uWind;
      varying vec3 vCol; varying float vA;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float birth = aT.x, life = aT.y, lag = aT.z, lagMax = aT.w;
        float t = uTime - birth - lag;
        if (t < 0.0 || t > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; vCol = vec3(0.0); return; }
        float k = max(aQ.x, 0.02);
        vec3 g = vec3(0.0, -9.81, 0.0);
        vec3 term = uWind + g / k;
        vec3 p = position + term * t + (aV0 - term) * (1.0 - exp(-k * t)) / k;
        float u = t / life;
        float fade = pow(1.0 - u, 1.35);
        float flags = aQ.z;
        float seed = fract(position.x * 0.371 + position.z * 0.913 + aV0.y * 0.17 + aV0.x * 0.05);
        bool glitter = mod(flags, 2.0) >= 1.0;
        bool strobe = mod(floor(flags / 2.0), 2.0) >= 1.0;
        bool change = mod(floor(flags / 4.0), 2.0) >= 1.0;
        bool ember = mod(floor(flags / 8.0), 2.0) >= 1.0;
        // glitter: each star sparkles at ~14 Hz, its own phase, never below a third
        if (glitter) fade *= 0.35 + 0.65 * hash(floor((t + seed * 7.0) * 14.0) + seed * 91.0);
        // strobe stars: hard on/off at 6 Hz, random phase, the last second stutters out
        if (strobe) fade *= step(0.5, fract(t * 6.0 + seed)) * (1.0 + 0.6 * step(0.8, u) * hash(floor(t * 30.0)));
        vec3 col = aC1;
        if (change) col = t > aQ.w ? aC2 : aC1;                        // colour-change shell
        else if (ember) col = mix(aC1, aC2, smoothstep(0.5, 1.0, u));  // dies down into its ember colour
        float trail = lagMax > 0.0 ? (1.0 - lag / lagMax) : 1.0;
        fade *= mix(1.0, trail * trail, step(0.001, lagMax));
        vCol = col; vA = fade;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float size = aQ.y * mix(1.0, 0.4 + 0.6 * trail, step(0.001, lagMax));
        gl_PointSize = clamp(size * uScale / max(1.0, -mv.z), 1.5, 96.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol; varying float vA;
      void main() {
        if (vA <= 0.002) discard;
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float a = smoothstep(1.0, 0.3, d);
        float core = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vCol * (a * 0.65 + core * 0.95) * vA, 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return { pts, mat, A, p0, v0, tt, qq, c1, c2 };
}

// --- smoke: the grey puffs a break leaves hanging, drifting off on the wind ------------
function makeSmoke(n = 64) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), tt = new Float32Array(n * 2), sz = new Float32Array(n);
  for (let i = 0; i < n; i++) { tt[i * 2] = -1e6; tt[i * 2 + 1] = 1; }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aT', new THREE.BufferAttribute(tt, 2).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aS', new THREE.BufferAttribute(sz, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending, fog: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uWind: { value: WIND }, uLit: { value: new THREE.Color(0.35, 0.35, 0.38) } },
    vertexShader: /* glsl */`
      attribute vec2 aT; attribute float aS;
      uniform float uTime; uniform float uScale; uniform vec3 uWind;
      varying float vA; varying float vSeed;
      void main() {
        float t = uTime - aT.x;
        if (t < 0.0 || t > aT.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
        float u = t / aT.y;
        vec3 p = position + uWind * t * 1.6 + vec3(0.0, 1.2 * t, 0.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = 0.26 * smoothstep(0.0, 0.08, u) * pow(1.0 - u, 1.3);
        vSeed = fract(position.x * 0.13 + position.z * 0.71);
        float size = aS * (0.55 + 0.9 * sqrt(u));
        gl_PointSize = clamp(size * uScale / max(1.0, -mv.z), 2.0, 420.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA; varying float vSeed; uniform vec3 uLit;
      void main() {
        if (vA <= 0.002) discard;
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        // lumpy edge: three offset discs beat one perfect circle
        float lump = 0.82 + 0.18 * sin(atan(c.y, c.x) * 5.0 + vSeed * 20.0);
        float a = smoothstep(lump, lump * 0.25, d);
        gl_FragColor = vec4(uLit, a * vA);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return { pts, mat, pos, tt, sz, n, head: 0 };
}

// --- sound: a tiny synth, one boom per break, delayed by distance ---------------------
class FwAudio {
  constructor() { this.ctx = null; this.master = null; this.noise = null; this.volume = 0.6; this.on = true; }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const n = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  // the break: a sub thump under a low-passed noise burst that darkens as it decays,
  // plus a sprinkle of crackle for glitter shells
  boom(delay, vol, size, crackle) {
    if (!this.on || !this.ensure()) return;
    const c = this.ctx, t = c.currentTime + Math.max(0, delay);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(64 / Math.sqrt(size), t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.55);
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(vol * 0.9, t + 0.012); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.9 * size);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 1.0 * size);
    const src = c.createBufferSource(); src.buffer = this.noise;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(70, t + 1.4 * size);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(vol, t + 0.008); ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.7 * size);
    src.connect(lp).connect(ng).connect(this.master); src.start(t); src.stop(t + 1.8 * size);
    if (crackle) {
      for (let i = 0; i < 14; i++) {
        const ct = t + 0.15 + Math.random() * 1.6;
        const cs = c.createBufferSource(); cs.buffer = this.noise;
        const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
        const cg = c.createGain();
        cg.gain.setValueAtTime(0.0001, ct); cg.gain.linearRampToValueAtTime(vol * 0.25, ct + 0.003); cg.gain.exponentialRampToValueAtTime(0.0001, ct + 0.04);
        cs.connect(hp).connect(cg).connect(this.master); cs.start(ct, Math.random()); cs.stop(ct + 0.05);
      }
    }
  }
  // the mortar: a soft thump you hear from the outside of the ground
  launch(delay, vol) {
    if (!this.on || !this.ensure()) return;
    const c = this.ctx, t = c.currentTime + Math.max(0, delay);
    const src = c.createBufferSource(); src.buffer = this.noise;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(320, t); lp.frequency.exponentialRampToValueAtTime(60, t + 0.3);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(lp).connect(g).connect(this.master); src.start(t, Math.random()); src.stop(t + 0.4);
  }
}

// ---------------------------------------------------------------------------------------
export function initFireworks(scene, { renderer, sites = null, siteCount = 28 } = {}) {
  const group = new THREE.Group();
  group.name = 'fireworks';
  scene.add(group);
  const sparks = makeSparks();
  const smoke = makeSmoke();
  group.add(sparks.pts, smoke.pts);
  const audio = new FwAudio();

  // launch sites: a ring of mortar racks 14 m outside the bowl's top walkway
  const OFF = BOWL_OUTER_OFF + 14;
  const SITES = sites || roundedRectPath(BOWL_A + OFF, BOWL_B + OFF, BOWL_R + OFF, siteCount).map((p) => ({ x: p.x, z: p.z, nx: p.nx, nz: p.nz }));
  // racks: a crate of tubes per site — a detail nobody needs and everybody notices
  {
    const geos = [];
    for (const s of SITES) {
      const yaw = Math.atan2(s.nx, s.nz);
      const crate = new THREE.BoxGeometry(2.2, 0.55, 1.1); crate.rotateY(yaw); crate.translate(s.x, 0.275, s.z); geos.push(crate);
      for (let i = 0; i < 8; i++) {
        const tube = new THREE.CylinderGeometry(0.11, 0.11, 0.9, 8);
        const ox = -0.9 + i * 0.26;
        tube.translate(ox, 0.95, 0); tube.rotateY(yaw); tube.translate(s.x, 0, s.z);
        geos.push(tube);
      }
    }
    const merged = geos.length ? BufferGeometryUtils.mergeGeometries(geos) : null;
    if (merged) {
      const racks = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color: 0x2a2c30 }));
      racks.castShadow = false; racks.receiveShadow = false;
      group.add(racks);
    }
  }
  // two pooled flash lights, in the scene from the start so the light count
  // (a shader permutation key) never changes mid-show
  const flashes = [];
  for (let i = 0; i < 2; i++) {
    const L = new THREE.PointLight(0xffffff, 0, 900, 2);
    L.position.set(0, 200, 0);
    group.add(L);
    flashes.push(L);
  }

  const state = { show: false, preset: 'mixed', sound: true, volume: 0.6, shellsFired: 0 };
  const T = { now: 0 };                    // the pool's clock, seconds since init
  const shells = [];                        // lifting shells (CPU)
  const pending = [];                       // scheduled events: crossette splits, finale waves
  let head = 0;                             // ring-buffer write head
  let dirtyLo = Infinity, dirtyHi = -1;
  const ranges = [];                        // [start, count] vertex ranges written this frame
  const camPos = new THREE.Vector3();

  // --- writing one spark -------------------------------------------------------------
  const { p0, v0, tt, qq, c1, c2 } = sparks;
  function emit(px, py, pz, vx, vy, vz, k, life, size, flags, ca, cb, lag = 0, lagMax = 0, changeT = 0, birth = T.now) {
    const i = head;
    p0[i * 3] = px; p0[i * 3 + 1] = py; p0[i * 3 + 2] = pz;
    v0[i * 3] = vx; v0[i * 3 + 1] = vy; v0[i * 3 + 2] = vz;
    tt[i * 4] = birth; tt[i * 4 + 1] = life; tt[i * 4 + 2] = lag; tt[i * 4 + 3] = lagMax;
    qq[i * 4] = k; qq[i * 4 + 1] = size; qq[i * 4 + 2] = flags; qq[i * 4 + 3] = changeT;
    c1[i * 3] = ca[0]; c1[i * 3 + 1] = ca[1]; c1[i * 3 + 2] = ca[2];
    c2[i * 3] = cb[0]; c2[i * 3 + 1] = cb[1]; c2[i * 3 + 2] = cb[2];
    if (i < dirtyLo) dirtyLo = i;
    if (i > dirtyHi) dirtyHi = i;
    head++;
    if (head >= POOL) {   // wrap: close the range at the top, start again at 0
      ranges.push([dirtyLo, dirtyHi - dirtyLo + 1]);
      dirtyLo = Infinity; dirtyHi = -1; head = 0;
    }
  }
  function flushSparks() {
    if (dirtyHi >= 0) ranges.push([dirtyLo, dirtyHi - dirtyLo + 1]);
    if (!ranges.length) return;
    for (const a of Object.values(sparks.A)) {
      const w = a.itemSize;
      for (const [s, n] of ranges) a.addUpdateRange(s * w, n * w);
      a.needsUpdate = true;
    }
    ranges.length = 0;
    dirtyLo = Infinity; dirtyHi = -1;
  }
  function puff(x, y, z, size, life = 9) {
    const i = smoke.head; smoke.head = (smoke.head + 1) % smoke.n;
    smoke.pos[i * 3] = x; smoke.pos[i * 3 + 1] = y; smoke.pos[i * 3 + 2] = z;
    smoke.tt[i * 2] = T.now; smoke.tt[i * 2 + 1] = life;
    smoke.sz[i] = size;
    for (const a of ['position', 'aT', 'aS']) smoke.pts.geometry.getAttribute(a).needsUpdate = true;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const col = (key) => PAL[key] || PAL.white;

  // --- the break --------------------------------------------------------------------
  // spawn the stars of a shell type at p with the shell's velocity inherited
  function burst(type, px, py, pz, svx, svy, svz, s, colA, colB, seedDir) {
    const Tt = TYPES[type];
    const n = Math.round(Tt.n * (0.75 + 0.55 * s));
    const inherit = 0.5;
    const bvx = svx * inherit, bvy = svy * inherit, bvz = svz * inherit;
    const trail = Tt.trail || 0, lagMax = trail ? trail * Tt.lag : 0;
    const flags = (Tt.glitter ? 1 : 0) | (Tt.strobe ? 2 : 0) | (Tt.change ? 4 : 0) | (!Tt.change && !Tt.strobe && !Tt.glitter ? 8 : 0);
    const ember = Tt.change ? colB : [colA[0] * 0.55 + 0.4, colA[1] * 0.35 + 0.15, colA[2] * 0.25 + 0.05];   // colour dies into an orange ember
    // shape basis for planar shells: a random plane
    const bu = new THREE.Vector3(), bv = new THREE.Vector3();
    if (Tt.shape) {
      const nrm = seedDir || new THREE.Vector3(rnd(-1, 1), rnd(-0.4, 1), rnd(-1, 1)).normalize();
      bu.set(1, 0, 0); if (Math.abs(nrm.x) > 0.8) bu.set(0, 0, 1);
      bu.cross(nrm).normalize(); bv.crossVectors(nrm, bu).normalize();
    }
    const two = Tt.two ? Math.random() < 0.7 : false;
    for (let i = 0; i < n; i++) {
      let dx, dy, dz, speed = Tt.v * s * rnd(0.86, 1.0);
      if (Tt.shape === 'ring') {
        const th = (i / n) * Math.PI * 2 + rnd(-0.02, 0.02);
        dx = Math.cos(th) * bu.x + Math.sin(th) * bv.x; dy = Math.cos(th) * bu.y + Math.sin(th) * bv.y; dz = Math.cos(th) * bu.z + Math.sin(th) * bv.z;
      } else if (Tt.shape === 'heart') {
        const th = (i / n) * Math.PI * 2;
        const hx = 16 * Math.pow(Math.sin(th), 3), hy = 13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th);
        const r = Math.hypot(hx, hy) / 17;
        const ux = hx / (17 * r), uy = hy / (17 * r);
        dx = ux * bu.x + uy * bv.x; dy = ux * bu.y + uy * bv.y; dz = ux * bu.z + uy * bv.z;
        speed *= r;    // stars leave at a speed proportional to their radius: the outline stays a heart as it grows
      } else if (Tt.shape === 'star') {
        const th = (i / n) * Math.PI * 2;
        const seg = (th / (Math.PI * 2)) * 10, f = seg - Math.floor(seg);
        const r = (Math.floor(seg) % 2 === 0) ? 1 - f * 0.55 : 0.45 + f * 0.55;   // outer tip to inner notch and back
        const ux = Math.cos(th), uy = Math.sin(th);
        dx = ux * bu.x + uy * bv.x; dy = ux * bu.y + uy * bv.y; dz = ux * bu.z + uy * bv.z;
        speed *= r;
      } else if (Tt.hemi) {
        // palm trunks: mostly up and out, a few drooping
        const th = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2), el = rnd(0.25, 1.25);
        dx = Math.cos(th) * Math.cos(el); dy = Math.sin(el); dz = Math.sin(th) * Math.cos(el);
      } else {
        // uniform over the sphere, with a slight petal asymmetry so no two breaks match
        const u = rnd(-1, 1), th = rnd(0, Math.PI * 2), rr = Math.sqrt(1 - u * u);
        dx = rr * Math.cos(th); dy = u; dz = rr * Math.sin(th);
        speed *= 0.9 + 0.1 * Math.sin(th * 3 + u * 2);
      }
      const life = Tt.life * rnd(0.82, 1.15) * (0.9 + 0.2 * s);
      const size = Tt.size * rnd(0.8, 1.25) * (0.85 + 0.3 * s);
      const c = (two && i % 2) ? colB : colA;
      const cB = Tt.change ? colB : ember;
      const vx = bvx + dx * speed, vy = bvy + dy * speed, vz = bvz + dz * speed;
      emit(px, py, pz, vx, vy, vz, Tt.k, life, size, flags, c, cB, 0, lagMax, Tt.change || 0);
      for (let j = 1; j <= trail; j++) emit(px, py, pz, vx, vy, vz, Tt.k, life, size, flags, c, cB, j * Tt.lag, lagMax, Tt.change || 0);
      if (Tt.split) pending.push({ at: T.now + life * 0.95, kind: 'split', px, py, pz, vx, vy, vz, k: Tt.k, born: T.now, spec: Tt.split, col: c });
    }
    if (Tt.core) {
      const C = Tt.core;
      const cc = col(pick(C.pal));
      const m = Math.round(C.n * (0.75 + 0.55 * s));
      for (let i = 0; i < m; i++) {
        const u = rnd(-1, 1), th = rnd(0, Math.PI * 2), rr = Math.sqrt(1 - u * u);
        const speed = C.v * s * rnd(0.85, 1);
        emit(px, py, pz, bvx + rr * Math.cos(th) * speed, bvy + u * speed, bvz + rr * Math.sin(th) * speed, C.k, C.life * rnd(0.85, 1.15), C.size, 8, cc, ember);
      }
    }
    // the flash of the break, and its smoke
    const fl = Tt.flash || 1;
    emit(px, py, pz, 0, 0, 0, 0.5, 0.3 * fl, (26 + 14 * s) * fl, 0, [3.2, 3.0, 2.6], [3.2, 3.0, 2.6]);
    emit(px, py, pz, 0, 0, 0, 0.5, 0.12, (60 + 30 * s) * fl, 0, [1.6, 1.5, 1.3], [1.6, 1.5, 1.3]);
    puff(px, py, pz, (34 + 16 * s) * (Tt.flash ? 1.6 : 1), 9 + 3 * s);
    // light the stands with it
    let L = flashes[0];
    for (const f of flashes) if (f.intensity < L.intensity) L = f;
    L.position.set(px, py, pz);
    L.color.setRGB(Math.min(1, colA[0] / 2.4), Math.min(1, colA[1] / 2.4), Math.min(1, colA[2] / 2.4));
    L.intensity = (Tt.flash ? 220000 : 95000) * s;
    // and hear it, later: sound travels
    const dist = camPos.distanceTo(new THREE.Vector3(px, py, pz));
    audio.boom(dist / 343, Math.min(1, 140 / Math.max(40, dist)) * (Tt.boom || 1) * 0.9, 0.8 + 0.5 * s, !!Tt.glitter);
  }

  // --- the lift ---------------------------------------------------------------------
  // fire one shell from a site; `lean` tips it in over the bowl so the break
  // hangs above the rim rather than out over the car park
  function launch(site, type = 'peony', cal = 8, colKey = null, colKey2 = null, delay = 0) {
    const S = SITES[site % SITES.length];
    const C = CAL[cal] || CAL[8];
    const h = C.h * rnd(0.94, 1.06);
    const v0 = v0ForHeight(h, SHELL_K);
    const lean = rnd(0.05, 0.11), ya = rnd(-0.35, 0.35);
    const inx = -S.nx, inz = -S.nz;    // the bowl's outward normal, reversed
    const lx = inx * Math.cos(ya) - inz * Math.sin(ya), lz = inx * Math.sin(ya) + inz * Math.cos(ya);
    const vx = lx * Math.sin(lean) * v0, vy = Math.cos(lean) * v0, vz = lz * Math.sin(lean) * v0;
    const Tt = TYPES[type] || TYPES.peony;
    const cA = col(colKey || pick(Tt.pal));
    const cB = col(colKey2 || (Tt.pal2 ? pick(Tt.pal2) : pick(Tt.pal)));
    shells.push({
      t0: T.now + delay, x0: S.x, y0: 1.0, z0: S.z, vx, vy, vz,
      fuse: apexTime(v0, SHELL_K) - rnd(0.05, 0.25), type, s: C.s, cA, cB,
      lastT: 0, phase: rnd(0, 6.28), spin: rnd(7, 12) * (Math.random() < 0.5 ? 1 : -1), lit: false, done: false,
    });
    state.shellsFired++;
  }
  function shellPos(sh, t, out) {
    const k = SHELL_K, e = Math.exp(-k * t);
    out.x = sh.x0 + (WIND.x) * t + (sh.vx - WIND.x) * (1 - e) / k;
    out.y = sh.y0 + (-G / k) * t + (sh.vy + G / k) * (1 - e) / k;
    out.z = sh.z0 + (WIND.z) * t + (sh.vz - WIND.z) * (1 - e) / k;
    return out;
  }
  function shellVel(sh, t, out) {
    const k = SHELL_K, e = Math.exp(-k * t);
    out.x = WIND.x + (sh.vx - WIND.x) * e; out.y = -G / k + (sh.vy + G / k) * e; out.z = WIND.z + (sh.vz - WIND.z) * e;
    return out;
  }
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), vS = new THREE.Vector3();
  const TRAIL_GOLD = [2.2, 1.35, 0.42], TRAIL_EMBER = [1.4, 0.5, 0.12], HEAD = [2.8, 2.4, 1.6];

  function stepShells() {
    for (const sh of shells) {
      if (sh.done) continue;
      const t = T.now - sh.t0;
      if (t < 0) continue;
      if (!sh.lit) {
        sh.lit = true;
        // the mortar: a flash at the rack, a puff, a thump
        emit(sh.x0, sh.y0, sh.z0, 0, 0, 0, 0.5, 0.14, 9, 0, [2.6, 1.6, 0.6], [2.6, 1.6, 0.6]);
        puff(sh.x0, sh.y0 + 1.5, sh.z0, 8, 4);
        const dist = camPos.distanceTo(pA.set(sh.x0, sh.y0, sh.z0));
        audio.launch(dist / 343, Math.min(0.5, 60 / Math.max(40, dist)));
      }
      if (t >= sh.fuse) {
        shellPos(sh, sh.fuse, pA); shellVel(sh, sh.fuse, vS);
        burst(sh.type, pA.x, pA.y, pA.z, vS.x, vS.y, vS.z, sh.s, sh.cA, sh.cB, null);
        sh.done = true;
        continue;
      }
      // the tail: sparks laid along the path since last frame, on a twist
      shellPos(sh, sh.lastT, pA); shellPos(sh, t, pB); shellVel(sh, t, vS);
      const seg = pA.distanceTo(pB);
      const nSp = Math.min(60, Math.max(1, Math.ceil(seg / 0.45)));
      const spd = vS.length();
      for (let i = 0; i < nSp; i++) {
        const f = (i + 0.5) / nSp;
        const x = pA.x + (pB.x - pA.x) * f, y = pA.y + (pB.y - pA.y) * f, z = pA.z + (pB.z - pA.z) * f;
        sh.phase += sh.spin * (seg / nSp) / spd * 6;      // one turn per ~3 m of climb
        const r = 0.28 + 0.18 * Math.sin(sh.phase * 0.37);
        const ox = Math.cos(sh.phase) * r, oz = Math.sin(sh.phase) * r;
        const branch = Math.random() < 0.18;
        const life = branch ? rnd(0.3, 0.55) : rnd(0.55, 1.15);
        const kick = branch ? rnd(3, 7) : rnd(0.3, 1.4);
        const ax = rnd(-1, 1), ay = rnd(-0.6, 0.6), az = rnd(-1, 1), al = Math.hypot(ax, ay, az) || 1;
        emit(x + ox, y, z + oz, vS.x * 0.14 + ax / al * kick, vS.y * 0.14 + ay / al * kick, vS.z * 0.14 + az / al * kick,
             2.4, life, branch ? 0.5 : rnd(0.55, 0.95), 1 | 8, TRAIL_GOLD, TRAIL_EMBER);
      }
      // the head: a bright bead re-laid every frame
      emit(pB.x, pB.y, pB.z, vS.x, vS.y, vS.z, SHELL_K, 0.09, 2.6 + 0.8 * sh.s, 0, HEAD, HEAD);
      sh.lastT = t;
    }
    // sweep the dead
    for (let i = shells.length - 1; i >= 0; i--) if (shells[i].done) shells.splice(i, 1);
  }
  function stepPending() {
    for (let i = pending.length - 1; i >= 0; i--) {
      const ev = pending[i];
      if (T.now < ev.at) continue;
      pending.splice(i, 1);
      if (ev.kind === 'split') {
        // crossette: the comet bursts into four, crosswise to its flight
        const t = ev.at - ev.born, k = ev.k, e = Math.exp(-k * t);
        const x = ev.px + WIND.x * t + (ev.vx - WIND.x) * (1 - e) / k;
        const y = ev.py + (-G / k) * t + (ev.vy + G / k) * (1 - e) / k;
        const z = ev.pz + WIND.z * t + (ev.vz - WIND.z) * (1 - e) / k;
        const vx = WIND.x + (ev.vx - WIND.x) * e, vy = -G / k + (ev.vy + G / k) * e, vz = WIND.z + (ev.vz - WIND.z) * e;
        const vl = Math.hypot(vx, vy, vz) || 1;
        const ux = vx / vl, uy = vy / vl, uz = vz / vl;
        let ax = 0, ay = 1, az = 0; if (Math.abs(uy) > 0.8) { ax = 1; ay = 0; }
        // two perpendiculars to the flight
        let p1x = ay * uz - az * uy, p1y = az * ux - ax * uz, p1z = ax * uy - ay * ux;
        const l1 = Math.hypot(p1x, p1y, p1z) || 1; p1x /= l1; p1y /= l1; p1z /= l1;
        const p2x = uy * p1z - uz * p1y, p2y = uz * p1x - ux * p1z, p2z = ux * p1y - uy * p1x;
        const S = ev.spec;
        for (let j = 0; j < S.n; j++) {
          const a = (j / S.n) * Math.PI * 2 + 0.3;
          const dx = Math.cos(a) * p1x + Math.sin(a) * p2x, dy = Math.cos(a) * p1y + Math.sin(a) * p2y, dz = Math.cos(a) * p1z + Math.sin(a) * p2z;
          emit(x, y, z, vx * 0.35 + dx * S.v, vy * 0.35 + dy * S.v, vz * 0.35 + dz * S.v, S.k, S.life * rnd(0.85, 1.15), S.size, 1 | 8, ev.col, TRAIL_EMBER, 0, 0, 0, ev.at);
          for (let q = 1; q <= 4; q++) emit(x, y, z, vx * 0.35 + dx * S.v, vy * 0.35 + dy * S.v, vz * 0.35 + dz * S.v, S.k, S.life, S.size, 1, ev.col, TRAIL_EMBER, q * 0.05, 0.2, 0, ev.at);
        }
        emit(x, y, z, 0, 0, 0, 0.5, 0.12, 8, 0, [2.6, 2.4, 2.0], [2.6, 2.4, 2.0], 0, 0, 0, ev.at);
      } else if (ev.kind === 'wave') {
        ev.fn();
      }
    }
  }

  // --- choreography -----------------------------------------------------------------
  const N = SITES.length;
  const later = (dt, fn) => pending.push({ at: T.now + dt, kind: 'wave', fn });
  const PRESETS = {
    // one shell from every rack, running round the ring, whatever comes out of the crate
    mixed(stagger = 1.8) {
      const types = ['peony', 'chrys', 'peony', 'dahlia', 'change', 'ring', 'palm', 'strobe', 'willow', 'crossette', 'kamuro', 'saturn'];
      for (let i = 0; i < N; i++) launch(i, types[Math.floor(Math.random() * types.length)], Math.random() < 0.3 ? 6 : 8, null, null, (i / N) * stagger + rnd(0, 0.12));
    },
    // every rack together, one colour walking round the ring: a crown over the stadium
    ring() {
      const c = pick(MIXED), c2 = pick(MIXED);
      for (let i = 0; i < N; i++) launch(i, 'peony', 8, i % 2 ? c : c2, i % 2 ? c2 : c, rnd(0, 0.15));
    },
    // gold that hangs: willows, kamuro crowns and silver horsetails
    willows() {
      const types = ['willow', 'kamuro', 'willow', 'horsetail'];
      for (let i = 0; i < N; i++) launch(i, types[i % types.length], i % 3 === 0 ? 10 : 8, null, null, (i / N) * 2.4 + rnd(0, 0.1));
    },
    // chrysanthemums and palms, glitter everywhere
    glitter() {
      const types = ['chrys', 'palm', 'chrys', 'crossette'];
      for (let i = 0; i < N; i++) launch(i, types[i % types.length], 8, null, null, (i / N) * 1.4 + rnd(0, 0.1));
    },
    // hearts, stars, rings and saturns
    shapes() {
      const types = ['heart', 'ring', 'star5', 'saturn', 'heart', 'ring'];
      for (let i = 0; i < N; i++) launch(i, types[i % types.length], 8, null, null, (i / N) * 2.0 + rnd(0, 0.1));
    },
    // everything at once, one enormous break all the way round
    salvo() {
      for (let i = 0; i < N; i++) launch(i, i % 3 === 0 ? 'dahlia' : 'peony', 10, null, null, rnd(0, 0.08));
    },
    // the finale: four waves, climbing in size, ending in salutes
    finale() {
      for (let i = 0; i < N; i++) launch(i, i % 2 ? 'peony' : 'change', 6, null, null, (i / N) * 0.9);
      later(1.1, () => { for (let i = 0; i < N; i++) launch(i, i % 3 ? 'chrys' : 'ring', 8, null, null, rnd(0, 0.5)); });
      later(2.5, () => { for (let i = 0; i < N; i++) launch(i, i % 2 ? 'dahlia' : 'strobe', 10, null, null, rnd(0, 0.4)); });
      later(3.2, () => { for (let i = 0; i < N; i += Math.round(N / 4)) launch(i, 'willow', 12, 'gold', 'gold', rnd(0, 0.3)); });
      later(4.4, () => { for (let i = 0; i < N; i++) launch(i, i % 2 ? 'salute' : 'kamuro', i % 2 ? 8 : 10, null, null, rnd(0, 0.6)); });
    },
  };

  let showNext = 0;
  const _sz = new THREE.Vector2();
  const api = {
    group, state, sites: SITES, types: Object.keys(TYPES), presets: Object.keys(PRESETS),
    /** one volley in the current style (the Outdoor pyro button) */
    fire(preset) {
      if (state.sound) audio.ensure();   // called from a click: the browser lets audio start here
      const key = preset || state.preset;
      (PRESETS[key] || PRESETS.mixed)();
    },
    fireFinale() { if (state.sound) audio.ensure(); PRESETS.finale(); },
    /** one shell from one rack: for the timeline and the console's fine control */
    fireShell(site, type, cal, colour) { launch(site, type, cal, colour); },
    setPreset(key) { if (PRESETS[key]) { state.preset = key; api.fire(key); } },
    /** looping volleys every few seconds until switched off */
    setShow(on) { state.show = !!on; if (on) { api.fire(); showNext = T.now + rnd(5, 7); } },
    setSound(on) { state.sound = !!on; audio.on = state.sound; },
    setVolume(v) { state.volume = v; audio.setVolume(v); },
    tick(dt, camera) {
      T.now += dt;
      camPos.copy(camera.position);
      if (state.show && T.now >= showNext) {
        const keys = ['mixed', 'ring', 'glitter', 'shapes', 'willows', 'mixed', 'salvo'];
        api.fire(pick(keys));
        showNext = T.now + rnd(4.5, 7.5);
      }
      stepPending();
      stepShells();
      flushSparks();
      for (const L of flashes) if (L.intensity > 0) L.intensity = L.intensity > 40 ? L.intensity * Math.exp(-dt * 5.5) : 0;
      // point sizes are in drawing-buffer pixels: metres -> pixels through the lens
      const h = renderer ? renderer.getDrawingBufferSize(_sz).y : window.innerHeight;
      const scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      sparks.mat.uniforms.uScale.value = scale;
      sparks.mat.uniforms.uTime.value = T.now;
      smoke.mat.uniforms.uScale.value = scale;
      smoke.mat.uniforms.uTime.value = T.now;
    },
  };
  return api;
}
