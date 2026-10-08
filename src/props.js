// Hanging light-up show props — planets, hearts, stars — flown from the house
// steel (y=32.3) on visible cables, floating over the floor and bowl.
//
// This group is parented to the SCENE in WORLD coordinates (never the show-rig
// group, which stage configs translate and x-scale). All ~27 props are built
// once at init; modes only toggle visibility. Animation is plain CPU transform
// work in update(dt) — at 27 props that costs nothing next to the 30k seats.
//
// Materials follow the house rules: MeshBasicMaterial for glowing parts (the
// scene is unlit — emissive surfaces ARE the light), MeshLambertMaterial for
// matte parts. Bloom gates on max(r,g,b) > 1.25, so the pulse drives the glow
// colour up to a ~1.6 peak channel: gently over the gate at the top of the
// pulse, under it at the bottom.
import * as THREE from 'three';

const ROOF_Y = 38.5;                 // house steel — cable anchors live here
const UP = new THREE.Vector3(0, 1, 0);

// world-space hang spots [x, y, z], y within 14..24. Mostly over the floor
// (the rink slab spans x ±30, z ±13; the stage deck claims x < -18, so props
// stay east of it and clear of the trusses), last two per shape over the bowl
// seats. 'mix' shows the FIRST THREE of each shape, so those three are spread
// floor + bowl for a good default look.
const SPOTS = {
  planets: [
    [-8, 17.5, -7], [14, 21, 6], [36, 18, -5],
    [4, 20, -21], [24, 22.5, 9], [-2, 15.5, 10],
    [18, 16, -10], [8, 23, 0], [28, 19, -3],
  ],
  hearts: [
    [-12, 19, 3], [10, 22, 8], [8, 18, 22],
    [38, 20, 4], [22, 16.5, -4], [2, 15, -9],
    [16, 23.5, -11], [28, 21, 2], [-5, 17.5, 9],
  ],
  stars: [
    [-14, 21, -4], [8, 15.5, -6], [33, 21, 9],
    [-4, 17, -22], [20, 23, 10], [0, 18.5, 7],
    [27, 16, -8], [-7, 22, -10], [14, 19.5, 2],
  ],
};

const cableMat = new THREE.MeshLambertMaterial({ color: 0x2e3036 });
const matteMat = new THREE.MeshLambertMaterial({ color: 0x2a2430 });

// unit cable: spans y 0..1 from its origin, so position at the prop's attach
// point, aim the +Y axis at the roof anchor, and scale y to the distance
const cableGeo = new THREE.CylinderGeometry(0.028, 0.028, 1, 5, 1, true);
cableGeo.translate(0, 0.5, 0);

// ---------------------------------------------------------------------------
// geometry builders
// ---------------------------------------------------------------------------
function heartGeometry() {
  // the classic 16sin^3 parametric heart, scaled to ~2 m tall
  const pts = [];
  const N = 64;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    pts.push(new THREE.Vector2(
      16 * Math.pow(Math.sin(t), 3),
      13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t),
    ));
  }
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const s = 2.0 / (maxY - minY);
  for (const p of pts) p.multiplyScalar(s);
  const shape = new THREE.Shape(pts);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false });
  geo.center();
  return geo;
}

function starGeometry() {
  // 5-point star, ~2 m tall, first point straight up
  const pts = [];
  const R = 1.05, r = 0.44;
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rad = i % 2 === 0 ? R : r;
    pts.push(new THREE.Vector2(Math.cos(a) * rad, Math.sin(a) * rad));
  }
  const shape = new THREE.Shape(pts);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false });
  geo.center();
  return geo;
}

function planetGeometry(r, bands, bandPhase) {
  // banded two-tone via vertex colours: the material's pulsing colour is
  // multiplied per-vertex, so the bands read as darker stripes of the same hue
  const geo = new THREE.SphereGeometry(r, 24, 16);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const lat = pos.getY(i) / r;                       // -1..1
    const v = Math.sin(lat * Math.PI * bands + bandPhase) > 0 ? 1.0 : 0.55;
    col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// ---------------------------------------------------------------------------
export function initProps(scene) {
  const group = new THREE.Group();
  group.name = 'showProps';
  group.visible = false;
  scene.add(group);

  const colorA = new THREE.Color(0x2fb8ff);
  const colorB = new THREE.Color(0xff2f6e);
  const state = { mode: 'off', motion: true };

  const heartGeo = heartGeometry();
  const starGeo = starGeometry();

  const props = [];       // every prop, all shapes
  const subs = { planets: new THREE.Group(), hearts: new THREE.Group(), stars: new THREE.Group() };
  for (const k of Object.keys(subs)) { subs[k].name = 'props_' + k; group.add(subs[k]); }

  // one prop = holder(visibility unit) -> [ cable, pivot(bob/spin/drift) -> meshes ]
  function makeProp(shape, spot, index) {
    const holder = new THREE.Group();
    subs[shape].add(holder);

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: shape === 'planets',
    });

    const pivot = new THREE.Group();
    let attachY;            // cable pickup height above the pivot origin

    if (shape === 'planets') {
      const r = 1.2 + Math.random() * 1.0;
      const sphere = new THREE.Mesh(
        planetGeometry(r, 2 + ((Math.random() * 3) | 0), Math.random() * Math.PI * 2),
        glowMat,
      );
      pivot.add(sphere);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.65, r * 0.055, 6, 40), matteMat);
      ring.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.8;
      ring.rotation.y = (Math.random() - 0.5) * 0.6;
      pivot.add(ring);
      attachY = r;
    } else {
      // extrude caps glow (material 0), side walls stay matte (material 1)
      // so the silhouette still reads when the pulse is at its dimmest
      const geo = shape === 'hearts' ? heartGeo : starGeo;
      const mesh = new THREE.Mesh(geo, [glowMat, matteMat]);
      pivot.add(mesh);
      attachY = 1.02;
    }

    const home = new THREE.Vector3(
      spot[0] + (Math.random() - 0.5) * 1.5,
      spot[1] + (Math.random() - 0.5) * 1.0,
      spot[2] + (Math.random() - 0.5) * 1.5,
    );
    pivot.position.copy(home);
    pivot.rotation.y = Math.random() * Math.PI * 2;
    holder.add(pivot);

    const cable = new THREE.Mesh(cableGeo, cableMat);
    holder.add(cable);

    props.push({
      shape, index, holder, pivot, cable, glowMat, attachY, home,
      homeBase: home.clone(),                               // pre-region original
      anchor: new THREE.Vector3(home.x, ROOF_Y, home.z),   // fixed roof pick
      phase: Math.random() * Math.PI * 2,
      pulseW: 0.7 + Math.random() * 0.7,                    // colour pulse rate
      bobW: Math.PI * 2 * (0.1 + Math.random() * 0.1),      // 0.1-0.2 Hz
      spinW: THREE.MathUtils.degToRad(3 + Math.random() * 5) * (Math.random() < 0.5 ? -1 : 1),
      orbitR: 0.5 + Math.random() * 0.5,                    // 1-2 m diameter drift
      orbitW: 0.15 + Math.random() * 0.15,
    });
  }

  for (const shape of Object.keys(SPOTS)) {
    SPOTS[shape].forEach((spot, i) => makeProp(shape, spot, i));
  }

  function applyMode() {
    group.visible = state.mode !== 'off';
    for (const p of props) {
      p.holder.visible =
        state.mode === p.shape || (state.mode === 'mix' && p.index < 3);
    }
  }

  function set(opts = {}) {
    if (opts.mode !== undefined) { state.mode = opts.mode; applyMode(); }
    if (opts.motion !== undefined) state.motion = !!opts.motion;
    if (opts.colorA !== undefined) colorA.set(opts.colorA);
    if (opts.colorB !== undefined) colorB.set(opts.colorB);
  }

  let t = 0;
  const _c = new THREE.Color();
  const _pos = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  function update(dt) {
    if (state.mode === 'off') return;
    t += dt;
    for (const p of props) {
      if (!p.holder.visible) continue;

      // --- motion: bob + tiny horizontal orbit + slow spin ------------------
      if (state.motion) {
        _pos.set(
          p.home.x + Math.cos(t * p.orbitW + p.phase) * p.orbitR,
          p.home.y + Math.sin(t * p.bobW + p.phase * 1.7) * 0.6,
          p.home.z + Math.sin(t * p.orbitW * 0.83 + p.phase) * p.orbitR,
        );
        p.pivot.position.copy(_pos);
        p.pivot.rotation.y += p.spinW * dt;
      } else {
        p.pivot.position.copy(p.home);
      }

      // --- cable follows: stretch/tilt the unit cylinder to the roof pick ---
      _pos.copy(p.pivot.position);
      _pos.y += p.attachY;
      _dir.copy(p.anchor).sub(_pos);
      const len = _dir.length();
      p.cable.position.copy(_pos);
      p.cable.quaternion.setFromUnitVectors(UP, _dir.multiplyScalar(1 / len));
      p.cable.scale.set(1, len, 1);

      // --- glow pulse between colorA and colorB, per-prop phase -------------
      // brightness rides the same wave: ~1.6 peak channel (gently over the
      // 1.25 bloom gate), ~1.0 at the trough (under it)
      const mix = 0.5 + 0.5 * Math.sin(t * p.pulseW + p.phase);
      _c.copy(colorA).lerp(colorB, mix);
      const k = 1.0 + 0.6 * (0.5 + 0.5 * Math.sin(t * p.pulseW * 1.31 + p.phase * 2.3));
      p.glowMat.color.copy(_c).multiplyScalar(k);
    }
  }

  // Room awareness: remap every hang east-west so props always float in the
  // OPEN part of the room — ahead of the stage, the rig and any curtain. The
  // original layout spans x -14..38; setRegion squeezes it into [minX, maxX].
  function setRegion(minX, maxX) {
    const o0 = -14, o1 = 38;
    for (const pr of props) {
      const u = (pr.homeBase.x - o0) / (o1 - o0);
      pr.home.set(minX + u * (maxX - minX), pr.homeBase.y, pr.homeBase.z);
    }
    // de-overlap: squeezing the span can collide hangs, so relax them apart.
    // Props separated by >3.4 m of height read as different layers and may
    // share plan-space; everything else keeps >5.4 m of clearance (prop
    // radius ~2.2 m plus the 1-2 m orbit drift).
    const MIND = 5.4;
    for (let it = 0; it < 14; it++) {
      let moved = false;
      for (let i = 0; i < props.length; i++) {
        for (let j = i + 1; j < props.length; j++) {
          const a = props[i].home, b = props[j].home;
          if (Math.abs(a.y - b.y) > 3.4) continue;
          let dx = b.x - a.x, dz = b.z - a.z;
          let d = Math.hypot(dx, dz);
          if (d >= MIND) continue;
          if (d < 1e-3) { dx = 1; dz = 0.3; d = 1; }
          const push = (MIND - d) / 2 / d;
          a.x -= dx * push; a.z -= dz * push;
          b.x += dx * push; b.z += dz * push;
          a.x = Math.min(maxX, Math.max(minX, a.x));
          b.x = Math.min(maxX, Math.max(minX, b.x));
          a.z = Math.min(23, Math.max(-23, a.z));
          b.z = Math.min(23, Math.max(-23, b.z));
          moved = true;
        }
      }
      if (!moved) break;
    }
    for (const pr of props) {
      pr.anchor.set(pr.home.x, ROOF_Y, pr.home.z);
      pr.pivot.position.copy(pr.home);
    }
  }

  return { group, set, update, state, setRegion };
}
