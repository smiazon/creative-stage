// The camera mark: an X taped on the stage where a (simulated) camera is
// aimed, the circle around it that the camera can see, and the camera itself
// on a tripod out front, with a faint cone showing what it looks at. main.js
// decides whether you are standing on the X; this only builds and colours it.
//
// Idle, the tape is warm white. With the camera live and you on the X, the
// tape turns green, the cone lights up and the camera's tally light goes red,
// the way a TV camera shows it is on air.
import * as THREE from 'three';

export const MARK_RADIUS = 1.25;   // metres from the X that still count as on it

const IDLE = new THREE.Color(0xf2e6c4);
const LIVE = new THREE.Color(0x35f08a);
const HEAD_H = 1.55;   // camera height above the deck: the performer's face and chest
const AIM_H = 1.1;     // where it points: the performer's middle

export function buildStageMark(scene) {
  const group = new THREE.Group();
  group.name = 'stageMark';
  group.visible = false;
  scene.add(group);

  // the X: two strips of tape, lying just proud of the deck
  const tapeMat = new THREE.MeshBasicMaterial({ color: IDLE.clone(), toneMapped: false });
  const tapeGeo = new THREE.BoxGeometry(1.0, 0.012, 0.12);
  for (const r of [Math.PI / 4, -Math.PI / 4]) {
    const m = new THREE.Mesh(tapeGeo, tapeMat);
    m.rotation.y = r;
    m.position.y = 0.008;
    group.add(m);
  }
  // the circle the camera can see
  const ringMat = new THREE.MeshBasicMaterial({
    color: IDLE.clone(), transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(MARK_RADIUS - 0.04, MARK_RADIUS, 96), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.006;
  group.add(ring);

  // the camera out front: tripod, body, lens, tally light
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.3, metalness: 0.7 });
  const glassMat = new THREE.MeshBasicMaterial({ color: 0x2a5c8a, toneMapped: false });
  const tallyMat = new THREE.MeshBasicMaterial({ color: 0x3a1010, toneMapped: false });
  const riserMat = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.8, metalness: 0.1 });
  const cam = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.36), metal);
  cam.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.2, 20), dark);
  lens.rotation.x = Math.PI / 2;
  lens.position.z = 0.27;
  cam.add(lens);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.062, 20), glassMat);
  glass.position.z = 0.371;
  cam.add(glass);
  const finder = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.14), dark);
  finder.position.set(-0.15, 0.06, -0.08);
  cam.add(finder);
  const tally = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8), tallyMat);
  tally.position.set(0, 0.125, 0.12);
  cam.add(tally);
  group.add(cam);
  const legs = new THREE.Group();
  group.add(legs);

  // the cone from the lens down to the circle: what the camera sees
  const coneMat = new THREE.MeshBasicMaterial({
    color: IDLE.clone(), transparent: true, opacity: 0.05, depthWrite: false, toneMapped: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const cone = new THREE.Mesh(new THREE.BufferGeometry(), coneMat);
  cone.visible = false;
  group.add(cone);

  const up = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();
  let placedKey = '';
  // Put the X at (x, y, z), deck height y, and the camera on its tripod at
  // (camX, camZ), standing on whatever is there at height camBaseY. Out front
  // that is usually the floor, well below the deck: then the tripod stands on
  // a camera riser, the way cameras in a concert pit do.
  function place({ x, y, z, camX, camZ, camBaseY }) {
    const key = [x, y, z, camX, camZ, camBaseY].map((v) => v.toFixed(3)).join(',');
    if (key === placedKey) return;
    placedKey = key;
    group.position.set(x, y, z);
    // everything below is in the X's frame: deck top at y = 0
    const hx = camX - x, hz = camZ - z, base = camBaseY - y;
    const headY = Math.max(base + 1.2, HEAD_H);
    cam.position.set(hx, headY, hz);
    group.updateMatrixWorld(true);
    cam.lookAt(tmp.set(x, y + AIM_H, z));
    // riser, when the floor is far below the head, then the tripod on it: a
    // centre column and three legs splayed from under the head
    for (const m of legs.children) m.geometry.dispose();
    legs.clear();
    const foot = headY - base > 2.2 ? headY - 1.45 : base;
    if (foot > base) {
      const riser = new THREE.Mesh(new THREE.BoxGeometry(1.2, foot - base, 1.2), riserMat);
      riser.position.set(hx, (base + foot) / 2, hz);
      legs.add(riser);
    }
    const top = new THREE.Vector3(hx, headY - 0.12, hz);
    const addBar = (a, b, r) => {
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), metal);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(up, tmp.copy(b).sub(a).normalize());
      legs.add(m);
    };
    for (let k = 0; k < 3; k++) {
      const ang = (k / 3) * Math.PI * 2 + Math.PI / 6;
      addBar(top, new THREE.Vector3(hx + Math.cos(ang) * 0.5, foot, hz + Math.sin(ang) * 0.5), 0.018);
    }
    addBar(top, new THREE.Vector3(hx, Math.max(foot, headY - 0.9), hz), 0.024);
    // the cone: from the front of the lens to the circle on the deck
    const dir = tmp.set(-hx, AIM_H - headY, -hz).normalize();
    const apex = new THREE.Vector3(hx, headY, hz).addScaledVector(dir, 0.37);
    const N = 48;
    const pos = new Float32Array((N + 1) * 3);
    pos.set([apex.x, apex.y, apex.z], 0);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      pos.set([Math.cos(a) * MARK_RADIUS, 0.012, Math.sin(a) * MARK_RADIUS], (i + 1) * 3);
    }
    const idx = [];
    for (let i = 0; i < N; i++) idx.push(0, 1 + i, 1 + ((i + 1) % N));
    cone.geometry.dispose();
    cone.geometry = new THREE.BufferGeometry();
    cone.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    cone.geometry.setIndex(idx);
  }

  let live = false, onMark = false;
  // live: the camera is running. onMark: you are standing on the X.
  function setState(s) {
    live = !!s.live;
    onMark = !!s.onMark;
    const c = live && onMark ? LIVE : IDLE;
    tapeMat.color.copy(c);
    ringMat.color.copy(c);
    coneMat.color.copy(c);
    cone.visible = live;
    coneMat.opacity = onMark ? 0.06 : 0.035;
    tallyMat.color.setHex(live && onMark ? 0xff2a2a : 0x3a1010);
  }
  // with the camera waiting for someone, the circle breathes to say "stand here"
  function tick(t) {
    ringMat.opacity = live && !onMark ? 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(t * 3.2)) : onMark && live ? 0.85 : 0.45;
  }

  return { group, place, setState, tick };
}
