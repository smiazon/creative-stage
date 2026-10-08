// Hockey-mode props — NHL goals on the ice plus the protective end netting
// that hangs above the glass behind both goals.
//
// Static geometry only; no per-frame update. The caller toggles group.visible
// when entering/leaving hockey mode (default: hidden).
//
// House rules respected: everything here is matte and stays under the bloom
// gate (max(r,g,b) <= 1.0 on every material). Matte = MeshLambertMaterial.
//
// NOTE ON DIMENSIONS: ICE_A/ICE_B/ICE_R are the sheet bowl.js builds: grown to
// the bowl wall in the arena, TRUE regulation (30.48 / 12.955 / 8.53) for the
// stadium's outdoor rink. The glass runs y 1.12..2.95. The end netting
// follows the actual board path and starts at the actual glass top. The goals
// sit at the goal lines painted on the ice (x = +-27.13, see makeIceTexture
// in textures.js).
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { ICE_A, ICE_B, ICE_R, SURFACE_Y } from './bowl.js';

const GOAL_LINE_X = 27.13;          // matches the red goal lines on the ice map
const GLASS_TOP_Y = 2.95;           // top of the dasher glass in bowl.js
const NET_TOP_Y = 9.5;              // protective netting reaches this high
const NET_LEAN = (7 * Math.PI) / 180;

// --- materials (all matte, all under the bloom gate) -------------------------
const frameMat = new THREE.MeshLambertMaterial({ color: 0xcc1122 });

// ---------------------------------------------------------------------------
// canvas grid textures (textures.js keeps its makeCanvas helper private,
// so a tiny local copy lives here)
// ---------------------------------------------------------------------------
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// goal netting: thin white lines on transparent, 8 px cells on a 128 px tile
function makeGoalNetTexture() {
  const S = 128, CELL = 8;
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(240,240,238,0.95)';
  ctx.lineWidth = 1.6;
  for (let p = 0; p <= S; p += CELL) {
    ctx.beginPath(); ctx.moveTo(p + 0.5, 0); ctx.lineTo(p + 0.5, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p + 0.5); ctx.lineTo(S, p + 0.5); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// one goal-net tile covers 0.64 m of world -> ~4 cm mesh cells
const GOAL_NET_TILE = 0.64;

// protective netting: pale grey mesh — visible against the dark bowl the way
// real safety netting catches the light
function makeSafetyNetTexture() {
  const S = 128, CELL = 16;
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(196,202,212,0.95)';
  ctx.lineWidth = 1.7;
  for (let p = 0; p <= S; p += CELL) {
    ctx.beginPath(); ctx.moveTo(p + 0.5, 0); ctx.lineTo(p + 0.5, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p + 0.5); ctx.lineTo(S, p + 0.5); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// 8 cells per tile at 0.35 m per cell -> one safety-net tile covers 2.8 m
const SAFETY_NET_TILE = 2.8;

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

// red frame tube from point a to point b
function tube(a, b, r) {
  _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _v.length();
  const geo = new THREE.CylinderGeometry(r, r, len, 10, 1);
  geo.translate(0, len / 2, 0);
  _q.setFromUnitVectors(UP, _v.normalize());
  geo.applyQuaternion(_q);
  geo.translate(a[0], a[1], a[2]);
  return geo;
}

// single quad a-b-c-d (two triangles a-b-c / a-c-d) with explicit per-vertex
// uvs; normals computed so Lambert shading works after merging
function quad(a, b, c, d, uvs) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(
    [...a, ...b, ...c, ...d], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(
    uvs.flat(), 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  return geo;
}

const dist = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);

// quad with uvs derived from edge lengths, in units of `tile` metres
function meshQuad(a, b, c, d, tile) {
  const va = dist(a, b) / tile, vd = dist(d, c) / tile;
  const ub = dist(b, c) / tile, ua = dist(a, d) / tile;
  return quad(a, b, c, d, [[0, 0], [0, va], [ub, vd], [ua, 0]]);
}

// ---------------------------------------------------------------------------
// one NHL goal, built at the origin, opening in the plane x=0 facing +x,
// cage extending toward -x. Returns { frame, net } meshes.
// ---------------------------------------------------------------------------
function buildGoal(netMat) {
  const R = 0.06;                    // tube radius
  const HW = 1.83 / 2;               // half opening width
  const H = 1.22;                    // post height
  const D = 1.05;                    // cage depth (base frame ~1.1 m back)
  const BW = 0.60;                   // back half-width (trapezoid taper)
  const RW = 0.78;                   // ridge half-width (curved back, approx)
  const RY = 0.95, RX = -0.55;       // ridge height / depth

  // --- red tubular frame -----------------------------------------------------
  const tubes = [];
  for (const s of [-1, 1]) {
    // posts
    tubes.push(tube([0, 0, s * HW], [0, H, s * HW], R));
    // base rails: post foot back to the trapezoid's rear corners
    tubes.push(tube([0, R, s * HW], [-D, R, s * BW], R * 0.8));
    // back supports: post top -> ridge -> rear corner (approximates the curve)
    tubes.push(tube([0, H, s * HW], [RX, RY, s * RW], R * 0.8));
    tubes.push(tube([RX, RY, s * RW], [-D, R, s * BW], R * 0.8));
  }
  // crossbar (slightly long so it caps the post tops)
  tubes.push(tube([0, H, -HW - R], [0, H, HW + R], R));
  // rear base rail + ridge rail (net supports)
  tubes.push(tube([-D, R, -BW], [-D, R, BW], R * 0.8));
  tubes.push(tube([RX, RY, -RW], [RX, RY, RW], R * 0.7));
  const frame = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(tubes), frameMat);

  // --- netting: top, curved back (2 angled bands) and both sides -------------
  const T = GOAL_NET_TILE;
  const panels = [];
  // top: crossbar back to the ridge
  panels.push(meshQuad([0, H, -HW], [0, H, HW], [RX, RY, RW], [RX, RY, -RW], T));
  // back, upper band: ridge down to the rear base
  panels.push(meshQuad([RX, RY, -RW], [RX, RY, RW], [-D, R, BW], [-D, R, -BW], T));
  // sides
  for (const s of [-1, 1]) {
    panels.push(meshQuad(
      [0, 0.02, s * HW], [0, H, s * HW], [RX, RY, s * RW], [-D, 0.02, s * BW], T));
  }
  const net = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(panels), netMat);

  return { frame, net };
}

// ---------------------------------------------------------------------------
// protective end netting — follows the actual board path around one rounded
// END of the rink: corner arc + straight cap + corner arc, ~14 segment planes,
// from the glass top to NET_TOP_Y, leaning back (outward) ~7 degrees.
// sideSign = +1 builds the east end (x > 0); -1 mirrors for the west.
// ---------------------------------------------------------------------------
function buildEndNetGeometry(sideSign) {
  const A = ICE_A, B = ICE_B, Rr = ICE_R;
  const cx = A - Rr, cz = B - Rr;

  // sample the end profile bottom-to-top in z: arc, straight cap, arc.
  // pts: [x, z, nx, nz] with (nx, nz) the outward normal
  const pts = [];
  const ARC_N = 5;                  // 5 planes per corner arc
  for (let i = 0; i <= ARC_N; i++) {          // lower corner: -PI/2 .. 0
    const a = -Math.PI / 2 + (i / ARC_N) * (Math.PI / 2);
    pts.push([cx + Math.cos(a) * Rr, -cz + Math.sin(a) * Rr, Math.cos(a), Math.sin(a)]);
  }
  const CAP_N = 4;                  // 4 planes across the straight cap
  for (let i = 1; i <= CAP_N; i++) {
    pts.push([A, -cz + (i / CAP_N) * cz * 2, 1, 0]);
  }
  for (let i = 1; i <= ARC_N; i++) {          // upper corner: 0 .. PI/2
    const a = (i / ARC_N) * (Math.PI / 2);
    pts.push([cx + Math.cos(a) * Rr, cz + Math.sin(a) * Rr, Math.cos(a), Math.sin(a)]);
  }

  const y0 = GLASS_TOP_Y - 0.1;     // tuck slightly behind the glass top
  const y1 = NET_TOP_Y;
  const lean = (y1 - y0) * Math.tan(NET_LEAN);
  const vTop = (y1 - y0) / SAFETY_NET_TILE;

  const segs = [];
  let u = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    const du = Math.hypot(q[0] - p[0], q[1] - p[1]) / SAFETY_NET_TILE;
    const a = [sideSign * p[0], y0, p[1]];
    const b = [sideSign * q[0], y0, q[1]];
    const c = [sideSign * (q[0] + q[2] * lean), y1, q[1] + q[3] * lean];
    const d = [sideSign * (p[0] + p[2] * lean), y1, p[1] + p[3] * lean];
    segs.push(quad(a, b, c, d,
      [[u, 0], [u + du, 0], [u + du, vTop], [u, vTop]]));
    u += du;
  }
  return BufferGeometryUtils.mergeGeometries(segs);
}

// ---------------------------------------------------------------------------
export function buildHockeyProps(scene) {
  const group = new THREE.Group();
  group.name = 'hockeyProps';
  group.visible = false;             // caller flips this on for hockey mode
  // stand on the ice: the stadium's outdoor sheet is raised over the pitch
  // decking, and a goal left at y 0 loses its base bar under the surface
  group.position.y = SURFACE_Y - 0.006;

  // --- the two goals ---------------------------------------------------------
  const goalNetMat = new THREE.MeshLambertMaterial({
    map: makeGoalNetTexture(),
    transparent: true, opacity: 0.85, alphaTest: 0.05,
    side: THREE.DoubleSide,
  });
  const proto = buildGoal(goalNetMat);
  for (const s of [-1, 1]) {
    const goal = new THREE.Group();
    goal.add(proto.frame.clone(), proto.net.clone());   // shared geo + mats
    goal.position.set(s * -GOAL_LINE_X, 0, 0);          // opening ON the goal line
    goal.rotation.y = s > 0 ? 0 : Math.PI;              // both face centre ice
    group.add(goal);
  }

  // --- protective end netting over the glass ---------------------------------
  // MeshBasic: house lights barely reach up there, and a lit material made the
  // net vanish — self-shaded pale grey keeps it legible from the floor
  const safetyMat = new THREE.MeshBasicMaterial({
    map: makeSafetyNetTexture(),
    transparent: true, opacity: 0.72,
    color: 0x9aa0aa,
    side: THREE.DoubleSide, depthWrite: false,
  });
  for (const s of [-1, 1]) {
    group.add(new THREE.Mesh(buildEndNetGeometry(s), safetyMat));
  }


  scene.add(group);
  return { group };
}
