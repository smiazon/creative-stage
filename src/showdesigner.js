// CUSTOMISE: the show designer's full window, opened from the simple SHOW
// panel (showpanel.js), which owns the presets. Two tabs, one job each:
//   Paint  choose a look and colours, then tap or drag on the map of the arena
//          to paint sections with it, or fill a whole ring at once
//   Text   type a message and choose the ring it runs round
// The presets (demos) live here too, for the panel to play and preview.
// Whatever is chosen goes on the wristbands straight away. The engine
// (showengine.js) does the per-seat work and draws the demo cards' previews.
//
// Painting works like a paint program: the brush is a look with its colours
// and motion, and every section painted with the same brush shares one
// picture, so chevrons run unbroken round a whole ring. Painting over a
// section replaces what it had. The message sits on top of the paint and
// hands its ring back when it is turned off.
import { makeMovable } from './windows.js';
import { LOOKS, LOOK, WASH, FONTS, GROUP_SPLITS, GROUP_ORDERS, GROUP_INNER, GROUP_FX, GROUP_COLOURING, FLOOR_MODES, drawThumb } from './showlooks.js';
import { FLOOR } from './showengine.js';
import { MOTION } from './irheads.js';

const PREFS_KEY = 'ht-show2';

// colour sets a client recognises at a glance
const PAIRS = [
  ['#e4002b', '#ffffff', 'Red and white'],
  ['#1f5bff', '#ffffff', 'Blue and white'],
  ['#ffc72c', '#141414', 'Gold and black'],
  ['#00a651', '#ffffff', 'Green and white'],
  ['#7b2cff', '#ffc72c', 'Purple and gold'],
  ['#ff2fb4', '#2fd6ff', 'Pink and cyan'],
  ['#ff6a00', '#1a0300', 'Orange and black'],
  ['#ffffff', '#000000', 'White and black'],
];
const PAINT_LOOKS = LOOKS.filter((l) => !l.text && !l.wash && !l.ir && !l.group && l.id !== 'off');
const WHERE = [['t0', '100s'], ['t1', '200s'], ['t2', '300s'], ['t3', '400s'], ['bowl', 'Whole bowl']];
// parts of the bowl as seen from the stage, which stands at the -x end:
// the far end faces it, and its left is the -z side
const SIDES = [['far', 'Far end'], ['near', 'Stage end'], ['left', 'Left side'], ['right', 'Right side']];
const clone = (o) => JSON.parse(JSON.stringify(o));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const srgb = (hex) => { const n = parseInt(String(hex).slice(1), 16) || 0; return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
// the same colour, darker: backgrounds that stay in the family
const shade = (hex, k) => {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('')}`;
};

// --- demos ---------------------------------------------------------------------------
// Each builds its zones from the arena (rings, halves, ends...) and, for the
// ones marked `brand`, the client's two colours A and B.
const Z = (sections, look, a, b, extra = {}) => ({ sections, look, a, b, speed: 1, size: 1, dir: 1, span: 'across', ...extra });
const MIX = ['chevrons', 'stripes', 'hearts', 'stars', 'sparkle', 'checker', 'ribbon', 'pulse', 'rainbow', 'fire',
  'zigzag', 'dots', 'comets', 'equalizer', 'flow', 'plasma'];
// one look on every ring, the colours swapping (and the motion turning) ring by ring
const rings = (ring, look, A, B, bg, extra = () => ({})) =>
  [0, 1, 2, 3].map((t) => Z(ring(t), look, t % 2 ? B : A, bg(t), { dir: t % 2 ? -1 : 1, ...extra(t) }));
const DEMOS = [
  // every band dark: the first tile in every tab
  { id: 'blackout', name: 'Blackout', make: ({ all }) => [Z(all, 'solid', '#000000', '#000000')] },
  { id: 'team', name: 'Team colours', brand: true, make: ({ A, B, ring, floor }) => [
    Z(ring(0), 'chevrons', A, B), Z(ring(1), 'pulse', B, A), Z(ring(2), 'stripes', A, shade(A, 0.15)),
    Z(ring(3), 'sparkle', B, shade(A, 0.2)), Z(floor, 'wave', B, A)] },
  { id: 'message', name: 'Your message', brand: true, text: true, make: ({ A, ring, floor }) => [
    Z([...ring(1), ...ring(2), ...ring(3)], 'chevrons', A, shade(A, 0.1)), Z(floor, 'sparkle', '#ffffff', '#000000')] },
  { id: 'wave', name: 'Stadium wave', brand: true, make: ({ A, all }) => [Z(all, 'wave', A, shade(A, 0.08))] },
  { id: 'march', name: 'Chevron march', brand: true, make: ({ A, B, ring }) =>
    [0, 1, 2, 3].map((t) => Z(ring(t), 'chevrons', t % 2 ? B : A, '#000000', { dir: t % 2 ? -1 : 1 })) },
  { id: 'flow', name: 'Colour flow', brand: true, make: ({ A, B, all }) => [Z(all, 'flow', A, B)] },
  { id: 'sweep', name: 'Sweep', brand: true, make: ({ A, B, ring, floor }) => [
    ...rings(ring, 'sweep', A, B, () => shade(B, 0.1), (t) => ({ phase: t * 0.8 })).map((z, t) => ({ ...z, a: A, b: t % 2 ? shade(A, 0.12) : B })),
    Z(floor, 'flow', A, B)] },
  { id: 'comets', name: 'Comets', brand: true, make: ({ A, B, ring, floor }) => [
    ...rings(ring, 'comets', A, B, () => '#000000', (t) => ({ speed: 1 + t * 0.15 })), Z(floor, 'sparkle', B, '#000000')] },
  { id: 'scanner', name: 'Scanner', brand: true, make: ({ A, B, ring, floor }) => [
    ...rings(ring, 'scanner', A, B, () => shade(A, 0.05), (t) => ({ phase: t * 0.9 })), Z(floor, 'pulse', A, '#000000')] },
  { id: 'ripple', name: 'Ripples', brand: true, make: ({ A, B, bowl, floor }) => [
    Z(bowl, 'ripple', A, shade(A, 0.06)), Z(floor, 'ripple', B, shade(A, 0.06))] },
  { id: 'rain', name: 'Neon rain', brand: true, make: ({ A, B, bowl, floor }) => [Z(bowl, 'rain', A, '#000000'), Z(floor, 'sparkle', B, '#000000')] },
  { id: 'equalizer', name: 'Equalizer', brand: true, make: ({ A, B, ring, floor }) => [
    ...rings(ring, 'equalizer', A, B, () => shade(A, 0.05), () => ({ dir: 1 })), Z(floor, 'pulse', A, '#000000', { speed: 2 })] },
  { id: 'zigzag', name: 'Zigzag', brand: true, make: ({ A, B, ring, floor }) => [
    ...rings(ring, 'zigzag', A, B, (t) => shade(t % 2 ? B : A, 0.08)), Z(floor, 'checker', A, B)] },
  { id: 'dots', name: 'Polka dots', brand: true, make: ({ A, B, ring, floor }) => [
    ...rings(ring, 'dots', A, B, (t) => shade(t % 2 ? A : B, 0.14)), Z(floor, 'sparkle', A, '#000000')] },
  { id: 'ocean', name: 'Ocean', make: ({ bowl, floor }) => [Z(bowl, 'ocean', '#1e8bff', '#00040c'), Z(floor, 'ripple', '#7fd4ff', '#00040c')] },
  { id: 'aurora', name: 'Aurora', make: ({ all }) => [Z(all, 'aurora', '#3dffa8', '#020a1a')] },
  { id: 'plasma', name: 'Plasma', make: ({ all }) => [Z(all, 'plasma', '#ffffff', '#000000')] },
  { id: 'fireworks', name: 'Fireworks', make: ({ all }) => [Z(all, 'fireworks', '#ffffff', '#000000')] },
  { id: 'storm', name: 'Thunderstorm', make: ({ bowl, floor }) => [Z(bowl, 'lightning', '#e8f0ff', '#03051a'), Z(floor, 'rain', '#9fc4ff', '#000000')] },
  { id: 'teams', name: 'Two teams', brand: true, make: ({ A, B, where, floor }) => [
    Z(where((s) => s.cz < 0), 'pulse', A, shade(A, 0.2)), Z(where((s) => s.cz >= 0), 'pulse', B, shade(B, 0.2), { phase: 1.21 }),
    Z(floor, 'checker', A, B)] },
  { id: 'flag', name: 'Tricolour', brand: true, make: ({ A, B, where, floor }) => {
    const third = (s) => Math.min(2, Math.floor(((Math.atan2(s.cz, s.cx) + Math.PI) / (Math.PI * 2)) * 3));
    // three bands round the bowl: the two colours and a deep shade of the first
    const C = shade(A, 0.35);
    return [Z(where((s) => third(s) === 0), 'solid', A, A), Z(where((s) => third(s) === 1), 'solid', B, B),
      Z(where((s) => third(s) === 2), 'solid', C, C), Z(floor, 'solid', B, B)];
  } },
  { id: 'checker', name: 'Checkerboard', brand: true, make: ({ A, B, where, floor }) => [
    Z(where((s) => (s.span + s.tier) % 2 === 0), 'pulse', A, B), Z(where((s) => (s.span + s.tier) % 2 === 1), 'pulse', B, A),
    Z(floor, 'checker', A, B)] },
  { id: 'hotseat', name: 'Hot seat', brand: true, make: ({ A, B, where, bowl, floor, sections }) => {
    // one section lit, the one at the far end facing the stage
    const front = where((s) => s.tier === 0);
    let hot = front[0];
    for (const k of front) if (sections.get(k).cx > sections.get(hot).cx) hot = k;
    return [Z(bowl.filter((k) => k !== hot), 'solid', shade(B, 0.08), shade(B, 0.08)), Z(floor, 'solid', shade(B, 0.08), shade(B, 0.08)),
      Z([hot], 'pulse', A, '#ffffff', { speed: 1.6 })];
  } },
  { id: 'ribbons', name: 'Ribbons', brand: true, make: ({ A, B, ring, floor }) => [
    ...[0, 1, 2, 3].map((t) => Z(ring(t), 'ribbon', t % 2 ? B : A, '#000000', { size: 1 + t * 0.25, dir: t % 2 ? -1 : 1 })),
    Z(floor, 'ribbon', A, '#000000')] },
  { id: 'hearts', name: 'Hearts', brand: true, make: ({ A, ring, floor }) => [
    Z(ring(0), 'hearts', A, shade(A, 0.12)), Z([...ring(1), ...ring(2), ...ring(3), ...floor], 'sparkle', A, '#000000')] },
  { id: 'endsides', name: 'Ends and sides', brand: true, make: ({ A, B, where, isEnd, floor }) => [
    Z(where(isEnd), 'stripes', A, shade(A, 0.12)), Z(where((s) => !isEnd(s)), 'chevrons', B, shade(B, 0.1)), Z(floor, 'pulse', A, B)] },
  { id: 'chant', name: 'Let’s go!', brand: true, make: ({ A, B, ring, floor }) => [
    Z(ring(0), 'chevrons', A, B), Z([...ring(1), ...ring(3)], 'pulse', A, '#000000'), Z(floor, 'pulse', B, A),
    Z(ring(2), 'text', '#ffffff', shade(A, 0.3), { size: 1.3, text: { str: 'LET’S GO!', font: 'tall', size: 1 } })] },
  { id: 'heartbeat', name: 'Heartbeat', brand: true, make: ({ A, all }) => [Z(all, 'pulse', A, '#000000', { speed: 2.3 })] },
  { id: 'rainbow', name: 'Rainbow', make: ({ all }) => [Z(all, 'rainbow', '#ffffff', '#000000')] },
  { id: 'fireice', name: 'Fire and ice', make: ({ ring, floor }) => [
    Z([...ring(0), ...ring(1), ...floor], 'fire', '#ff6a00', '#1a0300'), Z([...ring(2), ...ring(3)], 'sparkle', '#9fe8ff', '#00121c')] },
  { id: 'stars', name: 'Starry night', make: ({ bowl, floor }) => [Z(bowl, 'stars', '#ffe9a8', '#050b24'), Z(floor, 'sparkle', '#ffffff', '#020410')] },
  { id: 'confetti', name: 'Confetti party', make: ({ all }) => [Z(all, 'confetti', '#ffffff', '#000000')] },
  { id: 'phones', name: 'Phone lights', make: ({ all }) => [Z(all, 'sparkle', '#fff7e0', '#000000', { speed: 0.6 })] },
  { id: 'mixed', name: 'Every section different', make: ({ bowl, floor }) => [
    ...bowl.map((k, i) => {
      const look = MIX[i % MIX.length], [a, b] = PAIRS[(i * 3) % PAIRS.length];
      return look === 'fire' ? Z([k], look, '#ff6a00', '#1a0300') : Z([k], look, a, b);
    }),
    Z(floor, 'confetti', '#ffffff', '#000000')] },
  { id: 'tiers', name: 'Tier cascade', brand: true, make: ({ A, B, ring, floor }) => [
    ...[0, 1, 2, 3].map((t) => Z(ring(t), 'pulse', t % 2 ? B : A, '#000000', { phase: t * 0.35, speed: 1.3 })),
    Z(floor, 'pulse', B, '#000000', { phase: -0.35, speed: 1.3 })] },
  { id: 'halves', name: 'Split bowl', brand: true, make: ({ A, B, where, floor }) => [
    Z(where((s) => s.cz < 0), 'comets', A, '#000000', { dir: 1, speed: 1.4 }), Z(where((s) => s.cz >= 0), 'comets', B, '#000000', { dir: -1, speed: 1.4 }),
    Z(floor, 'flow', A, B)] },
  { id: 'lasers', name: 'Laser lines', brand: true, make: ({ A, B, ring, floor }) => [
    ...rings(ring, 'scanner', A, B, () => '#000000', (t) => ({ dir: t % 2 ? -1 : 1, speed: 1.6, phase: t * 0.5 })),
    Z(floor, 'stripes', B, '#000000', { speed: 1.5 })] },
  { id: 'strobe', name: 'Strobe hit', brand: true, make: ({ A, bowl, floor }) => [
    Z(bowl, 'pulse', '#ffffff', '#000000', { speed: 3.2 }), Z(floor, 'pulse', A, '#000000', { speed: 3.2, phase: 0.5 })] },
  { id: 'police', name: 'Sirens', make: ({ where, floor }) => [
    Z(where((s) => s.cz < 0), 'pulse', '#ff1a1a', '#000000', { speed: 2.4 }), Z(where((s) => s.cz >= 0), 'pulse', '#1a4dff', '#000000', { speed: 2.4, phase: 0.5 }),
    Z(floor, 'checker', '#ff1a1a', '#1a4dff')] },
  { id: 'sunset', name: 'Sunset', make: ({ ring, floor }) => [
    Z([...ring(0), ...ring(1)], 'flow', '#ff7a1a', '#ff2f6d'), Z([...ring(2), ...ring(3)], 'flow', '#9b3dff', '#1a0a3a'),
    Z(floor, 'fire', '#ff6a00', '#1a0300')] },
  { id: 'galaxy', name: 'Galaxy', make: ({ bowl, floor }) => [
    Z(bowl, 'stars', '#c9a8ff', '#0a0420'), Z(floor, 'aurora', '#7a5cff', '#02010a')] },
  { id: 'matrix', name: 'Code rain', make: ({ bowl, floor }) => [
    Z(bowl, 'rain', '#39ff6a', '#000000'), Z(floor, 'sparkle', '#b6ffc8', '#000000')] },
  { id: 'lava', name: 'Lava', make: ({ all }) => [Z(all, 'fire', '#ff3d00', '#120100', { speed: 0.8 })] },
  { id: 'disco', name: 'Disco', make: ({ ring, floor }) => [
    ...[0, 1, 2, 3].map((t) => Z(ring(t), 'checker', ['#ff2fd2', '#2fe6ff', '#ffe22f', '#7a2fff'][t], '#000000', { speed: 1.8 })),
    Z(floor, 'confetti', '#ffffff', '#000000')] },
  { id: 'pulsering', name: 'Ring pulse', brand: true, make: ({ A, B, ring, floor }) => [
    ...[0, 1, 2, 3].map((t) => Z(ring(t), 'pulse', t % 2 ? B : A, '#000000', { phase: t * 0.25 })), Z(floor, 'pulse', A, '#000000', { phase: 1 })] },
  { id: 'stripes2', name: 'Stripes', brand: true, make: ({ A, B, ring, floor }) => [
    ...[0, 1, 2, 3].map((t) => Z(ring(t), 'stripes', t % 2 ? B : A, '#000000', { dir: t % 2 ? -1 : 1 })), Z(floor, 'stripes', B, '#000000')] },
  { id: 'glitter', name: 'Glitter', brand: true, make: ({ A, B, all }) => [Z(all, 'sparkle', A, shade(B, 0.12), { speed: 1.4 })] },
  { id: 'softripple', name: 'Soft ripples', brand: true, make: ({ A, all }) => [Z(all, 'ripple', A, shade(A, 0.1), { speed: 0.6 })] },
  { id: 'countercomets', name: 'Counter comets', brand: true, make: ({ A, B, ring, floor }) => [
    ...[0, 1, 2, 3].map((t) => Z(ring(t), 'comets', t % 2 ? B : A, '#000000', { dir: t % 2 ? -1 : 1, speed: 1.2 })), Z(floor, 'sparkle', A, '#000000')] },
  { id: 'floorscan', name: 'Floor scanner', brand: true, make: ({ A, B, bowl, floor }) => [
    Z(bowl, 'solid', shade(A, 0.2), shade(A, 0.2)), Z(floor, 'scanner', B, '#000000', { speed: 1.3 })] },
  { id: 'ribbon1', name: 'Ribbon', brand: true, make: ({ A, B, all }) => [Z(all, 'ribbon', A, shade(B, 0.06))] },
  { id: 'tierblocks', name: 'Tier blocks', brand: true, make: ({ A, B, ring, floor }) => [
    ...[0, 1, 2, 3].map((t) => Z(ring(t), 'solid', t % 2 ? B : A, t % 2 ? B : A)), Z(floor, 'solid', A, A)] },
  { id: 'bassfloor', name: 'Bass floor', brand: true, make: ({ A, B, bowl, floor }) => [
    Z(bowl, 'pulse', A, '#000000', { speed: 1.6 }), Z(floor, 'equalizer', B, '#000000', { speed: 1.6 })] },
  { id: 'zigzagall', name: 'Zigzag wave', brand: true, make: ({ A, B, all }) => [Z(all, 'zigzag', A, shade(B, 0.1))] },
  { id: 'dotfloor', name: 'Dotted floor', brand: true, make: ({ A, B, bowl, floor }) => [
    Z(bowl, 'sparkle', A, '#000000', { speed: 0.8 }), Z(floor, 'dots', B, '#000000')] },
  { id: 'northern', name: 'Northern lights', brand: true, make: ({ A, B, all }) => [Z(all, 'flow', A, shade(B, 0.25), { speed: 0.5 })] },
  // WASH: every band the same effect at once, as the PixMob node runs a crowd.
  // Played from the panel's WASH tab, which sets W (effect, colour, speed,
  // probability); not one of the GRID presets.
  { id: 'wash', name: 'Wash', wash: true, make: ({ W, all }) => [
    Z(all, 'wash', W.a, '#000000', { fx: W.fx, cmode: W.cmode, prob: W.prob, speed: W.speed, pal: W.pal || null })] },
  // IR: the moving heads send the wash's command down their beams, so only the
  // bands inside a beam catch it (irheads.js). Played from the panel's IR tab.
  { id: 'ir', name: 'IR moving heads', ir: true, make: ({ IR, all }) => [Z(all, 'ir', IR.a, '#000000', irFields(IR))] },
  // GROUPING: every section a zone (the floor one more), each cut into groups,
  // taking turns (showlooks.js). Played from the panel's GROUPING tab.
  { id: 'group', name: 'Grouping', group: true, make: ({ GR, all, origin }) => [Z(all, 'group', '#ffffff', '#000000', groupFields(GR, origin))] },
];
// what an IR zone carries
const irFields = (IR) => ({ motion: IR.motion, fx: IR.fx, gobo: IR.gobo, size: IR.size, speed: IR.speed, prob: IR.prob, cmode: IR.cmode, heads: IR.heads, pal: IR.pal || null });
// What a grouping zone carries. It runs section by section ('each'), so a
// pattern plays in every section on its own. Its own clock runs at 1: the step
// and the effects' speed (fxSpeed) are timed on it, so one leaves the other be.
const groupFields = (GR, origin) => ({
  span: 'each', groups: GR.groups, gsplit: GR.gsplit, order: GR.order, inner: GR.inner, dir: GR.dir,
  step: GR.step, tail: GR.tail, base: GR.base, fxSpeed: GR.speed, cmode: GR.cmode,
  fx: clone(GR.fx), floor: clone(GR.floor), origin, speed: 1,
});
// four groups' worth to start with, in the node's colours
const GROUP_COLOURS = ['#ff1818', '#ffffff', '#1e5aff', '#ffff28'];
const defaultGroupFx = () => GROUP_COLOURS.map((a) => ({ fx: 'solid', a }));

export function initShowDesigner({ engine, orbFX, controls, visible, stageAt, onLive }) {
  const tiers = engine.tiers;
  const ring = (t) => (tiers[t] ? tiers[t].keys : []);
  const bowl = tiers.flatMap((T) => T.keys);
  const floorShown = () => orbFX.groups.some((g, gi) => gi > 0 && g.n && visible(g));
  const floorKeys = () => (floorShown() ? [FLOOR] : []);
  const whereKeys = (w) => (w === 'bowl' ? bowl : ring(Number(String(w).slice(1)) || 0));

  // --- the show ------------------------------------------------------------------
  let seq = 0;
  const newId = () => `z${Date.now().toString(36)}${(seq++).toString(36)}`;
  // where the stage stands on the plan, for a grouping's From the stage order
  const stageOrigin = () => {
    const s = stageAt?.();
    return s && Number.isFinite(s.x) ? [s.x, Number.isFinite(s.z) ? s.z : 0] : null;
  };
  // a grouping always has four groups' worth of effects and known values in range
  function fixGroup() {
    const G = st.group;
    const ok = (list, v) => list.some(([id]) => id === v);
    const fxOk = (id) => ok(GROUP_FX, id), hexOk = (a) => /^#[0-9a-f]{6}$/i.test(a || '');
    if (!ok(GROUP_ORDERS, G.order)) G.order = 'around';
    if (!ok(GROUP_INNER, G.inner)) G.inner = 'together';
    if (!ok(GROUP_SPLITS, G.gsplit)) G.gsplit = 'across';
    if (!ok(GROUP_COLOURING, G.cmode)) G.cmode = 'group';
    // a grouping kept before the sections became its zones carried a zone list
    const list = Array.isArray(G.fx) ? G.fx : Array.isArray(G.zones) ? G.zones : [];
    G.fx = defaultGroupFx().map((d, k) => {
      const z = list[k] || {};
      return { fx: fxOk(z.fx) ? z.fx : d.fx, a: hexOk(z.a) ? z.a : d.a };
    });
    // the floor: its effect, one to four colours (it is cut into that many parts), when it lights
    const f = G.floor || {};
    const cols = (Array.isArray(f.cols) ? f.cols : [f.a]).filter(hexOk).slice(0, 4);
    if (!cols.length) cols.push('#ffffff');
    G.floor = { fx: fxOk(f.fx) ? f.fx : 'pulse', cols, a: cols[0], mode: ok(FLOOR_MODES, f.mode) ? f.mode : 'always' };
    for (const k of ['split', 'n', 'zones']) delete G[k];
    G.groups = Math.min(4, Math.max(1, Math.round(Number(G.groups) || 3)));
    G.dir = G.dir < 0 ? -1 : 1;
    for (const [k, lo, hi, d] of [['step', 0.04, 8, 0.12], ['tail', 0, 6, 2], ['base', 0, 1, 0], ['speed', 0.1, 4, 1]]) {
      const v = Number(G[k]);
      G[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
    }
  }
  const st = {
    tab: 'demos',
    brand: { a: '#e4002b', b: '#ffffff' },
    tempo: 1,
    demo: null,       // the demo playing, or null for a show of your own
    zones: [],        // what is painted (a demo is painted too)
    text: { on: false, str: 'WELCOME', font: 'bold', size: 1, width: 1.4, a: '#ffffff', b: '#000000', speed: 1, dir: 1, where: 't0' },
    // the WASH tab's effect: fx (WASH_FX), colour, colour mode, speed, probability
    wash: { fx: 'pulse', a: '#ffffff', cmode: 'a', speed: 1, prob: 1 },
    // the IR tab's moving heads: movement preset, the command they send, gobo, beam size
    ir: { motion: 'sweep', fx: 'solid', gobo: 'circle', size: 1, speed: 1, prob: 1, cmode: 'rainbow', a: '#ffffff', heads: 0 },
    // the GROUPING tab: the groups in every section and what each plays, the
    // floor's own effect, and how the zones and groups take turns;
    // preset/name: the preset it came from, until edited
    group: {
      groups: 3, gsplit: 'across', order: 'around', inner: 'together', dir: 1,
      step: 0.12, tail: 2, base: 0, speed: 1, cmode: 'group',
      fx: defaultGroupFx(), floor: { fx: 'pulse', cols: ['#ffffff'], a: '#ffffff', mode: 'always' }, preset: null, name: null,
    },
    brush: { look: 'chevrons', a: '#e4002b', b: '#ffffff', speed: 1, size: 1, dir: 1, span: 'across' },
    erase: false,
    numbers: false,
  };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (p && p.v === 2) {
      for (const k of ['tab', 'tempo', 'demo', 'numbers']) if (p[k] !== undefined) st[k] = p[k];
      for (const k of ['brand', 'text', 'brush', 'wash', 'ir', 'group']) if (p[k]) st[k] = { ...st[k], ...p[k] };
      if (!WASH[st.wash.fx]) st.wash.fx = 'pulse';
      fixGroup();
      if (Array.isArray(p.zones)) st.zones = p.zones.filter((z) => z && Array.isArray(z.sections) && LOOK[z.look]);
    }
  } catch (_) { /* first visit */ }
  if (!['paint', 'text'].includes(st.tab)) st.tab = 'paint';   // the presets moved to the SHOW panel
  engine.tempo = st.tempo;
  const save = () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        v: 2, tab: st.tab, brand: st.brand, tempo: st.tempo, demo: st.demo, zones: st.zones,
        text: st.text, brush: st.brush, numbers: st.numbers, wash: st.wash, ir: st.ir, group: st.group,
      }));
    } catch (_) { /* private mode */ }
  };
  const textZone = () => ({
    id: 'message', sections: whereKeys(st.text.where), look: 'text', a: st.text.a, b: st.text.b,
    speed: st.text.speed, size: st.text.width, dir: st.text.dir, span: 'across',
    text: { str: st.text.str, font: st.text.font, size: st.text.size },
  });
  const showZones = () => (st.text.on && st.text.str.trim() ? [...st.zones, textZone()] : st.zones);
  function commit() {
    engine.setZones(showZones());
    save();
    render();
  }
  function goLive() {
    if (orbFX.mode !== 'design') {
      orbFX.set({ mode: 'design' });
      // the console's effect buttons no longer describe the wristbands
      document.querySelectorAll('[data-orb].active, [data-ofx].active').forEach((b) => b.classList.remove('active'));
      onLive?.();
    }
    render();
  }
  function goOff() {
    const off = document.querySelector('[data-orb="off"]');
    if (off) off.click(); else orbFX.set({ mode: 'off' });
    render();
  }

  // demos: the arena's parts, the client's colours, and each demo's zones
  const demoCtx = () => {
    const b = engine.planBounds(), hx = (b.x1 - b.x0) / 2, hz = (b.z1 - b.z0) / 2;
    return {
      A: st.brand.a, B: st.brand.b, W: st.wash, IR: st.ir, GR: st.group, origin: stageOrigin(),
      ring, bowl, floor: floorKeys(), all: [...bowl, ...floorKeys()],
      where: engine.where, sections: engine.sections, isEnd: (s) => Math.abs(s.cx) / hx > Math.abs(s.cz) / hz,
    };
  };
  // brand presets take the picked colours; "rainbow" runs the spectrum round them instead
  // with 3 or 4 colours picked, a brand preset's zones take them in turn, so
  // every colour shows (a dark background stays dark)
  const isDark = (h) => { const n = parseInt(String(h).slice(1), 16) || 0; return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255) < 90; };
  const demoZones = (d) => {
    const pal = [st.brand.a, st.brand.b, ...(st.brand.extra || [])].filter(Boolean);
    return d.make(demoCtx()).filter((z) => z.sections.length).map((z, k) => {
      const out = { id: newId(), ...z, ...(d.brand && st.brand.rainbow ? { rainbow: true } : {}) };
      if (d.brand && !st.brand.rainbow && pal.length > 2 && !isDark(z.a)) {
        out.a = pal[k % pal.length];
        if (!isDark(z.b)) out.b = pal[(k + 1) % pal.length];
      }
      return out;
    });
  };
  function playDemo(id) {
    const d = DEMOS.find((o) => o.id === id);
    if (!d) return;
    st.zones = demoZones(d);
    st.demo = id;
    if (d.text) st.text = { ...st.text, on: true, where: 't0' };
    else st.text.on = false;
    commit();
    goLive();
  }

  // the wash: a change to a playing wash keeps its zone (and so its clock) and
  // just retunes it, so dragging the speed doesn't restart the effect
  function setWash(patch) {
    st.wash = { ...st.wash, ...patch };
    const z = st.demo === 'wash' && st.zones.length === 1 && st.zones[0].look === 'wash' ? st.zones[0] : null;
    if (!z) { playDemo('wash'); return; }
    Object.assign(z, { a: st.wash.a, fx: st.wash.fx, cmode: st.wash.cmode, prob: st.wash.prob, speed: st.wash.speed });
    commit();
    goLive();
  }
  // the moving heads, the same way: a playing IR show is retuned where it stands
  function setIR(patch) {
    st.ir = { ...st.ir, ...patch };
    const z = st.demo === 'ir' && st.zones.length === 1 && st.zones[0].look === 'ir' ? st.zones[0] : null;
    if (!z) { playDemo('ir'); return; }
    Object.assign(z, { a: st.ir.a }, irFields(st.ir));
    commit();
    goLive();
  }
  // the grouping, the same way: a playing one is retuned where it stands, so
  // its chase keeps its place
  function setGroup(patch) {
    st.group = { ...st.group, ...clone(patch) };
    fixGroup();
    const z = st.demo === 'group' && st.zones.length === 1 && st.zones[0].look === 'group' ? st.zones[0] : null;
    if (!z) { playDemo('group'); return; }
    Object.assign(z, groupFields(st.group, stageOrigin()));
    commit();
    goLive();
  }
  // A whole show as a value, for a trigger to keep and bring back: what is
  // painted, the preset, the message, the colours, the wash and the heads.
  function snapshot() {
    return clone({ zones: st.zones, demo: st.demo, text: st.text, brand: st.brand, wash: st.wash, ir: st.ir, group: st.group, tempo: st.tempo });
  }
  // live: false puts the show back without turning the wristbands on (undo)
  function restore(s, { live = true } = {}) {
    if (!s) return;
    st.zones = clone(s.zones || []).filter((z) => z && Array.isArray(z.sections) && LOOK[z.look]);
    st.demo = s.demo ?? null;
    for (const k of ['text', 'brand', 'wash', 'ir', 'group']) if (s[k]) st[k] = { ...st[k], ...clone(s[k]) };
    fixGroup();
    if (s.tempo) { st.tempo = s.tempo; engine.tempo = s.tempo; }
    commit();
    if (live) goLive();
  }
  // a short name for a kept show
  function showName(s) {
    if (s.demo === 'wash') return `Wash · ${WASH[s.wash?.fx]?.name || ''}`;
    if (s.demo === 'ir') return `IR · ${MOTION[s.ir?.motion]?.name || ''}`;
    if (s.demo === 'group') {
      const G = s.group || {};
      if (G.name) return `Group · ${G.name}`;
      const o = GROUP_ORDERS.find(([id]) => id === G.order)?.[1] || '';
      return `Group · ${o}${G.groups > 1 ? ` · ${G.groups} groups` : ''}`;
    }
    const d = DEMOS.find((o) => o.id === s.demo);
    if (d) return d.name;
    return s.text?.on && s.text.str ? `“${String(s.text.str).slice(0, 14)}”` : 'Custom show';
  }
  // how fast everything on the wristbands runs: one knob over every zone's own speed
  function setTempo(v) {
    st.tempo = Math.min(4, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : 1));   // 0: the effect holds still
    engine.tempo = st.tempo;
    save();
  }

  // painting
  const sig = (b) => JSON.stringify([b.look, b.a, b.b, b.speed, b.size, b.dir, b.span]);
  function paintKeys(list) {
    const set = new Set(list.filter(Boolean));
    if (!set.size) return;
    for (const z of st.zones) z.sections = z.sections.filter((k) => !set.has(k));
    if (!st.erase) {
      const s = sig(st.brush);
      let z = st.zones.find((o) => sig(o) === s);
      if (!z) { z = { id: newId(), sections: [], ...clone(st.brush) }; st.zones.push(z); }
      z.sections.push(...set);
    }
    st.zones = st.zones.filter((o) => o.sections.length);
    st.demo = null;
    commit();
    goLive();
  }

  // --- the window --------------------------------------------------------------------
  const slider = (k, label, min, max, step) =>
    `<label class="shRow" data-f="${k}"><span>${label} <em></em></span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" aria-label="${label}"></label>`;
  const pairs = (target) => `<div class="shPairs" data-target="${target}">${PAIRS.map(([a, b, n], i) => `<button data-pair="${i}" title="${n}" style="--a:${a};--b:${b}"></button>`).join('')}</div>`;
  const seg = (k, opts) => `<div class="shSeg" data-k="${k}">${opts.map(([v, n, title]) => `<button data-v="${v}"${title ? ` title="${title}"` : ''}>${n}</button>`).join('')}</div>`;
  const root = document.createElement('div');
  root.id = 'showWin';
  root.className = 'showWin';
  root.innerHTML = `
    <div class="shHead">
      <span class="shTitle">◆ CUSTOMISE</span>
      <div class="shTabs">
        <button data-tab="paint">Paint</button><button data-tab="text">Text</button>
      </div>
      <span class="shLive"><i></i><span class="shLiveText"></span></span>
      <button class="shGo"></button>
      <button class="shClose" aria-label="Close">✕</button>
    </div>
    <div class="shBody">
      <div class="shPane" data-pane="paint">
        <div class="shPaint">
          <section class="shMapSide">
            <div class="shFills"><span class="shLabel">Fill</span>
              <button data-fill="all">Whole arena</button>${tiers.map((T) => `<button data-fill="t${T.tier}">${T.name}</button>`).join('')}<button data-fill="floor">Floor</button>
              <i class="shSplit"></i>${SIDES.map(([k, n]) => `<button data-fill="${k}" title="As seen from the stage">${n}</button>`).join('')}</div>
            <div class="shMapWrap"><canvas class="shMap"></canvas><div class="shTip" hidden></div>
              <button class="shNumbers" title="Show the section numbers">123</button></div>
            <div class="shTools">
              <button class="shEraser">Eraser</button><button class="shClearAll">Clear all</button>
              <span class="shNote">Tap or drag on the map to paint with the look on the right.</span>
            </div>
          </section>
          <section class="shBrush">
            <span class="shLabel">Look</span>
            <div class="shLooks">${PAINT_LOOKS.map((l) => `<button class="shLook" data-look="${l.id}" title="${l.name}"><canvas></canvas><span>${l.name}</span></button>`).join('')}</div>
            <span class="shLabel">Colours</span>${pairs('brush')}
            <div class="shPickers"><label>Main <input type="color" data-brush="a"></label><label>Background <input type="color" data-brush="b"></label></div>
            <div class="shTwo">${slider('speed', 'Speed', 0, 3, 0.05)}${slider('size', 'Size', 0.4, 3, 0.05)}</div>
            <div class="shTwo">${seg('dir', [['1', '◀ Left'], ['-1', 'Right ▶']])}${seg('span', [['across', 'One picture', 'One picture across everything painted with it'], ['each', 'Per section', 'Every section plays its own copy']])}</div>
            <span class="shLabel">In the show <em>click a colour to change it</em></span>
            <div class="shZones"></div>
          </section>
        </div>
      </div>
      <div class="shPane" data-pane="text">
        <div class="shTextPane">
          <input class="shTextIn" type="text" maxlength="60" placeholder="Type your message" spellcheck="false" aria-label="Your message">
          <div class="shTwo">
            <div class="shGroup"><span class="shLabel">On the wristbands</span>${seg('ton', [['on', 'Showing'], ['off', 'Hidden']])}</div>
            <div class="shGroup"><span class="shLabel">Where</span>${seg('where', WHERE)}</div>
          </div>
          <span class="shLabel">Font</span>
          <div class="shFonts">${FONTS.map(([k, n, css]) => `<button data-font="${k}" style="font:${css.replace('{px}', '14')}">${n}</button>`).join('')}</div>
          <span class="shLabel">Letters and background</span>${pairs('text')}
          <div class="shPickers"><label>Letters <input type="color" data-text="a"></label><label>Background <input type="color" data-text="b"></label></div>
          <div class="shTwo">${slider('tsize', 'Height', 0.4, 1, 0.05)}${slider('twidth', 'Width', 0.6, 3, 0.05)}</div>
          <div class="shTwo">${slider('tspeed', 'Speed', 0, 3, 0.05)}${seg('tdir', [['1', '◀ Left'], ['-1', 'Right ▶']])}</div>
          <p class="shNote">It runs round the whole ring and loops. The 100s have the most rows, so they read best.</p>
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const map = $('.shMap'), mctx = map.getContext('2d'), tip = $('.shTip'), zonesEl = $('.shZones'), textIn = $('.shTextIn');
  const win = makeMovable(root, { handle: '.shHead', key: 'show', resizable: true });

  // the dock button and the O key belong to the SHOW panel now; this window
  // opens from it (Customise)

  // --- the paint map: the arena from above, every wristband in its live colour ---------
  let fitKey = '', img = null, pix = [], view = null;
  const bounds = engine.planBounds();
  $('.shMapWrap').style.aspectRatio = `${(bounds.x1 - bounds.x0) / (bounds.z1 - bounds.z0)}`;
  function fit() {
    const r = map.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    const key = `${W}x${H}|${orbFX.groups.map((g) => g.n).join(',')}`;
    if (key === fitKey && pix.every((p, gi) => p.pos === orbFX.groups[gi].pos)) return true;
    fitKey = key;
    map.width = W; map.height = H;
    const k = Math.min(W / (bounds.x1 - bounds.x0), H / (bounds.z1 - bounds.z0));
    const ox = (W - (bounds.x1 - bounds.x0) * k) / 2, oy = (H - (bounds.z1 - bounds.z0) * k) / 2;
    view = { W, H, k, ox, oy, dpr };
    pix = orbFX.groups.map((g) => {
      const at = new Int32Array(g.n);
      for (let i = 0; i < g.n; i++) {
        const X = Math.round(ox + (g.pos[i * 3] - bounds.x0) * k), Y = Math.round(oy + (g.pos[i * 3 + 2] - bounds.z0) * k);
        at[i] = X >= 1 && X < W - 1 && Y >= 1 && Y < H - 1 ? Y * W + X : -1;
      }
      return { pos: g.pos, at };
    });
    img = mctx.createImageData(W, H);
    return true;
  }
  const toWorld = (e) => {
    const r = map.getBoundingClientRect();
    const X = (e.clientX - r.left) * view.dpr, Y = (e.clientY - r.top) * view.dpr;
    return { x: bounds.x0 + (X - view.ox) / view.k, z: bounds.z0 + (Y - view.oy) / view.k };
  };
  function keyAtEvent(e) {
    if (!view) return null;
    const { x, z } = toWorld(e);
    const k = engine.keyAt(x, z);
    return k === FLOOR && !floorShown() ? null : k;
  }
  let hover = null;
  function drawMap() {
    if (!fit()) return;
    const d = img.data, { W } = view;
    for (let i = 0; i < d.length; i += 4) { d[i] = 8; d[i + 1] = 9; d[i + 2] = 12; d[i + 3] = 255; }
    const hoverId = hover ? engine.idOf.get(hover) : -2;
    const R = Math.max(1, Math.round(view.dpr * 1.5));
    const br = Math.max(0.5, orbFX.brightness || 1);
    // only what is in the room: the festival's bowl is out of sight, so it stays off the map
    const groups = orbFX.groups.map((g, gi) => ({ g, gi, sec: engine.seatSections(gi), on: visible(g) }));
    // under the section the pointer is on, a glow in the brush's colour (red for the eraser)
    if (hoverId >= 0) {
      const c = st.erase ? [255, 90, 103] : srgb(st.brush.a).map((v) => v * 255);
      for (const { g, gi, sec, on } of groups) {
        if (!on || !sec) continue;
        const at = pix[gi].at;
        for (let i = 0; i < g.n; i++) {
          if (sec[i] !== hoverId) continue;
          const p = at[i];
          if (p < 0) continue;
          for (let dy = -R; dy <= R; dy++) {
            for (let dx = -R; dx <= R; dx++) {
              const q = (p + dy * W + dx) * 4;
              if (q < 0 || q >= d.length) continue;
              d[q] += (c[0] - d[q]) * 0.4; d[q + 1] += (c[1] - d[q + 1]) * 0.4; d[q + 2] += (c[2] - d[q + 2]) * 0.4;
            }
          }
        }
      }
    }
    // every wristband in the colour it is showing
    for (const { g, gi, on } of groups) {
      if (!on) continue;
      const at = pix[gi].at, col = g.mesh.instanceColor?.array;
      if (!col) continue;
      for (let i = 0; i < g.n; i++) {
        const p = at[i];
        if (p < 0) continue;
        let r = col[i * 3] / br, gg = col[i * 3 + 1] / br, b = col[i * 3 + 2] / br;
        const lit = r + gg + b > 0.03;
        r = lit ? Math.sqrt(Math.min(1, r)) * 255 : 44;
        gg = lit ? Math.sqrt(Math.min(1, gg)) * 255 : 46;
        b = lit ? Math.sqrt(Math.min(1, b)) * 255 : 54;
        for (let q = p * 4, s = 0; s < 2; s++, q += W * 4) {
          d[q] = r; d[q + 1] = gg; d[q + 2] = b;
          d[q + 4] = r; d[q + 5] = gg; d[q + 6] = b;
        }
      }
    }
    mctx.putImageData(img, 0, 0);
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    const P = (x, z) => [view.ox + (x - bounds.x0) * view.k, view.oy + (z - bounds.z0) * view.k];
    if (st.numbers) {
      mctx.font = `700 ${Math.round(9 * view.dpr)}px -apple-system, system-ui, sans-serif`;
      for (const s of engine.sections.values()) {
        if (!s.count || s.key === FLOOR) continue;
        const [X, Y] = P(s.cx, s.cz);
        mctx.fillStyle = 'rgba(0,0,0,0.65)';
        mctx.fillText(s.label, X + view.dpr * 0.7, Y + view.dpr * 0.7);
        mctx.fillStyle = 'rgba(245,240,225,0.8)';
        mctx.fillText(s.label, X, Y);
      }
    }
    mctx.font = `800 ${Math.round(10 * view.dpr)}px -apple-system, system-ui, sans-serif`;
    const stg = stageAt?.();
    if (stg && stg.concert) {
      const [X, Y] = P(stg.x, stg.z);
      mctx.fillStyle = 'rgba(231,195,122,0.85)';
      mctx.fillText('STAGE', X - 5 * view.dpr, Y);
    }
    if (floorShown()) {
      const [X, Y] = P(0, 0);
      mctx.fillStyle = 'rgba(235,230,215,0.45)';
      mctx.fillText('FLOOR', X, Y);
    }
  }
  // tap to paint one section, drag to paint every section the pointer crosses
  let painting = false, lastPt = null;
  function sweep(e) {
    const from = lastPt || { clientX: e.clientX, clientY: e.clientY };
    const steps = Math.max(1, Math.ceil(Math.hypot(e.clientX - from.clientX, e.clientY - from.clientY) / 3));
    const got = new Set();
    for (let i = 1; i <= steps; i++) {
      const k = keyAtEvent({ clientX: from.clientX + ((e.clientX - from.clientX) * i) / steps, clientY: from.clientY + ((e.clientY - from.clientY) * i) / steps });
      if (k) got.add(k);
    }
    lastPt = { clientX: e.clientX, clientY: e.clientY };
    // only what would change: dragging over sections that already have this brush does nothing
    const s = st.erase ? null : sig(st.brush);
    const todo = [...got].filter((k) => {
      const z = st.zones.find((o) => o.sections.includes(k));
      return st.erase ? !!z : !z || sig(z) !== s;
    });
    if (todo.length) paintKeys(todo);
  }
  map.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !keyAtEvent(e)) return;
    painting = true;
    lastPt = null;
    sweep(e);
    try { map.setPointerCapture(e.pointerId); } catch (_) { /* fine without */ }
    e.preventDefault();
  });
  map.addEventListener('pointermove', (e) => {
    if (painting) sweep(e);
    const k = keyAtEvent(e);
    hover = k;
    if (k) {
      const s = engine.sections.get(k);
      tip.textContent = k === FLOOR ? 'Floor' : `Section ${s.label} · ${tiers[s.tier].name}`;
      const r = map.getBoundingClientRect();
      tip.style.left = `${Math.min(r.width - 120, e.clientX - r.left + 12)}px`;
      tip.style.top = `${e.clientY - r.top + 14}px`;
      tip.hidden = false;
    } else {
      tip.hidden = true;
    }
  });
  const endPaint = () => { painting = false; lastPt = null; };
  map.addEventListener('pointerup', endPaint);
  map.addEventListener('pointercancel', endPaint);
  map.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; });

  // --- controls --------------------------------------------------------------------------
  function fillKeys(w) {
    if (w === 'all') return [...bowl, ...floorKeys()];
    if (w === 'floor') return floorKeys();
    if (/^t\d$/.test(w)) return ring(Number(w.slice(1)));
    const { isEnd } = demoCtx();
    const test = { far: (x) => isEnd(x) && x.cx > 0, near: (x) => isEnd(x) && x.cx < 0, left: (x) => !isEnd(x) && x.cz < 0, right: (x) => !isEnd(x) && x.cz > 0 }[w];
    return test ? engine.where(test) : [];
  }
  function setText(patch) {
    st.text = { ...st.text, ...patch };
    if (!('on' in patch)) st.text.on = true;   // changing the message shows it
    commit();
    if (st.text.on) goLive();
  }
  function setBrand(patch) {
    st.brand = { ...st.brand, ...patch };
    const d = DEMOS.find((o) => o.id === st.demo);
    if (d && d.brand) { st.zones = demoZones(d); commit(); goLive(); } else { save(); render(); }
  }
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('.shClose')) { setOpen(false); return; }
    if (t.closest('.shGo')) { if (orbFX.mode === 'design') goOff(); else if (showZones().length) goLive(); return; }
    const tab = t.closest('[data-tab]');
    if (tab) { st.tab = tab.dataset.tab; save(); render(); return; }
    const demo = t.closest('[data-demo]');
    if (demo) { playDemo(demo.dataset.demo); return; }
    const fill = t.closest('[data-fill]');
    if (fill) { paintKeys(fillKeys(fill.dataset.fill)); return; }
    const look = t.closest('[data-look]');
    if (look) {
      st.brush.look = look.dataset.look;
      const L = LOOK[st.brush.look];
      if (L.a) { st.brush.a = L.a; st.brush.b = L.b; }
      st.erase = false;
      save(); render();
      return;
    }
    const pair = t.closest('[data-pair]');
    if (pair) {
      const [a, b] = PAIRS[Number(pair.dataset.pair)];
      const target = pair.closest('.shPairs').dataset.target;
      if (target === 'brand') setBrand({ a, b });
      else if (target === 'text') setText({ a, b });
      else { st.brush.a = a; st.brush.b = b; st.erase = false; save(); render(); }
      return;
    }
    const segBtn = t.closest('.shSeg [data-v]');
    if (segBtn) {
      const k = segBtn.closest('.shSeg').dataset.k, v = segBtn.dataset.v;
      if (k === 'ton') setText({ on: v === 'on' });
      else if (k === 'where') setText({ where: v });
      else if (k === 'tdir') setText({ dir: Number(v) });
      else { st.brush[k] = k === 'dir' ? Number(v) : v; save(); render(); }
      return;
    }
    const font = t.closest('[data-font]');
    if (font) { setText({ font: font.dataset.font }); return; }
    if (t.closest('.shEraser')) { st.erase = !st.erase; render(); return; }
    if (t.closest('.shClearAll')) { st.zones = []; st.demo = null; commit(); return; }
    if (t.closest('.shNumbers')) { st.numbers = !st.numbers; save(); render(); return; }
    const del = t.closest('[data-del]');
    if (del) { st.zones = st.zones.filter((z) => z.id !== del.dataset.del); st.demo = null; commit(); return; }
    const use = t.closest('[data-use]');
    if (use) {
      const z = st.zones.find((o) => o.id === use.dataset.use);
      if (z) { for (const k of Object.keys(st.brush)) st.brush[k] = clone(z[k]); st.erase = false; save(); render(); }
    }
  });
  for (const r of root.querySelectorAll('input[type=range]')) {
    r.addEventListener('input', () => {
      const k = r.dataset.k, v = parseFloat(r.value);
      if (k === 'tempo') { st.tempo = v; engine.tempo = v; save(); render(); }
      else if (k === 'tsize') setText({ size: v });
      else if (k === 'twidth') setText({ width: v });
      else if (k === 'tspeed') setText({ speed: v });
      else { st.brush[k] = v; save(); render(); }
    });
  }
  for (const c of root.querySelectorAll('input[type=color]')) {
    c.addEventListener('input', () => {
      if (c.dataset.brand) setBrand({ [c.dataset.brand]: c.value });
      else if (c.dataset.text) setText({ [c.dataset.text]: c.value });
      else if (c.dataset.brush) { st.brush[c.dataset.brush] = c.value; st.erase = false; save(); render(); }
    });
  }
  // a zone's own colour swatches in the list recolour it on the spot
  zonesEl.addEventListener('input', (e) => {
    const c = e.target.closest('input[type=color][data-zone]');
    if (!c) return;
    const z = st.zones.find((o) => o.id === c.dataset.zone);
    if (z) { z[c.dataset.which] = c.value; st.demo = null; engine.setZones(showZones()); save(); }
  });
  zonesEl.addEventListener('change', () => render());
  textIn.addEventListener('input', () => setText({ str: textIn.value }));
  // typing in the message box must not walk the camera or trigger shortcuts
  textIn.addEventListener('keydown', (e) => e.stopPropagation());

  // --- drawing the window's state ----------------------------------------------------------
  function describe(list) {
    const set = new Set(list);
    const rings = tiers.filter((T) => T.keys.length && T.keys.every((k) => set.has(k)));
    if (rings.length === tiers.length) return set.has(FLOOR) ? 'Whole arena' : 'Whole bowl';
    const parts = rings.map((T) => `The ${T.name}`);
    const loose = [...set].filter((k) => k !== FLOOR && !rings.some((T) => T.keys.includes(k)));
    if (loose.length === 1) parts.push(`Section ${engine.sections.get(loose[0])?.label}`);
    else if (loose.length) parts.push(`${loose.length} sections`);
    if (set.has(FLOOR)) parts.push('Floor');
    return parts.join(' + ') || 'Nothing';
  }
  let zonesHtml = '';
  function render() {
    const live = orbFX.mode === 'design';
    const has = showZones().length > 0;
    root.classList.toggle('live', live);
    onRender?.();
    $('.shLiveText').textContent = live ? 'Live' : has ? (orbFX.mode === 'off' ? 'Not showing' : 'Another effect is on') : 'Pick a demo to start';
    const go = $('.shGo');
    go.textContent = live ? 'Turn off' : 'Show it';
    go.hidden = !live && !has;
    for (const b of root.querySelectorAll('[data-tab]')) b.classList.toggle('sel', b.dataset.tab === st.tab);
    for (const p of root.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== st.tab;
    // demos
    for (const b of root.querySelectorAll('[data-demo]')) b.classList.toggle('sel', b.dataset.demo === st.demo);
    for (const b of root.querySelectorAll('[data-pair]')) {
      const [a, bb] = PAIRS[Number(b.dataset.pair)];
      const tgt = b.closest('.shPairs').dataset.target;
      const cur = tgt === 'brand' ? st.brand : tgt === 'text' ? st.text : st.brush;
      b.classList.toggle('sel', a === cur.a && bb === cur.b);
    }
    for (const c of root.querySelectorAll('input[type=color]')) {
      if (document.activeElement === c || c.dataset.zone) continue;
      c.value = c.dataset.brand ? st.brand[c.dataset.brand] : c.dataset.text ? st.text[c.dataset.text] : st.brush[c.dataset.brush];
    }
    // paint
    for (const b of root.querySelectorAll('[data-look]')) b.classList.toggle('sel', !st.erase && b.dataset.look === st.brush.look);
    $('.shEraser').classList.toggle('sel', st.erase);
    $('.shNumbers').classList.toggle('sel', st.numbers);
    $('[data-fill="floor"]').hidden = !floorShown();
    // the list is rebuilt only when it changes (a click must not lose its
    // button mid-press), and never under a colour being picked
    if (!zonesEl.contains(document.activeElement)) {
      const html = st.zones.length ? st.zones.map((o) => {
        const L = LOOK[o.look];
        const name = L.text ? `“${esc((o.text?.str || '').slice(0, 16))}”` : L.wash ? `Wash · ${WASH[o.fx]?.name || ''}` : L.ir ? 'IR moving heads' : L.name;
        return `<div class="shZone">
          <input type="color" data-zone="${o.id}" data-which="a" value="${o.a}" title="Main colour">
          <input type="color" data-zone="${o.id}" data-which="b" value="${o.b}" title="Background">
          <button class="shZoneUse" data-use="${o.id}" title="Paint more with this look"><b>${name}</b><span>${esc(describe(o.sections))}</span></button>
          <button class="shZoneDel" data-del="${o.id}" aria-label="Remove">✕</button></div>`;
      }).join('') : '<p class="shEmpty">Nothing painted yet. Pick a look, then tap the map or a Fill button.</p>';
      // the message rides on top of the paint; it is edited in the Text tab
      const msgRow = st.text.on && st.text.str.trim()
        ? `<div class="shZone shZoneMsg"><i style="--a:${st.text.a};--b:${st.text.b}"></i><button class="shZoneUse" data-tab="text" title="Change it in the Text tab"><b>“${esc(st.text.str.slice(0, 16))}”</b><span>${esc(WHERE.find(([k]) => k === st.text.where)?.[1] || '')} · message</span></button></div>` : '';
      const all = msgRow + html;
      if (all !== zonesHtml) { zonesHtml = all; zonesEl.innerHTML = all; }
    }
    // sliders and switches
    for (const r of root.querySelectorAll('input[type=range]')) {
      const k = r.dataset.k;
      const v = k === 'tempo' ? st.tempo : k === 'tsize' ? st.text.size : k === 'twidth' ? st.text.width : k === 'tspeed' ? st.text.speed : st.brush[k];
      if (document.activeElement !== r) r.value = String(v);
      r.closest('.shRow').querySelector('em').textContent = /speed|tempo/.test(k) ? (v === 0 ? 'still' : `${v.toFixed(1)}×`) : `${Math.round(v * 100)}%`;
    }
    for (const g of root.querySelectorAll('.shSeg')) {
      const k = g.dataset.k;
      const cur = k === 'ton' ? (st.text.on ? 'on' : 'off') : k === 'where' ? st.text.where : k === 'tdir' ? String(st.text.dir) : String(st.brush[k]);
      for (const b of g.querySelectorAll('[data-v]')) b.classList.toggle('sel', b.dataset.v === cur);
    }
    // text
    if (document.activeElement !== textIn) textIn.value = st.text.str;
    for (const b of root.querySelectorAll('[data-font]')) b.classList.toggle('sel', st.text.font === b.dataset.font);
  }

  // --- animation while open: the demo cards, the paint map and the look tiles --------------
  let open = false, lastMap = 0, lastThumb = 0, lastCards = 0;
  const bodyEl = $('.shBody');
  const tiles = [...root.querySelectorAll('.shLook')].map((b) => ({ id: b.dataset.look, c: b.querySelector('canvas') }));
  const cards = [...root.querySelectorAll('.shCard')].map((b) => ({ id: b.dataset.demo, c: b.querySelector('canvas'), player: null, key: '' }));
  const sizeCanvas = (c, r) => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(2, Math.round(r.width * dpr)), H = Math.max(2, Math.round(r.height * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  };
  function frame(now) {
    if (!open) return;
    requestAnimationFrame(frame);
    // only what can be seen: panes that are not open, or scrolled away, wait
    const box = bodyEl.getBoundingClientRect();
    const seen = (r) => r.width > 0 && r.bottom > box.top && r.top < box.bottom;
    const t = now / 1000;
    if (st.tab === 'paint' && now - lastMap > 66) { lastMap = now; if (seen(map.getBoundingClientRect())) drawMap(); }
    if (st.tab === 'paint' && now - lastThumb > 100) {
      lastThumb = now;
      const a = srgb(st.brush.a), b = srgb(st.brush.b);
      for (const tl of tiles) {
        const r = tl.c.getBoundingClientRect();
        if (!seen(r)) continue;
        sizeCanvas(tl.c, r);
        const L = LOOK[tl.id];
        drawThumb(tl.c.getContext('2d'), L, L.a ? srgb(L.a) : a, L.b ? srgb(L.b) : b, t, { rows: 7 });
      }
    }
    if (st.tab === 'demos' && now - lastCards > 150) {
      lastCards = now;
      // the cards rebuild when what they show changes: the client colours,
      // whether the floor has seats, the message
      const key = `${st.brand.a}|${st.brand.b}|${floorShown()}|${st.text.str}|${st.text.font}`;
      for (const cd of cards) {
        const r = cd.c.getBoundingClientRect();
        if (!seen(r)) continue;
        sizeCanvas(cd.c, r);
        if (!cd.player || cd.key !== key) {
          const d = DEMOS.find((o) => o.id === cd.id);
          const zs = demoZones(d);
          if (d.text) zs.push({ ...textZone(), id: 'preview-message', sections: ring(0) });
          cd.player = engine.preview(zs);
          cd.key = key;
        }
        cd.player.draw(cd.c.getContext('2d'), t, visible);
      }
    }
  }
  function setOpen(o) {
    open = !!o;
    root.classList.toggle('open', open);
    if (open) {
      controls?.unlock?.();
      win.front();
      render();
      requestAnimationFrame(frame);
    } else {
      tip.hidden = true;
    }
  }
  // the console or the camera can take the wristbands over: keep the header honest
  setInterval(() => { if (open) render(); }, 600);
  let onRender = null;

  engine.setZones(showZones());
  render();
  return {
    open: () => setOpen(true), close: () => setOpen(false),
    openTab(tab) { if (tab === 'paint' || tab === 'text') { st.tab = tab; save(); } setOpen(true); },
    get isOpen() { return open; },
    get zones() { return showZones(); },
    playDemo, goLive, goOff, render,
    demos: DEMOS.map((d) => d.id),
    // for the SHOW panel: the presets, what is playing, and the client colours
    demoList: DEMOS.filter((d) => !d.wash && !d.ir && !d.group).map((d) => ({ id: d.id, name: d.name, brand: !!d.brand })),
    get demo() { return st.demo; },
    get brand() { return { ...st.brand }; },
    setBrand,
    // the WASH tab
    get wash() { return { ...st.wash }; },
    setWash,
    // the IR tab, and a movement preset's zones for its tile
    get ir() { return { ...st.ir }; },
    setIR,
    previewIR(motion) {
      const IR = { ...st.ir, motion };
      return [{ id: `preview-ir-${motion}`, ...Z([...bowl, ...floorKeys()], 'ir', IR.a, '#000000', irFields(IR)) }];
    },
    // the GROUPING tab, and zones for a preview of any grouping (a preset's
    // tile, or the map of the zones)
    get group() { return clone(st.group); },
    setGroup,
    previewGroup(patch = {}, id = 'now') {
      const G = { ...st.group, ...clone(patch) };
      return [{ id: `preview-group-${id}`, ...Z([...bowl, ...floorKeys()], 'group', '#ffffff', '#000000', groupFields(G, stageOrigin())) }];
    },
    get tempo() { return st.tempo; },
    setTempo,
    // the Your message effect: its words, colour and lettering
    get text() { return { ...st.text }; },
    setText,
    // triggers keep shows (pads.js), and fades dim them while they run
    snapshot, restore, describe: showName,
    fadeTo: (to, seconds) => engine.fadeTo(to, seconds),
    fadeLoop: (seconds) => engine.fadeLoop(seconds),
    get level() { return engine.level; },
    get looping() { return engine.looping; },
    get fading() { return engine.fading; },
    pairs: PAIRS,
    // zones for a preset's preview (its message included), in the current colours
    previewZones(id) {
      const d = DEMOS.find((o) => o.id === id);
      if (!d) return [];
      const zs = demoZones(d);
      if (d.text) zs.push({ ...textZone(), id: 'preview-message', sections: ring(0) });
      return zs;
    },
    get hasShow() { return showZones().length > 0; },
    set onRender(fn) { onRender = fn; },
  };
}
