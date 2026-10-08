// Arena geometry builders: floor, hoops, seating, scoreboard, rigs, dressing.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import {
  FLOOR_W, FLOOR_H, COURT_W, COURT_H, COURT_SCALE,
  makeCourtTextures, makeBackboardDecal, makeScoreboard,
  makeRibbon, makeBanner, makeBallTextures,
  makeOrbDiscTexture, billboardInstanced, ARENA_GRAY, makeFasciaTexture,
} from './textures.js';
import { boxTruss } from './truss.js';
import { makeUltraConcrete, makeUltraUnderdeck } from './textures_ultra_arena.js';
import { liftBake, bowlOffsetAt, frontWallOff } from './bowl.js';
import { makeUltraCushion } from './textures_ultra_seats.js';

const HOOP_X = COURT_W / 2 - 1.575 * COURT_SCALE; // rim centre from court centre
const RIM_Y = 3.05;

// Shared materials -----------------------------------------------------------
const padBlack = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.85 });
const steelDark = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.4, metalness: 0.85 });
const steelLight = new THREE.MeshStandardMaterial({ color: 0x777c84, roughness: 0.35, metalness: 0.9 });

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Fresnel-driven opacity: near-opaque looking straight down, lets the mirror
// underneath bleed through toward grazing angles like a real polished floor.
// ---------------------------------------------------------------------------
// Camera-facing disc material for the crowd orbs (see textures.js for why).
function orbDiscMaterial() {
  const m = new THREE.MeshBasicMaterial({
    color: 0x000000, map: makeOrbDiscTexture(),
    alphaTest: 0.45,        // crisp circle, no transparency sorting
    fog: false,
  });
  billboardInstanced(m, { waveMute: 1 });   // courtside + floor seats: they clap, the bowl waves
  return m;
}

export function fresnelize(mat, aNear, aFar, power = 3.4) {
  mat.transparent = true;
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <alphamap_fragment>',
      `#include <alphamap_fragment>
       float fres = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), ${power.toFixed(1)});
       diffuseColor.a = mix(${aNear.toFixed(3)}, ${aFar.toFixed(3)}, fres);`
    );
  };
}

// ---------------------------------------------------------------------------
// Floor: planar mirror underneath + wood court on top with Fresnel opacity,
// so reflections strengthen at grazing angles like real polished maple.
// The mirror covers the whole event floor (rink footprint), shared by all modes.
// ---------------------------------------------------------------------------
export function buildFloor(scene, anisotropy, surround = true) {
  const mirror = new Reflector(new THREE.PlaneGeometry(76, 38), {
    clipBias: 0.003,
    textureWidth: 768,
    textureHeight: 768,
    color: 0xbfbfbf,
  });
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.y = 0;
  scene.add(mirror);

  const tex = makeCourtTextures(anisotropy);
  const mat = new THREE.MeshPhysicalMaterial({
    map: tex.map,
    roughnessMap: tex.roughnessMap,
    roughness: 1.0,
    bumpMap: tex.bumpMap,
    bumpScale: 0.6,
    clearcoat: 0.85,
    clearcoatRoughness: 0.22,
    depthWrite: true,
  });
  fresnelize(mat, 0.992, 0.88);   // court varnish: reflective, not a mirror
  const court = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_W, FLOOR_H), mat);
  court.rotation.x = -Math.PI / 2;
  court.position.y = 0.008;
  court.receiveShadow = true;
  scene.add(court);

  // concrete surround beyond the hardwood — 2 m saw-cut panels, so the tile
  // repeat is simply half the plane size
  const conc = makeUltraConcrete();
  liftBake(conc.map, 2.4);   // event-floor concrete: brighter than asphalt, darker than the concourse
  conc.map.repeat.set(70, 70);
  conc.map.anisotropy = Math.min(4, anisotropy);   // 16x on a 140 m plane is pure cost
  // the stadium skips this: its turf is its own floor, and a second plane a
  // centimetre under it depth-fought into a dark blotch from the far stands
  if (surround) {
    const concrete = new THREE.Mesh(
      new THREE.PlaneGeometry(140, 140),
      new THREE.MeshStandardMaterial({ map: conc.map, roughness: 0.95 })
    );
    concrete.rotation.x = -Math.PI / 2;
    concrete.position.y = -0.01;
    concrete.receiveShadow = true;
    scene.add(concrete);
  }

  return { mirror, court };
}

// ---------------------------------------------------------------------------
// Basketball net: diamond lattice of thin cylinders between rings.
// ---------------------------------------------------------------------------
function buildNet() {
  const rings = 7, around = 12;
  const topR = 0.2286, botR = 0.145, len = 0.42;
  const pts = [];
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);
    const radius = THREE.MathUtils.lerp(topR, botR, Math.pow(t, 0.8)) * (r === rings - 1 ? 1.12 : 1);
    const y = -t * len;
    const row = [];
    for (let a = 0; a < around; a++) {
      const ang = ((a + (r % 2) * 0.5) / around) * Math.PI * 2;
      row.push(new THREE.Vector3(Math.cos(ang) * radius, y, Math.sin(ang) * radius));
    }
    pts.push(row);
  }
  const geos = [];
  const seg = (a, b) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const g = new THREE.CylinderGeometry(0.0035, 0.0035, dir.length(), 4, 1);
    g.translate(0, dir.length() / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    g.applyQuaternion(q);
    g.translate(a.x, a.y, a.z);
    geos.push(g);
  };
  for (let r = 0; r < rings - 1; r++) {
    for (let a = 0; a < around; a++) {
      seg(pts[r][a], pts[r + 1][a]);
      seg(pts[r][a], pts[r + 1][(a + (r % 2 === 0 ? around - 1 : 1)) % around]);
    }
  }
  const net = new THREE.Mesh(
    BufferGeometryUtils.mergeGeometries(geos),
    new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.9 })
  );
  net.castShadow = true;
  return net;
}

// ---------------------------------------------------------------------------
// Full hoop assembly (stanchion, glass board, rim, net, padding).
// ---------------------------------------------------------------------------
export function buildHoop(scene, side, decal) {
  const g = new THREE.Group();
  // Backboard sits FURTHER from centre than the rim, so the ring overhangs
  // the court. Having it the other way round hung the rim out behind the glass.
  const boardX = HOOP_X + 0.375;

  // glass backboard 1.83 x 1.07, bottom at 2.90
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 1.07, 1.83),
    // plain transparency instead of transmission: avoids an extra
    // full-scene render pass per frame and still reads as arena glass
    new THREE.MeshPhysicalMaterial({
      color: 0x2a3138, transparent: true, opacity: 0.14,
      roughness: 0.03, metalness: 0, envMapIntensity: 0.25,
      clearcoat: 1, clearcoatRoughness: 0.05,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  glass.position.set(boardX, 2.9 + 1.07 / 2, 0);
  glass.castShadow = true;
  g.add(glass);

  // decal (white frame + shooter square) floating a hair in front of the glass
  const decalMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.83, 1.07),
    new THREE.MeshStandardMaterial({ map: decal, transparent: true, side: THREE.DoubleSide, roughness: 0.5 })
  );
  decalMesh.rotation.y = -Math.PI / 2;
  decalMesh.position.set(boardX - 0.011, 2.9 + 1.07 / 2, 0);
  g.add(decalMesh);

  // board frame
  const frame = box(0.05, 1.11, 1.87, steelDark);
  frame.position.set(boardX + 0.035, 2.9 + 1.07 / 2, 0);
  g.add(frame);

  // bottom edge padding
  const boardPad = box(0.08, 0.09, 1.83, padBlack);
  boardPad.position.set(boardX, 2.9 - 0.02, 0);
  g.add(boardPad);

  // rim + mounting plate
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.2286, 0.0095, 12, 36),
    new THREE.MeshStandardMaterial({
      color: 0xe8531f, roughness: 0.4, metalness: 0.35,
      emissive: 0x6b2306, emissiveIntensity: 1.0, // reads orange even from below
    })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.set(HOOP_X, RIM_Y, 0);
  rim.castShadow = true;
  g.add(rim);
  // rim mount: slim plate against the glass + short neck out to the ring
  const plate = box(0.03, 0.3, 0.38, steelDark);
  plate.position.set(boardX - 0.02, RIM_Y + 0.02, 0);
  g.add(plate);
  const neck = box(0.14, 0.035, 0.09, steelDark);
  neck.position.set(boardX - 0.09, RIM_Y - 0.03, 0);
  g.add(neck);

  const net = buildNet();
  net.position.set(HOOP_X, RIM_Y - 0.01, 0);
  g.add(net);

  // stanchion: base ~2.1m behind baseline, arm reaching over
  const baseX = COURT_W / 2 + 1.9;
  const base = box(2.1, 0.55, 1.15, padBlack);
  base.position.set(baseX + 0.7, 0.28, 0);
  g.add(base);
  const column = box(0.42, 3.5, 0.42, padBlack);
  column.position.set(baseX, 1.75 + 0.4, 0);
  g.add(column);
  // angled arm from column top to behind the board
  const armLen = Math.hypot(baseX - boardX - 0.15, 0.35) + 0.2;
  const arm = box(armLen, 0.16, 0.24, steelDark);
  arm.position.set((baseX + boardX) / 2, 3.75, 0);
  arm.rotation.z = Math.atan2(0.3, baseX - boardX);
  g.add(arm);
  const armLow = box(armLen * 0.9, 0.1, 0.16, steelDark);
  armLow.position.set((baseX + boardX) / 2 + 0.1, 3.3, 0);
  armLow.rotation.z = Math.atan2(0.75, baseX - boardX);
  g.add(armLow);

  if (side < 0) g.rotation.y = Math.PI;
  scene.add(g);
  return g;
}

// ---------------------------------------------------------------------------
// Courtside folding chairs (instanced).
// ---------------------------------------------------------------------------
export function buildCourtsideSeats(scene) {
  const spots = []; // {x, z, yaw}
  const sideRows = [9.4, 10.15, 10.9];
  for (const zSign of [-1, 1]) {
    sideRows.forEach((rowZ, ri) => {
      for (let x = -12.6; x <= 12.6; x += 0.62) {
        // leave the scorer's table stretch open on the +z sideline, row 0
        if (zSign > 0 && ri === 0 && Math.abs(x) < 5.4) continue;
        spots.push({ x, z: zSign * rowZ, yaw: zSign > 0 ? Math.PI : 0, row: ri });
      }
    });
  }
  for (const xSign of [-1, 1]) {
    [17.1, 17.85].forEach((rowX, ri) => {
      for (let z = -7.2; z <= 7.2; z += 0.62) {
        spots.push({ x: xSign * rowX, z, yaw: xSign > 0 ? -Math.PI / 2 : Math.PI / 2, row: ri });
      }
    });
  }

  const cushionTex = makeUltraCushion();
  const cushionMat = new THREE.MeshPhysicalMaterial({
    map: cushionTex.map, roughnessMap: cushionTex.roughnessMap, roughness: 1.0,
    clearcoat: 0.5, clearcoatRoughness: 0.35,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.35, metalness: 0.8 });

  const seatGeo = new THREE.BoxGeometry(0.52, 0.1, 0.5);
  const backGeo = new THREE.BoxGeometry(0.52, 0.46, 0.09);
  const legGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.46, 8);

  const n = spots.length;
  const seats = new THREE.InstancedMesh(seatGeo, cushionMat, n);
  const backs = new THREE.InstancedMesh(backGeo, cushionMat, n);
  const legsFL = new THREE.InstancedMesh(legGeo, frameMat, n);
  const legsFR = new THREE.InstancedMesh(legGeo, frameMat, n);
  const legsBL = new THREE.InstancedMesh(legGeo, frameMat, n);
  const legsBR = new THREE.InstancedMesh(legGeo, frameMat, n);

  const dummy = new THREE.Object3D();
  const place = (mesh, i, lx, ly, lz, spot, tiltX = 0) => {
    dummy.position.set(spot.x, 0, spot.z);
    dummy.rotation.set(0, spot.yaw + spot.jitter, 0);
    dummy.updateMatrix();
    const local = new THREE.Object3D();
    local.position.set(lx, ly, lz);
    local.rotation.x = tiltX;
    local.updateMatrix();
    dummy.matrix.multiply(local.matrix);
    mesh.setMatrixAt(i, dummy.matrix);
  };

  spots.forEach((spot, i) => {
    spot.jitter = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.09 - 0.045;
    place(seats, i, 0, 0.45, 0, spot);
    place(backs, i, 0, 0.68, -0.22, spot, -0.09);
    place(legsFL, i, -0.21, 0.23, 0.19, spot);
    place(legsFR, i, 0.21, 0.23, 0.19, spot);
    place(legsBL, i, -0.21, 0.23, -0.19, spot);
    place(legsBR, i, 0.21, 0.23, -0.19, spot);
  });

  const group = new THREE.Group();
  for (const m of [seats, backs, legsFL, legsFR, legsBL, legsBR]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  // matching black orbs above the courtside chairs (see bowl.js)
  const orbs = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.246, 0.246),
    orbDiscMaterial(),
    n
  );
  const orbDummy = new THREE.Object3D();
  const orbPos = new Float32Array(n * 3);
  spots.forEach((spot, i) => {
    orbDummy.position.set(spot.x, 0.82, spot.z);
    orbDummy.updateMatrix();
    orbs.setMatrixAt(i, orbDummy.matrix);
    orbPos[i * 3] = spot.x; orbPos[i * 3 + 1] = 0.82; orbPos[i * 3 + 2] = spot.z;
  });
  group.add(orbs);
  scene.add(group);
  return { group, orbs, orbPos };
}

// ---------------------------------------------------------------------------
// Floor seating — the ticketed blocks that fill the arena floor outside the
// courtside rows: a few rows along each sideline and deep blocks behind each
// basket, stepped up on risers. Kept entirely separate from
// buildCourtsideSeats() because those are the front-row courtside chairs and
// are positioned against the court itself.
// ---------------------------------------------------------------------------
export function buildFloorSeats(scene) {
  const PITCH = 0.56;
  // Floor furniture is CLIPPED to the bowl rather than sized by hand. The
  // sideline strip used to run to z 14.16 and the end risers to z 13.2, both
  // measured against a bowl whose inner edge sat 2.6 m off the boards; once
  // that apron came in to 0.9 the outer sideline row was past the inner edge
  // and the end risers punched a metre through the front wall. Asking the bowl
  // where its edge is means this survives the next time it moves.
  const CLEAR = 0.55;                              // gap to the bowl's front wall
  // Measured against the FRONT WALL, not the bowl's nominal inner edge: the
  // wall stands 0.65 m outside it, and testing the inner edge threw away a
  // row of seats that sits on genuinely clear slab.
  const clearOfBowl = (x, z) => bowlOffsetAt(x, z) <= frontWallOff() - CLEAR;
  // widest |z| still clear of the bowl at this x, for the riser decks
  const zLimitAt = (x) => {
    let z = 0;
    while (z < 30 && clearOfBowl(x, z + 0.1)) z += 0.1;
    return z;
  };
  // End-block rake. 11 rows, so the back row sits at 10 * END_RISE. At 0.17
  // that reached 1.70 m, which was too steep for a floor block; 0.085 halves
  // the height of the highest row to 0.85 m.
  const END_RISE = 0.085;
  const spots = [];

  // sideline strip: between the courtside rows and the bowl wall
  for (const zs of [-1, 1]) {
    for (let r = 0; r < 4; r++) {
      const z = zs * (11.7 + r * 0.82);
      const y = r * 0.1;                       // gentle rake toward the back
      for (let x = -18.6; x <= 18.61; x += PITCH) {
        if (Math.abs(x % 8.4) < 0.85) continue;      // cross aisles
        if (!clearOfBowl(x, z)) continue;
        spots.push({ x, y, z, yaw: zs > 0 ? Math.PI : 0 });
      }
    }
  }
  // end blocks behind each basket, on risers stepping away from the court
  for (const xs of [-1, 1]) {
    for (let r = 0; r < 11; r++) {
      const x = xs * (19.4 + r * 0.9);
      const y = r * END_RISE;                  // riser platforms
      for (let z = -12.6; z <= 12.61; z += PITCH) {
        if (Math.abs(z % 7.2) < 0.85) continue;      // vomitory aisles
        if (!clearOfBowl(x, z)) continue;
        spots.push({ x, y, z, yaw: xs > 0 ? -Math.PI / 2 : Math.PI / 2 });
      }
    }
  }

  const group = new THREE.Group();
  const n = spots.length;
  // Same gray as the arena deck, so the block reads as part of the venue
  // instead of a black mass sitting on a gray floor.
  const cushion = new THREE.MeshLambertMaterial({ color: ARENA_GRAY });
  const frameMat = new THREE.MeshLambertMaterial({ color: ARENA_GRAY });

  // one merged chair (pan + back + four legs) so the whole block is 1 draw call
  const chairGeos = [];
  const put = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    chairGeos.push(g);
  };
  put(0.46, 0.08, 0.44, 0, 0.44, 0);           // pan
  put(0.46, 0.42, 0.07, 0, 0.66, -0.21);       // back
  for (const lx of [-0.2, 0.2]) for (const lz of [-0.18, 0.18]) put(0.035, 0.44, 0.035, lx, 0.22, lz);
  const chairGeo = BufferGeometryUtils.mergeGeometries(chairGeos);

  const chairs = new THREE.InstancedMesh(chairGeo, cushion, n);
  const dummy = new THREE.Object3D();
  spots.forEach((s, i) => {
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(0, s.yaw, 0);
    dummy.updateMatrix();
    chairs.setMatrixAt(i, dummy.matrix);
  });
  chairs.castShadow = false;
  chairs.receiveShadow = true;
  group.add(chairs);

  // riser decks under the end blocks so seats do not float
  const riserGeos = [];
  for (const xs of [-1, 1]) {
    for (let r = 0; r < 11; r++) {
      const x = xs * (19.4 + r * 0.9);
      // each riser stops where the bowl's corner arc comes round to meet it,
      // instead of every deck running the same 26.4 m and overshooting
      const len = Math.min(26.4, 2 * zLimitAt(x));
      if (len < 1) continue;
      const g = new THREE.BoxGeometry(0.9, Math.max(0.04, r * END_RISE), len);
      g.translate(x, Math.max(0.02, r * END_RISE / 2), 0);
      riserGeos.push(g);
    }
  }
  group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(riserGeos), frameMat));

  // matching crowd orbs, one per seat (see bowl.js for why these are discs)
  const orbs = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.246, 0.246),
    orbDiscMaterial(),
    n
  );
  const orbPos = new Float32Array(n * 3);
  spots.forEach((s, i) => {
    const oy = s.y + 0.82;
    dummy.position.set(s.x, oy, s.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    orbs.setMatrixAt(i, dummy.matrix);
    orbPos[i * 3] = s.x; orbPos[i * 3 + 1] = oy; orbPos[i * 3 + 2] = s.z;
  });
  group.add(orbs);

  scene.add(group);
  return { group, orbs, orbPos, seatCount: n };
}

// ---------------------------------------------------------------------------
// Scorer's table + LED ad boards.
// ---------------------------------------------------------------------------
export function buildLedBoards(scene, ribbonTex) {
  const boards = [];
  const root = new THREE.Group();
  function board(x, z, w, yaw) {
    const grp = new THREE.Group();
    const body = box(w, 0.78, 0.55, padBlack);
    body.position.y = 0.39;
    grp.add(body);
    const tex = ribbonTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(w / 8, 1);
    const led = new THREE.Mesh(
      new THREE.PlaneGeometry(w, 0.6),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    led.material.color.setScalar(1.4); // push into bloom
    led.position.set(0, 0.42, 0.281);
    grp.add(led);
    const top = box(w, 0.06, 0.6, padBlack);
    top.position.y = 0.81;
    grp.add(top);
    grp.position.set(x, 0, z);
    grp.rotation.y = yaw;
    root.add(grp);
    boards.push(tex);
  }
  board(0, 9.15, 10.5, Math.PI);        // scorer's table
  board(-9, -9.15, 7.5, 0);             // opposite sideline
  board(9, -9.15, 7.5, 0);
  // baselines — split around the stanchion
  board(16.6, 3.6, 4.6, -Math.PI / 2);
  board(16.6, -3.6, 4.6, -Math.PI / 2);
  board(-16.6, 3.6, 4.6, Math.PI / 2);
  board(-16.6, -3.6, 4.6, Math.PI / 2);
  scene.add(root);
  return { group: root, textures: boards };
}

// ---------------------------------------------------------------------------
// Center-hung scoreboard.
// ---------------------------------------------------------------------------
export function buildScoreboard(scene, faceTex) {
  const grp = new THREE.Group();
  const W = 7.6, H = 4.3, D = 7.6;
  const bezel = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.55, metalness: 0.4 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.4, metalness: 0.75 });

  // slim housing: a modern cube is mostly screen, with a thin frame
  grp.add(box(W, H, D, bezel));

  // four main faces. 1.12x sits just UNDER the 1.25 bloom gate, so the screens
  // read bright and crisp without the whole board haloing out.
  for (let i = 0; i < 4; i++) {
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(W - 0.55, H - 0.5),
      new THREE.MeshBasicMaterial({ map: faceTex })
    );
    face.material.color.setScalar(1.12);
    face.rotation.y = (i * Math.PI) / 2;
    face.position.set(Math.sin((i * Math.PI) / 2) * (D / 2 + 0.03), 0.05,
                      Math.cos((i * Math.PI) / 2) * (D / 2 + 0.03));
    grp.add(face);
    // matte screen surround, proud of the housing like a real cabinet frame
    const rim = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, H - 0.15),
      new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.85 }));
    rim.rotation.y = face.rotation.y;
    rim.position.copy(face.position).multiplyScalar(0.995);
    rim.position.y = 0.05;
    grp.add(rim);
  }
  // corner mullions covering the face seams
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const post = box(0.3, H + 0.1, 0.3, trim);
    post.position.set(sx * (W / 2 - 0.02), 0, sz * (D / 2 - 0.02));
    grp.add(post);
  }

  // upper accent ring: a quiet amber LED trim, barely over the bloom gate so
  // it glows softly instead of swallowing the board
  const halo = new THREE.Mesh(
    new THREE.CylinderGeometry(W * 0.6, W * 0.6, 0.16, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff8a2a, side: THREE.DoubleSide })
  );
  halo.material.color.multiplyScalar(1.28);
  halo.position.y = H / 2 + 0.14;
  grp.add(halo);
  // dark structural rings above and below the accent, like real edge trim
  for (const y of [H / 2 + 0.28, H / 2 + 0.02]) {
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(W * 0.605, W * 0.605, 0.05, 48, 1, true), trim);
    ring.position.y = y;
    grp.add(ring);
  }

  // under-hung ribbon board, dim, with a metal cap beneath
  // ribbon runs sponsor plates like the bowl fascias. The ad tile covers
  // 57.6m; this ring is ~21.5m around, so a partial repeat keeps the plates
  // at their true size — about one sponsor per side.
  const ribbonTex = makeFasciaTexture(7);
  ribbonTex.repeat.set(21.5 / 57.6, 1);
  const ribbon = new THREE.Mesh(
    new THREE.CylinderGeometry(W * 0.5, W * 0.5, 0.5, 4, 1, true),
    new THREE.MeshBasicMaterial({ map: ribbonTex, side: THREE.DoubleSide })
  );
  ribbon.material.color.setScalar(1.1);
  ribbon.rotation.y = Math.PI / 4;
  ribbon.position.y = -H / 2 - 0.85;
  grp.add(ribbon);
  const belly = box(W * 0.73, 0.12, D * 0.73, trim);
  belly.position.y = -H / 2 - 1.16;
  grp.add(belly);

  // rigging: four angled spider arms from the corners to a centre hub, then
  // cables up into the grid — how a centre-hung board actually flies
  const hub = box(0.7, 0.5, 0.7, trim);
  hub.position.y = H / 2 + 1.7;
  grp.add(hub);
  const armMat = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.45, metalness: 0.8 });
  for (const [cx, cz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) {
    const from = new THREE.Vector3(cx, H / 2 + 0.05, cz);
    const to = new THREE.Vector3(0, H / 2 + 1.6, 0);
    const len = from.distanceTo(to);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 8), armMat);
    arm.position.copy(from).add(to).multiplyScalar(0.5);
    arm.lookAt(to);
    arm.rotateX(Math.PI / 2);
    grp.add(arm);
    // corner bracket where the arm lands
    const bracket = box(0.34, 0.14, 0.34, trim);
    bracket.position.set(cx, H / 2 + 0.06, cz);
    grp.add(bracket);
  }
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.8 });
  for (const [cx, cz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) {
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 15, 6), cableMat);
    cable.position.set(cx, H / 2 + 9.2, cz);
    grp.add(cable);
  }
  grp.position.set(0, 14.6, 0);
  scene.add(grp);
  return grp;
}

// ---------------------------------------------------------------------------
// Ceiling: real long-span roof at the raised house-steel height — corrugated
// deck, primary box trusses across the short axis, a y=29 catwalk grid that
// carries the house lights, HVAC/sprinkler services, work-light glows, and
// the championship banners. Everything merges to <= 10 draw calls.
// ---------------------------------------------------------------------------
export function buildCeiling(scene, lightPositions) {
  const cg = new THREE.Group(); // everything overhead, maskable for the 2D bird view

  // Everything in the building's ROOF PLANE rides this one lift, so the parts
  // keep the relationships they were designed in instead of drifting apart.
  //
  // Set by sightline, not taste: the 400s' back row seats top out at 36.3 m and
  // the primary trusses' bottom chords sat at 35.2 — dead level with a standing
  // spectator's eye. From the last row the steel and the HVAC runs sliced
  // straight through the far side's crowd. +6.5 puts the LOWEST overhead
  // element (a diffuser cone, previously 31.9) at 38.4, a clear 2 m above the
  // last seat, and lifts the deck itself with it.
  //
  // Two things deliberately do NOT move:
  //  - the catwalk grid at y 29. It hangs over the floor, far below the top
  //    rows, and the house lights live on it (SPEC.lightY). Its hanger rods and
  //    lamp drops STRETCH to reach the raised steel instead.
  //  - the show rig's hang height (SPEC.roofY). That is production, not
  //    building; raising it would change every beam angle in every look.
  const LIFT = 6.5;

  // --- roof decks: main lid at 38.6 + perimeter ring at the bowl edge ---------
  // the deck faces down, so hemisphere light barely reaches it — a faint
  // emissive keyed to the same texture keeps the ribbing readable in the dark
  const roundedRect = (path, hw, hh, r) => {
    path.moveTo(-hw + r, -hh);
    path.lineTo(hw - r, -hh);
    path.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0);
    path.lineTo(hw, hh - r);
    path.absarc(hw - r, hh - r, r, 0, Math.PI / 2);
    path.lineTo(-hw + r, hh);
    path.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI);
    path.lineTo(-hw, -hh + r);
    path.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5);
  };
  const deckGeos = [];
  const mainDeck = new THREE.PlaneGeometry(140, 110);
  mainDeck.rotateX(Math.PI / 2);           // normal down
  mainDeck.translate(0, 38.6 + LIFT, 0);
  deckGeos.push(mainDeck);
  const ringShape = new THREE.Shape();
  // Outer edge has to reach past the bowl's rear wall or you see sky between
  // the two. main.js scales this group 1.06, and the wall sits at 81.6 x 64.1
  // now the bowl carries the chart's 47 rows, so 78 x 61.5 lands ~1 m proud.
  // UVs stay normalised by the 140 x 110 lid so the corrugation pitch matches
  // across the seam; the ring's own UVs just run a little past 0..1 and wrap.
  roundedRect(ringShape, 78, 61.5, 10);
  const ringHole = new THREE.Path();
  roundedRect(ringHole, 63, 46, 8);        // bowl footprint at roof level
  ringShape.holes.push(ringHole);
  const ringDeck = new THREE.ShapeGeometry(ringShape, 20);
  {  // shape UVs are in local units — remap to 0..1 so the tiled deck matches
    const uv = ringDeck.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (uv.getX(i) + 70) / 140, (uv.getY(i) + 55) / 110);
    }
  }
  ringDeck.rotateX(Math.PI / 2);           // normal down
  ringDeck.translate(0, 36.8 + LIFT, 0);
  deckGeos.push(ringDeck);
  // corrugated steel roof deck with girder ribs — repeat sized so the
  // corrugation lands near real 0.25 m pitch over the 140 x 110 m lid
  const ultraDeck = makeUltraUnderdeck();
  liftBake(ultraDeck.map, 2.1, 0.8);   // painted steel: lighter, keep a hint of the rust hue
  ultraDeck.map.repeat.set(35, 27);
  cg.add(new THREE.Mesh(
    BufferGeometryUtils.mergeGeometries(deckGeos),
    // Lambert: a 140 m lid in Standard samples the environment on every
    // pixel of sky. The emissive keyed to the corrugation albedo is what
    // actually reads from the floor.
    new THREE.MeshLambertMaterial({
      map: ultraDeck.map, color: 0xb9bec8,
      emissive: 0xffffff, emissiveMap: ultraDeck.map, emissiveIntensity: 0.5,
    })
  ));

  // --- long-span structure: everything steel merges into one mesh -------------
  // Lambert: this is an enormous merged mesh that fills the frame whenever
  // anyone looks up, and dark roof steel gets nothing from the environment
  // that its emissive floor isn't already providing.
  // Pale painted steel. The reference roofs are white-grey and clearly visible
  // from every seat; dark steel read as a black lid and lost the whole truss.
  const trussMat = new THREE.MeshLambertMaterial({
    color: 0xa9afb9,
    emissive: 0x585e68, emissiveIntensity: 1,
  });
  const steelGeos = [];

  // primary box trusses spanning the SHORT axis (z), spaced every ~14 m in x;
  // section 2.4 puts the chords at y 35.2 / 37.6, tight under the deck
  const primaries = [[-42, 78], [-28, 86], [-14, 92], [0, 92], [14, 92], [28, 86], [42, 78]];
  for (const [x, len] of primaries) {
    const g = boxTruss(len, 2.4, 3.0);
    g.rotateY(Math.PI / 2);                // boxTruss builds along +X → span z
    g.translate(x, 36.4 + LIFT, 0);
    steelGeos.push(g);
  }
  // two secondary trusses along the LONG axis, weaving just under the primaries
  for (const z of [-14, 14]) {
    const g = boxTruss(118, 1.6, 3.0);
    g.translate(0, 35.0 + LIFT, z);
    steelGeos.push(g);
  }

  // --- catwalk grid at y=29: the house lights hang off these ------------------
  const railRun = (len, alongX, cx, cz) => {
    // mesh floor (thin dark box), kick plate, two rail heights, posts
    const L = alongX ? len : 1.2, D = alongX ? 1.2 : len;
    const f = new THREE.BoxGeometry(L, 0.08, D);
    f.translate(cx, 28.96, cz);
    steelGeos.push(f);
    for (const side of [-0.6, 0.6]) {
      for (const ry of [29.55, 30.05]) {
        const r = new THREE.BoxGeometry(alongX ? len : 0.05, 0.05, alongX ? 0.05 : len);
        r.translate(alongX ? cx : cx + side, ry, alongX ? cz + side : cz);
        steelGeos.push(r);
      }
      for (let t = -len / 2; t <= len / 2; t += 3.5) {
        const p = new THREE.BoxGeometry(0.05, 1.1, 0.05);
        p.translate(alongX ? cx + t : cx + side, 29.55, alongX ? cz + side : cz + t);
        steelGeos.push(p);
      }
    }
  };
  railRun(70, true, 0, -6);                // two parallel runs along x
  railRun(70, true, 0, 6);
  for (const bx of [-25, 0, 25]) railRun(10.8, false, bx, 0); // 3 cross bridges
  // hanger rods: catwalks suspended from the primary bottom chords
  for (const [x] of primaries) {
    if (Math.abs(x) > 35) continue;        // outermost trusses clear the walkways
    for (const z of [-6, 6]) {
      const rod = new THREE.CylinderGeometry(0.04, 0.04, 6.2 + LIFT, 6);
      rod.translate(x, 32.1 + LIFT / 2, z);
      steelGeos.push(rod);
    }
  }
  // small fixture boxes at every house-light position (Vector3s, y already 29)
  for (const p of lightPositions) {
    const box = new THREE.BoxGeometry(0.55, 0.42, 0.55);
    box.translate(p.x, p.y + 0.25, p.z);
    steelGeos.push(box);
    const drop = new THREE.CylinderGeometry(0.035, 0.035, 5.9 + LIFT, 6); // up to steel
    drop.translate(p.x, p.y + 3.4 + LIFT / 2, p.z);
    steelGeos.push(drop);
  }
  // cable trays: long thin U-channels riding below the secondary trusses
  for (const [z, y0] of [[-20, 34.6], [2, 34.7], [24, 34.5]]) {
    const y = y0 + LIFT;
    const bottom = new THREE.BoxGeometry(100, 0.04, 0.5);
    bottom.translate(0, y, z);
    steelGeos.push(bottom);
    for (const s of [-0.25, 0.25]) {
      const side = new THREE.BoxGeometry(100, 0.18, 0.04);
      side.translate(0, y + 0.09, z + s);
      steelGeos.push(side);
    }
  }
  // banner hang cables (banners themselves are separate textured planes)
  for (let i = 0; i < 5; i++) {
    const bx = -22 + i * 11;
    for (const dx of [-1.2, 1.2]) {
      // banners stay in the room, so the cable grows to reach the raised steel
      const c = new THREE.BoxGeometry(0.04, 3.65 + LIFT, 0.04);
      c.translate(bx + dx, 34.68 + LIFT / 2, -28);
      steelGeos.push(c);
    }
  }
  cg.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(steelGeos), trussMat));

  // --- services: HVAC ducts, drop vents, sprinkler runs — one dark mesh -------
  const ductGeos = [];
  const ducts = [ // [z, y, radius, length, vents?]
    [-26, 34.0, 0.7, 116, true], [-18, 34.8, 0.5, 110, false],
    [-10, 33.8, 0.6, 118, true], [-3, 35.2, 0.45, 106, false],
    [4, 34.4, 0.65, 118, true], [11, 33.6, 0.5, 114, false],
    [18, 35.0, 0.7, 110, true], [25, 34.2, 0.55, 108, false],
    [31, 34.9, 0.4, 98, true],
  ];
  for (const [z, y0, r, len, vents] of ducts) {
    const y = y0 + LIFT;
    const run = new THREE.CylinderGeometry(r, r, len, 10);
    run.rotateZ(Math.PI / 2);              // along x
    run.translate(0, y, z);
    ductGeos.push(run);
    for (const ex of [-len / 2, len / 2]) { // elbow joints + risers to the deck
      const elbow = new THREE.SphereGeometry(r * 1.06, 8, 6);
      elbow.translate(ex, y, z);
      ductGeos.push(elbow);
      const riser = new THREE.CylinderGeometry(r * 0.9, r * 0.9, 38.6 + LIFT - y, 8);
      riser.translate(ex, (38.6 + LIFT + y) / 2, z);
      ductGeos.push(riser);
    }
    if (!vents) continue;
    for (let x = -45; x <= 45; x += 15) {  // drop vents + diffuser cones
      const neck = new THREE.CylinderGeometry(0.16, 0.16, 1.0, 8);
      neck.translate(x, y - r - 0.4, z);
      ductGeos.push(neck);
      const diffuser = new THREE.CylinderGeometry(0.16, 0.55, 0.35, 10); // flares down
      diffuser.translate(x, y - r - 1.05, z);
      ductGeos.push(diffuser);
    }
  }
  for (let x = -48; x <= 48; x += 12) {    // sprinkler pipes crossing the ducts
    const pipe = new THREE.CylinderGeometry(0.04, 0.04, 96, 6);
    pipe.rotateX(Math.PI / 2);             // along z
    pipe.translate(x, 34.0 + LIFT, 0);
    ductGeos.push(pipe);
  }
  cg.add(new THREE.Mesh(
    BufferGeometryUtils.mergeGeometries(ductGeos),
    new THREE.MeshStandardMaterial({ color: 0x1c1e24, roughness: 0.8 })
  ));

  // --- work lights: tiny warm glows along catwalks and trusses ----------------
  const workGeos = [];
  const workSpots = [
    [-30, 29.4, -6], [-12, 29.4, -6], [6, 29.4, -6], [24, 29.4, -6],
    [-24, 29.4, 6], [-6, 29.4, 6], [12, 29.4, 6], [30, 29.4, 6],
    [-42, 35.3, -12], [-14, 35.3, 20], [0, 37.4, -32], [14, 35.3, 32],
    [28, 37.4, 24], [42, 35.3, -20],
  ];
  for (const [x, y0, z] of workSpots) {
    const y = y0 > 32 ? y0 + LIFT : y0;      // truss-mounted ones ride up; catwalk ones stay
    const g = new THREE.SphereGeometry(0.09, 8, 6);
    g.translate(x, y, z);
    workGeos.push(g);
  }
  const workMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  workMat.color.setRGB(1.7, 1.4, 0.9);     // just past the bloom gate: soft halo
  cg.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(workGeos), workMat));

  // --- house-light lenses: one merged self-lit mesh, one shared material ------
  // (blackout dims these by hand via lampLenses — one shared material is fine:
  // main.js resets the hex before each multiplyScalar)
  const lensGeos = [];
  for (const p of lightPositions) {
    const c = new THREE.CircleGeometry(0.36, 20);
    c.rotateX(Math.PI / 2);                // normal down
    c.translate(p.x, p.y - 0.02, p.z);
    lensGeos.push(c);
  }
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xfff4dd, toneMapped: false });
  lensMat.color.multiplyScalar(4);
  const lensMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(lensGeos), lensMat);
  cg.add(lensMesh);
  const lampLenses = [lensMesh];

  // --- championship banners: hung from y=36.5, tops around y 32.8 -------------
  const banners = [
    ['NATIONAL TITLE', '2014'], ['CONFERENCE', '2017'],
    ['NATIONAL TITLE', '2019'], ['DIVISION', '2022'], ['CONFERENCE', '2024'],
  ];
  const bannerGroup = new THREE.Group();
  banners.forEach(([title, year], i) => {
    const tex = makeBanner(title, year);
    const b = new THREE.Mesh(
      new THREE.PlaneGeometry(3.0, 4.5),
      new THREE.MeshStandardMaterial({
        map: tex, side: THREE.DoubleSide, roughness: 0.9,
        emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22,
      })
    );
    b.position.set(-22 + i * 11, 30.6, -28); // top ~32.85, clear of the catwalks
    bannerGroup.add(b);
  });
  scene.add(bannerGroup);
  scene.add(cg);
  return { group: cg, banners: bannerGroup, lampLenses };
}

// ---------------------------------------------------------------------------
// A basketball resting on the floor.
// ---------------------------------------------------------------------------
export function buildBall(scene) {
  const { map, bumpMap } = makeBallTextures();
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.123, 48, 32),
    new THREE.MeshPhysicalMaterial({
      map, bumpMap, bumpScale: 0.35,
      roughness: 0.62, clearcoat: 0.12, clearcoatRoughness: 0.6,
    })
  );
  ball.position.set(2.6, 0.123, 1.7);
  ball.rotation.set(0.7, 1.9, 0.2);
  ball.castShadow = true;
  scene.add(ball);
  return ball;
}

// ---------------------------------------------------------------------------
// Fake volumetric shafts under the main rigs.
// ---------------------------------------------------------------------------
export function buildLightShafts(scene, lightPositions) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uIntensity: { value: 0.035 } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vUv = uv;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      uniform float uIntensity;
      void main() {
        float t = clamp(vUv.y, 0.0, 1.0);
        float a = t * t * t * uIntensity * smoothstep(0.0, 0.15, t);
        // fade the cone silhouette so the shaft has no hard edges
        a *= pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.3);
        gl_FragColor = vec4(1.0, 0.93, 0.8, a);
      }`,
  });
  const group = new THREE.Group();
  for (const p of lightPositions) {
    const h = p.y;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(5.2, h, 24, 1, true), mat);
    cone.position.set(p.x * 0.92, h / 2, p.z * 0.92);
    group.add(cone);
  }
  scene.add(group);
  return group;
}

export { makeBackboardDecal, makeScoreboard, makeRibbon, HOOP_X, RIM_Y };
