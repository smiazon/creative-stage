// Hand tracking, main-thread side. Owns the worker (handworker.js) and keeps
// it busy: the pipeline offers every camera frame, one is in flight at a time,
// and the moment an answer comes back the newest frame goes straight out, so
// the tracker never sits waiting for the next camera tick. It keeps a smoothed
// copy of every hand for the shapes: hands ease toward each answer and glide
// a little ahead on their own speed between answers, fade in when they appear
// and out when they leave, and trail the index fingertip.

// MediaPipe's 21 landmarks: 0 wrist, then four per finger from the knuckle
// out. The tips are 4 (thumb), 8, 12, 16 and 20 (little finger).
export const TIPS = [4, 8, 12, 16, 20];
export const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const TRAIL_SECONDS = 1.2;
const LEAD = 0.07;        // seconds of speed to glide ahead between answers, at most
const MAX_SPEED = 4;      // picture widths per second: faster than this is a jump, not motion

export function initHandTracker({ onStatus } = {}) {
  let worker = null;
  let enabled = false;
  let ready = false;
  let busy = false;
  let busySince = 0;
  let frameId = 0;
  let pending = null, pendingNo = -1, sentNo = -1;   // the newest offered frame, and the last one sent
  let resetAt = 0;    // answers to frames sent before a reset are stale
  let firstResult = false;
  let smoothing = 0.5;
  let lastReply = 0;
  const replyTimes = [];
  const st = { state: 'off', delegate: '', ms: 0, fps: 0, count: 0, error: '' };
  // side ('Left' | 'Right') -> { side, pts, target, alpha, present, trail }
  const hands = new Map();

  const status = (patch) => { Object.assign(st, patch); onStatus?.(st); };

  function ensureWorker() {
    if (worker) return;
    try {
      worker = new Worker(new URL('./handworker.js', import.meta.url));
    } catch (err) {
      status({ state: 'error', error: String(err?.message || err) });
      return;
    }
    worker.onmessage = onMessage;
    worker.onerror = (e) => {
      busy = false;
      status({ state: 'error', error: e.message || 'The hand tracker stopped.' });
    };
    status({ state: 'loading', error: '' });
    worker.postMessage({ type: 'init' });
  }

  function onMessage(e) {
    const m = e.data || {};
    if (m.type === 'ready') {
      ready = true;
      status({ state: firstResult ? 'tracking' : 'warming', delegate: m.delegate, error: '' });
      pump();
    } else if (m.type === 'error') {
      status({ state: 'error', error: m.message });
    } else if (m.type === 'hands') {
      busy = false;
      if (!enabled) return;
      if (m.id <= resetAt) { pump(); return; }   // from before a reset: those hands are gone
      firstResult = true;
      const now = performance.now();
      lastReply = now;
      replyTimes.push(now);
      while (replyTimes.length > 20) replyTimes.shift();
      const fps = replyTimes.length > 1 ? ((replyTimes.length - 1) * 1000) / (now - replyTimes[0]) : 0;
      ingest(m.hands || [], now);
      status({ state: 'tracking', ms: m.ms || 0, fps, count: (m.hands || []).length });
      pump();   // a newer frame came in while the tracker worked: send it now
    }
  }

  function ingest(list, now) {
    const seen = new Set();
    for (const h of list) {
      let side = h.side === 'Left' ? 'Left' : 'Right';
      if (seen.has(side)) side = side === 'Left' ? 'Right' : 'Left';   // two alike: the second is the other hand
      seen.add(side);
      let rec = hands.get(side);
      if (!rec) {
        rec = { side, pts: Float32Array.from(h.pts), target: h.pts, vel: new Float32Array(h.pts.length), at: now, alpha: 0, present: false, trail: [] };
        hands.set(side, rec);
      }
      // speed per landmark from the last two answers; a hand that was gone,
      // or a jump too fast to be motion, starts from rest
      const dts = (now - rec.at) / 1000;
      if (rec.present && dts > 0.005 && dts < 0.5) {
        let fast = false;
        for (let i = 0; i < h.pts.length; i++) {
          const v = (h.pts[i] - rec.target[i]) / dts;
          if (Math.abs(v) > MAX_SPEED) fast = true;
          rec.vel[i] = v;
        }
        if (fast) rec.vel.fill(0);
      } else {
        rec.vel.fill(0);
      }
      rec.target = h.pts;
      rec.at = now;
      rec.present = true;
    }
    for (const [side, rec] of hands) if (!seen.has(side)) rec.present = false;
  }

  // Once per processed camera frame: ease toward the latest landmarks, fade
  // hands in and out, and grow or shrink the trails.
  function step(dt) {
    const now = performance.now();
    // the tracker went quiet (camera paused, tab hidden): let the hands go
    if (lastReply && now - lastReply > 600) for (const rec of hands.values()) rec.present = false;
    // a frame that never came back (worker restarted) must not stall tracking
    if (busy && now - busySince > 2000) busy = false;
    const follow = 1 - Math.pow(Math.min(0.95, smoothing), Math.max(0.25, dt * 30));
    for (const [side, rec] of hands) {
      if (rec.present) {
        const p = rec.pts, t = rec.target, v = rec.vel;
        const lead = Math.min(LEAD, (now - rec.at) / 1000);   // glide on the hand's own speed
        for (let i = 0; i < p.length; i++) p[i] += (t[i] + v[i] * lead - p[i]) * follow;
        rec.alpha = Math.min(1, rec.alpha + dt * 8);
        rec.trail.push({ x: p[24], y: p[25], t: now });   // landmark 8, the index fingertip
      } else {
        rec.alpha = Math.max(0, rec.alpha - dt * 4);
      }
      while (rec.trail.length && now - rec.trail[0].t > TRAIL_SECONDS * 1000) rec.trail.shift();
      if (rec.alpha <= 0 && !rec.present && !rec.trail.length) hands.delete(side);
    }
  }

  // The pipeline offers every frame; only the newest one matters. It goes out
  // at once if the tracker is free, else the moment the answer comes back.
  function offer(source, no) {
    pending = source;
    pendingNo = no;
    pump();
  }
  async function pump() {
    if (!enabled || !ready || busy || !worker || !pending || pendingNo === sentNo) return;
    busy = true;
    busySince = performance.now();
    sentNo = pendingNo;
    try {
      const bitmap = await createImageBitmap(pending);   // a snapshot: the canvas can move on
      worker.postMessage({ type: 'frame', id: ++frameId, ts: performance.now(), bitmap }, [bitmap]);
    } catch (_) {
      busy = false;
    }
  }

  // Let go of every hand at once: the camera stopped seeing anyone. Answers
  // still on their way are dropped, and the status says no hands.
  function reset() {
    hands.clear();
    resetAt = frameId;
    lastReply = 0;
    replyTimes.length = 0;
    pending = null;
    if (enabled) status({ count: 0, fps: 0 });
  }

  function setEnabled(on) {
    enabled = !!on;
    if (enabled) {
      ensureWorker();
      if (ready) status({ state: firstResult ? 'tracking' : 'warming', count: 0 });
      pump();
    } else {
      hands.clear();
      busy = false;
      replyTimes.length = 0;
      status({ state: 'off', count: 0, fps: 0 });
    }
  }

  return {
    offer, step, reset, setEnabled, hands, status: st,
    get enabled() { return enabled; },
    get smoothing() { return smoothing; },
    set smoothing(v) { smoothing = Math.max(0, Math.min(0.95, Number(v) || 0)); },
    TRAIL_SECONDS,
  };
}
