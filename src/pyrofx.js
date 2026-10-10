// Pyro / special-effects package for the show rig.
//
// Four independent GPU particle systems following the makeConfetti house
// pattern: InstancedBufferGeometry quads, ALL motion computed in the vertex
// shader from per-instance aSeed/aOrigin/aVel attributes plus a shared uT
// clock, vAlive clip + discard for dead instances, zero per-frame CPU
// attribute writes. The CPU only ever touches uniforms.
//
//   PYRO      - looping comet-and-burst firework volleys (additive, blooms)
//   FLAMES    - 8 continuous flame jets with colour modes (additive, blooms)
//   POPPERS   - sharp one-shot confetti pops (opaque paper, no bloom)
//   STREAMERS - long ribbon arcs that rest on the floor (opaque satin, no bloom)
//
// Everything is built in RIG-LOCAL coordinates (deck lip x=-20, deck top
// y=2.0) because the group is parented under the show-rig group, which stage
// configs translate and x-scale. Bloom gates on max(r,g,b) > 1.25: hot cores
// sit at ~3.2, paper/satin stays below ~1.1.
//
// initPyro takes an optional second argument: buildRig's fxPoints export,
// { pyro, popper, streamer, flame }, each an array of [x, y, z] rig-local
// launch points from a CREATE YOUR RIG plan. A NON-EMPTY list replaces that
// system's built-in positions; an absent or empty list changes NOTHING — the
// default show must keep firing exactly as it always has (main.js passes the
// no-plan fxPoints object, which is all empty arrays). Buffer sizes scale
// with point count; the per-point particle budgets never change.
import * as THREE from 'three';
import { makeConfettiAtlas } from './textures.js';

const OFF = -9999;            // uT0 value meaning "never fired"
const RENDER_ORDER = 20;      // draw over the stage deck / B-stage screen

// --- shared GLSL helpers -----------------------------------------------------
const GLSL_HASH = /* glsl */`
  float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
`;
const GLSL_ROT = /* glsl */`
  mat3 rotAxis(vec3 a, float ang) {
    float s = sin(ang), c = cos(ang), o = 1.0 - c;
    return mat3(o*a.x*a.x+c, o*a.x*a.y-a.z*s, o*a.z*a.x+a.y*s,
                o*a.x*a.y+a.z*s, o*a.y*a.y+c, o*a.y*a.z-a.x*s,
                o*a.z*a.x-a.y*s, o*a.y*a.z+a.x*s, o*a.z*a.z+c);
  }
`;

// unit quad instancing base (positions in [-0.5, 0.5])
function instancedQuad(w, h, count) {
  const geo = new THREE.PlaneGeometry(w, h);
  const inst = new THREE.InstancedBufferGeometry();
  inst.index = geo.index;
  inst.attributes.position = geo.attributes.position;
  inst.attributes.uv = geo.attributes.uv;
  inst.instanceCount = count;
  // generous static bound; culling is off anyway but raycast/helpers stay sane
  inst.boundingSphere = new THREE.Sphere(new THREE.Vector3(-12, 10, 0), 140);
  return inst;
}

function makeMesh(inst, mat) {
  const mesh = new THREE.Mesh(inst, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = RENDER_ORDER;
  return mesh;
}

// ---------------------------------------------------------------------------
// PYRO — 12 launchers: comet streak up 8-14 m, then a radial spark burst.
// Per-launcher randomness derives from aLSeed hashed with the volley seed, so
// every instance of a launcher agrees on rise height / timing without any CPU
// work, and every volley looks different.
// ---------------------------------------------------------------------------
function makePyro(customPoints) {
  // a rig plan can supply its own launch line; otherwise the stock package
  let launchers;
  if (customPoints && customPoints.length) {
    launchers = customPoints;
  } else {
    launchers = [];
    for (let i = 0; i < 10; i++) {                     // deck lip line
      launchers.push([-19.8, 2.1, -12 + (i / 9) * 24]);
    }
    launchers.push([-27.4, 2.1, -8.5]);                // 2 upstage
    launchers.push([-27.4, 2.1, 8.5]);
  }

  const COMETS = 8;                                    // trail quads per launcher
  const SPARKS = 88;                                   // burst sparks per launcher
  const PER = COMETS + SPARKS;
  const count = launchers.length * PER;                // stock: 12 * 96 = 1152 <= 4000

  const inst = instancedQuad(1, 1, count);
  const origin = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const lseed = new Float32Array(count);
  const kind = new Float32Array(count);

  let n = 0;
  launchers.forEach((L, li) => {
    const ls = li * 7.31 + 1.7;
    for (let j = 0; j < PER; j++, n++) {
      origin[n * 3] = L[0]; origin[n * 3 + 1] = L[1]; origin[n * 3 + 2] = L[2];
      seed[n] = Math.random() * 100;
      lseed[n] = ls;
      const comet = j < COMETS;
      kind[n] = comet ? 0 : 1;
      if (comet) {
        vel[n * 3] = vel[n * 3 + 1] = vel[n * 3 + 2] = 0;
      } else {
        // radial burst velocity: uniform-ish sphere, slightly flattened
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        const sp = 3.5 + Math.random() * 4.5;
        vel[n * 3] = Math.sin(ph) * Math.cos(th) * sp;
        vel[n * 3 + 1] = Math.cos(ph) * sp * 0.85;
        vel[n * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      }
    }
  });
  inst.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 3));
  inst.setAttribute('aVel', new THREE.InstancedBufferAttribute(vel, 3));
  inst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  inst.setAttribute('aLSeed', new THREE.InstancedBufferAttribute(lseed, 1));
  inst.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uT: { value: 0 },
      uT0: { value: OFF },
      uVSeed: { value: 0 },     // reshuffles launcher params every volley
      uFrac: { value: 1.0 },    // fraction of launchers that fire this volley
      uForceType: { value: -1 },  // -1 random | 0 peony 1 willow 2 ring 3 crackle
      uForcePal: { value: -1 },   // -1 random | -2 rainbow-per-launcher | 0-7 fixed
    },
    transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec3 aOrigin; attribute vec3 aVel;
      attribute float aSeed; attribute float aLSeed; attribute float aKind;
      uniform float uT; uniform float uT0; uniform float uVSeed; uniform float uFrac;
      uniform float uForceType; uniform float uForcePal;
      varying float vAlive; varying vec3 vCol; varying vec2 vUv;
      ${GLSL_HASH}
      vec3 hue2rgb(float h) {
        vec3 k = mod(vec3(0.0, 4.0, 2.0) + h * 6.0, 6.0);
        return 1.0 - clamp(min(k, 4.0 - k), 0.0, 1.0);
      }
      void main() {
        vUv = uv;
        // per-launcher, per-volley parameters (identical for the whole launcher)
        float h = hash1(aLSeed + uVSeed);
        float gate = step(h, uFrac + 1e-4);
        float stagger = fract(h * 17.17) * 0.7;
        float rise = 7.0 + 9.0 * fract(h * 7.77 + 0.13);       // 7-16 m
        float riseT = 0.85 + 0.4 * fract(h * 3.33 + 0.71);
        // ---- shell variety: palette + burst type, per launcher per volley ----
        // palettes: 0 = classic gold; 1-7 = tinted (red, green, blue, purple,
        // pink, cyan, white-silver)
        float pal = uForcePal >= -0.5 ? uForcePal
                  : (uForcePal < -1.5 ? mod(floor(aLSeed * 1.31), 8.0)   // rainbow: hue per launcher
                                      : floor(fract(h * 9.71) * 8.0));
        vec3 tint = pal < 0.5 ? vec3(1.0, 0.8, 0.45) : hue2rgb(fract(pal * 0.137 + 0.93));
        if (pal > 6.5) tint = vec3(0.92, 0.95, 1.0);           // silver shell
        // saturated heat: mostly the tint itself, only a whisper of white, so
        // a red shell BLOOMS red instead of washing to white
        vec3 hot = tint * 3.4 + vec3(0.22);
        vec3 ember = tint * 1.15;
        // types: 0 peony (sphere) / 1 willow (droopy trails) / 2 ring / 3 crackle
        float typ = uForceType >= -0.5 ? uForceType : floor(fract(h * 5.13) * 4.0);
        float t = uT - uT0 - stagger;
        // slight lean per volley so bursts never stack in a plane
        vec3 burstPos = aOrigin + vec3(sin(aLSeed * 5.1 + uVSeed) * 1.1, rise,
                                       cos(aLSeed * 3.7 + uVSeed) * 1.1);
        vec3 p; vec3 v; float size; float a01;
        if (aKind < 0.5) {
          // ----- comet streak, then the detonation FLASH --------------------
          float lag = fract(aSeed * 0.313) * 0.13;
          float ts = t - riseT;
          if (ts > 0.0) {
            // flash kernel: one hot tinted glow ball at the burst point that
            // bloom turns into a coloured halo — every shell announces itself
            float fk = clamp(ts / 0.3, 0.0, 1.0);
            p = burstPos;
            v = vec3(0.0);
            size = (1.3 * (1.0 - fk) + 0.3) * (0.7 + 0.6 * fract(aSeed * 0.313));
            vAlive = (ts < 0.3) ? gate : 0.0;
            vCol = hot * 0.9 * (1.0 - fk * fk);
          } else {
            float tc = clamp(t - lag, 0.0, riseT);
            float u = tc / riseT;
            float ue = sin(u * 1.5707963);                      // ease-out rise
            p = mix(aOrigin, burstPos, ue);
            v = (burstPos - aOrigin) / riseT * cos(u * 1.5707963);
            size = 0.11 + 0.05 * (1.0 - fract(aSeed * 0.313));
            vAlive = (t > 0.0) ? gate : 0.0;
            vCol = mix(vec3(3.2, 2.9, 2.1), hot, 0.35) * (0.55 + 0.45 * (1.0 - fract(aSeed * 0.313)));
          }
          a01 = 0.0;
        } else {
          // ----- burst spark: drag-damped radial flight + gravity ----------
          vec3 bv = aVel;
          float life = 1.2 * (0.8 + 0.4 * fract(aSeed * 0.173));
          float grav = 3.1;
          if (typ > 0.5 && typ < 1.5) {                        // WILLOW
            bv *= 0.72; life *= 1.9; grav = 4.6;               // slow droopy trails
          } else if (typ > 1.5 && typ < 2.5) {                 // RING
            vec3 nrm = normalize(vec3(sin(h * 31.0), 1.6 + sin(h * 13.0), cos(h * 47.0)));
            bv = normalize(bv - nrm * dot(bv, nrm)) * length(bv) * 1.1;
          }
          float ts = t - riseT;
          a01 = clamp(ts / life, 0.0, 1.0);
          float k = (1.0 - exp(-ts * 2.1)) / 2.1;
          p = burstPos + bv * k;
          p.y -= grav * ts * ts * 0.5 * (1.0 + ts);            // gravity droop
          v = bv * exp(-ts * 2.1);
          v.y -= grav * 2.0 * ts;
          size = 0.115 * (0.7 + 0.6 * fract(aSeed * 0.531));
          vAlive = (ts > 0.0 && ts < life) ? gate : 0.0;
          vCol = mix(hot, ember, smoothstep(0.05, 0.5, a01));
          vCol *= pow(1.0 - a01, 1.15);                         // dies to dark
          if (typ > 2.5) {                                     // CRACKLE twinkle
            float tw = step(0.45, hash1(aSeed + floor(t * 22.0)));
            vCol *= mix(1.0, tw * 1.8, smoothstep(0.25, 0.55, a01));
          }
        }
        // camera-facing quad, stretched along the (view-space) velocity for a
        // slight gravity/motion trail
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vec3 vv = (modelViewMatrix * vec4(v, 0.0)).xyz;
        vec2 dir = length(vv.xy) > 1e-4 ? normalize(vv.xy) : vec2(0.0, 1.0);
        vec2 perp = vec2(-dir.y, dir.x);
        float stretch = 1.0 + min(length(vv) * 0.22, 3.5);
        mv.xy += dir * (position.y * size * stretch) + perp * (position.x * size);
        gl_Position = projectionMatrix * mv;
        if (vAlive < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying float vAlive; varying vec3 vCol; varying vec2 vUv;
      void main() {
        if (vAlive < 0.5) discard;
        float d = length(vUv - 0.5) * 2.0;
        float m = 1.0 - smoothstep(0.25, 1.0, d);               // soft round core
        gl_FragColor = vec4(vCol * m, 1.0);
      }`,
  });

  return { mesh: makeMesh(inst, mat), mat };
}

// ---------------------------------------------------------------------------
// FLAMES — 8 nozzles on the deck lip, each cycling ~50 quads up 4-7 m.
// Continuous while on; per-nozzle micro-bursts modulate height and brightness
// entirely in-shader. Colour is a uColorA (core) / uColorB (tip) pair mixed
// along the flame's rise; rainbow mode walks a per-nozzle hue instead.
// ---------------------------------------------------------------------------
function makeFlames(customPoints) {
  // nozzle positions: plan-supplied, else 8 across the deck lip (z -12.25..12.25)
  let nozzles;
  if (customPoints && customPoints.length) {
    nozzles = customPoints;
  } else {
    nozzles = [];
    for (let i = 0; i < 8; i++) nozzles.push([-19.6, 2.1, -12.25 + i * 3.5]);
  }
  const NOZZLES = nozzles.length, PER = 50;
  const count = NOZZLES * PER;                          // stock: 400
  const inst = instancedQuad(1, 1, count);
  const origin = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const nseed = new Float32Array(count);

  let n = 0;
  for (let i = 0; i < NOZZLES; i++) {
    const N = nozzles[i];
    for (let j = 0; j < PER; j++, n++) {
      origin[n * 3] = N[0]; origin[n * 3 + 1] = N[1]; origin[n * 3 + 2] = N[2];
      seed[n] = Math.random() * 100;
      nseed[n] = i * 3.77 + 0.9;
    }
  }
  inst.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 3));
  inst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  inst.setAttribute('aNSeed', new THREE.InstancedBufferAttribute(nseed, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uT: { value: 0 },
      uOnT: { value: -2000 },
      uOffT: { value: -1999 },                          // uOffT > uOnT means off
      uColorA: { value: new THREE.Color(3.4, 2.2, 0.9) },   // hot core (blooms)
      uColorB: { value: new THREE.Color(0.9, 0.25, 0.04) }, // tips (under gate)
      uRainbow: { value: 0 },
    },
    transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec3 aOrigin; attribute float aSeed; attribute float aNSeed;
      uniform float uT; uniform float uOnT; uniform float uOffT;
      uniform vec3 uColorA; uniform vec3 uColorB; uniform float uRainbow;
      varying float vAlive; varying float vMix; varying float vEnv; varying vec2 vUv;
      varying vec3 vColA; varying vec3 vColB;
      ${GLSL_HASH}
      vec3 hue2rgb(float h) {
        vec3 k = mod(vec3(0.0, 4.0, 2.0) + h * 6.0, 6.0);
        return 1.0 - clamp(min(k, 4.0 - k), 0.0, 1.0);
      }
      void main() {
        vUv = uv;
        // on/off envelope with short ramps
        float onE = smoothstep(uOnT, uOnT + 0.18, uT);
        float offE = mix(1.0, 1.0 - smoothstep(uOffT, uOffT + 0.35, uT),
                         step(uOnT, uOffT));
        float env = onE * offE;
        // per-nozzle micro-burst: spiky pseudo-random surge
        float mb = sin(uT * 5.1 + aNSeed * 17.0) * sin(uT * 2.27 + aNSeed * 29.0);
        float burst = 0.55 + 0.45 * smoothstep(-0.1, 0.8, mb);
        // each quad cycles: born at the nozzle, rises, grows then dies
        float dur = 0.5 + 0.35 * fract(aSeed * 0.377);
        float tt = uT / dur + fract(aSeed * 0.713);
        float prog = fract(tt);
        float cyc = floor(tt);
        float ch = hash1(aSeed + cyc * 0.618);           // per-cycle variation
        float H = (4.0 + 3.0 * fract(aNSeed * 0.531 + ch * 0.4)) * burst;
        vec3 p = aOrigin;
        p.y += prog * prog * 0.3 + prog * H;             // accelerating column
        // turbulent x/z wobble that widens with height
        p.x += sin(prog * 7.0 + uT * 3.0 + aSeed) * 0.28 * prog + 0.25 * prog;
        p.z += cos(prog * 6.0 + uT * 2.3 + aSeed * 1.7) * 0.3 * prog;
        float size = (0.45 + 1.5 * prog) * (1.0 - smoothstep(0.65, 1.0, prog))
                   * (0.7 + 0.6 * ch) * burst;
        vMix = prog;
        vEnv = env * (0.6 + 0.4 * burst);
        if (uRainbow > 0.5) {
          vec3 hc = hue2rgb(fract(aNSeed * 0.29 + uT * 0.13));  // per-nozzle walk
          vColA = hc * 3.2 + 0.4;                        // core clears the gate
          vColB = hc * 0.75;                             // tips stay under it
        } else {
          vColA = uColorA; vColB = uColorB;
        }
        vAlive = env > 0.002 ? 1.0 : 0.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        mv.xy += position.xy * size;                     // billboard
        gl_Position = projectionMatrix * mv;
        if (vAlive < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying float vAlive; varying float vMix; varying float vEnv; varying vec2 vUv;
      varying vec3 vColA; varying vec3 vColB;
      void main() {
        if (vAlive < 0.5) discard;
        float d = length(vUv - 0.5) * 2.0;
        float m = 1.0 - smoothstep(0.1, 1.0, d);
        // hot core at the base, darker tips as the quad rises out
        vec3 col = mix(vColA, vColB, smoothstep(0.12, 0.85, vMix));
        col *= (1.0 - 0.75 * vMix * vMix);               // die toward the top
        gl_FragColor = vec4(col * m * vEnv, 1.0);
      }`,
  });

  return { mesh: makeMesh(inst, mat), mat };
}

// --- the 6 popper / streamer launch points ----------------------------------
// ALL on the deck: lip corners, lip mid-thirds, upstage corners. Nothing ever
// fires from the floor or the crowd. A rig plan overrides these per system
// (points.popper / points.streamer); this list is the no-plan default.
const POP_POINTS = [
  [-20.3, 2.1, -12.4], [-20.3, 2.1, 12.4],
  [-20.3, 2.1, -4.5], [-20.3, 2.1, 4.5],
  [-26.8, 2.1, -10.5], [-26.8, 2.1, 10.5],
];

// ---------------------------------------------------------------------------
// POPPERS — one sharp radial pop of paper from the 6 points. Opaque cutout
// (NOT additive) so the squares read as confetti, not light.
// ---------------------------------------------------------------------------
function makePoppers(customPoints) {
  const points = (customPoints && customPoints.length) ? customPoints : POP_POINTS;
  const PER = 3800;
  const count = points.length * PER;                    // stock: a real cloud
  const inst = instancedQuad(0.105, 0.105, count);   // big enough for the shapes to read
  const origin = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const col = new Float32Array(count * 3);
  const palette = [
    [1.0, 0.25, 0.45], [1.0, 0.85, 0.2], [0.3, 0.7, 1.0],
    [0.7, 0.35, 1.0], [1.0, 1.0, 1.0], [0.35, 1.0, 0.6],
  ];
  let n = 0;
  for (const P of points) {
    for (let j = 0; j < PER; j++, n++) {
      origin[n * 3] = P[0]; origin[n * 3 + 1] = P[1]; origin[n * 3 + 2] = P[2];
      // vertical geyser: straight UP, ~11 deg spread, wide speed band so the
      // column has body from the muzzle to the crest
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.2;
      const sp = 19 + Math.random() * 15;              // snappier muzzle speed
      vel[n * 3] = Math.sin(ang) * r * sp;
      vel[n * 3 + 1] = Math.sqrt(Math.max(0.1, 1 - r * r)) * sp;
      vel[n * 3 + 2] = Math.cos(ang) * r * sp;
      seed[n] = Math.random() * 100;
      const p = palette[(Math.random() * palette.length) | 0];
      col[n * 3] = p[0]; col[n * 3 + 1] = p[1]; col[n * 3 + 2] = p[2];
    }
  }
  inst.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 3));
  inst.setAttribute('aVel', new THREE.InstancedBufferAttribute(vel, 3));
  inst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  inst.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uT0: { value: OFF }, uAtlas: { value: makeConfettiAtlas() }, uDensity: { value: 0.7 } },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec3 aOrigin; attribute vec3 aVel; attribute float aSeed; attribute vec3 aCol;
      uniform float uT; uniform float uT0; uniform float uDensity;
      varying float vAlive; varying vec3 vCol; varying float vShade; varying vec2 vQuv;
      ${GLSL_ROT}
      void main() {
        // each piece wears one silhouette from the 2x2 atlas
        vQuv = uv * 0.5 + vec2(mod(floor(aSeed * 7.0), 2.0), mod(floor(aSeed * 13.0), 2.0)) * 0.5;
        // burst STREAM: emission staggered over 0.3 s so the pop reads as a
        // thick geyser, not a single sparse ring
        float age = uT - uT0 - fract(aSeed * 0.19) * 0.14;   // crack, not a pour
        float life = 6.0 * (0.8 + 0.4 * fract(aSeed * 0.173));
        vAlive = (age > 0.0 && age < life) ? 1.0 : 0.0;
        if (fract(aSeed * 0.377) > uDensity) vAlive = 0.0;   // the AMOUNT slider
        float k = (1.0 - exp(-age * 1.75)) / 1.75;           // launch drag
        vec3 p = aOrigin + aVel * k;
        // gravity blends into a fluttering paper-fall instead of a rock drop
        float fallT = max(age - 0.55, 0.0);
        // real confetti hangs: gravity almost fully cancelled by drag past the
        // crest, then a gentle ~0.4 m/s flutter descent
        p.y -= 1.5 * age * age * (1.0 - smoothstep(0.3, 1.0, age) * 0.75);
        p.y -= 0.9 * fallT;   // falls faster (was 0.38 m/s)
        p.x += sin(age * 2.4 + aSeed) * (0.1 + fallT * 0.5);
        p.z += cos(age * 2.1 + aSeed * 1.7) * (0.1 + fallT * 0.5);
        p.y = max(p.y, 0.02);
        mat3 R = rotAxis(normalize(vec3(sin(aSeed), 1.0, cos(aSeed * 2.0))),
                         age * 11.0 + aSeed);                // fast tumble
        float fade = 1.0 - smoothstep(life - 0.5, life, age);
        // hold apparent size past ~22 m or the far side of the cloud goes
        // sub-pixel and the confetti appears to stop existing
        float depth = max(-(modelViewMatrix * vec4(p, 1.0)).z, 0.1);
        float grow = clamp(depth / 22.0, 1.0, 4.5);
        vec4 mv = modelViewMatrix * vec4(p + R * position * fade * grow, 1.0);
        vShade = 0.45 + 0.55 * abs(normalize((modelViewMatrix * vec4(R * vec3(0.0, 0.0, 1.0), 0.0)).xyz).z);
        vCol = aCol;
        gl_Position = projectionMatrix * mv;
        if (vAlive < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uAtlas;
      varying float vAlive; varying vec3 vCol; varying float vShade; varying vec2 vQuv;
      void main() {
        if (vAlive < 0.5) discard;
        if (texture2D(uAtlas, vQuv).a < 0.5) discard;        // shape cutout
        gl_FragColor = vec4(vCol * (0.35 + 0.85 * vShade), 1.0);   // lifted floor so back-facing paper still reads
      }`,
  });

  return { mesh: makeMesh(inst, mat), mat };
}

// ---------------------------------------------------------------------------
// STREAMERS — ~90 long ribbons in high arcs from the same 6 points, fluttering
// down over ~7 s, resting on the floor, then shrinking out (the confetti
// end-of-life pattern). Opaque satin colours kept under the bloom gate.
// ---------------------------------------------------------------------------
function makeStreamers(customPoints) {
  const points = (customPoints && customPoints.length) ? customPoints : POP_POINTS;
  const PER = 22;
  const count = points.length * PER;                    // stock: 132 ribbons
  // segmented strip: 14 spans along local Y; the shader bends every vertex
  // back along the ribbon's own flight path, so each streamer is a smooth
  // curved trail behind its thrown head — never a rigid tumbling stick
  const geo = new THREE.PlaneGeometry(1, 1, 1, 14);
  const inst = new THREE.InstancedBufferGeometry();
  inst.index = geo.index;
  inst.attributes.position = geo.attributes.position;
  inst.attributes.uv = geo.attributes.uv;
  inst.instanceCount = count;
  inst.boundingSphere = new THREE.Sphere(new THREE.Vector3(-12, 10, 0), 80);
  const origin = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const col = new Float32Array(count * 3);
  const palette = [                                     // deep satin dyes
    [0.5, 0.06, 0.2], [0.55, 0.38, 0.05], [0.08, 0.26, 0.55],
    [0.3, 0.1, 0.5], [0.45, 0.45, 0.44], [0.08, 0.42, 0.2], [0.5, 0.18, 0.05],
  ];
  let n = 0;
  for (const P of points) {
    for (let j = 0; j < PER; j++, n++) {
      origin[n * 3] = P[0]; origin[n * 3 + 1] = P[1]; origin[n * 3 + 2] = P[2];
      // tall fountain arcs fanned out over the deck and the front floor
      const ang = Math.random() * Math.PI * 2;
      const rr = 0.12 + Math.random() * 0.34;
      const sp = 12 + Math.random() * 7;
      vel[n * 3] = (Math.sin(ang) * rr + 0.3) * sp;
      vel[n * 3 + 1] = (1.15 + Math.random() * 0.45) * sp * 0.85;
      vel[n * 3 + 2] = Math.cos(ang) * rr * sp * 1.5;
      seed[n] = Math.random() * 100;
      const p = palette[(Math.random() * palette.length) | 0];
      col[n * 3] = p[0]; col[n * 3 + 1] = p[1]; col[n * 3 + 2] = p[2];
    }
  }
  inst.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 3));
  inst.setAttribute('aVel', new THREE.InstancedBufferAttribute(vel, 3));
  inst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  inst.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uT0: { value: OFF } },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec3 aOrigin; attribute vec3 aVel; attribute float aSeed; attribute vec3 aCol;
      uniform float uT; uniform float uT0;
      varying float vAlive; varying vec3 vCol; varying float vShade;
      // the ribbon's flight path: drag-damped launch settling to a slow
      // flutter fall, with a lazy sway. Every vertex evaluates this at its
      // own trailing time, which is what draws the curve.
      vec3 traj(float t) {
        float kd = 1.1;
        float e = (1.0 - exp(-t * kd)) / kd;
        vec3 q = aOrigin + aVel * e;
        q.y -= 1.25 * max(t - e, 0.0);
        q.x += sin(t * 1.35 + aSeed) * 0.55 * min(t * 0.6, 1.0);
        q.z += cos(t * 1.1 + aSeed * 1.7) * 0.55 * min(t * 0.6, 1.0);
        return q;
      }
      void main() {
        float age = uT - uT0 - fract(aSeed * 0.19) * 0.6;    // staggered launch
        float life = 7.5 * (0.85 + 0.3 * fract(aSeed * 0.173));
        vAlive = (age > 0.0 && age < life) ? 1.0 : 0.0;
        // s: 0 at the thrown head, 1 at the tail. The tail trails the head by
        // up to ~0.55 s of flight time, which is what unfurls the ribbon.
        float s = 0.5 - position.y;
        float trail = 0.55 * (0.8 + 0.4 * fract(aSeed * 0.53));
        float te = max(age - s * trail, 0.0);
        vec3 q = traj(te);
        // width direction: perpendicular to the local tangent and the view,
        // so the strip always shows its face; a slow twist walks along it
        vec3 tan1 = traj(te + 0.06) - traj(te - 0.06);
        if (length(tan1) < 1e-4) tan1 = vec3(0.0, 1.0, 0.0);
        tan1 = normalize(tan1);
        vec3 wq0 = (modelMatrix * vec4(q, 1.0)).xyz;
        vec3 toEye = normalize(cameraPosition - wq0);
        vec3 side = normalize(cross(tan1, toEye));
        float twist = sin(s * 9.0 + age * 2.0 + aSeed) * 0.6;
        vec3 nrm = normalize(cross(side, tan1));
        vec3 wdir = normalize(side + nrm * twist);
        // rest on the floor, then shrink out
        float fade = 1.0 - smoothstep(life - 1.5, life, age);
        float halfW = 0.055 * fade;
        vec3 w = q + wdir * (position.x * 2.0 * halfW)
               + nrm * sin(s * 14.0 + age * 3.1 + aSeed) * 0.035;  // cloth ripple
        w.y = max(w.y, 0.03);                            // per-vertex floor fold
        vec4 mv = viewMatrix * modelMatrix * vec4(w, 1.0);
        vShade = abs(dot(nrm, toEye));   // raw facing term; the sheen curve lives in the fragment
        vCol = aCol;
        gl_Position = projectionMatrix * mv;
        if (vAlive < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying float vAlive; varying vec3 vCol; varying float vShade;
      void main() {
        if (vAlive < 0.5) discard;
        // mylar ribbon: a dark dyed body that only lights up where it turns
        // its face to you, plus a tight near-white specular streak. Peaks at
        // ~1.1 so it glints hard without ever crossing the bloom gate.
        float body = 0.22 + 0.55 * vShade * vShade;
        float sheen = pow(max(vShade, 0.0), 14.0);
        gl_FragColor = vec4(vCol * body + vec3(0.62, 0.6, 0.58) * sheen, 1.0);
      }`,
  });

  return { mesh: makeMesh(inst, mat), mat };
}

// --- flame colour modes: [core (blooms), tip (does not)] ---------------------
const FLAME_MODES = {
  gold: [[3.4, 2.2, 0.9], [0.9, 0.25, 0.04]],
  blue: [[1.7, 2.5, 3.6], [0.08, 0.22, 0.85]],
  green: [[1.8, 3.4, 1.2], [0.08, 0.65, 0.18]],
  purple: [[2.9, 1.5, 3.6], [0.5, 0.1, 0.8]],
  red: [[3.6, 1.5, 0.9], [0.85, 0.08, 0.04]],
  rainbow: null,                                        // in-shader hue walk
};

// ---------------------------------------------------------------------------
// points: optional buildRig fxPoints ({ pyro, popper, streamer, flame } of
// [x, y, z] triples). Per system, a non-empty list replaces the defaults and
// an absent/empty one leaves them untouched — see the header contract.
export function initPyro(parent, points) {
  const group = new THREE.Group();
  parent.add(group);

  const pyro = makePyro(points && points.pyro);
  const flames = makeFlames(points && points.flame);
  const poppers = makePoppers(points && points.popper);
  const streamers = makeStreamers(points && points.streamer);
  group.add(pyro.mesh, flames.mesh, poppers.mesh, streamers.mesh);

  // curated firework shows: [forceType, forcePal, loopFrac, gapLo, gapHi]
  const PYRO_PRESETS = {
    classic: [-1, -1, 0.7, 0.3, 1.5],
    goldstorm: [0, 0, 0.85, 0.2, 0.8],
    willows: [1, -1, 0.6, 0.6, 1.6],
    rings: [2, -1, 0.7, 0.4, 1.2],
    crackle: [3, -1, 0.75, 0.3, 1.0],
    rainbow: [0, -2, 0.85, 0.25, 0.9],
    finale: [-1, -1, 1.0, 0.05, 0.35],
  };
  const state = { pyro: false, flames: false, flameMode: 'gold', pyroPreset: 'classic' };
  let T = 0;
  // volley bookkeeping: stagger 0.7 + rise ~1.25 + spark life ~1.4 + margin
  const VOLLEY_LIFE = 3.6;
  let volleyEnd = -1;                                   // T when current volley dies
  let nextGap = 0;

  const fireVolley = (frac) => {
    const P = PYRO_PRESETS[state.pyroPreset] || PYRO_PRESETS.classic;
    pyro.mat.uniforms.uForceType.value = P[0];
    pyro.mat.uniforms.uForcePal.value = P[1];
    pyro.mat.uniforms.uT0.value = T;
    pyro.mat.uniforms.uVSeed.value = Math.random() * 100;
    pyro.mat.uniforms.uFrac.value = frac ?? P[2];
    volleyEnd = T + VOLLEY_LIFE;
    nextGap = P[3] + Math.random() * (P[4] - P[3]);
  };

  return {
    group,
    state,

    setPyro(on) {
      state.pyro = !!on;
      if (on && T > volleyEnd) fireVolley();
    },
    firePyro() {
      fireVolley(1.0);                                  // big all-points volley
    },
    setPyroPreset(key) {
      if (!(key in PYRO_PRESETS)) return;
      state.pyroPreset = key;
      fireVolley();                                     // taste it immediately
    },

    setFlames(on) {
      on = !!on;
      if (on === state.flames) return;
      state.flames = on;
      if (on) flames.mat.uniforms.uOnT.value = T;
      else flames.mat.uniforms.uOffT.value = T;
    },
    setFlameMode(mode) {
      if (!(mode in FLAME_MODES)) return;
      state.flameMode = mode;
      const u = flames.mat.uniforms;
      if (mode === 'rainbow') {
        u.uRainbow.value = 1;
      } else {
        u.uRainbow.value = 0;
        u.uColorA.value.setRGB(...FLAME_MODES[mode][0]);
        u.uColorB.value.setRGB(...FLAME_MODES[mode][1]);
      }
    },

    firePoppers() { poppers.mat.uniforms.uT0.value = T; },
    setConfettiDensity(v) { poppers.mat.uniforms.uDensity.value = v; },
    fireStreamers() { streamers.mat.uniforms.uT0.value = T; },

    update(dt) {
      T += Math.min(dt, 0.1);                           // shared clock, tab-safe
      pyro.mat.uniforms.uT.value = T;
      flames.mat.uniforms.uT.value = T;
      poppers.mat.uniforms.uT.value = T;
      streamers.mat.uniforms.uT.value = T;
      // pyro loop: retrigger a fresh partial volley once the last one dies
      if (state.pyro && T > volleyEnd + nextGap) {
        fireVolley();
      }
    },
  };
}
