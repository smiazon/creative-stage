// Atmosphere package: floor fog + CO2 jets.
//
// Two GPU particle systems following the pyrofx/makeConfetti house pattern:
// InstancedBufferGeometry quads, ALL motion computed in the vertex shader from
// per-instance seeds plus a shared uT clock; the CPU only ever writes uniforms.
//
//   FLOOR FOG - ~46 huge soft puffs drifting low over the event floor. Lives
//               in WORLD space (added to `scene`) because haze belongs to the
//               room, not the rig. NormalBlending — fog occludes, it does not
//               glow — and every colour sits far under the 1.25 bloom gate.
//   CO2 JETS  - 8 cannons on the deck lip in RIG-LOCAL coords (added to
//               `rigParent`, which stage configs translate/x-scale). One
//               synchronized violent white vertical blast per fire, the
//               uT0-retrigger idiom from pyrofx. Crisp white kept at <= 1.1
//               so the plume reads as dense gas, never as a light source.
import * as THREE from 'three';

const OFF = -9999;                 // uT0 value meaning "never fired"
const FOG_RENDER_ORDER = 15;       // over set pieces, under pyro (20)
const JET_RENDER_ORDER = 16;

const GLSL_HASH = /* glsl */`
  float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
`;

// --- shared soft radial puff sprite ------------------------------------------
// Blurry greyish-blue radial gradient (0.5, 0.55, 0.62). The colour is baked
// into the texture; the jets re-tint it toward white in the fragment shader.
function makePuffTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, 'rgba(128, 140, 158, 0.85)');
  g.addColorStop(0.35, 'rgba(128, 140, 158, 0.5)');
  g.addColorStop(0.7, 'rgba(128, 140, 158, 0.16)');
  g.addColorStop(1.0, 'rgba(128, 140, 158, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// unit-quad instancing base (the pyrofx idiom)
function instancedQuad(count, center, radius) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const inst = new THREE.InstancedBufferGeometry();
  inst.index = geo.index;
  inst.attributes.position = geo.attributes.position;
  inst.attributes.uv = geo.attributes.uv;
  inst.instanceCount = count;
  inst.boundingSphere = new THREE.Sphere(center, radius);
  return inst;
}

// ---------------------------------------------------------------------------
// FLOOR FOG — 46 billboarded puffs, 6-12 m wide, hanging at y 0.6-2.2 over
// the event floor (x -30..34, z +-13). Slow drift with wrap-around, gentle
// scale breathing and a lazy in-plane rotation, all derived from aSeed + uT.
// ---------------------------------------------------------------------------
function makeFloorFog(tex) {
  const COUNT = 46;
  const inst = instancedQuad(COUNT, new THREE.Vector3(2, 1.4, 0), 45);
  const seed = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) seed[i] = i * 13.73 + Math.random() * 7;
  inst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uT: { value: 0 },
      uMap: { value: tex },
      uEnv: { value: 0 },        // 0..1 fade envelope (setFog, ~2 s)
      uDensity: { value: 0.85 }, // 0.3..1.4 (setFogDensity)
      uTint: { value: new THREE.Color(0, 0, 0) },   // live show-light bounce
    },
    transparent: true, blending: THREE.NormalBlending,
    depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uT; uniform float uEnv; uniform float uDensity;
      varying vec2 vUv; varying float vAlpha;
      ${GLSL_HASH}
      void main() {
        // static per-puff parameters
        float h1 = hash1(aSeed);
        float h2 = hash1(aSeed + 1.7);
        float h3 = hash1(aSeed + 3.9);
        float h4 = hash1(aSeed + 5.2);
        float h5 = hash1(aSeed + 7.8);
        float h6 = hash1(aSeed + 9.4);
        float size = 6.0 + 6.0 * h4;                     // 6-12 m
        float op = 0.035 + 0.075 * h5;                   // per-puff opacity (kept subtle)
        // slow drift (~0.3 m/s) with wrap-around inside the floor bounds
        float ang = h6 * 6.2831853;
        vec2 drift = vec2(cos(ang), sin(ang)) * (0.22 + 0.16 * h3);
        float px = -30.0 + mod(h1 * 64.0 + drift.x * uT + 6400.0, 64.0);  // x -30..34
        float pz = -13.0 + mod(h2 * 26.0 + drift.y * uT + 2600.0, 26.0);  // z +-13
        float py = 0.6 + 1.6 * h3;                       // y 0.6-2.2
        // gentle wallow so the layer never reads as a static sheet
        px += sin(uT * 0.11 + aSeed) * 0.8;
        py += sin(uT * 0.17 + aSeed * 1.7) * 0.15;
        // scale breathing + slow in-plane rotation
        float breathe = 1.0 + 0.13 * sin(uT * 0.16 + aSeed * 2.3);
        float rot = uT * (0.03 + 0.05 * h4) * (h5 > 0.5 ? 1.0 : -1.0) + aSeed;
        float cs = cos(rot), sn = sin(rot);
        vec2 corner = mat2(cs, sn, -sn, cs) * position.xy * size * breathe;
        vUv = uv;
        vAlpha = op * uEnv * uDensity;
        vec4 mv = modelViewMatrix * vec4(px, py, pz, 1.0);
        mv.xy += corner;                                 // billboard
        gl_Position = projectionMatrix * mv;
        if (vAlpha < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      uniform vec3 uTint;
      varying vec2 vUv; varying float vAlpha;
      void main() {
        vec4 tx = texture2D(uMap, vUv);
        if (tx.a * vAlpha < 0.003) discard;
        // a TINY bounce of the live show colour makes the haze feel lit
        vec3 col = tx.rgb + uTint * 0.28;
        gl_FragColor = vec4(col, tx.a * vAlpha);         // matte haze, no bloom
      }`,
  });

  const mesh = new THREE.Mesh(inst, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = FOG_RENDER_ORDER;
  return { mesh, mat };
}

// ---------------------------------------------------------------------------
// CO2 JETS — 8 nozzles on the deck lip (rig-local x=-19.7, y=2.1, z +-12).
// One blast: ~40 quads per nozzle rocket up 5-7 m in ~0.45 s with a slight
// outward lean, then billow and dissipate over ~1.6 s (scale grows, opacity
// dies). White-grey 0.85..1.1 — crisp, but always under the bloom gate.
// ---------------------------------------------------------------------------
function makeJets(tex) {
  const NOZZLES = 8, PER = 40;
  const count = NOZZLES * PER;                           // 320
  const inst = instancedQuad(count, new THREE.Vector3(-19.7, 5.5, 0), 30);
  const origin = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const along = new Float32Array(count);                 // 0 base .. 1 tip

  let n = 0;
  for (let i = 0; i < NOZZLES; i++) {
    const z = -12 + (i / (NOZZLES - 1)) * 24;            // z spread +-12
    for (let j = 0; j < PER; j++, n++) {
      origin[n * 3] = -19.7; origin[n * 3 + 1] = 2.1; origin[n * 3 + 2] = z;
      seed[n] = Math.random() * 100;
      along[n] = (j + 0.5) / PER;                        // fills the whole column
    }
  }
  inst.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 3));
  inst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  inst.setAttribute('aAlong', new THREE.InstancedBufferAttribute(along, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uT: { value: 0 },
      uT0: { value: OFF },
      uMap: { value: tex },
    },
    transparent: true, blending: THREE.NormalBlending,
    depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec3 aOrigin; attribute float aSeed; attribute float aAlong;
      uniform float uT; uniform float uT0;
      varying vec2 vUv; varying vec3 vCol; varying float vAlpha; varying float vAlive;
      ${GLSL_HASH}
      void main() {
        vUv = uv;
        // tiny stagger keeps the blast violent but gives the column body
        float age = uT - uT0 - fract(aSeed * 0.19) * 0.06;
        float life = 2.05 * (0.85 + 0.3 * fract(aSeed * 0.173));
        vAlive = (age > 0.0 && age < life) ? 1.0 : 0.0;
        float H = 5.0 + 2.0 * hash1(aSeed);              // 5-7 m column
        // rise: violent ease-out over ~0.45 s carries this quad to its slot
        float u = clamp(age / 0.45, 0.0, 1.0);
        float ue = 1.0 - pow(1.0 - u, 3.0);
        float y = ue * H * aAlong;
        // slight outward lean (downstage +x, fanned in z away from center)
        vec3 lean = normalize(vec3(0.55, 0.0, sign(aOrigin.z) * 0.18
                                   + (hash1(aSeed + 4.4) - 0.5) * 0.3));
        vec3 p = aOrigin + vec3(0.0, y, 0.0) + lean * y * 0.16;
        // billow phase: keeps creeping up, wobbles, and swells
        float bt = max(age - 0.45, 0.0);
        p.y += bt * 0.7 * aAlong;
        p.x += sin(age * 5.0 + aSeed) * (0.06 + bt * 0.3);
        p.z += cos(age * 4.3 + aSeed * 1.7) * (0.06 + bt * 0.3);
        // size: tight muzzle -> plume; only a modest swell at the end so the
        // jet dies crisp instead of ballooning into a blur
        float size = (0.5 + 1.1 * aAlong) * (0.35 + 0.65 * ue) * (1.0 + bt * 0.35)
                   * (0.8 + 0.4 * hash1(aSeed + 2.2));
        // crisp white at eruption cooling to grey, all under the bloom gate
        float g = 0.85 + 0.25 * hash1(aSeed + 6.1);      // 0.85..1.1
        vCol = vec3(g) * (1.0 - 0.22 * smoothstep(0.3, 1.4, age));
        // opacity: instant slam on, dies over ~1.6 s after the rise
        vAlpha = smoothstep(0.0, 0.04, age)
               * pow(1.0 - smoothstep(0.4, life * 0.92, age), 1.6)
               * (0.55 + 0.35 * aAlong * (1.0 - aAlong) * 4.0 * 0.5);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        mv.xy += position.xy * size;                     // billboard
        gl_Position = projectionMatrix * mv;
        if (vAlive < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      varying vec2 vUv; varying vec3 vCol; varying float vAlpha; varying float vAlive;
      void main() {
        if (vAlive < 0.5) discard;
        vec4 tx = texture2D(uMap, vUv);
        float a = tx.a * vAlpha;
        if (a < 0.004) discard;
        // re-tint the grey-blue sprite toward jet white, staying <= 1.1
        gl_FragColor = vec4(vCol * (tx.rgb * 1.9), a);
      }`,
  });

  const mesh = new THREE.Mesh(inst, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = JET_RENDER_ORDER;
  return { mesh, mat };
}

// ---------------------------------------------------------------------------
export function initSmoke(rigParent, scene) {
  const tex = makePuffTexture();

  const fog = makeFloorFog(tex);
  scene.add(fog.mesh);                 // world space: haze belongs to the room

  const jets = makeJets(tex);
  rigParent.add(jets.mesh);            // rig-local: cannons travel with the deck

  const state = { fog: false, fogDensity: 0.5, jets: false };
  let T = 0;
  let fogEnv = 0;                      // eased 0..1 over ~2 s
  let nextJetT = Infinity;

  const fireJets = () => { jets.mat.uniforms.uT0.value = T; };

  return {
    setFog(on) {
      state.fog = !!on;
    },
    setFogDensity(k) {
      state.fogDensity = Math.min(1, Math.max(0, k));
      fog.mat.uniforms.uDensity.value = 0.3 + 1.1 * state.fogDensity;
    },
    setJets(on) {
      on = !!on;
      if (on === state.jets) return;
      state.jets = on;
      if (on) { fireJets(); nextJetT = T + 2.2 + Math.random() * 1.3; }
      else nextJetT = Infinity;
    },
    fireJets,
    update(dt) {
      T += Math.min(dt, 0.1);          // shared clock, tab-safe
      fog.mat.uniforms.uT.value = T;
      jets.mat.uniforms.uT.value = T;
      // fog fade envelope: 0 -> 1 (or back) over ~2 s
      const target = state.fog ? 1 : 0;
      const step = Math.min(dt, 0.1) / 2.0;
      fogEnv = target > fogEnv ? Math.min(target, fogEnv + step)
                               : Math.max(target, fogEnv - step);
      fog.mat.uniforms.uEnv.value = fogEnv;
      // auto-fire loop: a fresh synchronized blast every 2.2-3.5 s
      if (state.jets && T >= nextJetT) {
        fireJets();
        nextJetT = T + 2.2 + Math.random() * 1.3;
      }
    },
    setTint(c) { fog.mat.uniforms.uTint.value.copy(c); },
    state,
  };
}
