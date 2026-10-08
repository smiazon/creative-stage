// 2D animated crowd: one billboarded sprite per seat, drawn from a pose atlas.
//
// Everything that varies per person — pose, hop height, body scale — is derived
// in the vertex shader from a hash of the person's own position, so animating
// ~30k figures costs no CPU time and no per-frame buffer uploads. The only
// per-instance data is the shirt colour, uploaded once at build time.
//
// Off by default: figures are ~7x the screen area of the orb discs, and fill
// rate is this scene's wall.
import * as THREE from 'three';
import {
  makeCrowdAtlas, crowdBillboard, CROWD_ANIM, ORB_ANIM,
  CROWD_CELL_W, CROWD_CELL_H,
} from './textures.js';

const FIG_H = 1.75;                                   // figure height, metres
const FIG_W = FIG_H * (CROWD_CELL_W / CROWD_CELL_H);  // cell aspect, so no squash

// Complexion multipliers relative to the atlas base skin (#cf9f78) — from
// pale through deep, picked deterministically per seat like the shirts.
const TONES = [
  [1.13, 1.1, 1.08], [1.0, 1.0, 1.0], [0.88, 0.82, 0.78],
  [0.66, 0.55, 0.48], [0.48, 0.38, 0.33], [0.35, 0.27, 0.24],
];

// Ordinary arena clothing: mostly muted, a few team colours, some near-black.
const SHIRTS = [
  0x2c3038, 0x1b1d22, 0x3a3f4a, 0x55575e, 0x6d5f52, 0x8a1220, 0x93182a,
  0x1f3d6b, 0x2f5f8a, 0x7a6a3c, 0x9a9a9e, 0x4a2f3c, 0x27503f, 0xb5aa9a,
];

let sharedAtlas = null;

// `sources` are the same seat lists the orbs use: { pos, drop }, where `pos`
// is the orb Float32Array and `drop` is how far below it the floor sits.
export function buildCrowd(scene, sources) {
  if (!sharedAtlas) sharedAtlas = makeCrowdAtlas();

  const meshes = [];
  let total = 0;

  for (const { pos, drop, parent, wave } of sources) {
    const n = pos.length / 3;
    if (!n) continue;

    const geo = new THREE.PlaneGeometry(FIG_W, FIG_H);
    geo.translate(0, FIG_H / 2, 0);      // anchor at the feet, not the middle
    const mat = new THREE.MeshBasicMaterial({
      map: sharedAtlas,
      alphaTest: 0.6,   // opaque cutout; the higher cut also trims edge halos
      side: THREE.DoubleSide,
      fog: true,        // let distant rows sink into the room, unlike the orbs
    });
    crowdBillboard(mat, { waveMute: wave ? 0 : 1 });   // only the bowl waves

    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const shirts = new Float32Array(n * 3);
    const skins = new Float32Array(n * 3);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();

    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1] - drop, z = pos[i * 3 + 2];
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // deterministic per-seat pick, so the same seat is the same person
      col.setHex(SHIRTS[(i * 7 + ((x * 13 + z * 29) | 0)) % SHIRTS.length | 0]);
      shirts[i * 3] = col.r; shirts[i * 3 + 1] = col.g; shirts[i * 3 + 2] = col.b;
      const tone = TONES[Math.abs((i * 11 + ((x * 31 + z * 17) | 0))) % TONES.length];
      skins[i * 3] = tone[0]; skins[i * 3 + 1] = tone[1]; skins[i * 3 + 2] = tone[2];
    }
    geo.setAttribute('aShirt', new THREE.InstancedBufferAttribute(shirts, 3));
    geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skins, 3));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;   // instances span the whole bowl
    mesh.visible = false;
    mesh.renderOrder = -1;        // draw before the transparent show effects
    (parent || scene).add(mesh);
    meshes.push(mesh);
    total += n;
  }

  return { meshes, count: total };
}

const MODES = { off: 0, idle: 1, cheer: 2, jump: 3, towel: 4, wave: 5, mix: 6, handsup: 7 };

export class CrowdFX {
  constructor(crowd) {
    this.meshes = crowd.meshes;
    this.count = crowd.count;
    this.mode = 'off';
    this.speed = 1;
    this.level = 1;      // user brightness
    this.ambient = 0.5;  // venue factor: these are unlit, so the room sets it
    this.scale = 1;
    this.t = 0;
    this._venueVisible = true;   // set false when the mode has no crowd
  }

  set(opts) {
    Object.assign(this, opts);
    CROWD_ANIM.uCrowdMode.value = MODES[this.mode] ?? 0;
    CROWD_ANIM.uCrowdBright.value = this.level * this.ambient * (this.grand ?? 1);   // grand: a trigger's fade (main.js)
    CROWD_ANIM.uCrowdScale.value = this.scale;
    this._sync();
  }

  // HANDS UP is a cue, not a loop: it stamps the clock and the shader ramps
  // everyone to arms-up on their own stagger, then holds until the next cue.
  handsUp() {
    if (this.mode === 'off') this.set({ mode: 'handsup' });
    else CROWD_ANIM.uCrowdMode.value = MODES.handsup;
    this.mode = 'handsup';
    CROWD_ANIM.uHandsT0.value = CROWD_ANIM.uCrowdTime.value;
    this._sync();
  }

  // The venue can force the crowd off (blackout, bird view) without losing the
  // mode the user picked, so switching back restores it.
  setVenueVisible(v) { this._venueVisible = v; this._sync(); }

  _sync() {
    const on = this._venueVisible && this.mode !== 'off';
    for (const m of this.meshes) m.visible = on;
    // The band sits in the hand. Arms down, a phone is held at the chest —
    // about 1.15 m x scale above the feet; straight up it is ~1.70 m. Orbs rest
    // `drop` (~0.82) above the feet, so the lift parks them in the resting hand
    // and crowdPose's `raise` (0..1) adds the rest->raised gap per person, per
    // moment. Before this the lift was the raised height, always, so a bowl of
    // idle figures had every band floating a head above them.
    ORB_ANIM.uOrbLift.value = on ? 1.15 * this.scale - 0.82 : 0;
    ORB_ANIM.uArmRise.value = on ? 0.55 * this.scale : 0;
  }

  // live wash bounce: the render loop feeds the summed show-light colour here.
  // Scaled by the user's brightness level so the crowd slider stays the master
  // control — at level 0 the crowd goes fully dark, washes or not.
  setShowTint(c, dt) {
    this._tintScaled = this._tintScaled || c.clone();
    this._tintScaled.copy(c).multiplyScalar(this.level * this.ambient * 2 * (this.grand ?? 1));
    CROWD_ANIM.uCrowdTint.value.lerp(this._tintScaled, Math.min(1, dt * 10));
  }

  update(dt) {
    if (this.mode === 'off' || !this._venueVisible) return;
    this.t += dt * this.speed;
    CROWD_ANIM.uCrowdTime.value = this.t;
  }
}
