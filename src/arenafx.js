// Arena-wide special effects — the two that belong to the BUILDING rather than
// to the show rig, so they live here instead of in pyrofx.js:
//
//   POPPERS - 16 confetti cannons ringing the event floor (opaque paper)
//   SHEETS  - flat wide laser planes fanning off the stage over the crowd
//
// Same house pattern as pyrofx: InstancedBufferGeometry, ALL motion computed in
// the vertex shader from per-instance attributes plus a shared uT clock, vAlive
// clip + fragment discard, zero per-frame CPU attribute writes. The CPU only
// ever touches uniforms.
//
// UNLIKE pyrofx this group parents straight to the SCENE, so every coordinate
// below is WORLD space and nothing here is affected by the stage-config
// translate/x-scale. Reference points: floor y = 0, event floor is the bowl's
// rounded rect x in [-33.1, 33.1] / z in [-15.6, 15.6] with a ~10.7 m corner
// radius, stage front lip x = -20 with deck top y = 2.0, roof steel y = 39.4.
//
// Bloom gates on max(r,g,b) > 1.25 (UnrealBloomPass threshold in main.js, with
// its high-pass patched to the max channel so every hue blooms equally). The
// laser's bright cores measure 4.5-8.5 so they glow, while its body stays at
// 0.07-0.4 and does not; confetti paper tops out at 1.149 (colour 1.0 * shade
// 1.0 * 1.15) so it is matte no matter which palette entry it drew.
import * as THREE from 'three';
import { makeConfettiAtlas } from './textures.js';

const OFF = -9999;            // uT0 value meaning "never fired"
const RENDER_ORDER = 20;      // draw over the floor / bowl geometry
const SHEET_ORDER = 21;       // additive sheets after the depth-writing paper

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
// column-major, right-handed, one axis each — cheaper than three rotAxis calls
// and the fan only ever needs roll (its own long axis), pitch, then yaw.
const GLSL_ROT3 = /* glsl */`
  mat3 rotX(float a) { float s = sin(a), c = cos(a);
    return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 rotY(float a) { float s = sin(a), c = cos(a);
    return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rotZ(float a) { float s = sin(a), c = cos(a);
    return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
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
  inst.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 12, 0), 160);
  return inst;
}

function makeMesh(inst, mat, order = RENDER_ORDER) {
  const mesh = new THREE.Mesh(inst, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return mesh;
}

// ---------------------------------------------------------------------------
// The 16 arena popper points, all in WORLD space and all on the PERIMETER of
// the event floor — nothing fires from the middle of the floor, because a
// cannon standing in the crowd reads as a mistake. Every point sits ~1.5 m
// inside the bowl's inner edge (i.e. on the barricade line) at y = 1.5, which
// is just above head height so the paper never appears to erupt out of a
// punter's skull.
//
// The stage owns everything west of x = -20 (pyrofx fires from there), so the
// west pair are the downstage WING corners flanking the pit rather than true
// floor corners.
// ---------------------------------------------------------------------------
const POP_POINTS = [
  [-11.0, 1.5, 14.0], [-3.0, 1.5, 14.0], [5.0, 1.5, 14.0],      // north long side
  [13.0, 1.5, 14.0], [21.0, 1.5, 14.0],
  [-11.0, 1.5, -14.0], [-3.0, 1.5, -14.0], [5.0, 1.5, -14.0],   // south long side
  [13.0, 1.5, -14.0], [21.0, 1.5, -14.0],
  [30.8, 1.5, -4.0], [30.8, 1.5, 4.0],                          // east end, behind the floor seats
  [28.6, 1.5, -11.6], [28.6, 1.5, 11.6],                        // east corners, on the corner radius
  [-18.5, 1.5, -13.2], [-18.5, 1.5, 13.2],                      // downstage wing corners
];

// floor half-extents, used only to derive each point's inward heading
const FLOOR_A = 33.1, FLOOR_B = 15.6;

// ---------------------------------------------------------------------------
// POPPERS — one arena-wide crack of paper from all 16 points. Opaque cutout
// (NOT additive) so the squares read as confetti rather than as light; the
// fragment tops out at 1.15 which keeps every colour under the bloom gate.
// ---------------------------------------------------------------------------
function makePoppers() {
  const PER = 3600;
  const count = POP_POINTS.length * PER;               // 12480 — fills the bowl
  // Squares are deliberately larger than the deck poppers' 4.5 cm: a real
  // 5 cm chad viewed from the 300 level is sub-pixel and dissolves into the
  // half-res bloom mips, so the paper is scaled up to stay readable across a
  // 60 m room. Up close it still reads as confetti.
  const inst = instancedQuad(0.115, 0.115, count);   // square cells so the shapes keep their aspect
  const origin = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const col = new Float32Array(count * 3);
  // party palette; max channel 1.0 so vCol * vShade * 1.15 <= 1.15 < 1.25
  const palette = [
    [1.0, 0.25, 0.45], [1.0, 0.85, 0.2], [0.3, 0.7, 1.0],
    [0.7, 0.35, 1.0], [1.0, 1.0, 1.0], [0.35, 1.0, 0.6],
    [1.0, 0.5, 0.15], [0.95, 0.3, 0.85],
  ];
  // Inward tilt, as a tan, spread PER PARTICLE rather than fixed per cannon.
  // A single throw angle puts all of a cannon's paper on one landing arc, which
  // measured out as two dense stripes at |z| ~ 5-10 and a bare centre floor;
  // fanning the lean from near-vertical to ~43 deg makes each geyser rain from
  // just in front of its own muzzle all the way across the centreline.
  const LEAN_MIN = 0.10, LEAN_MAX = 0.95;
  let n = 0;
  for (const P of POP_POINTS) {
    // Inward heading. Normalising AFTER dividing by the floor half-extents is
    // what makes a point on the long side aim across the short axis instead of
    // pointing at the origin — paper then arcs over the crowd in front of it
    // rather than all 16 cannons converging on centre floor.
    const nx = -P[0] / FLOOR_A, nz = -P[2] / FLOOR_B;
    const nl = Math.hypot(nx, nz) || 1;
    const ix = nx / nl, iz = nz / nl;
    for (let j = 0; j < PER; j++, n++) {
      origin[n * 3] = P[0]; origin[n * 3 + 1] = P[1]; origin[n * 3 + 2] = P[2];
      // vertical geyser leaned inward: a ~16 deg random cone about straight up,
      // then the whole cone tipped toward the arena centre. Wide speed band so
      // the column has body from the muzzle to the crest.
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.28;
      const sp = 18 + Math.random() * 14;
      const lean = LEAN_MIN + Math.random() * (LEAN_MAX - LEAN_MIN);
      let dx = Math.sin(ang) * r + ix * lean;
      let dz = Math.cos(ang) * r + iz * lean;
      const dy = Math.sqrt(Math.max(0.1, 1 - r * r));  // guard: never sqrt(<0)
      const dl = Math.hypot(dx, dy, dz) || 1;
      vel[n * 3] = (dx / dl) * sp;
      vel[n * 3 + 1] = (dy / dl) * sp;
      vel[n * 3 + 2] = (dz / dl) * sp;
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
        // emission staggered over ~0.2 s only: a crack, not a pour. All 16
        // cannons go at once, which is the whole point of the effect.
        float age = uT - uT0 - fract(aSeed * 0.19) * 0.2;
        float life = 8.0 * (0.85 + 0.3 * fract(aSeed * 0.173));
        vAlive = (age > 0.0 && age < life) ? 1.0 : 0.0;
        if (fract(aSeed * 0.377) > uDensity) vAlive = 0.0;   // the AMOUNT slider
        float k = (1.0 - exp(-age * 1.75)) / 1.75;           // launch drag
        vec3 p = aOrigin + aVel * k;
        // gravity blends into a fluttering paper-fall instead of a rock drop;
        // the smoothstep is what turns the ballistic crest into a hang-time
        float fallT = max(age - 0.55, 0.0);
        // hang-time: drag kills almost all of gravity past the crest, leaving
        // a ~0.4 m/s flutter descent like real paper
        p.y -= 1.5 * age * age * (1.0 - smoothstep(0.3, 1.0, age) * 0.75);
        p.y -= 0.9 * fallT;   // falls faster (was 0.38 m/s)
        p.x += sin(age * 2.4 + aSeed) * (0.1 + fallT * 0.55);
        p.z += cos(age * 2.1 + aSeed * 1.7) * (0.1 + fallT * 0.55);
        p.y = max(p.y, 0.02);                                // rest on the deck
        mat3 R = rotAxis(normalize(vec3(sin(aSeed), 1.0, cos(aSeed * 2.0))),
                         age * 11.0 + aSeed);                // fast tumble
        float fade = 1.0 - smoothstep(life - 0.7, life, age); // shrink out
        // hold apparent size past ~22 m: these fire from the far rim, so
        // without this the whole effect is invisible from the floor
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

  return { mesh: makeMesh(inst, mat), mat, life: 8.0 * 1.15 + 0.25 };
}

// ---------------------------------------------------------------------------
// LASER SHEETS
//
// The classic arena effect: a razor-thin horizontal PLANE of light fanning off
// the stage and raking over the crowd. A zero-thickness plane is invisible
// edge-on, which is physically right but useless from a seat at floor level,
// so each emitter gets a STACK of 3 fans at millimetric offsets and sub-degree
// tilts. That reads as a sheet with thickness from below without costing
// anything: all 9 fans are instances of one geometry in ONE draw call.
//
// Geometry is authored in a normalised fan space — position.x = u in [0,1]
// along the throw, position.z = v in [-1,1] across — and the vertex shader
// turns that into the real trapezoid, so mode changes (wide fan vs narrow
// scan) are a uniform write rather than a geometry rebuild.
// ---------------------------------------------------------------------------
const SHEET_EMITTERS = [
  // apex x/y/z, then the emitter's resting yaw. Hung on the downstage truss
  // just in front of the lip (x = -19.2) and above the deck (y = 8.6) so the
  // sheet clears the band and the wings splay out over their own third.
  [-19.2, 8.6, -9.0, 0.15],
  [-19.2, 8.6, 0.0, 0.0],
  [-19.2, 8.6, 9.0, -0.15],
];
const SHEET_LEN = 52;        // metres from apex to far edge — apex to the east wall
const SHEET_NEAR_HW = 0.35;  // half-width at the apex; a literal point pinches ugly
const SHEET_FAR_HW = 26;     // half-width at full spread, scaled by uWidth

// [halfWidth, pitchCentre, pitchAmp, pitchRate, yawAmp, yawRate, intensity,
//  strobe, counterRotate] — pitch is radians about the apex, negative = raking
// down at the floor. The useful band is about -16 deg (near floor) to +6 deg
// (up into the 300 level), which is what the centres/amps below stay inside.
// `in` is deliberately low: nine additive layers overlap, so anything that
// looks right on ONE fan whites out the arena once the stack sums.
const SHEET_MODES = {
  fan:    { w: 1.00, pc: -0.10, pa: 0.13, pr: 0.42, ya: 0.10, yr: 0.17, in: 0.90, st: 0, cr: 0 },
  scan:   { w: 0.32, pc: -0.09, pa: 0.21, pr: 1.55, ya: 0.26, yr: 0.55, in: 1.05, st: 0, cr: 0 },
  cross:  { w: 0.48, pc: -0.11, pa: 0.11, pr: 0.60, ya: 0.58, yr: 0.44, in: 0.95, st: 0, cr: 1 },
  strobe: { w: 0.85, pc: -0.10, pa: 0.16, pr: 0.85, ya: 0.14, yr: 0.30, in: 1.25, st: 1, cr: 0 },
};

// Normalised fan grid. 40 spans along the throw / 24 across: the shading is all
// analytic in the fragment, but the vertex stage bows and ripples the sheet
// (see uT usage below) and that curvature needs real vertices to sit on.
function fanGeometry(lseg, wseg) {
  const nx = lseg + 1, nz = wseg + 1;
  const pos = new Float32Array(nx * nz * 3);
  const idx = new Uint16Array(lseg * wseg * 6);        // 1025 verts, well under 65k
  let p = 0;
  for (let i = 0; i < nx; i++) {
    // pow of a non-negative base — packs rows toward the apex, where the fan's
    // angular width (and so its shading gradient) changes fastest
    const u = Math.pow(i / lseg, 0.85);
    for (let j = 0; j < nz; j++) {
      pos[p++] = u; pos[p++] = 0; pos[p++] = (j / wseg) * 2 - 1;
    }
  }
  let k = 0;
  for (let i = 0; i < lseg; i++) {
    for (let j = 0; j < wseg; j++) {
      const a = i * nz + j, b = a + nz;
      idx[k++] = a; idx[k++] = b; idx[k++] = a + 1;
      idx[k++] = b; idx[k++] = b + 1; idx[k++] = a + 1;
    }
  }
  return { pos, idx };
}

function makeSheets() {
  const LSEG = 40, WSEG = 24, LAYERS = 3;
  const { pos, idx } = fanGeometry(LSEG, WSEG);
  const inst = new THREE.InstancedBufferGeometry();
  inst.setIndex(new THREE.BufferAttribute(idx, 1));
  inst.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const count = SHEET_EMITTERS.length * LAYERS;        // 9 fans, 1 draw call
  inst.instanceCount = count;
  inst.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 12, 0), 90);

  const apex = new Float32Array(count * 3);
  const emit = new Float32Array(count);
  const layer = new Float32Array(count);
  const yaw0 = new Float32Array(count);
  let n = 0;
  SHEET_EMITTERS.forEach((E, ei) => {
    for (let l = 0; l < LAYERS; l++, n++) {
      apex[n * 3] = E[0]; apex[n * 3 + 1] = E[1]; apex[n * 3 + 2] = E[2];
      emit[n] = ei;
      layer[n] = l - (LAYERS - 1) * 0.5;               // -1, 0, +1
      yaw0[n] = E[3];
    }
  });
  inst.setAttribute('aApex', new THREE.InstancedBufferAttribute(apex, 3));
  inst.setAttribute('aEmit', new THREE.InstancedBufferAttribute(emit, 1));
  inst.setAttribute('aLayer', new THREE.InstancedBufferAttribute(layer, 1));
  inst.setAttribute('aYaw0', new THREE.InstancedBufferAttribute(yaw0, 1));

  const M = SHEET_MODES.fan;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uT: { value: 0 },                                // speed-warped sheet clock
      uColor: { value: new THREE.Color(1, 1, 1) },      // pre-normalised, see setSheetColor
      uWidth: { value: M.w },
      uPitchC: { value: M.pc }, uPitchA: { value: M.pa }, uPitchR: { value: M.pr },
      uYawA: { value: M.ya }, uYawR: { value: M.yr },
      uInt: { value: M.in },
      uStrobe: { value: M.st }, uCross: { value: M.cr },
    },
    transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec3 aApex; attribute float aEmit; attribute float aLayer; attribute float aYaw0;
      uniform float uT; uniform float uWidth;
      uniform float uPitchC; uniform float uPitchA; uniform float uPitchR;
      uniform float uYawA; uniform float uYawR;
      uniform float uInt; uniform float uStrobe; uniform float uCross;
      varying float vAlong; varying float vAcross; varying float vInt; varying float vScan;
      varying vec3 vNrm; varying vec3 vView;
      ${GLSL_HASH}
      ${GLSL_ROT3}
      const float STROBE_HZ = 11.0;      // in warped-clock time, so speed scales it
      void main() {
        float u = position.x;            // 0 at the apex, 1 at the far edge
        float v = position.z;            // -1 .. 1 across the fan
        vAlong = u; vAcross = v;
        // Emitters run 120 deg out of phase so the three fans never sweep as
        // one slab. In cross mode alternate emitters take the opposite yaw sign,
        // which is what makes the sheets scissor through each other.
        float ph = aEmit * 2.0944;
        float dir = uCross > 0.5 ? (mod(aEmit, 2.0) * 2.0 - 1.0) : 1.0;
        // Strobe quantises the CLOCK, not just the brightness: each flash
        // freezes the sheet at a discrete angle. A sin() envelope here would
        // read as a fade — a strobe has to be stepped.
        float tq = uStrobe > 0.5 ? floor(uT * STROBE_HZ) / STROBE_HZ : uT;
        float pitch = uPitchC + uPitchA * sin(tq * uPitchR + ph)
                    + aLayer * 0.013;    // sub-degree tilt spreads the stack
        float yaw = aYaw0 + uYawA * sin(tq * uYawR + ph * 1.7) * dir;
        float roll = aLayer * 0.010;     // and separates it across the width too
        // real trapezoid: half-width grows linearly from the apex
        float hw = mix(${SHEET_NEAR_HW.toFixed(2)}, ${SHEET_FAR_HW.toFixed(1)} * uWidth, u);
        vec3 q = vec3(u * ${SHEET_LEN.toFixed(1)}, 0.0, v * hw);
        // A scanned sheet is never dead flat: its edges sag and a slow wave
        // walks down it. Tiny, but it stops the fan looking like cardboard.
        q.y -= 0.35 * v * v * u;
        q.y += sin(u * 4.0 + uT * 1.3 + ph) * 0.06 * u;
        mat3 R = rotY(yaw) * rotZ(pitch) * rotX(roll);
        vec3 p = R * q + aApex + vec3(0.0, aLayer * 0.06, 0.0);
        // The fan's own normal and the view ray, both in world space: the
        // fragment needs them to work out how much sheet a ray passes through.
        vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
        vNrm = (modelMatrix * vec4(R * vec3(0.0, 1.0, 0.0), 0.0)).xyz;
        vView = wp - cameraPosition;
        // outer layers at half strength so the stack of 3 sums to a hot core
        // rather than triple-counting it
        float w = abs(aLayer) < 0.5 ? 1.0 : 0.5;
        float gate = 1.0;
        if (uStrobe > 0.5) {
          // irregular hard on/off, one decision per quantised frame
          gate = step(0.42, hash1(floor(uT * STROBE_HZ) * 0.731 + aEmit * 0.17));
        }
        vInt = uInt * w * gate;
        vScan = uT * 1.4 + aLayer * 0.37 + aEmit * 1.7;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        if (vInt < 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vAlong; varying float vAcross; varying float vInt; varying float vScan;
      varying vec3 vNrm; varying vec3 vView;
      void main() {
        if (vInt < 0.001) discard;
        // FEATHERED EDGES: a flat plateau across the middle 55% of the fan with
        // gaussian shoulders out to the rim, so the sheet never shows its
        // polygon silhouette. This is the difference between "laser" and "quad".
        float ax = abs(vAcross);
        float sh = max(ax - 0.55, 0.0) / 0.45;
        float feather = exp(-sh * sh * 3.4);
        // the scanner dwells on its own axis, so the centreline runs hotter
        float centre = 1.0 + 0.9 * exp(-ax * ax * 22.0);
        // Throw fade to NOTHING at the far edge. An 18% tail left a hard
        // straight cut hanging in mid-air, which instantly reads as a polygon;
        // the sheet has to dissolve into the dark instead.
        float len = smoothstep(0.0, 0.03, vAlong)          // mask the apex pinch
                  * (1.0 - smoothstep(0.35, 1.0, vAlong))
                  * (1.0 - 0.3 * vAlong);
        // travelling scan stripes: a narrow band marching outward down the fan
        // plus a fine ripple. max() keeps pow's base non-negative.
        float sp = fract(vAlong * 6.0 - vScan);
        float band = pow(max(1.0 - abs(sp - 0.5) * 2.0, 0.0), 7.0);
        float fine = 0.88 + 0.12 * sin(vAlong * 64.0 - vScan * 3.0);
        // PATH LENGTH — the term that makes this read as light rather than as
        // plastic. A laser sheet is a thin slab of lit haze, so a ray's
        // brightness goes as the distance it spends inside it: 1/|cos| against
        // the sheet normal. Without it the plane does the exact OPPOSITE of the
        // real thing — face-on it covers the most pixels at full alpha and
        // turns into a milky slab, while the grazing view that ought to blaze
        // is the one that thins out. Clamped to a ~4.5x swing (the true 1/cos
        // asymptote is far too violent) and max() keeps the divide finite.
        float cosn = abs(dot(normalize(vView), normalize(vNrm)));
        float path = clamp(0.55 / max(cosn, 0.10), 0.55, 2.2);
        // ABASE is calibrated for the OVERLAP, not for one fan: in wide-fan mode
        // all 9 sheets (3 emitters x 3 stack layers) cover the same crowd and
        // add together, so a per-fan alpha tuned in isolation blows out ~9x over.
        // The 5x band term is the whole bloom budget: the sheet's BODY has to
        // stay at ~0.1 (haze, under the gate) while the travelling stripes and
        // the centreline spike past 1.25 and glow. Raising the overall level
        // instead would just turn the entire fan into a white slab.
        float a = min(feather * len * (1.0 + 5.0 * band) * fine * path * vInt * 0.13, 0.9);
        if (a < 0.003) discard;
        // uColor is normalised to max channel 1.0 upstream, so the contract
        // holds for ANY hue (measured: a pure-red sheet peaks at 4.7). Measured
        // over the composited frame, bands/centreline peak 4.5-8.5 and only
        // 1-5% of lit pixels clear 1.25; the body and the feathered rim average
        // 0.07-0.4 and stay crisp, unbloomed haze. Face-on peaks at 1.05 and
        // never blooms, which is the correct behaviour for a sheet seen flat.
        gl_FragColor = vec4(uColor * (0.55 + 2.2 * feather * centre) * a, a);
      }`,
  });

  return { mesh: makeMesh(inst, mat, SHEET_ORDER), mat };
}

// ---------------------------------------------------------------------------
export function initArenaFX(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const pop = makePoppers();
  const sheets = makeSheets();
  // sheets get their own sub-group so setSheet(false) kills the draw call with
  // a single visible flag instead of unwinding uniforms
  const sheetGroup = new THREE.Group();
  sheetGroup.visible = false;
  sheetGroup.add(sheets.mesh);
  group.add(pop.mesh, sheetGroup);
  pop.mesh.visible = false;

  const state = {
    sheet: false,
    sheetMode: 'fan',
    sheetColor: new THREE.Color(0x35c8ff),
    sheetSpeed: 1,
  };

  // Two independent clocks, each frozen while its effect is idle. That is what
  // lets update() be genuinely free when the module is doing nothing, and it
  // means a sheet left on for ten minutes never accumulates float error from
  // popper frames it did not care about.
  let T = 0;              // popper clock — runs only while paper is in flight
  let popEnd = -1;        // T at which the last burst finishes
  let TS = 0;             // sheet clock — runs only while the sheet is on, and
                          // is warped by sheetSpeed so a speed change never
                          // teleports the sweep mid-stroke

  const tint = new THREE.Color();
  function applyColor() {
    // Normalise to max channel 1.0 before handing the tint to the shader: the
    // fragment multiplies by up to ~3.5 and the bloom gate reads max(r,g,b),
    // so a dim input hue would otherwise produce a laser that refuses to glow.
    tint.copy(state.sheetColor);
    const m = Math.max(tint.r, tint.g, tint.b);
    if (m > 1e-4) tint.multiplyScalar(1 / m);
    else tint.setRGB(1, 1, 1);
    sheets.mat.uniforms.uColor.value.copy(tint);
  }
  function applyMode() {
    const M = SHEET_MODES[state.sheetMode] || SHEET_MODES.fan;
    const u = sheets.mat.uniforms;
    u.uWidth.value = M.w;
    u.uPitchC.value = M.pc; u.uPitchA.value = M.pa; u.uPitchR.value = M.pr;
    u.uYawA.value = M.ya; u.uYawR.value = M.yr;
    u.uInt.value = M.in;
    u.uStrobe.value = M.st; u.uCross.value = M.cr;
  }
  applyColor();
  applyMode();

  return {
    group,
    state,

    firePoppers() {
      T += 0.0001;                       // never re-fire on the exact same uT0
      pop.mat.uniforms.uT0.value = T;
      pop.mat.uniforms.uT.value = T;
      popEnd = T + pop.life;
      pop.mesh.visible = true;
    },
    setConfettiDensity(v) { pop.mat.uniforms.uDensity.value = v; },

    setSheet(on) {
      state.sheet = !!on;
      sheetGroup.visible = state.sheet;
    },
    setSheetMode(mode) {
      if (!(mode in SHEET_MODES)) return;
      state.sheetMode = mode;
      applyMode();
    },
    setSheetColor(color) {
      state.sheetColor.set(color);       // accepts THREE.Color, hex or css string
      applyColor();
    },
    setSheetSpeed(k) {
      const v = Number(k);
      state.sheetSpeed = Number.isFinite(v) ? Math.max(0.2, Math.min(3, v)) : 1;
    },

    update(dt) {
      // Tab-safe AND poison-safe. Math.min(NaN, 0.1) is NaN, and one NaN frame
      // would latch into both clocks permanently and silently kill the module;
      // `dt > 0` is false for NaN and for a negative dt, so both fall to zero.
      const d = dt > 0 ? Math.min(dt, 0.1) : 0;
      const live = T < popEnd;
      if (live) {
        T += d;
        pop.mat.uniforms.uT.value = T;
      } else if (pop.mesh.visible) {
        pop.mesh.visible = false;        // burst over — drop the draw call
      }
      if (state.sheet) {
        TS += d * state.sheetSpeed;
        sheets.mat.uniforms.uT.value = TS;
      }
      // both idle: the two comparisons above are the entire per-frame cost
    },
  };
}
