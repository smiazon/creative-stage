// Song structure from the audio itself.
//
// The old detector watched LOUDNESS, which is close to the wrong feature: a
// modern master is compressed so hard that a verse and a chorus often sit
// within a decibel of each other. What actually separates them is TIMBRE (what
// instruments are playing) and REPETITION (a chorus is the part that comes
// round again). This module measures both.
//
//   1. STFT -> 24 log-spaced bands per frame     = a timbre fingerprint
//   2. pool to half-second bins                  = ~500 bins for a 4-min song
//   3. self-similarity matrix over those bins    = where does this sound like that
//   4. Foote checkerboard novelty on its diagonal = boundaries
//   5. cluster the segments by fingerprint        = which parts are the SAME part
//   6. name the clusters from repetition + level  = chorus / verse / drop / ...
//
// Everything is plain arithmetic on the decoded buffer: no dependency, no
// network, ~200ms for a four-minute track. Loudness still decides how big a
// look to reach for, but it no longer decides where the parts are.

// --- FFT: iterative radix-2, in place, no allocation per call -----------------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {           // bit-reversal permutation
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k], ui = im[i + k];
        const jr = re[i + k + half], ji = im[i + k + half];
        const vr = jr * cr - ji * ci, vi = jr * ci + ji * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + half] = ur - vr; im[i + k + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const N = 2048;            // ~46ms at 44.1k: long enough to resolve bass bands
const BANDS = 24;          // log-spaced, 40Hz..11kHz — enough to tell a guitar
                           // from a synth pad without chasing individual notes

// --- 1+2. timbre fingerprint per half-second bin ------------------------------
function fingerprint(buffer, binSec) {
  const rate = buffer.sampleRate;
  const len = buffer.length;
  const ch = Math.min(2, buffer.numberOfChannels);
  const data = [];
  for (let c = 0; c < ch; c++) data.push(buffer.getChannelData(c));

  // band edges, log-spaced across the range that carries instrument identity
  const fMax = Math.min(11000, rate / 2);
  const edges = new Float32Array(BANDS + 1);
  for (let b = 0; b <= BANDS; b++) edges[b] = 40 * Math.pow(fMax / 40, b / BANDS);
  const binOf = new Int16Array(N / 2);
  for (let k = 0; k < N / 2; k++) {
    const f = (k * rate) / N;
    let b = -1;
    for (let e = 0; e < BANDS; e++) if (f >= edges[e] && f < edges[e + 1]) { b = e; break; }
    binOf[k] = b;
  }
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));

  const framesPerBin = Math.max(1, Math.round((binSec * rate) / N));
  const bins = Math.floor(len / (framesPerBin * N));
  if (bins < 8) return null;
  const feat = new Float32Array(bins * BANDS);
  const loud = new Float32Array(bins);
  const re = new Float32Array(N), im = new Float32Array(N);
  const acc = new Float32Array(BANDS);

  for (let bi = 0; bi < bins; bi++) {
    acc.fill(0);
    let energy = 0;
    for (let f = 0; f < framesPerBin; f++) {
      const off = (bi * framesPerBin + f) * N;
      im.fill(0);
      for (let i = 0; i < N; i++) {
        let v = 0;
        for (let c = 0; c < ch; c++) v += data[c][off + i] || 0;
        v /= ch;
        energy += v * v;
        re[i] = v * win[i];
      }
      fft(re, im);
      for (let k = 1; k < N / 2; k++) {
        const b = binOf[k];
        if (b >= 0) acc[b] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      }
    }
    loud[bi] = Math.sqrt(energy / (framesPerBin * N));
    // log compression, then unit-normalise: the fingerprint must describe the
    // BALANCE of the spectrum, not how loud it happens to be, or a compressed
    // master collapses every part into the same vector
    let norm = 0;
    for (let b = 0; b < BANDS; b++) { const v = Math.log(1 + acc[b]); acc[b] = v; norm += v * v; }
    norm = Math.sqrt(norm) || 1;
    for (let b = 0; b < BANDS; b++) feat[bi * BANDS + b] = acc[b] / norm;
  }
  // MEAN-CENTRE, then re-normalise. Measured on a real track, raw cosine
  // similarity between any two parts ran 0.87..1.00 with a median of 0.997 —
  // every part of every song looks identical, because they are all "music with
  // bass and drums". Subtracting the song's average spectrum leaves what makes
  // each part different, and the same measurement spreads to a median of 0.37.
  const avg = new Float32Array(BANDS);
  for (let bi = 0; bi < bins; bi++) for (let b = 0; b < BANDS; b++) avg[b] += feat[bi * BANDS + b] / bins;
  for (let bi = 0; bi < bins; bi++) {
    let norm = 0;
    for (let b = 0; b < BANDS; b++) { const v = feat[bi * BANDS + b] - avg[b]; feat[bi * BANDS + b] = v; norm += v * v; }
    norm = Math.sqrt(norm) || 1;
    for (let b = 0; b < BANDS; b++) feat[bi * BANDS + b] /= norm;
  }
  return { bins, feat, loud, binSec: (framesPerBin * N) / rate };
}

const dot = (feat, i, j) => {
  let s = 0;
  for (let b = 0; b < BANDS; b++) s += feat[i * BANDS + b] * feat[j * BANDS + b];
  return s;
};

// --- 3+4. novelty: where does the sound stop resembling itself ----------------
// Foote's checkerboard kernel slid down the diagonal of the similarity matrix.
// It answers "is the stuff before here unlike the stuff after here", which is
// exactly a section boundary, and it does not care about absolute level.
function novelty(feat, bins, K) {
  const half = K >> 1;
  const ker = new Float32Array(K * K);
  for (let a = 0; a < K; a++) {
    for (let b = 0; b < K; b++) {
      const da = (a - half + 0.5) / half, db = (b - half + 0.5) / half;
      const taper = Math.exp(-2 * (da * da + db * db));     // soften the corners
      const sign = (a < half) === (b < half) ? 1 : -1;      // self vs cross quadrant
      ker[a * K + b] = sign * taper;
    }
  }
  const nov = new Float32Array(bins);
  for (let i = half; i < bins - half; i++) {
    let s = 0;
    for (let a = 0; a < K; a++) {
      const ia = i - half + a;
      for (let b = 0; b < K; b++) s += dot(feat, ia, i - half + b) * ker[a * K + b];
    }
    nov[i] = s;
  }
  return nov;
}

// Returns the cut list INCLUDING the implicit 0, so the minimum-section rule
// applies to the first section too — seeding [0] afterwards let a peak land 7s
// into an 11s minimum.
function peaks(nov, bins, minGap, maxCuts) {
  let mean = 0, n = 0;
  for (let i = 0; i < bins; i++) if (nov[i] !== 0) { mean += nov[i]; n++; }
  mean /= Math.max(1, n);
  let sd = 0;
  for (let i = 0; i < bins; i++) if (nov[i] !== 0) sd += (nov[i] - mean) ** 2;
  sd = Math.sqrt(sd / Math.max(1, n)) || 1;

  const cand = [];
  for (let i = 1; i < bins - 1; i++) {
    if (nov[i] <= nov[i - 1] || nov[i] < nov[i + 1]) continue;   // local max only
    if (nov[i] < mean + 0.35 * sd) continue;
    if (bins - i < minGap) continue;                            // no sliver at the end
    cand.push({ i, v: nov[i] });
  }
  // strongest first, and never two boundaries inside one section's minimum
  cand.sort((a, b) => b.v - a.v);
  const kept = [0];
  for (const c of cand) {
    if (kept.length > maxCuts) break;
    if (kept.every((k) => Math.abs(k - c.i) >= minGap)) kept.push(c.i);
  }
  kept.sort((a, b) => a - b);
  return kept;
}

// --- 5. which segments are the SAME part coming round again -------------------
function cluster(segFeat, count) {
  // The link threshold comes from THIS song's spread, not a constant: take the
  // 80th percentile of observed pair similarity, so roughly the most-alike
  // fifth of pairs count as "the same part" whatever the material.
  const sims = [];
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      let s2 = 0;
      for (let b = 0; b < BANDS; b++) s2 += segFeat[i * BANDS + b] * segFeat[j * BANDS + b];
      sims.push(s2);
    }
  }
  sims.sort((a, b) => a - b);
  const thresh = sims.length
    ? Math.max(0.55, Math.min(0.95, sims[Math.floor(sims.length * 0.8)]))
    : 0.8;
  const part = new Int16Array(count).fill(-1);
  let next = 0;
  for (let i = 0; i < count; i++) {
    if (part[i] >= 0) continue;
    part[i] = next;
    for (let j = i + 1; j < count; j++) {
      if (part[j] >= 0) continue;
      let s = 0;
      for (let b = 0; b < BANDS; b++) s += segFeat[i * BANDS + b] * segFeat[j * BANDS + b];
      if (s >= thresh) part[j] = next;
    }
    next++;
  }
  return { part, parts: next };
}

// --- the whole pipeline -------------------------------------------------------
export function songMap(buffer, { minSec = 11, maxSections = 14 } = {}) {
  const fp = fingerprint(buffer, 0.5);
  if (!fp) return [];
  const { bins, feat, loud, binSec } = fp;

  const minGap = Math.max(2, Math.round(minSec / binSec));
  // ~8s of context either side of a candidate boundary: shorter and every fill
  // is a section, longer and a short bridge disappears
  const K = Math.max(8, Math.min(48, Math.round(8 / binSec)) & ~1);
  const cuts = peaks(novelty(feat, bins, K), bins, minGap, maxSections - 1);

  // per-segment mean fingerprint and level
  const count = cuts.length;
  const segFeat = new Float32Array(count * BANDS);
  const segLoud = new Float32Array(count);
  const rise = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    const a = cuts[k], b = k + 1 < count ? cuts[k + 1] : bins;
    let norm = 0, lo = 0;
    for (let i = a; i < b; i++) {
      for (let d = 0; d < BANDS; d++) segFeat[k * BANDS + d] += feat[i * BANDS + d];
      lo += loud[i];
    }
    for (let d = 0; d < BANDS; d++) norm += segFeat[k * BANDS + d] ** 2;
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < BANDS; d++) segFeat[k * BANDS + d] /= norm;
    segLoud[k] = lo / Math.max(1, b - a);
    const third = Math.max(1, Math.round((b - a) / 3));
    let head = 0, tail = 0;
    for (let i = a; i < a + third; i++) head += loud[i];
    for (let i = b - third; i < b; i++) tail += loud[i];
    rise[k] = tail / third - head / third;
  }

  // centre the SEGMENT vectors across segments too, for the same reason the
  // bins were centred: otherwise every segment scores ~1.0 against every other
  {
    const m2 = new Float32Array(BANDS);
    for (let k = 0; k < count; k++) for (let b = 0; b < BANDS; b++) m2[b] += segFeat[k * BANDS + b] / count;
    for (let k = 0; k < count; k++) {
      let nn = 0;
      for (let b = 0; b < BANDS; b++) { const v = segFeat[k * BANDS + b] - m2[b]; segFeat[k * BANDS + b] = v; nn += v * v; }
      nn = Math.sqrt(nn) || 1;
      for (let b = 0; b < BANDS; b++) segFeat[k * BANDS + b] /= nn;
    }
  }

  // level relative to this song's own range, so a quiet mix is judged on its
  // own terms rather than against an absolute threshold
  let lo = Infinity, hi = 0;
  for (const v of segLoud) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = Math.max(1e-9, hi - lo);
  const rel = Array.from(segLoud, (v) => (v - lo) / span);
  const riseRel = Array.from(rise, (v) => v / span);

  const { part, parts } = cluster(segFeat, count);
  // how often each part recurs, and how loud it runs
  const size = new Array(parts).fill(0);
  const partLoud = new Array(parts).fill(0);
  for (let k = 0; k < count; k++) { size[part[k]]++; partLoud[part[k]] += rel[k]; }
  for (let p = 0; p < parts; p++) partLoud[p] /= size[p];

  // THE CHORUS IS THE PART THAT COMES BACK. Among the parts that recur, the one
  // that is both frequent and loud wins; that single judgement is what loudness
  // alone could never make.
  let chorusPart = -1, best = -Infinity;
  for (let p = 0; p < parts; p++) {
    if (size[p] < 2) continue;
    const score = size[p] + partLoud[p] * 2;
    if (score > best) { best = score; chorusPart = p; }
  }
  const loudestSeg = rel.indexOf(Math.max(...rel));

  return cuts.map((a, k) => {
    const b = k + 1 < count ? cuts[k + 1] : bins;
    const r = rel[k];
    let id;
    if (k === 0) id = r < 0.45 ? 'intro' : 'chorus';
    else if (k === count - 1) id = r < 0.5 ? 'outro' : 'chorus';
    else if (riseRel[k] > 0.28 && r < 0.72) id = 'build';
    else if (part[k] === chorusPart) id = k === loudestSeg && r > 0.88 ? 'drop' : 'chorus';
    else if (r > 0.9) id = 'drop';
    else if (r < 0.2) id = 'breakdown';
    else if (size[part[k]] === 1 && r > 0.3 && r < 0.75) id = 'bridge';
    else id = 'verse';
    return {
      t: a * binSec,
      len: (b - a) * binSec,
      level: r,
      id,
      trig: Math.max(0, Math.min(8, Math.round(r * 8))),
      part: part[k],            // kept for the strip: same part, same letter
    };
  });
}
