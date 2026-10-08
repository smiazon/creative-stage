// The camera pipeline. One pass per new camera frame turns the raw feed into
// the pictures everything else uses:
//   camera    the picture, adjusted: mirror, zoom, brightness, contrast...
//   tracking  the picture with the hand skeletons drawn over it (only drawn
//             while something on screen is showing it)
//   shapes    the hand shapes alone, on transparent
//   output    what the wristbands and screens get: the OUTPUT BOX, a centred
//             crop of the picture (or of black, or a dimmed mix) with the
//             shapes on top. The camera feeds draw that box in green.
// Hand tracking runs in a worker (handtrack.js) on the whole picture, so a
// hand can be followed even where it falls outside the box.
// cfg.pickup false means the camera sees nobody (main.js clears it while you
// are off the X on stage): every picture goes black and tracking lets go.
import { initHandTracker } from './handtrack.js';
import { createShapeRenderer, drawSkeleton } from './shapes.js';

const FILTER_OK = typeof CanvasRenderingContext2D !== 'undefined'
  && 'filter' in CanvasRenderingContext2D.prototype;
const W = 640;    // processing width: plenty for 25k wristbands, cheap to draw
const TW = 480;   // what the tracker gets: its models work at 192-224 px, so this loses nothing

export const PICTURE_DEFAULTS = { brightness: 1, contrast: 1, saturation: 1, hue: 0, zoom: 1 };
export const HAND_DEFAULTS = {
  shape: 'fingers', edge: 'smooth', size: 1, softness: 0.5, line: 8,
  colorMode: 'solid', colorA: '#ff2f6e', colorB: '#2fb8ff', opacity: 1, skeleton: false,
};
export const BOX_DEFAULT = 0.5;   // the output box: the middle half of the picture
export const BOX_COLOR = '#d8ff3a';

// The output box over a picture shown at (x, y, w, h): outside it dimmed,
// the box itself in green, so it is plain what reaches the wristbands. `px`
// is the size of one screen pixel in the canvas being drawn on.
export function drawOutputBox(g, x, y, w, h, f, px = 1) {
  const bw = w * f, bh = h * f, bx = x + (w - bw) / 2, by = y + (h - bh) / 2;
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.42)';
  g.fillRect(x, y, w, by - y);
  g.fillRect(x, by + bh, w, y + h - by - bh);
  g.fillRect(x, by, bx - x, bh);
  g.fillRect(bx + bw, by, x + w - bx - bw, bh);
  g.strokeStyle = BOX_COLOR;
  g.lineWidth = 2 * px;
  g.strokeRect(bx + px, by + px, bw - 2 * px, bh - 2 * px);
  if (bw > 110 * px) {
    g.fillStyle = BOX_COLOR;
    g.font = `800 ${Math.round(8.5 * px)}px -apple-system, system-ui, sans-serif`;
    g.fillText('OUTPUT', bx + 6 * px, by + 13 * px);
  }
  g.restore();
}

export function initCamPipeline({ video, onFrame } = {}) {
  let H = 360, TH = 270;
  const make = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const canvases = { camera: make(W, H), tracking: make(W, H), shapes: make(W, H), output: make(W, H) };
  const ctx = {};
  for (const k of Object.keys(canvases)) ctx[k] = canvases[k].getContext('2d');
  // What the tracker looks at: the same framing as the picture (mirror and
  // zoom, so its points land on every canvas as they are) but none of the
  // colour work. The model knows natural skin; a green hue is art, not input.
  const trackIn = make(TW, TH);
  const tctx = trackIn.getContext('2d');
  canvases.output._frameSeq = 0;   // OrbFX resamples only when this moves

  const cfg = {
    mirror: true,
    picture: { ...PICTURE_DEFAULTS },
    hands: { ...HAND_DEFAULTS },
    blackout: false,   // keep the shapes and tracking, drop the camera picture
    mix: 1,            // how much camera picture sits under the shapes
    box: BOX_DEFAULT,  // output box size, as a share of the picture's width and height
    pickup: true,      // false: nobody in front of the camera, so nothing goes out
  };
  const api = { onTrackerStatus: null };
  const tracker = initHandTracker({ onStatus: (s) => api.onTrackerStatus?.(s) });
  const shapes = createShapeRenderer();
  // on-screen views say when they show the tracking picture; it is only drawn then
  const wantAt = { tracking: 0 };

  let running = false;
  let dark = false;   // blanked for want of anyone to pick up
  let frameNo = 0;
  let lastSeq = -1, lastTime = -1, lastT = performance.now();

  // the canvases follow the camera's shape (16:9, 4:3...)
  function fitToCamera() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const h = Math.max(2, Math.round((W * vh) / vw / 2) * 2);
    if (h === H) return;
    H = h;
    TH = Math.max(2, Math.round((TW * vh) / vw / 2) * 2);
    for (const c of Object.values(canvases)) { c.width = W; c.height = H; }
    trackIn.width = TW; trackIn.height = TH;
  }
  const pictureFilter = () => {
    const p = cfg.picture;
    if (p.brightness === 1 && p.contrast === 1 && p.saturation === 1 && p.hue === 0) return 'none';
    return `brightness(${p.brightness}) contrast(${p.contrast}) saturate(${p.saturation}) hue-rotate(${p.hue}deg)`;
  };
  const clear = (c) => { c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, c.canvas.width, c.canvas.height); };
  // the output box in picture pixels: centred, the same shape as the picture
  function boxRect() {
    const f = Math.min(1, Math.max(0.2, Number(cfg.box) || 1));
    const w = W * f, h = H * f;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h, f };
  }

  // every picture to black (the shapes to clear), once, for everyone to pick up
  function blank() {
    for (const k of Object.keys(ctx)) {
      clear(ctx[k]);
      if (k !== 'shapes') { ctx[k].fillStyle = '#000'; ctx[k].fillRect(0, 0, W, H); }
    }
    canvases.output._frameSeq++;
    frameNo++;
  }

  function process() {
    fitToCamera();
    if (!cfg.pickup) {
      // nobody on the mark: the camera sees an empty spot. Black once, let the
      // hands go, and do nothing more until someone steps back on.
      if (!dark) { dark = true; tracker.reset(); blank(); onFrame?.(); }
      lastT = performance.now();
      return;
    }
    dark = false;
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const vw = video.videoWidth, vh = video.videoHeight;
    // zoom crops the middle, mirror flips it like a selfie
    const z = Math.max(1, cfg.picture.zoom);
    const sw = vw / z, sh = vh / z;
    const frame = (c, w, h, filter) => {
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      if (FILTER_OK) c.filter = filter;
      if (cfg.mirror) { c.translate(w, 0); c.scale(-1, 1); }
      c.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, w, h);
      c.restore();
    };

    // 1. the picture
    frame(ctx.camera, W, H, pictureFilter());

    // 2. hands: offer this frame to the tracker (it takes it the moment it is
    // free), then ease the hands toward its latest answer
    const tracking = tracker.enabled;
    if (tracking) {
      frame(tctx, TW, TH, 'none');
      tracker.offer(trackIn, frameNo);
      tracker.step(dt);
    }

    // 3. the shapes alone
    clear(ctx.shapes);
    if (tracking) shapes.draw(ctx.shapes, tracker.hands, cfg.hands, now / 1000);

    // 4. the tracking view, only while something is showing it
    if (now - wantAt.tracking < 700) {
      ctx.tracking.drawImage(canvases.camera, 0, 0);
      if (tracking) drawSkeleton(ctx.tracking, tracker.hands, W, H);
    }

    // 5. the output: the box's part of the picture (or black), shapes on top
    const out = ctx.output;
    const b = boxRect();
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalAlpha = 1;
    out.fillStyle = '#000';
    out.fillRect(0, 0, W, H);
    if (!cfg.blackout && cfg.mix > 0.001) {
      out.globalAlpha = Math.min(1, cfg.mix);
      out.drawImage(canvases.camera, b.x, b.y, b.w, b.h, 0, 0, W, H);
      out.globalAlpha = 1;
    }
    if (tracking) {
      out.drawImage(canvases.shapes, b.x, b.y, b.w, b.h, 0, 0, W, H);
      if (cfg.hands.skeleton) {
        out.setTransform(W / b.w, 0, 0, H / b.h, (-b.x * W) / b.w, (-b.y * H) / b.h);
        drawSkeleton(out, tracker.hands, W, H);
        out.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    canvases.output._frameSeq++;
    frameNo++;
    onFrame?.();
  }

  // Driven from the display loop, but only does work when the camera has a
  // new frame (the camera module counts them; without its counter, watch the
  // video clock instead).
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    if (video.readyState < 2 || !video.videoWidth) return;
    const seq = video._frameSeq;
    if (seq !== undefined) {
      if (seq === lastSeq) return;
      lastSeq = seq;
    } else {
      const t = video.currentTime;
      if (t === lastTime) return;
      lastTime = t;
    }
    process();
  }
  function start() {
    if (running) return;
    running = true;
    lastSeq = -1; lastTime = -1; lastT = performance.now();
    requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    dark = false;
    blank();
  }

  // Object.assign would copy getters' values once and freeze them, so the
  // live ones go on with defineProperties
  Object.assign(api, {
    canvases, cfg, tracker, start, stop, boxRect, FILTER_OK,
    want: (name) => { wantAt[name] = performance.now(); },
  });
  Object.defineProperties(api, {
    running: { get: () => running },
    frame: { get: () => frameNo },
    width: { get: () => W },
    height: { get: () => H },
  });
  return api;
}
