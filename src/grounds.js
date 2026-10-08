// The open-air grounds that are not a football stadium (venue.js):
//   the cricket ground: an oval of grass inside the bowl with the square in
//   the middle, the pitch and its creases, the fielding circle, the boundary
//   rope, stumps at both ends and a sight screen behind each
//   the festival field: grass out to the horizon, worn to mud where the crowd
//   stands, and round it (buildFestivalGrounds) a fence, a treeline and hills,
//   food stalls down the sides, delay towers in the crowd and a big wheel
//   turning beyond the fence
// The two fields return what stadium.js's buildPitch does ({ group, grass,
// cover, goals, setSurface }), so main.js treats every open-air floor alike.
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { boxTruss } from './truss.js';
import { BOWL_A, BOWL_B, BOWL_R } from './bowl.js';
import { SPEC, CRICKET } from './venue.js';
import { FIELD_L, FIELD_W, makeCoverTexture } from './stadium.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const texture = (c, anisotropy = 4) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
};
// the bowl's own plan shape inset by d, added to the canvas path
const oval = (ctx, X, Y, M, d) => {
  const a = BOWL_A - d, b = BOWL_B - d, r = Math.max(0.5, BOWL_R - d);
  ctx.roundRect(X(-a), Y(-b), M(2 * a), M(2 * b), M(r));
};
// the concert deck that goes down over the turf for a show, the outdoor rink
// or a court (the football stadium's, laid over this ground's grass)
function makeCover(anisotropy, L, W) {
  const tex = makeCoverTexture();
  tex.anisotropy = anisotropy;
  tex.repeat.set(L / 4.8, W / 4.8);
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62 }));
  cover.rotation.x = -Math.PI / 2;
  cover.position.y = 0.05;
  cover.receiveShadow = true;
  cover.visible = false;
  return cover;
}

// --- the cricket ground ---------------------------------------------------------------
const ROPE = 4.5;   // the boundary rope, this far inside the fence
function makeCricketTexture(anisotropy) {
  const W = 4096, H = Math.round((W * FIELD_W) / FIELD_L), ppm = W / FIELD_L;
  const [c, ctx] = makeCanvas(W, H);
  const rand = mulberry32(2024);
  const X = (x) => W / 2 + x * ppm, Y = (z) => H / 2 + z * ppm, M = (m) => m * ppm;
  ctx.fillStyle = '#2d7429';
  ctx.fillRect(0, 0, W, H);
  // the outfield inside the fence, mown in broad stripes and cross-cut fainter
  ctx.save();
  ctx.beginPath(); oval(ctx, X, Y, M, 0.5); ctx.clip();
  const bands = 20, bw = (2 * BOWL_A) / bands;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = i & 1 ? '#2b7128' : '#378e31';
    ctx.fillRect(X(-BOWL_A + i * bw), 0, M(bw) + 1, H);
  }
  const cuts = 16, cw = (2 * BOWL_B) / cuts;
  for (let i = 0; i < cuts; i++) {
    ctx.fillStyle = i & 1 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.025)';
    ctx.fillRect(0, Y(-BOWL_B + i * cw), W, M(cw) + 1);
  }
  for (let i = 0; i < 46000; i++) {
    const g = 30 + rand() * 50;
    ctx.fillStyle = `rgba(${(g * 0.5) | 0},${(g + 40) | 0},${(g * 0.4) | 0},${0.05 + rand() * 0.08})`;
    ctx.fillRect(rand() * W, rand() * H, 1 + rand() * 2, 1 + rand() * 2);
  }
  ctx.restore();
  // between the rope and the fence the grass is left longer, so darker
  ctx.beginPath(); oval(ctx, X, Y, M, 0.5); oval(ctx, X, Y, M, ROPE);
  ctx.fillStyle = 'rgba(0,22,0,0.22)';
  ctx.fill('evenodd');
  // the rope itself
  ctx.beginPath(); oval(ctx, X, Y, M, ROPE);
  ctx.lineWidth = M(0.28); ctx.strokeStyle = '#f2f2ee'; ctx.stroke();
  ctx.beginPath(); oval(ctx, X, Y, M, ROPE + 0.2);
  ctx.lineWidth = M(0.1); ctx.strokeStyle = '#2b62d9'; ctx.stroke();
  // the square: the finer-cut block the pitches are cut from
  ctx.fillStyle = 'rgba(205,210,140,0.16)';
  ctx.fillRect(X(-14), Y(-12), M(28), M(24));
  // the fielding circle: 30-yard arcs from the stumps, joined, dashed
  const half = CRICKET.pitchL / 2, R = CRICKET.circle;
  ctx.setLineDash([M(1.1), M(1.3)]);
  ctx.lineWidth = M(0.16); ctx.strokeStyle = 'rgba(245,245,240,0.85)';
  ctx.beginPath();
  ctx.arc(X(half), Y(0), M(R), -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(X(-half), Y(R));
  ctx.arc(X(-half), Y(0), M(R), Math.PI / 2, Math.PI * 1.5);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  // the pitch: rolled bare and pale, worn at the bowlers' ends
  const pw = CRICKET.pitchW;
  ctx.fillStyle = '#c9b88b';
  ctx.fillRect(X(-half - 1.6), Y(-pw / 2), M(2 * half + 3.2), M(pw));
  for (let i = 0; i < 3200; i++) {
    const x = (rand() - 0.5) * (2 * half + 3), z = (rand() - 0.5) * pw;
    const end = Math.max(0, Math.abs(x) - half + 4) / 4;
    const g = 150 + rand() * 60 - end * 40;
    ctx.fillStyle = `rgba(${g | 0},${(g * 0.9) | 0},${(g * 0.66) | 0},${0.25 + end * 0.35})`;
    ctx.fillRect(X(x), Y(z), 1 + rand() * 3, 1 + rand() * 2);
  }
  // the creases, white, 7.5 cm
  ctx.fillStyle = '#f4f2ea';
  const line = M(0.075);
  for (const s of [-1, 1]) {
    const bx = s * half, px = s * (half - CRICKET.crease), back = s * (half + 2.44);
    ctx.fillRect(X(bx) - line / 2, Y(-CRICKET.returnHalf), line, M(2 * CRICKET.returnHalf));   // bowling crease
    ctx.fillRect(X(px) - line / 2, Y(-2.33), line, M(4.66));                                   // popping crease
    for (const t of [-1, 1]) {                                                                 // return creases
      const x0 = Math.min(px, back), x1 = Math.max(px, back);
      ctx.fillRect(X(x0), Y(t * CRICKET.returnHalf) - line / 2, M(x1 - x0), line);
    }
  }
  return texture(c, anisotropy);
}

export function buildCricketField(scene, anisotropy) {
  const group = new THREE.Group();
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_L, FIELD_W),
    new THREE.MeshLambertMaterial({ map: makeCricketTexture(anisotropy) }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = 0.02;
  grass.receiveShadow = true;
  group.add(grass);
  const cover = makeCover(anisotropy, FIELD_L - 4, FIELD_W - 4);
  group.add(cover);

  // the stumps at both ends, three each with their two bails
  const half = CRICKET.pitchL / 2;
  const stumps = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xf1e3c2, roughness: 0.55 });
  const stumpGeo = new THREE.CylinderGeometry(0.018, 0.018, CRICKET.stumpH, 10);
  const bailGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.11, 6).rotateX(Math.PI / 2);
  const gap = CRICKET.stumpW / 2 - 0.018;
  for (const s of [-1, 1]) {
    for (const z of [-gap, 0, gap]) {
      const m = new THREE.Mesh(stumpGeo, wood);
      m.position.set(s * half, CRICKET.stumpH / 2, z);
      m.castShadow = true;
      stumps.add(m);
    }
    for (const z of [-gap / 2, gap / 2]) {
      const b = new THREE.Mesh(bailGeo, wood);
      b.position.set(s * half, CRICKET.stumpH + 0.008, z);
      stumps.add(b);
    }
  }
  group.add(stumps);

  // a sight screen behind each end, inside the rope, so the batter sees the ball
  const screens = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f3f0 });
  const frame = new THREE.MeshLambertMaterial({ color: 0x3a3d43 });
  for (const s of [-1, 1]) {
    const x = s * (BOWL_A - ROPE - 2.5);
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.3, 7.5, 20), white);
    face.position.set(x, 4.35, 0);
    face.castShadow = true;
    screens.add(face);
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 20.6), frame);
    base.position.set(x + s * 0.7, 0.3, 0);
    screens.add(base);
    for (const z of [-9, -3, 3, 9]) {
      const prop = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.15, 0.15), frame);
      prop.position.set(x + s * 1.0, 3.2, z);
      prop.rotation.z = s * 1.0;
      screens.add(prop);
    }
  }
  group.add(screens);
  scene.add(group);
  const goals = new THREE.Group();   // what a football stadium hides in other modes: here the match furniture
  goals.add(stumps, screens);
  return {
    group, grass, cover, goals,
    // a match brings the stumps and screens out; a show, a rink or a court
    // brings the deck down over the grass; empty, the screens stay out
    setSurface(mode) {
      cover.visible = mode === 'concert' || mode === 'hockey' || mode === 'basketball';
      stumps.visible = mode === 'cricket';
      screens.visible = mode === 'cricket' || mode === 'creative';
    },
  };
}

// --- the festival field ----------------------------------------------------------------
function makeGrassTile() {
  const [c, ctx] = makeCanvas(512, 512);
  const rand = mulberry32(31);
  ctx.fillStyle = '#25521f';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const g = 20 + rand() * 46;
    ctx.fillStyle = `rgba(${(g * 0.55) | 0},${(g + 34) | 0},${(g * 0.42) | 0},${0.08 + rand() * 0.12})`;
    ctx.fillRect(rand() * 512, rand() * 512, 1 + rand() * 3, 1 + rand() * 3);
  }
  const t = texture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// the field itself: grass, trodden to mud where the crowd stands (worst
// right in front of the stage), with the paths people wear coming in
function makeFestivalTexture(L, W) {
  const PX = 3072, PY = Math.round((PX * W) / L), ppm = PX / L;
  const [c, ctx] = makeCanvas(PX, PY);
  const rand = mulberry32(77);
  const X = (x) => PX / 2 + x * ppm, Y = (z) => PY / 2 + z * ppm, M = (m) => m * ppm;
  ctx.fillStyle = '#2a5a22';
  ctx.fillRect(0, 0, PX, PY);
  for (let i = 0; i < 52000; i++) {
    const g = 24 + rand() * 46;
    ctx.fillStyle = `rgba(${(g * 0.55) | 0},${(g + 34) | 0},${(g * 0.42) | 0},${0.06 + rand() * 0.1})`;
    ctx.fillRect(rand() * PX, rand() * PY, 1 + rand() * 3, 1 + rand() * 3);
  }
  // the crowd's ground: worn in patches, heaviest by the stage
  ctx.save();
  ctx.beginPath(); oval(ctx, X, Y, M, 0); ctx.clip();
  const front = SPEC.downstageX;
  for (let i = 0; i < 2600; i++) {
    const x = front + rand() * (BOWL_A - front), z = (rand() - 0.5) * 2 * BOWL_B;
    const near = 1 - (x - front) / (BOWL_A - front);
    if (rand() > 0.25 + near * 0.75) continue;
    const r = M(1 + rand() * 4.5);
    const g = ctx.createRadialGradient(X(x), Y(z), 0, X(x), Y(z), r);
    g.addColorStop(0, `rgba(92,70,44,${0.22 + near * 0.3})`);
    g.addColorStop(1, 'rgba(92,70,44,0)');
    ctx.fillStyle = g;
    ctx.fillRect(X(x) - r, Y(z) - r, r * 2, r * 2);
  }
  ctx.restore();
  // paths in from the gates at the sides and the back
  ctx.strokeStyle = 'rgba(120,98,66,0.55)';
  ctx.lineCap = 'round';
  for (const [x0, z0, x1, z1, w] of [[60, -W / 2, 30, -10, 3.2], [60, W / 2, 30, 10, 3.2], [L / 2, 0, BOWL_A - 6, 0, 4], [-10, -W / 2, -16, -BOWL_B + 6, 2.6], [-10, W / 2, -16, BOWL_B - 6, 2.6]]) {
    ctx.lineWidth = M(w);
    ctx.beginPath(); ctx.moveTo(X(x0), Y(z0)); ctx.quadraticCurveTo(X((x0 + x1) / 2 + 6), Y((z0 + z1) / 2), X(x1), Y(z1)); ctx.stroke();
  }
  return texture(c, 8);
}

export function buildFestivalField(scene, anisotropy) {
  const group = new THREE.Group();
  // grass to the horizon, over the sky's dark ground plane
  const tile = makeGrassTile();
  tile.repeat.set(220, 220);
  tile.anisotropy = anisotropy;
  const meadow = new THREE.Mesh(new THREE.PlaneGeometry(2200, 2200), new THREE.MeshLambertMaterial({ map: tile }));
  meadow.rotation.x = -Math.PI / 2;
  meadow.position.y = 0.0;
  meadow.receiveShadow = true;
  group.add(meadow);
  // the field the crowd stands on
  const L = BOWL_A * 2 + 70, W = BOWL_B * 2 + 70;
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshLambertMaterial({ map: makeFestivalTexture(L, W) }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = 0.02;
  grass.receiveShadow = true;
  group.add(grass);
  const cover = makeCover(anisotropy, BOWL_A * 2 - 6, BOWL_B * 2 - 6);   // a rink or a court, if anyone asks
  group.add(cover);
  scene.add(group);
  return {
    group, grass, cover, goals: new THREE.Group(),
    setSurface(mode) { cover.visible = mode === 'hockey' || mode === 'basketball'; },
  };
}

// Everything round the festival field. The towers stand where the spec cuts
// holes in the crowd (SPEC.crowdHoles); their tops are where moving heads can
// hang (irheads.js).
export function buildFestivalGrounds(scene) {
  const group = new THREE.Group();
  group.name = 'festivalGrounds';
  const rand = mulberry32(5150);
  const dummy = new THREE.Object3D();

  // --- the fence: crowd-barrier panels on feet, round the whole field ----------------
  {
    const a = BOWL_A + 14, b = BOWL_B + 14, r = BOWL_R + 14;
    const pts = [];
    const sx = a - r, sz = b - r, per = 4 * sx + 4 * sz + 2 * Math.PI * r;
    const at = (d) => {   // a point round the rounded rect at arc length d, and its tangent angle
      d = ((d % per) + per) % per;
      if (d < 2 * sx) return [sx - d, b, 0];
      d -= 2 * sx; if (d < (Math.PI / 2) * r) { const t = Math.PI / 2 + d / r; return [-sx + Math.cos(t) * r, sz + Math.sin(t) * r, t - Math.PI / 2]; }
      d -= (Math.PI / 2) * r; if (d < 2 * sz) return [-a, sz - d, Math.PI / 2];
      d -= 2 * sz; if (d < (Math.PI / 2) * r) { const t = Math.PI + d / r; return [-sx + Math.cos(t) * r, -sz + Math.sin(t) * r, t - Math.PI / 2]; }
      d -= (Math.PI / 2) * r; if (d < 2 * sx) return [-sx + d, -b, Math.PI];
      d -= 2 * sx; if (d < (Math.PI / 2) * r) { const t = -Math.PI / 2 + d / r; return [sx + Math.cos(t) * r, -sz + Math.sin(t) * r, t - Math.PI / 2]; }
      d -= (Math.PI / 2) * r; if (d < 2 * sz) return [a, -sz + d, -Math.PI / 2];
      d -= 2 * sz; const t = d / r; return [sx + Math.cos(t) * r, sz + Math.sin(t) * r, t - Math.PI / 2];
    };
    for (let d = 0; d < per; d += 3.5) pts.push(at(d));
    const panelMat = new THREE.MeshLambertMaterial({ color: 0x6d737c, transparent: true, opacity: 0.55, depthWrite: false });
    const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 2.0, 0.05), panelMat, pts.length);
    const feet = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.14, 0.24), new THREE.MeshLambertMaterial({ color: 0x24262b }), pts.length);
    pts.forEach(([x, z, ang], i) => {
      dummy.position.set(x, 1.1, z); dummy.rotation.set(0, -ang, 0); dummy.updateMatrix();
      panels.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 0.07; dummy.updateMatrix();
      feet.setMatrixAt(i, dummy.matrix);
    });
    group.add(panels, feet);
  }

  // --- trees: a band of woodland beyond the fence, and hills on the horizon ----------
  {
    const N = 340, trunks = [], crowns = [];
    for (let i = 0; i < N; i++) {
      const ang = rand() * Math.PI * 2;
      const rr = 1 + 0.25 + rand() * 0.9;
      const x = Math.cos(ang) * (BOWL_A + 40) * rr, z = Math.sin(ang) * (BOWL_B + 40) * rr;
      if (x > BOWL_A + 30 && Math.abs(z) < 30) continue;   // the gate stays open
      const s = 0.7 + rand() * 0.9;
      trunks.push([x, z, s]); crowns.push([x, z, s, rand()]);
    }
    const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 6, 6), new THREE.MeshLambertMaterial({ color: 0x2b2118 }), trunks.length);
    trunks.forEach(([x, z, s], i) => { dummy.position.set(x, 3 * s, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(s, s, s); dummy.updateMatrix(); trunkMesh.setMatrixAt(i, dummy.matrix); });
    const crownMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(4.2, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), crowns.length);
    const col = new THREE.Color();
    crowns.forEach(([x, z, s, k], i) => {
      dummy.position.set(x, 7.5 * s, z); dummy.rotation.set(k * 3, k * 5, 0); dummy.scale.set(s * (1 + k * 0.3), s * (1.1 + k * 0.4), s * (1 + k * 0.3)); dummy.updateMatrix();
      crownMesh.setMatrixAt(i, dummy.matrix);
      crownMesh.setColorAt(i, col.setHSL(0.27 + k * 0.06, 0.42, 0.11 + k * 0.06));
    });
    dummy.scale.set(1, 1, 1);
    group.add(trunkMesh, crownMesh);
    // hills, far off, just shapes against the sky
    const hillMat = new THREE.MeshLambertMaterial({ color: 0x0d1410 });
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + rand() * 0.2;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10), hillMat);
      hill.scale.set(160 + rand() * 140, 40 + rand() * 60, 120 + rand() * 100);
      hill.position.set(Math.cos(ang) * 760, -10, Math.sin(ang) * 760);
      group.add(hill);
    }
  }

  // --- food stalls down both sides: canopies in colour, a warm light under each ------
  {
    const spots = [];
    for (const side of [-1, 1]) for (let x = -44; x <= 64; x += 8.5) spots.push([x, side * (BOWL_B + 7.5), side]);
    const base = new THREE.InstancedMesh(new THREE.BoxGeometry(5.6, 2.6, 3.6), new THREE.MeshLambertMaterial({ color: 0x3a3430 }), spots.length);
    const roof = new THREE.InstancedMesh(new THREE.ConeGeometry(4.3, 2.2, 4, 1).rotateY(Math.PI / 4), new THREE.MeshLambertMaterial({ color: 0xffffff }), spots.length);
    const glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(5.0, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), spots.length);
    const hues = [0xd8343a, 0xf2b31b, 0x2a9d8f, 0x3d5af1, 0xe76f51, 0x8e44ad, 0xf4f1e8];
    const col = new THREE.Color();
    spots.forEach(([x, z, side], i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(x, 1.3, z); dummy.updateMatrix(); base.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, 3.7, z); dummy.updateMatrix(); roof.setMatrixAt(i, dummy.matrix);
      roof.setColorAt(i, col.setHex(hues[i % hues.length]));
      dummy.position.set(x, 2.35, z - side * 1.82); dummy.rotation.set(0, side > 0 ? Math.PI : 0, 0); dummy.updateMatrix();
      glow.setMatrixAt(i, dummy.matrix);
      glow.setColorAt(i, col.setRGB(2.2, 1.5, 0.8));
    });
    group.add(base, roof, glow);
  }

  // --- delay towers: scaffold, a deck, a hang of speakers facing the back -------------
  const towers = [];
  {
    const steel = [], dark = [];
    const H = 14;
    for (const [x, z] of SPEC.crowdHoles || []) {
      const t = boxTruss(H, 1.2, 1.6);
      t.rotateZ(Math.PI / 2);
      t.translate(x, H / 2, z);
      steel.push(t);
      const deck = new THREE.BoxGeometry(3.2, 0.2, 3.2);
      deck.translate(x, H, z);
      steel.push(deck);
      for (let k = 0; k < 6; k++) {   // a curved line-array of six boxes, aimed at the crowd behind
        const box = new THREE.BoxGeometry(0.9, 0.42, 1.2);
        box.rotateZ(-0.05 * k);
        box.translate(x + 0.9, H - 1.2 - k * 0.44, z);
        dark.push(box);
      }
      const base = new THREE.BoxGeometry(2.6, 0.6, 2.6);
      base.translate(x, 0.3, z);
      dark.push(base);
      towers.push({ x, z, top: H + 0.2 });
    }
    if (steel.length) group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(steel), new THREE.MeshLambertMaterial({ color: 0x9aa0a8, emissive: 0x15171b })));
    if (dark.length) group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(dark), new THREE.MeshLambertMaterial({ color: 0x1b1d21 })));
  }

  // --- the big wheel beyond the fence, lit, turning slowly ----------------------------
  const wheel = new THREE.Group();
  {
    const R = 19, cy = R + 4;
    // the site: the wheel and its A-frame, turned a little toward the stage
    const site = new THREE.Group();
    site.position.set(52, 0, -(BOWL_B + 62));
    site.rotation.y = 0.3;
    group.add(site);
    wheel.position.set(0, cy, 0);
    const steelMat = new THREE.MeshLambertMaterial({ color: 0xcfd4da, emissive: 0x15171b });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.35, 8, 72), steelMat);
    wheel.add(rim);
    const rim2 = rim.clone(); rim2.position.z = 1.6; wheel.add(rim2);
    const spokes = [];
    for (let i = 0; i < 16; i++) {
      const g = new THREE.CylinderGeometry(0.12, 0.12, R * 2, 5);
      g.rotateZ((i / 16) * Math.PI);
      spokes.push(g);
    }
    wheel.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(spokes), steelMat));
    // lights round the rim, warm white and in colour
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 96);
    const col = new THREE.Color();
    for (let i = 0; i < 96; i++) {
      const t = (i / 96) * Math.PI * 2;
      dummy.position.set(Math.cos(t) * R, Math.sin(t) * R, 0.8); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
      bulbs.setMatrixAt(i, dummy.matrix);
      bulbs.setColorAt(i, i % 3 ? col.setRGB(2.4, 1.8, 1.0) : col.setHSL(i / 96, 1, 0.5).multiplyScalar(2.4));
    }
    wheel.add(bulbs);
    site.add(wheel);
    // the A-frame it turns on, a pair of legs either side of the wheel
    const legs = [];
    for (const s of [-1, 1]) for (const dz of [-1.5, 3.1]) {
      const len = Math.hypot(cy, 9);
      const g = new THREE.CylinderGeometry(0.4, 0.5, len, 6);
      g.rotateZ(s * Math.atan2(9, cy));
      g.translate(s * 4.5, cy / 2, dz);
      legs.push(g);
    }
    site.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(legs), steelMat));
  }

  scene.add(group);
  return {
    group, towers,
    tick(dt) { wheel.rotation.z += dt * 0.05; },
  };
}
