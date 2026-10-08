// Giant crowd balloons — oversized beach-ball spheres batted around above the
// audience floor. Three builds, mixed or forced from the console:
//   neon    — a random party colour worn under glowing neon paint splatter
//   classic — plain matte vinyl in party colours, lit by the house rig
//   lantern — translucent white shell with a bright orb glowing inside
// All instanced; motion is a per-balloon bob + wander, cheap enough to run
// every frame for the full fleet.
import * as THREE from 'three';

const MAXN = 40;
const BASE_D = 1.3;   // metres — roughly twice a gym ball, per the brief
const NEON = [0x39ff5e, 0xff2fd4, 0x2fd4ff, 0xffe22f, 0xff5a2f, 0x8a5bff];
const CLASSIC = [0xd6323a, 0x2f6bd6, 0xf2c53a, 0x2fa85a, 0xe07830, 0x7a4fd0, 0xf0f0f2];
const GLOWS = [0xff3b6e, 0x35c8ff, 0x7dff3b, 0xffc61a, 0xff3bd4, 0x9a6bff];

// Paint splats on a TRANSPARENT sheet, worn as a decal over a coloured shell:
// the balloon keeps its own party colour and the splatter glows on top of it.
function makeSplatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  let seed = 7;
  const rnd = () => (seed = (16807 * seed) % 2147483647) / 2147483647;
  for (let i = 0; i < 15; i++) {
    const px = rnd() * 256, py = rnd() * 256, r = 6 + rnd() * 13;
    x.fillStyle = `rgba(255,255,255,${0.75 + rnd() * 0.25})`;
    x.beginPath();
    x.ellipse(px, py, r, r * (0.5 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * 2);
    x.fill();
    // drips off the splat
    for (let d = 0; d < 3; d++) {
      const a = rnd() * Math.PI * 2;
      x.fillRect(px + Math.cos(a) * r, py + Math.sin(a) * r, 2 + rnd() * 3, 8 + rnd() * 16);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function initBalloons(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const geo = new THREE.SphereGeometry(0.5, 22, 14);
  const splatTex = makeSplatTexture();
  const meshes = {
    // painted balloons are two layers: a lit colour shell + a glowing decal
    neon: new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0 }), MAXN),
    splat: new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
      map: splatTex, transparent: true, depthWrite: false,
    }), MAXN),
    classic: new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0 }), MAXN),
    shell: new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false,
    }), MAXN),
    orb: new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({}), MAXN),
  };
  meshes.orb.renderOrder = 1;    // the inner light draws before its shell
  meshes.shell.renderOrder = 2;
  meshes.splat.renderOrder = 3;  // paint decal over its own shell
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const col = new THREE.Color();
  for (const m of Object.values(meshes)) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAXN; i++) { m.setMatrixAt(i, zero); m.setColorAt(i, col.set(0xffffff)); }
    m.frustumCulled = false;
    group.add(m);
  }

  // per-balloon habits, fixed at birth: anchor over the floor crowd, its own
  // bob rate/phase, wander orbit, spin axis
  let seed = 4242;
  const rnd = () => (seed = (16807 * seed) % 2147483647) / 2147483647;
  const B = [];
  for (let i = 0; i < MAXN; i++) {
    let ax = 0, az = 0;
    for (let g = 0; g < 20; g++) {
      ax = -13 + rnd() * 38;
      az = (rnd() - 0.5) * 38;
      if ((ax / 28) ** 2 + (az / 13) ** 2 < 1) break;   // stay inside the bowl floor (half-width 15.6)
    }
    // 20 rejections used to fall through with the last REJECTED point, parking a
    // balloon outside the floor. Scale it back onto the ellipse instead.
    const e = Math.hypot(ax / 28, az / 13);
    if (e >= 1) { ax /= e * 1.02; az /= e * 1.02; }
    B.push({
      ax, az,
      wr: 1.4 + rnd() * 3.2,                    // wander radius
      ws: 0.6 + rnd() * 0.9,                    // wander rate
      bw: 0.9 + rnd() * 1.4,                    // bob rate
      bp: rnd() * Math.PI * 2,
      bp2: rnd() * Math.PI * 2,
      hi: 1.0 + rnd() * 2.4,                    // bounce amplitude
      axis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
      rot: (rnd() - 0.5) * 1.6,
      pick: rnd(),
      type: 0,                                  // filled by assign()
    });
  }

  const state = { on: false, count: 26, size: 1, mode: 'mix' };
  const TYPES = ['neon', 'classic', 'lantern'];

  // decide each balloon's build + colour for the current mode
  function assign() {
    for (let i = 0; i < MAXN; i++) {
      const b = B[i];
      b.type = state.mode === 'mix' ? i % 3 : TYPES.indexOf(state.mode);
      if (b.type === 0) {
        // shell colour and paint colour are picked independently, so a green
        // balloon can wear pink splatter
        meshes.neon.setColorAt(i, col.set(CLASSIC[(b.pick * CLASSIC.length) | 0]));
        const np = (b.pick * 977) % 1;
        meshes.splat.setColorAt(i, col.set(NEON[(np * NEON.length) | 0]).multiplyScalar(1.6));
      } else if (b.type === 1) {
        meshes.classic.setColorAt(i, col.set(CLASSIC[(b.pick * CLASSIC.length) | 0]));
      } else {
        meshes.shell.setColorAt(i, col.set(0xffffff));
        meshes.orb.setColorAt(i, col.set(GLOWS[(b.pick * GLOWS.length) | 0]).multiplyScalar(2.4));
      }
    }
    for (const m of Object.values(meshes)) m.instanceColor.needsUpdate = true;
  }
  assign();

  let t = 0;
  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const P = new THREE.Vector3();
  const S = new THREE.Vector3();

  function update(dt) {
    if (!state.on) return;
    t += dt;
    const sc = BASE_D * state.size;
    for (let i = 0; i < MAXN; i++) {
      const b = B[i];
      const live = i < state.count;
      const isLan = b.type === 2;
      const write = (mesh, on, k) => {
        if (!on) { mesh.setMatrixAt(i, zero); return; }
        P.set(
          b.ax + Math.sin(t * 0.11 * b.ws + b.bp) * b.wr,
          0.6 + sc * 0.5 + b.hi * Math.abs(Math.sin(t * b.bw + b.bp)) + 0.5 * Math.sin(t * 0.23 + b.bp2),
          b.az + Math.cos(t * 0.13 * b.ws + b.bp2) * b.wr);
        Q.setFromAxisAngle(b.axis, t * b.rot);
        S.setScalar(sc * k);
        M.compose(P, Q, S);
        mesh.setMatrixAt(i, M);
      };
      write(meshes.neon, live && b.type === 0, 1);
      write(meshes.splat, live && b.type === 0, 1.006);
      write(meshes.classic, live && b.type === 1, 1);
      write(meshes.shell, live && isLan, 1);
      write(meshes.orb, live && isLan, 0.42);
    }
    for (const m of Object.values(meshes)) m.instanceMatrix.needsUpdate = true;
  }

  return {
    group, update, state,
    setOn(v) { state.on = !!v; group.visible = state.on; },
    setCount(n) { state.count = Math.max(0, Math.min(MAXN, n | 0)); },
    setSize(k) { state.size = Math.max(0.3, Math.min(2.5, k)); },
    setMode(m) { if (TYPES.includes(m) || m === 'mix') { state.mode = m; assign(); } },
  };
}
