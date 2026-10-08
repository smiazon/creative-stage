// The song's beat, found from its audio: how fast (BPM) and where the first
// beat lands. The showreel uses it to change effects on the beat, and on the
// bar where it can.
//
//   const b = songBeats(buffer)   -> { bpm, period (s), offset (s) } or null
//   reelCuts(n, showLen, songFrom, b) -> the n turns' start times in the video
const cache = new WeakMap();
const HOP = 512;

export function songBeats(buffer) {
  if (!buffer) return null;
  if (cache.has(buffer)) return cache.get(buffer);
  const sr = buffer.sampleRate, len = buffer.length, chans = buffer.numberOfChannels;
  const frames = Math.floor(len / HOP);
  if (frames < 64) { cache.set(buffer, null); return null; }
  // loudness in each hop (mono, bass-leaning by a one-pole low-pass, where kicks live)
  const ch = []; for (let c = 0; c < chans; c++) ch.push(buffer.getChannelData(c));
  const lowA = Math.exp((-2 * Math.PI * 180) / sr);
  const eLow = new Float32Array(frames), eAll = new Float32Array(frames);
  let lp = 0;
  for (let f = 0; f < frames; f++) {
    let sl = 0, sa = 0;
    for (let i = f * HOP, end = i + HOP; i < end; i++) {
      let x = 0; for (let c = 0; c < chans; c++) x += ch[c][i];
      x /= chans;
      lp = lowA * lp + (1 - lowA) * x;
      sl += lp * lp; sa += x * x;
    }
    eLow[f] = Math.log1p(sl * 100); eAll[f] = Math.log1p(sa * 100);
  }
  // onset strength: how much louder each hop is than the last
  const on = new Float32Array(frames);
  for (let f = 1; f < frames; f++) on[f] = Math.max(0, eLow[f] - eLow[f - 1]) * 2 + Math.max(0, eAll[f] - eAll[f - 1]);
  let mean = 0; for (const v of on) mean += v; mean /= frames;
  for (let f = 0; f < frames; f++) on[f] = Math.max(0, on[f] - mean);
  // the tempo: the lag the onsets repeat at best, 70–180 BPM, leaning to ~120
  const fps = sr / HOP;
  const lagMin = Math.floor((fps * 60) / 180), lagMax = Math.ceil((fps * 60) / 70);
  let best = 0, bestLag = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    for (let f = lag; f < frames; f++) s += on[f] * on[f - lag];
    const bpm = (fps * 60) / lag, w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    s *= w;
    if (s > best) { best = s; bestLag = lag; }
  }
  if (!best) { cache.set(buffer, null); return null; }
  // refine: the period (within 3%) and phase whose comb of beats catches the
  // most onset over the whole song, so the beat stays locked to the end
  const at = (x) => { const i = Math.floor(x), f = x - i; return i + 1 < frames ? on[i] * (1 - f) + on[i + 1] * f : 0; };
  let lag = bestLag, bestP = 0, bestS = -1;
  for (let r = -30; r <= 30; r++) {
    const L = bestLag * (1 + r / 1000), steps = Math.ceil(L * 2);
    for (let k = 0; k < steps; k++) {
      const ph = (k / steps) * L;
      let s = 0;
      for (let x = ph; x < frames - 1; x += L) s += at(x) + 0.5 * (at(x - 0.5) + at(x + 0.5));
      if (s > bestS) { bestS = s; bestP = ph; lag = L; }
    }
  }
  const period = lag / fps;
  // the downbeat: of the four beats in a bar, the one that hits hardest
  const bar = [0, 0, 0, 0];
  let n = 0;
  for (let x = bestP; x < frames; x += lag, n++) { const i = Math.round(x); if (i < frames) bar[n % 4] += eLow[i]; }
  const down = bar.indexOf(Math.max(...bar));
  const out = { bpm: 60 / period, period, offset: (bestP + down * lag) / fps };
  cache.set(buffer, out);
  return out;
}

// When each of the showreel's n effects starts, in seconds of the video. With
// a beat, each change lands on a bar line (a beat if bars are too long for
// the share); without one, the turns are equal shares.
export function reelCuts(n, showLen, songFrom, beats) {
  const cuts = [0];
  for (let k = 1; k < n; k++) {
    const want = (k / n) * showLen;
    if (!beats || songFrom == null) { cuts.push(want); continue; }
    const { period, offset } = beats, share = showLen / n;
    const unit = share >= period * 8 ? period * 4 : period;   // whole bars when each turn holds two or more
    const s = songFrom + want, grid = Math.round((s - offset) / unit) * unit + offset - songFrom;
    // stay in order and keep each turn at least a beat long
    cuts.push(Math.min(showLen - period, Math.max(cuts[k - 1] + period, grid)));
  }
  return cuts;
}
// whose turn it is at time t
export const reelTurn = (cuts, t) => { let k = 0; while (k + 1 < cuts.length && t >= cuts[k + 1]) k++; return k; };
