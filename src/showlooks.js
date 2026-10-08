// The show designer's looks (showdesigner.js): moving patterns for zones of
// wristbands. A look is a function of where a seat sits in its zone
//   x  along the ring, in zone heights, so shapes keep their proportions
//   y  down the zone: 0 at the back row, 1 at the front
//   t  seconds on the zone's own clock (its speed already applied)
//   s  the zone's size setting: bigger shapes, longer repeats
//   p  the seat's own random number, 0..1 (sparkle, fire, confetti)
//   L  how long the zone is, in the same units as x
// and returns how much of colour A to show over colour B, 0..1. The rainbow
// looks return a hue instead. Cheap enough to run for every seat in the
// building, 30 times a second.

const TAU = Math.PI * 2;
const frac = (v) => v - Math.floor(v);
const smooth = (e0, e1, v) => {
  let k = (v - e0) / (e1 - e0);
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  return k * k * (3 - 2 * k);
};
// 1 across the middle `duty` of every unit of v, soft at its edges
const band = (v, duty, soft) => smooth(duty + soft, duty - soft, Math.abs(frac(v) - 0.5) * 2);

// a row of shapes marching along the zone: each gets a cell `w` long and the
// zone's full height; returns the seat's place in its cell, centred
function cell(x, y, t, w, drift) {
  return [(frac(x / w - t * drift) - 0.5) * w, y - 0.5];
}
function heart(x, y, t, s) {
  const [cx, cy] = cell(x, y, t, 1.15 * s, 0.22);
  const k = 0.4 * (1 + 0.07 * Math.sin(t * 6.5));   // a gentle beat
  const X = cx / k, Y = -cy / k + 0.28;
  const a = X * X + Y * Y - 1;
  return smooth(0.06, -0.06, a * a * a - X * X * Y * Y * Y);
}
function star(x, y, t, s) {
  const [cx, cy] = cell(x, y, t, 1.15 * s, 0.18);
  const r = Math.hypot(cx, cy) / 0.47;
  const a = Math.atan2(cy, cx) + t * 1.1;             // slowly turning
  const R = 0.42 + 0.58 * Math.pow(0.5 + 0.5 * Math.cos(5 * a), 2.4);
  return smooth(R + 0.07, R - 0.07, r);
}
function fire(x, y, t, s, p) {
  const tongue = 0.5 + 0.5 * Math.sin((x * 3.1) / s + t * 2.3) * Math.sin((x * 1.7) / s - t * 1.4);
  const flick = 0.65 + 0.35 * Math.sin(t * 7.3 + p * 40) * Math.sin(t * 2.9 + x * 2.3);
  const k = (y - 0.12 - (1 - tongue) * 0.5) * 2.4 * flick;
  return k < 0 ? 0 : k > 1 ? 1 : k;
}
// a repeatable random number for any pair of numbers, 0..1
export const hash = (a, b) => frac(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);
// how far apart two places along a zone are, the short way round a ring
const ringDist = (x, c, L) => { const d = Math.abs(x - c) % L; return Math.min(d, L - d); };
// rings spreading out from two points across the zone, like stones in a pond
function ripple(x, y, t, s, p, L) {
  const len = Math.max(1, L);
  const d = Math.min(Math.hypot(ringDist(x, len * 0.25, len), (y - 0.5) * 1.4), Math.hypot(ringDist(x, len * 0.75, len), (y - 0.5) * 1.4));
  return band(d / (0.85 * s) - t * 0.9, 0.3, 0.1) * smooth(len * 0.6, len * 0.1, d);
}
// drops falling down the rows, each column at its own pace, each with a fading tail
function rain(x, y, t, s) {
  const col = Math.floor(x / (0.16 * s));
  const r = hash(col, 7.3);
  const head = frac(t * (0.35 + 0.45 * r) + r * 9.1) * 1.6 - 0.3;
  const d = head - y;
  return d < 0 || d > 0.55 ? 0 : (1 - d / 0.55) ** 2;
}
// three lanes of bright heads with long tails, racing round the ring
function comets(x, y, t, s) {
  const lane = Math.min(2, Math.floor(y * 3));
  const dir = lane === 1 ? -1 : 1;
  const u = frac((dir * x) / (2.6 * s) - t * (0.5 + lane * 0.18) + lane * 0.37);
  return u ** 7;
}
// a band of light sweeping one way along the zone and back
function scanner(x, y, t, s, p, L) {
  const pos = (0.5 - 0.5 * Math.cos(t * 0.9)) * Math.max(1, L);
  const d = (x - pos) / (0.9 * s);
  return Math.exp(-d * d);
}
// soft curtains drifting and folding, like the northern lights
function aurora(x, y, t, s) {
  const fold = Math.sin(x * 0.9 / s + 1.8 * Math.sin(y * 2.4 + t * 0.55) + t * 0.35);
  const sheet = 0.55 + 0.45 * Math.sin(x * 0.37 / s - t * 0.22);
  return smooth(0.15, 0.85, 0.5 + 0.5 * fold) * sheet * (0.45 + 0.55 * smooth(1, 0.1, y));
}
// bars rising from the front row and falling back, every column to its own beat
function equalizer(x, y, t, s) {
  const w = 0.3 * s, col = Math.floor(x / w), r = hash(col, 3.7);
  const level = 0.18 + 0.72 * Math.abs(Math.sin(t * (1.6 + 1.9 * r) + r * 6.3)) * (0.75 + 0.25 * Math.sin(t * 5.2));
  return (1 - y < level ? 1 : 0) * band(x / w, 0.72, 0.06);
}
// Looks marked `hk` colour each seat themselves: they return how bright it is
// and leave its hue here (one shared slot, so nothing is allocated per seat).
export const HK = { hue: 0 };
// fireworks: bursts going off at random places, each ring of sparks fading out
function fireworks(x, y, t, s) {
  const w = 2.4 * s, cellI = Math.floor(x / w), lx = x - cellI * w;
  const v = t / 1.7 + hash(cellI, 1.1) * 3, n = Math.floor(v), age = (v - n) * 1.7;
  const cx = w * (0.25 + 0.5 * hash(cellI, n)), cy = 0.25 + 0.5 * hash(n, cellI + 0.5);
  const d = Math.hypot(lx - cx, (y - cy) * 1.2), r = age * 0.75 * s;
  HK.hue = hash(cellI + 0.3, n);
  return smooth(0.16, 0, Math.abs(d - r)) * smooth(1.6, 0.5, age) * smooth(0, 0.05, age);
}
// the water line, two waves riding on each other, with the sea below it
function ocean(x, y, t, s) {
  const surf = 0.45 + 0.17 * Math.sin(x / (0.9 * s) - t * 1.3) + 0.07 * Math.sin(x / (0.37 * s) + t * 2.1);
  return smooth(surf - 0.04, surf + 0.04, y) * (0.55 + 0.45 * smooth(surf + 0.25, surf, y));
}
// lightning: a few stretches of the zone strike at random, now and then all of
// it, over a faint glow of cloud so the bowl never goes dead between strikes
function lightning(x, y, t, s) {
  const n = Math.floor(t * 2.2), age = frac(t * 2.2);
  const seg = Math.floor(x / (0.9 * s));
  const cloud = 0.05 + 0.04 * Math.sin(x * 0.8 / s + t * 0.6);
  const all = hash(n, 7.7) > 0.9;
  if (!all && hash(seg * 13.1, n) < 0.72) return cloud;
  return Math.max(cloud, Math.exp(-age * 5) * (all ? 1 : 0.65 + 0.35 * hash(seg, 2.2)) * (0.8 + 0.2 * Math.sin(t * 60)));
}

// The looks, in the order the designer shows them. `a`/`b` are colours a
// look brings with it when chosen (fire comes in fire colours); the rest use
// the zone's own.
export const LOOKS = [
  { id: 'solid', name: 'Solid', f: () => 1 },
  { id: 'pulse', name: 'Pulse', f: (x, y, t) => 0.5 - 0.5 * Math.cos(t * 2.6) },
  { id: 'chevrons', name: 'Chevrons', f: (x, y, t, s) => band((x + Math.abs(y - 0.5) * 1.3) / (1.3 * s) - t * 0.7, 0.42, 0.08) },
  { id: 'stripes', name: 'Stripes', f: (x, y, t, s) => band((x + y * 0.7) / (0.9 * s) - t * 0.5, 0.5, 0.07) },
  {
    // one band of light running round the whole zone, like a crowd doing the wave
    id: 'wave', name: 'Stadium wave',
    f: (x, y, t, s, p, L) => {
      const d = frac(x / Math.max(1, L) - t * 0.11) - 0.5;
      const w = 0.035 * s;
      return Math.exp(-(d * d) / (w * w)) * (0.75 + 0.25 * smooth(1, 0, y));
    },
  },
  {
    id: 'ribbon', name: 'Ribbon',
    f: (x, y, t, s) => smooth(0.2, 0.1, Math.abs(y - (0.5 + 0.3 * Math.sin(TAU * (x / (2.4 * s) - t * 0.3))))),
  },
  { id: 'rainbow', name: 'Rainbow', hue: true, f: (x, y, t, s) => x / (4 * s) - t * 0.2 },
  {
    id: 'sparkle', name: 'Sparkle',
    f: (x, y, t, s, p) => { const v = Math.sin(t * 3.1 + p * 61.7); return v > 0 ? v ** 16 : 0; },
  },
  { id: 'checker', name: 'Checker', f: (x, y, t, s) => (Math.floor(x / (0.5 * s) - t * 0.9) + Math.floor(y * 2)) & 1 },
  { id: 'hearts', name: 'Hearts', f: heart },
  { id: 'stars', name: 'Stars', f: star },
  { id: 'fire', name: 'Fire', a: '#ff6a00', b: '#1a0300', f: fire },
  { id: 'confetti', name: 'Confetti', hue: true, f: (x, y, t, s, p) => p * 7 + Math.floor(t * 1.2 + p * 5) * 0.618 },
  // a soft blend of the two colours flowing round the ring
  { id: 'flow', name: 'Colour flow', f: (x, y, t, s) => 0.5 + 0.5 * Math.sin(TAU * (x / (3.2 * s) - t * 0.16) + y * 1.2) },
  // half and half, the line between them sweeping round
  { id: 'sweep', name: 'Sweep', f: (x, y, t, s, p, L) => smooth(-0.05, 0.05, Math.sin(TAU * (x / Math.max(1, L) - t * 0.07))) },
  { id: 'ripple', name: 'Ripple', f: ripple },
  { id: 'comets', name: 'Comets', f: comets },
  { id: 'scanner', name: 'Scanner', f: scanner },
  { id: 'rain', name: 'Rain', f: rain },
  { id: 'equalizer', name: 'Equalizer', f: equalizer },
  { id: 'zigzag', name: 'Zigzag', f: (x, y, t, s) => band((x + Math.abs(frac(y * 1.5) - 0.5) * 1.4) / (0.9 * s) - t * 0.55, 0.36, 0.08) },
  { id: 'ocean', name: 'Ocean', a: '#1e8bff', b: '#00040c', f: ocean },
  { id: 'aurora', name: 'Aurora', a: '#3dffa8', b: '#020a1a', f: aurora },
  {
    id: 'plasma', name: 'Plasma', hue: true,
    f: (x, y, t, s) => (Math.sin(x / (1.2 * s) + t * 0.9) + Math.sin(y * 4 - t * 0.7) + Math.sin((x / s + y * 3) * 0.7 + t * 1.3)) * 0.17 + t * 0.04,
  },
  { id: 'fireworks', name: 'Fireworks', hk: true, f: fireworks },
  { id: 'lightning', name: 'Lightning', a: '#e8f0ff', b: '#03051a', f: lightning },
  {
    // two rows of dots rolling along, the second row half a step behind
    id: 'dots', name: 'Polka dots',
    f: (x, y, t, s) => {
      const w = 0.6 * s, row = y < 0.5 ? 0 : 1;
      const cx = (frac(x / w - t * 0.25 + row * 0.5) - 0.5) * w, cy = (y - 0.25 - row * 0.5) * 0.5;
      return smooth(0.21 * s, 0.15 * s, Math.hypot(cx, cy));
    },
  },
  { id: 'text', name: 'Text', text: true },
  // WASH: every band the same (the node's effects, below); not for painting
  { id: 'wash', name: 'Wash', wash: true },
  // IR: the moving heads light only the bands in their beams (irheads.js); not for painting
  { id: 'ir', name: 'IR moving heads', ir: true },
  // GROUPING: the crowd cut into zones, each with its own effect, taking turns (below); not for painting
  { id: 'group', name: 'Grouping', group: true },
  { id: 'off', name: 'Off', f: () => 0 },
];
export const LOOK = Object.fromEntries(LOOKS.map((l) => [l.id, l]));

// --- WASH: the node's effects --------------------------------------------------------
// The PixMob node drives a crowd as one: every band gets the same effect at
// the same moment. An effect is a shape repeated every `period` seconds (of
// the zone's own clock, so the speed setting stretches it), f(phase 0..1)
// giving the brightness. On top of it:
//   probability  the share of bands that catch each hit; the rest sit that one
//                out, so a low setting turns any effect into a random sparkle
//   colour       one colour, 'rainbow' (every band its own, new each hit) or
//                'cycle' (the whole crowd steps through the colours together)
export const WASH_FX = [
  { id: 'solid', name: 'Solid', period: 0.6, f: () => 1 },
  { id: 'fade', name: 'Fade', period: 2.6, f: (ph) => 0.5 - 0.5 * Math.cos(ph * TAU) },
  { id: 'pulse', name: 'Pulse', period: 0.95, f: (ph) => (ph < 0.6 ? Math.sin((ph / 0.6) * Math.PI) ** 2 : 0) },
  { id: 'strobe', name: 'Strobe', period: 0.13, f: (ph) => (ph < 0.4 ? 1 : 0) },
  { id: 'close', name: 'Pulse close', period: 1.2, f: (ph) => (1 - ph) ** 2.2 },
  { id: 'open', name: 'Pulse open', period: 1.4, f: (ph) => ph ** 2.2 },
];
export const WASH = Object.fromEntries(WASH_FX.map((w) => [w.id, w]));
// the node's nine colours, white to pink
export const WASH_COLOURS = [
  ['#ffffff', 'White'], ['#ff1818', 'Red'], ['#ff7800', 'Orange'], ['#ffff28', 'Yellow'], ['#00ff50', 'Green'],
  ['#00ced1', 'Turquoise'], ['#1e5aff', 'Blue'], ['#a032ff', 'Purple'], ['#ff50c8', 'Pink'],
];
// One band's colour from a wash, linear 0..1. a: the colour (linear rgb);
// p: the band's own random number; prob: the share of bands catching a hit.
// pal: the colours picked (2 to 4, linear): each band takes one of them, a new pick every hit
export function washRGB(w, cmode, a, prob, clock, p, out, pal = null) {
  const v = clock / w.period, n = Math.floor(v);
  const k = prob >= 1 || hash(p * 61.3, n) < prob ? w.f(v - n) : 0;
  if (cmode === 'rainbow') hueRGB(hash(p * 17.9 + 0.5, n), out);
  else if (cmode === 'cycle') hueRGB((n % 8) / 8, out);
  else if (cmode === 'pal' && pal && pal.length) { const c = pal[Math.floor(hash(p * 23.7 + 0.3, n) * pal.length) % pal.length]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; }
  else { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; }
  out[0] *= k; out[1] *= k; out[2] *= k;
  return out;
}

// --- GROUPING: the sections take turns ----------------------------------------------
// Every section of the bowl (the 100s, 200s, 300s and 400s) is a zone, and the
// floor is one zone more. Each zone is cut into a few groups: across the
// section, by its rows, or scattered through it. One order says which zones
// are lit at each step of a clock, another which groups inside them; every
// group plays its own effect in its own colour, and the floor has its own.
// Steps run on the show's clock, so the show's speed knob speeds them up too.
// showengine.js knows the sections and does the per-seat work.
export const GROUP_ORDERS = [   // which zones are lit, step by step
  ['all', 'All at once'], ['around', 'Around'], ['pingpong', 'Ping-pong'], ['sides', 'Both sides'],
  ['climb', 'Tier climb'], ['snake', 'Snake'], ['stage', 'From the stage'], ['build', 'Build'],
  ['random', 'Random'], ['alternate', 'Alternate'],
];
export const GROUP_INNER = [    // which groups inside each zone
  ['together', 'Together'], ['chase', 'In turn'], ['alternate', 'Alternate'], ['random', 'Random'],
];
export const GROUP_SPLITS = [['across', 'Across'], ['rows', 'Rows'], ['scatter', 'Scattered']];
export const GROUP_COLOURING = [['group', 'Group colours'], ['rainbow', 'Rainbow round'], ['tier', 'By tier']];
export const FLOOR_MODES = [['always', 'Always on'], ['chase', 'In the chase'], ['off', 'Off']];
// what a group (or the floor) can play: the node's effects, two more of its tricks, and a few patterns
export const GROUP_FX = [
  ['solid', 'Solid'], ['pulse', 'Pulse'], ['strobe', 'Strobe'], ['fade', 'Fade'], ['open', 'Pulse open'], ['close', 'Pulse close'],
  ['twinkle', 'Twinkle'], ['rainbow', 'Rainbow'],
  ['chevrons', 'Chevrons'], ['comets', 'Comets'], ['sparkle', 'Sparkle'], ['flow', 'Colour flow'], ['scanner', 'Scanner'], ['fire', 'Fire'],
];
// an effect, ready to paint: a wash (with its colour mode and probability)
// or a pattern drawn in the colour over black
export function groupFx(id) {
  if (id === 'twinkle') return { wash: WASH.solid, cmode: 'a', prob: 0.3, tk: 1.6 };
  if (id === 'rainbow') return { wash: WASH.solid, cmode: 'rainbow', prob: 1, tk: 0.8 };
  if (WASH[id]) return { wash: WASH[id], cmode: 'a', prob: 1, tk: 1 };
  const L = LOOK[id];
  if (L && L.f && !L.hue && !L.hk) return { f: L.f };
  return { wash: WASH.solid, cmode: 'a', prob: 1, tk: 1 };
}
// one band's colour from an effect (linear 0..1); a: its colour (linear rgb)
export function groupFxRGB(e, a, clock, x, y, p, len, out) {
  if (e.wash) return washRGB(e.wash, e.cmode, a, e.prob, clock * e.tk, p, out);
  const k = e.f(x, y, clock, 1, p, len);
  out[0] = a[0] * k; out[1] = a[1] * k; out[2] = a[2] * k;
  return out;
}
// How lit something is at clock position s, counted in steps: lit(i) says
// whether it is on at step i. It holds for its step, then fades over `tail` steps.
export function stepLevel(lit, s, tail) {
  const i0 = Math.floor(s), back = Math.ceil(tail) + 1;
  let best = 0;
  for (let b = 0; b < back && best < 1; b++) {
    const i = i0 - b;
    if (!lit(i)) continue;
    const age = s - i, v = age < 1 ? 1 : tail > 0 ? 1 - (age - 1) / tail : 0;
    if (v > best) best = v;
  }
  return best;
}

// hue (wraps) -> r, g, b in 0..1, full saturation
export function hueRGB(h, out) {
  h = frac(h) * 6;
  out[0] = Math.min(1, Math.max(0, Math.abs(h - 3) - 1));
  out[1] = Math.min(1, Math.max(0, 2 - Math.abs(h - 2)));
  out[2] = Math.min(1, Math.max(0, 2 - Math.abs(h - 4)));
  return out;
}

// --- text -------------------------------------------------------------------------
// Fonts every Mac and PC has, so a demo never falls back to something plain.
export const FONTS = [
  ['bold', 'Bold', '900 {px}px "Arial Black", "Helvetica Neue", Arial, sans-serif'],
  ['tall', 'Tall', '400 {px}px Impact, "Arial Narrow", "Helvetica Neue", sans-serif'],
  ['round', 'Round', '700 {px}px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif'],
  ['classic', 'Classic', '700 {px}px Georgia, "Times New Roman", serif'],
  ['script', 'Script', '700 {px}px "Brush Script MT", "Snell Roundhand", "Segoe Script", cursive'],
  ['digital', 'Digital', '700 {px}px Menlo, "Courier New", monospace'],
];
const STRIP_H = 48;   // text heights are about the rows of a tier: plenty of detail
// The text drawn once into a strip: its coverage (0..255) per pixel, and how
// long one pass of it is, gap included, in text heights. The strip repeats,
// so a ring of text loops with no seam. The letters are sized to fill the
// strip's height and drawn with a thick outline: a crowd is a coarse screen,
// with a seat every half metre and a row every metre, and thin strokes fall
// between the seats.
export function makeTextStrip(str, fontId) {
  const face = (FONTS.find((f) => f[0] === fontId) || FONTS[0])[2];
  const text = String(str || '').replace(/\s+/g, ' ').trim() || ' ';
  const c = document.createElement('canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  // measure at a trial size, then scale so the letters stand 88% of the strip
  let px = 100;
  g.font = face.replace('{px}', String(px));
  let m = g.measureText(text);
  const tall = (m.actualBoundingBoxAscent || px * 0.72) + (m.actualBoundingBoxDescent || 0);
  px = Math.max(8, Math.round((px * STRIP_H * 0.88) / Math.max(1, tall)));
  const font = face.replace('{px}', String(px));
  g.font = font;
  m = g.measureText(text);
  const asc = m.actualBoundingBoxAscent || px * 0.72, desc = m.actualBoundingBoxDescent || 0;
  const stroke = STRIP_H * 0.07;
  const tw = Math.ceil(m.width + stroke * 2);
  const gap = Math.round(STRIP_H * 1.4);   // the space before it comes round again
  c.width = Math.max(8, tw + gap);
  c.height = STRIP_H;
  g.font = font;
  g.fillStyle = g.strokeStyle = '#fff';
  g.lineWidth = stroke;
  g.lineJoin = 'round';
  g.textBaseline = 'alphabetic';
  const baseY = (STRIP_H + asc - desc) / 2;   // the letters' box centred in the strip
  g.strokeText(text, gap / 2 + stroke, baseY);
  g.fillText(text, gap / 2 + stroke, baseY);
  const rgba = g.getImageData(0, 0, c.width, c.height).data;
  const cover = new Uint8Array(c.width * c.height);
  for (let i = 0; i < cover.length; i++) cover[i] = rgba[i * 4 + 3];
  return { cover, w: c.width, h: STRIP_H, period: c.width / STRIP_H };
}
// how much text covers a seat. size: the share of the zone's height the
// text stands; kx: zone units to text heights; scroll: text heights moved
export function textAt(strip, x, y, size, kx, scroll) {
  const ty = (y - (1 - size) / 2) / size;
  if (ty < 0 || ty >= 1) return 0;
  const u = frac((x * kx + scroll) / strip.period);
  const px = Math.min(strip.w - 1, (u * strip.w) | 0);
  return strip.cover[((ty * strip.h) | 0) * strip.w + px] / 255;
}

// --- thumbnails ---------------------------------------------------------------------
// A look drawn as a little block of wristbands, in the chosen colours.
export function drawThumb(ctx, look, a, b, t, opts = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const rows = opts.rows || 9, cols = Math.max(4, Math.round((rows * W) / H));
  const L = cols / rows;
  const dw = W / cols, dh = H / rows, r = Math.max(1, Math.min(dw, dh) * 0.36);
  ctx.fillStyle = '#07080b';
  ctx.fillRect(0, 0, W, H);
  const col = [0, 0, 0];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) / rows, y = (j + 0.5) / rows;
      const p = frac(Math.sin(i * 12.9898 + j * 78.233) * 43758.5453);
      if (look.text) {
        const k = opts.strip ? textAt(opts.strip, x, y, 0.9, 1 / 0.9, t * 1.1) : 0;
        for (let q = 0; q < 3; q++) col[q] = b[q] + (a[q] - b[q]) * k;
      } else if (look.wash) {
        const w = opts.wash || {};
        washRGB(WASH[w.fx] || WASH_FX[0], w.cmode || 'a', a, w.prob ?? 1, t * (w.speed ?? 1), p, col, w.palRGB || null);
        for (let q = 0; q < 3; q++) col[q] = Math.min(1, col[q]);
      } else if (look.hk) {
        const k = look.f(x, y, t, 1, p, L);
        hueRGB(HK.hue, col);
        for (let q = 0; q < 3; q++) col[q] *= k;
      } else if (look.hue) {
        hueRGB(look.f(x, y, t, 1, p, L), col);
      } else {
        const k = look.f(x, y, t, 1, p, L);
        for (let q = 0; q < 3; q++) col[q] = b[q] + (a[q] - b[q]) * k;
      }
      ctx.fillStyle = `rgb(${(col[0] * 255) | 0},${(col[1] * 255) | 0},${(col[2] * 255) | 0})`;
      ctx.beginPath();
      ctx.arc((i + 0.5) * dw, (j + 0.5) * dh, r, 0, TAU);
      ctx.fill();
    }
  }
}
