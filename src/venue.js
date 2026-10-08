// Which room we are standing in, and everything that changes with it.
//
// The world is built ONCE at boot (bowl, roof, rig, FX engines all bind to
// each other), so the venue is a boot-time decision: `?venue=stadium` in the
// URL, or the choice the menu last stored. Switching venues means a reload,
// the same way a custom rig plan already does.
//
// Scale: every module works in metres with the origin at the centre of the
// floor. The arena's rink is a true NHL sheet (60.96 x 25.91 m, textures.js),
// so the football pitch below — 110 x 70 yd = 100.6 x 64.0 m with every
// marking at its regulation metre value — sits in the same world 1:1. Stand
// on the halfway line and the arena's centre-ice dot would be under your feet.
import { RINK_W, RINK_H, RINK_R } from './textures.js';

const params = new URLSearchParams(location.search);
let stored = null;
try { stored = localStorage.getItem('cs-venue'); } catch (_) { /* private mode */ }
// the rooms, in menu order: the arena, the football stadium, the cricket
// ground and the festival field
export const VENUES = [['arena', 'Arena'], ['stadium', 'Stadium'], ['cricket', 'Cricket'], ['festival', 'Festival']];
const pickVenue = (v) => (VENUES.some(([k]) => k === v) ? v : 'arena');
export const VENUE = pickVenue(params.get('venue') || stored);
// Open air: everything but the arena. The stadium, the cricket ground and the
// festival field share the sky, the turf, the ground-support roof over the
// stage and the fireworks, so they all take the stadium's paths.
export const IS_STADIUM = VENUE !== 'arena';
export const IS_CRICKET = VENUE === 'cricket';
export const IS_FESTIVAL = VENUE === 'festival';
export function setVenue(v) {
  try { localStorage.setItem('cs-venue', pickVenue(v)); } catch (_) { /* private mode */ }
}
// Reload into another room. The `?venue=` parameter outranks the stored
// choice, so it is dropped here — otherwise a page opened with ?venue=arena
// could never switch to the stadium from the menu.
export function reloadIntoVenue(v) {
  setVenue(v);
  const u = new URL(location.href);
  u.searchParams.delete('venue');
  location.replace(u.href);
}
// menu categories → the room they need loaded
export const VENUE_OF_CATEGORY = { arena: 'arena', stadium: 'stadium', cricket: 'cricket', festival: 'festival' };

// --- the cricket field -------------------------------------------------------
// Laws of cricket: a 22-yard pitch (20.12 m) 10 ft wide (3.05 m), stumps
// 9 in wide (0.2286 m) and 28 in tall (0.711 m), the popping crease 4 ft
// (1.22 m) in front of them, return creases 4 ft 4 in (1.32 m) either side of
// the middle stump, and the fielding circle 30 yards (27.43 m) from the middle
// stumps at each end.
export const CRICKET = {
  pitchL: 20.12, pitchW: 3.05, crease: 1.22, returnHalf: 1.32,
  stumpH: 0.711, stumpW: 0.2286, circle: 27.43,
};

// --- the pitch (from the reference diagram) ----------------------------------
export const PITCH = {
  L: 100.6, W: 64.0,          // 110 x 70 yd
  penL: 16.5, penW: 40.2,     // penalty area 18 x 44 yd
  goalL: 5.5, goalW: 18.3,    // goal area 6 x 20 yd
  spot: 11.0,                 // penalty mark 12 yd
  arcR: 9.15, circleR: 9.15,  // 10 yd
  cornerR: 0.9,               // 1 yd
  line: 0.12,                 // max 120 mm
  goalMouth: 7.32, goalH: 2.44,
  runEnd: 7.5, runSide: 6.0,  // grass beyond the lines before the track
};

// --- tier tables --------------------------------------------------------------
// The first tier is absolute (o0 = plan offset from the bowl's inner edge,
// h0 = tread height); every later tier starts `gapOff` metres beyond and
// `gapH` metres above the end of the one below. gap 0/0 = a continuation
// tier (one long rake with a walkway), the way bowl.js already stacks them.
// gapH has to house the whole suite level AND the LED band stack on the tier
// front above it. Budget per gap: suite roof slab at 4.06, then 0.35 m of bare
// concrete, then 1.33 m of band stack, so 5.7 with clearance to spare. At 4.45
// the bands hung down across the suite windows.
// Rows, section counts and row pitch are read straight off the Bell Centre's
// own seating chart:
//   * 24 sections on the 100 and 200 levels (six per quadrant, x01 centred on
//     the side centreline), 36 on the 300 and 400 (nine per quadrant) — so the
//     upper deck gets its own finer stair grid instead of inheriting the lower
//     bowl's. `sections` is that count; bowl.js falls back to `aisles`.
//   * 27 / 6 / 10 / 4 rows deep. The chart's big upper deck is the 300s with a
//     short 400 ring stacked on top of it, which is the reverse of the 5 + 7
//     this model used to build.
//   * one row pitch for the whole building (the chart draws 46 px everywhere),
//     so `depth` is the 0.86 legroom the 100s already had, on every level.
// `rise` per level is then what keeps the top row where it was: 27 rows in the
// 100s and two more upstairs would otherwise push the last row of the 400s up
// through the house steel at 38.5.
const ARENA_TIERS = [
  // `depth` is the row-to-row spacing, i.e. the legroom. 0.82 was a tight 32in
  // tread against a 0.45 m seat, leaving 0.37 m to stand in; 0.86 gives 0.41 m.
  // The 0.50 m station pitch across a row is untouched — the chart's 100-level
  // seat spacing works out at 0.50-0.53 m, which is what the bowl already uses.
  { name: '100', rows: 27, sections: 24, o0: 0.9, h0: 1.35, rise: 0.42, depth: 0.86 },
  { name: '200', rows: 6, sections: 24, gapOff: 3.0, gapH: 5.7, rise: 0.58, depth: 0.86 },
  // 0.56 over a 0.86 tread was a 33-degree upper deck, shallow for a real
  // upper bowl and shallow enough that its own front rows cut the sightline to
  // anything low in the 100s. 0.62 is 35.8 degrees — just inside the 36-degree
  // practical maximum, progressive against the 34 degrees of the 200s — and
  // costs nothing radially, so the footprint and the roof deck do not move.
  { name: '300', rows: 10, sections: 36, gapOff: 3.0, gapH: 5.7, rise: 0.62, depth: 0.86 },
  { name: '400', rows: 4, sections: 36, gapOff: 0, gapH: 0, rise: 0.62, depth: 0.86 },
];
// Arrowhead-like: a deep lower tier, a club tier with its box levels, and a
// tall upper deck split by a mid-tier walkway. The upper deck SWOOPS: full
// height along the sidelines, cut down to a few rows behind the goals (see
// `swoop` below), so the rim rises and falls the way that bowl's does.
const STADIUM_TIERS = [
  { name: '100', rows: 32, o0: 1.2, h0: 1.35, rise: 0.40, depth: 0.80 },
  { name: '200', rows: 14, gapOff: 4.0, gapH: 5.2, rise: 0.62, depth: 0.85 },
  { name: '300', rows: 18, gapOff: 4.0, gapH: 5.2, rise: 0.60, depth: 0.85 },
  { name: '400', rows: 18, gapOff: 0, gapH: 0, rise: 0.60, depth: 0.85 },
];

const ARENA = {
  key: 'arena', name: 'Arena',
  bowl: {
    // The bowl's inner edge, 0.9 m outside the REGULATION sheet — which is what
    // put the first 100-level row ~2.1 m off the regulation ice edge, matching
    // the chart, instead of the 3.7 m the old 2.6 gave. A true parallel offset,
    // so r takes the same 0.9. The played sheet is then grown to meet the front
    // wall (see ICE_A/ICE_B/ICE_R in bowl.js), so no apron is left in hockey.
    a: RINK_W / 2 + 0.9, b: RINK_H / 2 + 0.9, r: RINK_R + 0.9,
    segments: 256, aisles: 24, tiers: ARENA_TIERS,
    // Bell Centre numbering: section x01 sits astride the +z side centreline
    // and the numbers climb clockwise, which lands 101 N / 107 E / 113 S /
    // 119 W on the 24-section levels and 301 / 310 / 319 / 328 on the
    // 36-section ones. Without this the aisle grid starts wherever the path
    // does and no section is centred on anything.
    sectionsFromCentre: true, sectionLabels: true,
    // Aisles are spaced by equal arc length on the ring 12 m out — the middle
    // of the lower bowl — not at the front wall. Offsetting a rounded rect
    // leaves the straights the same length and stretches only the corners, so
    // spacing them at the wall (where the straights are 62% of the perimeter
    // instead of 43%) crowded six stairs onto each side straight and starved
    // the corners: straight sections came out 7.3 m wide and held 10 seats a
    // row where the chart's hold 16-18. At 12 m every section is 10.5 m of
    // straight, which is the chart's own section pitch.
    aisleOffset: 12.0,
    // bright club red in both bowls, the club level in navy so the two decks
    // read as separate rings the way the reference building's do
    seatColors: [0xc8102e, 0xbb0c26, 0xd21a36, 0xb00a22],
    tierColors: { '200': [0x1b2340, 0x161d36, 0x212a4a, 0x141b31] },
    concreteLift: 1.18,                     // pale poured concrete, not grey
    // a tall continuous LED ribbon on each tier front over a painted red band
    fascia: { h: 0.85, topGap: 0.18, accent: 0xa8102a, accentH: 0.30, mode: 'solid', colorA: 0x1e6cff },
    wallTop: 46.5, defaultBehind: 'medium',   // follows the roof lift in buildCeiling
  },
  seatHex: '#c8102e',
  // stage geometry (stage.js) and where the default rig is slid to (main.js)
  stageBack: -33, downstageX: -20.0, largeFrontX: -13.6, hugeFrontX: 6.0,
  catStd: 14.0, catLong: 22.0, centreR: 8.4, middleSq: 7.5, fohX: 24,
  roofY: 38.5,                       // house steel: chain motors live here
  // house rig: [x, z, intensity, castShadow, targetX, targetZ]; the 5th entry is
  // the centre light that stays up (dim) in concert mode
  lightY: 29, shadowFar: 40,
  houseLights: [
    [-9, -6.5, 1620, true, -7, -3.8], [9, -6.5, 1620, false, 7, -3.8],
    [-9, 6.5, 1620, false, -7, 3.8], [9, 6.5, 1620, true, 9, 3.8],
    [0, 0, 1360, true, 0, 0], [-16, 0, 1190, false, -12.5, 0], [16, 0, 1190, false, 12.5, 0],
  ],
  endRigs: [[-24, 0, 1160, false, -23, 0], [24, 0, 1160, false, 23, 0]],
  // bowl washes: [zone, x, z, targetX, targetZ, intensity]
  washY: 27.5, washTargetY: 6,
  washes: [['N', 0, 22, 0, 34, 700], ['S', 0, -22, 0, -34, 700], ['E', 30, 0, 44, 0, 730], ['W', -30, 0, -44, 0, 730]],
  showY: 22, showScale: 1, showIntensity: 900,
  cameraFar: 300, fogScale: 1,
  // both grew with the bowl: the rear wall is at 81.6 x 64.1 once the tiers
  // carry the chart's 27 / 6 / 10 / 4 rows, so the old 79 x 61 bird frame
  // cropped the outer ring and the fly box stopped short of the wall
  bird: { hw: 85, hh: 68, y: 120, far: 200 },
  fly: { x: 88, z: 74, yMax: 44.0 },   // high enough to see the raised roof
  jumbo: { x: 0, hang: 18.4, up: 32.5 },
  audio: { mainX: -19.5, mainY: 9, mainZ: 13.5, subX: -20.5, rearX: 25, rearY: 8, rearZ: 12 },
  soundPreset: null,
  followSpot: { x: 34, y: 27.5, hoist: 11.95 },
  sphere: null,                      // the giant video sphere is a stadium stage
};

const STADIUM = {
  key: 'stadium', name: 'Stadium', field: 'football',
  bowl: {
    // 9.7 m behind each goal line, 8 m outside each touchline; the corner
    // radius is kept tight so the pitch corners get 5 m of clear grass
    // instead of the flags brushing the first row
    a: PITCH.L / 2 + 9.7, b: PITCH.W / 2 + 8.0, r: 18.0,
    segments: 384, aisles: 40, tiers: STADIUM_TIERS,
    // aisles are spaced evenly along the curve at the TOP of the lower deck,
    // not at the front wall: that lands more of them in the corners, where
    // the rows fan out, and fewer along the straights. Any section whose
    // front row is still wider than maxSectionW gets a mid-section stair.
    aisleOffset: 26.8, maxSectionW: 15,
    // bright arena red everywhere, the club level in gold like the reference
    seatColors: [0xc41230, 0xb80e28, 0xcc1a36, 0xa90c22],
    tierColors: { '200': [0xe8891a, 0xf39a22, 0xd97a12, 0xef8f1c] },
    concreteLift: 1.45,                     // pale concrete, not the arena's dark grey
    wallTop: 58.5,                          // unused once `swoop` sets the parapet per point
    defaultBehind: 'medium',                // a show tarps the end stand behind the stage
    // rows KEPT behind the goals (nz² = 0); full rows along the sidelines
    // (nz² = 1); the corners blend with nz²^power
    // the 300s + 400s are one stacked deck: the swoop cuts it from the TOP,
    // so behind the goals the 300s stay full and only 4 rows of 400s remain
    swoop: { keep: { '300': 18, '400': 4 }, power: 1.35 },
    parapet: 3.4,                           // wall above the local top row, all the way round
  },
  seatHex: '#c41230',
  // the end stage backs onto the end stand and runs 18 m deep; long runways
  stageBack: -(PITCH.L / 2 + 9.7 - 0.35), downstageX: -40.0, largeFrontX: -31.0, hugeFrontX: -10.0,
  catStd: 24.0, catLong: 40.0, centreR: 13.0, middleSq: 11.0, fohX: 6,
  roofY: 34.0,                       // the show's own ground-support roof grid
  // open air: four corner pylons outside the bowl, lamp heads at 70 m, each
  // throwing ~145 m to its quadrant of the pitch with a narrow 25-degree cone
  // (a wide cone from that height would floodlight the top rows under it)
  lightY: 70, shadowFar: 220, spotAngle: 0.44,
  houseLights: [
    [-114.5, -94.5, 14000, true, -20, -12], [114.5, -94.5, 14000, false, 20, -12],
    [-114.5, 94.5, 14000, false, -20, 12], [114.5, 94.5, 14000, true, 20, 12],
  ],
  endRigs: [],
  washY: 50, washTargetY: 22,
  washes: [['N', 0, 30, 0, 95, 5000], ['S', 0, -30, 0, -95, 5000], ['E', 45, 0, 125, 0, 5200], ['W', -45, 0, -125, 0, 5200]],
  showY: 30, showScale: 2.0, showIntensity: 1800,
  cameraFar: 1500, fogScale: 0.3,
  bird: { hw: 150, hh: 116, y: 200, far: 400 },
  fly: { x: 150, z: 130, yMax: 90 },
  jumbo: { x: 78, hang: 44, up: 50 },
  audio: { mainX: -39.5, mainY: 12, mainZ: 24, subX: -41, rearX: 45, rearY: 10, rearZ: 22 },
  soundPreset: 'stadium',
  followSpot: { x: 124, y: 46.5, hoist: 1.6 },   // perch at the top of the east upper tier
  // the giant video sphere (middle stage option). A 47 m globe with only its
  // top third showing — a 17 m dome on a 52 m round deck, the way the
  // reference stage sits — a 60 m video halo hung over it from four diagonal masts
  // and a spider grid, and the in-the-round ring rig (ringrig.js) below that
  sphere: { R: 23.5, cap: 17, deckR: 26, halo: { r: 30, h: 12, y0: 32 }, mastR: 42, mastY: 54, gridY: 49.4, rigLift: 0 },
};

// A cricket ground: an oval bowl round a 160 m playing field, a deep lower
// tier, a members' level and a tall upper deck, ringed by six light towers.
const CRICKET_TIERS = [
  { name: '100', rows: 30, o0: 3.0, h0: 1.4, rise: 0.36, depth: 0.82 },
  { name: '200', rows: 8, gapOff: 4.0, gapH: 5.2, rise: 0.55, depth: 0.85 },
  { name: '300', rows: 18, gapOff: 4.0, gapH: 5.2, rise: 0.58, depth: 0.85 },
  { name: '400', rows: 8, gapOff: 0, gapH: 0, rise: 0.58, depth: 0.85 },
];
const OVAL = { a: 82, b: 72, r: 64 };
// light towers round the oval, each aimed at its own part of the field
const cricketTowers = () => [30, 90, 150, 210, 270, 330].map((deg, i) => {
  const t = (deg * Math.PI) / 180, x = Math.cos(t) * (OVAL.a + 84), z = Math.sin(t) * (OVAL.b + 84);
  return [x, z, 16000, i === 0, x * 0.18, z * 0.18];
});
const CRICKET_SPEC = {
  key: 'cricket', name: 'Cricket ground', field: 'cricket',
  bowl: {
    ...OVAL, segments: 448, aisles: 48, tiers: CRICKET_TIERS,
    aisleOffset: 22, maxSectionW: 15,
    // a blue bowl with the members' level in gold
    seatColors: [0x1d4ed8, 0x1e40af, 0x2563eb, 0x1a3a9a],
    tierColors: { '200': [0xd4a017, 0xc8960f, 0xdcae2a, 0xbf8f0c] },
    // a show tarps the end stand behind the stage, the way stadium tours do
    concreteLift: 1.4, wallTop: 50, defaultBehind: 'medium', parapet: 2.6,
  },
  seatHex: '#1d4ed8',
  // the end stage backs onto the boundary fence at the far end of the oval
  stageBack: -(OVAL.a - 0.35), downstageX: -(OVAL.a - 20.35), largeFrontX: -(OVAL.a - 30.35), hugeFrontX: -(OVAL.a - 52),
  catStd: 24.0, catLong: 40.0, centreR: 13.0, middleSq: 11.0, fohX: 12,
  roofY: 34.0,
  lightY: 66, shadowFar: 260, spotAngle: 0.46,
  houseLights: cricketTowers(),
  endRigs: [],
  washY: 48, washTargetY: 20,
  washes: [['N', 0, 34, 0, 110, 5400], ['S', 0, -34, 0, -110, 5400], ['E', 48, 0, 125, 0, 5600], ['W', -48, 0, -125, 0, 5600]],
  showY: 30, showScale: 2.2, showIntensity: 1900,
  cameraFar: 1500, fogScale: 0.28,
  bird: { hw: 175, hh: 162, y: 230, far: 460 },
  fly: { x: 175, z: 165, yMax: 95 },
  jumbo: { x: 0, hang: 44, up: 50 },
  audio: { mainX: -(OVAL.a - 21), mainY: 12, mainZ: 24, subX: -(OVAL.a - 19.5), rearX: 45, rearY: 10, rearZ: 22 },
  soundPreset: 'stadium',
  followSpot: { x: OVAL.a + 50, y: 44, hoist: 1.6 },
  sphere: null,
};

// A festival field: no stands at all. The crowd stands on the grass in front
// of one big stage, thinning out towards the back, with delay towers, a FOH
// tent, food stalls along the sides and a fence and a treeline round it all.
// The bowl is still built, one row deep and out of sight, because so much of
// the room is measured from it (the floor, the stage, the bird's-eye view);
// its four "tiers" name the crowd's bands from the stage back, which is what
// the show designer paints (showengine.js).
const FESTIVAL_TIERS = [
  { name: 'Front', rows: 1, sections: 5, o0: 1.2, h0: 1.35, rise: 0.4, depth: 0.8 },
  { name: 'Middle', rows: 1, sections: 5, gapOff: 1.0, gapH: 1.0, rise: 0.4, depth: 0.8 },
  { name: 'Back', rows: 1, sections: 5, gapOff: 1.0, gapH: 1.0, rise: 0.4, depth: 0.8 },
  { name: 'Far back', rows: 1, sections: 5, gapOff: 0, gapH: 0, rise: 0.4, depth: 0.8 },
];
const FIELD = { a: 80, b: 58, r: 34 };
const FESTIVAL_SPEC = {
  key: 'festival', name: 'Festival ground', field: 'festival',
  bowl: {
    ...FIELD, segments: 192, aisles: 20, tiers: FESTIVAL_TIERS, hidden: true,
    seatColors: [0x2a2a2a, 0x2a2a2a, 0x2a2a2a, 0x2a2a2a],
    concreteLift: 1, wallTop: 6, defaultBehind: 'none', parapet: 1,
  },
  // the crowd: bands from the stage back are the show's sections; the
  // standing crowd thins towards the back and has no aisles cut through it
  crowdBands: true, floorFacing: 'stage', gaFalloff: true, gaAisles: false,
  // where the delay towers stand in the crowd (grounds.js): the floor leaves room round them
  crowdHoles: [[10, -24], [10, 24], [44, -28], [44, 28]],
  seatHex: '#2a2a2a',
  stageBack: -(FIELD.a - 0.35), downstageX: -(FIELD.a - 20.35), largeFrontX: -(FIELD.a - 28.35), hugeFrontX: -(FIELD.a - 48),
  catStd: 16.0, catLong: 28.0, centreR: 12.0, middleSq: 10.0, fohX: 18,
  roofY: 30.0,
  // floodlight towers at the four corners of the field
  lightY: 24, shadowFar: 170, spotAngle: 0.62, towerStyle: 'festival',
  houseLights: [[-30, -FIELD.b - 14, 7000, true, -12, -18], [-30, FIELD.b + 14, 7000, false, -12, 18],
    [55, -FIELD.b - 14, 7000, false, 36, -18], [55, FIELD.b + 14, 7000, false, 36, 18]],
  endRigs: [],
  washY: 22, washTargetY: 0,
  washes: [['N', 10, 46, 10, 14, 2600], ['S', 10, -46, 10, -14, 2600], ['E', 66, 0, 36, 0, 2600], ['W', -36, 0, -8, 0, 2600]],
  showY: 24, showScale: 1.6, showIntensity: 1500,
  cameraFar: 1500, fogScale: 0.35,
  bird: { hw: 118, hh: 92, y: 170, far: 360 },
  fly: { x: 170, z: 150, yMax: 80 },
  jumbo: { x: 0, hang: 30, up: 40 },
  audio: { mainX: -(FIELD.a - 21), mainY: 11, mainZ: 20, subX: -(FIELD.a - 19.5), rearX: 30, rearY: 9, rearZ: 18 },
  soundPreset: 'stadium',
  followSpot: { x: 18, y: 14, hoist: 1.6 },
  sphere: null,
};

export const SPEC = { arena: ARENA, stadium: STADIUM, cricket: CRICKET_SPEC, festival: FESTIVAL_SPEC }[VENUE];
