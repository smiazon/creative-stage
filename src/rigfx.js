// Show-lighting engine for the touring rig.
//
// Design constraints that shaped this file (all measured, not guessed):
//  * FILL RATE is the wall, not draw calls. Every visual is one InstancedMesh;
//    beam cones are budgeted and their .count is written each frame after
//    sorting the brightest fixtures first.
//  * Real three.js lights are a FIXED patch. Adding or removing a visible light
//    changes NUM_SPOT_LIGHTS, a shader permutation key, which recompiles every
//    lit material mid-show. So we only ever animate intensity/color/target.
//  * Bloom gates on max(r,g,b) > 1.25 (UnrealBloomPass threshold in main.js).
//    Anything that must glow is written ABOVE that; anything below reads dead.
//  * `toneMapped:false` is a no-op here — everything renders through
//    EffectComposer, so tone mapping happens once in OutputPass regardless.
//  * Beam cone alpha is derived from the beam AXIS, never from normals:
//    normalMatrix does not fold in instanceMatrix in a hand-written shader.
//  * Strobes are quantised to FRAMES; sin(t*k) aliases into mush at 60fps.
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { IS_STADIUM } from './venue.js';
import { BOWL_A, BOWL_B, laserRings } from './bowl.js';
import { makeLampGlow, makeBlinderLamps, makeStrobeBar, makeConfettiAtlas } from './textures.js';

const DEG = Math.PI / 180;

// hue -> rgb helpers (s=1, l=0.5)
function hueR(h) { h = ((h % 1) + 1) % 1; return Math.min(1, Math.max(0, Math.abs(h * 6 - 3) - 1)); }
function hueG(h) { h = ((h % 1) + 1) % 1; return Math.min(1, Math.max(0, 2 - Math.abs(h * 6 - 2))); }
function hueB(h) { h = ((h % 1) + 1) % 1; return Math.min(1, Math.max(0, 2 - Math.abs(h * 6 - 4))); }

// ---------------------------------------------------------------------------
// Beam cone shader. Cone apex at local origin, opening down -Y with unit
// length and unit radius, so instanceMatrix scale sets throw and spread.
// ---------------------------------------------------------------------------
// Tiling value-noise for the haze integrator — 128px is plenty, it is read at
// two very different scales and multiplied against itself.
function makeHazeNoise() {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d');
  const img = x.createImageData(N, N);
  let s = 1234567;
  const rnd = () => (s = (16807 * s) % 2147483647) / 2147483647;
  // coarse lattice, bilinear-upsampled, so the texture tiles and stays soft
  const G = 16, lat = new Float32Array((G + 1) * (G + 1));
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  for (let j = 0; j <= G; j++) { lat[j * (G + 1) + G] = lat[j * (G + 1)]; lat[G * (G + 1) + j] = lat[j]; }
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const gx = (px / N) * G, gy = (py / N) * G;
      const ix = Math.floor(gx), iy = Math.floor(gy);
      const fx = gx - ix, fy = gy - iy;
      const v00 = lat[iy * (G + 1) + ix], v10 = lat[iy * (G + 1) + ix + 1];
      const v01 = lat[(iy + 1) * (G + 1) + ix], v11 = lat[(iy + 1) * (G + 1) + ix + 1];
      const v = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
      const o = (py * N + px) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(v * 255);
      img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

const beamVert = /* glsl */`
  attribute vec3 aColor;
  attribute float aIntensity;
  attribute vec3 aApex;      // lens position, rig-local
  attribute vec3 aDir;       // unit aim, rig-local
  attribute float aLen;      // throw in metres
  attribute float aRad;      // cone radius at full throw, metres
  attribute float aKind;     // 0 spot · 1 wash · 2 beam — picks the optics
  attribute float aGobo;     // 0 open · 1 breakup · 2 bars · 3 dots · 4 star
  varying vec3 vCol;
  varying float vI;
  varying vec3 vWorld;
  varying vec3 vApexW;
  varying vec3 vDirW;
  varying float vLen;
  varying float vRad;
  varying float vKind;
  varying float vGobo;
  void main() {
    vCol = aColor;
    vI = aIntensity;
    vKind = aKind;
    vGobo = aGobo;
    // Everything the fragment integrator needs, promoted to WORLD space here
    // so the march runs in one frame end to end. modelMatrix carries the rig
    // group's x-shift/x-stretch, so wizard configs and plans both land where
    // their cones actually are.
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vApexW = (modelMatrix * vec4(aApex, 1.0)).xyz;
    vec3 dw = mat3(modelMatrix) * aDir;
    float dl = max(length(dw), 1e-5);
    vDirW = dw / dl;
    vLen = aLen * dl;          // the group's x-stretch stretches the throw too
    vRad = aRad;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const beamFrag = /* glsl */`
  varying vec3 vCol;
  varying float vI;
  varying vec3 vWorld;
  varying vec3 vApexW;
  varying vec3 vDirW;
  varying float vLen;
  varying float vRad;
  varying float vKind;
  varying float vGobo;
  uniform float uHaze;
  uniform float uTime;
  uniform sampler2D uNoise;

  // ---------------------------------------------------------------------
  // VOLUMETRIC BEAM. The cone mesh is only a proxy hull: for each pixel we
  // intersect the eye ray with the cone analytically, clamp to the throw,
  // and MARCH the segment, accumulating single-scattered light with the
  // real physics of a beam in haze:
  //   · inverse-square falloff from the source
  //   · Beer-Lambert extinction on the light path AND the view path
  //   · Henyey-Greenstein phase (forward scattering): blinding looked
  //     into, faint from behind — the single biggest realism tell
  //   · a hot gaussian core inside a soft envelope, so the beam has a
  //     centre instead of a flat fill
  //   · drifting noise, because real air is never uniform
  //   · the hot core clips toward white like a discharge source
  // Limb brightening at the silhouette falls out of the march for free:
  // grazing rays simply spend longer inside the volume.
  // ---------------------------------------------------------------------
  const int STEPS = 9;   // dither hides the coarser march; 25% off the integrator

  float hgPhase(float c, float g) {
    float g2 = g * g;
    return (1.0 - g2) / max(pow(1.0 + g2 - 2.0 * g * c, 1.5), 1e-3) * 0.25;
  }
  float noise2(vec2 p) { return texture2D(uNoise, p).r; }

  void main() {
    // per-kind optics: core tightness, phase anisotropy, density gain
    float coreT = vKind < 0.5 ? 5.0 : (vKind < 1.5 ? 2.2 : 9.0);
    float g     = vKind < 0.5 ? 0.55 : (vKind < 1.5 ? 0.42 : 0.66);
    float dens  = vKind < 0.5 ? 1.0 : (vKind < 1.5 ? 0.5 : 1.4);

    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - cameraPosition);

    // analytic ray vs cone: apex vApexW, axis vDirW, cos²θ = 1/(1+tan²θ)
    float k = vRad / max(vLen, 1e-4);
    float cos2 = 1.0 / (1.0 + k * k);
    vec3 co = ro - vApexW;
    float dv = dot(rd, vDirW), cv = dot(co, vDirW);
    float A = dv * dv - cos2;
    // a ray parallel to the cone surface degenerates the quadratic; NaN in an
    // additive buffer smears through bloom as a black frame — drop the sliver
    if (abs(A) < 1e-5) discard;
    float B = 2.0 * (dv * cv - dot(rd, co) * cos2);
    float C = cv * cv - dot(co, co) * cos2;
    float disc = B * B - 4.0 * A * C;
    if (disc < 0.0) discard;
    float sq = sqrt(disc);
    float t0 = (-B - sq) / (2.0 * A);
    float t1 = (-B + sq) / (2.0 * A);
    if (t0 > t1) { float tt = t0; t0 = t1; t1 = tt; }
    // start the march 1.2 m out: standing inside a cone otherwise integrates
    // its densest metres right at the lens and whites out the whole view
    t0 = max(t0, 1.2);
    if (t1 <= t0) discard;
    // cap the march span — and cap it ABSOLUTELY too: looking straight down
    // a cone integrates its whole 40 m throw where a side view crosses ~3 m,
    // which is exactly the on-axis white-out. 15 m of participation reads
    // identical from the side and keeps the down-axis view survivable.
    t1 = min(t1, t0 + min(vLen * 1.6, 15.0));

    // dithered start hides the step count completely
    float dith = noise2(gl_FragCoord.xy / 128.0);
    float dt = (t1 - t0) / float(STEPS);
    float t = t0 + dt * dith;

    // scattering angle is between the LIGHT's travel direction and the path
    // from the scatter point to the eye (-rd), so the forward lobe fires when
    // you look INTO the beams (audience side) — with +dot the lobe was
    // backwards: standing on stage looking out along the beams was the
    // brightest view in the room instead of the dimmest
    float phase = hgPhase(-dot(rd, vDirW), g);
    vec3 acc = vec3(0.0);
    float trans = 1.0;
    float sigma = uHaze * dens;

    for (int i = 0; i < STEPS; i++) {
      vec3 p = ro + rd * t;
      vec3 ap = p - vApexW;
      float d = dot(ap, vDirW);
      // inside the throw, above the floor — the mirror cone and anything
      // past the target plane contribute nothing
      if (d > 0.02 && d < vLen && p.y > 0.02) {
        float R = k * d;
        float rr = length(ap - vDirW * d) / max(R, 1e-4);
        if (rr < 1.0) {
          // core carries the beam; the shoulder is barely-there fill, or
          // thirty overlapping cones melt into one wall of fog
          float radial = exp(-rr * rr * coreT) + 0.08 * (1.0 - rr * rr);
          // GOBO: a pattern cut into the core, read off the angle round the
          // axis and the radius. Only the core is patterned — the shoulder
          // stays soft so the cut reads as a real gate, not a stencil.
          if (vGobo > 0.5 && rr < 1.0) {
            vec3 bu = normalize(abs(vDirW.y) < 0.9 ? cross(vDirW, vec3(0.0, 1.0, 0.0)) : cross(vDirW, vec3(1.0, 0.0, 0.0)));
            vec3 bv = cross(vDirW, bu);
            vec3 perp = ap - vDirW * d;
            float ang = atan(dot(perp, bv), dot(perp, bu));
            float cut = 1.0;
            if (vGobo < 1.5) {          // breakup: soft leafy noise
              cut = smoothstep(0.35, 0.65, noise2(vec2(ang * 1.2, rr * 3.0) + vec2(0.0, uTime * 0.02)));
            } else if (vGobo < 2.5) {   // bars: 3 blades across the beam
              cut = step(0.0, sin(dot(perp, bu) / max(R, 1e-3) * 9.42));
            } else if (vGobo < 3.5) {   // dots: ring of 8 circles
              float a8 = mod(ang + 3.14159, 0.7854) - 0.3927;
              vec2 cell = vec2(a8 * 0.62, rr - 0.55);
              cut = 1.0 - smoothstep(0.16, 0.22, length(cell));
              cut = max(cut, 1.0 - smoothstep(0.14, 0.2, rr));   // and a centre dot
            } else {                    // star: 6 rays
              cut = smoothstep(0.55, 0.85, abs(sin(ang * 3.0)));
            }
            radial *= mix(0.06, 1.0, cut);
          }
          // flux conservation for a COLLIMATED source: the beam's energy
          // stays inside the cone, so per-volume brightness falls with the
          // cone's own spread, not a point source's 1/d² — much gentler
          float du = d / vLen;
          float invsq = 1.0 / (0.35 + 2.2 * du * du);
          float lightTrans = exp(-sigma * 1.6 * d);
          float n = noise2(p.xz * 0.05 + vec2(uTime * 0.010, uTime * 0.006))
                  * noise2(p.xy * 0.11 - vec2(uTime * 0.014, 0.0));
          float airDens = sigma * (0.35 + 1.55 * n);   // more contrast in the air itself
          float s = airDens * radial * invsq * lightTrans;
          acc += vCol * (s * phase * trans * dt);
          trans *= exp(-airDens * 0.55 * dt);
        }
      }
      t += dt;
    }

    // hot cores clip toward white the way a real discharge source does
    float lum = dot(acc, vec3(0.3333));
    acc = mix(acc, vec3(lum), clamp(lum * 0.22 - 0.05, 0.0, 0.55));
    // additive blending adds rgb*alpha — alpha is pinned at 1 so the pixel
    // contribution stays LINEAR in the integral. rgb*a with a derived from
    // the integral squares the energy and fifty overlapping cones white out.
    acc *= vI * 9.0;   // the lamp's own radiance — haze constants are per-metre
    // soft knee on the peak channel: linear where beams read as beams,
    // compressive where dozens of cones stack — the stack stays bright but
    // can no longer bury the seats and floor behind a wall of white
    float peak = max(acc.r, max(acc.g, acc.b));
    acc *= 1.0 / (1.0 + 0.16 * peak);
    if (dot(acc, vec3(1.0)) < 0.004) discard;
    gl_FragColor = vec4(acc, 1.0);
  }`;

// ---------------------------------------------------------------------------
// Laser ribbon. A world-space thin quad goes sub-pixel at distance and breaks
// into dashes under the half-res bloom mips ("pixel rain"). Fix: build the
// blade in VIEW space each frame — widen it with distance so its screen width
// is constant, and orient its width across the view so it never goes edge-on.
// ---------------------------------------------------------------------------
const laserVert = /* glsl */`
  attribute vec3 aColor;
  attribute float aIntensity;
  uniform float uPxToWorld;      // world units per pixel, per unit depth
  uniform float uWidthPx;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vI;
  void main() {
    vUv = uv;
    vCol = aColor;
    vI = aIntensity;
    // point on the beam axis: local y runs 0 (head) -> 1 (far end)
    vec4 axisPt = modelViewMatrix * instanceMatrix * vec4(0.0, position.y, 0.0, 1.0);
    vec3 axisDir = normalize((modelViewMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    // a sweeping blade can pass exactly through the camera; normalize(0) is
    // NaN, so guard the eye ray before it poisons the cross product
    vec3 rel = -axisPt.xyz;
    float rl = length(rel);
    vec3 toEye = rl > 1e-4 ? rel / rl : vec3(0.0, 0.0, 1.0);
    vec3 side = cross(axisDir, toEye);
    float sl = length(side);
    side = sl > 0.0001 ? side / sl : vec3(1.0, 0.0, 0.0);
    float halfW = 0.5 * uWidthPx * uPxToWorld * max(-axisPt.z, 0.1);
    gl_Position = projectionMatrix * vec4(axisPt.xyz + side * position.x * halfW * 2.0, 1.0);
  }`;

const laserFrag = /* glsl */`
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vI;
  void main() {
    // hot core across the ribbon, soft shoulders. The blades are pixel-thin
    // sliver triangles, and on slivers (or blades clipped at the camera
    // plane) the hardware can interpolate uv a hair outside [0,1] — which
    // would make the pow base negative -> NaN, and one NaN pixel smears to a
    // full black frame through bloom. Clamp everything, and make the discard
    // fail CLOSED for NaN (any comparison with NaN is false).
    float across = clamp(abs(vUv.x - 0.5) * 2.0, 0.0, 1.0);
    float core = pow(1.0 - across, 2.2);
    float along = clamp(1.0 - vUv.y * 0.35, 0.0, 1.0);   // fades with throw
    float a = core * along * vI;
    if (!(a >= 0.004 && a < 64.0)) discard;
    gl_FragColor = vec4(vCol * (0.85 + core * 0.9), a);
  }`;

export class RigFX {
  constructor(scene, rig, lights) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const host = this.group;
    this.rig = rig;
    this.t = 0;
    this.frame = 0;
    this.haze = 1.0;
    // ROOM haze: how much atmosphere the venue is running, on top of whatever
    // each look asks for. Looks (cues) write `haze`; this one is the house's,
    // survives every cue, and is the knob a designer reaches for when beams
    // read too thin or the room is soup.
    this.roomHaze = 1.0;
    this.master = 1.0;
    // a grand master over the master: the trigger's fade line (main.js), so a
    // look can fade to black without its own level being touched
    this.grand = 1.0;
    // per-fixture-group strength, driven by the console sliders
    this.gain = { spot: 1, wash: 1, beam: 1, laser: 1, strip: 1, strobe: 1, blinder: 1, uv: 1 };
    this.MAX_BEAMS = 160;          // allocated capacity — the slider clamps to this
    this.beamBudget = IS_STADIUM ? 88 : 48;   // max simultaneously drawn cones (a 600-head ring rig needs more to read)
    this.colorA = new THREE.Color(0xff2f6e);
    this.colorB = new THREE.Color(0x2f7bff);
    this.look = 'blackout';
    this.uv = false;
    this.lasersOn = false;
    this.strobeOn = false;
    this.blindersOn = false;
    this._blindFrames = 0;
    this._dummy = new THREE.Object3D();
    // in-the-round: a ring plan makes every behaviour radial (out = away from
    // the stage centre, per fixture) instead of the end-stage's +x
    this.radial = !!(rig.plan && rig.plan.ring);
    this.domeTop = rig.plan && Number.isFinite(rig.plan.domeTop) ? rig.plan.domeTop : 10;
    this.offsetX = 0;   // rig group translation (stage follows room config)
    this.offsetY = 0;   // rig group lift (the stadium's sphere stage flies the rig over the halo)
    this.scaleX = 1;    // rig group x-stretch for oversized decks
    this._v = new THREE.Vector3();

    // --- tracker lights ----------------------------------------------------
    // A fixed pool of REAL spotlights that ride the brightest fixtures each
    // frame, so a sweeping beam genuinely lights the seats, floor and
    // performers it lands on instead of only drawing haze. The pool never
    // grows or shrinks — adding a light at runtime would recompile every lit
    // material in the scene. Lights live inside the rig group, so the stage
    // x-shift carries them (and their targets) for free.
    // MEASURED, this scene, 1100x620: 12 lights = 12.0 ms/frame, 14 = 19.4,
    // 18 = 40.8. Real lights are superlinearly expensive here (huge lit surface
    // area x 20k+ instances), so the pool ALLOCATES 6 but only `trackerCount`
    // are visible — and an invisible light costs nothing. 2 is the default:
    // the two brightest fixtures genuinely light the room, everything else
    // reads through the volumetric cones and landing pools, which are cheap.
    // Changing the visible count recompiles every lit material, so this is a
    // settings-time control, never a per-frame one.
    this.TRACK_N = 6;
    this.trackerCount = 2;
    this.trackers = [];
    for (let i = 0; i < this.TRACK_N; i++) {
      const s = new THREE.SpotLight(0xffffff, 0, 0, 0.3, 0.45, 2);
      s.visible = i < this.trackerCount;
      host.add(s, s.target);
      this.trackers.push(s);
    }
    this._trackCand = [];

    // --- build the patch ----------------------------------------------------
    // One flat array of plain objects. Hundreds of these are trivial next to
    // the 26k-orb loop that already runs every frame.
    this.patch = [];
    // Fixtures aim at a TARGET POINT, not at euler angles. Everything else
    // falls out of that: the head quaternion, the yoke pan, and — critically —
    // the cone length, which is the distance to the target. That is what stops
    // beams punching through the deck and the floor, and it is also the single
    // biggest fill-rate saving available.
    // Fixture GROUPS, the unit a lighting designer actually thinks in: the
    // three trusses and the floor package. Derived from where each anchor
    // hangs, so a custom rig plan groups itself the same way.
    const LX = (rig.trusses || [{ x: -27.8 }, { x: -24.4 }, { x: -20.8 }]).map((t) => t.x);
    const groupOf = (a, up) => {
      if (up) return 'floor';
      let best = 0, bd = Infinity;
      LX.forEach((x, i) => { const dd = Math.abs(a.x - x); if (dd < bd) { bd = dd; best = i; } });
      return 'lx' + (best + 1);
    };
    this.GROUP_KEYS = ['lx1', 'lx2', 'lx3', 'floor'];
    // per-group overrides; null = follow the rig-wide setting
    this.fixGroups = {};
    for (const k of this.GROUP_KEYS) this.fixGroups[k] = { behaviour: null, color: null, level: 1, gobo: 0 };
    const add = (a, kind, maxLen, coneRad) => {
      const up = a.dir > 0;
      this.patch.push({
        kind, x: a.x, y: a.y, z: a.z, up, grp: (a.grp && this.GROUP_KEYS.includes(a.grp)) ? a.grp : groupOf(a, up),
        tx: a.x, ty: up ? 14 : 0, tz: a.z,   // parked: floor fixtures up, hung down
        hx: a.x + (up ? 26 : 0), hy: up ? 14 : 0, hz: a.z,
        dim: 0, r: 1, g: 1, b: 1, maxLen, coneRad,
      });
    };
    for (const a of rig.anchors.spot) add(a, 'spot', 46, 0.062);
    for (const a of rig.anchors.wash) add(a, 'wash', 40, 0.115);
    for (const a of rig.anchors.beam) add(a, 'beam', 62, 0.032);
    this.nMovers = this.patch.length;

    // --- moving heads: yoke pans, head tilts -------------------------------
    const yokeGeos = [], headGeos = [];
    {
      const arm = new THREE.BoxGeometry(0.06, 0.3, 0.05);
      const a1 = arm.clone(); a1.translate(-0.16, -0.15, 0); yokeGeos.push(a1);
      const a2 = arm.clone(); a2.translate(0.16, -0.15, 0); yokeGeos.push(a2);
      const base = new THREE.BoxGeometry(0.3, 0.12, 0.24);
      base.translate(0, 0.05, 0); yokeGeos.push(base);
      const body = new THREE.BoxGeometry(0.26, 0.34, 0.24);
      headGeos.push(body);
      const snout = new THREE.CylinderGeometry(0.09, 0.11, 0.14, 10);
      snout.rotateX(Math.PI / 2); snout.translate(0, -0.2, 0);
      headGeos.push(snout);
    }
    const metal = new THREE.MeshLambertMaterial({ color: 0x191c21 });
    this.yokes = new THREE.InstancedMesh(BufferGeometryUtils.mergeGeometries(yokeGeos), metal, this.nMovers);
    this.heads = new THREE.InstancedMesh(BufferGeometryUtils.mergeGeometries(headGeos), metal, this.nMovers);
    host.add(this.yokes, this.heads);

    // --- beam cones ---------------------------------------------------------
    const cone = new THREE.CylinderGeometry(0.02, 1, 1, 14, 1, true);
    cone.translate(0, -0.5, 0);                     // apex at origin, opens -Y
    this.beamGeo = cone;
    this.beamMat = new THREE.ShaderMaterial({
      vertexShader: beamVert, fragmentShader: beamFrag,
      uniforms: {
        uHaze: { value: 0.05 },
        uTime: { value: 0 },
        uNoise: { value: makeHazeNoise() },
      },
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    });
    this.beams = new THREE.InstancedMesh(this.beamGeo, this.beamMat, this.MAX_BEAMS);
    this.beams.frustumCulled = false;               // instances move in-shader terms
    this.beamCol = new Float32Array(this.MAX_BEAMS * 3);
    this.beamInt = new Float32Array(this.MAX_BEAMS);
    // the volumetric integrator's per-cone frame: lens, aim, throw, spread, optics
    this.beamApex = new Float32Array(this.MAX_BEAMS * 3);
    this.beamDir = new Float32Array(this.MAX_BEAMS * 3);
    this.beamLen = new Float32Array(this.MAX_BEAMS);
    this.beamRad = new Float32Array(this.MAX_BEAMS);
    this.beamKind = new Float32Array(this.MAX_BEAMS);
    this.beamGobo = new Float32Array(this.MAX_BEAMS);
    this.beamGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.beamCol, 3));
    this.beamGeo.setAttribute('aIntensity', new THREE.InstancedBufferAttribute(this.beamInt, 1));
    this.beamGeo.setAttribute('aApex', new THREE.InstancedBufferAttribute(this.beamApex, 3));
    this.beamGeo.setAttribute('aDir', new THREE.InstancedBufferAttribute(this.beamDir, 3));
    this.beamGeo.setAttribute('aLen', new THREE.InstancedBufferAttribute(this.beamLen, 1));
    this.beamGeo.setAttribute('aRad', new THREE.InstancedBufferAttribute(this.beamRad, 1));
    this.beamGeo.setAttribute('aKind', new THREE.InstancedBufferAttribute(this.beamKind, 1));
    this.beamGeo.setAttribute('aGobo', new THREE.InstancedBufferAttribute(this.beamGobo, 1));
    this.beams.count = 0;
    host.add(this.beams);

    // --- lens flares: additive billboards at each lit fixture --------------
    this.flareTex = makeLampGlow(0.1);
    this.flares = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.flareTex, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide,
      }),
      this.MAX_BEAMS
    );
    this.flares.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.MAX_BEAMS * 3), 3);
    this.flares.frustumCulled = false;
    this.flares.count = 0;
    host.add(this.flares);

    // --- beam ground pools ------------------------------------------------
    // A shaft with no pool where it lands reads as fog, not light. These are
    // flat additive ellipses at each beam's target point.
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    poolGeo.rotateX(-Math.PI / 2);
    this.pools = new THREE.InstancedMesh(
      poolGeo,
      new THREE.MeshBasicMaterial({
        map: makeLampGlow(0.06), transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide,
      }),
      this.MAX_BEAMS
    );
    this.pools.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.MAX_BEAMS * 3), 3);
    this.pools.frustumCulled = false;
    this.pools.count = 0;
    host.add(this.pools);

    // --- LED strips: 0.5 m pixel-mapped segments along every run ----------
    const segs = [];
    for (const run of rig.stripRuns) {
      const [x0, y0, z0] = run.from, [x1, y1, z1] = run.to;
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      const n = Math.max(1, Math.round(len / 0.5));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        segs.push({
          x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, z: z0 + (z1 - z0) * t,
          yaw: Math.atan2(x1 - x0, z1 - z0), vertical: Math.abs(y1 - y0) > len * 0.5,
          len: len / n,
        });
      }
    }
    this.stripSegs = segs;
    this.strips = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ transparent: false }),
      segs.length
    );
    const sd = this._dummy;
    segs.forEach((s, i) => {
      sd.position.set(s.x, s.y, s.z);
      sd.rotation.set(0, s.vertical ? 0 : s.yaw, s.vertical ? Math.PI / 2 : 0);
      sd.scale.set(0.05, 0.05, s.len * 0.94);
      sd.updateMatrix();
      this.strips.setMatrixAt(i, sd.matrix);
    });
    this.strips.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(segs.length * 3), 3);
    host.add(this.strips);

    // --- LED pipes: vertical tubes hung off LX1 ---------------------------
    const pipeSegs = [];
    for (const p of rig.pipes) {
      const n = 8;
      for (let i = 0; i < n; i++) {
        pipeSegs.push({ x: p.x, y: p.yTop - (i + 0.5) * (p.len / n), z: p.z, len: p.len / n });
      }
    }
    this.pipeSegs = pipeSegs;
    this.pipes = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.045, 0.045, 1, 6),
      new THREE.MeshBasicMaterial({}),
      pipeSegs.length
    );
    pipeSegs.forEach((p, i) => {
      sd.position.set(p.x, p.y, p.z);
      sd.rotation.set(0, 0, 0);
      sd.scale.set(1, p.len * 0.92, 1);
      sd.updateMatrix();
      this.pipes.setMatrixAt(i, sd.matrix);
    });
    this.pipes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(pipeSegs.length * 3), 3);
    host.add(this.pipes);

    // --- strobes + blinders: emissive cells, no real lights ---------------
    this.strobeCells = rig.anchors.strobe;
    this.strobes = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1.05, 0.3),
      new THREE.MeshBasicMaterial({
        map: makeStrobeBar(12), side: THREE.DoubleSide, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
      this.strobeCells.length
    );
    const faceOf = (a) => { const yaw = a.yaw ?? Math.PI / 2; return [Math.sin(yaw), Math.cos(yaw), yaw]; };   // [nx, nz, yaw]
    this.strobeCells.forEach((a, i) => {
      const [nx, nz, yaw] = faceOf(a);
      sd.position.set(a.x + nx * 0.1, a.y, a.z + nz * 0.1);
      sd.rotation.set(0, yaw, 0);
      sd.scale.set(1, 1, 1);
      sd.updateMatrix();
      this.strobes.setMatrixAt(i, sd.matrix);
    });
    this.strobes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.strobeCells.length * 3), 3);
    host.add(this.strobes);

    this.blinderCells = rig.anchors.blinder;
    this.blinders = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.78, 0.78),
      new THREE.MeshBasicMaterial({
        map: makeBlinderLamps(), side: THREE.DoubleSide, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
      this.blinderCells.length
    );
    this.blinderCells.forEach((a, i) => {
      const [nx, nz, yaw] = faceOf(a);
      sd.position.set(a.x + nx * 0.12, a.y, a.z + nz * 0.12);
      sd.rotation.set(a.dir > 0 ? 0 : 0.45, yaw, 0);
      sd.scale.set(1, 1, 1);
      sd.updateMatrix();
      this.blinders.setMatrixAt(i, sd.matrix);
    });
    this.blinders.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.blinderCells.length * 3), 3);
    host.add(this.blinders);

    // --- UV fixtures: deep-violet emissive cells + a global tint ----------
    this.uvCells = rig.anchors.uv;
    this.uvMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.62, 0.5),
      new THREE.MeshBasicMaterial({
        map: makeLampGlow(0.2), side: THREE.DoubleSide, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
      this.uvCells.length
    );
    this.uvCells.forEach((a, i) => {
      const [nx, nz] = faceOf(a);
      sd.position.set(a.x + nx * 0.1, a.y, a.z + nz * 0.1);
      sd.rotation.set(0, Math.PI / 2, 0);
      sd.scale.set(1, 1, 1);
      sd.updateMatrix();
      this.uvMesh.setMatrixAt(i, sd.matrix);
    });
    this.uvMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.uvCells.length * 3), 3);
    host.add(this.uvMesh);

    // --- lasers: thin additive fan blades --------------------------------
    this.laserAnchors = rig.anchors.laser;
    this.LASER_MAX = 12;          // allocated blades per head
    // live blade count (console slider). A 72-head ring rig at five blades is
    // 360 beams — a storm, not a show — so in the round it starts at two
    this.laserPer = (rig.plan && rig.plan.ring) ? 2 : 5;
    this.laserColorMode = 'rainbow';   // rainbow | a | ab
    this.laserSweep = 1.0;        // speed of whatever the pattern does
    this.laserRing = 3;           // 0=200-level 1=300 2=400 3=mixed
    // movement, from the console: how the fans move, how wide they open,
    // where they land (floor .. fascia .. sky) and a manual turn of every head
    this.laserPattern = 'sweep';  // sweep | fan | scan | circle | wave | chase | still | sky
    this.laserSpread = 1.5;       // radians across a head's fan
    this.laserTilt = 0;           // -1 down to the floor .. 0 on the fascia .. 1 high over the rim
    this.laserPan = 0;            // radians, turns every fan together
    const nLaser = this.laserAnchors.length * this.LASER_MAX;
    const blade = new THREE.PlaneGeometry(1, 1);
    blade.translate(0, 0.5, 0);                     // local y: 0 head -> 1 far end
    this.laserGeo = blade;
    this.laserMat = new THREE.ShaderMaterial({
      vertexShader: laserVert, fragmentShader: laserFrag,
      uniforms: {
        uPxToWorld: { value: 0.002 },   // set from camera fov + viewport height
        uWidthPx: { value: 2.4 },       // constant on-screen thickness
      },
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    });
    this.lasers = new THREE.InstancedMesh(this.laserGeo, this.laserMat, nLaser);
    this.laserCol = new Float32Array(nLaser * 3);
    this.laserInt = new Float32Array(nLaser);
    this.laserGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.laserCol, 3));
    this.laserGeo.setAttribute('aIntensity', new THREE.InstancedBufferAttribute(this.laserInt, 1));
    this.lasers.frustumCulled = false;
    this.lasers.count = 0;
    host.add(this.lasers);
    // Additive show layers must draw AFTER the court/mirror sandwich: the
    // court is a transparent mesh, three sorts transparents by distance to
    // the OBJECT's origin, and from a camera above the floor the court's
    // centre is nearer than the rig's — so the court painted over the lasers
    // and beams and they vanished when looking down. Explicit order wins.
    this.pools.renderOrder = 2;
    this.beams.renderOrder = 3;
    this.lasers.renderOrder = 4;
    this.flares.renderOrder = 5;

    // --- confetti: motion entirely in the vertex shader ------------------
    this.confetti = makeConfetti(rig.cannons, 24800);
    this.confetti.mesh.frustumCulled = false;
    host.add(this.confetti.mesh);

    // --- the fixed real-light patch --------------------------------------
    // Reuse the lights main.js already created; never allocate more.
    this.lights = lights;   // { showLights: [4], stageSpots: [2], hemi }
    this.groups = ['spot', 'wash', 'beam'];
    this.behaviour = 'park';
    this.cue('blackout');
  }

  // -------------------------------------------------------------------------
  set(opts) { Object.assign(this, opts); }

  cue(name) {
    this.look = name;
    const P = this.patch;
    const setAll = (kind, o) => { for (const f of P) if (f.kind === kind) Object.assign(f, o); };
    const all = (d) => { for (const f of P) f.dim = d; };
    // every cue starts from these defaults and then overrides what it needs
    this.uv = false; this.lasersOn = false; this.strobeOn = false; this.blindersOn = false;
    switch (name) {
      case 'blackout':
        all(0); this.behaviour = 'park'; this.stripMode = 'off'; break;
      case 'preshow':                    // UV ritual, rig effectively out
        all(0); setAll('wash', { dim: 0.07 });
        this.behaviour = 'park'; this.uv = true; this.stripMode = 'breathe'; break;
      case 'intro':                      // slow build: beams only, no wash
        all(0); setAll('beam', { dim: 0.55 });
        this.behaviour = 'slowfan'; this.stripMode = 'breathe'; break;
      case 'ballad':
        setAll('spot', { dim: 0.5 }); setAll('wash', { dim: 0.65 }); setAll('beam', { dim: 0 });
        this.behaviour = 'slowfan'; this.stripMode = 'breathe'; break;
      case 'acoustic':                   // tight and warm, nothing moving
        setAll('spot', { dim: 0.75 }); setAll('wash', { dim: 0.2 }); setAll('beam', { dim: 0 });
        this.behaviour = 'park'; this.stripMode = 'off'; break;
      case 'anthem':                     // wide warm wash on a slow sweep
        setAll('spot', { dim: 0.8 }); setAll('wash', { dim: 0.95 }); setAll('beam', { dim: 0.35 });
        this.behaviour = 'sweep'; this.stripMode = 'breathe'; break;
      case 'ballyhoo':
        setAll('spot', { dim: 0.85 }); setAll('wash', { dim: 0.5 }); setAll('beam', { dim: 1 });
        this.behaviour = 'ballyhoo'; this.lasersOn = true; this.stripMode = 'chase'; break;
      case 'beamfan':
        setAll('spot', { dim: 0.2 }); setAll('wash', { dim: 0.25 }); setAll('beam', { dim: 1 });
        this.behaviour = 'fan'; this.lasersOn = true; this.stripMode = 'chase'; break;
      case 'crossfire':                  // beams crossing hard over the floor
        setAll('spot', { dim: 0.15 }); setAll('wash', { dim: 0.1 }); setAll('beam', { dim: 1 });
        this.behaviour = 'crossbeams'; this.lasersOn = true; this.stripMode = 'strobe'; break;
      case 'tilt':                       // rippling tilt wave along the truss
        setAll('spot', { dim: 0.5 }); setAll('wash', { dim: 0.3 }); setAll('beam', { dim: 0.9 });
        this.behaviour = 'tiltwave'; this.stripMode = 'chase'; break;
      case 'strobefit':                  // strobes and blinders, movers parked
        all(0.2); this.behaviour = 'park';
        this.strobeOn = true; this.blindersOn = true; this.stripMode = 'strobe'; break;
      case 'lasershow':                  // lasers carry it, rig pulled right back
        all(0); setAll('wash', { dim: 0.12 });
        this.behaviour = 'park'; this.lasersOn = true; this.stripMode = 'off'; break;
      case 'rainbow':
        all(0.9); this.behaviour = 'sweep'; this.lasersOn = true; this.stripMode = 'rainbow'; break;
      case 'drop':                       // the moment: everything, hard
      case 'hit':
        all(1); this.behaviour = 'crossbeams'; this.lasersOn = true;
        this.strobeOn = true; this.blindersOn = true; this.stripMode = 'strobe'; break;
      case 'encore':                     // warm and wide, blinders up
        all(0.95); this.behaviour = 'ballyhoo'; this.lasersOn = true;
        this.blindersOn = true; this.stripMode = 'rainbow'; break;
      case 'full':
        all(1); this.behaviour = 'sweep'; this.lasersOn = true;
        this.blindersOn = true; this.stripMode = 'rainbow'; break;
    }
  }

  fireConfetti() { this.confetti.fire(this.t); }

  // Group control. `id` is one of GROUP_KEYS or 'all'. Pass null for
  // behaviour/color to hand that property back to the rig-wide setting.
  setGroup(id, opts) {
    const ids = id === 'all' ? this.GROUP_KEYS : [id];
    for (const k of ids) {
      const g = this.fixGroups[k];
      if (!g) continue;
      if ('behaviour' in opts) g.behaviour = opts.behaviour || null;
      if ('color' in opts) g.color = opts.color ? (opts.color.isColor ? opts.color.clone() : new THREE.Color(opts.color)) : null;
      if ('level' in opts) g.level = Math.max(0, Math.min(2, +opts.level));
      if ('gobo' in opts) g.gobo = Math.max(0, Math.min(4, opts.gobo | 0));
    }
  }
  getGroup(id) { return this.fixGroups[id === 'all' ? 'lx1' : id]; }

  // -------------------------------------------------------------------------
  // In-the-round targets. Each fixture has its own "out" (away from the stage
  // centre) and "along" (tangent) axes; the end-stage formulas are recast into
  // that frame so every look — sweep, fan, ballyhoo, cross — happens all the
  // way round the ring instead of on one side of a room.
  _radialTarget(f, beh, t, i, n, ph, side) {
    const r = Math.hypot(f.x, f.z) || 1;
    const ux = f.x / r, uz = f.z / r, vx = -uz, vz = ux;
    let out = 40, lat = 0, y = 0;
    if (f.up) {
      // deck-edge package and the inner ring's uplights: rake up and out over
      // the crowd in a slow fan; parked = a straight crown of beams
      if (beh === 'park') { out = 10; lat = 0; y = f.y + 34; }
      else { out = 14 + Math.sin(t * 0.3 + ph) * 6; lat = Math.sin(t * 0.5 + ph) * 12; y = f.y + 26 + Math.sin(t * 0.7 + ph) * 7; }
    } else if (f.grp === 'lx2') {
      // inner ring: down onto the globe, wandering over its surface
      const k = beh === 'park' ? 0 : 1;
      out = -r * 0.6 + k * Math.sin(t * 0.6 + ph) * 4; lat = k * Math.cos(t * 0.45 + ph) * 4; y = this.domeTop - 1;
      if (beh === 'ballyhoo') { out = -r + Math.cos(t * 1.2 * side + ph) * 7; lat = Math.sin(t * 1.2 * side + ph) * 7; }
      if (beh === 'fan') { out = -r * 0.35; lat = ((i % 8) / 7 - 0.5) * 14; }
    } else {
      switch (beh) {
        case 'park': out = 44; lat = 0; y = 0; break;
        case 'sweep': out = 34 + Math.sin(t * 0.5 + ph * 0.5) * 12; lat = Math.sin(t * 0.35 + ph) * 24; y = 0; break;
        case 'fan': out = 38; lat = ((i % 8) / 7 - 0.5) * 44; y = 0; break;
        case 'slowfan': out = 32 + Math.sin(t * 0.2) * 5; lat = ((i % 8) / 7 - 0.5) * 36 + Math.sin(t * 0.25) * 4; y = 0; break;
        case 'ballyhoo': out = 38 + Math.cos(t * 1.3 * side + ph) * 12; lat = Math.sin(t * 1.3 * side + ph) * 22; y = 0; break;
        case 'crossbeams': out = 36; lat = -side * (16 + Math.sin(t * 1.1) * 10); y = 0; break;
        case 'tiltwave': out = 20 + (0.5 + 0.5 * Math.sin(t * 1.6 - (i / n) * 6.2)) * 40; lat = 0; y = 0; break;
        default: out = 44; lat = 0; y = 0;
      }
    }
    f.tx = f.x + ux * out + vx * lat;
    f.ty = y;
    f.tz = f.z + uz * out + vz * lat;
  }

  update(dt, camera) {
    this.t += dt * (this.rate ?? 1);   // rate: how fast the rig moves (1: as designed)
    this.frame++;
    const t = this.t;
    const P = this.patch;
    const n = P.length;

    // --- behaviours: write a target point per fixture, no allocation ------
    // Hung fixtures sweep the deck and the front floor; the upstage floor
    // package rakes out and up over the crowd.
    for (let i = 0; i < n; i++) {
      const f = P[i];
      const beh = this.fixGroups[f.grp].behaviour || this.behaviour;
      const ph = (i / n) * Math.PI * 2;
      const side = i % 2 ? 1 : -1;
      const spanZ = 15;
      if (this.radial) { this._radialTarget(f, beh, t, i, n, ph, side); continue; }
      if (f.up) {
        // upstage floor package: rake out and up over the crowd
        const a = ((i / n) - 0.5) * 1.1 + (beh === 'park' ? 0 : Math.sin(t * 0.5 + ph) * 0.4);
        f.tx = 26; f.ty = 13 + Math.sin(t * 0.7 + ph) * 5; f.tz = Math.sin(a) * 26;
        if (beh === 'park') { f.tx = 30; f.ty = 12; f.tz = f.z * 1.6; }
        continue;
      }
      // Hung fixtures all throw OUTWARD, away from the stage, and land out on
      // the floor among the crowd. Targets are on the +x side so the whole rig
      // reads as designed to shoot out into the room.
      switch (beh) {
        case 'park':                       // parallel, straight out — clean look
          f.tx = f.x + 40; f.ty = 0; f.tz = f.z * 1.25;
          break;
        case 'sweep':
          f.tx = 8 + Math.sin(t * 0.5 + ph * 0.5) * 12;
          f.ty = 0; f.tz = Math.sin(t * 0.35 + ph) * 22;
          break;
        case 'fan':                        // wide static fan out over the floor
          f.tx = 12; f.ty = 0; f.tz = ((i / n) - 0.5) * 54;
          break;
        case 'slowfan':
          f.tx = 6 + Math.sin(t * 0.2) * 5; f.ty = 0;
          f.tz = ((i / n) - 0.5) * 44 + Math.sin(t * 0.25) * 4;
          break;
        case 'ballyhoo':                   // circles out in the room
          f.tx = 12 + Math.cos(t * 1.3 * side + ph) * 12;
          f.ty = 0; f.tz = Math.sin(t * 1.3 * side + ph) * 20;
          break;
        case 'crossbeams':
          f.tx = 10; f.ty = 0;
          f.tz = -side * (14 + Math.sin(t * 1.1) * 9);
          break;
        case 'tiltwave':                   // throw distance ripples along the truss
          f.tx = -2 + (0.5 + 0.5 * Math.sin(t * 1.6 - (i / n) * 6.2)) * 34;
          f.ty = 0; f.tz = f.z * 1.3;
          break;
      }
    }

    // --- colour per group -------------------------------------------------
    const A = this.colorA, B = this.colorB;
    for (let i = 0; i < n; i++) {
      const f = P[i];
      const gc = this.fixGroups[f.grp].color;
      if (gc) {
        f.r = gc.r; f.g = gc.g; f.b = gc.b;       // the group owns its colour
      } else if (this.look === 'full' || this.stripMode === 'rainbow') {
        const h = (i / n) + t * 0.12;
        f.r = hueR(h); f.g = hueG(h); f.b = hueB(h);
      } else if (f.kind === 'beam') {
        f.r = A.r; f.g = A.g; f.b = A.b;
      } else if (f.kind === 'wash') {
        f.r = B.r; f.g = B.g; f.b = B.b;
      } else {
        f.r = 1; f.g = 0.96; f.b = 0.9;
      }
    }

    // --- aim, then write heads, yokes, cones and flares -------------------
    const d = this._dummy;
    const v = this._v;
    const DOWN = this._down || (this._down = new THREE.Vector3(0, -1, 0));
    const q = this._q || (this._q = new THREE.Quaternion());
    const master = this.master * this.grand;
    let bc = 0;
    const budget = Math.min(this.beamBudget, this.MAX_BEAMS);

    for (let i = 0; i < n; i++) {
      const f = P[i];
      v.set(f.tx - f.x, f.ty - f.y, f.tz - f.z);
      let throwLen = v.length();
      if (throwLen < 0.001) { v.set(0, -1, 0); throwLen = 1; } else v.multiplyScalar(1 / throwLen);
      throwLen = Math.min(throwLen, f.maxLen);
      q.setFromUnitVectors(DOWN, v);          // cone/head axis is local -Y

      // yoke pans about Y only
      d.position.set(f.x, f.y, f.z);
      d.rotation.set(0, Math.atan2(v.x, v.z), 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      this.yokes.setMatrixAt(i, d.matrix);
      // head hangs under the yoke and points along the aim
      d.position.set(f.x + v.x * 0.3, f.y + v.y * 0.3 - 0.02, f.z + v.z * 0.3);
      d.quaternion.copy(q);
      d.updateMatrix();
      this.heads.setMatrixAt(i, d.matrix);
      f._q = f._q || new THREE.Quaternion();
      f._q.copy(q);
      f._throw = throwLen;
      f._vx = v.x; f._vy = v.y; f._vz = v.z;
    }
    this.yokes.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;

    // beams: brightest first, budgeted. Two coarse passes beat a full sort.
    // When more heads qualify than the budget holds, take them at an even
    // stride through the patch instead of the first N: a ring rig's patch runs
    // round the circle, and "the first 48" would light one side of the room.
    const cand = this._trackCand;
    cand.length = 0;
    const pick = this._beamPick || (this._beamPick = []);
    pick.length = 0;
    for (let pass = 0; pass < 2 && pick.length < budget; pass++) {
      const lo = pass === 0 ? 0.5 : 0.02;
      const hi = pass === 0 ? Infinity : 0.5;   // overdrive stays in the bright bucket
      let elig = 0;
      for (let i = 0; i < n; i++) {
        const f = P[i];
        f._dimNow = f.dim * master * this.gain[f.kind] * this.fixGroups[f.grp].level;
        if (f._dimNow >= lo && f._dimNow < hi) elig++;
      }
      if (!elig) continue;
      const stride = Math.max(1, elig / (budget - pick.length));
      let j = 0, next = 0;
      for (let i = 0; i < n && pick.length < budget; i++) {
        const f = P[i];
        if (f._dimNow < lo || f._dimNow >= hi) continue;
        if (j >= next) { pick.push(f); next += stride; }
        j++;
      }
    }
    for (const f of pick) {
      {
        const dim = f._dimNow;
        const L = f._throw;
        d.position.set(f.x + f._vx * 0.42, f.y + f._vy * 0.42, f.z + f._vz * 0.42);
        d.quaternion.copy(f._q);
        d.scale.set(f.coneRad * L, L, f.coneRad * L);
        d.updateMatrix();
        this.beams.setMatrixAt(bc, d.matrix);
        this.beamCol[bc * 3] = f.r; this.beamCol[bc * 3 + 1] = f.g; this.beamCol[bc * 3 + 2] = f.b;
        this.beamInt[bc] = Math.min(dim, 1.6);   // gain 2 x master 1.4 stays sane
        // the volumetric integrator's frame for this cone
        this.beamApex[bc * 3] = f.x + f._vx * 0.42;
        this.beamApex[bc * 3 + 1] = f.y + f._vy * 0.42;
        this.beamApex[bc * 3 + 2] = f.z + f._vz * 0.42;
        this.beamDir[bc * 3] = f._vx; this.beamDir[bc * 3 + 1] = f._vy; this.beamDir[bc * 3 + 2] = f._vz;
        this.beamLen[bc] = L;
        this.beamRad[bc] = f.coneRad * L;
        this.beamKind[bc] = f.kind === 'wash' ? 1 : (f.kind === 'beam' ? 2 : 0);
        this.beamGobo[bc] = this.fixGroups[f.grp].gobo;
        // flare billboard at the lens. Real lamps GLARE: from the side the
        // lens is a dot, but stand in the beam and it flares wide open —
        // the glare term is the cosine to the beam axis raised hard.
        const lensX = f.x + f._vx * 0.44, lensY = f.y + f._vy * 0.44, lensZ = f.z + f._vz * 0.44;
        let gx = camera.position.x - lensX, gy = camera.position.y - lensY, gz = camera.position.z - lensZ;
        const gl2 = Math.hypot(gx, gy, gz) || 1;
        const glare = Math.max(0, (gx * f._vx + gy * f._vy + gz * f._vz) / gl2);
        const g4 = glare * glare * glare * glare;
        // proximity fade: standing on the deck among the fixtures, full-size
        // flares fill the frame and bloom whites out the view — a real lens
        // this close is past the glare's falloff anyway
        const prox = Math.min(1, Math.max(0.15, (gl2 - 2.0) / 6));
        d.position.set(lensX, lensY, lensZ);
        d.quaternion.copy(camera.quaternion);
        const fs = (0.12 + dim * (f.kind === 'beam' ? 0.26 : 0.17)) * (1.0 + 3.2 * g4) * (0.4 + 0.6 * prox);
        d.scale.set(fs, fs, fs);
        d.updateMatrix();
        this.flares.setMatrixAt(bc, d.matrix);
        const fi = (1.32 + dim * 0.9) * (0.75 + 1.5 * g4) * prox;
        this.flares.instanceColor.array[bc * 3] = f.r * fi;
        this.flares.instanceColor.array[bc * 3 + 1] = f.g * fi;
        this.flares.instanceColor.array[bc * 3 + 2] = f.b * fi;
        // ground pool where the beam lands — this is what makes it read as
        // light hitting a surface rather than haze hanging in the air
        // pool at where the beam actually ENDS (throw is clipped to maxLen,
        // which may fall short of the target) and only if that is near a
        // surface — a pool floating in mid-air reads as a bug.
        const ex = f.x + f._vx * L, ey = f.y + f._vy * L, ez = f.z + f._vz * L;
        const onSurface = ey < 2.7;
        const pr = onSurface ? Math.max(0.8, f.coneRad * L * 3.2) : 0;
        d.position.set(ex, (ey < 2.2 ? 0.05 : 2.06), ez);
        // a raked beam lands as an ELLIPSE stretched along its heading —
        // circle radius / sin(elevation), capped so grazing hits stay sane
        const stretch = Math.min(3.2, 1 / Math.max(0.31, Math.abs(f._vy)));
        d.quaternion.identity();
        d.rotation.set(0, Math.atan2(f._vx, f._vz), 0);
        d.scale.set(pr, 1, pr * stretch);
        d.updateMatrix();
        this.pools.setMatrixAt(bc, d.matrix);
        const pi = onSurface ? 0.12 + dim * 0.34 : 0;   // pools accent the landing, they are not the light show
        this.pools.instanceColor.array[bc * 3] = f.r * pi;
        this.pools.instanceColor.array[bc * 3 + 1] = f.g * pi;
        this.pools.instanceColor.array[bc * 3 + 2] = f.b * pi;
        f._dim = dim;
        cand.push(f);
        bc++;
      }
    }
    this.beams.count = bc;
    this.flares.count = bc;
    this.pools.count = bc;
    if (bc) {
      this.pools.instanceMatrix.needsUpdate = true;
      this.pools.instanceColor.needsUpdate = true;
      this.beams.instanceMatrix.needsUpdate = true;
      this.beamGeo.getAttribute('aColor').needsUpdate = true;
      this.beamGeo.getAttribute('aIntensity').needsUpdate = true;
      this.beamGeo.getAttribute('aApex').needsUpdate = true;
      this.beamGeo.getAttribute('aDir').needsUpdate = true;
      this.beamGeo.getAttribute('aLen').needsUpdate = true;
      this.beamGeo.getAttribute('aRad').needsUpdate = true;
      this.beamGeo.getAttribute('aKind').needsUpdate = true;
      this.beamGeo.getAttribute('aGobo').needsUpdate = true;
      this.flares.instanceMatrix.needsUpdate = true;
      this.flares.instanceColor.needsUpdate = true;
    }
    // the integrator's sigma: tuned so haze=1 lands near the old look's energy
    this.beamMat.uniforms.uHaze.value = 0.11 * this.haze * this.roomHaze;
    this.beamMat.uniforms.uTime.value = t;

    // --- LED strips + pipes ---------------------------------------------
    this._writeStrips(t);

    // --- strobes: FRAME-quantised, never sin(t) -------------------------
    const sArr = this.strobes.instanceColor.array;
    const flashOn = this.strobeOn && this.frame % 7 < 3;   // 3 on / 4 off reads as a real strobe
    const sv = flashOn ? 4.2 * this.gain.strobe * this.master * this.grand : 0;
    for (let i = 0; i < sArr.length; i++) sArr[i] = sv;
    this.strobes.instanceColor.needsUpdate = true;

    // --- blinders: parked warm, spiked on a hit -------------------------
    if (this.blindersOn) this._blindFrames = 3;
    const bArr = this.blinders.instanceColor.array;
    const bv = (this._blindFrames > 0 ? 3.2 : (this.look === 'blackout' ? 0 : 0.28)) * this.gain.blinder;
    if (this._blindFrames > 0) this._blindFrames--;
    for (let i = 0; i < bArr.length; i += 3) {
      bArr[i] = bv; bArr[i + 1] = bv * 0.82; bArr[i + 2] = bv * 0.55;
    }
    this.blinders.instanceColor.needsUpdate = true;

    // --- UV -------------------------------------------------------------
    const uArr = this.uvMesh.instanceColor.array;
    const uv = this.uv ? 3.6 * this.gain.uv : 0;   // strobe-grade: decisively over the bloom gate
    for (let i = 0; i < uArr.length; i += 3) {
      uArr[i] = uv * 0.5; uArr[i + 1] = uv * 0.12; uArr[i + 2] = uv;
    }
    this.uvMesh.instanceColor.needsUpdate = true;

    // --- lasers ---------------------------------------------------------
    this._writeLasers(t);

    // --- confetti -------------------------------------------------------
    this.confetti.update(t);

    // --- drive the fixed real-light patch -------------------------------
    this._writeTrackers();
    this._writeLights();
  }

  // Assign the tracker pool to the brightest drawn fixtures. Brightest-first
  // with a 4 m spatial spread, so eight adjacent truss spots on one look
  // don't hog every light while the other side of the room stays fake.
  // Only the visible slice is driven — the rest are invisible and free.
  setTrackerCount(n) {
    this.trackerCount = Math.max(0, Math.min(this.TRACK_N, n | 0));
    this.trackers.forEach((s, i) => {
      s.visible = i < this.trackerCount;
      if (!s.visible) s.intensity = 0;
    });
  }

  _writeTrackers() {
    const T = this.trackers.slice(0, this.trackerCount);
    if (!T.length) return;
    if (this.uv) {
      // UV mode: forget the fixtures — park the pool as violet floods.
      // ORDERED BY COVERAGE, because only `trackerCount` of these exist: the
      // first two are near-hemispherical washes from high centre covering the
      // stage half and the FOH half (floor AND lower bowl, which is what the
      // violet has to reach). Anything past that just adds definition.
      const P = this._uvPark || (this._uvPark = [
        { p: [4, 26, 0], t: [-40, 6, 0], a: 1.34, i: 3400 },
        { p: [4, 26, 0], t: [46, 6, 0], a: 1.34, i: 3400 },
        { p: [12, 26, 0], t: [8, 10, 34], a: 1.1, i: 2600 },
        { p: [12, 26, 0], t: [8, 10, -34], a: 1.1, i: 2600 },
        { p: [-8, 23, 0], t: [-12, 0, 0], a: 1.05, i: 1300 },
        { p: [16, 23, 0], t: [22, 0, 0], a: 1.05, i: 1300 },
      ]);
      const uvG = this.gain.uv * this.master * this.grand;
      for (let i = 0; i < T.length; i++) {
        const s = T[i], f = P[i % P.length];
        s.intensity = f.i * uvG;
        s.color.setRGB(0.28, 0.1, 1.0);
        s.angle = f.a;
        s.penumbra = 0.85;
        s.position.set(f.p[0], f.p[1], f.p[2]);
        s.target.position.set(f.t[0], f.t[1], f.t[2]);
      }
      return;
    }
    const cand = this._trackCand;
    cand.sort((a, b) => b._dim - a._dim);
    const picked = this._trackPick || (this._trackPick = []);
    picked.length = 0;
    for (const f of cand) {
      if (picked.length >= T.length) break;
      let ok = true;
      for (const p of picked) {
        const dx = f.x - p.x, dz = f.z - p.z;
        if (dx * dx + dz * dz < 16) { ok = false; break; }
      }
      if (ok) picked.push(f);
    }
    for (const f of cand) {   // spread satisfied or not, never waste a light
      if (picked.length >= T.length) break;
      if (!picked.includes(f)) picked.push(f);
    }
    for (let i = 0; i < T.length; i++) {
      const s = T[i], f = picked[i];
      if (!f) { s.intensity = 0; continue; }
      // candela per fixture family — beams punch, washes bathe. Intensity is
      // throw-compensated (E·d², capped): a point-blank fixture would
      // otherwise nuke the deck with hundreds of lux while a 25 m throw
      // barely reads — this keeps every landing pool near the same exposure,
      // and the caps sit under the bloom gate so lit chairs stay chairs
      // instead of smearing into white.
      const kindE = f.kind === 'beam' ? 3.6 : (f.kind === 'wash' ? 1.7 : 2.6);
      const kindMax = f.kind === 'beam' ? 2200 : (f.kind === 'wash' ? 950 : 1500);
      s.intensity = Math.min(kindMax, kindE * f._throw * f._throw) * f._dim;
      s.color.setRGB(f.r, f.g, f.b);
      // wider than the visible cone: the pool's soft skirt is what climbs up
      // chairs and bodies instead of clipping at their ankles
      s.angle = Math.max(0.14, Math.min(1.2, Math.atan(f.coneRad) * (f.kind === 'wash' ? 1.7 : 1.45) + 0.03));
      s.penumbra = f.kind === 'wash' ? 0.7 : 0.5;
      s.position.set(f.x, f.y, f.z);
      s.target.position.set(
        f.x + f._vx * f._throw, f.y + f._vy * f._throw + 0.5, f.z + f._vz * f._throw);
    }
  }

  _writeStrips(t) {
    const arr = this.strips.instanceColor.array;
    const segs = this.stripSegs;
    const mode = this.stripMode || 'off';
    const A = this.colorA, B = this.colorB;
    const m = this.master * this.grand * this.gain.strip;
    for (let i = 0; i < segs.length; i++) {
      let r = 0, g = 0, b = 0;
      if (mode === 'chase') {
        const k = Math.pow(Math.max(0, Math.sin((i / segs.length) * 24 - t * 5)), 8);
        r = A.r * k * 2.6; g = A.g * k * 2.6; b = A.b * k * 2.6;
      } else if (mode === 'rainbow') {
        const h = i / segs.length * 2 + t * 0.25;
        r = hueR(h) * 2.2; g = hueG(h) * 2.2; b = hueB(h) * 2.2;
      } else if (mode === 'breathe') {
        const k = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.1));
        r = B.r * k * 1.8; g = B.g * k * 1.8; b = B.b * k * 1.8;
      } else if (mode === 'strobe') {
        const on = this.frame % 6 < 2 ? 1 : 0;
        r = 2.8 * on; g = 2.8 * on; b = 3.0 * on;
      }
      const j = i * 3;
      arr[j] = r * m; arr[j + 1] = g * m; arr[j + 2] = b * m;
    }
    this.strips.instanceColor.needsUpdate = true;

    // pipes echo the strips but as vertical bars, offset in phase
    const parr = this.pipes.instanceColor.array;
    const ps = this.pipeSegs;
    for (let i = 0; i < ps.length; i++) {
      let k = 0;
      if (mode === 'chase') k = Math.pow(Math.max(0, Math.sin(i * 0.35 - t * 4)), 6);
      else if (mode === 'rainbow') k = 1;
      else if (mode === 'breathe') k = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.9 + i * 0.2));
      else if (mode === 'strobe') k = this.frame % 6 < 2 ? 1 : 0;
      const h = i / ps.length + t * 0.2;
      const j = i * 3;
      if (mode === 'rainbow') {
        parr[j] = hueR(h) * 2.2 * m; parr[j + 1] = hueG(h) * 2.2 * m; parr[j + 2] = hueB(h) * 2.2 * m;
      } else {
        parr[j] = this.colorA.r * k * 2.4 * m;
        parr[j + 1] = this.colorA.g * k * 2.4 * m;
        parr[j + 2] = this.colorA.b * k * 2.4 * m;
      }
    }
    this.pipes.instanceColor.needsUpdate = true;
  }

  _writeLasers(t) {
    if (!this.lasersOn || this.gain.laser <= 0.001) { this.lasers.count = 0; return; }
    const d = this._dummy;
    const UP = this._up || (this._up = new THREE.Vector3(0, 1, 0));
    const q = this._lq || (this._lq = new THREE.Quaternion());
    const v = this._lv || (this._lv = new THREE.Vector3());
    const g = this.gain.laser * this.master * this.grand;
    // Real arena lasers are aimed at the fascia so the beam visibly lands on
    // the ring rather than dying in mid-air. RING[] are the bowl's LED fascia
    // bands: [outward offset from the bowl path, height].
    // this room's fascia lines (bowl.js), so a stadium laser reaches its
    // stands; the arena keeps the literal rings it was tuned on
    const RING = this._ring || (this._ring = IS_STADIUM
      ? laserRings().map((rg) => ({ a: BOWL_A + rg.off, b: BOWL_B + rg.off, y: rg.y }))
      : [
        { a: 33.08 + 19.5, b: 15.555 + 19.5, y: 10.65 },   // 200-level fascia
        { a: 33.08 + 26.8, b: 15.555 + 26.8, y: 16.50 },   // 300-level fascia
        { a: 33.08 + 34.24, b: 15.555 + 34.24, y: 21.44 }, // 400-level fascia
      ]);
    const pat = this.laserPattern || 'sweep';
    const spd = this.laserSweep;
    const spreadW = Math.max(0.05, this.laserSpread ?? 1.5);
    const tilt = this.laserTilt ?? 0, pan = this.laserPan ?? 0;
    const sky = pat === 'sky';
    let c = 0;
    for (let a = 0; a < this.laserAnchors.length; a++) {
      const an = this.laserAnchors[a];
      const ring = RING[this.laserRing >= 3 ? a % RING.length : this.laserRing];
      const per = Math.max(1, Math.min(this.LASER_MAX, Math.round(this.laserPer)));
      // the centre and width of this head's fan, per pattern. phi 0 = +x, the
      // end-stage habit; a ring rig's heads each face their slice of the room
      let centre = (an.phi || 0) + pan, width = spreadW, lit = -1;
      switch (pat) {
        case 'fan': width = spreadW * (0.72 + 0.28 * Math.sin(t * 0.3 * spd + a * 0.4)); break;        // fans breathe open and shut
        case 'scan': centre += Math.sin(t * 0.9 * spd + a * 0.35) * (0.5 + spreadW * 0.35); width = 0.06; break;   // one bunched line scanning
        case 'circle': centre += t * 0.35 * spd * (a % 2 ? 1 : -1); break;                              // whole fans orbit, alternating heads
        case 'chase': lit = Math.floor(t * 3 * spd + a) % per; width = spreadW; break;                   // one blade runs along the fan
        case 'still': break;
        case 'wave': break;                                                                              // per blade, below
        case 'sky': centre += Math.sin(t * 0.25 * spd + a * 1.1) * 0.35; break;
        default: centre += Math.sin(t * 0.45 * spd + a * 1.7) * 0.5;                                    // sweep
      }
      for (let k = 0; k < per; k++) {
        let th = centre + (per === 1 ? 0 : (k / (per - 1)) - 0.5) * width;
        if (pat === 'wave') th += Math.sin(t * 1.6 * spd + k * 0.7 + a * 0.9) * 0.35;
        // where the blade lands: on the fascia ring, lifted or dropped by tilt;
        // sky mode throws 150 m up so the beams stand over the open bowl
        let ty = ring.y + (tilt > 0 ? tilt * 70 : tilt * 14), ra = ring.a, rb = ring.b;
        if (sky) { ty = ring.y + 150 + 40 * Math.sin(t * 0.2 * spd + k * 0.8); ra *= 0.9; rb *= 0.9; }
        const tx = Math.cos(th) * ra;
        const tz = Math.sin(th) * rb;
        v.set((tx - this.offsetX) / this.scaleX - an.x, ty - this.offsetY - an.y, tz - an.z);
        const len = v.length();
        v.multiplyScalar(1 / len);
        q.setFromUnitVectors(UP, v);
        d.position.set(an.x, an.y, an.z);
        d.quaternion.copy(q);
        d.scale.set(1, len, 1);            // terminates exactly at the ring
        d.updateMatrix();
        this.lasers.setMatrixAt(c, d.matrix);
        const flick = 0.85 + 0.15 * Math.sin(t * 31 + k * 3.1);
        let cr, cg, cb;
        if (this.laserColorMode === 'a') {
          cr = this.colorA.r; cg = this.colorA.g; cb = this.colorA.b;
        } else if (this.laserColorMode === 'ab') {
          const useB = (a + k) % 2 === 1;
          const c2 = useB ? this.colorB : this.colorA;
          cr = c2.r; cg = c2.g; cb = c2.b;
        } else {
          const h = (a * 0.19 + t * 0.04) % 1;
          cr = hueR(h); cg = hueG(h); cb = hueB(h);
        }
        this.laserCol[c * 3] = cr;
        this.laserCol[c * 3 + 1] = cg;
        this.laserCol[c * 3 + 2] = cb;
        // a laser is only a beam because of what hangs in the air: a dry room
        // thins it, a hazy one lets it bloom
        this.laserInt[c] = 0.7 * flick * g * (0.5 + 0.5 * Math.min(1.6, this.roomHaze)) * (lit < 0 ? 1 : (k === lit ? 1.7 : 0.1));
        c++;
      }
    }
    this.lasers.count = c;
    this.lasers.instanceMatrix.needsUpdate = true;
    this.laserGeo.getAttribute('aColor').needsUpdate = true;
    this.laserGeo.getAttribute('aIntensity').needsUpdate = true;
  }

  // Keep laser ribbons a constant thickness on screen regardless of window
  // size or fov — a stale value makes them go sub-pixel and alias again.
  setViewport(camera, heightPx) {
    this.laserMat.uniforms.uPxToWorld.value =
      (2 * Math.tan((camera.fov * Math.PI / 180) / 2)) / heightPx;
  }

  // The 6 existing lights become the rig's "real" output: colour and level
  // follow the cue, so the deck and performers actually get lit. No light is
  // ever added or removed — that would recompile every lit material.
  _writeLights() {
    const L = this.lights;
    if (!L) return;
    const m = this.master * this.grand;
    const lit = this.look !== 'blackout' || this.uv;   // UV works from blackout too
    const uv = this.uv;
    const washLevel = lit ? (uv ? 1.3 : 0.75) : 0;   // violet FLOOD, not a dimmer
    L.showLights.forEach((s, i) => {
      const base = s.userData.rigBase ?? (s.userData.rigBase = s.intensity || 900);
      const k = 0.5 + 0.5 * Math.sin(this.t * 0.7 + i * 1.6);
      s.intensity = base * washLevel * m * (0.5 + k * 0.5);
      if (uv) s.color.setRGB(0.25, 0.08, 1.0);
      else if (this.look === 'full') {
        const h = i / 4 + this.t * 0.1;
        s.color.setRGB(hueR(h), hueG(h), hueB(h));
      } else s.color.copy(i % 2 ? this.colorB : this.colorA);
    });
    L.stageSpots.forEach((s, i) => {
      const base = s.userData.rigBase ?? (s.userData.rigBase = s.intensity || 1400);
      s.intensity = base * (lit ? (uv ? 0.35 : 1) : 0.02) * m;
      if (uv) s.color.setRGB(0.3, 0.15, 1.0);
      else s.color.setRGB(1, 0.92, 0.82);
    });
  }
}

// ---------------------------------------------------------------------------
// Soft radial flare sprite.
// ---------------------------------------------------------------------------
function makeFlare() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Confetti: opaque two-tone flakes, all motion in the vertex shader so the
// CPU only ever writes one uniform. Not billboarded — the edge-on flicker as
// flakes tumble IS the effect.
// ---------------------------------------------------------------------------
function makeConfetti(cannons, count) {
  const geo = new THREE.PlaneGeometry(0.125, 0.125);   // square cells for the shape atlas
  const inst = new THREE.InstancedBufferGeometry();
  inst.index = geo.index;
  inst.attributes.position = geo.attributes.position;
  inst.attributes.uv = geo.attributes.uv;

  const origin = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const col = new Float32Array(count * 3);
  const palette = [
    [1.0, 0.25, 0.45], [1.0, 0.85, 0.2], [0.3, 0.7, 1.0],
    [0.7, 0.35, 1.0], [1.0, 1.0, 1.0], [0.35, 1.0, 0.6],
  ];
  for (let i = 0; i < count; i++) {
    const c = cannons[i % cannons.length];
    origin[i * 3] = c.x; origin[i * 3 + 1] = c.y; origin[i * 3 + 2] = c.z;
    // fired up and out over the floor in a spreading fan
    const spread = (Math.random() - 0.5);
    const speed = 13 + Math.random() * 9;
    const yaw = c.yaw || 0;                              // throw azimuth (a ring rig fires outward)
    const fwd = Math.cos(c.tilt) * speed + spread * 2.5;
    const lat = spread * 7 + (Math.random() - 0.5) * 3;
    vel[i * 3] = fwd * Math.cos(yaw) - lat * Math.sin(yaw);
    vel[i * 3 + 1] = Math.sin(c.tilt) * speed;
    vel[i * 3 + 2] = fwd * Math.sin(yaw) + lat * Math.cos(yaw);
    seed[i] = Math.random() * 100;
    const p = palette[(Math.random() * palette.length) | 0];
    col[i * 3] = p[0]; col[i * 3 + 1] = p[1]; col[i * 3 + 2] = p[2];
  }
  inst.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 3));
  inst.setAttribute('aVel', new THREE.InstancedBufferAttribute(vel, 3));
  inst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  inst.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
  inst.instanceCount = count;
  inst.boundingSphere = new THREE.Sphere(new THREE.Vector3(-10, 8, 0), 140);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: -999 }, uLife: { value: 40.0 }, uAtlas: { value: makeConfettiAtlas() }, uDensity: { value: 0.7 } },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec3 aOrigin; attribute vec3 aVel; attribute float aSeed; attribute vec3 aCol;
      uniform float uT; uniform float uLife; uniform float uDensity;
      varying vec3 vCol; varying float vShade; varying float vAlive; varying vec2 vQuv;
      mat3 rotAxis(vec3 a, float ang) {
        float s = sin(ang), c = cos(ang), o = 1.0 - c;
        return mat3(o*a.x*a.x+c, o*a.x*a.y-a.z*s, o*a.z*a.x+a.y*s,
                    o*a.x*a.y+a.z*s, o*a.y*a.y+c, o*a.y*a.z-a.x*s,
                    o*a.z*a.x-a.y*s, o*a.y*a.z+a.x*s, o*a.z*a.z+c);
      }
      void main() {
        vQuv = uv * 0.5 + vec2(mod(floor(aSeed * 7.0), 2.0), mod(floor(aSeed * 13.0), 2.0)) * 0.5;
        float age = uT - aSeed * 0.02;
        // staggered lifetimes so the carpet melts away rather than blinking out
        float life = uLife * (0.8 + 0.4 * fract(aSeed * 0.173));
        vAlive = (age > 0.0 && age < life) ? 1.0 : 0.0;
        if (fract(aSeed * 0.377) > uDensity) vAlive = 0.0;   // the AMOUNT slider
        // drag-damped ballistic flight, then a slow flutter descent —
        // ~0.6 m/s, the speed real paper actually falls at
        float k = 1.0 - exp(-age * 0.55);
        vec3 p = aOrigin + aVel * k * 1.8;
        p.y -= 0.95 * age * 0.62;
        p.x += sin(age * 1.3 + aSeed) * 0.9;
        p.z += cos(age * 1.1 + aSeed * 1.7) * 0.9;
        p.y = max(p.y, 0.02);
        mat3 R = rotAxis(normalize(vec3(sin(aSeed), 1.0, cos(aSeed * 2.0))), age * 6.0 + aSeed);
        // each flake shrinks to nothing over its last 1.5 s — an opaque-pipeline
        // fade that needs no transparency sorting
        float fade = 1.0 - smoothstep(life - 1.5, life, age);
        // hold apparent size past ~22 m so the carpet stays readable from
        // the far end of the bowl instead of dissolving into nothing
        float depth = max(-(modelViewMatrix * vec4(p, 1.0)).z, 0.1);
        float grow = clamp(depth / 22.0, 1.0, 4.5);
        vec3 local = R * position * fade * grow;
        vec4 mv = modelViewMatrix * vec4(p + local, 1.0);
        // two-tone facing shade: front face bright, back face dark
        vShade = 0.45 + 0.55 * abs(normalize((modelViewMatrix * vec4(R * vec3(0.0,0.0,1.0), 0.0)).xyz).z);
        vCol = aCol;
        gl_Position = projectionMatrix * mv;
        if (vAlive < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uAtlas;
      varying vec3 vCol; varying float vShade; varying float vAlive; varying vec2 vQuv;
      void main() {
        if (vAlive < 0.5) discard;
        if (texture2D(uAtlas, vQuv).a < 0.5) discard;        // shape cutout
        gl_FragColor = vec4(vCol * (0.35 + 0.85 * vShade), 1.0);
      }`,
  });

  const mesh = new THREE.Mesh(inst, mat);
  return {
    mesh,
    fire(t) { mat.uniforms.uT.value = 0; mesh.userData.fireT = t; mat.userData = { t0: t }; },
    update(t) {
      const t0 = mesh.userData.fireT;
      mat.uniforms.uT.value = t0 === undefined ? -999 : t - t0;
    },
  };
}

// ---------------------------------------------------------------------------
// B-stage controller — the circular floor screen and its LED rim ring.
// Owns the screen's map so the console and the video source cannot fight over
// it: main.js hands us a content texture, we decide what is actually shown.
// ---------------------------------------------------------------------------
export class BStageFX {
  constructor(stage) {
    this.mat = stage.bScreenMat;
    this.ring = stage.bRing;
    this.contentMap = stage.bIdleTex;   // idle art, or the video once loaded
    this.screenMode = 'content';        // off | content | solid | pulse | rainbow
    this.ringMode = 'rainbow';          // off | rainbow | chase | pulse | solid | strobe
    this.cat = stage.catRing || null;   // catwalk rope light (absent on some layouts)
    this.catMode = 'solid';             // same mode family as the rim ring
    this.catColor = new THREE.Color(0xff2412);
    this.ringColor = null;              // null -> rim follows colorA (legacy looks)
    this.colorA = new THREE.Color(0x2fb8ff);
    this.colorB = new THREE.Color(0xff2f6e);
    this.brightness = 1.0;
    this.speed = 1;
    this.t = 0;
    this.frame = 0;
    this._appliedMap = undefined;
    this._c = new THREE.Color();
  }

  set(opts) { Object.assign(this, opts); }

  // a stage rebuild (layout switch) hands us its new screen + rim
  rebind(stage) {
    this.mat = stage.bScreenMat;
    this.ring = stage.bRing;
    this.cat = stage.catRing || null;
    this.contentMap = stage.bIdleTex;
    this._appliedMap = undefined;
  }

  update(dt) {
    this.t += dt * this.speed;
    this.frame++;
    const t = this.t;
    const br = this.brightness;

    // --- floor screen -----------------------------------------------------
    // Only touch material.map when it actually changes; reassigning every
    // frame would force a needless shader/texture rebind.
    const wantMap = (this.screenMode === 'content' || this.screenMode === 'pulse')
      ? this.contentMap : null;
    if (wantMap !== this._appliedMap) {
      this.mat.map = wantMap;
      this.mat.needsUpdate = true;
      this._appliedMap = wantMap;
    }
    switch (this.screenMode) {
      case 'off':
        this.mat.color.setScalar(0);
        break;
      case 'content':
        this.mat.color.setScalar(1.5 * br);
        break;
      case 'pulse':
        this.mat.color.setScalar((0.5 + 1.4 * (0.5 + 0.5 * Math.sin(t * 1.6))) * br);
        break;
      case 'solid':
        this.mat.color.copy(this.colorA).multiplyScalar(1.7 * br);
        break;
      case 'rainbow':
        this._c.setHSL((t * 0.09) % 1, 1, 0.55);
        this.mat.color.copy(this._c).multiplyScalar(1.7 * br);
        break;
    }

    // --- LED rims: b-stage outline + catwalk rope light --------------------
    this._paintRun(this.ring, this.ringMode, this.ringColor || this.colorA, br, t);
    if (this.cat) this._paintRun(this.cat, this.catMode, this.catColor, br, t);
  }

  // one painter for any LED cell run; u walks 0..1 along the strip
  _paintRun(mesh, mode, colorA, br, t) {
    const arr = mesh.instanceColor.array;
    const n = mesh.count;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      let r = 0, g = 0, b = 0;
      if (mode === 'rainbow') {
        this._c.setHSL((u + t * 0.08) % 1, 1, 0.55);
        r = this._c.r; g = this._c.g; b = this._c.b;
      } else if (mode === 'chase') {
        const k = Math.pow(Math.max(0, Math.sin((u - t * 0.35) * Math.PI * 2 * 3)), 8);
        r = colorA.r * k; g = colorA.g * k; b = colorA.b * k;
      } else if (mode === 'pulse') {
        const k = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 2.1));
        r = colorA.r * k; g = colorA.g * k; b = colorA.b * k;
      } else if (mode === 'solid') {
        r = colorA.r; g = colorA.g; b = colorA.b;
      } else if (mode === 'strobe') {
        const on = this.frame % 8 < 2 ? 1 : 0;   // frame-quantised, never sin(t)
        r = g = b = on;
      }
      const j = i * 3;
      const k = 2.2 * br;                        // clears the 1.25 bloom gate
      arr[j] = r * k; arr[j + 1] = g * k; arr[j + 2] = b * k;
    }
    mesh.instanceColor.needsUpdate = true;
  }
}
