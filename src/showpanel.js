// SHOW: the simple panel. Everything a demo needs, top to bottom:
//   GRID / WASH / IR / GROUPING  the four kinds of show. GRID plays pictures
//                across the seats, the way a video does. WASH gives every band
//                the same effect at the same moment, the way the PixMob node
//                drives a crowd: an effect, a colour, a speed and a probability
//                (how many of the bands catch each hit). IR sends that same
//                command from moving heads round the bowl, so only the bands
//                inside their beams catch it (irheads.js). GROUPING makes
//                every section of the bowl a zone (the floor one more), cuts
//                each into groups with their own effects and colours, and
//                lights them in turn: chases and patterns with timing
//   TRIGGERS     the pads (1-0, pads.js): keep the effect on screen on one
//                ("Add current previewed effect to trigger"), fire it later
//   FADE         a master level over the show and fades on it: the effect
//                keeps running while it darkens or comes back
//   PIXELS       what is in the room (the seat pixels, the people, the bands
//                in their hands) and the speed and size of pixels and bands
//   ROOM         every light in the arena off; how hard the screens glow
//   CAMERA       jump to an angle; record a 15-second video of the show
// Painting sections and writing text sit behind "Customise" (showdesigner.js).
// The look borrows from the Mac of 2008 (gel buttons, a glossy title bar,
// disclosure triangles, a HUD panel), drawn for a dark screen.
import { makeMovable } from './windows.js';
import { LOOK, WASH_FX, WASH_COLOURS, GROUP_ORDERS, GROUP_INNER, GROUP_SPLITS, GROUP_COLOURING, FLOOR_MODES, GROUP_FX, drawThumb } from './showlooks.js';
import { MOTIONS, MOTION, GOBOS, setGoboScale, setHeadCap } from './irheads.js';
import { createFadeEditor } from './fadeeditor.js';

const PREFS_KEY = 'ht-showpanel';
const srgb = (hex) => { const n = parseInt(String(hex).slice(1), 16) || 0; return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
// slider 0..1 <-> a speed, even by ear: every halving and doubling is the same step
const logMap = (v, lo, hi) => lo * (hi / lo) ** v;
const logUnmap = (s, lo, hi) => Math.min(1, Math.max(0, Math.log(s / lo) / Math.log(hi / lo)));
const lin = (v, lo, hi) => lo + (hi - lo) * v;
const linUnmap = (s, lo, hi) => Math.min(1, Math.max(0, (s - lo) / (hi - lo)));

// The pixel setting: what is in the room. Each with a little picture: seat
// pixels (a block of dots), a person, and a band lit in their hand.
const DOTS = [8, 20, 32].flatMap((x) => [9, 20].map((y) => `<circle cx="${x}" cy="${y}" r="3.2"/>`)).join('');
const PERSON = '<g class="p"><circle cx="20" cy="8.5" r="4.2"/><path d="M12 27c0-8 3.6-11.5 8-11.5s8 3.5 8 11.5z"/></g>';
const BAND = '<path class="a" d="M25.5 17.5 30 12.5" /><circle class="b" cx="30.6" cy="11.4" r="2.8"/>';
const svg = (inner) => `<svg viewBox="0 0 40 28" aria-hidden="true">${inner}</svg>`;
const MODES = [
  ['seats', 'Seat pixels', svg(`<g class="d">${DOTS}</g>`)],
  ['people', 'Pixels + people', svg(`<g class="d dim">${DOTS}</g>${PERSON}`)],
  ['all', 'Pixels, people + bands', svg(`<g class="d dim">${DOTS}</g>${PERSON}${BAND}`)],
  ['bands', 'People + bands', svg(`${PERSON}${BAND}`)],
];
// WASH presets: one tap sets the effect, colour, speed and probability together
const WASH_PRESETS = [
  ['heartbeat', 'Heartbeat', { fx: 'pulse', a: '#ff1818', cmode: 'a', speed: 1.5, prob: 1 }],
  ['twinkle', 'Twinkle', { fx: 'solid', a: '#ffffff', cmode: 'a', speed: 1.6, prob: 0.25 }],
  ['lightning', 'Lightning', { fx: 'strobe', a: '#ffffff', cmode: 'a', speed: 1, prob: 0.35 }],
  ['sparkle', 'Rainbow sparkle', { fx: 'solid', a: '#ffffff', cmode: 'rainbow', speed: 1.4, prob: 0.5 }],
  ['disco', 'Disco strobe', { fx: 'strobe', a: '#ffffff', cmode: 'rainbow', speed: 1, prob: 1 }],
  ['ocean', 'Ocean breathe', { fx: 'fade', a: '#00ced1', cmode: 'a', speed: 0.7, prob: 1 }],
  ['gold', 'Golden glow', { fx: 'fade', a: '#ff7800', cmode: 'a', speed: 0.5, prob: 1 }],
  ['rise', 'Rise up', { fx: 'open', a: '#a032ff', cmode: 'a', speed: 1, prob: 1 }],
  ['drop', 'The drop', { fx: 'close', a: '#1e5aff', cmode: 'a', speed: 1.2, prob: 1 }],
  ['cycle', 'Colour cycle', { fx: 'solid', a: '#ffffff', cmode: 'cycle', speed: 0.6, prob: 1 }],
  ['flicker', 'Fire flicker', { fx: 'solid', a: '#ff7800', cmode: 'a', speed: 2.8, prob: 0.6 }],
  ['party', 'Party pulse', { fx: 'pulse', a: '#ffffff', cmode: 'cycle', speed: 1.4, prob: 1 }],
];
// GROUPING presets: the groups in every section and what each plays, the
// floor's own effect, and how the sections and their groups take turns
const NODE = { white: '#ffffff', red: '#ff1818', orange: '#ff7800', yellow: '#ffff28', green: '#00ff50', turq: '#00ced1', blue: '#1e5aff', purple: '#a032ff', pink: '#ff50c8' };
const fxs = (fx, ...cols) => [...Array(4)].map((_, k) => ({ fx, a: cols[k % cols.length] }));
// the floor: its effect, its colours (it is cut into one part per colour) and when it lights
const FL = (fx, cols, mode = 'always') => { const c = [].concat(cols); return { fx, cols: c, a: c[0], mode }; };
const GROUP_PRESETS = [
  ['around', 'Around the bowl', { groups: 1, order: 'around', inner: 'together', step: 0.09, tail: 3, base: 0.03, cmode: 'group', fx: fxs('solid', NODE.turq), floor: FL('pulse', NODE.white) }],
  ['triple', 'Triple chase', { groups: 3, gsplit: 'across', order: 'all', inner: 'chase', step: 0.16, tail: 0.6, base: 0, cmode: 'group', fx: fxs('solid', NODE.red, NODE.white, NODE.blue), floor: FL('solid', [NODE.red, NODE.white, NODE.blue]) }],
  ['rowclimb', 'Row climb', { groups: 3, gsplit: 'rows', order: 'all', inner: 'chase', step: 0.2, tail: 0.8, base: 0.05, cmode: 'group', fx: fxs('solid', NODE.purple, NODE.pink, NODE.white), floor: FL('pulse', NODE.purple) }],
  ['tierclimb', 'Tier climb', { groups: 1, order: 'climb', inner: 'together', step: 0.4, tail: 0.5, base: 0, cmode: 'tier', fx: fxs('solid', NODE.white), floor: FL('solid', NODE.white, 'chase') }],
  ['snake', 'Snake', { groups: 1, order: 'snake', inner: 'together', step: 0.05, tail: 8, base: 0, cmode: 'rainbow', fx: fxs('solid', NODE.white), floor: FL('fade', NODE.blue) }],
  ['sides', 'Both sides', { groups: 1, order: 'sides', inner: 'together', step: 0.13, tail: 2, base: 0.02, cmode: 'group', fx: fxs('solid', NODE.orange), floor: FL('pulse', NODE.orange) }],
  ['stage', 'From the stage', { groups: 1, order: 'stage', inner: 'together', step: 0.14, tail: 1.5, base: 0, cmode: 'group', fx: fxs('solid', NODE.pink), floor: FL('solid', NODE.pink, 'chase') }],
  ['checker', 'Checkerboard', { groups: 1, order: 'alternate', inner: 'together', step: 0.35, tail: 0.2, base: 0, cmode: 'group', fx: fxs('solid', NODE.red), floor: FL('solid', [NODE.red, NODE.white]) }],
  ['pops', 'Section pops', { groups: 3, gsplit: 'scatter', order: 'random', inner: 'random', step: 0.14, tail: 1, base: 0, cmode: 'rainbow', fx: fxs('solid', NODE.white), floor: FL('twinkle', [NODE.white, NODE.pink, NODE.turq]) }],
  ['build', 'Build round', { groups: 1, order: 'build', inner: 'together', step: 0.07, tail: 0, base: 0, cmode: 'group', fx: fxs('solid', NODE.yellow), floor: FL('solid', NODE.yellow, 'chase') }],
  ['tricolour', 'Three colours', { groups: 3, gsplit: 'across', order: 'all', inner: 'together', step: 0.5, tail: 0, base: 0, cmode: 'group',
    fx: [{ fx: 'pulse', a: NODE.red }, { fx: 'solid', a: NODE.white }, { fx: 'pulse', a: NODE.blue }, { fx: 'solid', a: NODE.white }], floor: FL('fade', [NODE.red, NODE.white, NODE.blue]) }],
  ['cascade', 'Cascade', { groups: 3, gsplit: 'rows', order: 'around', inner: 'chase', step: 0.18, tail: 2, base: 0.04, cmode: 'rainbow', fx: fxs('solid', NODE.white), floor: FL('pulse', NODE.white) }],
];
// More GROUPING presets, so there are as many as GRID has. Their colours are
// a starting point: the colours you pick recolour them (tintGroup).
const GP = (id, name, o) => [id, name, {
  groups: 1, gsplit: 'across', order: 'around', inner: 'together', dir: 1, step: 0.15, tail: 1, base: 0, cmode: 'group',
  fx: fxs('solid', NODE.blue, NODE.white), floor: FL('pulse', NODE.blue), ...o,
}];
GROUP_PRESETS.push(
  GP('pingpong', 'Ping-pong', { order: 'pingpong', step: 0.1, tail: 2 }),
  GP('pingpong3', 'Ping-pong trio', { groups: 3, inner: 'chase', order: 'pingpong', step: 0.14, tail: 1.5 }),
  GP('snakerows', 'Row snake', { groups: 3, gsplit: 'rows', order: 'snake', inner: 'chase', step: 0.06, tail: 4 }),
  GP('sidesstrobe', 'Strobe sides', { order: 'sides', step: 0.2, tail: 0.5, fx: fxs('strobe', NODE.white), floor: FL('strobe', NODE.white, 'chase') }),
  GP('climbpulse', 'Pulse climb', { order: 'climb', step: 0.5, tail: 0.6, fx: fxs('pulse', NODE.pink) }),
  GP('stagefade', 'Stage fade', { order: 'stage', step: 0.25, tail: 3, fx: fxs('fade', NODE.turq), floor: FL('fade', NODE.turq, 'chase') }),
  GP('buildfast', 'Fast build', { order: 'build', step: 0.035, tail: 0, fx: fxs('solid', NODE.orange) }),
  GP('randomtwinkle', 'Random twinkle', { order: 'random', step: 0.12, tail: 0.5, fx: fxs('twinkle', NODE.white), floor: FL('twinkle', NODE.white) }),
  GP('twotone', 'Two-tone', { groups: 2, order: 'alternate', inner: 'alternate', step: 0.4, tail: 0.2 }),
  GP('risingrows', 'Rising rows', { groups: 4, gsplit: 'rows', order: 'all', inner: 'chase', step: 0.12, tail: 0.8, fx: fxs('open', NODE.purple) }),
  GP('fallingrows', 'Falling rows', { groups: 4, gsplit: 'rows', order: 'all', inner: 'chase', dir: -1, step: 0.12, tail: 0.8, fx: fxs('close', NODE.blue) }),
  GP('scatterpops', 'Scatter pops', { groups: 4, gsplit: 'scatter', order: 'random', inner: 'random', step: 0.1, tail: 0.6, fx: fxs('pulse', NODE.yellow) }),
  GP('cometring', 'Comet ring', { order: 'around', step: 0.08, tail: 3, fx: fxs('comets', NODE.white) }),
  GP('chevronchase', 'Chevron chase', { order: 'around', step: 0.2, tail: 1, fx: fxs('chevrons', NODE.red) }),
  GP('sparklewave', 'Sparkle wave', { order: 'around', step: 0.1, tail: 4, base: 0.05, fx: fxs('sparkle', NODE.white), floor: FL('sparkle', NODE.white) }),
  GP('flowsnake', 'Flow snake', { order: 'snake', step: 0.07, tail: 5, fx: fxs('flow', NODE.pink, NODE.blue) }),
  GP('scannerclimb', 'Scanner climb', { order: 'climb', step: 0.45, tail: 0.4, fx: fxs('scanner', NODE.green) }),
  GP('firering', 'Fire ring', { order: 'around', step: 0.1, tail: 3, fx: fxs('fire', NODE.orange), floor: FL('fire', NODE.orange) }),
  GP('doublechase', 'Double chase', { groups: 2, order: 'around', inner: 'chase', step: 0.1, tail: 2 }),
  GP('sidesrows', 'Sides by rows', { groups: 3, gsplit: 'rows', order: 'sides', inner: 'chase', step: 0.15, tail: 1 }),
  GP('stagewash', 'Stage wash', { order: 'stage', step: 0.1, tail: 8, fx: fxs('solid', NODE.purple) }),
  GP('fullstrobe', 'Full strobe', { order: 'all', step: 1, tail: 0, fx: fxs('strobe', NODE.white), floor: FL('strobe', NODE.white) }),
  GP('breathe', 'Breathe', { order: 'all', step: 1, tail: 0, fx: fxs('fade', NODE.blue), floor: FL('fade', NODE.blue) }),
  GP('tierstrobe', 'Tier strobe', { order: 'climb', step: 0.25, tail: 0, fx: fxs('strobe', NODE.white) }),
  GP('randomflash', 'Random flash', { order: 'random', step: 0.08, tail: 0, fx: fxs('strobe', NODE.white), floor: FL('twinkle', NODE.white) }),
  GP('halfhalf', 'Half and half', { groups: 2, order: 'alternate', step: 0.6, tail: 0, fx: fxs('pulse', NODE.red, NODE.blue) }),
  GP('heartround', 'Heartbeat round', { order: 'around', step: 0.3, tail: 1.5, fx: fxs('pulse', NODE.red), floor: FL('pulse', NODE.red) }),
  GP('rowscanner', 'Row scanner', { groups: 4, gsplit: 'rows', order: 'all', inner: 'chase', step: 0.1, tail: 1 }),
  GP('slowsnake', 'Slow snake', { order: 'snake', step: 0.2, tail: 6, fx: fxs('fade', NODE.turq) }),
  GP('bouncesparkle', 'Bounce sparkle', { order: 'pingpong', step: 0.12, tail: 2, fx: fxs('sparkle', NODE.yellow) }),
  GP('fastcascade', 'Fast cascade', { groups: 3, gsplit: 'rows', order: 'around', inner: 'chase', step: 0.09, tail: 2 }),
  GP('slowaround', 'Slow round', { order: 'around', step: 0.3, tail: 4, fx: fxs('fade', NODE.blue) }),
  GP('quadchase', 'Four-way chase', { groups: 4, order: 'all', inner: 'chase', step: 0.12, tail: 1 }),
  GP('scatterfade', 'Scatter fade', { groups: 4, gsplit: 'scatter', order: 'all', inner: 'random', step: 0.3, tail: 1.5, fx: fxs('fade', NODE.white) }),
  GP('sidesbuild', 'Sides build', { order: 'sides', step: 0.06, tail: 8 }),
  GP('climbsparkle', 'Sparkle climb', { order: 'climb', step: 0.4, tail: 1, fx: fxs('sparkle', NODE.white) }),
  GP('stagestrobe', 'Stage strobe', { order: 'stage', step: 0.08, tail: 0.5, fx: fxs('strobe', NODE.white) }),
  GP('alternaterows', 'Alternate rows', { groups: 2, gsplit: 'rows', order: 'all', inner: 'alternate', step: 0.35, tail: 0 }),
  GP('snakepulse', 'Pulse snake', { order: 'snake', step: 0.08, tail: 3, fx: fxs('pulse', NODE.pink) }),
  GP('randomrows', 'Random rows', { groups: 4, gsplit: 'rows', order: 'random', inner: 'random', step: 0.1, tail: 0.8 }),
  GP('pingpongfade', 'Ping-pong fade', { order: 'pingpong', step: 0.15, tail: 3, fx: fxs('fade', NODE.purple) }),
  GP('buildstrobe', 'Strobe build', { order: 'build', step: 0.05, tail: 0, fx: fxs('strobe', NODE.white) }),
  GP('cometpairs', 'Comet pairs', { groups: 2, order: 'around', inner: 'chase', step: 0.09, tail: 2.5, fx: fxs('comets', NODE.turq, NODE.white) }),
);
// a grouping preset in the colours picked: groups alternate the two, the floor takes them too
// (presets that colour by the rainbow keep it)
function tintGroup(P, C) {
  if (C?.rainbow) return { cmode: 'rainbow' };
  const L = C?.list || [];
  if (!L.length || P.cmode === 'rainbow') return {};
  return {
    cmode: 'group',
    fx: P.fx.map((z, k) => ({ ...z, a: L[k % L.length] })),   // the groups take the colours in turn
    floor: { ...P.floor, cols: P.floor.cols.length > 1 ? L.slice(0, 4) : [L[0]], a: L[0] },
  };
}
// ready-made colour sets, two to four colours each
const COMBOS = [
  ['Tropical', ['#ff4f9a', '#ffd23a', '#2fe6c0']], ['Sunset', ['#ff3d6e', '#ff8a2a', '#ffd23a']], ['Ocean', ['#1e5aff', '#00ced1', '#ffffff']],
  ['Party', ['#ff2fd2', '#2fe6ff', '#ffe22f', '#7a2fff']], ['Fire and ice', ['#ff3d00', '#ffb000', '#2fe6ff', '#ffffff']], ['Neon', ['#d8ff3a', '#ff2fd2', '#2fe6ff']],
];
// the next colour to offer when one is added
const ADD_COLOURS = ['#ff2f6e', '#2fe6ff', '#ffd23a', '#7a2fff', '#00e676', '#ff8a2a', '#ffffff'];
// MH: the moving-head presets, as many as GRID has. Each is a movement with
// its own effect, gobo and beam size; colour is the one you pick (unless the
// preset brings rainbow or cycling colour)
const MH = (id, name, motion, fx, gobo, size, o = {}) => [id, name, { motion, fx, gobo, size, ...o }];
const MH_PRESETS = [
  ...MOTIONS.map((m) => [m.id, m.name, { motion: m.id, fx: m.fx, gobo: m.gobo, size: m.size, heads: m.heads ?? 0 }]),
  MH('starsweep', 'Star sweep', 'sweep', 'solid', 'star', 1.2),
  MH('strobesweep', 'Strobe sweep', 'sweep', 'strobe', 'circle', 1),
  MH('barwave', 'Bar wave', 'wave', 'solid', 'bars', 1.3),
  MH('flowercircles', 'Flower circles', 'circles', 'fade', 'flower', 1.4),
  MH('dot8', 'Dotted figure 8', 'figure8', 'solid', 'dots', 1.1),
  MH('risingstars', 'Rising stars', 'rise', 'pulse', 'star', 1.2),
  MH('strobecross', 'Strobe crossfire', 'cross', 'strobe', 'circle', 1),
  MH('ringlighthouse', 'Ring lighthouse', 'lighthouse', 'solid', 'ring', 1.3),
  MH('pulsefocus', 'Pulse focus', 'focus', 'pulse', 'circle', 1.6),
  MH('trisearch', 'Triangle search', 'search', 'solid', 'triangle', 1),
  MH('crosssnap', 'Cross snap', 'snap', 'strobe', 'cross', 1.3),
  MH('rainbowbally', 'Rainbow ballyhoo', 'ballyhoo', 'solid', 'star', 1.1, { cmode: 'rainbow' }),
  MH('cyclekaleido', 'Colour kaleidoscope', 'kaleido', 'fade', 'flower', 1.6, { cmode: 'cycle' }),
  MH('floorpulse', 'Floor pulse', 'floorsweep', 'pulse', 'circle', 1.3),
  MH('splitstrobe', 'Split strobe', 'split', 'strobe', 'dots', 1.1),
  MH('ringcascade', 'Ring cascade', 'cascade', 'solid', 'ring', 1.2),
  MH('slowbig', 'Slow big sweep', 'bigsweep', 'fade', 'circle', 3.6, { heads: 3, speed: 0.6 }),
  MH('threestrobes', 'Three strobes', 'threeacross', 'strobe', 'circle', 3, { heads: 3 }),
  MH('starlights', 'Star searchlights', 'searchlights', 'solid', 'star', 3.2, { heads: 3 }),
  MH('rainbowtide', 'Rainbow tide', 'tide', 'fade', 'circle', 4, { heads: 3, cmode: 'rainbow' }),
  MH('fastsweep', 'Fast sweep', 'sweep', 'close', 'circle', 0.9, { speed: 1.8 }),
  MH('colourwave', 'Colour wave', 'wave', 'solid', 'circle', 1.2, { cmode: 'cycle' }),
  MH('dotcircles', 'Dot circles', 'circles', 'pulse', 'dots', 1.3),
  MH('slowsearch', 'Slow search', 'search', 'fade', 'circle', 1.2, { speed: 0.5 }),
  MH('flowerbally', 'Flower ballyhoo', 'ballyhoo', 'solid', 'flower', 1.3),
  MH('trianglewave', 'Triangle wave', 'wave', 'close', 'triangle', 1.2),
  MH('bigstars', 'Big stars', 'bigsweep', 'solid', 'star', 3.4, { heads: 3 }),
  MH('crossring', 'Ring crossfire', 'cross', 'solid', 'ring', 1.3),
  MH('fastfig8', 'Fast figure 8', 'figure8', 'strobe', 'circle', 0.9, { speed: 1.7 }),
  MH('tidebars', 'Bar tide', 'tide', 'solid', 'bars', 3.6, { heads: 3 }),
  MH('cyclecascade', 'Colour cascade', 'cascade', 'fade', 'circle', 1.2, { cmode: 'cycle' }),
  MH('lighthousestar', 'Star lighthouse', 'lighthouse', 'close', 'star', 1.2),
  MH('focusflower', 'Flower focus', 'focus', 'fade', 'flower', 1.8),
  MH('floordots', 'Dotted floor', 'floorsweep', 'solid', 'dots', 1.4),
  MH('rainbowsnap', 'Rainbow snap', 'snap', 'strobe', 'dots', 1.2, { cmode: 'rainbow' }),
];
const MHP = Object.fromEntries(MH_PRESETS.map(([id, n, P]) => [id, { id, name: n, ...P }]));
// UNIFYING (the wash, sent over RF): pick a colour, then the vibe
const UNIFY = [
  ['glow', 'Glow', { fx: 'solid', cmode: 'a', speed: 1, prob: 1 }],
  ['breathe', 'Breathe', { fx: 'fade', cmode: 'a', speed: 0.7, prob: 1 }],
  ['heartbeat', 'Heartbeat', { fx: 'pulse', cmode: 'a', speed: 1.5, prob: 1 }],
  ['strobe', 'Strobe', { fx: 'strobe', cmode: 'a', speed: 1, prob: 1 }],
  ['twinkle', 'Twinkle', { fx: 'solid', cmode: 'a', speed: 1.6, prob: 0.25 }],
  ['flicker', 'Flicker', { fx: 'solid', cmode: 'a', speed: 2.8, prob: 0.6 }],
  ['rise', 'Rise up', { fx: 'open', cmode: 'a', speed: 1, prob: 1 }],
  ['drop', 'The drop', { fx: 'close', cmode: 'a', speed: 1.2, prob: 1 }],
  ['rainbow', 'Rainbow', { fx: 'solid', cmode: 'rainbow', speed: 1.4, prob: 0.5 }],
  ['cycle', 'Colour cycle', { fx: 'solid', cmode: 'cycle', speed: 0.6, prob: 1 }],
  ['slowstrobe', 'Slow strobe', { fx: 'strobe', cmode: 'a', speed: 0.45, prob: 1 }],
  ['shimmer', 'Shimmer', { fx: 'solid', cmode: 'a', speed: 2, prob: 0.4 }],
  ['swell', 'Swell', { fx: 'open', cmode: 'a', speed: 0.5, prob: 1 }],
  ['racing', 'Racing heart', { fx: 'pulse', cmode: 'a', speed: 2.4, prob: 1 }],
  ['sparks', 'Sparks', { fx: 'strobe', cmode: 'a', speed: 1, prob: 0.3 }],
  ['fadeout', 'Fade away', { fx: 'close', cmode: 'a', speed: 0.5, prob: 1 }],
  ['candle', 'Candlelight', { fx: 'solid', cmode: 'a', speed: 0.9, prob: 0.8 }],
  ['starfield', 'Starfield', { fx: 'solid', cmode: 'a', speed: 0.6, prob: 0.12 }],
  ['ocean', 'Tide', { fx: 'fade', cmode: 'a', speed: 0.35, prob: 1 }],
  ['bounce', 'Bounce', { fx: 'pulse', cmode: 'a', speed: 1.1, prob: 1 }],
  ['thunder', 'Thunder', { fx: 'strobe', cmode: 'a', speed: 0.7, prob: 0.18 }],
  ['popcorn', 'Popcorn', { fx: 'pulse', cmode: 'a', speed: 1.8, prob: 0.35 }],
  ['risefast', 'Fast rise', { fx: 'open', cmode: 'a', speed: 1.8, prob: 1 }],
  ['dropfast', 'Fast drop', { fx: 'close', cmode: 'a', speed: 2, prob: 1 }],
  ['rainbowpulse', 'Rainbow pulse', { fx: 'pulse', cmode: 'rainbow', speed: 1.2, prob: 1 }],
  ['rainbowstrobe', 'Rainbow strobe', { fx: 'strobe', cmode: 'rainbow', speed: 1, prob: 1 }],
  ['cyclebreathe', 'Colour breathe', { fx: 'fade', cmode: 'cycle', speed: 0.6, prob: 1 }],
  ['confetti', 'Confetti', { fx: 'solid', cmode: 'rainbow', speed: 2.2, prob: 0.35 }],
];
const UNI = Object.fromEntries(UNIFY.map(([id, n, P]) => [id, { id, name: n, ...P }]));
// one colour per group round the colour wheel, for the Rainbow fill
const wheel = (k, n) => {
  const h = (k / n) * 6, x = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${x(Math.abs(h - 3) - 1)}${x(2 - Math.abs(h - 2))}${x(2 - Math.abs(h - 4))}`;
};
const sameWash = (w, p) => w.fx === p.fx && w.cmode === p.cmode && (p.cmode !== 'a' || w.a.toLowerCase() === p.a.toLowerCase())
  && Math.abs(w.speed - p.speed) < 0.02 && Math.abs(w.prob - p.prob) < 0.02;
// the gobos as little pictures, for their buttons
const GOBO_ICON = {
  circle: '<circle cx="10" cy="10" r="7.5"/>',
  ring: '<circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2.6"/>',
  star: '<path d="M10 1.8l2.4 5.3 5.8.6-4.4 3.9 1.3 5.7L10 14.4l-5.1 2.9 1.3-5.7-4.4-3.9 5.8-.6z"/>',
  triangle: '<path d="M10 2.2 18 16.4H2z"/>',
  bars: '<rect x="3" y="3" width="3" height="14" rx="1"/><rect x="8.5" y="3" width="3" height="14" rx="1"/><rect x="14" y="3" width="3" height="14" rx="1"/>',
  dots: '<circle cx="10" cy="10" r="2.2"/><circle cx="15.6" cy="10" r="2.2"/><circle cx="4.4" cy="10" r="2.2"/><circle cx="12.8" cy="14.8" r="2.2"/><circle cx="7.2" cy="14.8" r="2.2"/><circle cx="12.8" cy="5.2" r="2.2"/><circle cx="7.2" cy="5.2" r="2.2"/>',
  flower: '<circle cx="10" cy="10" r="2.6"/><circle cx="10" cy="4.2" r="3"/><circle cx="10" cy="15.8" r="3"/><circle cx="5" cy="7.1" r="3"/><circle cx="15" cy="7.1" r="3"/><circle cx="5" cy="12.9" r="3"/><circle cx="15" cy="12.9" r="3"/>',
  cross: '<path d="M8 2.5h4v5.5h5.5v4H12v5.5H8V12H2.5V8H8z"/>',
};
// every slider runs 0..1 and maps onto what it sets
// how many moving heads hang in this room (the Moving heads slider's top end; set at start)
let HEADS = 24;
const TUNE = {
  wspeed: { to: (v) => logMap(v, 0.35, 2.8), from: (s) => logUnmap(s, 0.35, 2.8), fmt: (s) => `${s.toFixed(1)}×` },
  wprob: { to: (v) => lin(v, 0.05, 1), from: (s) => linUnmap(s, 0.05, 1), fmt: (s) => `${Math.round(s * 100)}%` },
  pspeed: { to: (v) => logMap(v, 0.25, 3), from: (s) => logUnmap(s, 0.25, 3), fmt: (s) => `${s.toFixed(1)}×` },
  // sizes up to 300%: the seat pixels of their built size (0.5), the bands in hand of theirs (0.25)
  // glow: how far past the bloom the dots are pushed (100%: as built)
  // Settings → Sound: the video's mix when it uses the venue's speakers
  mmusic: { to: (v) => v * 2, from: (s) => Math.min(1, s / 2), fmt: (s) => `${Math.round(s * 100)}%` },
  mcrowd: { to: (v) => v * 1.5, from: (s) => Math.min(1, s / 1.5), fmt: (s) => `${Math.round(s * 100)}%` },
  mroom: { to: (v) => v * 2, from: (s) => Math.min(1, s / 2), fmt: (s) => `${Math.round(s * 100)}%` },
  mbass: { to: (v) => lin(v, -6, 9), from: (s) => linUnmap(s, -6, 9), fmt: (s) => `${s > 0 ? '+' : ''}${s.toFixed(0)} dB` },
  mmid: { to: (v) => lin(v, -10, 10), from: (s) => linUnmap(s, -10, 10), fmt: (s) => `${s > 0 ? '+' : ''}${s.toFixed(0)} dB` },
  mtreble: { to: (v) => lin(v, -12, 12), from: (s) => linUnmap(s, -12, 12), fmt: (s) => `${s > 0 ? '+' : ''}${s.toFixed(0)} dB` },
  msub: { to: (v) => v * 2, from: (s) => Math.min(1, s / 2), fmt: (s) => `${Math.round(s * 100)}%` },
  mrear: { to: (v) => v * 2, from: (s) => Math.min(1, s / 2), fmt: (s) => `${Math.round(s * 100)}%` },
  mpunch: { to: (v) => v, from: (s) => s, fmt: (s) => `${Math.round(s * 100)}%` },
  // the speed of the effect, per tab: 0 holds it still, 100% as designed, 200% double
  espd: { to: (v) => v * 2, from: (s) => Math.min(1, Math.max(0, s / 2)), fmt: (s) => `${Math.round(s * 100)}%` },
  // MH gobo size: 30% to 300% of each effect's own beam
  mhsize: { to: (v) => lin(v, 0.3, 3), from: (s) => linUnmap(s, 0.3, 3), fmt: (s) => `${Math.round(s * 100)}%` },
  // how many moving heads an effect may use: one, up to every head in the room
  mhheads: { to: (v) => Math.round(lin(v, 1, HEADS)), from: (s) => linUnmap(s, 1, HEADS), fmt: (s) => (s >= HEADS ? `All ${HEADS}` : `${Math.round(s)}`) },
  pglow: { to: (v) => lin(v, 0.3, 2.5), from: (s) => linUnmap(s, 0.3, 2.5), fmt: (s) => `${Math.round(s * 100)}%` },
  bglow: { to: (v) => lin(v, 0.3, 2.5), from: (s) => linUnmap(s, 0.3, 2.5), fmt: (s) => `${Math.round(s * 100)}%` },
  psize: { to: (v) => lin(v, 0.2, 1.5), from: (s) => linUnmap(s, 0.2, 1.5), fmt: (s) => `${Math.round((s / 0.5) * 100)}%` },
  bspeed: { to: (v) => logMap(v, 0.2, 3), from: (s) => logUnmap(s, 0.2, 3), fmt: (s) => `${s.toFixed(1)}×` },
  bsize: { to: (v) => lin(v, 0.08, 0.75), from: (s) => linUnmap(s, 0.08, 0.75), fmt: (s) => `${Math.round((s / 0.25) * 100)}%` },
  ispeed: { to: (v) => logMap(v, 0.25, 3), from: (s) => logUnmap(s, 0.25, 3), fmt: (s) => `${s.toFixed(1)}×` },
  isize: { to: (v) => lin(v, 0.4, 4.5), from: (s) => linUnmap(s, 0.4, 4.5), fmt: (s) => `${Math.round(s * 100)}%` },
  iprob: { to: (v) => lin(v, 0.05, 1), from: (s) => linUnmap(s, 0.05, 1), fmt: (s) => `${Math.round(s * 100)}%` },
  flevel: { to: (v) => v, from: (s) => s, fmt: (s) => `${Math.round(s * 100)}%` },
  ftime: { to: (v) => logMap(v, 0.5, 20), from: (s) => logUnmap(s, 0.5, 20), fmt: (s) => `${s < 10 ? s.toFixed(1) : Math.round(s)} s` },
  sglow: { to: (v) => lin(v, 0, 1.5), from: (s) => linUnmap(s, 0, 1.5), fmt: (s) => `${Math.round(s * 100)}%` },
  // grouping: a step's length, the trail, the resting level, the effects' speed
  gstep: { to: (v) => logMap(v, 0.05, 3), from: (s) => logUnmap(s, 0.05, 3), fmt: (s) => `${s < 1 ? s.toFixed(2) : s.toFixed(1)} s` },
  gtail: { to: (v) => lin(v, 0, 4), from: (s) => linUnmap(s, 0, 4), fmt: (s) => (s < 0.05 ? 'Off' : s.toFixed(1)) },
  gbase: { to: (v) => lin(v, 0, 0.5), from: (s) => linUnmap(s, 0, 0.5), fmt: (s) => `${Math.round(s * 100)}%` },
  gspeed: { to: (v) => logMap(v, 0.35, 2.8), from: (s) => logUnmap(s, 0.35, 2.8), fmt: (s) => `${s.toFixed(1)}×` },
  bloom: { to: (v) => lin(v, 0, 1.5), from: (s) => linUnmap(s, 0, 1.5), fmt: (s) => `${Math.round(s * 100)}%` },
};
// Settings → Sound: each slider and the part of the mix it sets
const MIXK = { mmusic: 'music', mcrowd: 'crowd', mroom: 'room', mbass: 'bass', mmid: 'mid', mtreble: 'treble', msub: 'sub', mrear: 'rear', mpunch: 'punch' };
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function initShowPanel({ designer, orbFX, controls, audience, room, ir, pads, glow, fadeNow, angles, setAngle, record, song, songTitle, songLen, stageLights, venueSound, shots, camView, venue, preview, visible }) {
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (_) { /* first visit */ }
  const save = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* private mode */ } };
  prefs.sec = prefs.sec || {};
  // the Menu's groups start folded, so the Menu reads as a short list
  for (const k of ['pixels', 'room', 'sound', 'vidset']) if (prefs.sec[k] === undefined) prefs.sec[k] = true;
  if (!['wash', 'ir', 'group'].includes(prefs.kind)) prefs.kind = 'grid';
  ir?.setBeams(!!prefs.beams);   // the IR signal is invisible unless asked for
  setGoboScale(prefs.goboK || 1);   // the MH gobo size, as it was left
  HEADS = Math.max(1, ir?.count || HEADS);
  setHeadCap(prefs.headCap && prefs.headCap < HEADS ? prefs.headCap : 0);   // and how many heads, as left
  // "Use stage lights" and "Use venue speakers" start ON (asked for 2026-10-08),
  // and only work in a concert: anything else greys them out and leaves them idle
  if (!prefs.concertDefaults) { prefs.stageLights = true; prefs.recVenue = true; prefs.concertDefaults = 1; save(); }
  const concertNow = () => !!stageLights?.concert;
  if (prefs.stageLights && concertNow()) stageLights?.set(true);
  venueSound?.setCrowd(prefs.recCrowd !== false);   // Make a video → Use stage lights, as it was left
  if (!(prefs.fadeTime > 0)) prefs.fadeTime = 3;
  // the recording: its length, the outro, the song from the top
  if (!(prefs.recLen >= 3)) prefs.recLen = 30;
  for (const [k, d] of [['recOutro', true], ['recTop', true], ['recPull', true]]) if (typeof prefs[k] !== 'boolean') prefs[k] = d;
  if (!(prefs.recPullAt >= 0)) prefs.recPullAt = 40;
  if (![1080, 1440, 2160].includes(prefs.recSize)) prefs.recSize = 2160;   // how big the video is saved
  // the camera: shots of your own (a move from A to B at the time you choose,
  // kept per venue), and the camera's own between them, dealt from a seed
  // ("Mix it up" deals another run)
  if (!Number.isFinite(prefs.recSeed)) prefs.recSeed = 1;
  if (!prefs.recMyShots || typeof prefs.recMyShots !== 'object') prefs.recMyShots = {};
  const myShots = () => {
    if (!Array.isArray(prefs.recMyShots[venue])) {
      // views kept before shots had times become shots, spaced out
      const old = Array.isArray(prefs.recViews?.[venue]) ? prefs.recViews[venue] : [];
      prefs.recMyShots[venue] = old.map((v, k) => ({ t: 6 + k * 14, d: 6, a: v, b: null }));
    }
    return prefs.recMyShots[venue];
  };
  // what the shot plan is made from: the show's length (the outro off the end), the deal, your shots
  const shotArgs = () => [
    Math.max(3, prefs.recLen),   // the length is the show's (the song's); the outro goes on after
    null,
    { seed: prefs.recSeed, mine: myShots() },
  ];
  // the longest the show part can be: the whole song (the outro comes on top)
  const maxLen = () => {
    const L = songLen?.() || 0;
    return L > 0 ? Math.ceil(L) : 600;   // the song's length; the outro is added after it
  };
  const setLen = (n) => { prefs.recLen = Math.max(3, Math.min(maxLen(), Math.round(Number(n) || prefs.recLen))); save(); };
  const shotPlanNow = () => (shots ? shots.plan(...shotArgs()) : []);
  // the glow knobs are remembered: put them back the way they were left
  if (glow && prefs.glow != null) glow.setScreen(prefs.glow);
  if (glow && prefs.bloom != null) glow.setBloom(prefs.bloom);
  // how many heads send: 1 up to every head the room has (0 in the show = all)
  const NH = ir?.heads?.length || 1;
  TUNE.iheads = {
    to: (v) => Math.max(1, Math.round(1 + v * (NH - 1))),
    from: (s) => ((s || NH) - 1) / Math.max(1, NH - 1),
    fmt: (s) => `${s || NH} of ${NH}`,
  };
  let open = false, recording = false, renderAbort = null;
  let fadeFor = -1;   // the trigger whose fade line is open in the editor

  const showAngles = angles.filter((a) => a.show), otherAngles = angles.filter((a) => !a.show);
  const slider = (k, label) => `<label class="aqSlider" data-k="${k}"><span>${label}</span><input type="range" min="0" max="1" step="0.001" data-k="${k}" aria-label="${label}"><em></em></label>`;
  const sec = (id, title, body, extra = '') =>
    `<section class="aqSec" data-sec="${id}"><button class="aqSecHead" aria-expanded="true"><i></i>${title}${extra}</button><div class="aqSecBody">${body}</div></section>`;
  const root = document.createElement('div');
  root.id = 'showPanel';
  root.className = 'showPanel aq';
  root.innerHTML = `
    <div class="spHead">
      <button class="spClose" aria-label="Close" title="Close (O)"></button>
      <span class="spTitle">Show</span>
      <span class="spLive"><i></i><span></span></span>
      <button class="spOff aqBtn" title="Turn the wristbands off">Off</button>
    </div>
    <div class="spBody">
      <div class="aqSeg spKind" role="tablist">
        <button data-kind="grid" role="tab"><b>Grid</b></button>
        <button data-kind="wash" role="tab"><b>Unifying</b></button>
        <button data-kind="ir" role="tab"><b>MH</b></button>
        <button data-kind="group" role="tab"><b>Grouping</b></button>
      </div>
      <div class="spColRow"><div class="spSlots"></div><div class="spCombos"><button data-col="rainbow" class="spCombo spRainbowSw" title="Rainbow"></button>${[...designer.pairs.map(([a, b, n]) => [n, [a, b]]), ...COMBOS].map(([n, L], i) => `<button class="spCombo" data-combo="${i}" title="${n}" style="background:linear-gradient(90deg,${L.map((c, k) => `${c} ${(k / L.length) * 100}% ${((k + 1) / L.length) * 100}%`).join(',')})"></button>`).join('')}</div></div>
      <div class="spSpeedRow">${slider('espd', 'Speed of effect')}</div>
      <div class="spSpeedRow spGoboRow">${slider('mhsize', 'Gobo size')}</div>
      <div class="spSpeedRow spGoboRow spHeadsRow">${slider('mhheads', 'Moving heads')}</div>
      <div class="spPane" data-pane="grid">
        <div class="spPresets">${designer.demoList.map((d) => `<button class="spPreset" data-demo="${d.id}"><canvas></canvas><span>${d.name}</span></button>`).join('')}</div>
        <div class="spEdit">${sec('colours', 'Colours', `<div class="spPairs">${designer.pairs.map(([a, b, n], i) => `<button data-pair="${i}" title="${n}" style="--a:${a};--b:${b}"></button>`).join('')}
          <label class="spCustom" title="Your own colours"><input type="color" data-brand="a"><input type="color" data-brand="b"></label></div>
          <p class="spHint spGridHint"></p>`)}</div>
      </div>
      <div class="spPane" data-pane="wash">
        <div class="spFx"><button class="spFxTile spBlack" data-demo="blackout"><canvas></canvas><span>Blackout</span></button>${UNIFY.map(([id, n]) => `<button class="spFxTile" data-vibe="${id}"><canvas></canvas><span>${n}</span></button>`).join('')}</div>
        <div class="spEdit">        ${sec('effect', 'Effect', `<div class="spFx">${WASH_FX.map((w) => `<button class="spFxTile" data-fx="${w.id}"><canvas></canvas><span>${w.name}</span></button>`).join('')}</div>`)}
        ${sec('wcolour', 'Colour', `<div class="spSwatches">${WASH_COLOURS.map(([hex, n]) => `<button data-wcol="${hex}" title="${n}" style="--c:${hex}"></button>`).join('')}
          <button data-wmode="rainbow" class="spRainbow" title="Rainbow: every band its own colour, new on every hit"></button>
          <button data-wmode="cycle" class="spCycle" title="Cycle: the whole crowd steps through the colours together"></button>
          <label class="spWPick" title="Any colour"><input type="color" data-wpick aria-label="Any colour"></label></div>`)}
        ${sec('wtune', 'Speed and probability', `${slider('wspeed', 'Speed')}${slider('wprob', 'Probability')}
          <p class="spHint">Probability is how many bands catch each hit. Turn it down and any effect becomes a random sparkle.</p>`)}</div>
      </div>
      <div class="spPane" data-pane="ir">
        <div class="spPresets"><button class="spPreset spBlack" data-demo="blackout"><canvas></canvas><span>Blackout</span></button>${MH_PRESETS.map(([id, n]) => `<button class="spPreset" data-mhp="${id}"><canvas></canvas><span>${esc(n)}</span></button>`).join('')}</div>
        <div class="spEdit">        ${sec('ircolour', 'Colour', `<div class="spSwatches">${WASH_COLOURS.map(([hex, n]) => `<button data-icol="${hex}" title="${n}" style="--c:${hex}"></button>`).join('')}
          <button data-imode="rainbow" class="spRainbow" title="Rainbow: every head its own colour"></button>
          <button data-imode="cycle" class="spCycle" title="Cycle: every head steps through the colours together"></button>
          <label class="spWPick" title="Any colour"><input type="color" data-ipick aria-label="Any colour"></label></div>`)}
        ${sec('irsignal', 'Signal', `<span class="spSub">What the beams send</span>
          <div class="aqChips">${WASH_FX.map((w) => `<button class="aqChip" data-ifx="${w.id}">${w.name}</button>`).join('')}</div>
          <span class="spSub">Gobo: the shape of the beam</span>
          <div class="aqChips spGobos">${GOBOS.map(([id, n]) => `<button class="aqChip" data-igobo="${id}" title="${n}"><svg viewBox="0 0 20 20" aria-hidden="true">${GOBO_ICON[id]}</svg><span>${n}</span></button>`).join('')}</div>`)}
        ${sec('irtune', 'Heads, speed, size and probability', `${slider('iheads', 'Heads on')}${slider('ispeed', 'Speed')}${slider('isize', 'Beam size')}${slider('iprob', 'Probability')}
          <p class="spHint">Heads switch on spread round the room, so any number covers it evenly. The rest stay parked.</p>`)}
        <div class="spSwitchRow"><span><b>Show IR beams</b></span>
          <button class="aqSwitch" data-toggle="beams" role="switch" aria-label="Show IR beams"><i></i></button></div></div>
      </div>
      <div class="spPane" data-pane="group">
        <div class="spPresets"><button class="spPreset spBlack" data-demo="blackout"><canvas></canvas><span>Blackout</span></button>${GROUP_PRESETS.map(([id, n]) => `<button class="spPreset" data-gpreset="${id}"><canvas></canvas><span>${n}</span></button>`).join('')}</div>
        <div class="spEdit">        ${sec('gzones', 'Zones and groups', `<canvas class="spGroupMap"></canvas>
          <p class="spHint">Every section of the 100s, 200s, 300s and 400s is a zone, and the floor is one zone of its own. Each section is cut into groups:</p>
          <span class="spSub">Groups in each section</span>
          <div class="aqChips spGCount">${[1, 2, 3, 4].map((n) => `<button class="aqChip" data-ggroups="${n}">${n}</button>`).join('')}</div>
          <span class="spSub">Cut</span>
          <div class="aqChips spGSplits">${GROUP_SPLITS.map(([id, n]) => `<button class="aqChip" data-gsplit="${id}">${n}</button>`).join('')}</div>`)}
        ${sec('geach', 'Colours and effects', `<div class="aqChips spGColouring">${GROUP_COLOURING.map(([id, n]) => `<button class="aqChip" data-gcolour="${id}">${n}</button>`).join('')}</div>
          <div class="spGZones"></div>
          <div class="aqChips spGFill">
            <button class="aqChip" data-gfill="rainbow">Rainbow</button><button class="aqChip" data-gfill="two">Two colours</button>
            <button class="aqChip" data-gfill="one">One colour</button><button class="aqChip" data-gfill="mix">Mix effects</button>
            <button class="aqChip" data-gfill="same">Same effect</button></div>
          <div class="spGZone spGFloor"><span class="spGNum">F</span><span class="spGName">Floor</span><span></span>
            <select class="aqPop" data-gffx aria-label="Floor effect">${GROUP_FX.map(([id, fn]) => `<option value="${id}">${fn}</option>`).join('')}</select></div>
          <div class="spGFloorCols"></div>
          <div class="aqChips spGFloorMode">${FLOOR_MODES.map(([id, n]) => `<button class="aqChip" data-gfloor="${id}">${n}</button>`).join('')}</div>
          <p class="spHint">Give the floor two colours or more and it is cut into that many parts, the same way the sections are cut (Across, Rows or Scattered), taking turns like the groups do.</p>`)}
        ${sec('gtiming', 'Chase and timing', `<span class="spSub">The sections</span>
          <div class="aqChips spGOrders">${GROUP_ORDERS.map(([id, n]) => `<button class="aqChip" data-gorder="${id}">${n}</button>`).join('')}<button class="aqChip" data-grev title="Run the order the other way">⇄ Reverse</button></div>
          <span class="spSub">The groups inside each section</span>
          <div class="aqChips spGInner">${GROUP_INNER.map(([id, n]) => `<button class="aqChip" data-ginner="${id}">${n}</button>`).join('')}</div>
          ${slider('gstep', 'Step')}${slider('gtail', 'Trail')}${slider('gbase', 'Resting')}${slider('gspeed', 'Effect speed')}
          <p class="spHint">Step is how long each section holds before the next takes over; inside a chase the groups take their turns within it. Trail lets a section fade out over the steps after it. Resting keeps the waiting ones faintly lit.</p>`)}</div>
      </div>
      <div class="spEdit spEditTail">
      ${pads ? sec('triggers', 'Triggers', `<div class="spRecBar"><button class="spRec" data-rec title="Then tap a trigger: the look on now is saved there, empty or not"><i></i>Record</button><span class="spRecHint"></span></div>
        <div class="spTrigs">${[...Array(10)].map((_, i) => `<button class="spTrig" data-trig="${i}"><kbd>${pads.padKey(i)}</kbd><span></span><i class="spTrigFade"></i></button>`).join('')}</div>
        <div class="spTrigMenu" hidden></div>
        <div class="spFadeMount"></div>
        <p class="spHint">Make an effect, tap a trigger and add it. Keys 1–0 fire them from anywhere, and the director can place them on its timeline.</p>`, '<small class="spLayer"></small>') : ''}
      ${sec('fade', 'Fade', `${slider('flevel', 'Level')}${slider('ftime', 'Fade time')}
        <div class="spFadeBtns"><button class="aqBtn" data-fade="out">Fade out</button><button class="aqBtn" data-fade="in">Fade in</button><button class="aqBtn" data-fade="loop">Loop</button></div>
        <p class="spHint">The effect keeps running while it fades: a strobe goes on strobing as it slowly darkens. Loop fades it down and back up, again and again.</p>`)}
      <button class="spCustomise aqBtn">Customise sections and text…</button>
      </div>
      <button class="spEditBtn" data-edit>Edit effect and triggers</button>
    </div>`;
  document.body.appendChild(root);

  // SETTINGS: the pixels, the room and the video's size live in the Settings
  // menu, out of the way of the presets
  const R = room || {};
  const sw = (k, label, sub) => `<div class="spSwitchRow"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span>
    <button class="aqSwitch" data-toggle="${k}" role="switch" aria-label="${label}"><i></i></button></div>`;
  const setHost = document.createElement('div');
  setHost.id = 'setShow';
  setHost.className = 'aq setShow';
  setHost.innerHTML = `
    ${sec('pixels', 'Pixels', `<div class="spModes">${MODES.map(([k, n, icon]) => `<button class="spMode" data-pmode="${k}">${icon}<b>${n}</b></button>`).join('')}</div>
      <div class="spTune" data-tune="pixels"><span class="spTuneName">Seat pixels</span>${slider('psize', 'Size')}${slider('pspeed', 'Speed')}${slider('pglow', 'Glow')}</div>
      <div class="spTune" data-tune="bands"><span class="spTuneName">Wristbands</span>${slider('bsize', 'Size')}${slider('bspeed', 'Speed')}${slider('bglow', 'Glow')}</div>`)}
    ${sec('room', 'Room', `${sw('lights', 'Venue lights')}
      ${R.suites ? sw('suites', 'VIP lights') : ''}
      ${R.leds ? sw('leds', 'LED ribbons') : ''}
      ${R.banners ? sw('banners', 'Banners') : ''}
      ${R.jumbo ? `${sw('jumbo', 'Jumbotron')}
        <div class="spSwitchRow"><span><b>Jumbotron height</b></span>
          <div class="aqChips"><button class="aqChip" data-jumboup="0">Down</button><button class="aqChip" data-jumboup="1">Up</button></div></div>` : ''}
      ${R.screens ? `${sw('screens', 'Video screens')}
        <div class="spSwitchRow"><span><b>Screens show</b><small class="spVidName"></small></span>
          <div class="aqChips"><button class="aqChip" data-screffect>The effect</button><button class="aqChip" data-upvideo>Video…</button></div></div>` : ''}
      ${glow ? `<div class="spTune"><span class="spTuneName">Glow</span>${slider('sglow', 'Screens')}${slider('bloom', 'Bloom')}</div>` : ''}`)}
    ${sec('sound', 'Sound', `${slider('mmusic', 'Music')}${slider('mcrowd', 'Crowd')}${slider('mroom', 'Room echo')}
      ${slider('mbass', 'Bass')}${slider('mmid', 'Mid')}${slider('mtreble', 'Treble')}
      ${slider('msub', 'Sub')}${slider('mrear', 'Back speakers')}${slider('mpunch', 'Punch')}`)}
    ${sec('vidset', 'Video', `<div class="spRecRow"><span class="spSub">Size</span>
        <div class="aqChips">${[[1080, '1080p'], [1440, '1440p'], [2160, '4K']].map(([v, n]) => `<button class="aqChip" data-recsize="${v}">${n}</button>`).join('')}</div></div>
      ${sw('rec-outro', 'PixMob outro')}
      ${sw('rec-top', 'Song from the start')}`)}`;
  const setPanel = document.getElementById('settingsPanel');
  if (setPanel) setPanel.insertBefore(setHost, document.getElementById('saveShowBtn') || null);

  // How long a render takes, per second of video, at each size: a first guess,
  // then what this computer actually did (a running average, kept between visits)
  const RATE_KEY = 'ht-render-rate';
  const RATE_GUESS = { 1080: 14, 1440: 22, 2160: 45 };
  const rates = (() => { try { return JSON.parse(localStorage.getItem(RATE_KEY) || '{}'); } catch (_) { return {}; } })();
  const renderRate = (size) => rates[size] || RATE_GUESS[size] || 5;
  const learnRate = (size, r) => {
    if (!(r > 0.2 && r < 200)) return;
    rates[size] = rates[size] ? rates[size] * 0.5 + r * 0.5 : r;
    try { localStorage.setItem(RATE_KEY, JSON.stringify(rates)); } catch (_) { /* private mode */ }
  };
  const howLong = (sec) => sec < 60 ? `${Math.max(5, Math.round(sec / 5) * 5)} s` : `${Math.round(sec / 60)} min`;
  // MAKE A VIDEO: pick effects (and their colours), a song, the camera, how
  // long; then record. Everything else is in Settings.
  const vwin = document.createElement('div');
  vwin.id = 'videoPanel';
  vwin.className = 'showPanel aq videoPanel';
  const vtile = (kind, id, name) => `<button class="spPreset" data-vadd="${kind}:${id}"><canvas></canvas><span>${esc(name)}</span></button>`;
  vwin.innerHTML = `
    <div class="spHead vpHead">
      <button class="spClose" data-vclose aria-label="Close"></button>
      <span class="spTitle">Make a video</span>
    </div>
    <div class="spBody">
      <div class="aqSeg vpKinds" role="tablist">
        <button data-vkind="grid"><b>Grid</b></button><button data-vkind="wash"><b>Unifying</b></button><button data-vkind="ir"><b>MH</b></button><button data-vkind="group"><b>Grouping</b></button>
      </div>
      <div class="spColRow"><div class="spSlots"></div><div class="spCombos"><button data-col="rainbow" class="spCombo spRainbowSw" title="Rainbow"></button>${[...designer.pairs.map(([a, b, n]) => [n, [a, b]]), ...COMBOS].map(([n, L], i) => `<button class="spCombo" data-combo="${i}" title="${n}" style="background:linear-gradient(90deg,${L.map((c, k) => `${c} ${(k / L.length) * 100}% ${((k + 1) / L.length) * 100}%`).join(',')})"></button>`).join('')}</div></div>
      <div class="spSpeedRow">${slider('espd', 'Speed of effect')}</div>
      <div class="spSpeedRow spGoboRow">${slider('mhsize', 'Gobo size')}</div>
      <div class="spSpeedRow spGoboRow spHeadsRow">${slider('mhheads', 'Moving heads')}</div>
      <div class="vpPick">
        <div class="spPresets" data-vpane="grid">${designer.demoList.map((d) => vtile('grid', d.id, d.name)).join('')}</div>
        <div class="spPresets" data-vpane="wash">${vtile('grid', 'blackout', 'Blackout')}${UNIFY.map(([id, n]) => vtile('wash', id, n)).join('')}</div>
        <div class="spPresets" data-vpane="ir">${vtile('grid', 'blackout', 'Blackout')}${MH_PRESETS.map(([id, n]) => vtile('ir', id, n)).join('')}</div>
        <div class="spPresets" data-vpane="group">${vtile('grid', 'blackout', 'Blackout')}${GROUP_PRESETS.map(([id, n]) => vtile('group', id, n)).join('')}</div>
      </div>
      <div class="vpLabel">Your video</div>
      <div class="vpReel"></div>
      <div class="vpRow">
        <button class="aqChip vpPlay" data-playaudio title="Play the song (from the venue's speakers when they're on)">▶</button>
        <button class="aqChip" data-reelsong>♪ <span class="spReelSong"></span></button>
        <label class="spRecNum vpLen" title="How long the video is"><input type="number" min="3" max="600" step="1" data-reclen aria-label="Length in seconds"><em>s</em></label>
        <button class="aqChip" data-recfull title="As long as the song">Full audio</button>
        <button class="aqChip" data-recmix title="New camera angles">🔀</button>
      </div>
      <div class="vpSwitches">
      <div class="spSwitchRow"><span><b>Venue speakers</b></span>
        <button class="aqSwitch" data-toggle="recvenue" role="switch" aria-label="Use venue speakers for music"><i></i></button></div>
      <div class="spSwitchRow vpCrowd"><span><b>Crowd sounds</b></span>
        <button class="aqSwitch" data-toggle="reccrowd" role="switch" aria-label="Crowd sounds"><i></i></button></div>
      <div class="spSwitchRow vpStage"><span><b>Stage lights</b></span>
        <button class="aqSwitch" data-toggle="stagelights" role="switch" aria-label="Use stage lights"><i></i></button></div>
      </div>
      <div class="spMyShots vpStudio"></div>
      <button class="aqChip vpStudio" data-msnew>＋ My shot</button>
      <button class="spRecord"><i></i><span></span></button>
      <button class="aqBtn spRecStop" hidden>Stop rendering</button>
      <div class="spProgress" hidden><div></div></div>
    </div>`;
  document.body.appendChild(vwin);
  const vwinMove = makeMovable(vwin, { handle: '.vpHead', key: 'videopanel' });
  // the effects get the room; rest on "Your video" (anything below the effects)
  // for half a second and the reel gets it instead. Back up there, the same.
  {
    let want = false, t = 0;
    const set = (reel) => {
      if (reel === want) return;
      want = reel;
      clearTimeout(t);
      t = setTimeout(() => vwin.classList.toggle('reelFocus', want), 500);
    };
    vwin.addEventListener('mouseover', (e) => {
      if (!e.target.closest('.spBody')) return;
      set(!e.target.closest('.vpKinds, .spColRow, .spSpeedRow, .vpPick'));
    });
    vwin.addEventListener('mouseleave', () => set(false));
  }
  const vfab = document.createElement('button');
  vfab.id = 'videoFab';
  vfab.title = 'Make a video';
  vfab.innerHTML = '<span class="cfIcon"></span><span class="cfLabel">VIDEO</span>';

  // the panel's controls live in three places; every lookup and listener spans them
  const hosts = [root, setHost, vwin];
  const qa = (sel) => hosts.flatMap((h) => [...h.querySelectorAll(sel)]);
  const $ = (sel) => { for (const h of hosts) { const el = h.querySelector(sel); if (el) return el; } return null; };
  const onHosts = (type, fn) => { for (const h of hosts) h.addEventListener(type, fn); };
  const win = makeMovable(root, { handle: '.spHead', key: 'showpanel' });

  const fab = document.createElement('button');
  fab.id = 'showFab';
  fab.title = 'The show on the wristbands (O)';
  fab.innerHTML = '<span class="cfIcon"></span><span class="cfLabel">SHOW</span><kbd>O</kbd>';
  (document.getElementById('fabDock') || document.body).appendChild(fab);
  (document.getElementById('fabDock') || document.body).appendChild(vfab);

  // --- what the buttons say -------------------------------------------------------
  const live = () => orbFX.mode === 'design';
  const kindPlaying = () => (!live() ? null : designer.demo === 'wash' ? 'wash' : designer.demo === 'ir' ? 'ir' : designer.demo === 'group' ? 'group' : 'grid');
  function render() {
    const on = live();
    root.classList.toggle('live', on);
    fab.classList.toggle('live', on);
    fab.classList.toggle('active', open);
    const playing = kindPlaying();
    $('.spLive span').textContent = !on ? 'Off' : playing === 'wash' ? 'Unifying' : playing === 'ir' ? 'MH' : playing === 'group' ? 'Grouping' : designer.demo ? 'Grid' : 'Custom';
    $('.spOff').hidden = !on;
    // GRID or WASH
    for (const b of qa('[data-kind]')) b.classList.toggle('sel', b.dataset.kind === prefs.kind);
    for (const p of qa('[data-pane]')) p.hidden = p.dataset.pane !== prefs.kind;
    for (const s of qa('.aqSec')) {
      const shut = !!prefs.sec[s.dataset.sec];
      s.classList.toggle('shut', shut);
      s.querySelector('.aqSecHead').setAttribute('aria-expanded', String(!shut));
    }
    // grid
    for (const b of qa('[data-demo]')) b.classList.toggle('sel', playing === 'grid' && b.dataset.demo === designer.demo);
    const br = designer.brand;
    const C = colNow();
    paintSlots(C);
    const allSets = [...designer.pairs.map(([a, b]) => [a, b]), ...COMBOS.map(([, L]) => L)];
    for (const b of qa('[data-combo]')) {
      const L = allSets[Number(b.dataset.combo)];
      b.classList.toggle('sel', !C.rainbow && L.length === C.list.length && L.every((c, k) => c.toLowerCase() === C.list[k].toLowerCase()));
    }
    for (const b of qa('[data-col]')) {
      if (b.dataset.col === 'rainbow') { b.classList.toggle('sel', !!C.rainbow); continue; }
      const [a, bb] = designer.pairs[Number(b.dataset.col)];
      b.classList.toggle('sel', !C.rainbow && a.toLowerCase() === C.a.toLowerCase() && bb.toLowerCase() === C.b.toLowerCase());
    }

    for (const b of qa('[data-pair]')) {
      const [a, bb] = designer.pairs[Number(b.dataset.pair)];
      b.classList.toggle('sel', a === br.a && bb === br.b);
    }
    for (const c of qa('input[data-brand]')) if (document.activeElement !== c) c.value = br[c.dataset.brand];
    const d = designer.demoList.find((o) => o.id === designer.demo);
    $('.spGridHint').textContent = playing !== 'grid' ? 'Tap a preset to light the crowd. It takes these colours.'
      : d && !d.brand ? `${d.name} has its own colours. Pick another preset to use yours.`
        : designer.demo ? 'The preset takes the colours as soon as you tap one.' : 'Playing your own show. Tap a preset to replace it.';
    // wash
    const w = designer.wash, washing = playing === 'wash';
    for (const b of qa('[data-fx]')) b.classList.toggle('sel', b.dataset.fx === w.fx && washing);
    for (const b of qa('[data-vibe]')) {
      const V = UNI[b.dataset.vibe];
      b.classList.toggle('sel', washing && w.fx === V.fx && w.cmode === V.cmode && Math.abs(w.speed - V.speed) < 0.02 && Math.abs(w.prob - V.prob) < 0.02);
    }
    for (const b of qa('[data-wcol]')) b.classList.toggle('sel', w.cmode === 'a' && b.dataset.wcol.toLowerCase() === w.a.toLowerCase());
    for (const b of qa('[data-wmode]')) b.classList.toggle('sel', w.cmode === b.dataset.wmode);
    const pick = $('[data-wpick]');
    if (document.activeElement !== pick) pick.value = w.a;
    pick.parentElement.classList.toggle('sel', w.cmode === 'a' && !WASH_COLOURS.some(([hex]) => hex.toLowerCase() === w.a.toLowerCase()));
    // IR
    const I = designer.ir, irOn = playing === 'ir';
    for (const b of qa('[data-mhp]')) {
      const P = MHP[b.dataset.mhp];
      b.classList.toggle('sel', irOn && I.motion === P.motion && I.fx === P.fx && I.gobo === P.gobo && Math.abs(I.size - P.size) < 0.01);
    }
    for (const b of qa('[data-icol]')) b.classList.toggle('sel', I.cmode === 'a' && b.dataset.icol.toLowerCase() === I.a.toLowerCase());
    for (const b of qa('[data-imode]')) b.classList.toggle('sel', I.cmode === b.dataset.imode);
    const ipick = $('[data-ipick]');
    if (document.activeElement !== ipick) ipick.value = I.a;
    ipick.parentElement.classList.toggle('sel', I.cmode === 'a' && !WASH_COLOURS.some(([hex]) => hex.toLowerCase() === I.a.toLowerCase()));
    for (const b of qa('[data-ifx]')) b.classList.toggle('sel', b.dataset.ifx === I.fx);
    for (const b of qa('[data-igobo]')) b.classList.toggle('sel', b.dataset.igobo === I.gobo);
    // grouping: the split, the count, each zone's row, the order
    const G = designer.group, grouping = playing === 'group';
    for (const b of qa('[data-gpreset]')) b.classList.toggle('sel', grouping && b.dataset.gpreset === G.preset);
    for (const b of qa('[data-ggroups]')) b.classList.toggle('sel', Number(b.dataset.ggroups) === G.groups);
    for (const b of qa('[data-gsplit]')) { b.classList.toggle('sel', b.dataset.gsplit === G.gsplit); b.disabled = G.groups < 2 && G.floor.cols.length < 2; }
    for (const b of qa('[data-gcolour]')) b.classList.toggle('sel', b.dataset.gcolour === G.cmode);
    for (const b of qa('[data-gorder]')) b.classList.toggle('sel', b.dataset.gorder === G.order);
    for (const b of qa('[data-ginner]')) { b.classList.toggle('sel', b.dataset.ginner === G.inner); b.disabled = G.groups < 2 && G.floor.cols.length < 2; }
    for (const b of qa('[data-gfloor]')) b.classList.toggle('sel', b.dataset.gfloor === G.floor.mode);
    $('[data-grev]').classList.toggle('sel', G.dir < 0);
    paintGroupZones(G);
    const beams = $('[data-toggle="beams"]');
    beams.classList.toggle('on', !!ir?.beamsOn);
    beams.setAttribute('aria-checked', String(!!ir?.beamsOn));
    // pixels
    const mode = audience.mode;
    for (const b of qa('[data-pmode]')) b.classList.toggle('sel', b.dataset.pmode === mode);
    $('[data-tune="pixels"]').classList.toggle('off', !audience.pixels);
    $('[data-tune="bands"]').classList.toggle('off', !audience.bands);
    const vals = {
      wspeed: w.speed, wprob: w.prob, pspeed: designer.tempo,
      psize: audience.pixelSize, bspeed: audience.bandSpeed, bsize: audience.bandSize,
      pglow: audience.pixelGlow ?? 1, bglow: audience.bandGlow ?? 1,
      mmusic: prefs.mix?.music ?? 1, mcrowd: prefs.mix?.crowd ?? 1, mroom: prefs.mix?.room ?? 1, mbass: prefs.mix?.bass ?? 0,
      mmid: prefs.mix?.mid ?? 0, mtreble: prefs.mix?.treble ?? 0, msub: prefs.mix?.sub ?? 1, mrear: prefs.mix?.rear ?? 1, mpunch: prefs.mix?.punch ?? 0,
      ispeed: I.speed, isize: I.size, iprob: I.prob, iheads: I.heads,
      gstep: G.step, gtail: G.tail, gbase: G.base, gspeed: G.speed,
      flevel: designer.level, ftime: prefs.fadeTime,
      sglow: glow ? glow.screen : 1, bloom: glow ? glow.bloom : 1,
      mhsize: prefs.goboK || 1,
      mhheads: prefs.headCap && prefs.headCap < HEADS ? prefs.headCap : HEADS,
    };
    // the gobo slider is for moving heads: on the MH tab only
    for (const row of qa('.spGoboRow')) row.hidden = (row.closest('#videoPanel') ? prefs.vkind : prefs.kind) !== 'ir';
    for (const r of qa('input[type=range][data-k]')) {
      const k = r.dataset.k, T = TUNE[k];
      const s = k === 'espd' ? spd(r.closest('#videoPanel') ? prefs.vkind : prefs.kind) : vals[k];
      if (document.activeElement !== r) r.value = String(T.from(s));
      r.style.setProperty('--fill', `${(parseFloat(r.value) * 100).toFixed(1)}%`);
      r.closest('.aqSlider').querySelector('em').textContent = T.fmt(s);
    }
    // triggers: what each pad holds, and whether Record is waiting for one
    if (pads) {
      const armed = !!pads.recording;
      root.classList.toggle('recArmed', armed);
      $('[data-rec]').classList.toggle('on', armed);
      $('.spRecHint').textContent = armed ? 'Tap the trigger to save on. Esc cancels.' : 'Make a look, press Record, then tap a trigger to save it there.';
      const list = pads.pads();
      qa('[data-trig]').forEach((b) => {
        const p = list[Number(b.dataset.trig)];
        b.classList.toggle('full', !!p);
        b.querySelector('span').textContent = p ? p.name : 'Empty';
        b.title = p ? `${p.name}: tap for play, its fade line, replace or clear` : 'Empty: tap to add the effect playing now';
        // a trigger with a fade line shows it, small, under its name
        const f = p?.fade, line = f ? f.pts.map(([t, v]) => `${(t * 40).toFixed(1)},${(11 - v * 10).toFixed(1)}`).join(' ') : '';
        const icon = b.querySelector('.spTrigFade');
        if (icon.dataset.line !== line) {
          icon.dataset.line = line;
          icon.innerHTML = line ? `<svg viewBox="0 0 40 12" aria-hidden="true"><polyline points="${line}"/></svg>` : '';
        }
      });
      const L = pads.activeLayer();
      const tag = $('.spLayer');
      tag.textContent = `Layer ${L + 1}`;
      tag.style.color = pads.layerColor(L);
    }
    // fade
    const fl = designer.level;
    const lvl = $('input[data-k="flevel"]');
    if (document.activeElement !== lvl) lvl.value = String(fl);
    for (const b of qa('[data-fade]')) b.classList.toggle('sel', b.dataset.fade === 'loop' && designer.looping);
    // room
    const lights = $('[data-toggle="lights"]');
    lights.classList.toggle('on', !room.dark);
    lights.setAttribute('aria-checked', String(!room.dark));
    $('.spRecord').disabled = recording;
    $('.spRecStop').hidden = !recording;
    // the recording's settings
    if (prefs.recLen > maxLen()) setLen(prefs.recLen);   // a shorter song came in
    const lenIn = $('input[data-reclen]');
    if (lenIn && document.activeElement !== lenIn) { lenIn.value = String(prefs.recLen); lenIn.max = String(maxLen()); }
    const full = $('[data-recfull]');
    if (full) { full.disabled = !(songLen?.() > 0); full.classList.toggle('sel', songLen?.() > 0 && prefs.recLen === maxLen()); }
    for (const b of qa('[data-recsize]')) b.classList.toggle('sel', Number(b.dataset.recsize) === prefs.recSize);
    // the room's switches, and the video's, in Settings
    const swOn = {
      'rec-outro': prefs.recOutro, 'rec-top': prefs.recTop,
      stagelights: prefs.stageLights, recvenue: prefs.recVenue, reccrowd: prefs.recCrowd !== false, suites: R.suites?.on, jumbo: R.jumbo?.on, screens: R.screens?.on, leds: R.leds?.on, banners: R.banners?.on,
    };
    for (const [k, on] of Object.entries(swOn)) {
      const b = $(`[data-toggle="${k}"]`);
      if (b) { b.classList.toggle('on', !!on); b.setAttribute('aria-checked', String(!!on)); }
    }
    for (const b of qa('[data-jumboup]')) { b.classList.toggle('sel', (b.dataset.jumboup === '1') === !!R.jumbo?.up); b.disabled = !R.jumbo?.on; }
    const vn = $('.spVidName');
    if (vn) vn.textContent = R.screens?.effect ? '' : R.screens?.file?.() || '';
    const se = $('[data-screffect]');
    if (se) se.classList.toggle('sel', !!R.screens?.effect);
    root.classList.toggle('editing', !!prefs.edit);
    const pb = $('[data-playaudio]');
    if (pb) { const p = !!venueSound?.playing; pb.textContent = p ? '❚❚' : '▶'; pb.classList.toggle('sel', p); }
    const crRow = $('.vpCrowd');
    if (crRow) crRow.hidden = !prefs.recVenue;   // only with the venue's speakers on
    // both work in a concert only: elsewhere greyed out, and switched off underneath
    const concert = concertNow();
    for (const k of ['stagelights', 'recvenue', 'reccrowd']) {
      const row = $(`[data-toggle="${k}"]`)?.closest('.spSwitchRow');
      if (row) { row.classList.toggle('vpNA', !concert); row.title = concert ? '' : 'Concert setup only'; }
    }
    if (stageLights && stageLights.on !== (concert && !!prefs.stageLights)) stageLights.set(concert && !!prefs.stageLights);
    if (venueSound && !concert && venueSound.on) venueSound.set(false);
    $('[data-edit]').textContent = prefs.edit ? 'Done editing' : 'Edit effect and triggers';
    // the video: which effect the colours are for
    if (!['grid', 'wash', 'ir', 'group'].includes(prefs.vkind)) prefs.vkind = 'grid';
    for (const b of qa('[data-vkind]')) b.classList.toggle('sel', b.dataset.vkind === prefs.vkind);
    for (const p of qa('[data-vpane]')) p.hidden = p.dataset.vpane !== prefs.vkind;
    if (!recording) {
      const tot = prefs.recLen + (prefs.recOutro && shots ? shots.outroLen : 0);
      $('.spRecord span').textContent = prefs.reel.length ? `Record ${prefs.recLen} s · about ${howLong(tot * renderRate(prefs.recSize))} to make` : 'Add an effect, then record';
    }
    $('.spRecord').disabled = recording || !prefs.reel.length;
    paintMyShots();
    paintReel();
  }
  designer.onRender = () => render();

  // --- playing -----------------------------------------------------------------------
  function playGrid(id, C = null) {
    const P = C || colNow(), br = designer.brand;
    const extra = (P?.list || []).slice(2);
    if (P && (!!br.rainbow !== !!P.rainbow || br.a !== P.a || br.b !== P.b || (br.extra || []).join() !== extra.join())) designer.setBrand({ a: P.a, b: P.b, extra, rainbow: !!P.rainbow });
    designer.playDemo(id);
    applySpeed('grid');
    if (id !== 'blackout') prefs.lastGrid = id;
    save();
  }
  function setKind(kind) {
    prefs.kind = kind;
    save();
    // with a show on, the switch is the show: flip to the other kind straight away
    if (live() && kindPlaying() !== kind) {
      if (kind === 'wash') designer.setWash({});
      else if (kind === 'ir') designer.setIR({});
      else if (kind === 'group') designer.setGroup({});
      else playGrid(prefs.lastGrid && designer.demoList.some((d) => d.id === prefs.lastGrid) ? prefs.lastGrid : 'team');
    }
    render();
  }
  // --- grouping -------------------------------------------------------------------------
  // a change made by hand: the grouping is no longer the preset it came from
  const setGroup = (patch) => designer.setGroup({ ...patch, preset: null, name: null });
  // one row per group: its number, its colour and its effect (the floor has
  // its own row). Rebuilt only when the count changes, so a menu in use stays open
  let rowsFor = 0;
  function paintGroupZones(G) {
    const host = $('.spGZones');
    if (rowsFor !== G.groups) {
      rowsFor = G.groups;
      host.innerHTML = [...Array(G.groups)].map((_, k) => `<div class="spGZone" data-gz="${k}">
          <span class="spGNum">${k + 1}</span><span class="spGName">${G.groups > 1 ? `Group ${k + 1}` : 'Every section'}</span>
          <label class="spGCol" title="Colour"><input type="color" data-gzcol="${k}" aria-label="Group ${k + 1} colour"></label>
          <select class="aqPop" data-gzfx="${k}" aria-label="Group ${k + 1} effect">${GROUP_FX.map(([id, fn]) => `<option value="${id}">${fn}</option>`).join('')}</select>
        </div>`).join('');
    }
    const own = G.cmode === 'group';   // the colours are the groups' own (not the rainbow or the tiers')
    host.querySelectorAll('.spGZone').forEach((row, k) => paintRow(row, G.fx[k], own));
    paintFloor(G.floor);
  }
  // the floor: its effect, and a swatch per colour with + and − to add and take away
  let floorCols = 0;
  function paintFloor(F) {
    const m = $('select[data-gffx]');
    if (document.activeElement !== m && m.value !== F.fx) m.value = F.fx;
    const host = $('.spGFloorCols'), n = F.cols.length;
    if (floorCols !== n) {
      floorCols = n;
      host.innerHTML = `<span class="spSub">Floor colours</span>${F.cols.map((_, k) => `<label class="spGCol" title="Floor colour ${k + 1}"><input type="color" data-gfcol="${k}" aria-label="Floor colour ${k + 1}"></label>`).join('')}
        <button class="aqChip spGColBtn" data-gfadd title="Add a colour" ${n >= 4 ? 'disabled' : ''}>+</button>
        <button class="aqChip spGColBtn" data-gfdel title="Take the last colour away" ${n <= 1 ? 'disabled' : ''}>−</button>`;
    }
    host.querySelectorAll('input[data-gfcol]').forEach((c, k) => {
      c.parentElement.style.setProperty('--c', F.cols[k]);
      if (document.activeElement !== c && c.value !== F.cols[k]) c.value = F.cols[k];
    });
  }
  function paintRow(row, z, own) {
    row.style.setProperty('--c', z.a);
    row.classList.toggle('noCol', !own);
    const c = row.querySelector('input[type=color]'), m = row.querySelector('select');
    if (document.activeElement !== c && c.value !== z.a) c.value = z.a;
    if (document.activeElement !== m && m.value !== z.fx) m.value = z.fx;
  }
  // the showreel: the effects in order, each with a ✕, and the song
  if (!Array.isArray(prefs.reel)) prefs.reel = [];
  let reelTiles = [];
  // drag an effect in "Your video" to change the order
  let dragFrom = -1;
  vwin.addEventListener('dragstart', (e) => {
    const el = e.target.closest?.('.vpItem');
    if (!el) return;
    dragFrom = Number(el.dataset.reelsel);
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(dragFrom)); } catch (_) { /* some browsers */ }
  });
  vwin.addEventListener('dragover', (e) => {
    const el = e.target.closest?.('.vpItem');
    if (dragFrom < 0 || !el) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    for (const x of vwin.querySelectorAll('.vpItem.dropAt')) if (x !== el) x.classList.remove('dropAt');
    el.classList.add('dropAt');
  });
  vwin.addEventListener('drop', (e) => {
    const el = e.target.closest?.('.vpItem');
    if (dragFrom < 0 || !el) return;
    e.preventDefault();
    const to = Number(el.dataset.reelsel), from = dragFrom;
    dragFrom = -1;
    if (to === from) { render(); return; }
    const sel = prefs.reel[prefs.reelSel];
    const [moved] = prefs.reel.splice(from, 1);
    prefs.reel.splice(to, 0, moved);
    prefs.reelSel = prefs.reel.indexOf(sel);
    save(); render();
  });
  vwin.addEventListener('dragend', () => {
    dragFrom = -1;
    for (const x of vwin.querySelectorAll('.vpItem.dragging, .vpItem.dropAt')) x.classList.remove('dragging', 'dropAt');
  });
  function paintReel() {
    const host = $('.vpReel');
    const key = prefs.reel.map((r) => `${r.kind}:${r.id}:${r.name}:${(r.col?.list || [r.col?.a]).join()}:${!!r.col?.rainbow}`).join('|');
    if (host.dataset.key !== key) {
      host.dataset.key = key;
      // each effect as a little moving picture, in its own colours
      host.innerHTML = prefs.reel.map((r, k) => `<div class="vpItem" data-reelsel="${k}" draggable="true" title="${esc(r.name)}"><canvas></canvas><b>${k + 1}</b><button class="vpDel" data-reeldel="${k}" aria-label="Take it out">✕</button></div>`).join('');
      reelTiles = [...host.querySelectorAll('.vpItem')].map((el, k) => ({ it: prefs.reel[k], c: el.querySelector('canvas'), player: null }));
    }
    host.querySelectorAll('[data-reelsel]').forEach((b) => b.classList.toggle('sel', Number(b.dataset.reelsel) === prefs.reelSel));
    const songName = song?.() ? (songTitle?.() || 'Song') : 'Choose a song';
    $('.spReelSong').textContent = songName;
  }
  // your own shots, one row each: when, how long, and its two ends
  function paintMyShots() {
    const host = $('.spMyShots'), list = myShots();
    const key = list.map((q) => `${!!q.a}${!!q.b}`).join('|');
    if (host.dataset.key !== key) {
      host.dataset.key = key;
      host.innerHTML = list.map((q, k) => `<div class="spMyShot">
          <div class="spMyShotHead"><b>My shot ${k + 1}</b>
            <label class="spRecNum">at<input type="number" min="0" step="0.5" data-msat="${k}" aria-label="My shot ${k + 1} starts at, in seconds"><em>s</em></label>
            <label class="spRecNum">for<input type="number" min="1" step="0.5" data-msdur="${k}" aria-label="My shot ${k + 1} lasts, in seconds"><em>s</em></label>
            <button class="spRecViewDel" data-msdel="${k}" title="Take this shot out" aria-label="Take my shot ${k + 1} out">✕</button></div>
          <div class="aqChips">
            <button class="aqChip${q.a ? ' sel' : ''}" data-msset="${k}" data-end="a" title="Where the shot starts: the camera as it is now">Set A</button>
            <button class="aqChip" data-msgo="${k}" data-end="a" ${q.a ? '' : 'disabled'} title="Go to A">▶ A</button>
            <button class="aqChip${q.b ? ' sel' : ''}" data-msset="${k}" data-end="b" title="Where the shot ends: the camera as it is now">Set B</button>
            <button class="aqChip" data-msgo="${k}" data-end="b" ${q.b ? '' : 'disabled'} title="Go to B">▶ B</button></div>
        </div>`).join('');
    }
    host.querySelectorAll('input[data-msat]').forEach((el) => { const q = list[Number(el.dataset.msat)]; if (q && document.activeElement !== el) el.value = String(q.t); });
    host.querySelectorAll('input[data-msdur]').forEach((el) => { const q = list[Number(el.dataset.msdur)]; if (q && document.activeElement !== el) el.value = String(q.d); });
  }
  onHosts('change', (e) => {
    const at = e.target.closest('input[data-msat]'), dur = e.target.closest('input[data-msdur]');
    if (!at && !dur) return;
    const q = myShots()[Number((at || dur).dataset[at ? 'msat' : 'msdur'])];
    if (!q) return;
    if (at) q.t = Math.max(0, Math.round((Number(at.value) || 0) * 2) / 2);
    else q.d = Math.max(1, Math.round((Number(dur.value) || 6) * 2) / 2);
    save(); render();
  });
  // the quick fills over every group at once
  function fillGroup(kind) {
    const G = designer.group, n = G.groups, F = G.fx.map((z) => ({ ...z }));
    const MIX = ['solid', 'pulse', 'strobe', 'twinkle'];
    const br = designer.brand;
    F.forEach((z, k) => {
      if (kind === 'rainbow') z.a = wheel(k, n);
      else if (kind === 'two') z.a = k % 2 ? br.b : br.a;
      else if (kind === 'one') z.a = F[0].a;
      else if (kind === 'mix') z.fx = MIX[k % MIX.length];
      else if (kind === 'same') z.fx = F[0].fx;
    });
    setGroup({ fx: F, ...(kind === 'rainbow' || kind === 'two' || kind === 'one' ? { cmode: 'group' } : {}) });
  }

  // --- buttons ------------------------------------------------------------------------
  onHosts('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-vclose]')) { setVOpen(false); return; }   // the Video window's own close (it shares the class)
    if (t.closest('.spClose')) { setOpen(false); return; }
    if (t.closest('.spOff')) { designer.goOff(); render(); return; }
    const head = t.closest('.aqSecHead');
    if (head) {
      const id = head.closest('.aqSec').dataset.sec;
      prefs.sec[id] = !prefs.sec[id];
      save(); render();
      return;
    }
    const kind = t.closest('[data-kind]');
    if (kind) { setKind(kind.dataset.kind); return; }
    const demo = t.closest('[data-demo]');
    if (demo) { playGrid(demo.dataset.demo); render(); return; }
    const pair = t.closest('[data-pair]');
    if (pair) {
      const [a, b] = designer.pairs[Number(pair.dataset.pair)];
      designer.setBrand({ a, b });
      // a colour on its own means "show me": play the preset in it
      if (kindPlaying() !== 'grid') playGrid(prefs.lastGrid || 'team');
      render();
      return;
    }
    const colB = t.closest('[data-col="rainbow"]');
    if (colB) { setColour(colNow().list, true); return; }
    const combo = t.closest('[data-combo]');
    if (combo) { setColour([...designer.pairs.map(([a, b]) => [a, b]), ...COMBOS.map(([, L]) => L)][Number(combo.dataset.combo)]); return; }
    const sx = t.closest('[data-slotx]');
    if (sx) {   // take this colour out (one always stays)
      e.preventDefault();
      const L = [...colNow().list];
      if (L.length > 1) { L.splice(Number(sx.dataset.slotx), 1); setColour(L); }
      return;
    }
    if (t.closest('[data-slotadd]')) {   // one more colour (up to four)
      const L = [...colNow().list];
      if (L.length < 4) { L.push(ADD_COLOURS.find((c) => !L.includes(c)) || '#ffffff'); setColour(L); }
      return;
    }
    const vb = t.closest('[data-vibe]');
    if (vb) { playVibe(vb.dataset.vibe); render(); return; }
    const mh = t.closest('[data-mhp]');
    if (mh) { playMH(mh.dataset.mhp); render(); return; }
    const fx = t.closest('[data-fx]');
    if (fx) { designer.setWash({ fx: fx.dataset.fx }); render(); return; }
    const wcol = t.closest('[data-wcol]');
    if (wcol) { designer.setWash({ a: wcol.dataset.wcol, cmode: 'a' }); render(); return; }
    const wmode = t.closest('[data-wmode]');
    if (wmode) { designer.setWash({ cmode: wmode.dataset.wmode }); render(); return; }
    // grouping: a preset brings everything; the rest change one thing each
    const gp = t.closest('[data-gpreset]');
    if (gp) {
      playGroupPreset(gp.dataset.gpreset);
      render();
      return;
    }
    const gn = t.closest('[data-ggroups]');
    if (gn) { setGroup({ groups: Number(gn.dataset.ggroups) }); render(); return; }
    const gs = t.closest('[data-gsplit]');
    if (gs) { setGroup({ gsplit: gs.dataset.gsplit }); render(); return; }
    const gc = t.closest('[data-gcolour]');
    if (gc) { setGroup({ cmode: gc.dataset.gcolour }); render(); return; }
    const go = t.closest('[data-gorder]');
    if (go) { setGroup({ order: go.dataset.gorder }); render(); return; }
    const gi = t.closest('[data-ginner]');
    if (gi) { setGroup({ inner: gi.dataset.ginner }); render(); return; }
    if (t.closest('[data-gfadd]')) {
      const F = designer.group.floor, used = new Set(F.cols.map((c) => c.toLowerCase()));
      const next = [NODE.red, NODE.blue, NODE.white, NODE.yellow, NODE.green, NODE.pink, NODE.turq, NODE.orange, NODE.purple].find((c) => !used.has(c)) || NODE.white;
      if (F.cols.length < 4) setGroup({ floor: { ...F, cols: [...F.cols, next] } });
      render();
      return;
    }
    if (t.closest('[data-gfdel]')) {
      const F = designer.group.floor;
      if (F.cols.length > 1) setGroup({ floor: { ...F, cols: F.cols.slice(0, -1) } });
      render();
      return;
    }
    const gfl = t.closest('[data-gfloor]');
    if (gfl) { setGroup({ floor: { ...designer.group.floor, mode: gfl.dataset.gfloor } }); render(); return; }
    if (t.closest('[data-grev]')) { setGroup({ dir: designer.group.dir < 0 ? 1 : -1 }); render(); return; }
    const gf = t.closest('[data-gfill]');
    if (gf) { fillGroup(gf.dataset.gfill); render(); return; }
    // IR: a movement preset brings its own effect, gobo, beam size and how many heads; colour stays
    const mo = t.closest('[data-motion]');
    if (mo) { const M = MOTION[mo.dataset.motion]; designer.setIR({ motion: M.id, fx: M.fx, gobo: M.gobo, size: M.size, heads: M.heads ?? 0 }); render(); return; }
    const icol = t.closest('[data-icol]');
    if (icol) { designer.setIR({ a: icol.dataset.icol, cmode: 'a' }); render(); return; }
    const imode = t.closest('[data-imode]');
    if (imode) { designer.setIR({ cmode: imode.dataset.imode }); render(); return; }
    const ifx = t.closest('[data-ifx]');
    if (ifx) { designer.setIR({ fx: ifx.dataset.ifx }); render(); return; }
    const igobo = t.closest('[data-igobo]');
    if (igobo) { designer.setIR({ gobo: igobo.dataset.igobo }); render(); return; }
    if (t.closest('[data-toggle="beams"]')) {
      prefs.beams = !ir?.beamsOn;
      ir?.setBeams(prefs.beams);
      save(); render();
      return;
    }
    const mode = t.closest('[data-pmode]');
    if (mode) { audience.setMode(mode.dataset.pmode); render(); return; }
    // triggers: a tap opens the pad's menu; its buttons keep, fire or clear
    const tact = t.closest('[data-tact]');
    if (tact) { trigAction(tact.dataset.tact); return; }
    if (t.closest('[data-rec]')) { closeTrig(); pads.setRecord(!pads.recording); render(); return; }
    const trig = t.closest('[data-trig]');
    if (trig) {
      const i = Number(trig.dataset.trig);
      if (pads.recording) {   // Record is armed: straight onto this one, whatever it held
        closeTrig();
        pads.recordInto(i);
        trig.classList.remove('stored'); void trig.offsetWidth; trig.classList.add('stored');
        render();
        return;
      }
      openTrig(i, trig);
      return;
    }
    // fades: out to dark and in to full over the fade time, or round and round
    const fd = t.closest('[data-fade]');
    if (fd) {
      const k = fd.dataset.fade;
      if (k === 'loop') { if (designer.looping) designer.fadeTo(1, 0.4); else designer.fadeLoop(prefs.fadeTime); }
      else designer.fadeTo(k === 'in' ? 1 : 0, prefs.fadeTime);
      render();
      return;
    }
    const tog = t.closest('[data-toggle="lights"]');
    if (tog) { room.setDark(!room.dark); render(); return; }
    const ang = t.closest('[data-angle]');
    if (ang) { setAngle(Number(ang.dataset.angle)); return; }
    if (t.closest('.spCustomise')) { designer.openTab('paint'); return; }
    const rz = t.closest('[data-recsize]');
    if (rz) { prefs.recSize = Number(rz.dataset.recsize); save(); render(); return; }
    if (t.closest('[data-recfull]')) { setLen(maxLen()); render(); return; }
    const rl = t.closest('[data-reclen-pick]');
    if (rl) { prefs.recLen = Number(rl.dataset.reclenPick); save(); render(); return; }
    if (t.closest('[data-reeladd]')) {
      if (live()) { const snap = designer.snapshot(); prefs.reel.push({ name: designer.describe(snap), show: snap }); save(); }
      else pads?.hint?.('Play an effect first');
      render();
      return;
    }
    const rd = t.closest('[data-reeldel]');
    if (rd) {
      const k = Number(rd.dataset.reeldel);
      prefs.reel.splice(k, 1);
      if (prefs.reelSel >= k) prefs.reelSel = Math.max(prefs.reel.length ? 0 : -1, prefs.reelSel - 1);
      save(); render();
      return;
    }
    if (t.closest('[data-reelsong]')) { document.getElementById('audio-input')?.click(); return; }
    if (t.closest('[data-recmix]')) { prefs.recSeed = 1 + Math.floor(Math.random() * 1e9); save(); render(); return; }
    // your own shots: a new one, set or see its A and B, take it out
    if (t.closest('[data-msnew]')) {
      if (camView) {
        const list = myShots(), endOf = list.reduce((m, q) => Math.max(m, (+q.t || 0) + (+q.d || 6)), 0);
        list.push({ t: Math.min(endOf, Math.max(0, prefs.recLen - 6)), d: 6, a: camView.get(), b: null });
        save();
      }
      render();
      return;
    }
    const mss = t.closest('[data-msset]');
    if (mss) { const q = myShots()[Number(mss.dataset.msset)]; if (q && camView) { q[mss.dataset.end] = camView.get(); save(); } render(); return; }
    const msg = t.closest('[data-msgo]');
    if (msg) { const v = myShots()[Number(msg.dataset.msgo)]?.[msg.dataset.end]; if (v) camView?.set(v); return; }
    const msd = t.closest('[data-msdel]');
    if (msd) { myShots().splice(Number(msd.dataset.msdel), 1); save(); render(); return; }
    const rs = t.closest('[data-recshot]');
    if (rs) { shots?.preview(...shotArgs(), Number(rs.dataset.recshot)); return; }
    const tg = t.closest('[data-toggle]');
    if (tg && tg.dataset.toggle !== 'lights' && tg.dataset.toggle !== 'beams') {
      const k = tg.dataset.toggle;
      if (k === 'rec-outro') { prefs.recOutro = !prefs.recOutro; save(); }
      else if (k === 'rec-top') { prefs.recTop = !prefs.recTop; save(); }
      else if (k === 'suites') R.suites?.set(!R.suites.on);
      else if (k === 'jumbo') R.jumbo?.set(!R.jumbo.on);
      else if (k === 'screens') R.screens?.set(!R.screens.on);
      else if (k === 'leds') R.leds?.set(!R.leds.on);
      else if (k === 'reccrowd') { prefs.recCrowd = prefs.recCrowd === false; save(); venueSound?.setCrowd(prefs.recCrowd); }
      else if ((k === 'recvenue' || k === 'stagelights' || k === 'reccrowd') && !concertNow()) { /* concert setup only */ }
      else if (k === 'recvenue') { prefs.recVenue = !prefs.recVenue; save(); venueSound?.setMix(prefs.mix); venueSound?.set(prefs.recVenue); }
      else if (k === 'stagelights') { prefs.stageLights = !prefs.stageLights; save(); stageLights?.set(prefs.stageLights); }
      else if (k === 'banners') R.banners?.set(!R.banners.on);
      render();
      return;
    }
    const ju = t.closest('[data-jumboup]');
    if (ju) { R.jumbo?.setUp(ju.dataset.jumboup === '1'); render(); return; }
    if (t.closest('[data-playaudio]')) {
      // the switch was left on last time: sound can only start from a click, so it starts here
      if (prefs.recVenue && concertNow() && !venueSound?.on) { venueSound?.setMix(prefs.mix); venueSound?.set(true); }
      venueSound?.toggle();
      setTimeout(render, 150);
      return;
    }
    if (t.closest('[data-upvideo]')) { R.screens?.upload(); return; }
    if (t.closest('[data-screffect]')) { R.screens?.showEffect(); render(); return; }
    if (t.closest('[data-edit]')) { prefs.edit = !prefs.edit; save(); render(); return; }
    if (t.closest('[data-vclose]')) { setVOpen(false); return; }
    // the video's effects: add one (it plays), pick one, colour it
    const va = t.closest('[data-vadd]');
    if (va) {
      const [kind, id] = va.dataset.vadd.split(':');
      const C = colNow();
      const item = { kind, id, col: { list: [...C.list], rainbow: !!C.rainbow } };
      playItem(item);
      reelPicked = false;
      prefs.reel.push(item);
      prefs.reelSel = prefs.reel.length - 1;
      save(); render();
      return;
    }
    const rsel = !t.closest('[data-reeldel]') && t.closest('[data-reelsel]');
    const vk = t.closest('[data-vkind]');
    if (vk) { prefs.vkind = vk.dataset.vkind; save(); render(); return; }
    if (rsel) {
      prefs.reelSel = Number(rsel.dataset.reelsel);
      reelPicked = true;
      const it = prefs.reel[prefs.reelSel];
      if (it?.show) designer.restore(it.show, { live: true });
      save(); render();
      return;
    }
    if (t.closest('.spRecStop')) { renderAbort?.abort(); return; }
    if (t.closest('.spRecord') && !recording) {
      recording = true;
      renderAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
      render();
      const bar = $('.spProgress'), label = $('.spRecord span');
      bar.hidden = false;
      const total = prefs.recLen + (prefs.recOutro && shots ? shots.outroLen : 0);   // the show, then the outro
      // nothing on the wristbands would make a dull video: start a show (unless
      // the director's song and its cues are about to run the show)
      if ((!designer.hasShow || !live()) && !(prefs.recTop && song?.())) {
        if (prefs.kind === 'wash') designer.setWash({});
        else if (prefs.kind === 'ir') designer.setIR({});
        else if (prefs.kind === 'group') designer.setGroup({});
        else playGrid(prefs.lastGrid || 'team');
      }
      const t0 = performance.now();
      try {
        const blob = await record({
          seconds: total, outro: prefs.recOutro, fromTop: prefs.recTop, pullAt: null,
          shots: shotArgs()[2], size: prefs.recSize, signal: renderAbort?.signal,
          reel: prefs.reel.length ? prefs.reel.map((r) => r.show) : null,
          venue: prefs.recVenue && concertNow() ? { ...prefs.mix, crowd: prefs.recCrowd === false ? 0 : prefs.mix.crowd } : null,
          onProgress: (k, text) => {
            bar.firstElementChild.style.width = `${Math.round(k * 100)}%`;
            // time left, from how fast it is actually going (the guess until there is enough to go on)
            const spent = (performance.now() - t0) / 1000;
            const left = k > 0.04 ? spent * (1 - k) / k : total * renderRate(prefs.recSize) - spent;
            label.textContent = text || `Making your video… about ${howLong(Math.max(0, left))} left`;
          },
        });
        learnRate(prefs.recSize, (performance.now() - t0) / 1000 / Math.max(1, total));
        const fps = blob?.fps || 60;
        label.textContent = fps >= 56 ? 'Saved to your Downloads ✓' : `Saved ✓ · drawn at ${fps} fps at this size: ${prefs.recSize > 1080 ? `${prefs.recSize === 2160 ? '1440p' : '1080p'} will be smoother` : 'close other apps for smoother video'}`;
      } catch (err) {
        label.textContent = String(err?.message || 'The video could not be recorded.');
      }
      renderAbort = null;
      recording = false;
      bar.hidden = true;
      render();
      setTimeout(() => { if (!recording) render(); }, 4000);
    }
  });
  for (const c of qa('input[data-brand]')) {
    c.addEventListener('input', () => {
      designer.setBrand({ [c.dataset.brand]: c.value });
      if (kindPlaying() !== 'grid') playGrid(prefs.lastGrid || 'team');
      render();
    });
  }
  onHosts('change', (e) => {
    if (!e.target.matches?.('input[data-reclen]')) return;
    setLen(e.target.value);
    render();
  });
  onHosts('input', (e) => {
    const c = e.target.closest?.('input[data-slot]');
    if (!c) return;
    const L = [...colNow().list];
    L[Number(c.dataset.slot)] = c.value;
    setColour(L);
  });
  $('[data-wpick]').addEventListener('input', (e) => { designer.setWash({ a: e.target.value, cmode: 'a' }); render(); });

  $('[data-ipick]').addEventListener('input', (e) => { designer.setIR({ a: e.target.value, cmode: 'a' }); render(); });
  // sliders: the wash, the show's speed, the pixels and the bands
  let pending = null, pendingIR = null, pendingG = null;
  // a group's colour and its effect, from its row, and the floor's from its own;
  // picking a group's colour means the groups' own colours
  let pendingFx = null, pendingFloor = null, pendingOwn = false;
  const flushRows = () => requestAnimationFrame(() => {
    if (!pendingFx && !pendingFloor) return;
    setGroup({ ...(pendingFx ? { fx: pendingFx } : {}), ...(pendingFloor ? { floor: pendingFloor } : {}), ...(pendingOwn ? { cmode: 'group' } : {}) });
    pendingFx = pendingFloor = null;
    pendingOwn = false;
  });
  const groupEdit = (k, patch) => {
    if (!pendingFx) pendingFx = designer.group.fx.map((z) => ({ ...z }));
    Object.assign(pendingFx[k], patch);
    if (patch.a) pendingOwn = true;
    flushRows();
  };
  const floorEdit = (patch) => { pendingFloor = { ...(pendingFloor || designer.group.floor), ...patch }; flushRows(); };
  onHosts('input', (e) => {
    const c = e.target.closest('input[data-gzcol]');
    if (c) groupEdit(Number(c.dataset.gzcol), { a: c.value });
    if (e.target.matches('input[data-gfcol]')) {
      const k = Number(e.target.dataset.gfcol), cols = [...(pendingFloor || designer.group.floor).cols];
      cols[k] = e.target.value;
      floorEdit({ cols, a: cols[0] });
    }
  });
  onHosts('change', (e) => {
    const m = e.target.closest('select[data-gzfx]');
    if (m) groupEdit(Number(m.dataset.gzfx), { fx: m.value });
    if (e.target.matches('select[data-gffx]')) floorEdit({ fx: e.target.value });
  });
  onHosts('input', (e) => {
    const r = e.target.closest('input[type=range][data-k]');
    if (!r) return;
    const k = r.dataset.k, s = TUNE[k].to(parseFloat(r.value));
    r.style.setProperty('--fill', `${(parseFloat(r.value) * 100).toFixed(1)}%`);
    r.closest('.aqSlider').querySelector('em').textContent = TUNE[k].fmt(s);
    if (k === 'flevel') designer.fadeTo(s, 0.12);
    else if (k === 'ftime') { prefs.fadeTime = s; save(); }
    else if (k === 'sglow') { glow?.setScreen(s); prefs.glow = s; save(); }
    else if (k === 'bloom') { glow?.setBloom(s); prefs.bloom = s; save(); }
    else if (k === 'pspeed') designer.setTempo(s);
    else if (k === 'psize') audience.setPixelSize(s);
    else if (k === 'pglow') audience.setPixelGlow?.(s);
    else if (MIXK[k]) { prefs.mix[MIXK[k]] = s; save(); venueSound?.setMix(prefs.mix); }
    else if (k === 'mhsize') { prefs.goboK = s; save(); setGoboScale(s); }
    else if (k === 'mhheads') { prefs.headCap = s >= HEADS ? 0 : s; save(); setHeadCap(prefs.headCap); }
    else if (k === 'espd') {
      const kind = e.target.closest('#videoPanel') ? prefs.vkind : prefs.kind;
      prefs.spd[kind] = s;
      save();
      if (kindPlaying() === kind) applySpeed(kind);
      const it = prefs.reel[prefs.reelSel];
      if (vopen && reelPicked && it?.kind === kind && e.target.closest('#videoPanel')) { designer.setTempo(s); it.show = designer.snapshot(); }
    }
    else if (k === 'bglow') audience.setBandGlow?.(s);
    else if (k === 'bspeed') audience.setBandSpeed(s);
    else if (k === 'bsize') audience.setBandSize(s);
    else if (k[0] === 'g') {
      // the grouping's zone retunes in place: once a frame while dragging
      pendingG = { ...(pendingG || {}), [{ gstep: 'step', gtail: 'tail', gbase: 'base', gspeed: 'speed' }[k]]: s };
      requestAnimationFrame(() => { if (pendingG) { setGroup(pendingG); pendingG = null; } });
    } else if (k[0] === 'i') {
      // the heads' zone rebuilds too: once a frame while dragging
      pendingIR = { ...(pendingIR || {}), [{ ispeed: 'speed', isize: 'size', iprob: 'prob', iheads: 'heads' }[k]]: s };
      requestAnimationFrame(() => { if (pendingIR) { designer.setIR(pendingIR); pendingIR = null; } });
    } else {
      // the wash rebuilds its zone: once a frame is plenty while dragging
      pending = { ...(pending || {}), [k === 'wspeed' ? 'speed' : 'prob']: s };
      requestAnimationFrame(() => { if (pending) { designer.setWash(pending); pending = null; } });
    }
  });
  // --- triggers: the pad menu ---------------------------------------------------------
  const menu = $('.spTrigMenu');
  let menuFor = -1;
  function openTrig(i, btn) {
    if (menuFor === i && !menu.hidden) { closeTrig(); return; }
    menuFor = i;
    const p = pads.pads()[i], key = pads.padKey(i);
    const playing = live();
    menu.innerHTML = p
      ? `<b>${key} · ${esc(p.name)}</b>
         <button class="aqBtn" data-tact="play">▶ Play it now</button>
         <button class="aqBtn" data-tact="fade">〰 Fade the scene${p.fade ? ' (edit)' : '…'}</button>
         <button class="aqBtn spPrimary" data-tact="save">Replace with current previewed effect</button>
         <button class="aqBtn spDanger" data-tact="clear">Clear this trigger</button>`
      : `<b>${key} · Empty</b>
         <button class="aqBtn spPrimary" data-tact="save">Add current previewed effect to trigger</button>
         ${playing ? '' : '<small>The wristbands are off: the trigger will keep the room’s look without a show.</small>'}`;
    // under the pad that was tapped
    const box = menu.parentElement.getBoundingClientRect(), r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom - box.top + 6}px`;
    menu.style.left = `${Math.max(0, Math.min(box.width - 236, r.left - box.left - 6))}px`;
    menu.hidden = false;
    for (const b of qa('[data-trig]')) b.classList.toggle('open', Number(b.dataset.trig) === i);
  }
  function closeTrig() {
    menu.hidden = true;
    menuFor = -1;
    for (const b of qa('[data-trig].open')) b.classList.remove('open');
  }
  function trigAction(a) {
    const i = menuFor;
    if (i < 0) return;
    const btn = $(`[data-trig="${i}"]`);
    if (a === 'save') {
      // the MH collecting sweep is a trigger of its own that takes over from the
      // one before: it changes the wristbands and the heads, and leaves the
      // lights and the rest of the room as that trigger left them
      const sweep = kindPlaying() === 'ir' && designer.ir.motion === 'collect';
      pads.assign(i, undefined, sweep ? { only: ['orbs'] } : {});
      btn.classList.remove('stored'); void btn.offsetWidth; btn.classList.add('stored');
      pads.hint?.(sweep ? `MH collecting sweep on trigger ${pads.padKey(i)}: it takes over from the trigger before it` : `Saved on trigger ${pads.padKey(i)}`);
    } else if (a === 'play') {
      pads.fire(i);
      if (prefs.kind !== kindPlaying() && kindPlaying()) { prefs.kind = kindPlaying(); save(); }
    } else if (a === 'clear') pads.clear(i);
    else if (a === 'fade') { closeTrig(); openFade(i); return; }
    closeTrig();
    render();
  }

  // --- a trigger's fade line: the shared editor (fadeeditor.js) ----------------------
  const fadeEditor = createFadeEditor({
    onChange: (fade) => { if (fadeFor >= 0) pads.setFade(fadeFor, fade); },
    onPlay: () => { if (fadeFor >= 0) pads.fire(fadeFor); },
    onDone: () => { fadeFor = -1; render(); },
    onRemove: () => { if (fadeFor >= 0) pads.setFade(fadeFor, null); fadeFor = -1; render(); },
    fadeNow,
  });
  if (pads) $('.spFadeMount').appendChild(fadeEditor.el);
  function openFade(i) {
    fadeFor = i;
    const L = pads.activeLayer(), p = pads.pads()[i];
    fadeEditor.edit({ title: `${pads.padKey(i)} · ${p ? p.name : ''} · fade`, fade: pads.fadeOf(L, i), layer: L, pad: i });
    render();
  }
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('[data-trig]')) closeTrig(); });
  if (pads) pads.onChange = () => {
    // an undo can change the line the editor is showing: it follows, or shuts
    if (fadeEditor.open && fadeEditor.who) {
      fadeEditor.sync(pads.fadeOf(fadeEditor.who.layer, fadeEditor.who.pad));
      if (!fadeEditor.open) fadeFor = -1;
    }
    if (open) render();
  };
  if (pads) pads.onRecord = () => render();
  // keys typed into the panel (a slider's arrows) are the panel's, not the camera's
  onHosts('keydown', (e) => { if (e.target.matches('input, select')) e.stopPropagation(); });

  // --- the little previews: presets on a map of the arena, effects on a block of bands --
  const tiles = [...qa('.spPreset[data-demo]')].map((b) => ({ id: b.dataset.demo, c: b.querySelector('canvas'), player: null, key: '' }));
  const groupTiles = [...qa('[data-gpreset]')].map((b) => ({ id: b.dataset.gpreset, c: b.querySelector('canvas'), player: null, key: '' }));
  const groupMap = { c: $('.spGroupMap'), player: null, key: '' };
  // the effect tiles play the colour, speed and probability chosen; the presets their own
  const fxTiles = [...qa('[data-fx]')].map((b) => ({ fx: b.dataset.fx, c: b.querySelector('canvas') }));
  const presetTiles = [...root.querySelectorAll('[data-vibe]')].map((b) => ({ p: UNI[b.dataset.vibe], c: b.querySelector('canvas') }));
  const motionTiles = [...root.querySelectorAll('[data-mhp]')].map((b) => ({ id: b.dataset.mhp, c: b.querySelector('canvas'), player: null, key: '' }));
  const bodyEl = $('.spBody');
  let lastGrid = 0, lastFx = 0, lastIR = 0, lastGroup = 0;
  const fit = (c, r, dpr) => {
    const W = Math.max(2, Math.round(r.width * dpr)), H = Math.max(2, Math.round(r.height * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  };
  let looping = false;
  const kick = () => { if (!looping) { looping = true; requestAnimationFrame(frame); } };
  // the video window's pictures: the effects to pick, and the ones picked
  const vTiles = [...vwin.querySelectorAll('[data-vadd]')].map((b) => {
    const [kind, id] = b.dataset.vadd.split(':');
    return { kind, id, c: b.querySelector('canvas'), player: null, key: '' };
  });
  const vBody = vwin.querySelector('.spBody');
  let lastV = 0;
  function drawVideoTiles(now, dpr) {
    if (!vopen || now - lastV < 110) return;
    lastV = now;
    const box = vBody.getBoundingClientRect();
    const seen = (r) => r.width > 0 && r.bottom > box.top && r.top < box.bottom;
    const br = designer.brand, gkey = `${br.a}|${br.b}`;
    const t = now / 1000;
    const draw = (tl, kind, make, wash) => {
      const r = tl.c.getBoundingClientRect();
      if (!seen(r)) return;
      fit(tl.c, r, dpr);
      const g = tl.c.getContext('2d');
      if (kind === 'wash') { drawThumb(g, LOOK.wash, srgb(wash.a), [0, 0, 0], t, { rows: 4, wash }); return; }
      if (!tl.player) tl.player = preview(make());
      tl.player.draw(g, t, visible);
    };
    const C = colNow(), ckey = `${C.list.join()}|${!!C.rainbow}|${br.a}|${br.b}|${(br.extra || []).join()}|${!!br.rainbow}`;
    for (const tl of vTiles) {
      if (tl.kind !== prefs.vkind) continue;
      if (tl.key !== ckey) { tl.player = null; tl.key = ckey; }
      const V = tl.kind === 'wash' ? { ...UNI[tl.id], a: C.a, cmode: cm(UNI[tl.id].cmode, C), palRGB: C.list.map(srgb) } : null;
      draw(tl, tl.kind, () => (tl.kind === 'grid' ? designer.previewZones(tl.id)
        : tl.kind === 'ir' ? mhZones(tl.id, C) : groupZones(tl.id, C, `v-${tl.id}`)), V);
    }
    for (const tl of reelTiles) {
      const S = tl.it?.show;
      if (!S) continue;
      const kind = tl.it.kind === 'wash' || S.demo === 'wash' ? 'wash' : 'zones';
      draw(tl, kind, () => (tl.it.kind === 'group' ? designer.previewGroup(S.group, `r-${tl.it.id}`) : S.zones), S.wash);
    }
  }
  function frame(now) {
    if (!open && !vopen) { looping = false; return; }
    requestAnimationFrame(frame);
    drawVideoTiles(now, Math.min(2, devicePixelRatio || 1));
    if (!open) return;
    // a running fade moves its slider
    if (designer.fading) {
      const lvl = $('input[data-k="flevel"]');
      if (lvl && document.activeElement !== lvl) {
        const v = designer.level;
        lvl.value = String(v);
        lvl.style.setProperty('--fill', `${(v * 100).toFixed(1)}%`);
        lvl.closest('.aqSlider').querySelector('em').textContent = `${Math.round(v * 100)}%`;
      }
    }
    const box = bodyEl.getBoundingClientRect();
    const seen = (r) => r.width > 0 && r.bottom > box.top && r.top < box.bottom;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (prefs.kind === 'grid' && now - lastGrid > 160) {
      lastGrid = now;
      const br = designer.brand;
      const floor = orbFX.groups.some((g, gi) => gi > 0 && g.n && visible(g));
      const key = `${br.a}|${br.b}|${(br.extra || []).join()}|${!!br.rainbow}|${floor}`;
      for (const tl of tiles) {
        const r = tl.c.getBoundingClientRect();
        if (!seen(r)) continue;
        fit(tl.c, r, dpr);
        if (!tl.player || tl.key !== key) { tl.player = preview(designer.previewZones(tl.id)); tl.key = key; }
        tl.player.draw(tl.c.getContext('2d'), now / 1000, visible);
      }
    }
    // the moving heads on a map of the bowl, each preset in the colours chosen
    if (prefs.kind === 'ir' && now - lastIR > 90) {
      lastIR = now;
      const C = colNow();
      const floor = orbFX.groups.some((g, gi) => gi > 0 && g.n && visible(g));
      const key = JSON.stringify([C.list, !!C.rainbow, floor]);
      for (const tl of motionTiles) {
        const r = tl.c.getBoundingClientRect();
        if (!seen(r)) continue;
        fit(tl.c, r, dpr);
        // a tile shows its preset as tapping it would play it: its own effect, gobo and size
        if (!tl.player || tl.key !== key) { tl.player = preview(mhZones(tl.id, C)); tl.key = key; }
        tl.player.draw(tl.c.getContext('2d'), now / 1000, visible);
      }
    }
    // grouping: each preset on a map of the room, and the grouping as it is set,
    // the waiting sections faintly lit so every zone and group reads
    if (prefs.kind === 'group' && now - lastGroup > 70) {
      lastGroup = now;
      const floor = orbFX.groups.some((g, gi) => gi > 0 && g.n && visible(g));
      const C = colNow(), gkey = `${C.list.join()}|${!!C.rainbow}|${floor}`;
      for (const tl of groupTiles) {
        const r = tl.c.getBoundingClientRect();
        if (!seen(r)) continue;
        fit(tl.c, r, dpr);
        if (!tl.player || tl.key !== gkey) { tl.player = preview(groupZones(tl.id, C, tl.id)); tl.key = gkey; }
        tl.player.draw(tl.c.getContext('2d'), now / 1000, visible);
      }
      const r = groupMap.c.getBoundingClientRect();
      if (seen(r)) {
        fit(groupMap.c, r, dpr);
        const G = designer.group, key = JSON.stringify([G, floor]);
        if (!groupMap.player || groupMap.key !== key) {
          groupMap.player = preview(designer.previewGroup({ base: Math.max(G.base, 0.2) }, 'map'));
          groupMap.key = key;
        }
        groupMap.player.draw(groupMap.c.getContext('2d'), now / 1000, visible);
      }
    }
    // the effects flash fast (a strobe), so these draw more often; they are tiny
    if (prefs.kind === 'wash' && now - lastFx > 45) {
      lastFx = now;
      const w = designer.wash, a = srgb(w.a);
      for (const tl of fxTiles) {
        const r = tl.c.getBoundingClientRect();
        if (!seen(r)) continue;
        fit(tl.c, r, dpr);
        drawThumb(tl.c.getContext('2d'), LOOK.wash, a, [0, 0, 0], now / 1000,
          { rows: 4, wash: { fx: tl.fx, cmode: w.cmode, prob: w.prob, speed: w.speed } });
      }
      for (const tl of presetTiles) {
        const r = tl.c.getBoundingClientRect();
        if (!seen(r)) continue;
        fit(tl.c, r, dpr);
        const C = colNow();
        drawThumb(tl.c.getContext('2d'), LOOK.wash, srgb(C.a), [0, 0, 0], now / 1000, { rows: 4, wash: { ...tl.p, a: C.a, cmode: cm(tl.p.cmode, C), palRGB: C.list.map(srgb) } });
      }
    }
  }
  // --- the colours you pick, shared by SHOW and the video ---------------------------
  function spd(kind) { const v = prefs.spd?.[kind]; return Number.isFinite(v) ? v : 1; }
  // a colour set, old ({a, b}) or new ({list}), as { list, a, b, rainbow }
  function normCol(c) {
    if (!c) return null;
    const list = Array.isArray(c.list) && c.list.length ? c.list.slice(0, 4) : [c.a, c.b].filter(Boolean);
    if (!list.length) list.push('#ffffff');
    return { list, rainbow: !!c.rainbow, a: list[0], b: list[1] || list[0] };
  }
  function colNow() {
    if (!prefs.col || (!prefs.col.list && !prefs.col.a)) prefs.col = { list: [designer.brand.a, designer.brand.b], rainbow: !!designer.brand.rainbow };
    const C = normCol(prefs.col);
    prefs.col = { list: C.list, rainbow: C.rainbow };
    return C;
  }
  // the colour slots: one round swatch per colour (tap to change it, × to take
  // it out) and + to add one; one at least, four at most
  function paintSlots(C) {
    const key = C.list.join() + C.rainbow;
    for (const host of qa('.spSlots')) {
      if (host.dataset.key === key) continue;
      host.dataset.key = key;
      host.innerHTML = C.list.map((c, i) => `<label class="spSlot" style="--c:${c}" title="Change this colour"><input type="color" data-slot="${i}" value="${c}" aria-label="Colour ${i + 1}">${C.list.length > 1 ? `<button class="spSlotX" data-slotx="${i}" aria-label="Take this colour out">×</button>` : ''}</label>`).join('')
        + (C.list.length < 4 ? '<button class="spSlotAdd" data-slotadd title="Add a colour" aria-label="Add a colour">+</button>' : '');
      host.classList.toggle('rainbow', !!C.rainbow);
    }
  }

  let reelPicked = false;   // an effect in "Your video" was tapped: the colours are for it
  // the colour mode a preset plays in: its own, unless it is "the picked colour" and that is rainbow
  const cm = (own, C) => ((own || 'a') !== 'a' ? own : C.rainbow ? 'rainbow' : C.list.length > 1 ? 'pal' : 'a');
  if (!prefs.spd || typeof prefs.spd !== 'object') prefs.spd = {};
  if (!prefs.mix || typeof prefs.mix !== 'object') prefs.mix = {};
  prefs.mix = { music: 1, crowd: 1, room: 1, bass: 0, mid: 0, treble: 0, sub: 1, rear: 1, punch: 0, ...prefs.mix };
  // the effect playing runs at its tab's speed
  function applySpeed(kind) { designer.setTempo(spd(kind)); }
  // the colours picked: a list of 1 to 4, or rainbow
  function setColour(list, rainbow = false) {
    const L = (list || []).filter(Boolean).slice(0, 4);
    if (!L.length) L.push('#ffffff');
    prefs.col = { list: L, rainbow: !!rainbow };
    save();
    const C = colNow();
    designer.setBrand({ a: C.a, b: C.b, extra: L.slice(2), rainbow: !!rainbow });
    const k = kindPlaying(), mode = cm('a', C);
    if (k === 'grid' && designer.demo) playGrid(designer.demo);
    else if (k === 'wash' && ['a', 'rainbow', 'pal'].includes(designer.wash.cmode)) designer.setWash({ a: C.a, pal: L, cmode: mode });
    else if (k === 'ir' && ['a', 'rainbow', 'pal'].includes(designer.ir.cmode)) designer.setIR({ a: C.a, pal: L, cmode: mode });
    else if (k === 'group' && designer.group.preset) playGroupPreset(designer.group.preset);
    const it = prefs.reel[prefs.reelSel];
    if (vopen && reelPicked && it?.kind) { it.col = { ...prefs.col }; playItem(it); save(); }
    render();
  }
  function playVibe(id, C = colNow()) {
    const { fx, cmode, speed, prob } = UNI[id];
    designer.setWash({ fx, cmode: cm(cmode, C), speed, prob, a: C.a, pal: C.list });
    applySpeed('wash');
  }
  function playMH(id, C = colNow()) {
    const P = MHP[id];
    designer.setIR({ motion: P.motion, fx: P.fx, gobo: P.gobo, size: P.size, heads: P.heads ?? 0, speed: P.speed ?? 1, cmode: cm(P.cmode, C), a: C.a, pal: C.list });
    applySpeed('ir');
  }
  function playGroupPreset(id, C = colNow()) {
    const [pid, name, P] = GROUP_PRESETS.find(([q]) => q === id);
    designer.setGroup({ gsplit: 'across', dir: 1, speed: 1, ...P, ...tintGroup(P, C), preset: pid, name });
    applySpeed('group');
  }
  // a preset's tile, in the colours picked
  const mhZones = (id, C) => {
    const P = MHP[id];
    return designer.previewIR(P.motion).map((z) => ({ ...z, a: C.a, fx: P.fx, gobo: P.gobo, size: P.size, heads: P.heads ?? 0, cmode: cm(P.cmode, C), pal: C.list, speed: P.speed ?? z.speed }));
  };
  const groupZones = (id, C, tag) => {
    const P = GROUP_PRESETS.find(([q]) => q === id)[2];
    return designer.previewGroup({ gsplit: 'across', dir: 1, speed: 1, ...P, ...tintGroup(P, C) }, tag);
  };
  // one of the video's effects: play it in its colours and keep what plays
  function playItem(it) {
    const pr = it.pair != null ? designer.pairs[it.pair] : null;
    const C = normCol(it.col || (pr ? { a: pr[0], b: pr[1] } : null));
    let name = it.id;
    if (it.kind === 'grid') {
      playGrid(it.id, C || colNow());
      name = designer.demoList.find((d) => d.id === it.id)?.name || it.id;
    } else if (it.kind === 'wash') {
      if (UNI[it.id]) { playVibe(it.id, C); name = UNI[it.id].name; }
      else { const P = WASH_PRESETS.find(([id]) => id === it.id); designer.setWash({ ...P[2], ...(C ? { a: C.a, pal: C.list, cmode: cm('a', C) } : {}) }); name = P[1]; }
    } else if (it.kind === 'ir') {
      playMH(it.id, C);
      name = MHP[it.id]?.name || it.id;
    } else if (it.kind === 'group') {
      playGroupPreset(it.id, C);
      name = GROUP_PRESETS.find(([pid]) => pid === it.id)?.[1] || it.id;
    }
    it.name = name;
    it.show = designer.snapshot();
  }
  if (!Number.isInteger(prefs.reelSel) || !prefs.reel[prefs.reelSel]) prefs.reelSel = prefs.reel.length ? prefs.reel.length - 1 : -1;
  let vopen = false;
  function setVOpen(o) {
    vopen = !!o;
    vwin.classList.toggle('open', vopen);
    vfab.classList.toggle('active', vopen);
    prefs.vopen = vopen;
    save();
    if (vopen) { controls?.unlock?.(); vwinMove.front(); kick(); }
    render();
  }
  vfab.addEventListener('click', (e) => { e.stopPropagation(); setVOpen(!vopen); });
  function setOpen(o) {
    open = !!o;
    root.classList.toggle('open', open);
    prefs.closed = !open;
    save();
    if (open) { controls?.unlock?.(); win.front(); kick(); }
    render();
  }
  fab.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyO' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.body.classList.contains('menu') || !document.body.classList.contains('builderOn')) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    setOpen(!open);
  });
  // open by itself the first time you step into the room, unless you closed it last time
  let shown = false;
  new MutationObserver(() => {
    if (!shown && document.body.classList.contains('builderOn') && !document.body.classList.contains('menu')) {
      shown = true;
      if (!prefs.closed) setOpen(true);
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  // Customise or the room can change what is playing: keep the panel honest
  setInterval(() => { if (open || vopen || (setPanel && !setPanel.classList.contains('hidden'))) render(); else fab.classList.toggle('live', live()); }, 700);
  render();

  return {
    open: () => setOpen(true), close: () => setOpen(false),
    openVideo: () => setVOpen(true), closeVideo: () => setVOpen(false),
    get isOpen() { return open; },
    // the room was put back from outside (an undo): keep what it remembers true
    refresh() {
      if (glow) { prefs.glow = glow.screen; prefs.bloom = glow.bloom; }
      if (ir) prefs.beams = !!ir.beamsOn;
      save();
      render();
    },
  };
}
