// Reusable lattice-truss geometry builders.
//
// Pure geometry: every function returns a merged BufferGeometry in local space
// and takes all dimensions as arguments, so the rig layout lives elsewhere.
// A real box truss is four parallel chords joined by diagonal webbing and
// perpendicular lacing at each bay — that silhouette is what reads as "truss"
// from a distance, so the webbing is worth the triangles.
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const CHORD_R = 0.026;   // 50 mm chord tube radius
const WEB_R = 0.016;     // 32 mm diagonal/lacing radius
const RADIAL = 5;        // cylinder sides — low, these are thin and far away

// A cylinder between two points, as geometry (no Mesh, so it can be merged).
function strut(ax, ay, az, bx, by, bz, radius) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  const g = new THREE.CylinderGeometry(radius, radius, len, RADIAL, 1);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(dx / len, dy / len, dz / len)
  );
  g.applyQuaternion(q);
  g.translate(ax, ay, az);
  return g;
}

// ---------------------------------------------------------------------------
// Straight box truss running along local +X, centred on the origin.
// section = the square cross-section (chord centre to chord centre).
// ---------------------------------------------------------------------------
// `tube` scales the member radii: a 12in truss is 50 mm pipe, a 1 m heavy-duty
// ring or a lattice mast is built from ~100 mm chords, and drawing it with the
// small pipe is exactly what makes big structure look like it would fold in a
// breeze. Default 1 keeps every existing caller pixel-identical.
export function boxTruss(length, section = 0.52, bay = 1.0, tube = 1) {
  const h = section / 2;
  const corners = [[-h, -h], [h, -h], [-h, h], [h, h]]; // (y, z) of each chord
  const geos = [];
  const CR = CHORD_R * tube, WR = WEB_R * tube;

  for (const [cy, cz] of corners) {
    geos.push(strut(-length / 2, cy, cz, length / 2, cy, cz, CR));
  }

  const bays = Math.max(1, Math.round(length / bay));
  const step = length / bays;
  for (let i = 0; i <= bays; i++) {
    const x = -length / 2 + i * step;
    // perpendicular lacing: a square frame at each node
    geos.push(strut(x, -h, -h, x, h, -h, WR));
    geos.push(strut(x, -h, h, x, h, h, WR));
    geos.push(strut(x, -h, -h, x, -h, h, WR));
    geos.push(strut(x, h, -h, x, h, h, WR));
    if (i === bays) continue;
    // diagonals on all four faces, alternating direction per bay
    const x2 = x + step;
    const flip = i % 2 === 0;
    const dz = flip ? 1 : -1;
    geos.push(strut(x, -h, -h * dz, x2, h, h * dz, WR));   // near/far side faces
    geos.push(strut(x, h, -h * dz, x2, -h, h * dz, WR));
    geos.push(strut(x, -h * dz, -h, x2, h * dz, h, WR));   // top/bottom faces
  }
  return BufferGeometryUtils.mergeGeometries(geos);
}

// ---------------------------------------------------------------------------
// Circular box truss in the local XZ plane, centred on the origin.
// Used over the B-stage — a real one is bolted from arc sections.
// ---------------------------------------------------------------------------
export function circleTruss(radius, section = 0.52, segments = 36) {
  const h = section / 2;
  const geos = [];
  const at = (i, ry, rr) => {
    const a = (i / segments) * Math.PI * 2;
    return [Math.cos(a) * rr, ry, Math.sin(a) * rr];
  };
  for (let i = 0; i < segments; i++) {
    const j = i + 1;
    for (const ry of [-h, h]) {
      for (const rr of [radius - h, radius + h]) {
        const a = at(i, ry, rr), b = at(j, ry, rr);
        geos.push(strut(a[0], a[1], a[2], b[0], b[1], b[2], CHORD_R));
      }
    }
    // lacing square + one diagonal per segment
    const inLo = at(i, -h, radius - h), inHi = at(i, h, radius - h);
    const outLo = at(i, -h, radius + h), outHi = at(i, h, radius + h);
    geos.push(strut(...inLo, ...inHi, WEB_R));
    geos.push(strut(...outLo, ...outHi, WEB_R));
    geos.push(strut(...inLo, ...outLo, WEB_R));
    geos.push(strut(...inHi, ...outHi, WEB_R));
    const nextOutHi = at(j, h, radius + h);
    geos.push(strut(...inLo, ...nextOutHi, WEB_R));
  }
  return BufferGeometryUtils.mergeGeometries(geos);
}

// ---------------------------------------------------------------------------
// Motor / hoist drop: chain hoist body plus the chain run up to the roof.
// Returns geometry positioned from y=fromY (truss top) to y=toY (roof).
// ---------------------------------------------------------------------------
export function hoistDrop(x, z, fromY, toY, heavy = 1) {
  const geos = [];
  geos.push(strut(x, fromY, z, x, toY, z, 0.012 * heavy));    // chain
  const body = new THREE.BoxGeometry(0.22 * heavy, 0.34 * heavy, 0.2 * heavy);
  body.translate(x, fromY + 0.2 * heavy, z);
  geos.push(body);
  if (heavy > 1.3) {   // a 2 t motor hangs on a bridle: two short legs to the chord
    geos.push(strut(x - 0.45, fromY - 0.05, z, x, fromY + 0.05, z, 0.012));
    geos.push(strut(x + 0.45, fromY - 0.05, z, x, fromY + 0.05, z, 0.012));
  }
  return BufferGeometryUtils.mergeGeometries(geos);
}

export const TRUSS_TUBE = { CHORD_R, WEB_R };
