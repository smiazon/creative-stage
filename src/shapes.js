// Shapes drawn from hands. Each shape is built from landmark points (in the
// camera picture's pixels), then painted with one edge style and one colour
// mode. Canvas 2D throughout. For fade, fuzzy and pixel every shape of a
// frame goes into one layer and the effect works on that layer once, so it
// costs the same for one shape as for ten. Soft edges come from a blur filter
// (with a shadow trick standing in on browsers without canvas filters), glows
// from canvas shadows, the fuzz from a moving grain mask, and the pixel look
// from a coarse canvas scaled up without smoothing.
import { TIPS, CONNECTIONS } from './handtrack.js';

export const SHAPES = [
  ['fingers', 'Fingers'], ['hand', 'Hand'], ['span', 'Span'], ['stretch', 'Stretch'], ['slinky', 'Slinky'],
  ['pinch', 'Pinch'], ['dots', 'Dots'], ['strings', 'Strings'], ['trails', 'Trails'], ['none', 'None'],
];
export const SHAPE_NOTES = {
  fingers: 'A shape through your five fingertips, one per hand.',
  hand: 'The outline of each whole hand.',
  span: 'One shape stretched between both hands.',
  stretch: 'One stretchy shape held in both hands. Pull them apart and the middle thins out like taffy. With one hand it stretches between thumb and index finger.',
  slinky: 'A spring from one hand to the other. It sags when your hands are close and pulls straight as they part. With one hand it runs from thumb to index finger.',
  pinch: 'A circle between thumb and index finger. Pinch to shrink it.',
  dots: 'A dot on every fingertip.',
  strings: 'Lines from fingertip to fingertip across both hands, or out from the wrist with one.',
  trails: 'Your index fingertips leave fading trails. Draw in the air.',
  none: 'Tracking only: no shapes. The skeleton can still go on the wristbands.',
};
export const EDGES = [
  ['sharp', 'Sharp'], ['smooth', 'Smooth'], ['fade', 'Fade'], ['fuzzy', 'Fuzzy'],
  ['glow', 'Glow'], ['outline', 'Outline'], ['neon', 'Neon'], ['pixel', 'Pixel'],
];
export const COLOR_MODES = [['solid', 'Solid'], ['hands', 'Per hand'], ['rainbow', 'Rainbow'], ['gradient', 'Gradient']];

const FILTER_OK = typeof CanvasRenderingContext2D !== 'undefined'
  && 'filter' in CanvasRenderingContext2D.prototype;

// --- geometry --------------------------------------------------------------------
// convex hull (monotone chain) of [x, y] points, counter-clockwise
function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}
const centroid = (pts) => {
  let x = 0, y = 0;
  for (const q of pts) { x += q[0]; y += q[1]; }
  return [x / pts.length, y / pts.length];
};
const scaleAbout = (pts, c, k) => pts.map((q) => [c[0] + (q[0] - c[0]) * k, c[1] + (q[1] - c[1]) * k]);

// n points evenly spaced round a closed outline, so it can bend anywhere
function resample(pts, n) {
  const m = pts.length;
  if (m < 3) return pts;
  const seg = [];
  let total = 0;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % m];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push(d);
    total += d;
  }
  if (total < 1e-3) return pts;
  const out = [];
  let i = 0, at = 0;   // at: distance round the outline where segment i starts
  for (let k = 0; k < n; k++) {
    const s = (k * total) / n;
    while (i < m - 1 && at + seg[i] < s) { at += seg[i]; i++; }
    const a = pts[i], b = pts[(i + 1) % m], f = seg[i] > 0 ? (s - at) / seg[i] : 0;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

// Pull an outline in toward the line from a to b, most in the middle. Past
// `rest` apart, the further a and b go the thinner the middle gets, the way
// taffy thins as it is pulled, and the thin part droops a little. A slow
// ripple keeps it looking soft.
function taffy(pts, a, b, rest, t) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  if (L < 1) return pts;
  const pull = Math.max(0, Math.min(0.86, 1 - Math.pow(rest / L, 1.2)));
  if (pull <= 0) return pts;
  const ux = dx / L, uy = dy / L;
  return pts.map(([x, y]) => {
    const px = x - a[0], py = y - a[1];
    const s = (px * ux + py * uy) / L;   // 0 at a, 1 at b
    if (s <= 0 || s >= 1) return [x, y];
    const d = py * ux - px * uy;         // distance off the line, signed
    const bell = Math.sin(Math.PI * s) ** 2;
    const k = 1 - pull * bell * (1 + 0.1 * Math.sin(s * 9 - t * 5));
    const along = s * L, droop = pull * bell * L * 0.07;
    return [a[0] + ux * along - uy * d * k, a[1] + uy * along + ux * d * k + droop];
  });
}

// A spring from a to b, seen from the side: `loops` turns of wire that bunch
// up as the ends come together and spread out as they part. Slack, it hangs
// under its own weight; pulled out, it runs straight. Returns the wire's
// front and back runs (the back is drawn dimmer, which is what makes it read
// as a coil) and every point, for the colour's extent.
function coil(a, b, ra, rb, loops) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / L, uy = dy / L;
  const taut = (ra + rb) * loops * 0.4;                // stretched this far, it hangs straight
  const sag = Math.min(L * 0.45, Math.max(0, taut - L) * 0.25) + L * 0.04;
  // the part of "down" across the spring: an upright spring does not fold
  const gx = -ux * uy, gy = 1 - uy * uy;
  const cx = (a[0] + b[0]) / 2 + gx * sag * 2, cy = (a[1] + b[1]) / 2 + gy * sag * 2;
  const n = loops * 22;
  const front = [], back = [], pts = [];
  let run = null, side = null, prev = null;
  for (let j = 0; j <= n; j++) {
    const s = j / n, is = 1 - s;
    const px = is * is * a[0] + 2 * is * s * cx + s * s * b[0];
    const py = is * is * a[1] + 2 * is * s * cy + s * s * b[1];
    let tx = is * (cx - a[0]) + s * (b[0] - cx), ty = is * (cy - a[1]) + s * (b[1] - cy);
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const r = ra + (rb - ra) * s, th = Math.PI * 2 * loops * s;
    const c = Math.cos(th), sn = Math.sin(th);
    const q = [px - ty * r * c + tx * r * 0.32 * sn, py + tx * r * c + ty * r * 0.32 * sn];
    const f = sn >= 0;
    if (f !== side) { run = prev ? [prev] : []; (f ? front : back).push(run); side = f; }
    run.push(q);
    pts.push(q);
    prev = q;
  }
  return { front, back, pts };
}

// straight-edged closed path
function polyPath(ctx, pts) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
// a closed Catmull-Rom curve through every point: the rounded version
function smoothPath(ctx, pts) {
  const n = pts.length;
  if (n < 3) { polyPath(ctx, pts); return; }
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    ctx.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1]);
  }
  ctx.closePath();
}
// an open polyline, rounded through its middle points
function openPath(ctx, pts, smooth) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (!smooth || pts.length < 3) {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}

// --- the renderer -----------------------------------------------------------------
export function createShapeRenderer() {
  // layers the edge effects work in, and a coarse one for the pixel look
  const make = () => { const c = document.createElement('canvas'); return [c, c.getContext('2d')]; };
  const [layerA, la] = make(), [layerB, lb] = make(), [tiny, tg] = make();
  // grain for the fuzzy edge: three noise tiles, one picked per frame at a
  // random offset, so the fray shimmers instead of sitting still
  const tiles = [0, 1, 2].map(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.random() < 0.5 ? 0 : 128 + Math.random() * 127;
    }
    g.putImageData(img, 0, 0);
    return c;
  });
  let tileK = 0;

  // a layer, sized and wiped
  function fresh(c, g, w, h) {
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    return g;
  }
  // draw a layer blurred. Filters where the browser has them; else a shadow
  // thrown back onto the canvas from a copy drawn off to the side (the shadow
  // takes one colour, so that stand-in loses per-shape colours in the blur).
  function blurInto(g, src, radius, flat) {
    if (radius <= 0.5) { g.drawImage(src, 0, 0); return; }
    if (FILTER_OK) {
      g.filter = `blur(${radius.toFixed(1)}px)`;
      g.drawImage(src, 0, 0);
      g.filter = 'none';
      return;
    }
    const off = src.width * 2 + 64;
    g.save();
    g.shadowColor = flat;
    g.shadowBlur = radius * 2;
    g.shadowOffsetX = off;
    g.drawImage(src, -off, 0);
    g.restore();
  }

  // -- what to draw ----------------------------------------------------------------
  function buildItems(hands, opt, W, H, t) {
    const list = [...hands.values()].filter((h) => h.alpha > 0.01)
      .sort((a, b) => (a.side === 'Left' ? 0 : 1) - (b.side === 'Left' ? 0 : 1));
    const P = (h, i) => [h.pts[i * 3] * W, h.pts[i * 3 + 1] * H];
    // the middle of the palm, and the palm's length (wrist to middle knuckle)
    const palm = (h) => centroid([0, 5, 9, 13, 17].map((i) => P(h, i)));
    const reach = (h) => { const a = P(h, 0), b = P(h, 9); return Math.max(H * 0.04, Math.hypot(a[0] - b[0], a[1] - b[1])); };
    const S = opt.size;
    const items = [];
    const poly = (pts, hand, alpha, both = false, grad = null) => {
      if (pts.length < 3) return;
      items.push({ kind: 'poly', pts: scaleAbout(pts, centroid(pts), S), hand, alpha, both, grad });
    };
    const two = list.length >= 2;
    const both = two ? Math.min(list[0].alpha, list[1].alpha) : 0;
    switch (opt.shape) {
      case 'fingers':
        for (const h of list) poly(TIPS.map((i) => P(h, i)), h, h.alpha);
        break;
      case 'hand':
        for (const h of list) poly(hull(Array.from({ length: 21 }, (_, i) => P(h, i))), h, h.alpha);
        break;
      case 'span': {
        const pts = list.flatMap((h) => TIPS.map((i) => P(h, i)));
        if (list.length) poly(hull(pts), list[0], Math.min(...list.map((h) => h.alpha)), two, two ? [...palm(list[0]), ...palm(list[1])] : null);
        break;
      }
      case 'stretch':
        if (two) {
          // both whole hands in one outline, thinned in the middle as they part
          const [a, b] = list, ca = palm(a), cb = palm(b);
          const all = [];
          for (let i = 0; i < 21; i++) all.push(P(a, i), P(b, i));
          const out = hull(all);
          const pts = resample(scaleAbout(out, centroid(out), S), 96);
          items.push({ kind: 'poly', pts: taffy(pts, ca, cb, 1.2 * (reach(a) + reach(b)), t), hand: a, alpha: both, both: true, grad: [...ca, ...cb] });
        } else {
          // one hand: a blob on the thumb and one on the index finger, pulled between them
          for (const h of list) {
            const a = P(h, 4), b = P(h, 8), r = reach(h) * 0.3;
            const ring = (c) => Array.from({ length: 16 }, (_, k) => [c[0] + r * Math.cos((k * Math.PI) / 8), c[1] + r * Math.sin((k * Math.PI) / 8)]);
            const out = hull([...ring(a), ...ring(b)]);
            const pts = resample(scaleAbout(out, centroid(out), S), 64);
            items.push({ kind: 'poly', pts: taffy(pts, a, b, r * 2.4, t), hand: h, alpha: h.alpha, grad: [...a, ...b] });
          }
        }
        break;
      case 'slinky':
        if (two) {
          const [a, b] = list, ca = palm(a), cb = palm(b);
          items.push({ kind: 'coil', ...coil(ca, cb, reach(a) * 0.5 * S, reach(b) * 0.5 * S, 18), hand: a, alpha: both, both: true, grad: [...ca, ...cb] });
        } else {
          for (const h of list) {
            const a = P(h, 4), b = P(h, 8), r = reach(h) * 0.22 * S;
            items.push({ kind: 'coil', ...coil(a, b, r, r, 9), hand: h, alpha: h.alpha, grad: [...a, ...b] });
          }
        }
        break;
      case 'pinch':
        for (const h of list) {
          const a = P(h, 4), b = P(h, 8);
          items.push({ kind: 'circle', c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], r: Math.max(2, Math.hypot(a[0] - b[0], a[1] - b[1]) / 2) * S, hand: h, alpha: h.alpha });
        }
        break;
      case 'dots':
        for (const h of list) TIPS.forEach((i, k) => items.push({ kind: 'circle', c: P(h, i), r: H * 0.028 * S, hand: h, alpha: h.alpha, idx: k }));
        break;
      case 'strings':
        if (two) {
          const [a, b] = list;
          TIPS.forEach((i, k) => items.push({ kind: 'line', pts: [P(a, i), P(b, i)], hand: a, alpha: both, both: true, idx: k }));
        } else {
          for (const h of list) TIPS.forEach((i, k) => items.push({ kind: 'line', pts: [P(h, 0), P(h, i)], hand: h, alpha: h.alpha, idx: k }));
        }
        break;
      case 'trails':
        for (const h of [...hands.values()]) {
          if (h.trail.length < 2) continue;
          items.push({ kind: 'trail', pts: h.trail.map((q) => [q.x * W, q.y * H]), times: h.trail.map((q) => q.t), hand: h, alpha: 1 });
        }
        break;
      default:
        break;
    }
    return items;
  }

  // -- colour ------------------------------------------------------------------------
  function bbox(item) {
    if (item.kind === 'circle') return [item.c[0] - item.r, item.c[1] - item.r, item.c[0] + item.r, item.c[1] + item.r];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of item.pts) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    return [x0, y0, x1, y1];
  }
  // the line a two-colour blend runs along: hand to hand for shapes held in
  // both, else corner to corner
  function gradLine(ctx, item) {
    let [x0, y0, x1, y1] = item.grad || bbox(item);
    if (Math.hypot(x1 - x0, y1 - y0) < 1) { x1 = x0 + 1; y1 = y0 + 1; }
    return ctx.createLinearGradient(x0, y0, x1, y1);
  }
  const hsl = (h) => `hsl(${(((h % 360) + 360) % 360).toFixed(0)} 100% 60%)`;
  // returns { style, flat }: flat is one plain colour for the shadow stand-in
  function colorFor(ctx, item, opt, t, k) {
    const A = opt.colorA, B = opt.colorB;
    const two = (a, b) => {
      const g = gradLine(ctx, item);
      g.addColorStop(0, a); g.addColorStop(1, b);
      return { style: g, flat: a };
    };
    switch (opt.colorMode) {
      case 'hands':
        if (item.both) return two(A, B);
        return item.hand.side === 'Left' ? { style: A, flat: A } : { style: B, flat: B };
      case 'rainbow': {
        const hue = t * 70 + (item.hand.side === 'Left' ? 0 : 180) + (item.idx ?? k) * 38;
        if (item.grad) {   // a shape from end to end (a spring, a stretch): the whole spectrum along it
          const g = gradLine(ctx, item);
          for (let s = 0; s <= 6; s++) g.addColorStop(s / 6, hsl(hue + s * 60));
          return { style: g, flat: hsl(hue) };
        }
        const c = hsl(hue);
        return { style: c, flat: c };
      }
      case 'gradient':
        return two(A, B);
      default:
        return { style: A, flat: A };
    }
  }

  // -- painting ----------------------------------------------------------------------
  const isLine = (item) => item.kind === 'line' || item.kind === 'trail' || item.kind === 'coil';
  function path(ctx, item, smooth) {
    ctx.beginPath();
    if (item.kind === 'circle') ctx.arc(item.c[0], item.c[1], item.r, 0, Math.PI * 2);
    else if (item.kind === 'poly') (smooth ? smoothPath : polyPath)(ctx, item.pts);
    else openPath(ctx, item.pts, smooth);
  }
  // fill a shape, or stroke a line; trails taper and fade toward their tail,
  // springs draw their far side dimmer
  function body(ctx, item, style, opt, smooth, lineK = 1) {
    if (item.kind === 'trail') {
      const now = performance.now(), n = item.pts.length;
      ctx.lineCap = 'round';
      ctx.strokeStyle = style;
      for (let i = 1; i < n; i++) {
        const age = Math.min(1, (now - item.times[i]) / 1200);
        ctx.globalAlpha = item.alphaBase * (1 - age);
        ctx.lineWidth = Math.max(1, opt.line * lineK * opt.size * (0.35 + 0.65 * (1 - age)));
        ctx.beginPath();
        ctx.moveTo(item.pts[i - 1][0], item.pts[i - 1][1]);
        ctx.lineTo(item.pts[i][0], item.pts[i][1]);
        ctx.stroke();
      }
      ctx.globalAlpha = item.alphaBase;
      return;
    }
    if (item.kind === 'coil') {
      const a0 = ctx.globalAlpha;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = style;
      ctx.lineWidth = Math.max(1, opt.line * 0.55 * lineK);
      for (const [runs, k] of [[item.back, 0.4], [item.front, 1]]) {
        ctx.globalAlpha = a0 * k;
        ctx.beginPath();
        for (const r of runs) if (r.length > 1) openPath(ctx, r, false);
        ctx.stroke();
      }
      ctx.globalAlpha = a0;
      return;
    }
    path(ctx, item, smooth);
    if (isLine(item)) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1, opt.line * lineK * (item.kind === 'line' ? opt.size : 1));
      ctx.strokeStyle = style;
      ctx.stroke();
    } else {
      ctx.fillStyle = style;
      ctx.fill();
    }
  }
  function outline(ctx, item, style, opt, lineK = 1) {
    if (isLine(item)) { body(ctx, item, style, opt, true, lineK); return; }
    path(ctx, item, true);
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, opt.line * lineK);
    ctx.strokeStyle = style;
    ctx.stroke();
  }
  // a copy of a shape grown about its middle (the fuzzy halo reaches past the core)
  function grow(item, k) {
    if (item.kind === 'circle') return { ...item, r: item.r * k };
    if (item.kind === 'poly') return { ...item, pts: scaleAbout(item.pts, centroid(item.pts), k) };
    return item;
  }

  // every shape, each at its own strength, onto one canvas
  function bodies(g, items, opt, smooth, lineK = 1, growBy = 0) {
    for (const it of items) {
      g.globalAlpha = it.alphaBase;
      body(g, growBy ? grow(it, growBy) : it, it.col.style, opt, smooth, lineK);
    }
    g.globalAlpha = 1;
  }
  function outlines(g, items, opt, lineK, style = null) {
    for (const it of items) {
      g.globalAlpha = it.alphaBase * (style ? 0.85 : 1);
      outline(g, it, style || it.col.style, opt, lineK);
    }
    g.globalAlpha = 1;
  }

  // the edge effect, once for the whole frame
  function paintAll(ctx, items, opt, W, H) {
    const soft = opt.softness, flat = items[0].col.flat;
    switch (opt.edge) {
      case 'sharp':
        bodies(ctx, items, opt, false);
        break;
      case 'fade':
        bodies(fresh(layerA, la, W, H), items, opt, true);
        blurInto(ctx, layerA, 3 + soft * 38, flat);
        break;
      // Glow and neon stay with canvas shadows, shape by shape: browsers blur
      // a shadow cheaply (measured quicker than blurring a whole layer)
      case 'glow':
        ctx.save();
        ctx.shadowBlur = 8 + soft * 50;
        for (const it of items) {
          ctx.shadowColor = it.col.flat;
          ctx.globalAlpha = it.alphaBase;
          body(ctx, it, it.col.style, opt, true);
          body(ctx, it, it.col.style, opt, true);
        }
        ctx.restore();
        break;
      case 'outline':
        outlines(ctx, items, opt, 1);
        break;
      case 'neon':
        ctx.save();
        ctx.shadowBlur = 10 + soft * 40;
        for (const it of items) {
          ctx.shadowColor = it.col.flat;
          ctx.globalAlpha = it.alphaBase;
          outline(ctx, it, it.col.style, opt, 1);
          outline(ctx, it, it.col.style, opt, 1);
        }
        ctx.restore();
        outlines(ctx, items, opt, 0.35, 'rgba(255,255,255,0.9)');   // the hot white core of a neon tube
        break;
      case 'fuzzy': {
        // a blurred halo, eaten away by grain so the edge frays, over a near-solid core
        bodies(fresh(layerA, la, W, H), items, opt, true, 1.8, 1.18 + soft * 0.3);
        const g = fresh(layerB, lb, W, H);
        blurInto(g, layerA, 5 + soft * 26, flat);
        g.globalCompositeOperation = 'destination-in';
        const pat = g.createPattern(tiles[tileK = (tileK + 1) % 3], 'repeat');
        if (pat && pat.setTransform) pat.setTransform(new DOMMatrix().translateSelf(Math.random() * 128, Math.random() * 128));
        g.fillStyle = pat;
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
        ctx.drawImage(layerB, 0, 0);
        bodies(fresh(layerA, la, W, H), items, opt, true);
        blurInto(ctx, layerA, 1.2, flat);
        break;
      }
      case 'pixel': {
        // chunky blocks, like the wristbands themselves: draw small, scale up hard
        const cell = Math.max(4, Math.round(H / 34));
        const w = Math.ceil(W / cell), h = Math.ceil(H / cell);
        const g = fresh(tiny, tg, w, h);
        g.setTransform(w / W, 0, 0, h / H, 0, 0);
        bodies(g, items, opt, true, 1.4);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tiny, 0, 0, w, h, 0, 0, W, H);
        ctx.imageSmoothingEnabled = true;
        break;
      }
      default:
        bodies(ctx, items, opt, true);
    }
  }

  // draw every shape for these hands onto ctx (cleared by the caller)
  function draw(ctx, hands, opt, t) {
    if (opt.shape === 'none') return;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const items = buildItems(hands, opt, W, H, t);
    if (!items.length) return;
    items.forEach((it, k) => {
      it.col = colorFor(ctx, it, opt, t, k);
      it.alphaBase = Math.max(0, Math.min(1, it.alpha * opt.opacity));
    });
    ctx.save();
    paintAll(ctx, items, opt, W, H);
    ctx.restore();
  }
  return { draw };
}

// The tracking overlay: bones, joints and which hand is which. Blue left,
// pink right, the way most tracking tools colour them.
export function drawSkeleton(ctx, hands, W, H) {
  for (const h of hands.values()) {
    if (h.alpha < 0.02) continue;
    const P = (i) => [h.pts[i * 3] * W, h.pts[i * 3 + 1] * H];
    const col = h.side === 'Left' ? '#39d2ff' : '#ff4fa3';
    ctx.save();
    ctx.globalAlpha = h.alpha;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(2, H / 170);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      const pa = P(a), pb = P(b);
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
    }
    ctx.stroke();
    for (let i = 0; i < 21; i++) {
      const p = P(i);
      ctx.beginPath();
      ctx.arc(p[0], p[1], TIPS.includes(i) ? Math.max(3, H / 95) : Math.max(2, H / 150), 0, Math.PI * 2);
      ctx.fillStyle = TIPS.includes(i) ? '#ffffff' : col;
      ctx.fill();
    }
    const w = P(0);
    ctx.font = `700 ${Math.max(11, Math.round(H / 22))}px -apple-system, system-ui, sans-serif`;
    ctx.fillStyle = col;
    ctx.fillText(h.side === 'Left' ? 'L' : 'R', w[0] + 8, w[1] + Math.max(14, H / 18));
    ctx.restore();
  }
}
