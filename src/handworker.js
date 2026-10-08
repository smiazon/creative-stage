// Hand tracking, off the main thread, so the 3D room never waits on it.
//
// A CLASSIC worker on purpose: MediaPipe's loader pulls its WASM glue in with
// importScripts(), which module workers do not have. The library itself is an
// ES module, so it comes in through a dynamic import(), which classic workers
// do support. Frames arrive as ImageBitmaps (transferred, not copied); hands
// go back as 21 landmarks each, normalised to the frame, plus which hand.
//
// It tracks on the processor first: that leaves the graphics card to the
// room, which is what keeps the frame rate up. It times itself, and only on a
// machine where the processor is slow does it try the graphics card, keeping
// it if it tracks clearly faster. Times are compared for the same number of
// hands in view, since two hands cost more than one and none costs least.
//
// The library and the model load from their CDNs the first time tracking is
// switched on, then come from the browser cache. No frames leave the machine.
const VERSION = '0.10.14';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WARMUP = 5;          // first frames after a start or a switch are slow everywhere: not timed
const SAMPLES = 16;        // timed frames before judging an engine
const SLOW_MS = 40;        // a processor slower than this per frame gets the card tried against it
const CARD_GAIN = 0.67;    // the card must take at most this share of the processor's time to win

let landmarker = null;
let delegate = '';
let loading = null;
let lastTs = 0;
let make = null;
// the timing trial: frame times per engine, bucketed by hands in view
const times = { CPU: [[], [], []], GPU: [[], [], []] };
let seen = 0, timed = 0, settled = false, switching = false;
const spare = {};          // the engine not in use, kept until the trial is settled

async function load() {
  const { FilesetResolver, HandLandmarker } = await import(`${BASE}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
  make = (d) => HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate: d },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    landmarker = await make('CPU');
    delegate = 'CPU';
  } catch (_) {
    landmarker = await make('GPU');
    delegate = 'GPU';
    settled = true;
  }
  return delegate;
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const all = (d) => times[d].flat();
function use(d) {
  if (d === delegate || !spare[d]) return;
  spare[delegate] = landmarker;
  landmarker = spare[d];
  delete spare[d];
  delegate = d;
  seen = 0;
  timed = 0;
  self.postMessage({ type: 'ready', delegate });
}
function settle(d) {
  use(d);
  settled = true;
  for (const k of Object.keys(spare)) { try { spare[k].close(); } catch (_) { /* gone */ } delete spare[k]; }
}
// the quicker engine, compared on the busiest hand count both have timed
function faster() {
  for (let n = 2; n >= 0; n--) {
    const c = times.CPU[n], g = times.GPU[n];
    if (c.length >= 5 && g.length >= 5) return median(g) < median(c) * CARD_GAIN ? 'GPU' : 'CPU';
  }
  return null;
}
// after each frame: time it, then try the card, or decide
function judge(ms, hands) {
  if (settled || switching) return;
  if (++seen <= WARMUP) return;
  const bucket = times[delegate][Math.min(2, hands)];
  bucket.push(ms);
  if (bucket.length > SAMPLES) bucket.shift();
  if (++timed < SAMPLES) return;
  if (delegate === 'CPU' && !all('GPU').length) {
    if (median(all('CPU')) <= SLOW_MS) { settle('CPU'); return; }   // the processor keeps up: done
    switching = true;
    make('GPU').then((l) => { spare.GPU = l; use('GPU'); })
      .catch(() => settle('CPU'))                                     // no WebGL here: the processor it is
      .finally(() => { switching = false; });
    return;
  }
  const pick = faster();
  if (pick) settle(pick);
  else if (timed >= SAMPLES * 3) settle(median(all('GPU')) < median(all('CPU')) * CARD_GAIN ? 'GPU' : 'CPU');
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === 'init') {
    try {
      loading = loading || load();
      await loading;
      self.postMessage({ type: 'ready', delegate });
    } catch (err) {
      loading = null;
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
    return;
  }
  if (msg.type !== 'frame') return;
  const bmp = msg.bitmap;
  if (!landmarker) {
    bmp.close();
    self.postMessage({ type: 'hands', id: msg.id, hands: [] });
    return;
  }
  // VIDEO mode tracks from frame to frame and needs rising timestamps
  const ts = Math.max(lastTs + 1, Math.round(msg.ts));
  lastTs = ts;
  const t0 = performance.now();
  let res;
  try {
    res = landmarker.detectForVideo(bmp, ts);
  } catch (err) {
    bmp.close();
    self.postMessage({ type: 'hands', id: msg.id, hands: [], error: String((err && err.message) || err) });
    return;
  }
  bmp.close();
  const ms = performance.now() - t0;
  const sides = res.handedness || res.handednesses || [];
  const hands = (res.landmarks || []).map((lm, i) => {
    const h = sides[i] && sides[i][0];
    const pts = new Float32Array(lm.length * 3);
    for (let k = 0; k < lm.length; k++) {
      pts[k * 3] = lm[k].x;
      pts[k * 3 + 1] = lm[k].y;
      pts[k * 3 + 2] = lm[k].z;
    }
    return { side: (h && h.categoryName) || 'Right', score: h ? h.score : 1, pts };
  });
  self.postMessage({ type: 'hands', id: msg.id, hands, ms },
    hands.map((h) => h.pts.buffer));
  judge(ms, hands.length);
};
