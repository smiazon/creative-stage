// Touring production rig — the physical package that loads in at the stage end.
//
// Everything here is STATIC geometry plus a set of anchor lists. What the rig
// *does* (pan, tilt, beams, strips, lasers, confetti) lives in rigfx.js, which
// consumes the anchors returned by buildRig().
//
// Layout follows real arena practice, scoped to the stage: video wall against
// the deck's upstage edge, three lighting trusses over the deck, vertical torm
// ladders at the deck corners, PA flown at the downstage edge, floor package on
// the deck upstage, cannons on the deck lip. Nothing hangs over the catwalk or
// the B-stage.
//
// buildRig also accepts an optional PLAN (third argument) — a layout saved
// from the CREATE YOUR RIG designer. A plan replaces the layout only: trusses,
// fixture anchors, confetti cannons, PA and barricades come from the plan,
// while the video wall, the screen-shape variants, the side screens, all
// materials and the return shape stay exactly as built here. Plan coordinates
// are RIG-LOCAL — the same frame the RIG constants use — because the whole
// group is translated/x-scaled afterwards by applyRigTransform in main.js.
//
// THE DEFAULT PATH IS SACRED. Every show that has ever been saved renders
// through buildRig(scene, video) with no plan, so the no-plan path must stay
// byte-for-byte what it was: plan handling is either a pure addition or lives
// inside an `if (P)` / `if (!P)` branch, never a rewrite of default lines.
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { boxTruss, hoistDrop } from './truss.js';
import { makeLedPanelGrid, makeSpeakerGrille, makeWallIdle } from './textures.js';
import { makeUltraTrussMetal } from './textures_ultra_stage.js';
import { SPEC } from './venue.js';
import { BOWL_B } from './bowl.js';

// --- layout constants (metres) ----------------------------------------------
export const RIG = {
  ROOF_Y: SPEC.roofY,        // house steel (arena) or the show's own roof grid (stadium): chain motors live here
  // lighting trusses: [x, bottomChordY, halfSpanZ]
  LX: [
    { name: 'LX1', x: -27.8, y: 16.8, hz: 13.0 },
    { name: 'LX2', x: -24.4, y: 16.2, hz: 13.0 },
    { name: 'LX3', x: -20.8, y: 15.4, hz: 14.0 },
  ],
  VW_HDR: { x: -29.6, y: 15.6, hz: 12.4 },   // video wall header truss
  TORM: { x: -21.0, hz: 14.2, yTop: 15.4, yBot: 6.4 },
  WALL: { x: -29.6, hw: 12.0, yBot: 2.4, yTop: 15.4, tilesX: 48, tilesY: 26 },
  DECK_LIP_X: -20.0,
  DECK_Y: 2.0,
  FLOOR_PKG_X: -28.0,        // upstage floor package sits on the deck
};

const SECTION = 0.52;        // 12in box truss

// shared structural material: everything in a real rig is matte black and
// only becomes visible where a fixture spills on it. The brushed-alu bake
// multiplies under the dark tint, so spill light picks up real grain instead
// of a flat colour.
const trussTex = makeUltraTrussMetal();
const blackSteel = new THREE.MeshLambertMaterial({ color: 0x2e3136, map: trussTex.map });
const cabMat = new THREE.MeshLambertMaterial({ color: 0x0e0e11 });

// ---------------------------------------------------------------------------
export function buildRig(scene, videoEl, plan) {
  // Normalise the plan once: any missing array becomes empty, so a hand-edited
  // or version-skewed plan degrades to "less stuff", never to a throw. P stays
  // null on the default path so every branch below is a plain truthiness test.
  // a plan may bring its own steel to fly from (the sphere stage's spider grid)
  if (plan && Number.isFinite(plan.roofY)) RIG.ROOF_Y = plan.roofY;
  const P = plan ? {
    trusses: Array.isArray(plan.trusses) ? plan.trusses : [],
    fixtures: Array.isArray(plan.fixtures) ? plan.fixtures : [],
    fx: Array.isArray(plan.fx) ? plan.fx : [],
    speakers: Array.isArray(plan.speakers) ? plan.speakers : [],
    barricades: Array.isArray(plan.barricades) ? plan.barricades : [],
    stages: Array.isArray(plan.stages) ? plan.stages : [],
    screens: Array.isArray(plan.screens) ? plan.screens : [],
  } : null;
  // v2 plans carry a free `rot` in radians; v1 only had axis 'x'|'z'. One
  // reader for both so old saves keep working.
  const rotOf = (it) => (Number.isFinite(+it.rot) ? +it.rot : (it.axis === 'z' ? Math.PI / 2 : 0));

  const group = new THREE.Group();
  const structGeos = [];
  const planDecks = [];      // walkable footprints for custom stage decks
  const planScreens = [];   // custom LED faces, so main.js can route video

  // --- trusses -------------------------------------------------------------
  // boxTruss runs along local +X, so rotate 90 deg to run along Z.
  const alongZ = (len, x, y) => {
    const g = boxTruss(len, SECTION, 1.0);
    g.rotateY(Math.PI / 2);
    g.translate(x, y + SECTION / 2, 0);
    return g;
  };
  const picks = [];        // hoist positions; every chord flies off house steel
  if (!P) {
  for (const t of RIG.LX) structGeos.push(alongZ(t.hz * 2, t.x, t.y));
  }
  // The video wall header is NOT plan-owned: the wall and the screen-shape
  // system always build, and a wall hanging off nothing reads as a bug.
  // Except in the round: a ring plan has no wall at all (the globe's halo is
  // its screen), so the header and its motors would be a truss flown over
  // nothing at the arena's old upstage position — the "random truss".
  const inRound = !!(plan && plan.ring);
  if (!inRound) structGeos.push(alongZ(RIG.VW_HDR.hz * 2, RIG.VW_HDR.x, RIG.VW_HDR.y));

  if (!P) {
  // vertical torm ladders at the deck corners
  for (const s of [-1, 1]) {
    const h = RIG.TORM.yTop - RIG.TORM.yBot;
    const g = boxTruss(h, 0.34, 0.9);
    g.rotateZ(Math.PI / 2);
    g.translate(RIG.TORM.x, (RIG.TORM.yTop + RIG.TORM.yBot) / 2, s * RIG.TORM.hz);
    structGeos.push(g);
  }
  }

  // --- motor grid: chain hoists + falls up to the house steel --------------
  if (!P) {
  for (const t of RIG.LX) {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const z = -t.hz + (i / (n - 1)) * t.hz * 2;
      picks.push([t.x, t.y + SECTION, z]);
    }
  }
  }
  if (!inRound) for (let i = 0; i < 8; i++) {
    const z = -RIG.VW_HDR.hz + (i / 7) * RIG.VW_HDR.hz * 2;
    picks.push([RIG.VW_HDR.x, RIG.VW_HDR.y + SECTION, z]);
  }
  const heavyPicks = [];   // ring-plan motors: bigger hoists, denser chains
  if (P) {
    // Plan trusses: each entry is a straight box-truss run centred on (x, z)
    // with y as the bottom-chord height, exactly like the RIG.LX chords. Picks
    // land roughly every 5 m (the default LX spacing), never fewer than two —
    // a chord on one motor is not a thing that flies.
    for (const t of P.trusses) {
      // clamp the span: a zero-length run degenerates strut() into NaNs
      const len = Math.max(1, t.len ?? 4), tx = t.x ?? 0, tz = t.z ?? 0, ty = t.y ?? 12;
      const rot = rotOf(t);
      const shape = t.shape || 'straight';
      // ring/arc/square trusses are chorded out of straight boxTruss runs — a
      // real circle truss IS a polygon of straight sections bolted together
      if (shape !== 'straight') {
        const rad = Math.max(1, t.r ?? 6);
        // a plan may size its own steel: `section` (m) picks the truss, and a
        // big ring is bolted from ~7 m arcs, so its polygon gets finer with
        // radius instead of the 16 flats a B-stage circle gets away with
        const sec = Number.isFinite(t.section) ? Math.max(0.3, t.section) : SECTION;
        const tube = Math.max(1, sec / SECTION * 0.9);
        const segs = shape === 'square' ? 4 : shape === 'arc' ? 8
          : (Number.isFinite(t.segs) ? Math.max(8, Math.round(t.segs)) : Math.max(16, Math.round((2 * Math.PI * rad) / 7)));
        const sweep = shape === 'arc' ? Math.PI * 0.75 : Math.PI * 2;
        const a0 = shape === 'arc' ? rot - sweep / 2 : (shape === 'square' ? rot + Math.PI / 4 : 0);
        const step = sweep / (shape === 'arc' ? segs : segs);
        const chord = shape === 'square' ? rad * Math.SQRT2 : 2 * rad * Math.sin(step / 2);
        // motors: a ring hangs on one per section (every 7 m), never fewer
        // than six; 16-flat small circles keep the old every-third-flat pattern
        const pickEvery = Number.isFinite(t.section) ? 1 : Math.max(1, Math.round(segs / 6));
        for (let i = 0; i < segs; i++) {
          const a = a0 + step * (i + 0.5);
          const g2 = boxTruss(chord * 1.02, sec, Math.max(0.8, sec), tube);
          g2.translate(0, ty + sec / 2, 0);
          g2.rotateY(-(a + Math.PI / 2));
          g2.translate(tx + Math.cos(a) * rad, 0, tz + Math.sin(a) * rad);
          structGeos.push(g2);
          if (i % pickEvery === 0) {
            (Number.isFinite(t.section) ? heavyPicks : picks).push([tx + Math.cos(a) * rad, ty + sec, tz + Math.sin(a) * rad]);
          }
        }
        continue;
      }
      // boxTruss runs along +X; yaw it to the plan's angle. Three's rotateY is
      // CCW about +Y, and our plan angle is measured x->z, so it negates.
      const g = boxTruss(len, SECTION, 1.0);
      g.translate(0, ty + SECTION / 2, 0);
      g.rotateY(-rot);
      g.translate(tx, 0, tz);
      structGeos.push(g);
      const n = Math.max(2, Math.round(len / 5) + 1);
      const cr = Math.cos(rot), sr = Math.sin(rot);
      for (let i = 0; i < n; i++) {
        const o = -len / 2 + (i / (n - 1)) * len;
        picks.push([tx + cr * o, ty + SECTION, tz + sr * o]);
      }
    }
  }
  for (const [x, y, z] of picks) structGeos.push(hoistDrop(x, z, y, RIG.ROOF_Y));
  for (const [x, y, z] of heavyPicks) structGeos.push(hoistDrop(x, z, y, RIG.ROOF_Y, 1.8));

  const struct = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(structGeos), blackSteel);
  struct.castShadow = false;
  struct.receiveShadow = false;
  group.add(struct);

  // --- LED video wall ------------------------------------------------------
  const W = RIG.WALL;
  const wallW = W.hw * 2, wallH = W.yTop - W.yBot;
  const wallGeo = new THREE.PlaneGeometry(wallW, wallH);
  const idleTex = makeWallIdle();

  // The wall is the brightest thing in the room. Bloom gates on max(r,g,b)
  // above 1.25, so the colour multiplier is what makes it glow rather than
  // merely look grey. MeshBasic: the wall emits, it is never lit.
  const wallMat = new THREE.MeshBasicMaterial({ map: idleTex });
  wallMat.color.setScalar(1.75);
  // every screen variant lives in its own group; main.js shows exactly one
  const wallGrp = new THREE.Group();
  group.add(wallGrp);
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.rotation.y = Math.PI / 2;                       // faces +x, toward the crowd
  wall.position.set(W.x + 0.06, (W.yBot + W.yTop) / 2, 0);
  wallGrp.add(wall);

  // the wall face is single-sided — from behind (west) it would be backface
  // culled and read as a hole. A matte black back panel makes it a real object.
  const wallBack = new THREE.Mesh(
    wallGeo,
    new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.9, metalness: 0.2 })
  );
  wallBack.rotation.y = -Math.PI / 2;                  // faces −x, away from the crowd
  wallBack.position.set(W.x - 0.85, wall.position.y, 0);
  wallGrp.add(wallBack);

  // REAL DEPTH. A wall this size is a 0.8 m deep structure, not a decal: a
  // recessed body behind the LED so the face sits in a shadowed reveal, plus
  // the cross-braced spine you see from the wings.
  const bodyGeos = [];
  const bx = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    bodyGeos.push(g);
  };
  bx(0.72, wallH + 0.1, wallW + 0.1, W.x - 0.42, wall.position.y, 0);       // body slab
  for (let i = 0; i <= 8; i++) {                                            // vertical ribs
    bx(0.86, wallH + 0.2, 0.18, W.x - 0.42, wall.position.y, -W.hw + (i / 8) * wallW);
  }
  for (const yy of [W.yBot + wallH * 0.28, wall.position.y, W.yTop - wallH * 0.28]) {
    bx(0.86, 0.18, wallW + 0.2, W.x - 0.42, yy, 0);                         // horizontal ties
  }
  wallGrp.add(new THREE.Mesh(
    BufferGeometryUtils.mergeGeometries(bodyGeos),
    new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.78, metalness: 0.5 })
  ));

  // panel structure overlay: bezel seams + LED pixel lattice, just in front
  const gridMat = new THREE.MeshBasicMaterial({
    map: makeLedPanelGrid(W.tilesX, W.tilesY, 12),
    transparent: true, depthWrite: false,
  });
  const grid = new THREE.Mesh(wallGeo, gridMat);
  grid.rotation.y = Math.PI / 2;
  grid.position.set(W.x + 0.075, wall.position.y, 0);
  wallGrp.add(grid);

  // wall frame + the 8 vertical hang seams of a real tiled wall
  const frameGeos = [];
  const fr = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    frameGeos.push(g);
  };
  // chunky perimeter bezel — deep enough to cast a real edge on the LED
  fr(0.62, wallH + 0.5, 0.3, W.x - 0.22, wall.position.y, -W.hw - 0.15);
  fr(0.62, wallH + 0.5, 0.3, W.x - 0.22, wall.position.y, W.hw + 0.15);
  fr(0.62, 0.3, wallW + 0.6, W.x - 0.22, W.yTop + 0.15, 0);
  fr(0.62, 0.3, wallW + 0.6, W.x - 0.22, W.yBot - 0.15, 0);
  for (const zc of [-W.hw - 0.15, W.hw + 0.15]) {                 // corner blocks
    for (const yc of [W.yTop + 0.15, W.yBot - 0.15]) fr(0.7, 0.42, 0.42, W.x - 0.22, yc, zc);
  }
  for (let i = 1; i < 8; i++) {
    fr(0.24, wallH, 0.05, W.x - 0.08, wall.position.y, -W.hw + (i / 8) * wallW);
  }
  wallGrp.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(frameGeos), blackSteel));

  // --- screen shape variants -------------------------------------------------
  // Same emissive material as the wall, so the video route and idle loop feed
  // whichever screen the project picked. Far variants stand where the wall
  // stands; middle variants hang over LX2 (local x=-24.4), which the middle
  // rig transform in main.js maps to the world centre of the round stage.
  const backMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.9, metalness: 0.2 });
  const remapUV = (geo) => {                 // planar UVs over the shape's bbox
    geo.computeBoundingBox();
    const bb = geo.boundingBox, p = geo.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      uv[i * 2] = (p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x);
      uv[i * 2 + 1] = (p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y);
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
  };
  const heartShapeGeo = (r0) => {            // classic heart, unit-ish, scaled by r0
    const sh = new THREE.Shape();
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      const hx = 16 * Math.sin(t) ** 3;
      const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      const px = hx * (r0 / 17), py = hy * (r0 / 17);
      if (i === 0) sh.moveTo(px, py); else sh.lineTo(px, py);
    }
    sh.closePath();
    return remapUV(new THREE.ShapeGeometry(sh, 48));
  };
  const hangDrops = (grp, y0, y1, xs, z) => {
    for (const hx of xs) {
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, y1 - y0, 5), blackSteel);
      cable.position.set(hx, (y0 + y1) / 2, z);
      grp.add(cable);
    }
  };
  // a far screen: LED face toward +x, black back, ring frame, hoist cables
  const farShape = (faceGeo, frameGeo) => {
    const grp = new THREE.Group();
    const cy = (W.yBot + W.yTop) / 2;
    const face = new THREE.Mesh(faceGeo, wallMat);
    face.rotation.y = Math.PI / 2;
    face.position.set(W.x + 0.06, cy, 0);
    grp.add(face);
    const back = new THREE.Mesh(faceGeo, backMat);
    back.rotation.y = -Math.PI / 2;
    back.position.set(W.x - 0.12, cy, 0);
    grp.add(back);
    if (frameGeo) {
      const rim = new THREE.Mesh(frameGeo, blackSteel);
      rim.rotation.y = Math.PI / 2;
      rim.position.set(W.x, cy, 0);
      grp.add(rim);
    }
    hangDrops(grp, W.yTop, RIG.VW_HDR.y + 0.3, [W.x], -4);
    hangDrops(grp, W.yTop, RIG.VW_HDR.y + 0.3, [W.x], 4);
    group.add(grp);
    return grp;
  };
  const screens = { wall: wallGrp };
  screens.fcircle = farShape(new THREE.CircleGeometry(6.4, 48), new THREE.TorusGeometry(6.45, 0.14, 8, 64));
  screens.fheart = farShape(heartShapeGeo(7.2), null);
  // middle variants: hung over the round stage
  const MIDX = -24.4;                        // LX2 — world 0 under the middle transform
  // world x = local x + rig offset; the default far rig sits at offset 0, so
  // local and world agree for the standard config the banners are placed for
  const RIG_LOCAL_X = 0;
  const midHang = () => {
    const grp = new THREE.Group();
    hangDrops(grp, 16.6, RIG.ROOF_Y, [MIDX - 3, MIDX + 3], 0);
    group.add(grp);
    return grp;
  };
  {
    const grp = midHang();                   // cylinder: video wraps all the way round
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 6.2, 64, 1, true), wallMat);
    cyl.position.set(MIDX, 13.4, 0);
    grp.add(cyl);
    for (const y of [10.3, 16.5]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5.45, 0.16, 8, 64), blackSteel);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(MIDX, y, 0);
      grp.add(ring);
    }
    screens.cyl = grp;
  }
  const midFlat = (faceGeo, frameGeo) => {   // double-faced: reads from both sides
    const grp = midHang();
    for (const s of [1, -1]) {
      const face = new THREE.Mesh(faceGeo, wallMat);
      face.rotation.y = s * Math.PI / 2;
      face.position.set(MIDX + s * 0.09, 12.9, 0);
      grp.add(face);
    }
    if (frameGeo) {
      const rim = new THREE.Mesh(frameGeo, blackSteel);
      rim.rotation.y = Math.PI / 2;
      rim.position.set(MIDX, 12.9, 0);
      grp.add(rim);
    }
    return grp;
  };
  screens.mcircle = midFlat(new THREE.CircleGeometry(5.2, 48), new THREE.TorusGeometry(5.25, 0.14, 8, 64));
  screens.mheart = midFlat(heartShapeGeo(5.8), null);
  // only the flat wall shows by default; main.js swaps per project config
  for (const k of Object.keys(screens)) screens[k].visible = k === 'wall' && !inRound;

  // Every main-screen variant gets its own PIVOT at its own centre, so the
  // console's pose sliders (depth / height / tilt / turn) move whichever shape
  // is showing about its middle — a screen that pitches "down over the stage"
  // has to hinge at its centre, not at the rig origin 20 m away. The variant
  // group shifts by -centre so its content sits on the pivot; the pivot takes
  // the centre back, so nothing moves until a slider does.
  const screenPivots = {};
  for (const [k, grp] of Object.entries(screens)) {
    const c = new THREE.Box3().setFromObject(grp).getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.position.copy(c);
    pivot.userData.base = c.clone();
    grp.position.sub(c);
    group.remove(grp);
    pivot.add(grp);
    group.add(pivot);
    screenPivots[k] = pivot;
  }

  // ---------------------------------------------------------------------------
  // ONE SHAPE LIBRARY for every screen in the building. A face geometry plus a
  // matching rim, so a side screen, a flown banner and the main wall can all be
  // a circle or a heart without three copies of the same maths.
  // ---------------------------------------------------------------------------
  const SCREEN_SHAPES = {
    rect: (w, h) => ({ face: new THREE.PlaneGeometry(w, h), rim: null, w, h }),
    circle: (w) => ({
      face: new THREE.CircleGeometry(w / 2, 56),
      rim: new THREE.TorusGeometry(w / 2 + 0.06, 0.11, 8, 72), w, h: w,
    }),
    heart: (w) => ({ face: heartShapeGeo(w * 0.56), rim: null, w, h: w }),
    diamond: (w, h) => {
      const s = new THREE.Shape();
      s.moveTo(0, h / 2); s.lineTo(w / 2, 0); s.lineTo(0, -h / 2); s.lineTo(-w / 2, 0); s.closePath();
      return { face: new THREE.ShapeGeometry(s), rim: null, w, h };
    },
    hex: (w) => {
      const s = new THREE.Shape();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const x = Math.cos(a) * w / 2, y = Math.sin(a) * w / 2;
        i ? s.lineTo(x, y) : s.moveTo(x, y);
      }
      s.closePath();
      return { face: new THREE.ShapeGeometry(s), rim: null, w, h: w };
    },
    oval: (w, h) => {
      const s = new THREE.Shape();
      s.absellipse(0, 0, w / 2, h / 2, 0, Math.PI * 2, false, 0);
      return { face: new THREE.ShapeGeometry(s, 48), rim: null, w, h };
    },
  };
  const SHAPE_KEYS = Object.keys(SCREEN_SHAPES);

  // A double-sided flown panel: LED both faces (so it reads from anywhere in
  // the round), a slim body between them, a rim, and cables to the house steel.
  const flownPanel = (shapeKey, w, h, x, y, z, rotY = 0) => {
    const grp = new THREE.Group();
    const sh = SCREEN_SHAPES[shapeKey] ? SCREEN_SHAPES[shapeKey](w, h) : SCREEN_SHAPES.rect(w, h);
    for (const s of [1, -1]) {
      const f = new THREE.Mesh(sh.face, wallMat);
      f.rotation.y = rotY + (s > 0 ? 0 : Math.PI);
      f.position.set(x + Math.sin(rotY) * 0.07 * s, y, z + Math.cos(rotY) * 0.07 * s);
      grp.add(f);
    }
    if (sh.rim) {
      const rim = new THREE.Mesh(sh.rim, blackSteel);
      rim.rotation.y = rotY;
      rim.position.set(x, y, z);
      grp.add(rim);
    }
    // cables up to the roof — these hang like banners, so the drop is the look
    for (const sSign of [-1, 1]) {
      const hx = x + Math.cos(rotY) * sSign * (sh.w / 2 - 0.4);
      const hz = z - Math.sin(rotY) * sSign * (sh.w / 2 - 0.4);
      const topY = y + sh.h / 2;
      const len = Math.max(0.5, RIG.ROOF_Y - topY);
      const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 5), blackSteel);
      cab.position.set(hx, topY + len / 2, hz);
      grp.add(cab);
    }
    return grp;
  };

  // --- side screens (IMAG) ---------------------------------------------------
  // Extra LED surfaces flanking the main screen, three rig styles. They share
  // wallMat, so the video route lights them with everything else.
  const sideScreen = (w, hgt, x, z, rotY, yC) => {
    const grp = new THREE.Group();
    const nx = Math.sin(rotY), nz = Math.cos(rotY);   // facing normal
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), wallMat);
    face.position.set(x + nx * 0.14, yC, z + nz * 0.14);
    face.rotation.y = rotY;
    grp.add(face);
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.3, hgt + 0.3, 0.2),
      new THREE.MeshLambertMaterial({ color: 0x101013 })
    );
    back.position.set(x, yC, z);
    back.rotation.y = rotY;
    grp.add(back);
    // hoist tubes all the way to the house steel
    const rx = Math.cos(rotY), rz = -Math.sin(rotY);   // screen's right vector
    for (const sSign of [-1, 1]) {
      const topY = yC + hgt / 2;
      const len = RIG.ROOF_Y - topY;
      const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, len, 6), blackSteel);
      drop.position.set(
        x + rx * sSign * (w / 2 - 0.5),
        topY + len / 2,
        z + rz * sSign * (w / 2 - 0.5)
      );
      grp.add(drop);
    }
    return grp;
  };
  const sides = {};
  {
    // IMAG hangs OVER the 100s flanking the stage, the way touring shows fly
    // delay screens above the lower bowl — centred at |z| 17.8, well past the
    // floor edge at 15.56. What matters now is HEIGHT: the bottom edge has to
    // clear the raked seats (and heads) directly below, roughly y 5.5 at the
    // rows under the screens.
    const SIDE_C = BOWL_B + 2.25;                 // pair centre, over the first rows either side
    const flat = new THREE.Group();
    for (const s of [-1, 1]) flat.add(sideScreen(9.6, 5.6, W.x + 0.5, s * SIDE_C, Math.PI / 2, 13.6));
    sides.flat = flat;
    const ang = new THREE.Group();
    for (const s of [-1, 1]) ang.add(sideScreen(9.6, 5.6, W.x + 2.6, s * SIDE_C, Math.PI / 2 + s * -0.42, 13.6));
    sides.angled = ang;
    const tow = new THREE.Group();
    for (const s of [-1, 1]) tow.add(sideScreen(5.2, 14.0, W.x + 1.2, s * SIDE_C, Math.PI / 2, 13.2));
    sides.towers = tow;
    // round IMAG — a pair of discs flown over the seats
    const circ = new THREE.Group();
    for (const s of [-1, 1]) circ.add(flownPanel('circle', 7.4, 7.4, W.x + 1.0, 14.2, s * SIDE_C, Math.PI / 2));
    sides.circles = circ;
    // and a heart pair, since every other screen family has one
    const hrt = new THREE.Group();
    for (const s of [-1, 1]) hrt.add(flownPanel('heart', 7.6, 7.6, W.x + 1.0, 14.2, s * SIDE_C, Math.PI / 2));
    sides.hearts = hrt;
    for (const k of Object.keys(sides)) { sides[k].visible = false; group.add(sides[k]); }
  }

  // ---------------------------------------------------------------------------
  // FLOWN SCREENS — banners hung high in the roof, well above everything else,
  // so they read from the whole bowl the way championship flags do. Two
  // positions: centred over the B-stage and directly over FOH. Every shape is
  // built once and hidden; main.js reveals the chosen one. All of them share
  // wallMat, so whatever the video route is showing plays on them too.
  //
  // NOTE: these live in RIG-LOCAL space and the rig is x-shifted per stage
  // config, so the anchors below are chosen in the rig's own frame.
  // ---------------------------------------------------------------------------
  const flown = { bstage: {}, foh: {} };
  {
    const HIGH_Y = SPEC.key !== 'arena' ? 34 : 26.5;   // banner height: above the jumbotron dock
    // pushed WAY apart — a pair hugging the centre line read as one screen;
    // at ±13 m each panel hangs over its own side of the floor
    const PAIR_Z = BOWL_B - 2.55;
    const SPOTS = [
      ['bstage', -3.4 - RIG_LOCAL_X],         // over the round stage
      ['foh', 24 - RIG_LOCAL_X],              // vertically above the FOH pen
    ];
    // Each position is a PAIR — one left, one right — and each panel carries
    // LED on both faces, so the stage end and the FOH end both see a screen.
    // Same idea as the stage IMAG, just flown high in the roof.
    for (const [key, lx] of SPOTS) {
      for (const shape of SHAPE_KEYS) {
        const pair = new THREE.Group();
        const w = 6.0, h = shape === 'rect' ? 3.4 : 6.0;
        for (const s of [-1, 1]) {
          pair.add(flownPanel(shape, w, h, lx, HIGH_Y, s * PAIR_Z, Math.PI / 2));
        }
        pair.visible = false;
        group.add(pair);
        flown[key][shape] = pair;
      }
    }
  }

  // --- PA: line arrays, banana outfills, subs, deck fills ------------------
  // Real J-arrays: each cabinet chains off the bottom-front hinge of the one
  // above at a cumulative splay angle, so the face sweeps a smooth J-curve —
  // top boxes throw flat to the upper bowl, bottom boxes fold into the floor.
  const grille = makeSpeakerGrille();
  const boxMat = new THREE.MeshLambertMaterial({ map: grille, color: 0xffffff });
  const GAP = 0.02;          // visible seam between cabinets
  const shellGeos = [];      // cabinet bodies — darker side/back tone (cabMat)
  const grilleGeos = [];     // front grille panels, inset from the shell edges
  const steelGeos = [];      // bumpers, pick lugs, drops, pullback steels

  // angled steel cable between two points
  const steelBetween = (ax, ay, az, bx, by, bz, r) => {
    const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(r, r, len, 5);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), dir.normalize()));
    g.translate(ax, ay, az);
    return g;
  };

  // one cabinet: dark shell + grille panel just proud of the front face,
  // slightly smaller so the shell reads as an inset rim around it.
  // tilt is nose-down about Z (radians); yaw about Y; rear flips the grille
  // to the back face (the reversed box of a cardioid stack).
  const cabinet = (cx, cy, cz, w, h, d, tilt, yaw, rear = false) => {
    const shell = new THREE.BoxGeometry(d, h, w);
    shell.rotateZ(-tilt); shell.rotateY(yaw); shell.translate(cx, cy, cz);
    shellGeos.push(shell);
    const face = new THREE.PlaneGeometry(w - 0.1, h - 0.05);
    face.rotateY(rear ? -Math.PI / 2 : Math.PI / 2);
    face.translate((rear ? -1 : 1) * (d / 2 + 0.012), 0, 0);
    face.rotateZ(-tilt); face.rotateY(yaw); face.translate(cx, cy, cz);
    grilleGeos.push(face);
  };

  // bumper frame above topY: wider/deeper than the cabinets, two pick lugs,
  // two steel drops to the house steel, and a rear pullback whose upstage
  // anchor is what tilts a real array on site.
  const bumperRig = (x, z, topY, w, d, yaw) => {
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);   // forward (audience) dir
    const bh = 0.2, by = topY + GAP + bh / 2;
    const frame = new THREE.BoxGeometry(d + 0.3, bh, w + 0.3);
    frame.rotateY(yaw); frame.translate(x, by, z);
    steelGeos.push(frame);
    for (const q of [-1, 1]) {                       // pick points + drops
      const lx = x - fz * q * (w / 2 - 0.1), lz = z + fx * q * (w / 2 - 0.1);
      const lug = new THREE.BoxGeometry(0.09, 0.22, 0.09);
      lug.rotateY(yaw); lug.translate(lx, by + bh / 2 + 0.11, lz);
      steelGeos.push(lug);
      steelGeos.push(steelBetween(lx, by + bh / 2 + 0.2, lz, lx, RIG.ROOF_Y, lz, 0.022));
    }
    steelGeos.push(steelBetween(                     // rear pullback, angled
      x - fx * (d / 2 + 0.15), by, z - fz * (d / 2 + 0.15),
      x - fx * 4.5, RIG.ROOF_Y, z - fz * 4.5, 0.015));
  };

  // J-array builder: bumper on top, then boxes chained down the front hinge.
  // splays[i] is box i's CUMULATIVE nose-down angle in degrees; each box's
  // top-front edge sits on the previous box's bottom-front edge (GAP seam).
  const hang = (x, z, topY, boxes, w, h, d, splays, yaw = 0) => {
    bumperRig(x, z, topY, w, d, yaw);
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    let px = x + fx * (d / 2), py = topY, pz = z + fz * (d / 2);  // front hinge
    for (let i = 0; i < boxes; i++) {
      const t = (splays[Math.min(i, splays.length - 1)] * Math.PI) / 180;
      const ct = Math.cos(t), st = Math.sin(t);
      const f = [fx * ct, -st, fz * ct];             // box forward axis
      const u = [fx * st, ct, fz * st];              // box up axis
      cabinet(
        px - f[0] * d / 2 - u[0] * h / 2,
        py - f[1] * d / 2 - u[1] * h / 2,
        pz - f[2] * d / 2 - u[2] * h / 2,
        w, h, d, t, yaw);
      px -= u[0] * (h + GAP); py -= u[1] * (h + GAP); pz -= u[2] * (h + GAP);
    }
  };

  const MAIN_J = [0, 0.5, 1, 2, 3, 4.5, 6.5, 9, 12, 16, 21, 27];
  const BANANA = [4, 10, 17, 24, 32, 40];
  // The flown PA is OFF: even shrunk and hung wide it reads as two black slabs
  // across the stage picture, and this is a look-design tool before it is an
  // audio one. The whole rig below still builds correctly — flip this to true
  // to hang it all back exactly as it was.
  const SHOW_PA = false;
  // SHOW_PA governs only the DEFAULT hang; a plan that asks for speakers gets
  // them regardless — an explicit placement is a design decision, not a default.
  if (SHOW_PA && !P) {
  for (const s of [-1, 1]) {
    // mains: 12-box J hung wide and high. Real arena mains sit just inboard of
    // the deck edge, clear of the screen — parked at z=10.5 they read as two
    // black walls across the stage face from every seat in the house.
    hang(-20.6, s * 13.4, 18.9, 12, 1.12, 0.36, 0.70, MAIN_J);
    // banana outfills: strong curve, whole array yawed toward the corners
    hang(-22.4, s * 15.9, 16.4, 6, 0.84, 0.29, 0.50, BANANA, -s * (28 * Math.PI) / 180);
    // flown subs: cardioid stack, 2 wide x 3 high under its own bumper
    const sw = 0.95, sh = 0.56, sd = 0.78, sx = -22.0, sz = s * 8.4, subTop = 19.0;
    bumperRig(sx, sz, subTop, 2 * sw + GAP, sd, 0);
    for (let r = 0; r < 3; r++) {
      for (const q of [-1, 1]) {
        cabinet(sx, subTop - sh / 2 - r * (sh + GAP), sz + q * (sw + GAP) / 2,
          sw, sh, sd, 0, 0, r === 1);                // middle row reversed
      }
    }
  }
  // ground-stacked cardioid subs, flush on the deck surface behind the lip
  for (const z of [-9, -3, 3, 9]) {
    for (let i = 0; i < 3; i++) {
      cabinet(-21.0, RIG.DECK_Y + 0.28 + i * (0.56 + GAP), z,
        0.78, 0.56, 1.12, 0, 0, i === 1);
    }
  }
  // deck-lip front fills, sitting on the deck, nosed down into the first rows
  for (let z = -14.3; z <= 14.31; z += 2.2) {
    cabinet(-20.12, RIG.DECK_Y + 0.17, z, 0.44, 0.25, 0.28, 0.35, 0);
  }
  }

  if (P) {
    // Plan speakers, built with the same hang()/cabinet() machinery so they
    // merge into the shared shell/grille/steel meshes below.
    for (const s of P.speakers) {
      const sx = s.x ?? -21, sz = s.z ?? 0;
      if (s.type === 'sub') {
        // ground stack: 3 cardioid cabinets, middle box reversed, standing on
        // whatever surface y the plan gives (deck top or arena floor)
        const base = s.y ?? 0;
        for (let i = 0; i < 3; i++) {
          cabinet(sx, base + 0.28 + i * (0.56 + GAP), sz, 0.78, 0.56, 1.12, 0, s.yaw ?? 0, i === 1);
        }
      } else {
        // 'main': a modest flown 8-box J — the MAIN_J splay curve truncated to
        // its first 8 boxes, facing +x unless the plan turns it (in-the-round)
        hang(sx, sz, s.y ?? 16, 8, 1.0, 0.32, 0.62, MAIN_J.slice(0, 8), s.yaw ?? 0);
      }
    }
  }

  // shellGeos/grilleGeos hold only PA cabinets; steelGeos also collects rigging
  // from elsewhere, so it is merged either way.
  if (shellGeos.length) {
    const paShells = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(shellGeos), cabMat);
    paShells.castShadow = false;
    group.add(paShells);
    group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(grilleGeos), boxMat));
  }
  if (steelGeos.length) {
    group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(steelGeos), blackSteel));
  }

  // --- upstage floor package + hazers + cold sparks + cannon bodies --------
  const propGeos = [];
  const prop = (geo, x, y, z, rx = 0, rz = 0) => {
    if (rx) geo.rotateX(rx);
    if (rz) geo.rotateZ(rz);
    geo.translate(x, y, z);
    propGeos.push(geo);
  };
  // The riser-plate boxes that used to sit here read as PA cabinets strewn
  // across the deck; the fixtures they carried now emit from the wall base.

  // hazers upstage — beams do not exist without haze
  for (const z of [-11, 11]) {
    prop(new THREE.BoxGeometry(0.7, 0.5, 0.5), -28.0, RIG.DECK_Y + 0.25, z);
  }
  // cold spark fountains along the wall base
  for (let z = -12; z <= 12.01; z += 3.5) {
    prop(new THREE.CylinderGeometry(0.11, 0.14, 0.42, 10), -27.0, RIG.DECK_Y + 0.21, z);
  }
  group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(propGeos), cabMat));

  // confetti cannon bodies on the deck lip, tilted 55 deg out over the floor
  const cannons = [];
  const cannonGeos = [];
  if (!P) {
  for (const z of [-14, -10.5, -6.5, -2.5, 2.5, 6.5, 10.5, 14]) {
    const x = -20.15, y = RIG.DECK_Y + 0.15;
    const tilt = (55 * Math.PI) / 180;
    const g = new THREE.CylinderGeometry(0.09, 0.11, 0.75, 12);
    g.rotateZ(-Math.PI / 2 + tilt);     // barrel points +x and up
    g.translate(x, y + 0.2, z);
    cannonGeos.push(g);
    const base = new THREE.BoxGeometry(0.3, 0.12, 0.3);
    base.translate(x, y, z);
    cannonGeos.push(base);
    cannons.push({ x: x + 0.3, y: y + 0.5, z, tilt });
  }
  } else {
    // Plan cannons: fx entries of type 'confetti', same body, same 55 deg
    // throw toward +x. Everything else in fx belongs to pyrofx and is only
    // EXPORTED from here (see fxPoints at the bottom).
    for (const f of P.fx) {
      if (!f || f.type !== 'confetti') continue;
      const x = f.x ?? -20.15, z = f.z ?? 0;
      const y = Number.isFinite(f.y) ? f.y : RIG.DECK_Y + 0.15;
      const tilt = (55 * Math.PI) / 180;
      const yaw = Number.isFinite(f.yaw) ? f.yaw : 0;           // throw azimuth, +x by default
      const g = new THREE.CylinderGeometry(0.09, 0.11, 0.75, 12);
      g.rotateZ(-Math.PI / 2 + tilt);   // barrel points +x and up
      g.rotateY(-yaw);
      g.translate(x, y + 0.2, z);
      cannonGeos.push(g);
      const base = new THREE.BoxGeometry(0.3, 0.12, 0.3);
      base.translate(x, y, z);
      cannonGeos.push(base);
      cannons.push({ x: x + 0.3 * Math.cos(yaw), y: y + 0.5, z: z + 0.3 * Math.sin(yaw), tilt, yaw });
    }
    if (!cannons.length) {
      // rigfx's confetti pool indexes cannons[i % cannons.length]; an empty
      // list would be i % 0 = NaN and a crash. A confetti-free plan keeps the
      // default launch DATA (no bodies drawn) purely as ballast.
      for (const z of [-14, -10.5, -6.5, -2.5, 2.5, 6.5, 10.5, 14]) {
        cannons.push({ x: -20.15 + 0.3, y: RIG.DECK_Y + 0.15 + 0.5, z, tilt: (55 * Math.PI) / 180 });
      }
    }
  }
  // guard: a plan can legitimately produce zero cannon BODIES, and merging an
  // empty list returns null. The default path always has 16 geos, so this
  // condition is always true there — no behavioural drift.
  if (cannonGeos.length) {
  group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(cannonGeos), cabMat));
  }

  // --- fixture anchors ------------------------------------------------------
  // Each anchor is a mounting point: position + which way the yoke hangs.
  // 'down' fixtures hang under a truss; 'up' fixtures sit on the deck.
  // THE CONTRACT: rigfx reads exactly {x, y, z, dir} off every list here — for
  // spot/wash/beam dir>0 selects the floor-package behaviours (rake up and out
  // over the crowd) and dir<0 the hung ones (throw down and out); blinders use
  // dir for their rake, the rest carry it for shape parity. rigfx aims heads
  // itself, per behaviour, every frame — an anchor never stores a target.
  const anchors = { spot: [], wash: [], beam: [], strobe: [], blinder: [], uv: [], laser: [] };
  const pipes = [];      // LED pipe drops (default layout only)
  const stripRuns = [];  // pixel-strip runs, sampled to 0.5 m cells by rigfx
  if (!P) {
  const spread = (n, hz, y, x, list, dir = -1, jitter = 0) => {
    for (let i = 0; i < n; i++) {
      const z = n === 1 ? 0 : -hz + (i / (n - 1)) * hz * 2;
      list.push({ x: x + (jitter ? ((i % 2) * 2 - 1) * jitter : 0), y, z, dir });
    }
  };
  const lx1 = RIG.LX[0], lx2 = RIG.LX[1], lx3 = RIG.LX[2];
  // movers alternate over/under-hung so heads cannot collide when panning
  spread(16, 12.4, lx1.y - 0.45, lx1.x, anchors.spot, -1, 0.22);
  spread(14, 12.4, lx2.y - 0.45, lx2.x, anchors.spot, -1, 0.22);
  spread(18, 12.4, lx1.y - 0.45, lx1.x + 1.1, anchors.wash, -1, 0.22);
  spread(14, 12.4, lx2.y - 0.45, lx2.x + 1.1, anchors.wash, -1, 0.22);
  spread(12, 13.4, lx3.y - 0.45, lx3.x, anchors.wash, -1, 0.22);
  spread(16, 12.0, lx1.y - 0.45, lx1.x - 1.1, anchors.beam, -1, 0.18);
  spread(14, 12.0, lx2.y - 0.45, lx2.x - 1.1, anchors.beam, -1, 0.18);
  spread(14, 13.4, lx3.y - 0.45, lx3.x - 1.1, anchors.beam, -1, 0.18);
  // upstage floor package: spots and beams raking straight out at the crowd
  for (let i = 0; i < 12; i++) {
    const z = -11 + (i / 11) * 22;
    anchors.spot.push({ x: RIG.FLOOR_PKG_X, y: RIG.DECK_Y + 0.55, z, dir: 1 });
  }
  for (let i = 0; i < 8; i++) {
    const z = -10 + (i / 7) * 20;
    anchors.beam.push({ x: RIG.FLOOR_PKG_X - 0.6, y: RIG.DECK_Y + 0.55, z, dir: 1 });
  }
  // strobes: a continuous line on LX3 facing the crowd, plus torms and deck fascia
  spread(24, 13.6, lx3.y - 0.5, lx3.x + 0.9, anchors.strobe, -1);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      anchors.strobe.push({ x: RIG.TORM.x, y: 7.0 + i * 1.05, z: s * RIG.TORM.hz, dir: 0 });
    }
  }
  for (let z = -14; z <= 14.01; z += 1.9) {
    anchors.strobe.push({ x: -19.98, y: 1.2, z, dir: 0 });
  }
  // blinders on LX3 raked into the floor crowd, plus a row firing over the deck
  spread(16, 13.0, lx3.y - 0.75, lx3.x + 1.7, anchors.blinder, -1);
  for (let i = 0; i < 8; i++) {
    anchors.blinder.push({ x: -26.4, y: RIG.DECK_Y + 0.3, z: -10.5 + (i / 7) * 21, dir: 1 });
  }
  // UV: the pre-show ritual look — deck edge uplight plus truss wash
  spread(12, 12.6, lx2.y - 0.5, lx2.x - 2.0, anchors.uv, -1);
  for (let z = -13; z <= 13.01; z += 2.0) {
    anchors.uv.push({ x: -19.9, y: 2.1, z, dir: 1 });
  }
  // lasers: upstage floor package + a row on LX3
  for (let i = 0; i < 4; i++) {
    anchors.laser.push({ x: -28.0, y: RIG.DECK_Y + 0.4, z: -7.5 + i * 5, dir: 1 });
  }
  for (let i = 0; i < 6; i++) {
    anchors.laser.push({ x: lx3.x - 1.8, y: lx3.y - 0.5, z: -10 + i * 4, dir: -1 });
  }

  // --- LED pipe drops: 24 vertical 4 m tubes hung from LX1 -----------------
  for (let i = 0; i < 24; i++) {
    const z = -12.65 + (i / 23) * 25.3;
    pipes.push({ x: lx1.x + 0.5, yTop: 16.6, len: 4.0, z });
  }

  // --- LED strip runs: truss chords + deck fascia perimeter ----------------
  // Each run is sampled into 0.5 m segments by rigfx for pixel mapping.
  for (const t of RIG.LX) {
    stripRuns.push({ from: [t.x, t.y - 0.03, -t.hz], to: [t.x, t.y - 0.03, t.hz] });
    stripRuns.push({ from: [t.x, t.y + SECTION + 0.03, -t.hz], to: [t.x, t.y + SECTION + 0.03, t.hz] });
  }
  for (const s of [-1, 1]) {
    stripRuns.push({
      from: [RIG.TORM.x, RIG.TORM.yBot, s * (RIG.TORM.hz - 0.2)],
      to: [RIG.TORM.x, RIG.TORM.yTop, s * (RIG.TORM.hz - 0.2)],
    });
  }
  // deck fascia: downstage lip, then both side edges running upstage
  stripRuns.push({ from: [-20.02, 1.86, -15.2], to: [-20.02, 1.86, 15.2] });
  for (const s of [-1, 1]) {
    stripRuns.push({ from: [-20.02, 1.86, s * 15.2], to: [-26.5, 1.86, s * 15.2] });
  }
  } else {
    // --- plan fixtures ------------------------------------------------------
    // Every fixture becomes an anchor of the exact default shape. The plan's
    // `aim` is a point; the anchor stores a hang direction — so the aim is
    // translated into dir: aiming above yourself makes you floor package
    // (dir +1), aiming below makes you a hung head (dir -1). With aim null the
    // fixture looks at the floor 55% of the way to the arena centre (y=1),
    // i.e. into the bowl and the crowd, never at the walls — which is below
    // any mounted fixture, so unaimed lights hang and throw out. Lasers aim
    // themselves at the bowl fascia rings in rigfx; their aim only sets dir.
    const fixGeos = [];
    const fixtureBody = (x, y, z, long) => {
      // same merged-prop treatment the cannon bodies get: a small matte
      // housing so a placed fixture reads even while its emitter is dark.
      // spot/wash/beam skip this — rigfx instances a yoke + head per anchor.
      const g = long ? new THREE.BoxGeometry(0.09, 0.09, 2.06)
                     : new THREE.BoxGeometry(0.3, 0.26, 0.26);
      g.translate(x, y, z);
      fixGeos.push(g);
    };
    for (const f of P.fixtures) {
      if (!f) continue;
      const x = f.x ?? 0, y = f.y ?? RIG.DECK_Y + 0.55, z = f.z ?? 0;
      const aim = (Array.isArray(f.aim) && f.aim.length === 3) ? f.aim : [x * 0.45, 1, z * 0.45];
      const dir = aim[1] > y ? 1 : -1;
      // facing: `yaw` is the world direction the fixture's face points (x->z
      // radians); the default PI/2 is the end-stage habit of facing +x. `phi`
      // is the same thing as an azimuth for the laser sweep centre.
      const yaw = Number.isFinite(f.yaw) ? f.yaw : Math.PI / 2;
      const phi = Math.PI / 2 - yaw;
      if (f.type === 'strip') {
        // a strip is a 2 m pixel bar, not a point: rigfx maps RUNS, so give it
        // one along the truss it hangs on, plus a slim housing when unlit
        const tx = -Math.cos(phi) * 0 + Math.sin(phi), tz = -Math.cos(phi);   // tangent to the facing
        stripRuns.push({ from: [x - tx, y, z - tz], to: [x + tx, y, z + tz] });
        fixtureBody(x, y, z, true);
        continue;
      }
      if (!Object.hasOwn(anchors, f.type)) continue;   // unknown type: skip, never throw
      anchors[f.type].push({ x, y, z, dir, yaw, phi, grp: f.grp || null });
      if (f.type !== 'spot' && f.type !== 'wash' && f.type !== 'beam') fixtureBody(x, y, z, false);
    }
    if (fixGeos.length) {
      group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(fixGeos), cabMat));
    }
    // No default pipes or truss/fascia strip runs under a plan: they would
    // trace steel the plan may not have hung.
  }

  // --- plan barricades + exported fx launch points ---------------------------
  // fxPoints is a pure ADDITION to the return shape: rig.js only handles
  // confetti itself; pyro/popper/streamer/flame positions are exported for
  // pyrofx (main.js passes them into initPyro). y=2.1 matches the deck-level
  // convention pyrofx already uses for POP_POINTS, pyro launchers and flames.
  const fxPoints = { pyro: [], popper: [], streamer: [], flame: [] };
  if (P) {
    for (const f of P.fx) {
      if (f && Object.hasOwn(fxPoints, f.type)) fxPoints[f.type].push([f.x ?? 0, 2.1, f.z ?? 0]);
    }
    if (P.barricades.length) {
      // crowd rails: a 1.1 m face with a kick plate, the mojo-barrier
      // silhouette, merged into one matte black mesh
      const barGeos = [];
      for (const b of P.barricades) {
        const len = Math.max(0.3, b.len ?? 2), bx = b.x ?? 0, bz = b.z ?? 0;
        const rot = rotOf(b);
        const shape = b.shape || 'straight';
        // curved / ring / T-pit rails are chains of short straight sections,
        // which is exactly how mojo barrier is built on a real floor
        if (shape !== 'straight') {
          const rad = Math.max(1, b.r ?? 6);
          const runs = [];
          if (shape === 'ring' || shape === 'curve') {
            const sweep = shape === 'ring' ? Math.PI * 2 : Math.PI * 0.6;
            const segs = shape === 'ring' ? 20 : 8;
            const a0 = shape === 'ring' ? 0 : rot - sweep / 2;
            const st = sweep / segs;
            const ch = 2 * rad * Math.sin(st / 2) * 1.04;
            for (let i = 0; i < segs; i++) {
              const a = a0 + st * (i + 0.5);
              runs.push([bx + Math.cos(a) * rad, bz + Math.sin(a) * rad, ch, a + Math.PI / 2]);
            }
          } else {                                   // tpit: two rails + a cross
            const c = Math.cos(rot), s = Math.sin(rot);
            for (const sgn of [-1, 1]) {
              runs.push([bx - s * sgn * rad, bz + c * sgn * rad, len, rot]);
            }
            runs.push([bx + c * len / 2, bz + s * len / 2, rad * 2, rot + Math.PI / 2]);
          }
          for (const [rx, rz, rl, ra] of runs) {
            const rail2 = new THREE.BoxGeometry(rl, 1.1, 0.08);
            rail2.translate(0, 0.55, 0); rail2.rotateY(-ra); rail2.translate(rx, 0, rz);
            barGeos.push(rail2);
            const pl2 = new THREE.BoxGeometry(rl, 0.05, 0.7);
            pl2.translate(0, 0.025, 0); pl2.rotateY(-ra); pl2.translate(rx, 0, rz);
            barGeos.push(pl2);
          }
          continue;
        }
        const rail = new THREE.BoxGeometry(len, 1.1, 0.08);
        rail.translate(0, 0.55, 0); rail.rotateY(-rot); rail.translate(bx, 0, bz);
        barGeos.push(rail);
        const plate = new THREE.BoxGeometry(len, 0.05, 0.7);
        plate.translate(0, 0.025, 0); plate.rotateY(-rot); plate.translate(bx, 0, bz);
        barGeos.push(plate);
      }
      group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(barGeos), blackSteel));
    }

    // --- custom stage decks: drawn in the 2D editor, walkable in 3D --------
    if (P.stages.length) {
      const deckGeos = [], skirtGeos = [];
      for (const s of P.stages) {
        const w = Math.max(0.5, s.w ?? 6), d = Math.max(0.5, s.d ?? 4);
        const h = Math.max(0.1, s.h ?? 1), sx = s.x ?? 0, sz = s.z ?? 0;
        const rot = rotOf(s);
        const top = new THREE.BoxGeometry(w, 0.12, d);
        top.translate(0, h - 0.06, 0); top.rotateY(-rot); top.translate(sx, 0, sz);
        deckGeos.push(top);
        const skirt = new THREE.BoxGeometry(w - 0.06, h - 0.12, d - 0.06);
        skirt.translate(0, (h - 0.12) / 2, 0); skirt.rotateY(-rot); skirt.translate(sx, 0, sz);
        skirtGeos.push(skirt);
        planDecks.push({ x: sx, z: sz, w, d, rot, top: h });
      }
      const deckMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(deckGeos),
        new THREE.MeshStandardMaterial({ color: 0x1a1c21, roughness: 0.82 }));
      deckMesh.receiveShadow = true;
      group.add(deckMesh);
      group.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(skirtGeos),
        new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.9 })));
    }

    // --- custom LED screens: same content feed as the main video wall ------
    for (const s of P.screens) {
      const w = Math.max(0.5, s.w ?? 6), h = Math.max(0.5, s.h ?? 4);
      const sx = s.x ?? 0, sz = s.z ?? 0, sy = s.y ?? 3;
      const rot = rotOf(s);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
      // the panel's viewing face points along +z of its own frame
      face.position.set(sx, sy + h / 2, sz);
      face.rotation.y = -rot;
      group.add(face);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, h + 0.16, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x0a0b0e, roughness: 0.9 }));
      back.position.set(sx, sy + h / 2, sz);
      back.rotation.y = -rot;
      back.translateZ(-0.14);
      group.add(back);
      planScreens.push(face);
    }
  }

  scene.add(group);
  // trusses: the LX positions the fixture groups are derived from (rigfx.js)
  return { group, wall, wallMat, idleTex, anchors, pipes, stripRuns, cannons, screens, screenPivots, sides, flown, fxPoints, planDecks, planScreens, trusses: RIG.LX, plan: P ? plan : null };
}
