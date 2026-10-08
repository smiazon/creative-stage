// IR moving heads: the other way PixMob reaches a crowd. The wristbands
// listen for infrared, and a moving head fitted with IR emitters sends them a
// command (the same effects a wash sends: solid, pulse, strobe...) down a
// narrow beam, so only the bands inside its footprint catch it. Swing the
// heads and the command paints its way across the crowd. Like a stage light
// the beam can carry a gobo, so the footprint can be a ring, a star, bars...
// The signal itself can't be seen; the beams can be drawn to show where it
// goes (setBeams).
//
// The heads stand on the bowl's top rim all the way round, each aimed across
// the bowl, and in the arena four more hang under the halo board. A movement
// preset moves every head's aim over the stands. The show engine asks this
// module for every band's colour (paint) and, for the preset tiles, for a
// band's colour with no history (previewRGB).
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { IS_STADIUM, SPEC } from './venue.js';
import { basePointAt, baseUAt, topEdgeAt, bowlProfileY, frontWallOff, BOWL_A, BOWL_B } from './bowl.js';
import { WASH, hash, hueRGB } from './showlooks.js';

const TAU = Math.PI * 2;
const frac = (v) => v - Math.floor(v);
const smooth = (e0, e1, v) => {
  let k = (v - e0) / (e1 - e0);
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  return k * k * (3 - 2 * k);
};
// smooth noise, -1..1, for the presets that wander
function noise1(x) {
  const i = Math.floor(x), f = x - i, k = f * f * (3 - 2 * f);
  const a = hash(i, 0.5) * 2 - 1, b = hash(i + 1, 0.5) * 2 - 1;
  return a + (b - a) * k;
}

// --- gobos: the shape cut into the beam ------------------------------------------------
// (u, v): where a point sits across the beam, 1 at its edge; back comes how
// much of the beam gets through there, 0..1. The beam shader draws the same
// shapes (gobo() in BEAM_FRAG); keep the two in step.
export const GOBOS = [
  ['circle', 'Circle'], ['ring', 'Ring'], ['star', 'Star'], ['triangle', 'Triangle'],
  ['bars', 'Bars'], ['dots', 'Dots'], ['flower', 'Flower'], ['cross', 'Cross'],
];
const GOBO_ID = Object.fromEntries(GOBOS.map(([id], i) => [id, i]));
function gobo(id, u, v) {
  const r = Math.hypot(u, v);
  if (r >= 1) return 0;
  let m;
  switch (id) {
    case 0: m = 1 - smooth(0.8, 1, r); break;
    case 1: m = 1 - smooth(0.12, 0.24, Math.abs(r - 0.7)); break;
    case 2: {
      const R = 0.4 + 0.6 * (0.5 + 0.5 * Math.cos(5 * Math.atan2(v, u))) ** 2.2;
      m = 1 - smooth(R - 0.08, R + 0.04, r);
      break;
    }
    case 3: m = 1 - smooth(0.42, 0.52, Math.max(v, -0.866 * u - 0.5 * v, 0.866 * u - 0.5 * v)); break;
    case 4: m = 1 - smooth(0.16, 0.24, Math.abs(frac(u * 1.75 + 0.5) - 0.5)); break;
    case 5: {
      const a = Math.round(Math.atan2(v, u) / (TAU / 6)) * (TAU / 6);
      m = 1 - smooth(0.17, 0.25, Math.min(r, Math.hypot(u - 0.62 * Math.cos(a), v - 0.62 * Math.sin(a))));
      break;
    }
    case 6: {
      const R = 0.55 + 0.45 * Math.abs(Math.cos(3 * Math.atan2(v, u)));
      m = 1 - smooth(R - 0.08, R + 0.04, r);
      break;
    }
    default: m = 1 - smooth(0.15, 0.23, Math.min(Math.abs(u), Math.abs(v)));
  }
  return m * (1 - smooth(0.9, 1, r));
}

// --- movement presets ------------------------------------------------------------------
// aim(head, c, out) says where a head points at clock c (seconds, speed in):
// out.u round the ring (the bowl's own 0..1, as bowl.js measures it), out.v up
// the stands (0 the front row, 1 the top; below 0 runs out across the floor).
// A head: u0, where it points at rest (straight across the bowl); k, its
// number; n, how many there are; ph = k / n. Each preset brings the effect,
// gobo and beam size it was made for, how fast its gobo turns and, for the
// large ones, how many heads it runs on. Some stay on the stands, some reach
// down onto the floor's crowd now and then, three are made for the floor, and
// the last four run three heads with huge beams across the floor and up the
// stands.
const at = (o, u, v) => { o.u = u; o.v = v; return o; };
// --- the MH collecting sweep --------------------------------------------------------------
// The heads take over from the effect before them (the previous trigger on
// the timeline: a ballyhoo, say) and never stop sending. They swing round,
// still lit, to one spot behind the stage where the crowd can't see them, fan
// out there into a line from the middle of the floor to the top row (half the
// heads on each side), and the whole line sweeps out from the stage round
// both sides to the far end. Every band the line crosses lights up and fades
// out behind it: a trail that runs the length of the stadium. Then they swing
// back behind the stage and sweep again (in the next colour, when it cycles).
const COLLECT = { travel: 2.4, rest: 0.5, fan: 0.6, sweep: 7, hold: 0.6, trail: 0.9 };
COLLECT.T = COLLECT.travel + COLLECT.rest + COLLECT.fan + COLLECT.sweep + COLLECT.hold;
COLLECT.s0 = COLLECT.travel + COLLECT.rest + COLLECT.fan;   // when the sweep sets off
function collectPhase(c) {
  const n = Math.floor(c / COLLECT.T), t = c - n * COLLECT.T;
  const f = smooth(0, 1, (t - COLLECT.s0) / COLLECT.sweep);   // the line, 0 at the stage, 1 at the far end
  return { n, t, f };
}
// the gathering spot: behind the stage, out of the crowd's sight (the heads
// a few metres apart, so the beams bunch without stacking up)
function behindStage(h, out) {
  const z = h.n > 1 ? (h.k / (h.n - 1) - 0.5) * 6 : 0;
  return out.set(FEST ? SPEC.downstageX - 4 : (SPEC.stageBack ?? -BOWL_A) - 8, 2.5, z);
}
const ringAt = (a) => baseUAt(Math.cos(a) * BOWL_A * 1.5, Math.sin(a) * BOWL_B * 1.5);
// where head h points on the line when it is f of the way across: { u, v }
function linePoint(h, f, t, out) {
  if (FEST) {   // a field: the line runs across it and moves back from the stage
    out.u = h.n > 1 ? h.k / (h.n - 1) : 0.5;
    out.v = 0.02 + f * 0.98;
    return out;
  }
  // from the middle of the floor (v below 0) to the top row (v 1), half the
  // heads each side; while it sweeps each beam bobs a little, so no row slips through
  const side = h.k % 2 ? 1 : -1, M = Math.ceil(h.n / 2), j = Math.floor(h.k / 2);
  out.v = (M > 1 ? -0.92 + 1.92 * (j / (M - 1)) : 0.3) + 0.07 * Math.sin(t * 4.3 + h.k * 1.7);
  out.u = ringAt(Math.PI - side * Math.PI * Math.max(0.02, f));   // from the stage end (-x) round this side
  return out;
}
const _lp = { u: 0, v: 0 }, _w0 = new THREE.Vector3(), _w1 = new THREE.Vector3();
function collectAim(h, c, o) {
  const { n, t, f } = collectPhase(c);
  o.world = null;
  if (t >= COLLECT.s0) { linePoint(h, f, t, _lp); return at(o, _lp.u, _lp.v); }   // sweeping, then holding at the far end
  if (t < COLLECT.travel + COLLECT.rest) {
    // swinging round to behind the stage: from where the effect before left
    // this head (the first time), or from the far end of the last sweep
    if (n === 0 && h.fromU != null) surfacePoint(frac(h.fromU), h.fromV, _w0);
    else { linePoint(h, 1, 0, _lp); surfacePoint(frac(_lp.u), _lp.v, _w0); }
    o.world = _w0.lerp(behindStage(h, _w1), smooth(0, 1, t / COLLECT.travel));
    return o;
  }
  // fanning out from behind the stage into the line at the stage end
  behindStage(h, _w0);
  linePoint(h, 0, t, _lp);
  surfacePoint(frac(_lp.u), _lp.v, _w1);
  o.world = _w0.lerp(_w1, smooth(0, 1, (t - COLLECT.travel - COLLECT.rest) / COLLECT.fan));
  return o;
}
// the colour a sweep sends: the one colour every time, or the next one each pass
function passColour(p, n, out) {
  if (p.cmode === 'rainbow' || p.cmode === 'cycle') return hueRGB((((n * 3) % 8) + 8) % 8 / 8, out);
  if (p.cmode === 'pal' && p.pal?.length) { const c = p.pal[((n % p.pal.length) + p.pal.length) % p.pal.length]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; return out; }
  out[0] = p.a[0]; out[1] = p.a[1]; out[2] = p.a[2];
  return out;
}
export const MOTIONS = [
  { id: 'sweep', name: 'Sweep', fx: 'solid', gobo: 'circle', size: 1,
    aim: (h, c, o) => at(o, h.u0 + 0.07 * Math.sin(c * 0.9), 0.45 + 0.12 * Math.sin(c * 0.45)) },
  { id: 'wave', name: 'Wave', fx: 'close', gobo: 'circle', size: 1.1,
    aim: (h, c, o) => at(o, h.u0 + 0.08 * Math.sin(c * 1.1 - TAU * h.ph), 0.5 + 0.1 * Math.sin(c * 0.55 - TAU * h.ph)) },
  { id: 'circles', name: 'Circles', fx: 'solid', gobo: 'ring', size: 1.25,
    aim: (h, c, o) => at(o, h.u0 + 0.035 * Math.cos(c * 1.2 + TAU * h.ph), 0.5 + 0.28 * Math.sin(c * 1.2 + TAU * h.ph)) },
  // the lower loop dips over the front rows onto the edge of the floor
  { id: 'figure8', name: 'Figure 8', fx: 'close', gobo: 'circle', size: 0.9,
    aim: (h, c, o) => at(o, h.u0 + 0.06 * Math.sin(c * 0.8), 0.35 + 0.45 * Math.sin(c * 1.6)) },
  // from out on the floor up to the top row and back
  { id: 'rise', name: 'Rise and fall', fx: 'solid', gobo: 'bars', size: 1.3,
    aim: (h, c, o) => at(o, h.u0 + 0.02 * Math.sin(c * 0.3 + TAU * h.ph), 0.3 + 0.62 * Math.sin(c * 1.3 - TAU * h.ph * 2)) },
  { id: 'cross', name: 'Crossfire', fx: 'pulse', gobo: 'circle', size: 1,
    aim: (h, c, o) => at(o, h.u0 + 0.09 * Math.sin(c) * (h.k % 2 ? 1 : -1), 0.5 + 0.2 * Math.cos(c * 0.5)) },
  { id: 'lighthouse', name: 'Lighthouse', fx: 'close', gobo: 'circle', size: 1,
    aim: (h, c, o) => at(o, h.u0 + c * 0.06, 0.42 + 0.08 * Math.sin(c * 0.7 + TAU * h.ph)) },
  { id: 'focus', name: 'Focus', fx: 'solid', gobo: 'circle', size: 1.4,
    aim: (h, c, o) => at(o, c * 0.035, 0.3 + 0.45 * Math.sin(c * 0.7)) },
  // wandering spots, the stands and the floor alike
  { id: 'search', name: 'Search', fx: 'solid', gobo: 'circle', size: 0.8,
    aim: (h, c, o) => at(o, h.u0 + 0.09 * noise1(c * 0.35 + h.k * 7.1), Math.max(-0.85, 0.2 + 0.8 * noise1(c * 0.3 + h.k * 3.3 + 50))) },
  { id: 'snap', name: 'Snap', fx: 'strobe', gobo: 'dots', size: 1.2,
    aim: (h, c, o) => {
      // a new spot on every beat, and a quick swing to get there
      const t = c / 0.9, b = Math.floor(t), e = smooth(0, 0.16, t - b);
      // (a spot below the front row is out on the floor)
      const pu = (hash(h.k, b - 1) - 0.5) * 0.18, pv = -0.6 + 1.5 * hash(b - 1, h.k + 0.5);
      const cu = (hash(h.k, b) - 0.5) * 0.18, cv = -0.6 + 1.5 * hash(b, h.k + 0.5);
      return at(o, h.u0 + pu + (cu - pu) * e, pv + (cv - pv) * e);
    } },
  { id: 'ballyhoo', name: 'Ballyhoo', fx: 'close', gobo: 'star', size: 1.1, spin: 1.2,
    aim: (h, c, o) => at(o, h.u0 + 0.1 * Math.sin(c * 2.1 + h.k), 0.35 + 0.55 * Math.sin(c * 2.9 + h.k * 1.7)) },
  { id: 'kaleido', name: 'Kaleidoscope', fx: 'fade', gobo: 'flower', size: 1.6, spin: 1.4,
    aim: (h, c, o) => at(o, h.u0, 0.5 + 0.12 * Math.sin(c * 0.5 + TAU * h.ph)) },
  // the floor's own: every beam crossing the crowd down on the floor
  { id: 'floorsweep', name: 'Floor sweep', fx: 'solid', gobo: 'circle', size: 1.15,
    aim: (h, c, o) => at(o, h.u0 + 0.07 * Math.sin(c * 0.8 + TAU * h.ph), -0.55 - 0.32 * Math.sin(c * 0.6 + h.k * 1.3)) },
  // every other head on the floor, the rest on the stands, trading places now and then
  { id: 'split', name: 'Stands and floor', fx: 'pulse', gobo: 'circle', size: 1,
    aim: (h, c, o) => {
      const f = smooth(0.25, 0.75, 0.5 + 0.5 * Math.sin(c * 0.45 + (h.k % 2) * Math.PI));
      const stands = 0.55 + 0.12 * Math.sin(c * 0.8 + h.k), floor = -0.6 + 0.22 * Math.sin(c * 0.7 + h.k);
      return at(o, h.u0 + 0.06 * Math.sin(c * 0.9 + h.k), stands + (floor - stands) * f);
    } },
  // beams pouring down the stands and out across the floor, one after another round the room
  { id: 'cascade', name: 'Cascade', fx: 'close', gobo: 'bars', size: 1.1,
    aim: (h, c, o) => at(o, h.u0 + 0.03 * Math.sin(c * 0.4 + h.k), 0.05 + 0.9 * Math.cos(c * 0.9 + TAU * h.ph)) },
  // LARGE: three heads (spread round the room) with wide beams, each one
  // sweeping right across the floor and up the stands behind it
  { id: 'bigsweep', name: 'Big sweep', fx: 'solid', gobo: 'circle', size: 3.4, heads: 3,
    aim: (h, c, o) => at(o, h.u0 + 0.1 * Math.sin(c * 0.37 + TAU * h.ph), 0.08 + 0.92 * Math.sin(c * 0.55 + TAU * h.ph)) },
  // side to side across the floor in long strokes, climbing the bowl and coming back down
  { id: 'threeacross', name: 'Three across', fx: 'close', gobo: 'circle', size: 3, heads: 3,
    aim: (h, c, o) => at(o, h.u0 + 0.2 * Math.sin(c * 0.42 + TAU * h.ph), -0.75 + 1.65 * (0.5 + 0.5 * Math.sin(c * 0.23 + h.k * 2.1))) },
  // three great rings wandering the floor and the stands
  { id: 'searchlights', name: 'Searchlights', fx: 'solid', gobo: 'ring', size: 3.2, heads: 3,
    aim: (h, c, o) => at(o, h.u0 + 0.18 * Math.sin(c * 0.31 + TAU * h.ph), 0.1 + 0.85 * Math.sin(c * 0.62 + TAU * h.ph)) },
  // all three together, a slow tide from the floor to the top row, turning round the room
  { id: 'tide', name: 'Tide', fx: 'fade', gobo: 'circle', size: 4, heads: 3,
    aim: (h, c, o) => at(o, h.u0 + c * 0.018, 0.05 + 0.95 * Math.sin(c * 0.4)) },
  // every head gathers behind the stage, still sending, then they sweep the venue together, a fading trail behind
  { id: 'collect', name: 'MH collecting sweep', fx: 'solid', gobo: 'circle', size: 2.2, heads: 0, collect: true,
    aim: collectAim },
];
export const MOTION = Object.fromEntries(MOTIONS.map((m) => [m.id, m]));

// --- where things are --------------------------------------------------------------------
// the bowl's inner edge at ring fraction u, and its outward normal there
function ringFrame(u) {
  const b = basePointAt(u), b2 = basePointAt(u + 1e-3);
  let tx = b2.x - b.x, tz = b2.z - b.z;
  const l = Math.hypot(tx, tz) || 1;
  tx /= l; tz /= l;
  return { x: b.x, z: b.z, nx: tz, nz: -tx };
}
// A festival field has no stands to aim at: there u runs across the crowd
// (bouncing back at the edges, so a preset that keeps turning sweeps to and
// fro) and v from the front of the crowd to the back of the field.
const FEST = !!SPEC.crowdBands;
const bounce = (u) => { const w = ((u % 2) + 2) % 2; return w <= 1 ? w : 2 - w; };
// the seats at (u, v), at the height a band is held
function surfacePoint(u, v, out) {
  if (FEST) {
    // all of it is floor: an aim out onto the floor reaches as far back into the crowd
    const x0 = SPEC.downstageX + 5, x1 = BOWL_A - 5;
    return out.set(x0 + (x1 - x0) * Math.min(1, Math.abs(v)), 1.1, -BOWL_B + 3 + (2 * BOWL_B - 6) * bounce(u));
  }
  const f = ringFrame(u);
  if (v < 0) {
    // out from the front row across the floor, never back onto an end stage
    const r = -v * BOWL_B * 0.9;
    return out.set(Math.max(f.x - f.nx * r, (SPEC.downstageX ?? -1e4) + 3), 1.1, f.z - f.nz * r);
  }
  const top = topEdgeAt(f.nz * f.nz, true), front = frontWallOff() + 0.9;
  const off = front + (top.off - front) * Math.min(1, v);
  let y = bowlProfileY(off);
  if (!isFinite(y)) y = top.y;
  return out.set(f.x + f.nx * off, y + 0.9, f.z + f.nz * off);
}

// half the beam's spread at size 1: the stadium's throws are three times as
// long; a festival's are short and wide open
const THETA = ((FEST ? 3.2 : IS_STADIUM ? 1.8 : 2.6) * Math.PI) / 180;
const N_RIM = IS_STADIUM ? 16 : 12;
const S = IS_STADIUM ? 1.7 : 1;    // fixture size: seen from 150 m they need the bulk
const PIVOT = 0.41 * S;            // from the mounting face to the head's tilt axis
const BOARD_DROP = 6.1;            // from the halo board's hang height to a hung head's mount

// The beam drawn when the signal is shown: a unit cone (apex at the lens, open
// along +z, radius = z) scaled to each beam, marched through in the fragment
// shader so the gobo shows in the beam like a stage light's in haze. Drawn
// from its back faces, so every pixel is the ray's exit; the entry is solved
// against the cone (or is the eye, from inside the beam).
const BEAM_VERT = /* glsl */`
  attribute vec3 iColor;
  attribute float iGobo;
  attribute float iSpin;
  varying vec3 vP;
  varying vec3 vO;
  varying vec3 vW;
  varying vec3 vCol;
  varying float vGobo;
  varying float vSpin;
  void main() {
    mat4 m = modelMatrix * instanceMatrix;
    vP = position;
    vW = (m * vec4(position, 1.0)).xyz;
    vO = (inverse(m) * vec4(cameraPosition, 1.0)).xyz;
    vCol = iColor; vGobo = iGobo; vSpin = iSpin;
    gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
  }`;
const BEAM_FRAG = /* glsl */`
  uniform float uDensity;
  varying vec3 vP;
  varying vec3 vO;
  varying vec3 vW;
  varying vec3 vCol;
  varying float vGobo;
  varying float vSpin;
  float gobo(vec2 q, float id) {
    float r = length(q);
    float a = atan(q.y, q.x);
    float m;
    if (id < 0.5) m = 1.0 - smoothstep(0.8, 1.0, r);
    else if (id < 1.5) m = 1.0 - smoothstep(0.12, 0.24, abs(r - 0.7));
    else if (id < 2.5) { float R = 0.4 + 0.6 * pow(0.5 + 0.5 * cos(5.0 * a), 2.2); m = 1.0 - smoothstep(R - 0.08, R + 0.04, r); }
    else if (id < 3.5) m = 1.0 - smoothstep(0.42, 0.52, max(q.y, max(-0.866 * q.x - 0.5 * q.y, 0.866 * q.x - 0.5 * q.y)));
    else if (id < 4.5) m = 1.0 - smoothstep(0.16, 0.24, abs(fract(q.x * 1.75 + 0.5) - 0.5));
    else if (id < 5.5) { float k = floor(a / 1.0472 + 0.5) * 1.0472; m = 1.0 - smoothstep(0.17, 0.25, min(r, length(q - 0.62 * vec2(cos(k), sin(k))))); }
    else if (id < 6.5) { float R = 0.55 + 0.45 * abs(cos(3.0 * a)); m = 1.0 - smoothstep(R - 0.08, R + 0.04, r); }
    else m = 1.0 - smoothstep(0.15, 0.23, min(abs(q.x), abs(q.y)));
    return m * (1.0 - smoothstep(0.9, 1.0, r));
  }
  void main() {
    vec3 d = vP - vO;
    float t1 = length(d);
    d /= t1;
    float t0 = 0.0;
    bool inside = vO.z > 0.0 && vO.z < 1.0 && dot(vO.xy, vO.xy) < vO.z * vO.z;
    if (!inside) {
      t0 = t1;
      float A = d.x * d.x + d.y * d.y - d.z * d.z;
      float B = 2.0 * (vO.x * d.x + vO.y * d.y - vO.z * d.z);
      float C = dot(vO.xy, vO.xy) - vO.z * vO.z;
      float D = B * B - 4.0 * A * C;
      if (D > 0.0 && abs(A) > 1e-6) {
        float s = sqrt(D);
        float ra = (-B - s) / (2.0 * A), rb = (-B + s) / (2.0 * A);
        float r0 = min(ra, rb), r1 = max(ra, rb);
        float z0 = vO.z + d.z * r0, z1 = vO.z + d.z * r1;
        if (r0 > 0.0 && z0 >= 0.0 && z0 <= 1.0) t0 = r0;
        else if (r1 > 0.0 && z1 >= 0.0 && z1 <= 1.0) t0 = r1;
      }
      // in through the open end
      if (d.z < 0.0) {
        float rc = (1.0 - vO.z) / d.z;
        vec2 pc = vO.xy + d.xy * rc;
        if (rc > 0.0 && dot(pc, pc) <= 1.0) t0 = min(t0, rc);
      }
    }
    if (t1 - t0 < 1e-4) discard;
    float cs = cos(vSpin), sn = sin(vSpin);
    float acc = 0.0;
    float dt = (t1 - t0) / 14.0;
    for (int i = 0; i < 14; i++) {
      vec3 p = vO + d * (t0 + (float(i) + 0.5) * dt);
      if (p.z <= 0.002) continue;
      vec2 q = p.xy / p.z;
      q = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
      acc += gobo(q, vGobo) * (1.0 - 0.6 * p.z);
    }
    // the cone's own units stretch differently each way: measure the march in
    // metres, so a beam glows by how much of it the eye looks through
    float metres = dt * length(vW - cameraPosition) / t1;
    gl_FragColor = vec4(vCol * min(1.0, acc * metres * uDensity), 1.0);
  }`;

// the panel's Gobo size slider: every beam scaled on top of its effect's own size
let GOBO_K = 1;
export function setGoboScale(k) { GOBO_K = Math.max(0.3, Math.min(3, +k || 1)); }

export function initIRHeads({ scene, jumboY, tempo }) {
  // --- the heads -------------------------------------------------------------------------
  const mounts = [];
  const lateral = (z) => (z + BOWL_B) / (2 * BOWL_B);   // a festival head's place across the field
  if (FEST) {
    // eight under the front of the stage roof, aimed out over the crowd, and
    // one on top of each delay tower
    for (let k = 0; k < 8; k++) {
      const z = -19.5 + (k * 39) / 7;
      mounts.push({ base: new THREE.Vector3(SPEC.downstageX + 6.5, SPEC.roofY - 0.4, z), up: -1, u0: lateral(z), hang: false });
    }
    for (const [x, z] of SPEC.crowdHoles || []) mounts.push({ base: new THREE.Vector3(x, 14.3, z), up: 1, u0: lateral(z), hang: false });
  } else for (let k = 0; k < N_RIM; k++) {
    const u = (k + 0.5) / N_RIM, f = ringFrame(u), top = topEdgeAt(f.nz * f.nz, true), off = top.off + 0.9;
    mounts.push({ base: new THREE.Vector3(f.x + f.nx * off, top.y + 2.0, f.z + f.nz * off), up: 1, u0: u + 0.5, hang: false });
  }
  if (!IS_STADIUM && jumboY) {
    // four more under the halo board, each facing out to its corner
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      const x = sx * 4.2, z = sz * 2.6;
      mounts.push({ base: new THREE.Vector3(x, 0, z), up: -1, u0: baseUAt(x * 20, z * 20), hang: true });
    }
  }
  const makeHeads = () => mounts.map((m, k) => ({
    ...m, base: m.base.clone(), k, n: mounts.length, ph: k / mounts.length,
    P: new THREE.Vector3(), axis: new THREE.Vector3(0, -1, 0), right: new THREE.Vector3(1, 0, 0), upv: new THREE.Vector3(0, 0, 1),
    target: new THREE.Vector3(), cos: Math.cos(THETA), tan: Math.tan(THETA), len: 10, spin: 0, col: [1, 1, 1],
  }));
  const heads = makeHeads();
  const N = heads.length;

  // How many heads send is the show's choice (p.heads; 0 = all of them). They
  // switch on furthest-apart first, so any count covers the room evenly: each
  // next head is the one furthest round the ring from those already on, the
  // rim before the board at an equal spread. The rest park, emitters dark.
  const ORDER = (() => {
    // where each covers: round the ring, or (at a festival) across the field
    const at = heads.map((h) => (FEST ? h.u0 : frac(h.hang ? h.u0 : h.u0 - 0.5)));
    const picked = [0], left = new Set(heads.map((h) => h.k));
    left.delete(0);
    while (left.size) {
      let best = -1, bestD = -1;
      for (const k of left) {
        let d = Infinity;
        for (const j of picked) { const x = Math.abs(at[k] - at[j]); d = Math.min(d, x, FEST ? x : 1 - x); }
        if (heads[k].hang) d *= 0.9;
        if (d > bestD) { bestD = d; best = k; }
      }
      picked.push(best);
      left.delete(best);
    }
    return picked;
  })();
  const masks = new Map();
  function activeMask(want) {
    const n = !want || want >= N ? N : Math.max(1, Math.round(want));
    let m = masks.get(n);
    if (!m) { m = new Uint8Array(N); for (let i = 0; i < n; i++) m[ORDER[i]] = 1; masks.set(n, m); }
    return m;
  }

  // point every head in hs for show p at clock c: aim, beam spread, gobo frame, colour
  const _aim = { u: 0, v: 0, world: null }, WUP = new THREE.Vector3(0, 1, 0), _t = new THREE.Vector3();
  function aimAll(hs, p, c) {
    const M = MOTION[p.motion] || MOTIONS[0];
    const th = Math.min(1.2, THETA * (p.size || 1) * GOBO_K), cos = Math.cos(th), tan = Math.tan(th);
    const spin = (M.spin || 0) * c;
    const board = jumboY ? jumboY() : 0;
    const on = activeMask(p.heads);
    // a collecting sweep runs from the moment it took over, in the colour of the effect before it
    const own = hs === heads, cc = M.collect && own ? c - live.collectC0 : c;
    const pc = M.collect && own && live.inherit ? { ...p, ...live.inherit } : p;
    for (const h of hs) {
      if (h.hang) h.base.y = board - BOARD_DROP;
      h.P.copy(h.base);
      h.P.y += h.up * PIVOT;
      h.on = !!on[h.k];
      if (!h.on) {   // parked: pointing along its base, sending nothing
        h.axis.set(0, h.up, 0);
        h.len = 4;
        h.target.copy(h.P).addScaledVector(h.axis, h.len);
        continue;
      }
      _aim.world = null;
      M.aim(h, M.collect ? cc : c, _aim);
      if (_aim.world) h.target.copy(_aim.world);   // a point in the room (behind the stage)
      else {
        h.au = _aim.u; h.av = _aim.v;   // where it points, for an effect that takes over from this one
        surfacePoint(frac(_aim.u), _aim.v, h.target);
      }
      h.axis.subVectors(h.target, h.P);
      h.len = h.axis.length() || 1;
      h.axis.divideScalar(h.len);
      // the gobo's frame across the beam, turned as it spins
      h.right.crossVectors(h.axis, WUP);
      if (h.right.lengthSq() < 1e-6) h.right.set(1, 0, 0);
      h.right.normalize();
      h.upv.crossVectors(h.right, h.axis);
      h.spin = spin ? spin + h.k : 0;
      if (h.spin) {
        const cs = Math.cos(h.spin), sn = Math.sin(h.spin);
        _t.copy(h.right).multiplyScalar(cs).addScaledVector(h.upv, sn);
        h.upv.multiplyScalar(cs).addScaledVector(h.right, -sn);
        h.right.copy(_t);
      }
      h.cos = cos; h.tan = tan;
      // what colour it sends: one for all, a hue each, or all stepping round
      // together; a collecting sweep paints one colour a pass, every head alike
      if (M.collect) {
        const ph = collectPhase(cc);
        if (own && ph.n === 0 && ph.t < COLLECT.s0 && h.prevCol) { h.col[0] = h.prevCol[0]; h.col[1] = h.prevCol[1]; h.col[2] = h.prevCol[2]; }
        else passColour(pc, ph.n, h.col);
      }
      else if (p.cmode === 'rainbow') hueRGB(h.k / N, h.col);
      else if (p.cmode === 'cycle') hueRGB(Math.floor(c / 1.5) / 8, h.col);
      else if (p.cmode === 'pal' && p.pal?.length) { const q = p.pal[h.k % p.pal.length]; h.col[0] = q[0]; h.col[1] = q[1]; h.col[2] = q[2]; }
      else { h.col[0] = p.a[0]; h.col[1] = p.a[1]; h.col[2] = p.a[2]; }
    }
  }

  // --- the fixtures: base, yoke, head and lens, one instanced mesh each -----------------
  const group = new THREE.Group();
  group.name = 'irHeads';
  scene.add(group);
  const fixtures = new THREE.Group();
  fixtures.visible = false;
  group.add(fixtures);
  const metal = new THREE.MeshStandardMaterial({ color: 0x1d1e23, roughness: 0.42, metalness: 0.65 });
  const baseGeo = new THREE.BoxGeometry(0.5, 0.16, 0.42).translate(0, 0.08, 0);
  const yokeGeo = BufferGeometryUtils.mergeGeometries([
    new THREE.BoxGeometry(0.06, 0.5, 0.12).translate(-0.24, 0.41, 0),
    new THREE.BoxGeometry(0.06, 0.5, 0.12).translate(0.24, 0.41, 0),
    new THREE.BoxGeometry(0.54, 0.06, 0.14).translate(0, 0.19, 0),
  ]);
  const headGeo = new THREE.CylinderGeometry(0.17, 0.2, 0.46, 18).rotateX(Math.PI / 2);
  const lensGeo = new THREE.CircleGeometry(0.15, 18).translate(0, 0, 0.232);
  const inst = (geo, mat) => {
    const m = new THREE.InstancedMesh(geo, mat, N);
    m.frustumCulled = false;
    fixtures.add(m);
    return m;
  };
  const baseMesh = inst(baseGeo, metal), yokeMesh = inst(yokeGeo, metal), headMesh = inst(headGeo, metal);
  const lensMesh = inst(lensGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  const IR_DARK = new THREE.Color(0.16, 0.0, 0.02);   // an emitter at rest: a deep red eye
  for (let k = 0; k < N; k++) lensMesh.setColorAt(k, IR_DARK);
  const dummy = new THREE.Object3D(), _look = new THREE.Vector3(), _col = new THREE.Color();
  function writeFixtures(lit) {
    for (const h of heads) {
      dummy.up.set(0, h.up, 0);
      dummy.scale.setScalar(S);
      // the base: on the rail, or upside down under the board
      dummy.position.copy(h.base);
      dummy.quaternion.identity();
      if (h.up < 0) dummy.rotation.set(Math.PI, 0, 0);
      dummy.updateMatrix();
      baseMesh.setMatrixAt(h.k, dummy.matrix);
      // the yoke pans to face the target (a parked head keeps the base's square)
      dummy.position.copy(h.base);
      if (h.on) {
        _look.set(h.base.x + h.axis.x, h.base.y, h.base.z + h.axis.z);
        dummy.lookAt(_look);
      }
      dummy.updateMatrix();
      yokeMesh.setMatrixAt(h.k, dummy.matrix);
      // the head tilts down the beam; parked, it points along the base
      dummy.position.copy(h.P);
      if (h.on) dummy.lookAt(h.target);
      else dummy.rotation.set(-h.up * Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      headMesh.setMatrixAt(h.k, dummy.matrix);
      lensMesh.setMatrixAt(h.k, dummy.matrix);
      lensMesh.setColorAt(h.k, lit && h.on ? _col.setRGB(h.col[0] * 3, h.col[1] * 3, h.col[2] * 3) : IR_DARK);
    }
    for (const m of [baseMesh, yokeMesh, headMesh, lensMesh]) m.instanceMatrix.needsUpdate = true;
    lensMesh.instanceColor.needsUpdate = true;
  }

  // --- the beams, when the signal is shown ------------------------------------------------
  // closed at the far end: a ray leaving through the end needs a face to be drawn on
  const beamGeo = new THREE.CylinderGeometry(1, 0, 1, 40, 1, false).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  const iColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  const iGobo = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  const iSpin = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  for (const a of [iColor, iGobo, iSpin]) a.setUsage(THREE.DynamicDrawUsage);
  beamGeo.setAttribute('iColor', iColor);
  beamGeo.setAttribute('iGobo', iGobo);
  beamGeo.setAttribute('iSpin', iSpin);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uDensity: { value: 0.009 } }, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
  });
  const beamMesh = new THREE.InstancedMesh(beamGeo, beamMat, N);
  beamMesh.frustumCulled = false;
  beamMesh.visible = false;
  beamMesh.renderOrder = 3;
  group.add(beamMesh);
  let beamsOn = false;
  function writeBeams(p) {
    const gid = GOBO_ID[p.gobo] ?? 0;
    // a wider beam spreads the same light over more air: it glows fainter per
    // metre, or a big one seen from inside would fog the whole view
    const dim = 1 / Math.max(1, (p.size || 1) * GOBO_K) ** 1.5;
    for (const h of heads) {
      const L = h.len * 1.02, R = L * h.tan;
      dummy.up.set(0, 1, 0);
      dummy.position.copy(h.P);
      dummy.lookAt(h.target);
      if (h.on) dummy.scale.set(R, R, L); else dummy.scale.setScalar(0);
      dummy.updateMatrix();
      beamMesh.setMatrixAt(h.k, dummy.matrix);
      iColor.setXYZ(h.k, h.col[0] * dim, h.col[1] * dim, h.col[2] * dim);
      iGobo.setX(h.k, gid);
      iSpin.setX(h.k, -h.spin);
    }
    beamMesh.instanceMatrix.needsUpdate = true;
    iColor.needsUpdate = iGobo.needsUpdate = iSpin.needsUpdate = true;
  }

  // --- moving them -----------------------------------------------------------------------
  const live = { now: 0, c: 0, params: null, motion: null, since: 0, collectC0: 0, inherit: null };
  // every frame: params is the IR show playing, or null when it isn't
  function update(dt, params) {
    const on = !!params;
    fixtures.visible = on;
    beamMesh.visible = on && beamsOn;
    // what a sweep painted belongs to that sweep: a new movement, or the show
    // coming back, starts on a dark room
    if (on && (!live.params || params.motion !== live.motion)) {
      // a collecting sweep taking over picks up the effect before it: where
      // each head points (the gathering starts there) and the colour it sent
      const prev = live.params, M = MOTION[params.motion];
      if (M?.collect) {
        const fromPrev = !!prev && !MOTION[prev.motion]?.collect;
        for (const h of heads) {
          h.fromU = fromPrev && h.on && h.au != null ? h.au : null; h.fromV = h.av;
          h.prevCol = fromPrev && h.on ? [...h.col] : null;
        }
        live.collectC0 = live.c;
        live.inherit = fromPrev ? { a: prev.a, cmode: prev.cmode } : null;
      }
      live.motion = params.motion;
      live.since = live.now + 1e-6;
    }
    live.params = params;
    if (!on) return;
    live.now += dt;
    live.c += dt * (params.speed ?? 1) * (tempo ? tempo() : 1);
    aimAll(heads, params, live.c);
    writeFixtures(beamsOn);
    if (beamsOn) writeBeams(params);
  }

  // --- the bands: when a beam last touched each, which head, how squarely ----------------
  // The bands are bucketed into a coarse plan grid, each bucket with a
  // bounding sphere, so a beam only tests the bands it could possibly reach.
  const CELL = IS_STADIUM ? 10 : 5;
  function buildCells(pos, n) {
    const map = new Map();
    for (let i = 0; i < n; i++) {
      const key = `${Math.floor(pos[i * 3] / CELL)},${Math.floor(pos[i * 3 + 2] / CELL)}`;
      let list = map.get(key);
      if (!list) map.set(key, (list = []));
      list.push(i);
    }
    const cells = [];
    for (const list of map.values()) {
      let x = 0, y = 0, z = 0;
      for (const i of list) { x += pos[i * 3]; y += pos[i * 3 + 1]; z += pos[i * 3 + 2]; }
      x /= list.length; y /= list.length; z /= list.length;
      let r = 0;
      for (const i of list) r = Math.max(r, Math.hypot(pos[i * 3] - x, pos[i * 3 + 1] - y, pos[i * 3 + 2] - z));
      cells.push({ x, y, z, r: r + 0.5, idx: Int32Array.from(list) });
    }
    return cells;
  }
  const state = [];
  function stateFor(g, gi) {
    let s = state[gi];
    if (s && s.pos === g.pos && s.n === g.n) return s;
    s = {
      pos: g.pos, n: g.n, cells: buildCells(g.pos, g.n),
      last: new Float32Array(g.n).fill(-1e9), enter: new Float32Array(g.n), str: new Float32Array(g.n), src: new Uint8Array(g.n),
      col: new Float32Array(g.n * 3),   // the colour each band was last sent, for a sweep that leaves it lit
    };
    state[gi] = s;
    return s;
  }
  // every band inside a beam this update takes its command; the squarest touch wins
  function hit(s, g, p) {
    const { pos, cells } = s, ph = g.phase, now = live.now;
    const prob = p.prob ?? 1, gid = GOBO_ID[p.gobo] ?? 0, roll = Math.floor(live.c / 0.5);
    for (const h of heads) {
      if (!h.on) continue;
      const ax = h.axis.x, ay = h.axis.y, az = h.axis.z, Px = h.P.x, Py = h.P.y, Pz = h.P.z;
      const rx = h.right.x, ry = h.right.y, rz = h.right.z, ux = h.upv.x, uy = h.upv.y, uz = h.upv.z;
      const th = Math.acos(h.cos), cos2 = h.cos * h.cos;
      for (const cell of cells) {
        const dx = cell.x - Px, dy = cell.y - Py, dz = cell.z - Pz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > cell.r) {
          const ang = Math.acos(Math.max(-1, Math.min(1, (dx * ax + dy * ay + dz * az) / dist)));
          if (ang - Math.asin(cell.r / dist) > th) continue;
        }
        const idx = cell.idx;
        for (let q = 0; q < idx.length; q++) {
          const i = idx[q], o = i * 3;
          const x = pos[o] - Px, y = pos[o + 1] - Py, z = pos[o + 2] - Pz;
          const along = x * ax + y * ay + z * az;
          if (along <= 0 || along * along < cos2 * (x * x + y * y + z * z)) continue;
          const k = 1 / (along * h.tan);
          const m = gobo(gid, (x * rx + y * ry + z * rz) * k, (x * ux + y * uy + z * uz) * k);
          if (m < 0.05) continue;
          if (prob < 1 && hash(ph[i] * 9.73 + h.k, roll) >= prob) continue;
          if (s.last[i] !== now || m > s.str[i]) {
            if (now - s.last[i] > 0.25) s.enter[i] = now;   // it had gone quiet: a new touch
            s.last[i] = now; s.str[i] = m; s.src[i] = h.k;
            s.col[o] = h.col[0]; s.col[o + 1] = h.col[1]; s.col[o + 2] = h.col[2];
          }
        }
      }
    }
  }
  // OrbFX's colour pass for one group of bands (via the show engine)
  function paint(g, gi, arr, br, p) {
    const s = stateFor(g, gi), now = live.now;
    if (live.params) hit(s, g, p);
    if (MOTION[p.motion]?.collect) {
      for (let i = 0, j = 0; i < s.n; i++, j += 3) {
        const tau = now - s.last[i];
        if (tau > 4.5) { arr[j] = 0; arr[j + 1] = 0; arr[j + 2] = 0; continue; }
        const k = (tau < 0.15 ? 1 : Math.exp(-(tau - 0.15) / COLLECT.trail)) * Math.min(1, s.str[i] * 1.6) * br;
        arr[j] = s.col[j] * k; arr[j + 1] = s.col[j + 1] * k; arr[j + 2] = s.col[j + 2] * k;
      }
      return;
    }
    const fx = p.fx || 'solid', W = WASH[fx] || WASH.solid;
    // pulse, strobe and fade play in time with the heads while a band is lit
    const beat = fx === 'pulse' || fx === 'strobe' || fx === 'fade' ? W.f(frac(live.c / W.period)) : 1;
    for (let i = 0, j = 0; i < s.n; i++, j += 3) {
      const tau = now - s.last[i];
      if (tau > 2.5) { arr[j] = 0; arr[j + 1] = 0; arr[j + 2] = 0; continue; }
      let e;
      if (fx === 'solid') e = tau < 0.12 ? 1 : Math.exp(-(tau - 0.12) / 0.28);            // held, then a short afterglow
      else if (fx === 'close') e = tau >= 1.1 ? 0 : (1 - tau / 1.1) ** 2.2;              // a long tail behind the beam
      else if (fx === 'open') {                                                           // brightening the longer it stays
        const r = Math.min(1, (s.last[i] - s.enter[i]) / 0.55);
        e = r * r * (tau < 0.08 ? 1 : Math.exp(-(tau - 0.08) / 0.06));
      } else e = beat * (tau < 0.1 ? 1 : Math.exp(-(tau - 0.1) / (fx === 'fade' ? 0.5 : 0.12)));
      const k = e * s.str[i] * br, col = heads[s.src[i]].col;
      arr[j] = col[0] * k; arr[j + 1] = col[1] * k; arr[j + 2] = col[2] * k;
    }
  }

  // --- previews: a band's colour with no history, for the preset tiles -------------------
  const pv = { heads: makeHeads(), p: null, c: NaN };
  function previewRGB(p, c, x, y, z, seed, out) {
    if (pv.p !== p || pv.c !== c) { pv.p = p; pv.c = c; aimAll(pv.heads, p, c); }
    out[0] = 0; out[1] = 0; out[2] = 0;
    let trail = 0;
    if (MOTION[p.motion]?.collect) {
      // the trail: how long ago the line crossed this band, faded
      const { n, t } = collectPhase(c);
      const across = FEST ? (x - SPEC.downstageX) / Math.max(1, BOWL_A - SPEC.downstageX) : Math.abs(Math.atan2(z / BOWL_B, -x / BOWL_A)) / Math.PI;
      const crossed = COLLECT.s0 + Math.min(1, Math.max(0, across)) * COLLECT.sweep;
      if (t >= crossed) trail = Math.exp(-(t - crossed) / COLLECT.trail);
      if (trail > 0.02) passColour(p, n, out);
      out[0] *= trail; out[1] *= trail; out[2] *= trail;
    }
    const gid = GOBO_ID[p.gobo] ?? 0, prob = p.prob ?? 1, roll = Math.floor(c / 0.5);
    let best = 0, src = null;
    for (const h of pv.heads) {
      if (!h.on) continue;
      const dx = x - h.P.x, dy = y - h.P.y, dz = z - h.P.z;
      const along = dx * h.axis.x + dy * h.axis.y + dz * h.axis.z;
      if (along <= 0 || along * along < h.cos * h.cos * (dx * dx + dy * dy + dz * dz)) continue;
      if (prob < 1 && hash(seed * 9.73 + h.k, roll) >= prob) continue;
      const k = 1 / (along * h.tan);
      const m = gobo(gid, (dx * h.right.x + dy * h.right.y + dz * h.right.z) * k, (dx * h.upv.x + dy * h.upv.y + dz * h.upv.z) * k);
      if (m > best) { best = m; src = h; }
    }
    if (!src) return out;
    if (trail > 0) { out[0] = Math.max(out[0], src.col[0] * best); out[1] = Math.max(out[1], src.col[1] * best); out[2] = Math.max(out[2], src.col[2] * best); return out; }
    const W = WASH[p.fx] || WASH.solid;
    const k = best * (p.fx === 'pulse' || p.fx === 'strobe' || p.fx === 'fade' ? W.f(frac(c / W.period)) : 1);
    out[0] = src.col[0] * k; out[1] = src.col[1] * k; out[2] = src.col[2] * k;
    return out;
  }

  return {
    group, heads, update, paint, previewRGB,
    get beamsOn() { return beamsOn; },
    setBeams(on) { beamsOn = !!on; beamMesh.visible = beamsOn && !!live.params; },
    get live() { return !!live.params; },
  };
}
