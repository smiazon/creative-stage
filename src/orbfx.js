// Show-effect engines: per-seat orb colors and LED fascia ring modes.
import * as THREE from 'three';
import { ORB_ANIM, makeFasciaStripes, makeFasciaSparkle } from './textures.js';

// fast hue -> rgb (s=1, l=0.5), h wraps in [0,1)
function hueR(h) { h = ((h % 1) + 1) % 1; return Math.min(1, Math.max(0, Math.abs(h * 6 - 3) - 1)); }
function hueG(h) { h = ((h % 1) + 1) % 1; return Math.min(1, Math.max(0, 2 - Math.abs(h * 6 - 2))); }
function hueB(h) { h = ((h % 1) + 1) % 1; return Math.min(1, Math.max(0, 2 - Math.abs(h * 6 - 4))); }

// palette-show family: every orb wears one colour from the user's palette and
// a shared envelope animates brightness. All of them read this.palette.
const PAL_MODES = new Set(['psolid', 'pblink', 'ppulseo', 'ppulsec', 'pfade', 'pstrobe', 'ptwinkle']);

// ---------------------------------------------------------------------------
// OrbFX — drives instanceColor on the seat-orb InstancedMeshes.
// Modes: off · solid · wave · sweep · rise · sparkle · sections · video ·
// rainbow · rainwave · comet · fireworks · pulse · strobe · checker ·
// random · twinkle · noise · spiral · ripple · fire · heartbeat ·
// palette shows: psolid · pblink · ppulseo · ppulsec · pfade · pstrobe · ptwinkle
// design: the show designer's zones, painted by this.painter (showengine.js)
// ---------------------------------------------------------------------------
export class OrbFX {
  constructor(groups) { // [{ mesh, pos: Float32Array }]
    const black = new THREE.Color(0x000000);
    this.groups = groups.filter(Boolean).map((g) => {
      const n = g.mesh.count;
      for (let i = 0; i < n; i++) g.mesh.setColorAt(i, black);
      g.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      g.mesh.material.color.set(0xffffff); // instance colors carry everything
      const dist = new Float32Array(n);
      const ang = new Float32Array(n);   // 0..1 around the bowl
      const phase = new Float32Array(n);
      let seed = 12345;
      for (let i = 0; i < n; i++) {
        const x = g.pos[i * 3], z = g.pos[i * 3 + 2];
        dist[i] = Math.hypot(x, z);
        ang[i] = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
        seed = (16807 * seed) % 2147483647;
        phase[i] = (seed / 2147483647) * Math.PI * 2;
      }
      return { mesh: g.mesh, pos: g.pos, n, dist, ang, phase, videoMap: null };
    });
    this.mode = 'off';
    // physical crowd motion — separate axis from colour, driven on the GPU
    // 1, not 0: a bowl of perfectly static wristbands reads as a frozen frame.
    // Still was the old default rather than anyone's artistic choice.
    this.animMode = 1;        // 0 still, 1 handheld. Everything bigger is the crowd's
                              // arms now (see crowdPose in textures.js); with a
                              // crowd up the shader treats every band as handheld.
    this.animStrength = 1.0;
    this.animSpeed = 1.0;
    this.video = null;
    this.videoCanvas = null;
    this.videoCtx = null;
    // What 'video' mode shows: altSource (a generated-visuals canvas, or the
    // live camera) wins over the file video. The framing is the live camera's:
    // crop the frame to the map's shape instead of stretching it, mirror it like
    // a selfie view, and lift the contrast, because a dim room reads as a dark
    // crowd. The defaults leave the file video exactly as it always mapped.
    this.altSource = null;
    this.sourceAspect = null;   // null = stretch the whole frame over the map
    this.sourceMirror = false;
    this.sourceContrast = 1;
    // Extra level for the camera: at the wristbands' normal level a lit pixel
    // stays under the bloom gate, and an unglowing crowd picture reads as
    // scattered dots. Pushed past it, neighbours glow into each other.
    this.sourceGain = 1;
    this._lut = null;
    this._lutKey = '';
    this._lastFrameSeq = -1;
    this.colorA = new THREE.Color(0xff2fb4);
    this.colorB = new THREE.Color(0x2f7bff);
    // orb-show palette (1..10 colours); per-orb picks are cached per group
    this.palette = [0xff3b30, 0x2f7bff, 0xff3bd4, 0xffffff].map((h) => new THREE.Color(h));
    this._palDirty = true;
    this._maxD = 1;
    this.speed = 1;
    // Smaller dot, hotter core. The disc is a MeshBasicMaterial with alphaTest,
    // so the halo cannot come from the texture — it comes from bloom, and bloom
    // only catches values over its 1.25 threshold. Shrinking the dot and
    // pushing the colour past that reads as a bright point rather than a blob.
    this.brightness = 2.1;
    this.grand = 1;   // the trigger's fade line over everything (main.js)
    this.t = 0;
    this._staticDirty = true;
    this._size = 1;
    this._bursts = [];
    this._burstTimer = 0;
  }

  set(opts) {
    Object.assign(this, opts);
    this._staticDirty = true;
  }

  // colours may arrive as THREE.Color, hex numbers or '#rrggbb' strings
  setPalette(list) {
    const cols = (list || []).slice(0, 10).map((c) => (c && c.isColor ? c : new THREE.Color(c)));
    if (cols.length) this.palette = cols;
    this._palDirty = true;
    this._staticDirty = true;
  }

  // 1.0 = original basketball size; scales the shared sphere geometry
  setSize(k) {
    const f = k / this._size;
    if (Math.abs(f - 1) < 1e-4) return;
    for (const g of this.groups) g.mesh.geometry.scale(f, f, f);
    this._size = k;
  }

  // Replace one seat block with a freshly built mesh (stage-layout switches
  // rebuild the concert floor). Mirrors the constructor's per-group setup,
  // including matching the current orb size, which the new geometry lacks.
  setGroup(i, { mesh, pos }) {
    const black = new THREE.Color(0x000000);
    const n = mesh.count;
    for (let k = 0; k < n; k++) mesh.setColorAt(k, black);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.material.color.set(0xffffff);
    if (Math.abs(this._size - 1) > 1e-4) mesh.geometry.scale(this._size, this._size, this._size);
    const dist = new Float32Array(n);
    const ang = new Float32Array(n);
    const phase = new Float32Array(n);
    let seed = 12345;
    for (let k = 0; k < n; k++) {
      const x = pos[k * 3], z = pos[k * 3 + 2];
      dist[k] = Math.hypot(x, z);
      ang[k] = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
      seed = (16807 * seed) % 2147483647;
      phase[k] = (seed / 2147483647) * Math.PI * 2;
    }
    mesh.visible = this.orbsVisible !== false;   // a layout rebuild keeps the toggle
    this.groups[i] = { mesh, pos, n, dist, ang, phase, videoMap: null };
    // static modes (off/solid) skip repaints; force one so the fresh buffer
    // gets the active look instead of staying black after a layout rebuild
    this._staticDirty = true;
  }
  // Resolution the video is sampled at before each seat picks its pixel. The
  // file video keeps its 128; a camera image of a face wants more.
  setSampleSize(n) {
    if (!this.videoCanvas || this.videoCanvas.width === n) return;
    this.videoCanvas.width = n;
    this.videoCanvas.height = n;
    this._staticDirty = true;
  }

  _sourceReady(src) {
    if (src.readyState !== undefined) return src.readyState >= 2 && src.videoWidth > 0;
    return src.width > 0 && src.height > 0;   // a canvas
  }

  // Draw the source into the sampling canvas once, cropped and mirrored as
  // configured, and hand back its pixels.
  _sampleSource(src) {
    const cv = this.videoCanvas, ctx = this.videoCtx;
    const w = cv.width, h = cv.height;
    const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
    let sx = 0, sy = 0, cw = sw, ch = sh;
    const a = this.sourceAspect;
    if (a && sw && sh) {                 // cover: crop the frame to the map's shape
      if (sw / sh > a) { cw = sh * a; sx = (sw - cw) / 2; }
      else { ch = sw / a; sy = (sh - ch) / 2; }
    }
    if (this.sourceMirror) ctx.setTransform(-1, 0, 0, 1, w, 0);
    ctx.drawImage(src, sx, sy, cw, ch, 0, 0, w, h);
    if (this.sourceMirror) ctx.setTransform(1, 0, 0, 1, 0, 0);
    return { pixels: ctx.getImageData(0, 0, w, h).data, pw: w, ph: h };
  }

  // byte -> orb level, contrast, gain and brightness folded into one table
  _contrastLut(br) {
    const k = this.sourceContrast || 1;
    const lvl = br * (this.sourceGain || 1);
    const key = k + ':' + lvl;
    if (this._lutKey !== key) {
      const lut = this._lut || (this._lut = new Float32Array(256));
      for (let v = 0; v < 256; v++) {
        const c = (v / 255 - 0.5) * k + 0.5;
        lut[v] = (c < 0 ? 0 : c > 1 ? 1 : c) * lvl;
      }
      this._lutKey = key;
    }
    return this._lut;
  }

  // Global orb visibility, independent of mode: real shows don't always hand
  // out wristbands. Hidden orbs also skip the 26k-seat colour loop entirely.
  setVisible(v) {
    this.orbsVisible = !!v;
    for (const g of this.groups) { if (g) g.mesh.visible = this.orbsVisible; }
    this._staticDirty = true;
  }

  update(dt) {
    // crowd motion advances every frame regardless of colour throttling, so
    // movement stays smooth at 60 Hz even though colours refresh at 30 Hz
    const step = dt * this.animSpeed;
    if (Number.isFinite(step)) ORB_ANIM.uOrbTime.value += step;
    ORB_ANIM.uOrbMode.value = Math.min(1, this.animMode);   // old banks may still say 2..5
    ORB_ANIM.uOrbStrength.value = this.animStrength;
    this.t += dt * this.speed;
    if (this.orbsVisible === false) return;
    const staticMode = this.mode === 'off' || this.mode === 'solid' || this.mode === 'psolid';
    if (staticMode && !this._staticDirty) return;
    if (!staticMode && !this._staticDirty && this._half) return;   // 30 Hz colour
    // A live camera only changes when a new frame lands. Between frames the
    // last colours stand, so a 30 fps feed costs 30 samples a second rather
    // than one per rendered frame. (Sources without a frame counter, like the
    // file video, sample every update as before.)
    let src = null, got = null;
    if (this.mode === 'video') {
      src = this.altSource || this.video;
      if (src && src._asyncOK && this.asyncRead && this.videoEnabled !== false) {
        // A picture drawn on the graphics card (the camera pipeline's) is read
        // back without waiting for the card: ask for each new frame, colour
        // from whichever answer came in last. A plain 2D read here stalled
        // whole frames while the card worked through the hand shapes.
        const seq = src._frameSeq, now = performance.now();
        if (this._reading && now - this._readingAt > 1000) this._reading = false;   // a read that never came back
        if (seq !== this._askedSeq && !this._reading && this._sourceReady(src)) {
          this._askedSeq = seq;
          this._reading = true;
          this._readingAt = now;
          this.asyncRead(src).then((r) => { if (r) this._got = r; }, () => {})
            .finally(() => { this._reading = false; });
        }
        if (!this._got || (this._got === this._used && !this._staticDirty)) return;
        got = this._used = this._got;
      } else {
        const seq = src ? src._frameSeq : undefined;
        if (seq !== undefined && seq === this._lastFrameSeq && !this._staticDirty) return;
      }
    }
    this._staticDirty = false;

    const br = this.brightness * this.grand;
    const ar = this.colorA.r * br, ag = this.colorA.g * br, ab = this.colorA.b * br;
    const bR = this.colorB.r * br, bG = this.colorB.g * br, bB = this.colorB.b * br;
    const t = this.t;
    const mode = this.mode;

    // fireworks bookkeeping (bursts of colored rings from random spots)
    if (mode === 'fireworks') {
      this._burstTimer += dt * this.speed;
      if (this._burstTimer > 0.55) {
        this._burstTimer = 0;
        const a = Math.random() * Math.PI * 2;
        const r = 22 + Math.random() * 22;
        this._bursts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, age: 0, h: Math.random() });
        if (this._bursts.length > 6) this._bursts.shift();
      }
      for (const b of this._bursts) b.age += dt * this.speed;
    }
    const bursts = this._bursts;

    // sample the video once per update, not once per seat block
    let pixels = null, pw = 0, ph = 0, lut = null;
    if (mode === 'video' && this.videoEnabled !== false && src && (got || this._sourceReady(src))) {
      ({ pixels, pw, ph } = got || this._sampleSource(src));
      lut = this._contrastLut(br);
      this._lastFrameSeq = src._frameSeq ?? -1;
    }

    // palette shows: (re)assign each orb its colour when the palette changes
    // or a group was swapped by a stage rebuild (fresh groups lack palCol)
    if (PAL_MODES.has(mode)) {
      let rebuild = this._palDirty;
      for (const g of this.groups) if (!g.palCol || g.palCol.length !== g.n * 3) rebuild = true;
      if (rebuild) {
        const pal = this.palette;
        const len = pal.length;
        let maxD = 1;
        for (const g of this.groups) {
          if (!g.palCol || g.palCol.length !== g.n * 3) g.palCol = new Float32Array(g.n * 3);
          const pc = g.palCol;
          for (let i = 0, j = 0; i < g.n; i++) {
            const c = pal[Math.min(len - 1, (g.phase[i] * 0.15915494 * len) | 0)];
            pc[j++] = c.r; pc[j++] = c.g; pc[j++] = c.b;
          }
          for (let i = 0; i < g.n; i++) if (g.dist[i] > maxD) maxD = g.dist[i];
        }
        this._maxD = maxD;
        this._palDirty = false;
      }
    }

    for (const g of this.groups) {
      const arr = g.mesh.instanceColor.array;
      const { n, dist, ang, phase, pos } = g;

      // the show designer paints its own zones of sections (showengine.js)
      if (mode === 'design') {
        if (this.painter) this.painter(g, this.groups.indexOf(g), arr, br, t);
        else arr.fill(0);
        g.mesh.instanceColor.needsUpdate = true;
        continue;
      }

      switch (mode) {
        case 'off':
          arr.fill(0);
          break;
        case 'solid':
          for (let i = 0, j = 0; i < n; i++) { arr[j++] = ar; arr[j++] = ag; arr[j++] = ab; }
          break;
        case 'pulse': {
          const k = 0.5 + 0.5 * Math.sin(t * 2.5);
          const r = bR + (ar - bR) * k, gg = bG + (ag - bG) * k, b = bB + (ab - bB) * k;
          for (let i = 0, j = 0; i < n; i++) { arr[j++] = r; arr[j++] = gg; arr[j++] = b; }
          break;
        }
        case 'strobe': {
          const on = Math.sin(t * 11) > 0;
          if (on) for (let i = 0, j = 0; i < n; i++) { arr[j++] = ar; arr[j++] = ag; arr[j++] = ab; }
          else arr.fill(0);
          break;
        }
        case 'rainbow': // hue rotates around the bowl
          for (let i = 0, j = 0; i < n; i++) {
            const h = ang[i] + t * 0.18;
            arr[j++] = hueR(h) * br; arr[j++] = hueG(h) * br; arr[j++] = hueB(h) * br;
          }
          break;
        case 'rainwave': // rainbow rings rippling outward
          for (let i = 0, j = 0; i < n; i++) {
            const h = dist[i] * 0.035 - t * 0.16;
            arr[j++] = hueR(h) * br; arr[j++] = hueG(h) * br; arr[j++] = hueB(h) * br;
          }
          break;
        case 'comet': { // bright head chasing around, fading tail, B as floor
          for (let i = 0, j = 0; i < n; i++) {
            const d = ((ang[i] - t * 0.22) % 1 + 1) % 1;
            const k = Math.pow(1 - d, 16);
            arr[j++] = bR * 0.12 + ar * k;
            arr[j++] = bG * 0.12 + ag * k;
            arr[j++] = bB * 0.12 + ab * k;
          }
          break;
        }
        case 'fireworks':
          for (let i = 0, j = 0; i < n; i++) {
            const x = pos[i * 3], z = pos[i * 3 + 2];
            let r = 0, gg = 0, b = 0;
            for (let q = 0; q < bursts.length; q++) {
              const bu = bursts[q];
              const ring = bu.age * 16;
              const dd = Math.hypot(x - bu.x, z - bu.z) - ring;
              const k = Math.exp(-dd * dd * 0.12) * Math.exp(-bu.age * 1.1);
              if (k > 0.01) {
                r += hueR(bu.h) * k; gg += hueG(bu.h) * k; b += hueB(bu.h) * k;
              }
            }
            arr[j++] = Math.min(r * br, 2.2);
            arr[j++] = Math.min(gg * br, 2.2);
            arr[j++] = Math.min(b * br, 2.2);
          }
          break;
        case 'random':   // every orb a fixed random hue — a static rainbow crowd
          for (let i = 0, j = 0; i < n; i++) {
            const h = phase[i] * 0.15915494;          // phase/(2*PI) -> 0..1
            arr[j++] = hueR(h) * br; arr[j++] = hueG(h) * br; arr[j++] = hueB(h) * br;
          }
          break;
        case 'twinkle': { // random hues, each orb breathing on its own clock
          for (let i = 0, j = 0; i < n; i++) {
            const h = phase[i] * 0.15915494 + t * 0.04;
            const k = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(t * 2.2 + phase[i] * 3.1), 2);
            arr[j++] = hueR(h) * br * k; arr[j++] = hueG(h) * br * k; arr[j++] = hueB(h) * br * k;
          }
          break;
        }
        case 'noise': {   // smooth drifting colour field, no two neighbours alike
          for (let i = 0, j = 0; i < n; i++) {
            const h = phase[i] * 0.0637 + Math.sin(t * 0.35 + dist[i] * 0.08) * 0.25 + t * 0.03;
            arr[j++] = hueR(h) * br; arr[j++] = hueG(h) * br; arr[j++] = hueB(h) * br;
          }
          break;
        }
        case 'spiral': {  // hue winds with angle AND radius, so arms rotate out
          for (let i = 0, j = 0; i < n; i++) {
            const h = ang[i] * 2 + dist[i] * 0.03 - t * 0.22;
            arr[j++] = hueR(h) * br; arr[j++] = hueG(h) * br; arr[j++] = hueB(h) * br;
          }
          break;
        }
        case 'ripple': {  // hard concentric rings travelling outward
          for (let i = 0, j = 0; i < n; i++) {
            const s = Math.sin(dist[i] * 0.42 - t * 3.4);
            const k = Math.pow(Math.max(0, s), 5);
            arr[j++] = bR * 0.1 + ar * k;
            arr[j++] = bG * 0.1 + ag * k;
            arr[j++] = bB * 0.1 + ab * k;
          }
          break;
        }
        case 'fire': {    // warm flicker, hottest low in the bowl
          for (let i = 0, j = 0; i < n; i++) {
            const y = pos[i * 3 + 1];
            const flick = 0.55 + 0.45 * Math.sin(t * 6.5 + phase[i] * 4.3);
            const heat = Math.max(0, 1 - y * 0.055) * flick;
            arr[j++] = 1.5 * heat * br;
            arr[j++] = 0.42 * heat * heat * br;
            arr[j++] = 0.06 * heat * heat * heat * br;
          }
          break;
        }
        case 'heartbeat': { // double thump, whole crowd together
          const c = (t * 0.85) % 1;
          const thump = Math.pow(Math.max(0, 1 - c * 6), 2) + 0.7 * Math.pow(Math.max(0, 1 - Math.abs(c - 0.22) * 7), 2);
          const k = Math.min(1, thump);
          for (let i = 0, j = 0; i < n; i++) {
            arr[j++] = bR * 0.08 + ar * k;
            arr[j++] = bG * 0.08 + ag * k;
            arr[j++] = bB * 0.08 + ab * k;
          }
          break;
        }
        case 'checker': { // rotating blocks of A/B
          const shift = Math.floor(t);
          for (let i = 0, j = 0; i < n; i++) {
            const k = (Math.floor(ang[i] * 24) + Math.floor(pos[i * 3 + 1] * 0.9) + shift) % 2;
            arr[j++] = k ? ar : bR; arr[j++] = k ? ag : bG; arr[j++] = k ? ab : bB;
          }
          break;
        }
        case 'psolid': case 'pblink': case 'pfade': case 'pstrobe':
        case 'ppulseo': case 'ppulsec': case 'ptwinkle': {
          const pc = g.palCol;
          const B = br * 1.55;                    // lit palette orbs clear the bloom gate
          if (mode === 'psolid') {
            for (let j = 0; j < n * 3; j++) arr[j] = pc[j] * B;
          } else if (mode === 'pblink') {
            // whole crowd blinks together on an irregular clock
            const k = Math.floor(t * 2.6);
            const h = Math.abs((Math.sin(k * 127.1) * 43758.5453) % 1);
            const e = (h > 0.42 ? 1 : 0.03) * B;
            for (let j = 0; j < n * 3; j++) arr[j] = pc[j] * e;
          } else if (mode === 'pfade') {
            const e = (0.5 - 0.5 * Math.cos(t * 1.7)) * B;
            for (let j = 0; j < n * 3; j++) arr[j] = pc[j] * e;
          } else if (mode === 'pstrobe') {
            const e = ((t * 3.2) % 1) < 0.18 ? 1.25 * B : 0;
            for (let j = 0; j < n * 3; j++) arr[j] = pc[j] * e;
          } else if (mode === 'ppulseo' || mode === 'ppulsec') {
            // one gaussian ring sweeping the whole arena, out or in
            let front = (t * 0.45) % 1;
            if (mode === 'ppulsec') front = 1 - front;
            const inv = 1 / this._maxD;
            for (let i = 0, j = 0; i < n; i++) {
              const dd = dist[i] * inv - front;
              const e = (Math.exp(-dd * dd * 42) + 0.05) * B;
              arr[j] = pc[j] * e; j++;
              arr[j] = pc[j] * e; j++;
              arr[j] = pc[j] * e; j++;
            }
          } else {                                // ptwinkle: sparse starfield
            for (let i = 0, j = 0; i < n; i++) {
              const ph = phase[i];
              const v = Math.sin(t * 2.1 + ph * 7.3) * Math.sin(t * 0.97 + ph * 13.7);
              let e = (v - 0.55) / 0.4;
              e = e <= 0 ? 0 : e >= 1 ? 1 : e * e * (3 - 2 * e);
              e = (e + 0.012) * B;
              arr[j] = pc[j] * e; j++;
              arr[j] = pc[j] * e; j++;
              arr[j] = pc[j] * e; j++;
            }
          }
          break;
        }
        case 'video': {
          const map = g.videoMap;
          if (pixels && map) {
            for (let i = 0, j = 0; i < n; i++, j += 3) {
              const u = map[i * 2];
              // -1 marks a seat outside an aimed view: it stays dark
              if (u < -0.5) { arr[j] = 0; arr[j + 1] = 0; arr[j + 2] = 0; continue; }
              const v = 1 - map[i * 2 + 1];
              const px = Math.min(pw - 1, Math.max(0, Math.floor(u * pw)));
              const py = Math.min(ph - 1, Math.max(0, Math.floor(v * ph)));
              const p = (py * pw + px) * 4;
              arr[j] = lut[pixels[p]];
              arr[j + 1] = lut[pixels[p + 1]];
              arr[j + 2] = lut[pixels[p + 2]];
            }
          } else {
            arr.fill(0);
          }
          break;
        }
        default: { // k-blend family: wave / sweep / rise / sparkle / sections
          for (let i = 0, j = 0; i < n; i++) {
            let k;
            if (mode === 'wave') k = 0.5 + 0.5 * Math.sin(dist[i] * 0.32 - t * 2.6);
            else if (mode === 'sweep') k = 0.5 + 0.5 * Math.sin(ang[i] * Math.PI * 6 + t * 2.4);
            else if (mode === 'rise') k = 0.5 + 0.5 * Math.sin(pos[i * 3 + 1] * 0.55 - t * 2.2);
            else if (mode === 'sections') k = (Math.floor(ang[i] * 20) + Math.floor(t)) % 2;
            else { // sparkle: twinkles of A on black
              const s = Math.sin(t * 3.5 + phase[i]);
              const kk = s > 0 ? Math.pow(s, 14) : 0;
              arr[j++] = ar * kk; arr[j++] = ag * kk; arr[j++] = ab * kk;
              continue;
            }
            arr[j++] = bR + (ar - bR) * k;
            arr[j++] = bG + (ag - bG) * k;
            arr[j++] = bB + (ab - bB) * k;
          }
        }
      }
      g.mesh.instanceColor.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------
// FasciaFX — the LED ribbon rings under each tier.
// Modes: ads · solid · chase · pulse · rainbow · wave
// ---------------------------------------------------------------------------
export class FasciaFX {
  constructor(fascias) { // [{ mesh, adsTex, tiles }]
    this.f = fascias;
    this.mode = 'ads';
    this.colorA = new THREE.Color(0xc49632);
    this.colorB = new THREE.Color(0x0f1e48);
    this.speed = 1;
    this.t = 0;
    this.videoTex = null;
    this.gain = 1;   // how bright the boards are drawn, over every mode (the panel's screen glow)
    this.grand = 1;  // and the trigger's fade line over that (main.js)
    this._grandShown = 1;

    const c = document.createElement('canvas');
    c.width = 512; c.height = 32;
    this._ctx = c.getContext('2d');
    this._base = new THREE.CanvasTexture(c);
    this._base.colorSpace = THREE.SRGBColorSpace;
    this._base.wrapS = THREE.RepeatWrapping;
    this._stripes = makeFasciaStripes();
    this._sparkle = makeFasciaSparkle();
    // Rings differ in perimeter so each needs its OWN repeat, and a texture
    // carries only one — every ring gets a cheap clone sharing the same image.
    this._perRing = fascias.map(() => ({}));
  }

  _forRing(src, i, scale) {
    const cache = this._perRing[i];
    const key = src.uuid + ':' + scale;
    if (!cache[key]) {
      const c = src.clone();
      c.needsUpdate = true;
      c.wrapS = THREE.RepeatWrapping;
      c.repeat.set(Math.max(1, Math.round((this.f[i].tiles || 5) * scale)), 1);
      cache[key] = c;
    }
    return cache[key];
  }

  _paintBase(paint) {
    paint(this._ctx);
    this._base.needsUpdate = true;
  }

  set(opts) {
    Object.assign(this, opts);
    const A = '#' + this.colorA.getHexString(), B = '#' + this.colorB.getHexString();
    this.f.forEach(({ mesh, adsTex }, i) => {
      const m = mesh.material;
      switch (this.mode) {
        case 'off':
          m.map = null; m.color.setScalar(0); break;
        case 'ads':
          m.map = adsTex; m.color.setScalar(1.25); break;
        case 'video':
          // One VideoTexture for all three rings — a per-ring clone would mean
          // an extra full-frame GPU upload each frame. Video is abstract enough
          // that the 30% aspect spread between rings doesn't read.
          m.map = this.videoTex || adsTex;
          m.color.setScalar(1.35); break;
        case 'stripes':
          m.map = this._forRing(this._stripes, i, 1); m.color.setScalar(1.4); break;
        case 'sparkle':
          m.map = this._forRing(this._sparkle, i, 1); m.color.setScalar(1.5); break;
        case 'chase':
          this._paintBase((ctx) => {
            for (let k = 0; k < 16; k++) { ctx.fillStyle = k % 2 ? A : B; ctx.fillRect(k * 32, 0, 32, 32); }
          });
          m.map = this._forRing(this._base, i, 1); m.color.setScalar(1.35); break;
        case 'rainbow':
          this._paintBase((ctx) => {
            const g = ctx.createLinearGradient(0, 0, 512, 0);
            for (let k = 0; k <= 6; k++) g.addColorStop(k / 6, `hsl(${(k * 60) % 360},100%,55%)`);
            ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 32);
          });
          m.map = this._forRing(this._base, i, 0.3); m.color.setScalar(1.35); break;
        case 'wave':
          this._paintBase((ctx) => {
            const g = ctx.createLinearGradient(0, 0, 512, 0);
            g.addColorStop(0, A); g.addColorStop(0.5, B); g.addColorStop(1, A);
            ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 32);
          });
          m.map = this._forRing(this._base, i, 0.5); m.color.setScalar(1.3); break;
        default:   // solid / pulse
          m.map = null; m.color.copy(this.colorA).multiplyScalar(1.4); break;
      }
      m.color.multiplyScalar(this.gain);
      m.userData.base = m.color.clone();
      m.color.multiplyScalar(this.grand);
      m.needsUpdate = true;
    });
  }

  update(dt) {
    this.t += dt * this.speed;
    if (this.grand !== this._grandShown) {   // a fade line moving: rescale every board from its base
      this._grandShown = this.grand;
      for (const { mesh } of this.f) { const b = mesh.material.userData.base; if (b) mesh.material.color.copy(b).multiplyScalar(this.grand); }
    }
    const scroll = ['ads', 'chase', 'rainbow', 'wave', 'stripes', 'video'].includes(this.mode);
    if (scroll) {
      for (const { mesh } of this.f) {
        if (mesh.material.map) mesh.material.map.offset.x = -this.t * 0.035;
      }
    } else if (this.mode === 'sparkle') {
      for (const { mesh } of this.f) {
        if (mesh.material.map) mesh.material.map.offset.x = -this.t * 0.12;
      }
    } else if (this.mode === 'show') {   // the show's colour, as it changes (main.js sets colorA)
      const k = 1.4 * this.gain * this.grand;
      for (const { mesh } of this.f) mesh.material.color.copy(this.colorA).multiplyScalar(k);
    } else if (this.mode === 'pulse') {
      const k = (0.25 + 1.3 * Math.abs(Math.sin(this.t * 2.2))) * this.gain * this.grand;
      for (const { mesh } of this.f) mesh.material.color.copy(this.colorA).multiplyScalar(k);
    }
  }
}
