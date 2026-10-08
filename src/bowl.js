// Parametric arena bowl modeled on the Bell Centre: a rounded-rectangle plan
// curve swept into FOUR seating levels (100 lower / 200 club / 300 loge /
// 400 upper) with section stair-aisles, LED fascia rings carrying ads +
// section numbers, and a suite band with lit windows.
// Also builds the hockey rink (boards + glass + ice) and the concert floor.
import * as THREE from 'three';
import { makeConcreteFloor, makeTarpTexture } from './surfaces.js';
import { makeUltraConcrete, makeUltraRiser, makeUltraWallPanel } from './textures_ultra_arena.js';
import { makeUltraSeatShading, makeUltraSeatBillboard } from './textures_ultra_seats.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { SPEC } from './venue.js';
import {
  RINK_W, RINK_H, RINK_R,
  makeIceTexture, makeConcertFloor, makeBoardsTexture,
  makeFasciaTexture, FASCIA_TILE_M, makeSuiteCarpet, makeSuiteWall, makeSeatBillboard,
  makeOrbDiscTexture, billboardInstanced, makeSectionNumberAtlas,
} from './textures.js';

// inner edge of the seating bowl — the rink boards land flush against it
// Camera-facing disc material for the crowd orbs (see textures.js for why).
function orbDiscMaterial() {
  const m = new THREE.MeshBasicMaterial({
    color: 0x000000, map: makeOrbDiscTexture(),
    alphaTest: 0.45,        // crisp circle, no transparency sorting
    fog: false,
  });
  billboardInstanced(m);
  return m;
}

// plan of the bowl's inner edge — the arena hugs the rink, the stadium the
// pitch's run-off (venue.js holds both)
export const BOWL_A = SPEC.bowl.a, BOWL_B = SPEC.bowl.b, BOWL_R = SPEC.bowl.r;

// --- sections: how wide they are, where the ring starts, what each is called --
// Offsetting a rounded rectangle outward leaves its STRAIGHT runs exactly as
// long and stretches only its corner arcs, so arc length on the ring at plan
// offset `off` is a piecewise-linear function of arc length on the base path:
// straights scale by 1, corners by (R + off) / R. That one fact is what both
// directions below need.
const AISLE_OFF = SPEC.bowl.aisleOffset || 0;
// the base path's eight runs, in the order roundedRectPath lays them down:
// +z side, corner, -x side, corner, -z side, corner, +x side, corner
const RUNS = (() => {
  const sx = BOWL_A - BOWL_R, sz = BOWL_B - BOWL_R, arc = (Math.PI / 2) * BOWL_R;
  return [2 * sx, arc, 2 * sz, arc, 2 * sx, arc, 2 * sz, arc];
})();
const RUN_IS_ARC = [false, true, false, true, false, true, false, true];
const ringRuns = (off) => {
  const k = (BOWL_R + off) / BOWL_R;
  return RUNS.map((L, i) => (RUN_IS_ARC[i] ? L * k : L));
};
const sum = (a) => a.reduce((x, y) => x + y, 0);
// arc fraction of the `off` ring -> arc fraction of the base path, and back
export function ringUToBaseU(f, off = AISLE_OFF) {
  const scaled = ringRuns(off), totB = sum(RUNS), totS = sum(scaled);
  let target = (((f % 1) + 1) % 1) * totS, dB = 0;
  for (let i = 0; i < RUNS.length; i++) {
    if (target <= scaled[i]) return (dB + RUNS[i] * (target / scaled[i])) / totB;
    target -= scaled[i]; dB += RUNS[i];
  }
  return 1 - 1e-9;
}
export function baseUToRingU(u, off = AISLE_OFF) {
  const scaled = ringRuns(off), totB = sum(RUNS), totS = sum(scaled);
  let target = (((u % 1) + 1) % 1) * totB, dS = 0;
  for (let i = 0; i < RUNS.length; i++) {
    if (target <= RUNS[i]) return (dS + scaled[i] * (target / RUNS[i])) / totS;
    target -= RUNS[i]; dS += scaled[i];
  }
  return 1 - 1e-9;
}
// baseUToRingU for a crowd of points on one ring: the runs worked out once
export function baseToRingMapper(off = AISLE_OFF) {
  const scaled = ringRuns(off), totB = sum(RUNS), totS = sum(scaled);
  return (u) => {
    let target = (((u % 1) + 1) % 1) * totB, dS = 0;
    for (let i = 0; i < RUNS.length; i++) {
      if (target <= RUNS[i]) return (dS + scaled[i] * (target / RUNS[i])) / totS;
      target -= RUNS[i]; dS += scaled[i];
    }
    return 1 - 1e-9;
  };
}
// Aisles are evenly spaced whatever happens, but WHERE the ring starts decides
// which section straddles the centreline. `sectionsFromCentre` phases it so
// span 0 is centred on the +z side — the seating chart's x01 — instead of
// leaving it wherever the path happens to begin.
export function aislePhase(n) {
  if (!SPEC.bowl.sectionsFromCentre) return 0;
  const scaled = ringRuns(AISLE_OFF);
  return (scaled[0] / 2 / sum(scaled)) * n - 1;   // midpoint of the +z side run
}
// base-path fraction of aisle k on an n-section level
export function aisleU(n, k) {
  return ringUToBaseU((k + 0.5 + aislePhase(n)) / n, AISLE_OFF);
}
// base-path fractions bounding section span j
export function spanBaseU(n, j) {
  const ph = aislePhase(n);
  const a = ringUToBaseU((j + 0.5 + ph) / n, AISLE_OFF);
  let b = ringUToBaseU((j + 1.5 + ph) / n, AISLE_OFF);
  if (b <= a) b += 1;                            // the span that wraps past u = 0
  return [a, b];
}
// which span a point on the base path falls in
export function spanAtBaseU(n, u) {
  const f = baseUToRingU(u, AISLE_OFF);
  return (((Math.floor(f * n - 0.5 - aislePhase(n)) % n) + n) % n);
}
// Section j is the span between aisles j and j+1. Numbers climb CLOCKWISE
// while the path runs counter-clockwise, hence the reversal: on 24 sections
// that puts 101 at +z centre, 107 at +x, 113 at -z and 119 at -x, and on 36
// it puts 301 / 310 / 319 / 328 at the same four points.
export function sectionLabel(n, j, base = 101) { return base + ((n - j) % n); }
export function sectionSpan(n, label, base = 101) { return (((n - (label - base)) % n) + n) % n; }

// Base-path fraction of the rim point a seat at (x, z) sits behind: the point
// of the inner rounded rectangle it is pushed straight out from. Same start
// and direction as roundedRectPath: from (sx, b) along the +z side towards -x,
// then counter-clockwise round the corners.
export function baseUAt(x, z) {
  const sx = BOWL_A - BOWL_R, sz = BOWL_B - BOWL_R, r = BOWL_R;
  const SX = 2 * sx, SZ = 2 * sz, ARC = (Math.PI / 2) * r;
  const total = 2 * SX + 2 * SZ + 4 * ARC;
  const dx = x - Math.max(-sx, Math.min(sx, x));
  const dz = z - Math.max(-sz, Math.min(sz, z));
  let d;
  if (dx === 0 && dz >= 0) d = sx - x;                                        // +z side
  else if (dx < 0 && dz > 0) d = SX + (Math.atan2(dz, dx) - Math.PI / 2) * r;  // corner (-x, +z)
  else if (dz === 0 && dx < 0) d = SX + ARC + (sz - z);                        // -x end
  else if (dx < 0 && dz < 0) d = SX + ARC + SZ + (Math.atan2(dz, dx) + Math.PI) * r;         // corner (-x, -z)
  else if (dx === 0 && dz < 0) d = SX + 2 * ARC + SZ + (x + sx);               // -z side
  else if (dx > 0 && dz < 0) d = 2 * SX + 2 * ARC + SZ + (Math.atan2(dz, dx) + Math.PI / 2) * r;   // corner (+x, -z)
  else if (dz === 0 && dx > 0) d = 2 * SX + 3 * ARC + SZ + (z + sz);           // +x end
  else d = 2 * SX + 3 * ARC + 2 * SZ + Math.atan2(dz, dx) * r;                 // corner (+x, +z)
  return (((d / total) % 1) + 1) % 1;
}
// The inverse: the rim point at base-path fraction u.
export function basePointAt(u) {
  const sx = BOWL_A - BOWL_R, sz = BOWL_B - BOWL_R, r = BOWL_R;
  const SX = 2 * sx, SZ = 2 * sz, ARC = (Math.PI / 2) * r;
  let d = ((((u % 1) + 1) % 1)) * (2 * SX + 2 * SZ + 4 * ARC);
  if (d < SX) return { x: sx - d, z: BOWL_B };
  if ((d -= SX) < ARC) { const a = Math.PI / 2 + d / r; return { x: -sx + Math.cos(a) * r, z: sz + Math.sin(a) * r }; }
  if ((d -= ARC) < SZ) return { x: -BOWL_A, z: sz - d };
  if ((d -= SZ) < ARC) { const a = Math.PI + d / r; return { x: -sx + Math.cos(a) * r, z: -sz + Math.sin(a) * r }; }
  if ((d -= ARC) < SX) return { x: -sx + d, z: -BOWL_B };
  if ((d -= SX) < ARC) { const a = -Math.PI / 2 + d / r; return { x: sx + Math.cos(a) * r, z: -sz + Math.sin(a) * r }; }
  if ((d -= ARC) < SZ) return { x: BOWL_A, z: -sz + d };
  d -= SZ;
  const a = d / r;
  return { x: sx + Math.cos(a) * r, z: sz + Math.sin(a) * r };
}

// ---------------------------------------------------------------------------
// Rounded-rectangle path sampler. Every row is sampled on its OWN offset
// curve (grown half-extents and corner radius), so arc length — and with it
// seat spacing — is correct through the corners, where the base-curve
// parameterization would otherwise stretch the spacing apart.
// ---------------------------------------------------------------------------
// Arc length of that same curve, offset outwards by `off` — used to pick how
// many times a fascia ring tiles its artwork so nothing gets stretched.
export function perimeterAt(a, b, r, off = 0) {
  const A = a + off, B = b + off, R = r + off;
  return 4 * (A - R) + 4 * (B - R) + 2 * Math.PI * R;
}

// Sample a path at ANY arc fraction, interpolating between its samples.
// Rounding to the nearest sample was the real density bug: a path is 384
// points, so on a 400 m upper-tier ring each sample covers ~1.06 m — wider
// than the 0.53 m seat pitch. Consecutive seats rounded onto the SAME point
// and stacked on top of each other, which is why the 300s/400s looked half
// as dense as the 100s while still counting every seat.
export function pathAt(path, segs, u) {
  const f = (((u % 1) + 1) % 1) * segs;
  const i0 = Math.floor(f) % segs, i1 = (i0 + 1) % segs;
  const t = f - Math.floor(f);
  const a = path[i0], b = path[i1];
  let nx = a.nx + (b.nx - a.nx) * t, nz = a.nz + (b.nz - a.nz) * t;
  const nl = Math.hypot(nx, nz) || 1;
  nx /= nl; nz /= nl;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx, nz, corner: a.corner };
}

export function roundedRectPath(a, b, r, segments) {
  const sx = a - r, sz = b - r;
  const straightX = 2 * sx, straightZ = 2 * sz, arc = (Math.PI / 2) * r;
  const total = 2 * straightX + 2 * straightZ + 4 * arc;
  const pts = [];
  for (let i = 0; i < segments; i++) {
    let d = (i / segments) * total;
    let x, z, nx, nz, corner = false;
    if (d < straightX) {
      x = sx - d; z = b; nx = 0; nz = 1;
    } else if ((d -= straightX) < arc) {
      const ang = Math.PI / 2 + (d / arc) * (Math.PI / 2);
      x = -sx + Math.cos(ang) * r; z = sz + Math.sin(ang) * r;
      nx = Math.cos(ang); nz = Math.sin(ang); corner = true;
    } else if ((d -= arc) < straightZ) {
      x = -a; z = sz - d; nx = -1; nz = 0;
    } else if ((d -= straightZ) < arc) {
      const ang = Math.PI + (d / arc) * (Math.PI / 2);
      x = -sx + Math.cos(ang) * r; z = -sz + Math.sin(ang) * r;
      nx = Math.cos(ang); nz = Math.sin(ang); corner = true;
    } else if ((d -= arc) < straightX) {
      x = -sx + d; z = -b; nx = 0; nz = -1;
    } else if ((d -= straightX) < arc) {
      const ang = -Math.PI / 2 + (d / arc) * (Math.PI / 2);
      x = sx + Math.cos(ang) * r; z = -sz + Math.sin(ang) * r;
      nx = Math.cos(ang); nz = Math.sin(ang); corner = true;
    } else if ((d -= arc) < straightZ) {
      x = a; z = -sz + d; nx = 1; nz = 0;
    } else {
      d -= straightZ;
      const ang = (d / arc) * (Math.PI / 2);
      x = sx + Math.cos(ang) * r; z = sz + Math.sin(ang) * r;
      nx = Math.cos(ang); nz = Math.sin(ang); corner = true;
    }
    pts.push({ x, z, nx, nz, corner, u: i / segments });
  }
  pts.total = total;
  return pts;
}

// Quad band swept along the path between two offsets/heights.
function ringStrip(base, off1, y1, off2, y2, uAlongPath = false) {
  const n = base.length;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const p = base[i % n];
    pos.push(p.x + p.nx * off1, y1, p.z + p.nz * off1);
    pos.push(p.x + p.nx * off2, y2, p.z + p.nz * off2);
    const u = uAlongPath ? i / n : 0;
    uv.push(u, 0, u, 1);
  }
  for (let i = 0; i < n; i++) {
    const k = i * 2;
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ringStrip with the offset AND height free per path point: fA/fB return
// [off, y] for the inner and outer edge at each sample. This is what lets the
// stadium's rear wall ride a rim that rises and falls around the bowl.
function ringStripFn(base, fA, fB) {
  const n = base.length;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const p = base[i % n];
    const [o1, y1] = fA(p), [o2, y2] = fB(p);
    pos.push(p.x + p.nx * o1, y1, p.z + p.nz * o1, p.x + p.nx * o2, y2, p.z + p.nz * o2);
    uv.push(i / n, 0, i / n, 1);
  }
  for (let i = 0; i < n; i++) {
    const k = i * 2;
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Same idea as ringStrip but only over a sub-range of the loop, for tarps
// that cover individual seating sections.
function pathStrip(base, u0, u1, off1, y1, off2, y2) {
  const n = base.length;
  const i0 = Math.round(u0 * n);
  const count = Math.max(2, Math.round((u1 - u0) * n));
  const pos = [], uv = [], idx = [];
  for (let s = 0; s <= count; s++) {
    const p = base[(i0 + s) % n];
    pos.push(p.x + p.nx * off1, y1, p.z + p.nz * off1);
    pos.push(p.x + p.nx * off2, y2, p.z + p.nz * off2);
    const u = s / count;
    uv.push(u, 0, u, 1);
  }
  for (let s = 0; s < count; s++) {
    const k = s * 2;
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// pathStrip with a back edge that moves along the path: backAt(p) gives the
// [offset, height] of the far edge at each path point, or null where the
// strip stops. The seat tarps need it: a stadium's swoop cuts its upper deck
// down behind the goals, so the rows a tarp lies over change round the bowl.
function pathStripTo(base, u0, u1, off1, y1, backAt) {
  const n = base.length;
  const i0 = Math.round(u0 * n);
  const count = Math.max(2, Math.round((u1 - u0) * n));
  const pos = [], uv = [], idx = [];
  let k = 0, joined = false;   // pairs written; whether the last point was part of the strip
  for (let s = 0; s <= count; s++) {
    const p = base[(i0 + s) % n];
    const back = backAt(p);
    if (!back) { joined = false; continue; }
    pos.push(p.x + p.nx * off1, y1, p.z + p.nz * off1);
    pos.push(p.x + p.nx * back[0], back[1], p.z + p.nz * back[0]);
    const u = s / count;
    uv.push(u, 0, u, 1);
    if (joined) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    joined = true;
    k++;
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// slab concrete rides the strip UVs (u walks the whole ring, v across), so a
// high u-repeat gives ~2 m tiles along every tier, riser and walkway
// The ultra bakes were painted asphalt-dark (#17181c) — real concourse
// concrete reads 4-6x brighter. Re-level the canvas in place instead of
// pushing material.color past 1, so every consumer sees honest albedo.
export function liftBake(tex, k, sat = 0.65) {
  const c = tex.image, x = c.getContext('2d');
  x.save();
  x.globalCompositeOperation = 'copy';
  x.filter = `brightness(${k}) saturate(${sat})`;
  x.drawImage(c, 0, 0);
  x.restore();
  tex.needsUpdate = true;
  return tex;
}

const slabTex = makeUltraConcrete();
liftBake(slabTex.map, 3.0);   // dark grey concourse — lit, but never bright
slabTex.map.repeat.set(150, 1);
slabTex.map.anisotropy = 8;   // the tiers are all grazing angles from everywhere
// Standard, deliberately: the house look is mostly ENVIRONMENT light
// (applyState raises environmentIntensity for lights-up), and Lambert
// ignores environment maps completely — converting the tiers to Lambert
// turned the whole bowl to asphalt. Maps beyond albedo stay off for speed.
const concreteMat = new THREE.MeshStandardMaterial({
  map: slabTex.map, roughness: 0.92, side: THREE.DoubleSide,
});
const stepTex = makeUltraRiser();
liftBake(stepTex.map, 3.4);
stepTex.map.anisotropy = 8;
const aisleMat = new THREE.MeshStandardMaterial({
  map: stepTex.map, roughness: 0.9,
});
// the stadium's concrete is pale, almost white in the sun; the arena's stays dark
if (SPEC.bowl.concreteLift) {
  concreteMat.color.setScalar(SPEC.bowl.concreteLift);
  aisleMat.color.setScalar(SPEC.bowl.concreteLift);
}

// ---------------------------------------------------------------------------
// The bowl.
// ---------------------------------------------------------------------------
// --- walking surface ---------------------------------------------------------
// Signed distance from (x,z) to the bowl's base rounded-rect path: <= 0 on the
// event floor, growing outward through the tiers. Analytic (no raycasts).
export function bowlOffsetAt(x, z) {
  const qx = Math.abs(x) - (BOWL_A - BOWL_R);
  const qz = Math.abs(z) - (BOWL_B - BOWL_R);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - BOWL_R;
}
// --- tier tables ---------------------------------------------------------------
// Balcony architecture: each upper tier starts INSIDE the tier below (its
// front overhangs the lower tier's last rows) and 3+ m above it, and the
// rake steepens tier by tier — the way real bowls stack.
// rakes follow real arena practice: ~27deg lower bowl, 32deg club, 36deg for
// both upper decks (36 is the standard maximum); balconies overhang about one
// row of the tier below — present, but an arena, not a theatre
// Tier tables come from the venue spec: the first tier is absolute, each
// later one starts `gapOff` beyond and `gapH` above the end of the tier below
// (gap 0/0 = a continuation tier). Same four-slot structure in both rooms —
// the stadium's upper tier is split by a mid-tier walkway like Wembley's.
const TIERS = [], ENDS = [];
for (const t of SPEC.bowl.tiers) {
  const prev = ENDS[ENDS.length - 1];
  const o0 = prev ? prev.off + t.gapOff : t.o0;
  const h0 = prev ? prev.h + t.gapH : t.h0;
  TIERS.push({ name: t.name, rows: t.rows, o0, h0, rise: t.rise, depth: t.depth });
  ENDS.push({ off: o0 + t.rows * t.depth, h: h0 + t.rows * t.rise });
}
const [T100, T200, T300, T400] = TIERS;
const [E100, E200, E300, E400] = ENDS;

// The section a seat at (x, z) belongs to: its tier, found by how far out it
// sits, and the aisle span it falls in on that tier's own section grid (the
// arena's 100s and 200s have 24 sections, its 300s and 400s 36). Suite
// terraces count with the tier below them. Null on the floor.
export function sectionAt(x, z) {
  const off = bowlOffsetAt(x, z);
  if (off < TIERS[0].o0 - 0.6) return null;
  let tier = 0;
  for (let i = TIERS.length - 1; i > 0; i--) if (off >= TIERS[i].o0 - 0.3) { tier = i; break; }
  const n = SPEC.bowl.tiers[tier].sections || SPEC.bowl.aisles;
  return { tier, n, span: spanAtBaseU(n, baseUAt(x, z)) };
}

// Where the lasers land: the fascia line of each upper tier and the top rim,
// as [plan offset, height] — the arena's literal rings scaled to whatever
// bowl this room has, so a stadium laser reaches its stands instead of dying
// at arena distance.
export function laserRings() {
  return [
    { off: T200.o0 - 0.3, y: T200.h0 - 0.6 },
    { off: T300.o0 - 0.3, y: T300.h0 - 0.6 },
    { off: E400.off, y: E400.h },
  ];
}

// --- the swoop -----------------------------------------------------------------
// A stadium's upper deck is not the same height all round: full along the
// sidelines, cut down behind the goals. nz² of the bowl's outward normal is
// 1 on the sidelines, 0 at the ends and blends through the corners, so the
// rows a tier keeps at any point is a function of it. Everything that walks
// rows — treads, seats, steps, rails, the rear wall, the ground query — asks
// rowsAt() instead of reading tier.rows.
const SWOOP = SPEC.bowl.swoop || null;
const TIER_COLORS = SPEC.bowl.tierColors || {};
// Continuation tiers (gap 0/0) form one stacked deck with the tier below.
// The swoop cuts a STACK from its top row down, so the rows that remain are
// always contiguous — cutting each tier on its own left a band of missing
// rows between the 300s and the 400s behind the goals.
const CONT = SPEC.bowl.tiers.map((t, i) => i > 0 && t.gapOff === 0 && t.gapH === 0);
const STACK_OF = TIERS.map((_, i) => { let j = i; while (CONT[j]) j--; return j; });   // index of the stack's base tier
export function rowsAtF(tier, nz2 = 1) {      // fractional: the smooth rim curve
  if (!SWOOP || !SWOOP.keep) return tier.rows;
  const ti = TIERS.indexOf(tier);
  const baseIdx = STACK_OF[ti];
  const stack = TIERS.filter((_, i) => STACK_OF[i] === baseIdx);
  if (!stack.some((t) => SWOOP.keep[t.name] != null)) return tier.rows;
  const full = stack.reduce((a, t) => a + t.rows, 0);
  const keep = stack.reduce((a, t) => a + (SWOOP.keep[t.name] ?? t.rows), 0);
  const f = Math.pow(Math.min(1, Math.max(0, nz2)), SWOOP.power ?? 1);
  const stackRows = keep + (full - keep) * f;
  const below = stack.filter((t) => TIERS.indexOf(t) < ti).reduce((a, t) => a + t.rows, 0);
  return Math.min(tier.rows, Math.max(0, stackRows - below));
}
export function rowsAt(tier, nz2 = 1) { return Math.round(rowsAtF(tier, nz2)); }   // whole rows: what gets built
// nz² of the outward normal of the bowl curve nearest to (x, z)
export function bowlNormalZ2(x, z) {
  const qx = Math.abs(x) - (BOWL_A - BOWL_R);
  const qz = Math.abs(z) - (BOWL_B - BOWL_R);
  if (qx > 0 && qz > 0) return (qz * qz) / (qx * qx + qz * qz);   // in a corner arc
  return qx > qz ? 0 : 1;                                          // nearest an end : a sideline
}
// the top of the bowl at a point: plan offset and tread height of its last row
// `smooth` follows the unrounded curve — for the rear wall and walkway, so
// the rim reads as one sweep instead of a staircase of row-steps
export function topEdgeAt(nz2 = 1, smooth = false) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    const t = TIERS[i], rows = smooth ? rowsAtF(t, nz2) : rowsAt(t, nz2);
    if (rows > 0) return { off: t.o0 + rows * t.depth, y: t.h0 - 0.35 + rows * t.rise + 0.12, tier: t };
  }
  return { off: 0, y: 0, tier: TIERS[0] };
}

export const BOWL_OUTER_OFF = E400.off + 1.2;   // the top walkway's outer edge
// Suite level between tiers: a terrace of 2 seat rows dropping from the suite
// floor to a glass rail, the room behind tucked under the next tier. Offsets
// are relative to the lower tier's end (eb.off), heights to its top (eb.h).
// SUITE_LIFT raises the whole suite block off the tier below, so the balcony
// front wall under the terrace glass grows from 0.77 m to 1.32 m and the VIP
// terrace no longer sits almost level with the last row of the bowl below.
// Folded into the offsets here rather than applied at the geometry, so the
// walking surface in bowlSurfacesAt() moves with it and never desyncs.
const SUITE_LIFT = 0.55;
const SUITE = {
  rail: 0.40, off0: 0.42, tA: 1.42, tB: 2.42, land: 3.02, back: 7.2,
  yA: 0.42 + SUITE_LIFT, yB: 0.87 + SUITE_LIFT, yF: 1.32 + SUITE_LIFT, yC: 3.42 + SUITE_LIFT,
};
const PEPS = 1e-4;
// Walking surface computed FROM the tier tables (never drifts out of sync).
// Balcony fronts are unclimbable jumps: the walker owns the lower bowl, upper
// tiers are reachable only by flying — like a real building without its
// stair cores modelled.
const WALK_PROFILE = (() => {
  const P = [[0.65, 0], [0.65 + PEPS, T100.h0 - 0.35 + 0.12]];
  const rowY = (t, off) => t.h0 - 0.35 + 0.12 + ((off - t.o0) / t.depth) * t.rise;
  P.push([E100.off, rowY(T100, E100.off)]);
  for (let i = 1; i < TIERS.length; i++) {
    const t = TIERS[i], eBelow = ENDS[i - 1], e = ENDS[i];
    const sw = eBelow.off + 0.35;               // the suite wall under the balcony
    P.push([sw, rowY(TIERS[i - 1], eBelow.off)]);
    P.push([sw + PEPS, Math.max(t.h0 - 0.35 + 0.12, rowY(t, sw))]);
    P.push([e.off, rowY(t, e.off)]);
  }
  P.push([BOWL_OUTER_OFF, P[P.length - 1][1]]);
  return P;
})();
// Every walkable surface at a plan offset — the bowl is multi-storey now
// (balconies over lower rows), so callers pick the level nearest their feet.
// Plan offset of the lower bowl's front wall — the vertical face the event
// floor runs up against. Exported so floor furniture can be clipped to it
// instead of guessing: the bowl's nominal inner edge is 0.65 m inside this.
export function frontWallOff() { return TIERS[0].o0 - 0.25; }

export function bowlSurfacesAt(off, nz2 = 1) {
  const out = [];
  if (off <= 0.65) { out.push(0); return out; }
  const rowRamp = (t, rows, o) => {
    const r = Math.min(Math.max((o - t.o0) / t.depth, 0), rows);
    return t.h0 - 0.35 + 0.12 + r * t.rise;
  };
  out.push(0 * 0 + (off <= E100.off + 0.35 ? rowRamp(T100, T100.rows, Math.min(off, E100.off)) : NaN));
  for (let i = 1; i < TIERS.length; i++) {
    const t = TIERS[i];
    const rows = rowsAt(t, nz2);                    // the swoop may leave no rows here
    if (rows <= 0) continue;
    const endOff = t.o0 + rows * t.depth;
    const lim = i === TIERS.length - 1 ? endOff + 1.2 : endOff + 0.35;
    const balc = t.h0 - ENDS[i - 1].h > 1;          // continuation tiers have no front walkway
    if (off >= t.o0 - (balc ? 0.05 : 0) && off <= lim) out.push(rowRamp(t, rows, Math.min(off, endOff)));
  }
  // suite level: terrace treads and the room floor between the tiers
  for (let i = 1; i < 3; i++) {
    const eb = ENDS[i - 1];
    const rel = off - eb.off;
    if (rel >= SUITE.off0 - 0.05 && rel <= SUITE.back) {
      const y = rel < SUITE.tA ? SUITE.yA : rel < SUITE.tB ? SUITE.yB : SUITE.yF;
      out.push(eb.h + y + 0.02);
    }
  }
  return out.filter((y) => isFinite(y));
}

export function bowlProfileY(off) {
  if (off <= WALK_PROFILE[0][0]) return 0;
  if (off >= BOWL_OUTER_OFF) return Infinity;
  for (let i = 1; i < WALK_PROFILE.length; i++) {
    if (off <= WALK_PROFILE[i][0]) {
      const [o0, y0] = WALK_PROFILE[i - 1], [o1, y1] = WALK_PROFILE[i];
      return y0 + (y1 - y0) * ((off - o0) / Math.max(o1 - o0, PEPS));
    }
  }
  return Infinity;
}

export function buildBowl(scene) {
  const A = BOWL_A, B = BOWL_B, R = BOWL_R;
  const SEGMENTS = SPEC.bowl.segments;
  const base = roundedRectPath(A, B, R, SEGMENTS);

  const AISLES = SPEC.bowl.aisles;
  const aisleW = 1.15;
  // packed tight: seats nearly touch on the straights and are allowed to
  // overlap slightly through the corners so no wedge gaps ever open up
  const pitchStraight = 0.53, pitchCorner = 0.50;   // ~21in seats, real arena spacing

  const [t100, t200, t300, t400] = TIERS;
  const [e100, e200, e300, e400] = ENDS;
  const tiers = TIERS;

  const slabGeos = [];
  const stepSpots = [];
  const seatSpots = [];
  // aisle anchors on the base curve; every row's aisle center is the anchor
  // pushed outward along its normal, so aisles stay radial across all rows
  // Anchors are spaced evenly along the curve at plan offset D (0 = the front
  // wall, the arena's habit). A stadium spaces them at the top of its lower
  // deck: the corner arc is far longer out there than at the wall, so the
  // corners get their fair share of stairs and the straights stop being
  // chopped into slivers. Every aisle is still a radial line from its anchor.
  const D = SPEC.bowl.aisleOffset || 0;
  const arcS = (off) => {
    const out = [0];
    for (let i = 1; i <= SEGMENTS; i++) {
      const a = base[(i - 1) % SEGMENTS], c = base[i % SEGMENTS];
      out.push(out[i - 1] + Math.hypot((c.x + c.nx * off) - (a.x + a.nx * off), (c.z + c.nz * off) - (a.z + a.nz * off)));
    }
    return out;
  };
  const idxAtArc = (arr, target) => { let i = 0; while (i < SEGMENTS - 1 && arr[i + 1] < target) i++; return i; };
  const sD = arcS(D);
  // Levels no longer share one aisle ring: the seating chart gives the 100s and
  // 200s 24 sections and the 300s and 400s 36, so anchors are resolved per
  // section count. AISLES stays the base (100-level) ring, which is the grid
  // the behind-stage tarps and the C-stage are indexed against.
  const idxOfCount = (n) => {
    const out = [];
    for (let k = 0; k < n; k++) out.push(Math.round(aisleU(n, k) * SEGMENTS) % SEGMENTS);
    return out;
  };
  const aisleIdx = idxOfCount(AISLES);
  const aisleAnchor = aisleIdx.map((i) => base[i]);
  // Per tier: where a section's FRONT row is wider than maxSectionW, split it
  // with mid-section stairs (corner sections in the upper deck, mostly). A
  // continuation tier inherits the stairs of the tier it continues, so they
  // run straight through the mid-deck walkway.
  const anchorCache = [];
  const anchorsFor = (tierIdx) => {
    if (anchorCache[tierIdx]) return anchorCache[tierIdx];
    const maxW = SPEC.bowl.maxSectionW;
    // a continuation tier shares the deck below it, so it shares its stairs
    if (CONT[tierIdx]) return (anchorCache[tierIdx] = anchorsFor(tierIdx - 1));
    const n = SPEC.bowl.tiers[tierIdx].sections || AISLES;
    const idxN = n === AISLES ? aisleIdx : idxOfCount(n);
    let out;
    if (!maxW) out = n === AISLES ? aisleAnchor : idxN.map((i) => base[i]);
    else {
      const t = tiers[tierIdx], sT = arcS(t.o0), total = sT[SEGMENTS];
      out = [];
      for (let k = 0; k < n; k++) {
        const i0 = idxN[k], i1 = idxN[(k + 1) % n];
        out.push(base[i0]);
        let w = sT[i1] - sT[i0];
        if (w <= 0) w += total;
        const parts = Math.ceil(w / maxW);
        for (let j = 1; j < parts; j++) {
          let target = sT[i0] + (w * j) / parts;
          if (target >= total) target -= total;
          out.push(base[idxAtArc(sT, target)]);
        }
      }
    }
    anchorCache[tierIdx] = out;
    return out;
  };

  // --- vomitories, placed the way real bowls place them (Bell Centre chart):
  // at the TOP rows of the 100s (feeding the concourse under the 200 balcony),
  // at the ENTRY rows of the 300s, and mid-tier in the 400s — every mouth
  // centred midway between two aisles so the stair runs flank it.
  const VOMS = (SPEC.bowl.voms || []).map((v) => ({ ...v }));   // tunnel portals, per venue
  for (const v of VOMS) {
    const t = TIERS[v.tier];
    v.a = base[Math.round(v.u * SEGMENTS) % SEGMENTS];
    v.off0 = t.o0 + v.r0 * t.depth;
    v.off1 = t.o0 + (v.r1 + 1) * t.depth;
  }
  const VOM_HALFW = 1.9;                      // tangential half width
  const railGeos = [];                        // black handrails, merged later
  const vomWallGeos = [];                     // concrete mouth walls
  const vomDarkGeos = [];                     // tunnel interior (dark)
  const glassGeos = [];                       // balcony-front glass borders

  for (const [tierIdx, tier] of tiers.entries()) {
    const tierAisles = anchorsFor(tierIdx);
    // terraced rows — a flat tread under every seat row with a vertical riser
    // between rows. Rows crossing a vomitory footprint are genuinely CUT: the
    // strips skip those spans, so the wells read as real openings.
    const holeSpans = (row) => {
      const spans = [];
      for (const v of VOMS) {
        if (v.tier !== tierIdx || row < v.r0 || row > v.r1) continue;
        const per = perimeterAt(A, B, R, tier.o0 + row * tier.depth);
        const hu = (VOM_HALFW + 0.32) / per;
        let a = v.u - hu, c = v.u + hu;
        if (a < 0) { spans.push([a + 1, 1]); a = 0; }
        if (c > 1) { spans.push([0, c - 1]); c = 1; }
        spans.push([a, c]);
      }
      return spans.sort((p, q) => p[0] - q[0]);
    };
    const emitRing = (spans, off1, y1, off2, y2) => {
      if (!spans.length) { slabGeos.push(ringStrip(base, off1, y1, off2, y2)); return; }
      let u = 0;
      for (const [a, c] of spans) {
        if (a > u + 1e-4) slabGeos.push(pathStrip(base, u, a, off1, y1, off2, y2));
        u = Math.max(u, c);
      }
      if (u < 1 - 1e-4) slabGeos.push(pathStrip(base, u, 1, off1, y1, off2, y2));
    };
    // rows above the swoop's keep-count exist only where the deck is tall
    // enough: runs of path points where this row is missing become holes
    const swoopHoles = (row) => {
      if (!SWOOP) return [];
      const n = base.length, out = [];
      let start = -1;
      for (let i = 0; i <= n; i++) {
        const missing = i < n && rowsAt(tier, base[i].nz * base[i].nz) <= row;
        if (missing && start < 0) start = i;
        if (!missing && start >= 0) { out.push([start / n, i / n]); start = -1; }
      }
      return out;
    };
    for (let row = 0; row < tier.rows; row++) {
      const offA = row === 0 ? tier.o0 - 0.25 : tier.o0 + row * tier.depth - 0.1;
      const offB = tier.o0 + (row + 1) * tier.depth - 0.1;
      const yT = tier.h0 - 0.35 + row * tier.rise + 0.12;
      const spans = [...holeSpans(row), ...swoopHoles(row)].sort((p, q) => p[0] - q[0]);
      emitRing(spans, offA, yT, offB, yT);                                 // tread
      emitRing(spans, offA, yT - tier.rise - 0.12, offA, yT);              // riser
    }
    if (tier.name === '100') {
      slabGeos.push(ringStrip(base, tier.o0 - 0.25, 0.0, tier.o0 - 0.25, tier.h0 - 0.35));
    }

    // MEASURED PER ROW. Stations used to be laid out once on the tier's middle
    // row and reused as normalised path fractions, which quietly broke density:
    // a row's perimeter grows by 2*PI per metre it sits further out, so the
    // same fractions mean tight seats at the front of a tier and loose ones at
    // the back. On the 22-row 100s that is ~24% over-dense in row A and ~21%
    // under-dense in the last row — exactly the "100s look packed, 400s look
    // empty" problem. Each row now steps its OWN arc at the true seat pitch,
    // so spacing is identical everywhere. The total barely moves: perimeter is
    // linear in offset, so the sum over a tier's rows equals what the middle
    // row was already predicting.
    const rowSegs = 384;
    for (let row = 0; row < tier.rows; row++) {
      const off = tier.o0 + row * tier.depth + 0.3;
      const slabY = tier.h0 - 0.35 + row * tier.rise + 0.12;
      const rowPath = roundedRectPath(A + off, B + off, R + off, rowSegs);
      const rowSegLen = rowPath.total / rowSegs;
      const stations = [];
      {
        let arcM = 0;
        while (arcM < rowPath.total) {
          const p = rowPath[Math.round(arcM / rowSegLen) % rowSegs];
          stations.push(arcM / rowPath.total);
          arcM += p.corner ? pitchCorner : pitchStraight;
        }
      }

      // world positions of the aisles crossing this row
      const rowAisles = tierAisles.map((p) => ({
        x: p.x + p.nx * off, z: p.z + p.nz * off,
      }));
      for (const u of stations) {
        const p = pathAt(rowPath, rowSegs, u);
        if (rowsAt(tier, p.nz * p.nz) <= row) continue;   // cut away by the swoop

        const px = p.x, pz = p.z;
        const clear = aisleW / 2 + 0.24;
        let blocked = false;
        for (let k = 0; k < rowAisles.length; k++) {
          const dx = px - rowAisles[k].x, dz = pz - rowAisles[k].z;
          if (dx * dx + dz * dz < clear * clear) { blocked = true; break; }
        }
        // vomitory footprints swallow their seats
        if (!blocked) {
          for (const v of VOMS) {
            if (v.tier !== tierIdx || off < v.off0 - 0.55 || off > v.off1 + 0.35) continue;
            const dx = px - v.a.x, dz = pz - v.a.z;
            if (Math.abs(dx * v.a.nz - dz * v.a.nx) < VOM_HALFW + 0.45) { blocked = true; break; }
          }
        }
        if (blocked) continue;

        seatSpots.push({ x: px, z: pz, y: slabY, yaw: Math.atan2(p.nx, p.nz), t: tierIdx });
      }

      for (const p of tierAisles) {
        if (rowsAt(tier, p.nz * p.nz) <= row) continue;
        for (const half of [0, 0.5]) {
          const o = tier.o0 + (row + half) * tier.depth - 0.1;
          stepSpots.push({
            x: p.x + p.nx * o, z: p.z + p.nz * o,
            y: tier.h0 - 0.35 + (row + half) * tier.rise + 0.05,
            yaw: Math.atan2(p.nx, p.nz),
          });
        }
      }
    }

    // centre handrail up every aisle of this tier: a pitched top tube with
    // three vertical posts — the black rails from every real bowl
    for (const p of tierAisles) {
      const yaw = Math.atan2(p.nx, p.nz);
      const pitch = Math.atan2(tier.rise, tier.depth);
      const rowsHere = rowsAt(tier, p.nz * p.nz);
      if (rowsHere <= 0) continue;
      const o0 = tier.o0 - 0.05, o1 = tier.o0 + rowsHere * tier.depth - 0.15;
      const y0 = tier.h0 - 0.35 + 0.12, y1 = y0 + rowsHere * tier.rise;
      const runLen = Math.hypot(o1 - o0, y1 - y0);
      const tube = new THREE.BoxGeometry(0.055, 0.075, runLen);
      tube.rotateX(-pitch);
      tube.rotateY(yaw);
      tube.translate(p.x + p.nx * (o0 + o1) / 2, (y0 + y1) / 2 + 0.92, p.z + p.nz * (o0 + o1) / 2);
      railGeos.push(tube);
      for (const f of [0.08, 0.5, 0.92]) {
        const o = o0 + (o1 - o0) * f;
        const y = y0 + (y1 - y0) * f;
        const post = new THREE.CylinderGeometry(0.028, 0.028, 0.92, 6);
        post.translate(p.x + p.nx * o, y + 0.46, p.z + p.nz * o);
        railGeos.push(post);
      }
    }
  }

  // --- vomitory wells -----------------------------------------------------------
  // The terraces above are genuinely cut, so each vomitory is an OPEN sunken
  // stairwell: concrete cheek walls closing the cut edges and rising as
  // parapets, a rear parapet, a stepped dark floor descending to a black
  // portal at the down-slope end, and handrails all round — the reference
  // construction photo, in miniature.
  for (const v of VOMS) {
    const t = TIERS[v.tier];
    const pitch = Math.atan2(t.rise, t.depth);
    const yAt = (off) => t.h0 - 0.35 + ((off - t.o0) / t.depth) * t.rise + 0.12;
    const va = v.a;
    const yaw = Math.atan2(va.nx, va.nz);
    const offC = (v.off0 + v.off1) / 2;
    const midY = (yAt(v.off0) + yAt(v.off1)) / 2;
    const cx = va.x + va.nx * offC, cz = va.z + va.nz * offC;
    const tx = va.nz, tz = -va.nx;
    const runLen = (v.off1 - v.off0) / Math.cos(pitch) + 0.7;
    const place = (geo, dxT, dy, raked = true) => {
      if (raked) geo.rotateX(-pitch);
      geo.rotateY(yaw);
      geo.translate(cx + tx * dxT, midY + dy, cz + tz * dxT);
      return geo;
    };
    // cheek walls: cover the cut strip edges below AND stand 1.0 proud as parapets
    vomWallGeos.push(place(new THREE.BoxGeometry(0.26, 2.8, runLen), -(VOM_HALFW + 0.18), 0.15));
    vomWallGeos.push(place(new THREE.BoxGeometry(0.26, 2.8, runLen), VOM_HALFW + 0.18, 0.15));
    // rear parapet (up-slope edge of the well)
    {
      const g = new THREE.BoxGeometry(VOM_HALFW * 2 + 0.6, 1.55, 0.26);
      g.rotateY(yaw);
      g.translate(va.x + va.nx * (v.off1 + 0.3), yAt(v.off1 + 0.3) + 0.35, va.z + va.nz * (v.off1 + 0.3));
      vomWallGeos.push(g);
    }
    // the well floor: stepped dark stair run descending toward the portal
    const steps = 8;
    for (let s = 0; s < steps; s++) {
      const o = v.off1 - ((s + 0.5) / steps) * (v.off1 - v.off0);
      const yStep = yAt(o) - 0.5 - ((steps - s) / steps) * 0.9;
      const g = new THREE.BoxGeometry(VOM_HALFW * 2 - 0.08, 0.14, (v.off1 - v.off0) / steps + 0.06);
      g.rotateY(yaw);
      g.translate(va.x + va.nx * o, yStep, va.z + va.nz * o);
      vomDarkGeos.push(g);
    }
    // interior faces of the cut: dark liners under the cheek parapets
    vomDarkGeos.push(place(new THREE.BoxGeometry(0.05, 2.4, runLen - 0.1), -(VOM_HALFW - 0.02), -0.35));
    vomDarkGeos.push(place(new THREE.BoxGeometry(0.05, 2.4, runLen - 0.1), VOM_HALFW - 0.02, -0.35));
    // black portal at the down-slope end (the tunnel under the rows below)
    {
      const g = new THREE.BoxGeometry(VOM_HALFW * 2 - 0.1, 2.0, 0.14);
      g.rotateY(yaw);
      g.translate(va.x + va.nx * (v.off0 - 0.15), yAt(v.off0) - 0.65, va.z + va.nz * (v.off0 - 0.15));
      vomDarkGeos.push(g);
    }
    // portal header (concrete lintel above the mouth)
    {
      const g = new THREE.BoxGeometry(VOM_HALFW * 2 + 0.55, 0.42, 0.3);
      g.rotateY(yaw);
      g.translate(va.x + va.nx * (v.off0 - 0.15), yAt(v.off0) + 0.48, va.z + va.nz * (v.off0 - 0.15));
      vomWallGeos.push(g);
    }
    // handrails: both parapet tops + across the rear
    for (const sT of [-1, 1]) {
      railGeos.push(place(new THREE.BoxGeometry(0.05, 0.06, runLen + 0.15), sT * (VOM_HALFW + 0.18), 1.6));
    }
    {
      const g = new THREE.BoxGeometry(VOM_HALFW * 2 + 0.7, 0.06, 0.05);
      g.rotateY(yaw);
      g.translate(va.x + va.nx * (v.off1 + 0.3), yAt(v.off1 + 0.3) + 1.18, va.z + va.nz * (v.off1 + 0.3));
      railGeos.push(g);
    }
  }

  // Suite level: the ring between each pair of tiers. Runs as CONTINUOUS
  // ring strips (floor bands, glass, back wall, roof) so it reads as one
  // unbroken belt of suites; radial divider walls at a fixed pitch cut it
  // into rooms of identical width, each with its own 2x4 seat terrace in
  // front of the glass — the reference-photo layout.
  const suiteShellGeos = [], suiteLitGeos = [], suiteGlassGeos = [];
  const suiteDarkGeos = [], suiteGlowGeos = [], suiteCeilGeos = [];
  const suiteFloorGeos = [], suiteWallGeos = [];
  for (let i = 1; i < 3; i++) {
    const t = TIERS[i], eb = ENDS[i - 1];
    const S = SUITE, oB = eb.off, yB0 = eb.h;
    const yA = yB0 + S.yA, yBt = yB0 + S.yB, yF = yB0 + S.yF, yC = yB0 + S.yC;
    // aisle strip in front of the terrace rail, level with the tier walkway
    slabGeos.push(ringStrip(base, oB - 0.05, yB0 - 0.35, oB + S.rail, yB0 - 0.35));
    // terrace: two treads and a landing, each with its riser face
    slabGeos.push(ringStrip(base, oB + S.off0, yB0 - 0.35, oB + S.off0, yA));
    slabGeos.push(ringStrip(base, oB + S.off0, yA, oB + S.tA, yA));
    slabGeos.push(ringStrip(base, oB + S.tA, yA, oB + S.tA, yBt));
    slabGeos.push(ringStrip(base, oB + S.tA, yBt, oB + S.tB, yBt));
    slabGeos.push(ringStrip(base, oB + S.tB, yBt, oB + S.tB, yF));
    slabGeos.push(ringStrip(base, oB + S.tB, yF, oB + S.land, yF));
    // terrace fall-protection glass at the rail + cap
    glassGeos.push(ringStrip(base, oB + S.rail, yA - 0.02, oB + S.rail, yA + 0.92));
    railGeos.push(ringStrip(base, oB + S.rail - 0.05, yA + 0.92, oB + S.rail + 0.05, yA + 0.98));
    // the room: floor, warm ceiling liner, roof slab, warm back wall
    suiteFloorGeos.push(ringStrip(base, oB + S.land, yF + 0.01, oB + S.back, yF + 0.01, true));
    suiteCeilGeos.push(ringStrip(base, oB + S.land, yC - 0.05, oB + S.back - 0.05, yC - 0.05, true));
    slabGeos.push(ringStrip(base, oB + S.land - 0.08, yC + 0.09, oB + S.back + 0.1, yC + 0.09));
    suiteWallGeos.push(ringStrip(base, oB + S.back, yF, oB + S.back, yC, true));
    // suite front: continuous knee wall; the glass above is built PER SUITE
    // in the fit-out loop so every room keeps an open doorway to its terrace
    slabGeos.push(ringStrip(base, oB + S.land, yF, oB + S.land, yF + 0.68));
    // face above the suites: concrete backer behind the LED fascia band, and
    // the tier-front glass over the first row of the next tier
    slabGeos.push(ringStrip(base, t.o0 + 0.06, yC + 0.09, t.o0 + 0.06, t.h0 - 0.15));
    glassGeos.push(ringStrip(base, t.o0 - 0.05, t.h0 - 0.16, t.o0 - 0.05, t.h0 + 0.36));
    railGeos.push(ringStrip(base, t.o0 - 0.1, t.h0 + 0.36, t.o0, t.h0 + 0.42));

    // per-suite fit-out at a fixed pitch measured along the SUITE ring, not
    // the base path — base-u spacing stretches through the corners and left
    // bare void zones there. Equal arc steps fill every corner with a room.
    const ring = base.map((q) => ({
      x: q.x + q.nx * (oB + S.land), z: q.z + q.nz * (oB + S.land), nx: q.nx, nz: q.nz,
    }));
    const cum = [0];
    for (let k = 1; k <= SEGMENTS; k++) {
      const a0 = ring[(k - 1) % SEGMENTS], a1 = ring[k % SEGMENTS];
      cum.push(cum[k - 1] + Math.hypot(a1.x - a0.x, a1.z - a0.z));
    }
    const per = cum[SEGMENTS];
    const anchorAt = (sArc) => {
      let lo = 0, hi = SEGMENTS;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid + 1] < sArc) lo = mid + 1; else hi = mid; }
      const a0 = ring[lo % SEGMENTS], a1 = ring[(lo + 1) % SEGMENTS];
      const f = Math.min(1, Math.max(0, (sArc - cum[lo]) / Math.max(cum[lo + 1] - cum[lo], 1e-6)));
      const nx = a0.nx + (a1.nx - a0.nx) * f, nz = a0.nz + (a1.nz - a0.nz) * f;
      const nl = Math.hypot(nx, nz) || 1;
      return { x: a0.x + (a1.x - a0.x) * f, z: a0.z + (a1.z - a0.z) * f, nx: nx / nl, nz: nz / nl };
    };
    const nSuites = Math.max(12, Math.round(per / 7.4));
    const sw = per / nSuites - 0.16;
    for (let k = 0; k < nSuites; k++) {
      const p = anchorAt(((k + 0.5) / nSuites) * per);
      const yaw = Math.atan2(-p.nz, p.nx);
      // box(depth, height, width, radial centre from eb.off, y centre, tangential)
      // p sits at the suite glass line (oB + S.land), so radial = ro - S.land
      const put = (arr, d, h, w, ro, yc, tz = 0) => {
        const g = new THREE.BoxGeometry(d, h, w);
        g.rotateY(yaw);
        g.translate(
          p.x + p.nx * (ro - S.land) - p.nz * tz, yc,
          p.z + p.nz * (ro - S.land) + p.nx * tz);
        arr.push(g);
      };
      // dividers: waist-high through the terrace, full height through the room
      put(suiteShellGeos, S.land - S.off0, 1.02, 0.14, (S.off0 + S.land) / 2, yA + 0.51);
      put(suiteShellGeos, S.back - S.land + 0.1, yC - yF, 0.16, (S.land + S.back) / 2, (yF + yC) / 2);
      // the terrace seats: 2 rows x 4 through the SEAT PIPELINE, so each one
      // is a real seat with a light-up orb above it and a crowd figure on it
      for (let r = 0; r < 2; r++) {
        const ro = r === 0 ? (S.off0 + S.tA) / 2 + 0.1 : (S.tA + S.tB) / 2 + 0.1;
        const ty = r === 0 ? yA : yBt;
        for (let q = 0; q < 4; q++) {
          const tz = (q - 1.5) * (sw / 4.4);
          seatSpots.push({
            x: p.x + p.nx * (ro - S.land) - p.nz * tz,
            z: p.z + p.nz * (ro - S.land) + p.nx * tz,
            y: ty + 0.02, yaw: Math.atan2(p.nx, p.nz), t: 4, dark: true,
          });
        }
      }
      // inside: bar counter along the back wall with a lit top, stools,
      // a TV that glows a touch brighter than the wall, two ceiling pendants
      put(suiteDarkGeos, 0.55, 0.95, sw - 1.1, S.back - 0.5, yF + 0.49);
      put(suiteLitGeos, 0.6, 0.05, sw - 1.05, S.back - 0.5, yF + 0.99);
      put(suiteGlowGeos, 0.04, 0.62, 1.15, S.back - 0.12, yC - 0.95);
      for (const sgn of [-1, 1]) {
        put(suiteGlowGeos, 0.65, 0.05, 0.13, S.land + 1.7, yC - 0.28, sgn * sw / 4.6);
      }
      for (let q = 0; q < 3; q++) {
        put(suiteDarkGeos, 0.32, 0.62, 0.32, S.back - 1.5, yF + 0.32, (q - 1) * (sw / 4));
      }
      // entry: a dark walnut door set in a lit frame, punched into the back
      // wall off-centre — the suite reads as a room you walk into, not a box
      put(suiteLitGeos, 0.07, 2.12, 1.14, S.back - 0.09, yF + 1.06, sw * 0.32);
      put(suiteDarkGeos, 0.1, 2.02, 0.98, S.back - 0.12, yF + 1.01, sw * 0.32);
      // front glass panel with a ~1.2 m opening onto the terrace: the glass
      // covers most of the width, the gap by the divider is the way out
      put(suiteGlassGeos, 0.05, yC - (yF + 0.68), sw - 1.25, S.land,
        (yF + 0.68 + yC) / 2, -0.58);
    }
  }
  // top walkway + outer wall to the (raised) roof. The wall gets its own
  // precast-panel bake instead of riding the tread concrete: 4 m panels along
  // the ring (u-repeat perimeter/4) and the seam grid reads at eye height.
  if (SWOOP) {
    // walkway and wall ride the local top row: tall on the sidelines, low
    // behind the goals, sloping through the corners
    // inner edge sits on the last BUILT row, outer edge on the smooth curve
    slabGeos.push(ringStripFn(base, (p) => { const t = topEdgeAt(p.nz * p.nz); return [t.off, t.y - 0.35]; },
      (p) => { const t = topEdgeAt(p.nz * p.nz, true); return [t.off + 1.2, t.y - 0.35]; }));
  } else {
    slabGeos.push(ringStrip(base, e400.off, e400.h - 0.35, e400.off + 1.2, e400.h - 0.35));
  }
  const panelTex = makeUltraWallPanel();
  liftBake(panelTex.map, 2.7);
  panelTex.map.anisotropy = 8;
  const wallRepU = Math.max(1, Math.round(perimeterAt(A, B, R, e400.off + 1.2) / 4));
  const wallRepV = Math.max(1, Math.round((SWOOP ? e400.h + (SPEC.bowl.parapet ?? 3.4) : SPEC.bowl.wallTop - (e400.h - 0.35)) / 4));
  panelTex.map.repeat.set(wallRepU, wallRepV);
  const outerWall = new THREE.Mesh(
    // open-air bowl: the rear wall is the building's facade, ground to
    // parapet, riding the smooth rim curve
    SWOOP
      ? ringStripFn(base,
        (p) => { const t = topEdgeAt(p.nz * p.nz, true); return [t.off + 1.2, 0]; },
        (p) => { const t = topEdgeAt(p.nz * p.nz, true); return [t.off + 1.2, t.y + (SPEC.bowl.parapet ?? 3.4)]; })
      : ringStrip(base, e400.off + 1.2, e400.h - 0.35, e400.off + 1.2, SPEC.bowl.wallTop),
    new THREE.MeshStandardMaterial({
      map: panelTex.map, roughness: 0.94, side: THREE.DoubleSide,
    }));
  scene.add(outerWall);

  const slabs = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(slabGeos), concreteMat);
  slabs.receiveShadow = true;
  scene.add(slabs);

  // handrails, vomitory walls and tunnel voids — three merged draw calls
  const railMat = new THREE.MeshLambertMaterial({ color: 0x141518 });
  scene.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(railGeos), railMat));
  if (vomWallGeos.length) {
    scene.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(vomWallGeos), concreteMat));
  }
  if (vomDarkGeos.length) {
    scene.add(new THREE.Mesh(
      BufferGeometryUtils.mergeGeometries(vomDarkGeos),
      new THREE.MeshBasicMaterial({ color: 0x050507 })
    ));
  }

  // VIP suites: two rings of hollow rooms under the 200/300 balconies.
  // Five merged meshes — shell, lit interior, glass, fit-out, screens.
  const suites = new THREE.Mesh(
    BufferGeometryUtils.mergeGeometries(suiteShellGeos), concreteMat);
  suites.userData.help = { name: 'VIP suites', blurb: 'Hollow luxury boxes, each with its own 2x4 seat terrace. Lights toggle on the VENUE page.' };
  scene.add(suites);
  // A warm, DIM interior: the rooms have their lights on but must not read as
  // white voids from across the arena — the fit-out silhouettes against them.
  const suiteLitMat = new THREE.MeshBasicMaterial({ color: 0x6d5738 });
  scene.add(new THREE.Mesh(
    BufferGeometryUtils.mergeGeometries(suiteLitGeos), suiteLitMat));
  scene.add(new THREE.Mesh(
    BufferGeometryUtils.mergeGeometries(suiteDarkGeos),
    new THREE.MeshBasicMaterial({ color: 0x1a1512 })));
  const suiteCeilMat = new THREE.MeshBasicMaterial({ color: 0x554a3e });   // warm lamplit ceiling
  scene.add(new THREE.Mesh(
    BufferGeometryUtils.mergeGeometries(suiteCeilGeos), suiteCeilMat));
  const carpetTex = makeSuiteCarpet();
  carpetTex.repeat.set(150, 1);
  const suiteCarpetMat = new THREE.MeshBasicMaterial({ map: carpetTex, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(
    BufferGeometryUtils.mergeGeometries(suiteFloorGeos), suiteCarpetMat));
  const wallTex = makeSuiteWall();
  wallTex.repeat.set(220, 1);
  const suiteWallMat = new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(
    BufferGeometryUtils.mergeGeometries(suiteWallGeos), suiteWallMat));
  const suiteGlow = new THREE.MeshBasicMaterial({ color: 0xffeccb });
  suiteGlow.color.multiplyScalar(1.32);
  // Suite house lights: everything in the rooms is baked-lit MeshBasic, so
  // "lights off" is a straight retint of those materials to night levels.
  // tint: a THREE.Color the lights take on (the show's colour), or null for lamplight
  function setSuiteLights(on, tint = null) {
    suiteLitMat.color.setHex(on ? 0x6d5738 : 0x0e0c0a);
    suiteCeilMat.color.setHex(on ? 0x554a3e : 0x0c0b0a);
    suiteGlow.color.setHex(0xffeccb).multiplyScalar(on ? 1.32 : 0.05);
    if (on && tint) {
      suiteLitMat.color.copy(tint).multiplyScalar(0.55);
      suiteCeilMat.color.copy(tint).multiplyScalar(0.4);
      suiteGlow.color.copy(tint).multiplyScalar(1.32);
    }
    suiteCarpetMat.color.setScalar(on ? 1 : 0.14);
    suiteWallMat.color.setScalar(on ? 1 : 0.14);
  }
  scene.add(new THREE.Mesh(
    BufferGeometryUtils.mergeGeometries(suiteGlowGeos), suiteGlow));
  scene.add(new THREE.Mesh(
    BufferGeometryUtils.mergeGeometries(suiteGlassGeos),
    new THREE.MeshBasicMaterial({
      color: 0x2c3238, transparent: true, opacity: 0.24,
      side: THREE.DoubleSide, depthWrite: false,
    })));
  // balcony glass: one merged transparent sheet ring per tier front
  const glass = new THREE.Mesh(
    BufferGeometryUtils.mergeGeometries(glassGeos),
    new THREE.MeshBasicMaterial({
      color: 0x2c3238, transparent: true, opacity: 0.3,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  glass.renderOrder = 4;
  scene.add(glass);

  // LED fascia rings. repeat.x comes from each ring's own perimeter so the ad
  // plates land at their natural aspect instead of being stretched about 6x.
  const fascias = [];
  // `fascia.h` is the ribbon's height and `fascia.accentH` the painted band
  // directly beneath it, in `fascia.accent`. The reference bowls run a tall
  // continuous ribbon over a club-colour band on every tier front, and that
  // stacked pair is what reads as the room's identity from any seat.
  // The band stack hangs BELOW the tier line: topGap, then the ribbon, then the
  // painted band. Its total depth has to fit the gap above the suite roof slab
  // or it grows down across the suite windows.
  const FS = SPEC.bowl.fascia || {};
  const FH = FS.h ?? 0.66;
  const FTOP = FS.topGap ?? 0.26;
  const accentGeos = [];
  const fascia = (offset, yTop, seed) => {
    const tex = makeFasciaTexture(seed);
    const tiles = Math.max(1, Math.round(perimeterAt(A, B, R, offset) / FASCIA_TILE_M));
    tex.repeat.set(tiles, 1);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    mat.color.setScalar(1.25);
    const mesh = new THREE.Mesh(ringStrip(base, offset, yTop - FH, offset, yTop, true), mat);
    scene.add(mesh);
    fascias.push({ mesh, adsTex: tex, tiles });
    if (FS.accentH) {
      // 1 cm proud of the ribbon so the two never z-fight along the seam
      accentGeos.push(ringStrip(base, offset + 0.01, yTop - FH - FS.accentH, offset + 0.01, yTop - FH, true));
    }
  };
  // Mounted 0.3 m PROUD of the tier line. The suite roof slab reaches to
  // t.o0 - 0.28, so a ring flush with the tier sat a few centimetres behind it
  // and the slab occluded the ads from every seat in the bowl.
  fascia(t200.o0 - 0.34, t200.h0 - FTOP, 0);
  fascia(t300.o0 - 0.34, t300.h0 - FTOP, 2);
  if (accentGeos.length) {
    scene.add(new THREE.Mesh(
      BufferGeometryUtils.mergeGeometries(accentGeos),
      // tucked under the ribbon's overhang it got no house light and read
      // black; real fascia signage below an LED ribbon is lit, so it carries a
      // modest emissive of its own — kept under the 1.25 bloom gate
      new THREE.MeshStandardMaterial({
        color: FS.accent ?? 0xc8102e, roughness: 0.7, side: THREE.DoubleSide,
        emissive: FS.accent ?? 0xc8102e, emissiveIntensity: 0.5,
      })
    ));
  }

  // --- painted section numbers -----------------------------------------------
  // The seating chart's numbering only means anything if you can read it from a
  // seat, so every level carries its own numbers where the reference building
  // paints them: on the tier-front band under the LED ribbon for the 200s and
  // 300s, on the balcony riser behind the last row of the 100s, and on the rear
  // wall above the 400s. One small quad per section, centred between its two
  // stairs, all merged into a single mesh per level.
  //
  // The plate's local +x follows the path, which runs LEFT TO RIGHT across the
  // view from inside the bowl, so the cell UVs go on unmirrored.
  const LABEL_MIRROR = false;
  const signs = [];   // the plates' materials: a blackout takes them down with everything else
  function sectionPlates(n, base1, off, yMid, w, h) {
    const cols = 6, rows = Math.ceil(n / cols);
    const tex = makeSectionNumberAtlas(n, cols, rows, (j) => sectionLabel(n, j, base1),
      '#' + (FS.accent ?? 0xa8102a).toString(16).padStart(6, '0'));
    const geos = [];
    for (let j = 0; j < n; j++) {
      const q = pathAt(base, SEGMENTS, ringUToBaseU((j + 1 + aislePhase(n)) / n, AISLE_OFF));
      const g = new THREE.PlaneGeometry(w, h);
      const cx = j % cols, cy = Math.floor(j / cols);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        const su = LABEL_MIRROR ? 1 - uv.getX(i) : uv.getX(i);
        uv.setXY(i, (cx + su) / cols, (rows - 1 - cy + uv.getY(i)) / rows);
      }
      g.rotateY(Math.atan2(-q.nx, -q.nz));          // face the bowl
      g.translate(q.x + q.nx * off, yMid, q.z + q.nz * off);
      geos.push(g);
    }
    // Basic, like the ribbon above it: painted signage has to stay legible
    // when the house lights are down, and it must not reach the 1.25 bloom gate
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    signs.push(mat);
    scene.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(geos), mat));
  }
  if (SPEC.bowl.sectionLabels) {
    const nOf = (i) => SPEC.bowl.tiers[i].sections || AISLES;
    // 100s: the balcony riser under the suite terrace, behind the last row —
    // high on that wall, or the back row's seat backs cut the digits in half
    sectionPlates(nOf(0), 101, e100.off + SUITE.off0 - 0.04, e100.h + 0.63, 1.4, 0.5);
    // 200s / 300s: the accent band beneath each tier's LED ribbon
    sectionPlates(nOf(1), 201, t200.o0 - 0.37, t200.h0 - FTOP - FH - (FS.accentH ?? 0.3) / 2, 0.9, 0.26);
    sectionPlates(nOf(2), 301, t300.o0 - 0.37, t300.h0 - FTOP - FH - (FS.accentH ?? 0.3) / 2, 0.9, 0.26);
    // 400s: a continuation tier with no band of its own, so the rear wall
    if (!SWOOP) sectionPlates(nOf(3), 401, e400.off + 1.15, e400.h + 1.0, 1.8, 0.7);
  }

  // seats: pan + backrest merged, one instanced draw call.
  // local -z faces the rink (yaw = atan2(nx, nz) maps local +z to the
  // outward normal), so the backrest sits on the outward side.
  // sized to nearly fill the 0.50 m station pitch so rows read as a solid
  // band of chairs, not sparse pegs
  const pan = new THREE.BoxGeometry(0.48, 0.1, 0.45);
  pan.translate(0, 0.4, -0.02);
  const backrest = new THREE.BoxGeometry(0.48, 0.52, 0.085);
  backrest.translate(0, 0.68, 0.2);
  const seatGeo = BufferGeometryUtils.mergeGeometries([pan, backrest]);
  // moulded-plastic shading multiplies each seat's instance colour: edge AO,
  // a soft centre highlight and ergonomic grooves instead of a flat slab.
  // Physical + clearcoat so sweeping rig light glints off the shells the way
  // stadium plastic actually does.
  // Standard, not Physical: clearcoat across 21k instances costs real frame
  // time. Roughness stays HIGH — thousands of identically-angled backrests
  // catch a spotlight's specular lobe all at once, and anything glossier
  // than this blows the whole section past the bloom gate into white.
  const seatShadeTex = makeUltraSeatShading();
  seatShadeTex.anisotropy = 4;
  const seatMat = new THREE.MeshStandardMaterial({
    roughness: 0.8, map: seatShadeTex,
  });

  // LOW-POLY SEAT MODE: the same instance, drawn as one upright quad instead
  // of a pan plus a backrest — 2 triangles a seat instead of ~24. The quad
  // carries a painted seat on both faces: front of a seat when you are looking
  // down the rake at it, back of a seat when you are behind it. Geometry and
  // material swap on the live mesh, so instanceMatrix/instanceColor (and every
  // cull the bowl already does) survive untouched.
  const seatGeoFlat = new THREE.PlaneGeometry(0.52, 0.68);
  seatGeoFlat.rotateY(Math.PI);            // face local -z, toward the show
  seatGeoFlat.translate(0, 0.62, 0.06);
  const seatMatFlat = new THREE.MeshLambertMaterial({
    // alphaTest ALONE, never transparent:true — the blended queue costs far
    // more than the geometry this mode saves (measured 2x slower with it on)
    map: makeUltraSeatBillboard(), alphaTest: 0.45, side: THREE.DoubleSide,
  });
  seatMatFlat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
         vec2 sUv = vec2(vMapUv.x * 0.5 + (gl_FrontFacing ? 0.0 : 0.5), vMapUv.y);
         diffuseColor *= texture2D(map, sUv);
       #endif`);
  };
  seatMatFlat.customProgramCacheKey = () => 'seat-billboard-v1';

  const n = seatSpots.length;
  const seats = new THREE.InstancedMesh(seatGeo, seatMat, n);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const reds = SPEC.bowl.seatColors;
  seatSpots.forEach((sp, i) => {
    dummy.position.set(sp.x, sp.y, sp.z);
    dummy.rotation.set(0, sp.yaw, 0);
    dummy.updateMatrix();
    seats.setMatrixAt(i, dummy.matrix);
    const pal = TIER_COLORS[TIERS[sp.t]?.name] || reds;   // e.g. the gold club level
    color.setHex(sp.dark ? 0x1b181d : pal[(i * 7) % pal.length]);
    seats.setColorAt(i, color);
  });
  scene.add(seats);

  const steps = new THREE.InstancedMesh(new THREE.BoxGeometry(aisleW, 0.1, 0.44), aisleMat, stepSpots.length);
  stepSpots.forEach((st, i) => {
    dummy.position.set(st.x, st.y, st.z);
    dummy.rotation.set(0, st.yaw, 0);
    dummy.updateMatrix();
    steps.setMatrixAt(i, dummy.matrix);
  });
  scene.add(steps);

  // black orb ~1ft above every seat pan: basketball-sized, completely
  // detached from the environment — unlit, unfogged, untonemapped, and
  // excluded from the floor reflection like the other instanced meshes
  const orbs = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.246, 0.246),
    orbDiscMaterial(),
    n
  );
  const orbPos = new Float32Array(n * 3);
  dummy.rotation.set(0, 0, 0);
  seatSpots.forEach((sp, i) => {
    dummy.position.set(sp.x, sp.y + 0.75, sp.z);
    dummy.updateMatrix();
    orbs.setMatrixAt(i, dummy.matrix);
    orbPos[i * 3] = sp.x; orbPos[i * 3 + 1] = sp.y + 0.75; orbPos[i * 3 + 2] = sp.z;
  });
  scene.add(orbs);

  // --- section covers: black tarps over the sections behind the stage -------
  // Section numbers run opposite the path direction (sectionSpan does that
  // reversal), and each one occupies the loop range between its two aisles.
  // Spans are bounded by aisle centres, so neighbouring covers meet
  // edge-to-edge and read as one continuous tarp.
  // Tarps are now configurable: `behind` covers N sections behind the stage
  // (small 2 / medium 4 / full 6), `rings` covers whole tiers ('100'..'400').
  // setCovers rebuilds the mesh inside a stable group so main.js can keep one
  // reference for visibility.
  const covers = new THREE.Group();
  scene.add(covers);
  const tarpTex = makeTarpTexture();
  tarpTex.repeat.set(26, 1);   // seams + sheen streaks walk the whole strip
  const coverMat = new THREE.MeshStandardMaterial({
    // dark multiplier: blackout vinyl, texture adds the life. Under open-air
    // floodlights the arena's value read as bare concrete, so outdoors it is darker.
    color: SPEC.key === 'arena' ? 0x7e7e84 : 0x3a3a40,
    map: tarpTex, roughness: 0.88, metalness: 0, side: THREE.DoubleSide,
  });
  // The stage backs onto the -x end, which the seating chart numbers 119 on
  // the arena's 24 sections (101 + 3n/4 on n: 137 on the cricket ground's 48).
  // A section is centred there, so the sets are odd-sized and grow
  // symmetrically outward: 3 / 5 / 7 of 24, and the same share of a ring cut
  // into more sections (7 / 11 / 15 of 48).
  const BEHIND_SHARE = { small: 3 / 24, medium: 5 / 24, full: 7 / 24 };
  const behindSpans = (behind) => {
    const share = BEHIND_SHARE[behind];
    if (!share) return [];
    const mid = 101 + Math.round((AISLES * 3) / 4), half = Math.max(1, Math.round((share * AISLES - 1) / 2));
    const out = [];
    for (let l = mid - half; l <= mid + half; l++) out.push(sectionSpan(AISLES, l));
    return out;
  };
  // per-seat tarp metadata: tier index plus the aisle-span the seat sits in on
  // the base curve (spans are exactly what the behind-stage tarps cover), so
  // seats/orbs/crowd under any tarp can be culled the way the curtain does it
  const seatTier = new Uint8Array(seatSpots.length);
  const seatSpan = new Uint8Array(seatSpots.length);
  {
    const bx = base.map((p) => p.x), bz = base.map((p) => p.z);
    for (let i = 0; i < seatSpots.length; i++) {
      const s = seatSpots[i];
      seatTier[i] = s.t;
      let best = 0, bd = Infinity;
      for (let k = 0; k < SEGMENTS; k++) {
        const dx = s.x - bx[k], dz = s.z - bz[k];
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = k; }
      }
      seatSpan[i] = spanAtBaseU(AISLES, best / SEGMENTS);
    }
  }
  // which seats sit under the given tarps — null when nothing is covered
  function coverMask({ behind = 'none', rings = [], cstage = null } = {}) {
    const spans = behindSpans(behind);
    const ringed = tiers.map((t) => rings.includes(t.name));
    if (!spans.length && !ringed.some(Boolean) && !cstage) return null;
    const mask = new Uint8Array(seatSpots.length);
    for (let i = 0; i < seatSpots.length; i++) {
      if (ringed[seatTier[i]] || spans.includes(seatSpan[i])) { mask[i] = 1; continue; }
      if (cstage) {
        // The C-stage deck is a 5-seat x 2-row rectangle turned to the rows,
        // not the axis-aligned square the old riser tarp masked. `inside` is
        // handed in by the caller so the test cannot drift from the geometry.
        const s = seatSpots[i];
        if (cstage.inside ? cstage.inside(s.x, s.z)
          : (Math.abs(s.x - cstage.x) < CSTAGE_TARP / 2 && Math.abs(s.z - cstage.z) < CSTAGE_TARP / 2)) mask[i] = 1;
      }
    }
    return mask;
  }
  const CSTAGE_TARP = 2.8;   // tarped square under the C-stage platform, metres
  // was 4: a low platform covers far fewer seats than a riser on legs did
  function setCovers({ behind = 'none', rings = [], cstage = null } = {}) {
    for (const c of covers.children) c.geometry.dispose();
    covers.clear();
    const coverGeos = [];
    const CLEAR = 1.05;   // constant gap above the seat datum, over the orbs
    // `cstage.tarp` draws the draped square a riser needed. The platform on
    // legs brings its own deck, so it asks for the seat MASK only and this
    // whole block stays off.
    if (cstage && cstage.tarp) {
      // local seat frame at the riser: radial direction + seat rake of the 100s
      let best = 0, bd = Infinity;
      for (let k = 0; k < SEGMENTS; k++) {
        const dx = cstage.x - base[k].x, dz = cstage.z - base[k].z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = k; }
      }
      const bp = base[best];
      const off0 = Math.hypot(cstage.x - bp.x, cstage.z - bp.z);
      const t100c = tiers[0];
      const rake = t100c.rise / t100c.depth;
      const seatY = (off) => t100c.h0 - 0.35 + 0.12 + (off - (t100c.o0 + 0.3)) * rake;
      const h = CSTAGE_TARP / 2;
      const rad = { x: bp.nx, z: bp.nz };            // up the rake
      const tan = { x: -bp.nz, z: bp.nx };           // along the row
      const corner = (dr, dt) => [
        cstage.x + rad.x * dr + tan.x * dt,
        seatY(off0 + dr) + CLEAR,
        cstage.z + rad.z * dr + tan.z * dt,
      ];
      const quad = (a, bq, c, dq) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...bq, ...c, ...dq], 3));
        // uv must exist: these quads merge with pathStrip geometries, and
        // mergeGeometries silently fails on mismatched attribute sets
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        g.computeVertexNormals();
        coverGeos.push(g);
      };
      quad(corner(-h, -h), corner(-h, h), corner(h, h), corner(h, -h));
      // skirt hanging over the front (down-slope) edge
      const fA = corner(-h, -h), fB = corner(-h, h);
      quad(fA, fB, [fB[0], fB[1] - CLEAR, fB[2]], [fA[0], fA[1] - CLEAR, fA[2]]);
    }
    for (const tier of tiers) {
      const slab0 = tier.h0 - 0.35 + 0.12;
      const offFront = tier.o0 - 0.15;
      // The tarp must run exactly PARALLEL to the seat rake, otherwise the gap
      // narrows as the rows climb and the back-row orbs poke through. Derive
      // both ends from the seat line (slope rise/depth through row 0) instead
      // of from the first/last row heights.
      const rake = tier.rise / tier.depth;
      const seatY = (off) => slab0 + (off - (tier.o0 + 0.3)) * rake;
      const yFront = seatY(offFront) + CLEAR;
      // the back edge stops at the last row built at each point: the same
      // everywhere in a bowl without a swoop, cut down behind a stadium's goals
      const rowsHere = (p) => rowsAt(tier, p.nz * p.nz);
      const backAt = (p) => {
        const rows = rowsHere(p);
        if (rows <= 0) return null;
        const off = tier.o0 + (rows - 1) * tier.depth + 0.65;
        return [off, seatY(off) + CLEAR];
      };
      const skirtAt = (p) => (rowsHere(p) > 0 ? [offFront, yFront - CLEAR] : null);
      const strip = (u0, u1) => {
        // the tarp, and a short skirt hanging down over the front row
        for (const g of [pathStripTo(base, u0, u1, offFront, yFront, backAt), pathStripTo(base, u0, u1, offFront, yFront, skirtAt)]) {
          if (g) coverGeos.push(g);
        }
      };
      if (rings.includes(tier.name)) {
        strip(0, 1);              // the whole ring, one wrap of the path
        continue;                 // ring tarp already covers the behind span
      }
      for (const j of behindSpans(behind)) strip(...spanBaseU(AISLES, j));
    }
    if (coverGeos.length) {
      const m = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(coverGeos), coverMat);
      m.receiveShadow = true;
      covers.add(m);
    }
    return coverGeos.length > 0;
  }
  setCovers({ behind: SPEC.bowl.defaultBehind });   // arena: the classic end-stage tarps

  // --- room-size curtain -----------------------------------------------------
  // A straight wall of heavy black drape cutting clean across the arena at a
  // given x — the way real reduction curtains hang. Everything west of it
  // (stage-wall side) disappears behind the cloth.
  const curtain = new THREE.Group();
  scene.add(curtain);
  const curtainMat = new THREE.MeshStandardMaterial({
    color: 0x0b0b0e, roughness: 0.94, metalness: 0, side: THREE.DoubleSide,
  });
  function setCurtain(cutX = null) {
    for (const c of curtain.children) c.geometry.dispose();
    curtain.clear();
    if (cutX === null || cutX === false) return false;
    // main drape: floor to just under the roof, spanning past the 400s
    const H = 37.0, W = 120;
    const wallGeo = new THREE.PlaneGeometry(W, H);
    wallGeo.rotateY(Math.PI / 2);            // normal faces +x, the open room
    wallGeo.translate(cutX, H / 2, 0);
    const wall = new THREE.Mesh(wallGeo, curtainMat);
    wall.receiveShadow = true;
    curtain.add(wall);
    // subtle pleating: thin vertical ridges so the cloth doesn't read flat
    const pleatGeo = new THREE.PlaneGeometry(0.22, H);
    pleatGeo.rotateY(Math.PI / 2);
    const nP = Math.floor(W / 1.6);
    const pleats = new THREE.InstancedMesh(pleatGeo, curtainMat, nP);
    const pd = new THREE.Object3D();
    for (let i = 0; i < nP; i++) {
      pd.position.set(cutX + 0.09, H / 2, -W / 2 + 0.8 + i * 1.6);
      pd.updateMatrix();
      pleats.setMatrixAt(i, pd.matrix);
    }
    curtain.add(pleats);
    // header band leaning back toward the hidden side at the top
    const headGeo = new THREE.PlaneGeometry(W, 2.2);
    headGeo.rotateY(Math.PI / 2);
    const head = new THREE.Mesh(headGeo, curtainMat);
    head.position.set(cutX - 0.8, H + 0.7, 0);
    head.rotation.z = -0.72;
    curtain.add(head);
    return true;
  }

  let seatStyle = 'box';
  function setSeatStyle(style) {
    const flat = style === 'flat';
    if (flat === (seatStyle === 'flat')) return seatStyle;
    seatStyle = flat ? 'flat' : 'box';
    seats.geometry = flat ? seatGeoFlat : seatGeo;
    seats.material = flat ? seatMatFlat : seatMat;
    return seatStyle;
  }

  return { seatCount: n, setSeatStyle, get seatStyle() { return seatStyle; }, heavyMeshes: [seats, steps, orbs], seats, orbs, orbPos, fascias, covers, setCovers, coverMask, curtain, setCurtain, suites, setSuiteLights, signs };
}

// ---------------------------------------------------------------------------
// The PLAYED sheet, sized to meet the seating: the boards land on the bowl's
// front wall, so there is no concrete apron between the glass and row 1.
//
// RINK_W/H/R stay the regulation reference (200 x 85 ft, 28 ft radius) and are
// what the markings are drawn against — makeIceTexture paints every line at
// its true metre position (centre line at 0, blue lines at +-7.62, goal lines
// at +-27.13, ppm = canvas width / sheet width), so those land correctly at
// any sheet size and hockeyprops' goals still sit on their painted lines.
// What grows is the ice OUTSIDE the markings.
//
// Deliberate trade-off, chosen over pulling the bowl in another 1.4 m (which
// would have narrowed the concert stage to 24 m and re-tightened the
// basketball floor rows): the sheet measures 63.8 x 28.8 m, 4.7% longer and
// 11% wider than regulation, so there is more room behind the nets and at the
// side boards than a real rink has.
// ---------------------------------------------------------------------------
const ICE_REACH = frontWallOff() - 0.11;    // front wall, less the board thickness
// The stadium's bowl stands 9-40 m off a rink, so hockey there is an outdoor
// game: a free-standing regulation sheet with its own boards and glass, laid
// on the decking that covers the pitch. It is not grown to the bowl wall.
const OUTDOOR_RINK = SPEC.key !== 'arena';
export const ICE_A = OUTDOOR_RINK ? RINK_W / 2 : BOWL_A + ICE_REACH;
export const ICE_B = OUTDOOR_RINK ? RINK_H / 2 : BOWL_B + ICE_REACH;
export const ICE_R = OUTDOOR_RINK ? RINK_R : BOWL_R + ICE_REACH;
// Height of the playing surfaces. Indoors the ice sits on the slab. Outdoors
// it has to clear the pitch decking (y 0.05, itself 3 cm over the turf) by a
// margin the depth buffer still resolves from the far stands.
export const SURFACE_Y = OUTDOOR_RINK ? 0.1 : 0.006;

export function buildRink(scene, anisotropy, fresnelize) {
  const group = new THREE.Group();
  const a = ICE_A, b = ICE_B, r = ICE_R;
  const SEG = 192;
  const path = roundedRectPath(a, b, r, SEG);

  const shape = new THREE.Shape();
  shape.moveTo(-(a - r), -b);
  shape.lineTo(a - r, -b);
  shape.absarc(a - r, -(b - r), r, -Math.PI / 2, 0);
  shape.lineTo(a, b - r);
  shape.absarc(a - r, b - r, r, 0, Math.PI / 2);
  shape.lineTo(-(a - r), b);
  shape.absarc(-(a - r), b - r, r, Math.PI / 2, Math.PI);
  shape.lineTo(-a, -(b - r));
  shape.absarc(-(a - r), -(b - r), r, Math.PI, Math.PI * 1.5);
  const iceGeo = new THREE.ShapeGeometry(shape, 24);
  const uvAttr = iceGeo.getAttribute('uv');
  for (let i = 0; i < uvAttr.count; i++) {
    uvAttr.setXY(i, uvAttr.getX(i) / (a * 2) + 0.5, uvAttr.getY(i) / (b * 2) + 0.5);
  }
  const iceMat = new THREE.MeshStandardMaterial({
    map: makeIceTexture(anisotropy, a * 2, b * 2),
    // Real ice under arena light is a pale blue-grey, and it is scuffed. Pure
    // white at near-mirror roughness pushed the sheen past the bloom gate and
    // erased the lines and logos from every seat.
    color: 0xd9e5ef,
    roughness: 0.13,
  });
  fresnelize(iceMat, 0.965, 0.62);
  // the Fresnel fade exists to let the indoor floor mirror show through; the
  // stadium has no mirror, and a see-through sheet over the decking read grey
  if (OUTDOOR_RINK) iceMat.transparent = false;
  const ice = new THREE.Mesh(iceGeo, iceMat);
  ice.rotation.x = -Math.PI / 2;
  ice.position.y = SURFACE_Y;
  ice.receiveShadow = true;
  group.add(ice);

  const boardsTex = makeBoardsTexture();
  const boards = new THREE.Mesh(
    ringStrip(path, 0, 0, 0, 1.12, true),
    new THREE.MeshStandardMaterial({ map: boardsTex, roughness: 0.35, side: THREE.DoubleSide })
  );
  boards.castShadow = true;
  group.add(boards);
  const capMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5 });
  group.add(new THREE.Mesh(ringStrip(path, 0.09, 0, 0.09, 1.12, false), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.8, side: THREE.DoubleSide })));
  group.add(new THREE.Mesh(ringStrip(path, -0.02, 1.12, 0.11, 1.12, false), capMat));

  const glass = new THREE.Mesh(
    ringStrip(path, 0.045, 1.12, 0.045, 2.95, false),
    new THREE.MeshPhysicalMaterial({
      color: 0x36404a, transparent: true, opacity: 0.13,
      roughness: 0.04, metalness: 0, envMapIntensity: 0.3,
      clearcoat: 1, clearcoatRoughness: 0.06,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  group.add(glass);

  const postCount = 72;
  const posts = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.06, 1.83, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.4, metalness: 0.6 }),
    postCount
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < postCount; i++) {
    const p = path[Math.round((i / postCount) * SEG) % SEG];
    dummy.position.set(p.x + p.nx * 0.045, 1.12 + 1.83 / 2, p.z + p.nz * 0.045);
    dummy.rotation.set(0, Math.atan2(p.nx, p.nz), 0);
    dummy.updateMatrix();
    posts.setMatrixAt(i, dummy.matrix);
  }
  group.add(posts);

  scene.add(group);
  return group;
}

// ---------------------------------------------------------------------------
// Concert / changeover floor — always present under the court or ice,
// sized to reach the bowl wall.
// ---------------------------------------------------------------------------
export function buildEventFloor(scene, anisotropy, fresnelize) {
  // tiled polished concrete: blotches, speckle, expansion joints, scuffs
  const concreteTex = makeConcreteFloor();
  concreteTex.repeat.set(7, 3.5);
  concreteTex.anisotropy = anisotropy;
  const mat = new THREE.MeshPhysicalMaterial({
    map: concreteTex,
    roughness: 0.55,
    clearcoat: 0.35,
    clearcoatRoughness: 0.35,
  });
  fresnelize(mat, 0.996, 0.965); // flat matte concrete, same read as the stage deck
  // sized off the BOWL, not the rink: the slab has to run out past the boards
  // and under the first row of seats
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(BOWL_A * 2 + 3, BOWL_B * 2 + 3), mat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.002;
  floor.receiveShadow = true;
  scene.add(floor);
  return floor;
}
