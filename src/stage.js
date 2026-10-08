// Concert stage, fully parametric. A config object drives everything:
//
//   {
//     position:    'far' | 'middle',
//     farSize:     'default' | 'large',          // deck front -20 / -13.6
//     middleShape: 'circle' | 'square',
//     catwalk:     'none' | 'standard' | 'long', // 14 m / 22 m runway
//     bstage:      'none' | 'circle' | 'x' | 'heart' | 'square',
//     cstage:      false | true,                 // small riser out in the crowd
//     floor:       'seat' | 'ga' | 'hybrid',     // chairs / standing / GA front + seats rear
//   }
//
// Heights: main deck 2.0 m · ramp 2.0 → 1.5 m · catwalk + B-stage 1.5 m.
// Every element (deck, runway, B-stage of any shape, C-stage, hybrid fence)
// carves a matching exclusion zone out of the floor crowd and gets barriers.
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { roundedRectPath, aisleU, BOWL_A, BOWL_B, BOWL_R } from './bowl.js';
import { SPEC } from './venue.js';
import {
  makeBarrierMesh, makeOrbDiscTexture,
  billboardInstanced, makeBStageIdle,
} from './textures.js';
import { makeUltraStageDeck, makeUltraStageSkirt } from './textures_ultra_stage.js';
import { boxTruss } from './truss.js';

// --- layout -----------------------------------------------------------------
export const MAIN_H = 2.0;        // main stage deck height
export const CAT_H = 1.5;         // catwalk + B-stage deck height
export const B_DIAM = 7.0;        // classic circular B-stage diameter
export const B_CENTER_X = SPEC.downstageX + 2.6 + SPEC.catStd;   // default-config B-stage centre: lip + ramp + standard runway
export const DOWNSTAGE_X = SPEC.downstageX; // default deck front (venue.js)
export const LARGE_FRONT_X = SPEC.largeFrontX; // 'large' far stage: 1.5x the default depth
export const ENDONLY_FRONT_X = LARGE_FRONT_X; // legacy alias
export const CENTRE_R = SPEC.centreR;      // middle circle stage radius
const MIDDLE_SQ = SPEC.middleSq;            // middle square stage half-side (15 m)
const RAMP_LEN = 2.6;             // ramp run from deck front to catwalk level
const CAT_STD = SPEC.catStd;             // standard catwalk length
const CAT_LONG = SPEC.catLong;            // long catwalk length
const CAT_W = 2.8;                // catwalk width
const WALL_GAP = 0.35;            // clearance from the bowl's front wall
const HYB_X = 8.0;                // hybrid floor: GA in front of this line
const HYB_R = 16.4;               // hybrid boundary radius for middle stages
// C-stage: a riser platform up in the 100s, directly behind FOH, planted
// between the seat rows (east end of the bowl, mid-tier).
// C-stage: a flat platform laid OVER the seats in the lower bowl, hugging an
// aisle stair, exactly as the reference photo has it. Not a riser and not a
// tarp: a table on top of 5 seats x 2 rows, so the seats stay under it and
// nothing is masked out of the bowl.
//
// Specified in seats and rows rather than metres, then resolved against the
// bowl's own aisle spacing, so it lands square on real seats in any room.
// Aisle 15 puts it in the lower bowl on the near side, right of centre as seen
// from behind the mix position, hugging the stair before the corner. That is
// the relationship the reference photo has. Aisle map, row 7, at this row's
// plan offset: 14 is (17.6,-22.6), 15 is (28,-21.7), 16 is (38.6,-12).
const CSTAGE_AISLE = 15;       // which aisle stair it hugs, counting round the bowl
const CSTAGE_ROW = 7;          // row of the 100s the platform sits on
const CSTAGE_SEATS = 5;        // seats across
const CSTAGE_ROWS = 2;         // rows deep
const CSTAGE_SIDE = 1;         // +1 hugs the stair on one side, -1 the other
const CSTAGE_CLEAR = 0.85;     // gap from the stair centreline to the deck edge
const SEAT_PITCH = 0.50;       // station pitch the bowl seats on
// Seat backs top out at pan 0.40 + backrest 0.52 = 0.92 above the tread, but a
// deck resting that high sits 0.59 m over the row behind it and main.js clamps
// a walkable step to MAX_STEP 0.55. Sinking it into the backrests by 10 cm
// keeps the resting-on-the-seats look AND lets you step up onto it.
const SEAT_TOP = 0.82;

// Resolve the aisle stair to a world point, then step out to the row. Aisles
// are spaced by equal arc length along the bowl path, and roundedRectPath
// samples by arc length too, so aisle k is simply a path index.
function cstageFrame() {
  const T = SPEC.bowl.tiers[0];
  const AISLES = SPEC.bowl.aisles;
  const SEGS = 256;
  const path = roundedRectPath(BOWL_A, BOWL_B, BOWL_R, SEGS);
  // aisleU carries the section ring's phase, so the stair this hangs off is
  // the same physical one whatever the level's section count is
  const p = path[Math.round(aisleU(AISLES, CSTAGE_AISLE) * SEGS) % SEGS];
  // plan offset of the row the platform's centre sits on
  const rowMid = CSTAGE_ROW + (CSTAGE_ROWS - 1) / 2;
  const off = T.o0 + rowMid * T.depth;
  // tangent along the row, so the platform can slide off the stair centreline
  const tx = -p.nz, tz = p.nx;
  const w = CSTAGE_SEATS * SEAT_PITCH;
  const shift = CSTAGE_SIDE * (w / 2 + CSTAGE_CLEAR);   // clear of the stair, hugging it
  const x = p.x + p.nx * off + tx * shift;
  const z = p.z + p.nz * off + tz * shift;
  // Yaw from the bowl normal at the DECK's own centre, not the aisle's. The
  // tangential shift walks it far enough round the curve that the aisle normal
  // left the deck visibly skewed against the seat rows underneath it.
  let bi = 0, bd = Infinity;
  for (let i = 0; i < SEGS; i++) {
    const q = path[i], qx = q.x + q.nx * off, qz = q.z + q.nz * off;
    const dd = (qx - x) * (qx - x) + (qz - z) * (qz - z);
    if (dd < bd) { bd = dd; bi = i; }
  }
  const n = path[bi];
  // level with the seat tops of the BACK row, so the deck rests on the highest
  // seats it covers and the rake falls away in front of it
  const tread = (r) => T.h0 - 0.35 + 0.12 + r * T.rise;
  return {
    x, z, w, d: CSTAGE_ROWS * T.depth,
    top: tread(CSTAGE_ROW + CSTAGE_ROWS - 1) + SEAT_TOP,
    treadFront: tread(CSTAGE_ROW),                      // local -z edge, lower
    treadBack: tread(CSTAGE_ROW + CSTAGE_ROWS),          // local +z edge, higher
    yaw: Math.atan2(n.nx, n.nz),
  };
}
export const CSTAGE_FRAME = cstageFrame();
// Is (x, z) inside the deck rectangle? rotation.y = t sends a local v to world
// (v.x*cos + v.z*sin, -v.x*sin + v.z*cos), so the inverse is the transpose
// below. The earlier version negated the angle instead, which is the FORWARD
// map: harmless on a square, but this deck is 2.5 x 1.64 so it skewed the
// walkable footprint away from the visible slab.
// `padX`/`padZ` grow the rectangle. Walking uses 0, the bare slab. The seat
// mask uses more, and NOT the same amount on both axes — see CSTAGE_MASK_PAD.
export function cstageLocal(x, z, padX = 0, padZ = padX) {
  const F = CSTAGE_FRAME;
  const dx = x - F.x, dz = z - F.z;
  const c = Math.cos(F.yaw), sn = Math.sin(F.yaw);
  const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
  return Math.abs(lx) <= F.w / 2 + padX && Math.abs(lz) <= F.d / 2 + padZ;
}
// Seat mask, and the two axes are not symmetric because the failure is not.
//
// A seat's CENTRE can sit outside the deck while the chair itself still runs
// under it — the shell is 0.48 m wide — and since a neighbour ACROSS the row
// shares the deck's own tread, its 0.92 m back then pokes up through the deck
// surface and reads as a random single seat standing in the platform. So x
// pads by half a seat: anything whose width overlaps the slab goes. The next
// station out is 0.5 m away, so nothing extra is caught.
//
// Along the rows there is no such failure: the neighbours front and back are a
// full riser lower, their backs top out well under the deck, and they are
// visible seats that should stay. z therefore pads by almost nothing. A
// symmetric 0.24 would have reached to within 1 cm of the row in front and
// swallowed five seats the moment the station phase drifted.
//
// Rows are stationed independently along their own arc, so the phase differs
// row to row: the previous flat 0.04 caught the case it was tuned against and
// missed this one by 7 cm once the aisle ring was re-spaced. Padding by the
// seat's real width instead of a tuned constant is what makes it stop moving.
export const CSTAGE_MASK_PAD = { x: 0.24, z: 0.06 };
export const CSTAGE_POS = { x: CSTAGE_FRAME.x, z: CSTAGE_FRAME.z };
const CSTAGE_TOP = CSTAGE_FRAME.top;

// --- crowd barrier (Mojo-style steel barricade) ------------------------------
const PANEL_W = 1.0;              // standard panel width
const PANEL_H = 1.1;              // top of the mesh panel
const FOOT_D = 0.7;               // footplate depth, on the crowd side
const TUBE = 0.045;               // frame tube section
const PIT = 1.3;                  // gap between deck edge and barrier line
const CHAMFER = 1.0;              // 45-degree corner cut at the stage front

// front-of-house pen at the far end of the floor: sound + light consoles
export const FOH_CX = SPEC.fohX;         // pen center, opposite the stage
const FOH_HD = 3.0;               // half depth (along x) -> 6 m
const FOH_HW = 4.0;               // half width (along z) -> 8 m
const FOH_CH = 0.7;               // corner chamfer

// --- config helpers -----------------------------------------------------------
export function normalizeStageCfg(c = {}) {
  // legacy layout strings from old saved projects
  if (typeof c === 'string') {
    c = c === 'centre' ? { position: 'middle' }
      : c === 'endonly' ? { farSize: 'large', catwalk: 'none', bstage: 'none' }
      : {};
  }
  return {
    curtains: ['full', 'large', 'medium', 'small', 'theatre', 'hemicycle'].includes(c.curtains) ? c.curtains : 'full',
    position: c.position === 'middle' ? 'middle' : 'far',
    farSize: ['large', 'huge'].includes(c.farSize) ? c.farSize : 'default',
    // 'sphere' only exists where the room has one (venue.js SPEC.sphere)
    middleShape: c.middleShape === 'square' ? 'square' : (c.middleShape === 'sphere' && SPEC.sphere) ? 'sphere' : 'circle',
    catwalk: ['none', 'standard', 'long'].includes(c.catwalk) ? c.catwalk : 'standard',
    bstage: ['none', 'circle', 'x', 'heart', 'square'].includes(c.bstage) ? c.bstage : 'circle',
    cstage: !!c.cstage,
    floor: ['seat', 'ga', 'hybrid', 'none'].includes(c.floor) ? c.floor : 'seat',
    // main screen shape: flat wall (far default), circle, heart, or the
    // in-the-round cylinder (middle only — main.js maps it per position)
    screen: ['wall', 'circle', 'heart', 'cyl'].includes(c.screen) ? c.screen : 'wall',
  };
}

// world positions derived from a config — one source of truth shared by the
// deck builder, the barrier sampler and the seating sweep
// curtain cut positions (x of the drape wall) and the deck fronts they force:
// the stage backs onto the drape and slides east as the room shrinks
export const CURTAIN_CUT = { full: null, large: -24, medium: -12, small: 5, theatre: 15, hemicycle: 21 };
const DECK_DEPTH = 12.8;          // drape-to-lip depth of the default deck
const CURTAIN_FRONT = { hemicycle: 27 };   // hemicycle wraps; others use DECK_DEPTH
// Walking-surface query: the deck top under (x,z) for this config, or
// -Infinity when the point is over bare floor. Decks are skirted to the
// ground, so the walker treats them as solid steps.
// Moving risers: main.js animates these toward the console targets and moves
// the matching groups; the walking system reads them so you RIDE the lift.
export const LIFTS = { a: 0, b: 0 };
const A_RISER = { dx: 4.5, hw: 3.5, hd: 2.5, h: 0.32 };   // platform on the main deck

// plan radius of a middle stage's deck — spawn points and exclusions key off it
export function middleRadius(cfgIn) {
  const cfg = normalizeStageCfg(cfgIn);
  if (cfg.middleShape === 'sphere') return SPEC.sphere.deckR;
  if (cfg.middleShape === 'square') return MIDDLE_SQ * Math.SQRT2;
  return CENTRE_R;
}
// solid volumes the walker can never enter (the ground query returns a wall)
export function stageBlocks(cfgIn, x, z) {
  const cfg = normalizeStageCfg(cfgIn);
  return false;   // the globe is walkable now (stageSurfaceY), nothing blocks
}

export function stageSurfaceY(cfgIn, x, z) {
  const cfg = normalizeStageCfg(cfgIn);
  const d = derive(cfg);
  const halfW = BOWL_B - WALL_GAP;
  if (cfg.position === 'middle') {
    if (cfg.middleShape === 'sphere') {
      // the dome IS the stage: walk up it (the ground query climbs with you),
      // the deck ring around it, and a ramp on the +x side up from the floor
      const S = SPEC.sphere, r = Math.hypot(x, z);
      const cy = CAT_H + S.cap - S.R;
      if (r < S.R) {
        const h = cy + Math.sqrt(Math.max(0, S.R * S.R - r * r));
        if (h >= CAT_H) return h + LIFTS.b;
      }
      if (r <= S.deckR) return CAT_H + LIFTS.b;
      if (Math.abs(z) <= 3 && x > S.deckR && x <= S.deckR + 6) return CAT_H * (1 - (x - S.deckR) / 6) + LIFTS.b;   // ramp
      return -Infinity;
    }
    const on = cfg.middleShape === 'square'
      ? Math.max(Math.abs(x), Math.abs(z)) <= MIDDLE_SQ
      : Math.hypot(x, z) <= CENTRE_R;
    return on ? CAT_H + LIFTS.b : -Infinity;
  }
  let top = -Infinity;
  const cut = CURTAIN_CUT[cfg.curtains];
  const backX = cut != null ? cut + 0.25 : -Infinity;
  if (cfg.curtains === 'hemicycle') {
    // signed distance to the deck's curved front (mirror of buildMainDeck)
    const GAP = 4.6;
    const a = BOWL_A - WALL_GAP - GAP, b = halfW - GAP * 0.55, r = Math.max(0.5, BOWL_R - WALL_GAP - GAP);
    const qx = Math.abs(x) - (a - r), qz = Math.abs(z) - (b - r);
    const off = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
    if (x >= backX && off <= 0) top = MAIN_H;
    return top;
  }
  if (x <= d.frontX && x >= backX && Math.abs(z) <= halfW) top = MAIN_H;
  if (d.hasCat && Math.abs(z) <= CAT_W / 2) {
    if (x > d.frontX && x <= d.rampEnd) top = Math.max(top, MAIN_H + ((x - d.frontX) / RAMP_LEN) * (CAT_H - MAIN_H));
    else if (x > d.rampEnd && x <= d.bX) top = Math.max(top, CAT_H);
  }
  if (d.hasB && Math.hypot(x - d.bX, z) <= d.bBound) top = Math.max(top, CAT_H + LIFTS.b);
  if (Math.abs(x - (d.frontX - A_RISER.dx)) <= A_RISER.hw && Math.abs(z) <= A_RISER.hd
      && x >= backX) {
    top = Math.max(top, MAIN_H + A_RISER.h + LIFTS.a);
  }
  // the deck is yawed to the rows, so test in ITS frame rather than world axes
  if (cfg.cstage && cstageLocal(x, z)) top = Math.max(top, CSTAGE_TOP + 0.09);
  return top;
}

export function deriveStage(cfg) { return derive(cfg); }
function derive(cfg) {
  // curtained rooms pin the deck to the drape; 'large' still buys a deeper
  // deck by pushing the front edge toward the crowd
  const cut = CURTAIN_CUT[cfg.curtains];
  const curtF = CURTAIN_FRONT[cfg.curtains]
    ?? (cut != null ? cut + 0.25 + DECK_DEPTH + (cfg.farSize === 'large' ? 3.5 : 0) : undefined);
  const frontX = curtF !== undefined
    ? curtF
    : (cfg.farSize === 'huge' ? SPEC.hugeFrontX
      : cfg.farSize === 'large' ? LARGE_FRONT_X : DOWNSTAGE_X);
  const rampEnd = frontX + RAMP_LEN;
  const catLen = cfg.catwalk === 'long' ? CAT_LONG : CAT_STD;
  const hasCat = cfg.position === 'far' && cfg.catwalk !== 'none';
  const hasB = cfg.position === 'far' && cfg.bstage !== 'none';
  // with a runway the B-stage sits at its end; a satellite (no runway) parks
  // where the standard runway would have put it
  const bX = hasCat ? rampEnd + catLen : frontX + RAMP_LEN + CAT_STD;
  const bBound = hasB ? B_SHAPES[cfg.bstage]().boundR : 0;
  return { frontX, rampEnd, catLen, hasCat, hasB, bX, bBound };
}

// --- B-stage shape library -----------------------------------------------------
// Each entry returns { shape, boundR }: a THREE.Shape in local XY (shape +y =
// world -z) plus its outermost radius, used for barriers and exclusions.
const B_SHAPES = {
  circle: () => {
    const s = new THREE.Shape();
    s.absarc(0, 0, B_DIAM / 2, 0, Math.PI * 2);
    return { shape: s, boundR: B_DIAM / 2 };
  },
  square: () => {
    const h = 3.2, r = 0.4;
    const s = new THREE.Shape();
    s.moveTo(-h + r, -h);
    s.lineTo(h - r, -h); s.absarc(h - r, -h + r, r, -Math.PI / 2, 0);
    s.lineTo(h, h - r); s.absarc(h - r, h - r, r, 0, Math.PI / 2);
    s.lineTo(-h + r, h); s.absarc(-h + r, h - r, r, Math.PI / 2, Math.PI);
    s.lineTo(-h, -h + r); s.absarc(-h + r, -h + r, r, Math.PI, Math.PI * 1.5);
    return { shape: s, boundR: Math.hypot(h, h) };
  },
  x: () => {
    // a plus sign rotated 45 degrees
    const a = 3.9, w = 1.2, rot = Math.PI / 4;
    const pts = [
      [w, w], [w, a], [-w, a], [-w, w], [-a, w], [-a, -w],
      [-w, -w], [-w, -a], [w, -a], [w, -w], [a, -w], [a, w],
    ].map(([x, y]) => [
      x * Math.cos(rot) - y * Math.sin(rot),
      x * Math.sin(rot) + y * Math.cos(rot),
    ]);
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    return { shape: s, boundR: Math.hypot(a, w) };
  },
  heart: () => {
    // classic parametric heart, scaled to ~8 m across, tip toward +x (FOH)
    const s = new THREE.Shape();
    const k = 0.24;
    const pt = (t) => {
      const hx = 16 * Math.sin(t) ** 3;
      const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      // rotate +90°: the tip (originally -y) points to +x
      return [-(hy - 2) * k, hx * k];
    };
    const [x0, y0] = pt(0);
    s.moveTo(x0, y0);
    for (let i = 1; i <= 64; i++) {
      const [x, y] = pt((i / 64) * Math.PI * 2);
      s.lineTo(x, y);
    }
    s.closePath();
    return { shape: s, boundR: 4.15 };
  },
};

// One panel, local space: width along X, footplate + braces toward +Z.
function barrierPanelGeos() {
  const geos = [];
  const box = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    geos.push(g);
  };
  for (const x of [-(PANEL_W / 2 - TUBE / 2), PANEL_W / 2 - TUBE / 2]) {
    box(TUBE, PANEL_H, TUBE, x, PANEL_H / 2, 0);
  }
  for (const x of [-0.16, 0.16]) box(TUBE * 0.7, PANEL_H - 0.11, TUBE * 0.7, x, PANEL_H / 2, 0);
  box(PANEL_W, TUBE, TUBE, 0, PANEL_H - TUBE / 2, 0);
  box(PANEL_W - TUBE * 2, TUBE * 0.8, TUBE * 0.8, 0, 0.56, 0);
  box(PANEL_W - TUBE * 2, TUBE * 0.8, TUBE * 0.8, 0, 0.055, 0);
  box(PANEL_W, 0.022, FOOT_D, 0, 0.011, FOOT_D / 2);
  for (const x of [-(PANEL_W / 2 - 0.015), PANEL_W / 2 - 0.015]) {
    box(0.03, 0.035, FOOT_D, x, 0.03, FOOT_D / 2);
  }
  box(PANEL_W, 0.035, 0.03, 0, 0.03, FOOT_D - 0.015);
  box(0.62, 0.02, 0.3, 0, 0.5, 0.17);
  const ay = PANEL_H - 0.06, az = 0.02, by = 0.04, bz = FOOT_D - 0.1;
  const len = Math.hypot(ay - by, bz - az);
  for (const x of [-0.3, 0.3]) {
    const g = new THREE.BoxGeometry(TUBE * 0.8, len, TUBE * 0.8);
    g.rotateX(-Math.atan2(bz - az, ay - by));
    g.translate(x, (ay + by) / 2, (az + bz) / 2);
    geos.push(g);
  }
  const meshGeo = new THREE.PlaneGeometry(PANEL_W - TUBE * 2, 0.977);
  meshGeo.translate(0, 0.566, 0);
  return { frame: BufferGeometryUtils.mergeGeometries(geos), mesh: meshGeo };
}

// Walk a list of segments, dropping a panel every PANEL_W of arc length.
function sampleSegments(segs) {
  const out = [];
  for (const seg of segs) {
    if (seg.line) {
      const [[x0, z0], [x1, z1]] = seg.line;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const count = Math.max(1, Math.round(len / PANEL_W));
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        out.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, nx: seg.n[0], nz: seg.n[1] });
      }
    } else {
      const [s0, s1] = seg.arc;
      const [cx, cz] = seg.c;
      const count = Math.max(1, Math.round((Math.abs(s0 - s1) * seg.r) / PANEL_W));
      for (let i = 0; i < count; i++) {
        const a = s0 + (s1 - s0) * ((i + 0.5) / count);
        out.push({
          x: cx + Math.cos(a) * seg.r, z: cz + Math.sin(a) * seg.r,
          nx: Math.cos(a), nz: Math.sin(a),
        });
      }
    }
  }
  return out;
}

function fohSamples() {
  const S2 = Math.SQRT1_2;
  const x0 = FOH_CX - FOH_HD, x1 = FOH_CX + FOH_HD;
  const z0 = -FOH_HW, z1 = FOH_HW;
  const c = FOH_CH;
  return sampleSegments([
    { line: [[x0, z1 - c], [x0, z0 + c]], n: [-1, 0] },
    { line: [[x0, z0 + c], [x0 + c, z0]], n: [-S2, -S2] },
    { line: [[x0 + c, z0], [x1 - c, z0]], n: [0, -1] },
    { line: [[x1 - c, z0], [x1, z0 + c]], n: [S2, -S2] },
    { line: [[x1, z0 + c], [x1, z1 - c]], n: [1, 0] },
    { line: [[x1, z1 - c], [x1 - c, z1]], n: [S2, S2] },
    { line: [[x1 - c, z1], [x0 + c, z1]], n: [0, 1] },
    { line: [[x0 + c, z1], [x0, z1 - c]], n: [-S2, S2] },
  ]);
}

// closed square pen with chamfered corners, centred at origin
function squareRingSegments(h, c) {
  const S2 = Math.SQRT1_2;
  return [
    { line: [[h, h - c], [h, -h + c]], n: [1, 0] },
    { line: [[h, -h + c], [h - c, -h]], n: [S2, -S2] },
    { line: [[h - c, -h], [-h + c, -h]], n: [0, -1] },
    { line: [[-h + c, -h], [-h, -h + c]], n: [-S2, -S2] },
    { line: [[-h, -h + c], [-h, h - c]], n: [-1, 0] },
    { line: [[-h, h - c], [-h + c, h]], n: [-S2, S2] },
    { line: [[-h + c, h], [h - c, h]], n: [0, 1] },
    { line: [[h - c, h], [h, h - c]], n: [S2, S2] },
  ];
}

// Barrier centreline for the whole configuration.
function barrierSamples(cfg) {
  const d = derive(cfg);
  const halfW = BOWL_B - WALL_GAP;
  const S2 = Math.SQRT1_2;
  const segs = [];

  if (cfg.position === 'middle') {
    if (cfg.middleShape === 'square') segs.push(...squareRingSegments(MIDDLE_SQ + PIT, CHAMFER));
    else segs.push({ arc: [0, Math.PI * 2], r: (cfg.middleShape === 'sphere' ? SPEC.sphere.deckR : CENTRE_R) + PIT, c: [0, 0] });
  } else {
    const bx = d.frontX + PIT;
    const catZ = CAT_W / 2 + PIT;
    if (d.hasCat) {
      if (d.hasB) {
        // flanks run until they meet the ring around the B-stage
        const br = d.bBound + PIT;
        const dx = Math.sqrt(Math.max(br * br - catZ * catZ, 0.01));
        const ix = d.bX - dx;
        const a0 = Math.atan2(catZ, ix - d.bX);
        segs.push(
          { line: [[bx, halfW], [bx, catZ + CHAMFER]], n: [1, 0] },
          { line: [[bx, catZ + CHAMFER], [bx + CHAMFER, catZ]], n: [S2, S2] },
          { line: [[bx + CHAMFER, catZ], [ix, catZ]], n: [0, 1] },
          { arc: [a0, -a0], r: br, c: [d.bX, 0] },
          { line: [[ix, -catZ], [bx + CHAMFER, -catZ]], n: [0, -1] },
          { line: [[bx + CHAMFER, -catZ], [bx, -catZ - CHAMFER]], n: [S2, -S2] },
          { line: [[bx, -catZ - CHAMFER], [bx, -halfW]], n: [1, 0] },
        );
      } else {
        // a thrust with no B-stage: flanks plus a straight cap at the end
        const capX = d.bX + PIT;
        segs.push(
          { line: [[bx, halfW], [bx, catZ + CHAMFER]], n: [1, 0] },
          { line: [[bx, catZ + CHAMFER], [bx + CHAMFER, catZ]], n: [S2, S2] },
          { line: [[bx + CHAMFER, catZ], [capX, catZ]], n: [0, 1] },
          { line: [[capX, catZ], [capX, -catZ]], n: [1, 0] },
          { line: [[capX, -catZ], [bx + CHAMFER, -catZ]], n: [0, -1] },
          { line: [[bx + CHAMFER, -catZ], [bx, -catZ - CHAMFER]], n: [S2, -S2] },
          { line: [[bx, -catZ - CHAMFER], [bx, -halfW]], n: [1, 0] },
        );
      }
    } else {
      // straight run across the deck front
      segs.push({ line: [[bx, halfW], [bx, -halfW]], n: [1, 0] });
      if (d.hasB) {
        // satellite stage: its own free-standing ring
        segs.push({ arc: [0, Math.PI * 2], r: d.bBound + PIT, c: [d.bX, 0] });
      }
    }

  }

  let spots = sampleSegments(segs);

  // hybrid floor: a fence line between the GA pit and the seated rear
  if (cfg.floor === 'hybrid') {
    const fence = cfg.position === 'middle'
      ? sampleSegments([{ arc: [0, Math.PI * 2], r: HYB_R + 0.55, c: [0, 0] }])
      : sampleSegments([{ line: [[HYB_X, halfW - 1.2], [HYB_X, -(halfW - 1.2)]], n: [1, 0] }]);
    // drop fence panels that would land inside another structure's zone
    const keep = fence.filter((p) => {
      if (Math.abs(p.x - FOH_CX) < FOH_HD + 1 && Math.abs(p.z) < FOH_HW + 1) return false;
      if (cfg.position === 'far') {
        if (d.hasB && Math.hypot(p.x - d.bX, p.z) < d.bBound + PIT + 0.8) return false;
        if (d.hasCat && Math.abs(p.z) < CAT_W / 2 + PIT + 0.8 && p.x < d.bX + PIT + 1) return false;
      }
      return true;
    });
    spots = spots.concat(keep);
  }
  return spots;
}

// ---------------------------------------------------------------------------
// Concert floor: chairs, GA standing room, or a hybrid of the two. A grid is
// swept over the whole floor; each candidate is rejected inside any exclusion
// zone, then assigned a zone (seat / ga) by the floor mode.
// ---------------------------------------------------------------------------
export function buildConcertSeating(scene, cfgIn = {}) {
  const cfg = normalizeStageCfg(cfgIn);
  const d = derive(cfg);
  const CLEAR = 1.0;
  const ROW_PITCH = 0.9;
  const SEAT_PITCH = 0.56;
  const WALL_INSET = 1.5;
  const aisleX = [-9.4, 2.6, 14.6];
  const aisleZ = 9.9;

  const insideFloor = (x, z) => {
    const a = BOWL_A - WALL_INSET, b = BOWL_B - WALL_INSET, r = Math.max(0.1, BOWL_R - WALL_INSET);
    const dx = Math.max(Math.abs(x) - (a - r), 0);
    const dz = Math.max(Math.abs(z) - (b - r), 0);
    return Math.hypot(dx, dz) <= r;
  };

  const blocked = (x, z) => {
    if (!['theatre', 'hemicycle'].includes(cfg.curtains)
      && Math.abs(x - FOH_CX) < FOH_HD + CLEAR && Math.abs(z) < FOH_HW + CLEAR) return true;
    if (cfg.position === 'middle') {
      if (cfg.middleShape === 'square') {
        return Math.max(Math.abs(x), Math.abs(z)) < MIDDLE_SQ + PIT + CLEAR;
      }
      return Math.hypot(x, z) < (cfg.middleShape === 'sphere' ? SPEC.sphere.deckR : CENTRE_R) + PIT + CLEAR;
    }
    if (x < d.frontX + PIT + CLEAR) return true;
    if (d.hasCat && Math.abs(z) < CAT_W / 2 + PIT + CLEAR
      && x < (d.hasB ? d.bX + 0.6 : d.bX + PIT + CLEAR)) return true;
    if (d.hasB && Math.hypot(x - d.bX, z) < d.bBound + PIT + CLEAR) return true;
    return false;
  };

  // hybrid boundary: GA on the stage side, chairs on the FOH side, with a gap
  // where the fence runs
  const zoneOf = (x, z) => {
    if (cfg.floor === 'none') return null;
    if (cfg.floor === 'ga') return 'ga';
    if (cfg.floor === 'seat') return 'seat';
    if (cfg.position === 'middle') {
      const r = Math.hypot(x, z);
      if (r < HYB_R - 0.4) return 'ga';
      if (r > HYB_R + 1.5) return 'seat';
      return null;
    }
    if (x < HYB_X - 0.7) return 'ga';
    if (x > HYB_X + 1.5) return 'seat';
    return null;
  };

  const spots = [];
  const startX = cfg.position === 'middle' ? -(BOWL_A - WALL_INSET) : d.frontX + PIT + CLEAR;
  // A festival field (venue.js) has no aisles cut through its crowd, leaves
  // room round its delay towers, and thins out from the barrier to the back,
  // where people stand loose rather than packed. Nobody stands on a grid
  // there, so each person is nudged off it.
  const aisles = SPEC.gaAisles !== false, holes = SPEC.crowdHoles || [];
  const fest = !!SPEC.gaFalloff;
  const rnd = (x, z, k) => { const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };
  const dense = (x) => 1 - 0.72 * Math.min(1, Math.max(0, (x - startX) / Math.max(1, BOWL_A - startX))) ** 0.8;
  for (let x = startX; x <= BOWL_A; x += ROW_PITCH) {
    if (aisles && aisleX.some((ax) => Math.abs(x - ax) < 0.95)) continue;
    for (let z = -BOWL_B; z <= BOWL_B; z += SEAT_PITCH) {
      if (aisles && Math.abs(Math.abs(z) - aisleZ) < 0.62) continue;
      if (holes.some(([hx, hz]) => Math.abs(x - hx) < 2.8 && Math.abs(z - hz) < 2.8)) continue;
      if (fest && rnd(x, z, 0) > dense(x)) continue;
      if (blocked(x, z) || !insideFloor(x, z)) continue;
      const zone = zoneOf(x, z);
      if (!zone) continue;
      if (fest) spots.push({ x: x + (rnd(x, z, 1) - 0.5) * 0.5, z: z + (rnd(x, z, 2) - 0.5) * 0.3, zone });
      else spots.push({ x, z, zone });
    }
  }

  // Trim slivers. A seat needs a neighbour in one of the rows either side of
  // it at roughly the same depth; without that it is a one-row-wide spur, and
  // the floor grid produces those wherever an aisle runs alongside a blocked
  // zone. The x = 1.2 row is the case that showed: the aisle at 2.6 cuts it off
  // on one side, the B-stage clearance eats everything below it on the other,
  // and its last two seats poked out alone beside the B-stage — reading, with
  // their lit wristbands, as a random orb floating next to the deck.
  //
  // Repeated to a fixed point, because removing a spur's outer seat orphans the
  // one behind it — a taper has to be peeled, not shaved once. This cannot eat
  // into a real block: an edge seat still has the row inboard of it, and any
  // seat with a neighbour keeps that neighbour's support in turn, so only
  // genuinely unsupported seats go. Capped anyway, and the count is asserted
  // below so a future layout change cannot quietly gut the floor.
  const before = spots.length;
  for (let pass = 0; pass < (fest ? 0 : 6); pass++) {   // a thinned crowd is loose on purpose
    const cell = new Set();
    const ki = (xi, zi) => `${xi}|${zi}`;
    for (const s of spots) cell.add(ki(Math.round(s.x / ROW_PITCH), Math.round(s.z / SEAT_PITCH)));
    const keep = spots.filter((s) => {
      const xi = Math.round(s.x / ROW_PITCH), zi = Math.round(s.z / SEAT_PITCH);
      for (const dx of [-1, 1]) for (const dz of [-1, 0, 1]) if (cell.has(ki(xi + dx, zi + dz))) return true;
      return false;
    });
    if (keep.length === spots.length) break;
    spots.length = 0;
    spots.push(...keep);
  }
  if (before && spots.length < before * 0.9) {
    console.warn(`concert floor: sliver trim removed ${before - spots.length} of ${before} seats — check the layout`);
  }

  const group = new THREE.Group();
  const dummy = new THREE.Object3D();
  const yawFor = cfg.position === 'middle'
    ? (sp) => Math.atan2(-sp.x, -sp.z)
    : () => -Math.PI / 2;

  // chairs only where people sit
  const seatSpots = spots.filter((s) => s.zone === 'seat');
  let chairs = null;      // exposed so the venue seat-colour picker can tint it
  if (seatSpots.length) {
    const geos = [];
    const put = (w, h, dd, px, py, pz) => {
      const g = new THREE.BoxGeometry(w, h, dd);
      g.translate(px, py, pz);
      geos.push(g);
    };
    put(0.5, 0.09, 0.48, 0, 0.44, 0);
    put(0.5, 0.46, 0.075, 0, 0.68, -0.22);
    for (const lx of [-0.21, 0.21]) for (const lz of [-0.19, 0.19]) put(0.035, 0.44, 0.035, lx, 0.22, lz);
    chairs = new THREE.InstancedMesh(
      BufferGeometryUtils.mergeGeometries(geos),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      seatSpots.length
    );
    // same crimson (and the same per-seat variation) as the bowl's shells, so
    // the floor reads as part of the house and the colour picker moves both
    const chairCol = new THREE.Color();
    seatSpots.forEach((s, i) => {
      dummy.position.set(s.x, 0, s.z);
      dummy.rotation.set(0, yawFor(s), 0);
      dummy.updateMatrix();
      chairs.setMatrixAt(i, dummy.matrix);
      chairCol.setHex(0x8a1220).multiplyScalar(0.8 + ((i * 7) % 4) * 0.08);
      chairs.setColorAt(i, chairCol);
    });
    chairs.receiveShadow = true;
    group.add(chairs);
  }

  // one orb per person, seated or standing — a standing hand holds it higher
  const n = spots.length;
  const orbMat = new THREE.MeshBasicMaterial({
    color: 0x000000, map: makeOrbDiscTexture(), alphaTest: 0.45, fog: false,
  });
  billboardInstanced(orbMat, { waveMute: 1 });   // concert floor sits the wave out, like its crowd
  const orbs = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.246, 0.246), orbMat, Math.max(n, 1));
  const orbPos = new Float32Array(Math.max(n, 1) * 3);
  spots.forEach((s, i) => {
    const oy = s.zone === 'ga' ? 1.12 : 0.82;
    dummy.position.set(s.x, oy, s.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    orbs.setMatrixAt(i, dummy.matrix);
    orbPos[i * 3] = s.x; orbPos[i * 3 + 1] = oy; orbPos[i * 3 + 2] = s.z;
  });
  if (n === 0) orbs.visible = false;   // empty floor: no phantom orb at origin
  group.add(orbs);

  // per-zone crowd-sprite blocks: seated figures drop 0.82 under their orb,
  // standing GA figures drop the full 1.12 so their feet reach the floor
  const crowdBlocks = [];
  for (const [zone, drop] of [['seat', 0.82], ['ga', 1.12]]) {
    const zs = spots.filter((s) => s.zone === zone);
    if (!zs.length) continue;
    const pos = new Float32Array(zs.length * 3);
    zs.forEach((s, i) => {
      pos[i * 3] = s.x;
      pos[i * 3 + 1] = zone === 'ga' ? 1.12 : 0.82;
      pos[i * 3 + 2] = s.z;
    });
    crowdBlocks.push({ pos, drop, standing: zone === 'ga' });
  }

  scene.add(group);
  return { group, orbs, orbPos, seatCount: n, crowdBlocks, chairs };
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// The giant video sphere: a 40 m LED globe sunk into the round deck, a thin
// atmosphere shell for the planet looks, and a 52 m video halo hung over it
// from four lattice masts (the room has no roof to hang it from). The globe
// and halo are screens — main.js hands them the routed content and the look.
// ---------------------------------------------------------------------------
function buildGiantSphere(group) {
  const S = SPEC.sphere;
  const cy = CAT_H + S.cap - S.R;          // centre below the deck: only the top third shows
  // --- the globe: LED skin (maps) or the pattern shader, swapped by main.js ---
  const sphereMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const patternMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uMode: { value: 1 },
      uColorA: { value: new THREE.Color(0x2fb8ff) }, uColorB: { value: new THREE.Color(0xff2f6e) },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN;
      void main() { vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN;
      uniform float uTime; uniform int uMode; uniform vec3 uColorA; uniform vec3 uColorB;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      vec3 hsv(float h, float s, float v) { vec3 c = clamp(abs(mod(h * 6.0 + vec3(0, 4, 2), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), c, s); }
      void main() {
        // seamless in u: longitude is periodic, so everything uses sin/cos of it
        float u = vUv.x, v = vUv.y, t = uTime;
        vec2 p = vec2(cos(u * 6.2832), sin(u * 6.2832));
        vec3 col = vec3(0.0);
        if (uMode == 1) {                 // plasma: rolling colour fields in the rig colours
          float n = fbm(vec2(p.x * 2.0 + t * 0.15, v * 4.0 + p.y * 2.0 - t * 0.1));
          float m = fbm(vec2(p.y * 3.0 - t * 0.12, v * 3.0 + t * 0.08));
          col = mix(uColorA, uColorB, smoothstep(0.35, 0.65, n)) * (0.6 + 0.9 * m);
        } else if (uMode == 2) {          // candy spiral: rainbow bands twisting up the globe
          float band = fract(u * 8.0 + v * 6.0 - t * 0.35);
          float edge = smoothstep(0.02, 0.1, band) * smoothstep(0.02, 0.1, 1.0 - band);
          col = hsv(fract(u * 2.0 + v + t * 0.05), 0.85, 1.0) * (0.35 + 0.65 * edge);
        } else if (uMode == 3) {          // disco: mirror facets flashing with a moving highlight
          vec2 cell = floor(vec2(u * 64.0, v * 32.0));
          float h = hash(cell);
          float flash = pow(0.5 + 0.5 * sin(t * (3.0 + h * 5.0) + h * 40.0), 12.0);
          vec2 f = fract(vec2(u * 64.0, v * 32.0));
          float grout = smoothstep(0.0, 0.08, f.x) * smoothstep(0.0, 0.08, f.y) * smoothstep(0.0, 0.08, 1.0 - f.x) * smoothstep(0.0, 0.08, 1.0 - f.y);
          col = (vec3(0.55, 0.6, 0.7) * (0.35 + 0.65 * h) + flash * 2.5 * hsv(h, 0.3, 1.0)) * grout;
        } else if (uMode == 4) {          // lava: black crust over glowing cracks
          float n = fbm(vec2(p.x * 3.0, v * 5.0 + p.y * 3.0) + t * 0.05);
          float cracks = smoothstep(0.42, 0.5, n) - smoothstep(0.5, 0.58, n);
          float pool = smoothstep(0.62, 0.8, fbm(vec2(p.y * 2.0 - t * 0.04, v * 3.0)));
          col = vec3(0.05, 0.02, 0.02) + cracks * vec3(2.2, 0.7, 0.1) + pool * vec3(1.6, 0.45, 0.05);
        } else if (uMode == 5) {          // ripples: rings of light pulsing from the poles
          float d = abs(v - 0.5) * 2.0;
          float r = sin(d * 30.0 - t * 2.5) * 0.5 + 0.5;
          float r2 = sin(u * 6.2832 * 6.0 + t * 1.5) * 0.5 + 0.5;
          col = mix(uColorB, uColorA, r) * (0.25 + pow(r, 4.0) * 1.4) + vec3(1.0) * pow(r2 * r, 8.0);
        } else if (uMode == 6) {          // matrix: falling glyph rain on a dark globe
          vec2 g = vec2(u * 96.0, v * 48.0);
          float colId = floor(g.x);
          float speed = 4.0 + hash(vec2(colId, 1.0)) * 6.0;
          float head = fract(hash(vec2(colId, 2.0)) - t * speed * 0.03) * 48.0;
          float dy = mod(head - g.y + 48.0, 48.0);
          float trail = exp(-dy * 0.25) * step(0.15, hash(floor(g) + floor(t * 8.0) * 0.01));
          col = vec3(0.1, 1.0, 0.35) * trail * 1.6 + vec3(0.6, 1.0, 0.8) * step(dy, 0.9);
        } else if (uMode == 7) {          // neon grid: glowing lat/long wireframe drifting
          vec2 g = fract(vec2(u * 24.0 + t * 0.1, v * 12.0));
          float line = smoothstep(0.0, 0.06, abs(g.x - 0.5) * 2.0 - 0.94) + smoothstep(0.0, 0.06, abs(g.y - 0.5) * 2.0 - 0.94);
          line = min(1.0, line);
          col = mix(vec3(0.02, 0.0, 0.06), uColorA * 1.8, line) + uColorB * 0.35 * pow(0.5 + 0.5 * sin(v * 20.0 - t * 2.0), 6.0);
        } else if (uMode == 8) {          // nebula: deep-space clouds with hot cores and stars
          float n1 = fbm(vec2(p.x * 2.5 + t * 0.03, v * 4.0 + p.y * 2.5));
          float n2 = fbm(vec2(p.y * 3.5 - t * 0.02, v * 2.0 + p.x * 1.5 + 7.0));
          col = vec3(0.35, 0.1, 0.6) * n1 * 1.4 + vec3(0.9, 0.3, 0.5) * pow(n2, 3.0) * 2.0 + vec3(0.2, 0.5, 1.0) * pow(n1 * n2, 2.0) * 3.0;
          col += vec3(1.0) * step(0.985, hash(floor(vec2(u * 400.0, v * 200.0)))) * 0.9;
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(S.R, 160, 96), sphereMat);
  sphere.position.set(0, cy, 0);
  sphere.castShadow = true;
  group.add(sphere);
  // atmosphere: additive fresnel shell, tinted per look
  const atmoMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: { uColor: { value: new THREE.Color(0x4f8fff) }, uGain: { value: 1.0 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; uniform vec3 uColor; uniform float uGain;
      void main() {
        float f = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 3.2);
        gl_FragColor = vec4(uColor * f * 1.2 * uGain, f * 0.9);
      }`,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(S.R * 1.03, 96, 64), atmoMat);
  atmo.position.copy(sphere.position);
  atmo.visible = false;
  group.add(atmo);
  // the lit collar where the dome meets the deck (the reference's white ring)
  const baseR = Math.sqrt(Math.max(0, S.R * S.R - (CAT_H - cy) * (CAT_H - cy)));
  const collarMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  collarMat.color.setRGB(1.5, 1.45, 1.35);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(baseR + 0.25, 0.14, 8, 192), collarMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, CAT_H + 0.08, 0);
  group.add(collar);
  // ramp up onto the deck from the floor, +x side (the walker's way up)
  {
    const rampMat = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.85 });
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.16, 6), rampMat);
    ramp.position.set(S.deckR + 3, CAT_H / 2, 0);
    ramp.rotation.z = Math.atan2(CAT_H, 6);
    group.add(ramp);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.7 });
    for (const sz of [-3.05, 3.05]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 6.3, 8), railMat);
      rail.position.set(S.deckR + 3, CAT_H / 2 + 1.0, sz);
      rail.rotation.z = Math.PI / 2 + Math.atan2(CAT_H, 6);
      group.add(rail);
    }
  }
  // --- the halo: an open cylinder of LED wrapped four times round with the
  // routed content; dark framing rings top and bottom
  const H = S.halo;
  const haloGeo = new THREE.CylinderGeometry(H.r, H.r, H.h, 160, 1, true);
  const uv = haloGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 4);
  const haloMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0c });   // main.js swaps in the wall material
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.set(0, H.y0 + H.h / 2, 0);
  group.add(halo);
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x15171b });
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(H.r - 0.4, H.r - 0.4, H.h, 96, 1, true), new THREE.MeshLambertMaterial({ color: 0x0b0c0f, side: THREE.BackSide }));
  inner.position.copy(halo.position);
  group.add(inner);
  for (const y of [H.y0, H.y0 + H.h]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(H.r, 0.45, 10, 160), frameMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, y, 0);
    group.add(rim);
  }
  // --- structure: four lattice masts, a truss compression ring at gridY, a
  // spider of deep spokes to a hub (the chain motors of the ring rig fly from
  // this grid), hangers to the halo. Sized for what it carries: a 60 m halo,
  // three ring trusses and ~600 fixtures — masts of 2.6 m lattice on ballast,
  // rigid struts to the ring, three guys each, 100 mm chords throughout.
  const steel = new THREE.MeshLambertMaterial({ color: 0x4a4f58, emissive: 0x14161b });
  const ballastMat = new THREE.MeshLambertMaterial({ color: 0x7d7a72 });
  const geos = [], ballast = [], beacons = [];
  const cableBetween = (x0, y0, z0, x1, y1, z1, r) => {
    const d = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const g = new THREE.CylinderGeometry(r, r, d, 6);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize()));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return g;
  };
  // a box truss laid between two points (the strut version of cableBetween)
  const trussBetween = (x0, y0, z0, x1, y1, z1, section, tube) => {
    const d = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const g = boxTruss(d, section, Math.max(1, section), tube);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize()));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return g;
  };
  // a polygon of straight box-truss chords (a real circle truss is bolted flats)
  const ringTruss = (r, y, section, segs, tube) => {
    const step = (Math.PI * 2) / segs, chord = 2 * r * Math.sin(step / 2);
    for (let i = 0; i < segs; i++) {
      const a = step * (i + 0.5);
      const g = boxTruss(chord * 1.02, section, Math.max(1, section), tube);
      g.translate(0, y, 0);
      g.rotateY(-(a + Math.PI / 2));
      g.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
      geos.push(g);
    }
  };
  const GY = S.gridY, ringR = 36;
  const MAST_W = 2.6;
  // four masts on the diagonals: nothing stands in the sightline from the
  // sideline or goal-end seats to the globe
  for (let i = 0; i < 4; i++) {
    const a = 0.62 + i * Math.PI / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const mx = ca * S.mastR, mz = sa * S.mastR;
    const mast = boxTruss(S.mastY, MAST_W, 2.6, 2.6);
    mast.rotateZ(Math.PI / 2);
    mast.translate(mx, S.mastY / 2, mz);
    geos.push(mast);
    // head frame the strut and guys bear on, and the red aviation beacon on top
    const cap = new THREE.BoxGeometry(MAST_W + 0.8, 0.7, MAST_W + 0.8); cap.translate(mx, S.mastY + 0.35, mz); geos.push(cap);
    const bcn = new THREE.SphereGeometry(0.28, 10, 8); bcn.translate(mx, S.mastY + 1.1, mz); beacons.push(bcn);
    const bpost = new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6); bpost.translate(mx, S.mastY + 0.7, mz); geos.push(bpost);
    // base: a steel grillage on stacked concrete ballast blocks, plus four
    // outrigger legs splayed to the ground — the footprint that says it stays up
    const grill = new THREE.BoxGeometry(MAST_W + 1.6, 0.5, MAST_W + 1.6); grill.translate(mx, 0.25 + 1.8, mz); geos.push(grill);
    for (let k = 0; k < 2; k++) {
      const blk = new THREE.BoxGeometry(6.4 - k * 0.4, 0.9, 6.4 - k * 0.4); blk.translate(mx, 0.45 + k * 0.9, mz); ballast.push(blk);
    }
    for (let k = 0; k < 4; k++) {
      const b = a + Math.PI / 4 + k * Math.PI / 2;
      const fx = mx + Math.cos(b) * 5.2, fz = mz + Math.sin(b) * 5.2;
      geos.push(cableBetween(mx + Math.cos(b) * MAST_W * 0.7, 9.5, mz + Math.sin(b) * MAST_W * 0.7, fx, 2.3, fz, 0.16));
      const foot = new THREE.BoxGeometry(1.4, 0.5, 1.4); foot.translate(fx, 2.05, fz); geos.push(foot);
    }
    // a rigid strut from the mast head down to the compression ring (a cable
    // alone reads as a tent), and a stay from the ring back up over the head
    geos.push(trussBetween(mx - ca * 1.2, S.mastY - 0.6, mz - sa * 1.2, ca * (ringR + 0.6), GY + 0.6, sa * (ringR + 0.6), 1.3, 1.6));
    geos.push(cableBetween(mx, S.mastY + 0.6, mz, ca * (ringR - 1), GY + 1.4, sa * (ringR - 1), 0.14));
    // three guys: straight back and two splayed, each to a ballasted anchor
    for (const da of [0, -0.5, 0.5]) {
      const ax = Math.cos(a + da) * (S.mastR + 11), az = Math.sin(a + da) * (S.mastR + 11);
      geos.push(cableBetween(mx, S.mastY + 0.2, mz, ax, 0.9, az, 0.13));
      const anchor = new THREE.BoxGeometry(2.4, 1.2, 2.4); anchor.translate(ax, 0.6, az); ballast.push(anchor);
    }
  }
  // compression ring at gridY: 1.3 m truss in 32 flats (the outer ring rig's
  // motors fly from it), a 1 m truss at r 24 (the mid ring's), a 0.9 m hub
  // ring at r 12 (the inner ring's), and sixteen deep spokes tying them
  ringTruss(ringR, GY + 0.6, 1.3, 32, 1.8);
  ringTruss(24, GY + 0.3, 1.0, 24, 1.5);
  ringTruss(12, GY + 0.1, 0.9, 16, 1.4);
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    const deep = i % 2 === 0;   // eight primary spokes, eight lighter secondaries
    const spoke = boxTruss(ringR - 12, deep ? 1.6 : 1.1, deep ? 1.6 : 1.2, deep ? 1.8 : 1.3);
    spoke.translate(0, GY, 0);
    spoke.rotateY(-a);
    spoke.translate(Math.cos(a) * ((ringR + 12) / 2), 0, Math.sin(a) * ((ringR + 12) / 2));
    geos.push(spoke);
  }
  // hub: a closed drum where the spokes meet
  geos.push(new THREE.CylinderGeometry(3.2, 3.2, 1.6, 24).translate(0, GY, 0));
  // hangers: the halo's top rim from the spider, twenty-four round, on bridles
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const hx = Math.cos(a) * H.r, hz = Math.sin(a) * H.r;
    geos.push(cableBetween(hx, GY, hz, hx, H.y0 + H.h + 0.4, hz, 0.14));
    geos.push(cableBetween(hx, H.y0 + H.h + 0.4, hz, Math.cos(a + 0.05) * H.r, H.y0 + H.h - 0.1, Math.sin(a + 0.05) * H.r, 0.06));
    geos.push(cableBetween(hx, H.y0 + H.h + 0.4, hz, Math.cos(a - 0.05) * H.r, H.y0 + H.h - 0.1, Math.sin(a - 0.05) * H.r, 0.06));
  }
  group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(ballast), ballastMat));
  // aviation beacons: hot red, over the bloom gate, on the hub too
  const hubBcn = new THREE.SphereGeometry(0.3, 10, 8); hubBcn.translate(0, GY + 1.2, 0); beacons.push(hubBcn);
  const beaconMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  beaconMat.color.setRGB(2.4, 0.15, 0.1);
  const beaconMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(beacons), beaconMat);
  beaconMesh.name = 'beacons';
  group.add(beaconMesh);
  // work lights along the spider: tiny warm points, the crew's world
  const workGeos = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const g = new THREE.SphereGeometry(0.12, 6, 5);
    g.translate(Math.cos(a) * 30, GY - 0.7, Math.sin(a) * 30);
    workGeos.push(g);
  }
  const workMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  workMat.color.setRGB(1.6, 1.3, 0.85);
  group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(workGeos), workMat));
  group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(geos), steel));
  return { sphere, sphereMat, patternMat, atmo, atmoMat, halo, haloMat, collar };
}

export function buildStage(scene, cfgIn = {}) {
  const cfg = normalizeStageCfg(cfgIn);
  const d = derive(cfg);
  const group = new THREE.Group();

  // One tile per PAIR of 2.44 m ply sheets. At one tile per sheet the mottle
  // and scuff pattern repeated every 2.4 m, which reads as wallpaper on a 40 m
  // deck; 4.88 m halves that frequency and the screw grid still lands on sheet
  // centres. The one-off tape marks are off (see makeUltraStageDeck).
  const deckTex = makeUltraStageDeck();
  for (const t of [deckTex.map, deckTex.roughnessMap, deckTex.bumpMap]) t.repeat.set(1 / 4.88, 1 / 4.88);
  deckTex.map.anisotropy = 8;   // the deck is always seen at a rake
  const deckMat = new THREE.MeshStandardMaterial({
    map: deckTex.map, roughnessMap: deckTex.roughnessMap, roughness: 1.0,
    bumpMap: deckTex.bumpMap, bumpScale: 0.55, metalness: 0.05,
    // A near-black albedo at this roughness still gathers a broad environment
    // specular, and applyState raises environmentIntensity for lights-up, so
    // the deck washed out to concrete grey instead of reading as black ply.
    // Same failure the pitch had before it went Lambert; here the maps are
    // worth keeping, so cut the environment term instead of the material.
    envMapIntensity: 0.12,
  });
  const skirtTex = makeUltraStageSkirt();
  skirtTex.map.repeat.set(3, 1); skirtTex.roughnessMap.repeat.set(3, 1);
  const skirtMat = new THREE.MeshStandardMaterial({
    map: skirtTex.map, roughnessMap: skirtTex.roughnessMap, roughness: 1.0,
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x8d939c, roughness: 0.35, metalness: 0.9 });

  const halfW = BOWL_B - WALL_GAP;

  // --- main deck slab --------------------------------------------------------
  // Open room: the upstage boundary follows the bowl's west wall. Curtained
  // room: the deck is a clean box that BEGINS at the drape — nothing of the
  // stage remains behind the cloth.
  const buildMainDeck = (frontX) => {
    const cut = CURTAIN_CUT[cfg.curtains];
    let mainGeo;
    if (cfg.curtains === 'hemicycle') {
      // curved cap deck: straight back at the drape, front edge concentric
      // with the east end of the bowl so a constant floor strip remains
      const backX = cut + 0.25;
      const GAP = 4.6;   // curved floor strip between deck lip and the seats
      const path = roundedRectPath(BOWL_A - WALL_GAP - GAP, halfW - GAP * 0.55, Math.max(0.5, BOWL_R - WALL_GAP - GAP), 256);
      const arc = path.filter((p) => p.x >= backX + 0.5);
      arc.sort((a, b) => Math.atan2(a.z, a.x - backX) - Math.atan2(b.z, b.x - backX));
      const shape = new THREE.Shape();
      shape.moveTo(backX, arc.length ? -arc[0].z : -halfW);
      for (const p of arc) shape.lineTo(p.x, -p.z);
      shape.lineTo(backX, arc.length ? -arc[arc.length - 1].z : halfW);
      shape.closePath();
      mainGeo = new THREE.ExtrudeGeometry(shape, { depth: MAIN_H, bevelEnabled: false });
      mainGeo.rotateX(-Math.PI / 2);
      const deckH = new THREE.Mesh(mainGeo, [deckMat, skirtMat]);
      deckH.castShadow = true;
      deckH.receiveShadow = true;
      group.add(deckH);
      return deckH;
    }
    if (cut !== null && cut !== undefined) {
      const backX = cut + 0.25;   // hugging the drape
      mainGeo = new THREE.BoxGeometry(frontX - backX, MAIN_H, halfW * 2);
      mainGeo.translate((frontX + backX) / 2, MAIN_H / 2, 0);
      const deckB = new THREE.Mesh(mainGeo, [skirtMat, skirtMat, deckMat, skirtMat, skirtMat, skirtMat]);
      deckB.castShadow = true;
      deckB.receiveShadow = true;
      group.add(deckB);
      const trimB = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, halfW * 2), trimMat);
      trimB.position.set(frontX, MAIN_H - 0.04, 0);
      group.add(trimB);
      return deckB;
    }
    const path = roundedRectPath(BOWL_A - WALL_GAP, halfW, BOWL_R - WALL_GAP, 256);
    const arc = path.filter((p) => p.x <= frontX);
    const shape = new THREE.Shape();
    shape.moveTo(frontX, -halfW);
    for (const p of arc) shape.lineTo(p.x, -p.z);
    shape.lineTo(frontX, halfW);
    shape.closePath();
    mainGeo = new THREE.ExtrudeGeometry(shape, { depth: MAIN_H, bevelEnabled: false });
    mainGeo.rotateX(-Math.PI / 2);
    const deck = new THREE.Mesh(mainGeo, [deckMat, skirtMat]);
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, halfW * 2), trimMat);
    trim.position.set(frontX, MAIN_H - 0.04, 0);
    group.add(trim);
    return deck;
  };

  // --- shaped LED deck (any B-stage shape, or the whole middle stage) ---------
  // Shape XY -> world XZ (shape +y = world -z). One extrude gives deck top +
  // skirt sides; the top face carries the LED video floor; rim cells trace the
  // outline, hue-stepped and pushed over the 1.25 bloom gate.
  const buildShapedDeck = (cx, cz, shapeDef, addToGroup = true) => {
    const host = addToGroup ? group : new THREE.Group();   // orphaned = hidden
    const { shape } = shapeDef;
    const deckGeo = new THREE.ExtrudeGeometry(shape, { depth: CAT_H, bevelEnabled: false });
    deckGeo.rotateX(-Math.PI / 2);
    deckGeo.translate(cx, 0, cz);
    const deck = new THREE.Mesh(deckGeo, [deckMat, skirtMat]);
    deck.castShadow = true;
    deck.receiveShadow = true;
    // the whole b-stage package (deck + floor screen + rim) hangs off one
    // group so the riser lift moves it as a unit
    const lift = new THREE.Group();
    host.add(lift);
    lift.add(deck);
    // hydraulic rams: dark sleeves fixed to the floor, chromed rods riding
    // the deck — the lift telescopes instead of floating
    const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x1c1e23, roughness: 0.5, metalness: 0.6 });
    const rodMat = new THREE.MeshStandardMaterial({ color: 0xb8bec8, roughness: 0.18, metalness: 0.95 });
    // A ram must end up UNDER the deck, and a circle of boundR * 0.5 only
    // guarantees that on a convex outline. The X and heart decks have notches
    // between their arms, so any ram whose angle happened to land in a notch
    // stood alone on the open floor between the deck and the barricade — a
    // small grey post that read as a mystery object next to the B-stage.
    //
    // So walk each ram inward along its own angle until it is genuinely inside
    // the outline, then pull it in a little further so its 0.2 m body is
    // covered too. Works for every shape, including ones added later.
    //
    // ExtrudeGeometry builds in XY and the deck is rotated -90 degrees about X,
    // which maps the shape's local +y to world -z: a world offset (ox, oz) is
    // the shape-local point (ox, -oz). That sign matters on the asymmetric
    // outlines (the heart) even though the star hides it.
    const outline = shape.getPoints(96);
    const insideDeck = (lx, ly) => {
      let hit = false;
      for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
        const a = outline[i], b = outline[j];
        if ((a.y > ly) !== (b.y > ly)
          && lx < ((b.x - a.x) * (ly - a.y)) / (b.y - a.y) + a.x) hit = !hit;
      }
      return hit;
    };
    const rr = Math.max(1.2, shapeDef.boundR ? shapeDef.boundR * 0.5 : 1.6);
    for (let hp = 0; hp < 4; hp++) {
      const a = (hp / 4) * Math.PI * 2 + 0.4;
      let r = rr;
      while (r > 0.4 && !insideDeck(Math.cos(a) * r, -Math.sin(a) * r)) r -= 0.12;
      r = Math.max(0.4, r - 0.28);        // clear the ram's own girth
      const hx = cx + Math.cos(a) * r, hz = cz + Math.sin(a) * r;
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 1.1, 10), sleeveMat);
      sleeve.position.set(hx, 0.55, hz);
      host.add(sleeve);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 8), rodMat);
      rod.position.set(hx, CAT_H - 1.35, hz);
      lift.add(rod);
    }

    const bIdleTex = makeBStageIdle();
    const bScreenMat = new THREE.MeshBasicMaterial({ map: bIdleTex });
    bScreenMat.color.setScalar(1.5);
    const pts = shape.getPoints(96);
    // slightly shrunk copy of the outline as the screen surface
    const sShape = new THREE.Shape();
    pts.forEach((p, i) => {
      if (i === 0) sShape.moveTo(p.x * 0.94, p.y * 0.94);
      else sShape.lineTo(p.x * 0.94, p.y * 0.94);
    });
    sShape.closePath();
    const scrGeo = new THREE.ShapeGeometry(sShape);
    // remap UVs to the bounding box so video content fills the face
    scrGeo.computeBoundingBox();
    const bb = scrGeo.boundingBox;
    const uvA = scrGeo.attributes.uv, posA = scrGeo.attributes.position;
    for (let i = 0; i < uvA.count; i++) {
      uvA.setXY(i,
        (posA.getX(i) - bb.min.x) / (bb.max.x - bb.min.x),
        (posA.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
    }
    scrGeo.rotateX(-Math.PI / 2);
    scrGeo.translate(cx, CAT_H + 0.012, cz);
    const bScreen = new THREE.Mesh(scrGeo, bScreenMat);
    lift.add(bScreen);

    // rim cells along the true outline, spaced by arc length
    let per = 0;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[(i + 1) % pts.length];
      per += Math.hypot(q.x - pts[i].x, q.y - pts[i].y);
    }
    const cells = Math.max(32, Math.round(per / 0.42));
    const ringMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.16, 0.07, 0.1), new THREE.MeshBasicMaterial({}), cells);
    const rd = new THREE.Object3D();
    const rc = new THREE.Color();
    let seg = 0, acc = 0;
    for (let i = 0; i < cells; i++) {
      const target = (i / cells) * per;
      for (let guard = 0; guard < pts.length * 2; guard++) {
        const p0 = pts[seg % pts.length], p1 = pts[(seg + 1) % pts.length];
        const L = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        if (acc + L >= target || guard === pts.length * 2 - 1) {
          const t = L > 0 ? (target - acc) / L : 0;
          rd.position.set(
            cx + p0.x + (p1.x - p0.x) * t,
            CAT_H + 0.03,
            cz - (p0.y + (p1.y - p0.y) * t));
          rd.rotation.set(0, Math.atan2(p1.x - p0.x, -(p1.y - p0.y)), 0);
          rd.updateMatrix();
          break;
        }
        acc += L;
        seg++;
      }
      ringMesh.setMatrixAt(i, rd.matrix);
      rc.setHSL(i / cells, 1, 0.55).multiplyScalar(2.2);
      ringMesh.setColorAt(i, rc);
    }
    lift.add(ringMesh);
    return { bScreen, bScreenMat, bIdleTex, ringMesh, lift };
  };

  let mainDeck = null;
  let round = null;
  let bCenter = null;
  let catRing = null;
  let aLift = null;

  let sphereParts = null;
  if (cfg.position === 'middle') {
    const sphere = cfg.middleShape === 'sphere';
    const base = cfg.middleShape === 'square' ? B_SHAPES.square() : B_SHAPES.circle();
    const scale = cfg.middleShape === 'square' ? MIDDLE_SQ / 3.2
      : (sphere ? SPEC.sphere.deckR : CENTRE_R) / (B_DIAM / 2);
    const scaled = new THREE.Shape();
    base.shape.getPoints(sphere ? 192 : 96).forEach((p, i) => {
      if (i === 0) scaled.moveTo(p.x * scale, p.y * scale);
      else scaled.lineTo(p.x * scale, p.y * scale);
    });
    scaled.closePath();
    round = buildShapedDeck(0, 0, { shape: scaled });
    mainDeck = round.bScreen;
    bCenter = new THREE.Vector3(0, CAT_H, 0);
    if (sphere) sphereParts = buildGiantSphere(group);
  } else {
    mainDeck = buildMainDeck(d.frontX);
    if (cfg.curtains !== 'hemicycle') {
      // centre-stage riser: a motorised platform sunk into the main deck that
      // main.js lifts 0..2.2 m. Rest height keeps a visible 0.32 m plinth.
      aLift = new THREE.Group();
      const rx = d.frontX - 4.5;
      const rTop = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 5), deckMat);
      rTop.position.set(rx, MAIN_H + 0.26, 0);
      const rSkirt = new THREE.Mesh(new THREE.BoxGeometry(6.9, 2.5, 4.9), skirtMat);
      rSkirt.position.set(rx, MAIN_H + 0.26 - 1.31, 0);
      aLift.add(rTop, rSkirt);
      // corner rams: sleeves planted on the deck, rods riding the platform
      const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x1c1e23, roughness: 0.5, metalness: 0.6 });
      const rodMat = new THREE.MeshStandardMaterial({ color: 0xb8bec8, roughness: 0.18, metalness: 0.95 });
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const hx = rx + sx * 3.1, hz = sz * 2.1;
          const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.8, 10), sleeveMat);
          sleeve.position.set(hx, MAIN_H + 0.4, hz);
          group.add(sleeve);
          const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 2.3, 8), rodMat);
          rod.position.set(hx, MAIN_H + 0.26 - 1.2, hz);
          aLift.add(rod);
        }
      }
      group.add(aLift);
    }

    if (d.hasCat) {
      const rampProfile = new THREE.Shape();
      rampProfile.moveTo(d.frontX, 0);
      rampProfile.lineTo(d.rampEnd, 0);
      rampProfile.lineTo(d.rampEnd, CAT_H);
      rampProfile.lineTo(d.frontX, MAIN_H);
      rampProfile.closePath();
      const rampGeo = new THREE.ExtrudeGeometry(rampProfile, { depth: CAT_W, bevelEnabled: false });
      rampGeo.translate(0, 0, -CAT_W / 2);
      const ramp = new THREE.Mesh(rampGeo, [skirtMat, deckMat]);
      ramp.castShadow = true;
      ramp.receiveShadow = true;
      group.add(ramp);

      const catLen = d.bX - d.rampEnd;
      const catMid = (d.rampEnd + d.bX) / 2;
      const catDeck = new THREE.Mesh(new THREE.BoxGeometry(catLen, 0.14, CAT_W), deckMat);
      catDeck.position.set(catMid, CAT_H - 0.07, 0);
      catDeck.castShadow = true;
      catDeck.receiveShadow = true;
      group.add(catDeck);
      const catSkirt = new THREE.Mesh(
        new THREE.BoxGeometry(catLen, CAT_H - 0.14, CAT_W - 0.22), skirtMat);
      catSkirt.position.set(catMid, (CAT_H - 0.14) / 2, 0);
      group.add(catSkirt);
      for (const s of [-1, 1]) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(catLen, 0.05, 0.06), trimMat);
        t.position.set(catMid, CAT_H - 0.02, s * (CAT_W / 2 - 0.03));
        group.add(t);
      }

      // LED rope light tracing the runway: both catwalk edges plus the ramp
      // down from the main deck. Cells match the b-stage rim family; colours
      // are repainted live by BStageFX, so this just plants the hardware.
      // The deck runs under the b-stage, so cells landing inside the b-stage
      // footprint are dropped — otherwise the rope crosses its floor screen.
      let bPoly = null;
      if (d.hasB) {
        // the b-stage outline in world XZ — the rim LEDs sit exactly on it
        bPoly = B_SHAPES[cfg.bstage]().shape.getPoints(96).map((p) => [d.bX + p.x, -p.y]);
      }
      // One rule for every shape: a rope cell survives only OUTSIDE the
      // outline and at least one cell-gap away from it, so the runway light
      // never crosses the b-stage's own ring — circle, square, X or heart.
      const clearOf = (x, z) => {
        if (!bPoly) return true;
        let inside = false, d2 = Infinity;
        for (let i = 0, j = bPoly.length - 1; i < bPoly.length; j = i++) {
          const [xi, zi] = bPoly[i], [xj, zj] = bPoly[j];
          if ((zi > z) !== (zj > z)
              && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
          const dx = xj - xi, dz = zj - zi;
          const t = Math.min(1, Math.max(0,
            ((x - xi) * dx + (z - zi) * dz) / Math.max(dx * dx + dz * dz, 1e-9)));
          const px = xi + dx * t - x, pz = zi + dz * t - z;
          const dd = px * px + pz * pz;
          if (dd < d2) d2 = dd;
        }
        return !inside && d2 > 0.28 * 0.28;
      };
      const ledRuns = [];
      for (const s of [-1, 1]) {
        const z = s * (CAT_W / 2 - 0.03);
        ledRuns.push({ x0: d.frontX, x1: d.rampEnd, y0: MAIN_H, y1: CAT_H, z });
        ledRuns.push({ x0: d.rampEnd, x1: d.bX, y0: CAT_H, y1: CAT_H, z });
      }
      const cells = [];
      for (const r of ledRuns) {
        const n = Math.max(4, Math.round(Math.hypot(r.x1 - r.x0, r.y1 - r.y0) / 0.42));
        const tilt = Math.atan2(r.y1 - r.y0, r.x1 - r.x0);
        for (let i = 0; i < n; i++) {
          const u = (i + 0.5) / n;
          const x = r.x0 + (r.x1 - r.x0) * u;
          if (!clearOf(x, r.z)) continue;
          cells.push([x, r.y0 + (r.y1 - r.y0) * u + 0.03, r.z, tilt]);
        }
      }
      if (cells.length) {
        catRing = new THREE.InstancedMesh(
          new THREE.BoxGeometry(0.16, 0.07, 0.1), new THREE.MeshBasicMaterial({}), cells.length);
        const cd = new THREE.Object3D();
        const cc = new THREE.Color(0xff2412).multiplyScalar(2.2);
        cells.forEach(([x, y, z, tilt], i) => {
          cd.position.set(x, y, z);
          cd.rotation.set(0, 0, tilt);
          cd.updateMatrix();
          catRing.setMatrixAt(i, cd.matrix);
          catRing.setColorAt(i, cc);
        });
        group.add(catRing);
      }
    }

    if (d.hasB) {
      round = buildShapedDeck(d.bX, 0, B_SHAPES[cfg.bstage]());
      bCenter = new THREE.Vector3(d.bX, CAT_H, 0);
    } else {
      // console screen controls still need a target — orphaned, never rendered
      round = buildShapedDeck(d.bX, 0, B_SHAPES.circle(), false);
      bCenter = new THREE.Vector3(d.frontX + 2, MAIN_H, 0);
    }
  }

  // --- C-stage: a flat table laid over 5 seats x 2 rows, hugging a stair -----
  // Built at the top level of buildStage, NOT inside the B-stage branch: it
  // used to sit in there, so with the wrong room config the seat tarp still
  // drew from main.js while this never ran and the platform went missing.
  if (cfg.cstage) {
    const F = CSTAGE_FRAME;
    const c = new THREE.Group();
    c.position.set(F.x, 0, F.z);
    c.rotation.y = F.yaw;
    // the table top: one flat slab resting on the seats, nothing under it
    const deck = new THREE.Mesh(new THREE.BoxGeometry(F.w, 0.09, F.d), deckMat);
    deck.position.set(0, F.top + 0.045, 0);
    deck.castShadow = true;
    c.add(deck);
    // a thin dark edge band so the slab reads as a covered platform, not a plane
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(F.w + 0.06, 0.10, F.d + 0.06),
      new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 })
    );
    edge.position.set(0, F.top - 0.03, 0);
    c.add(edge);
    // Legs on the four corners, each cut to its own corner's tread: the rake
    // falls away downstage, so the front pair are the long ones. This is what
    // makes it read as staging rather than a slab lying on the chairs.
    const under = F.top - 0.08;
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.45, metalness: 0.8 });
    const lx = F.w / 2 - 0.10, lz = F.d / 2 - 0.10;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // local -z is the downstage (lower) edge
        const foot = sz < 0 ? F.treadFront : F.treadBack;
        const h = Math.max(0.12, under - foot);
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, h, 0.09), legMat);
        leg.position.set(sx * lx, under - h / 2, sz * lz);
        c.add(leg);
      }
    }
    // No skirts: the legs stand open under the deck, so you can see straight
    // through to the seats and treads below it.
    group.add(c);
  }

  // --- crowd barriers ----------------------------------------------------------
  // no FOH pen in the smallest rooms — the deck leaves it no floor to sit on
  const noFOH = ['theatre', 'hemicycle'].includes(cfg.curtains);
  const spots = noFOH
    ? barrierSamples(cfg)
    : [...barrierSamples(cfg), ...fohSamples()];
  const { frame, mesh } = barrierPanelGeos();
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5, metalness: 0.7 });
  const meshTex = makeBarrierMesh();
  meshTex.repeat.set(4, 4);
  const meshMat = new THREE.MeshStandardMaterial({
    map: meshTex, alphaTest: 0.5, side: THREE.DoubleSide,
    color: 0x2a2d32, roughness: 0.65, metalness: 0.5,
  });
  const frames = new THREE.InstancedMesh(frame, steelMat, spots.length);
  const meshes = new THREE.InstancedMesh(mesh, meshMat, spots.length);
  const dm = new THREE.Object3D();
  spots.forEach((p, i) => {
    dm.position.set(p.x, 0, p.z);
    dm.rotation.set(0, Math.atan2(-p.nx, -p.nz), 0);
    dm.updateMatrix();
    frames.setMatrixAt(i, dm.matrix);
    meshes.setMatrixAt(i, dm.matrix);
  });
  frames.castShadow = true;
  meshes.castShadow = true;
  group.add(frames, meshes);

  scene.add(group);
  return {
    group, cfg, mainDeck,
    bScreen: round.bScreen, bScreenMat: round.bScreenMat,
    bIdleTex: round.bIdleTex, bRing: round.ringMesh, catRing,
    bLift: round.lift || null, aLift,
    barrierCount: spots.length, bCenter,
    ...(sphereParts || {}),
  };
}
