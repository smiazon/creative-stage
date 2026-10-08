// Layer presets: ready-made banks of nine triggers, one bank per layer.
// A layer holds ten pads (keys 1-0); these fill the first nine and leave the
// tenth for the user's own look, so every layer arrives with a free slot.
//
// A trigger is NOT a hand-written 45-field show state. It is a RECIPE:
//   r: console preset macros to run, in order  (console.js PRESETS)
//   s: a sparse override merged onto the result
// `materialise` runs the recipe against the live console, captures the state
// the macros produced, merges the overrides, and moves on — so every preset
// reuses the ~100 combinations the console already ships and tests, and a
// trigger costs one line instead of forty-five.
//
// The live show is saved before materialising and restored after, so building
// a bank never leaves the rig somewhere the user did not ask for.
//
// House rule for every bank: 1 is the softest, 9 is the biggest. Left to right
// always rises in energy. Learn it once and all 32 banks behave the same.

const T = (n, r, s) => ({ n, r: r || [], s: s || {} });

// shorthands for the override blocks
const rig = (o) => ({ rig: o });
const orb = (m, o = {}) => ({ orbs: { mode: m, ...o } });
const fas = (m, o = {}) => ({ fascia: { mode: m, ...o } });
const ppl = (m, o = {}) => ({ crowd: { mode: m, ...o } });
const mix = (...os) => Object.assign({}, ...os);

// --- subsystems -----------------------------------------------------------------
// The four things a trigger can write, and which parts of a captured show state
// each one owns. This is what the deck's master toggles switch, and what a bank
// declares so a toggle can grey itself out when the bank does not touch it.
// The lighting rig owns the LED surfaces too — fascia and b-stage read as part
// of the same look, and nobody wants a separate switch for the ribbon.
export const SUBSYS = {
  // 'lighting' (house lights up/down) deliberately ABSENT: the house coming on
  // mid-song is a venue state, not a concert effect, and having it ride inside
  // every rig look meant picking an effect could raise the house.
  rig: ['rig', 'fascia', 'bstage'],
  // the wristbands: the effect, and the show (GRID, WASH or IR) when one is playing
  orbs: ['orbs', 'show'],
  crowd: ['crowd'],
  fx: ['showfx'],
};
export const SUBSYS_KEYS = Object.keys(SUBSYS);
export const SUBSYS_LABEL = { rig: 'Rig', orbs: 'Orbs', crowd: 'Crowd', fx: 'FX' };

export const CATEGORIES = [
  { key: 'sections', name: 'Song sections' },
  { key: 'energy', name: 'Energy' },
  { key: 'genre', name: 'Genre' },
  { key: 'moments', name: 'Moments' },
  { key: 'systems', name: 'Systems' },
  { key: 'fx', name: 'FX only' },
];

export const LAYER_PRESETS = [
  // ---------------------------------------------------------------- sections
  {
    id: 'default', name: 'Default', category: 'sections',
    blurb: 'General-purpose starter bank — the nine you reach for most',
    pads: [
      T('Blackout', ['lights:dark'], mix(orb('off'), fas('off'), ppl('idle'))),
      T('House up', [], mix(rig({ look: 'preshow' }), orb('solid', { brightness: 0.5 }), fas('solid'), ppl('idle'))),
      T('Low wash', ['lights:soft'], mix(rig({ look: 'ballad', master: 0.8 }), orb('solid', { brightness: 0.6 }), fas('solid'), ppl('idle'))),
      T('Mid wash', ['lights:sweep'], mix(rig({ look: 'intro' }), orb('wave'), fas('wave'), ppl('mix'))),
      T('Colour wash', ['lights:blue'], mix(rig({ look: 'anthem' }), orb('sections'), fas('stripes'), ppl('mix'))),
      T('Full wash', ['lights:party'], mix(rig({ look: 'full' }), orb('rainbow'), fas('rainbow'), ppl('cheer'))),
      T('Strobe stab', ['lights:strobe'], mix(rig({ look: 'hit', strobeOn: true }), orb('strobe'), fas('pulse'), ppl('jump'))),
      T('Laser fan', ['lights:laserfan'], mix(rig({ look: 'lasershow', lasersOn: true }), orb('sparkle'), fas('chase'), ppl('handsup'))),
      T('All out', ['lights:party'], mix(rig({ look: 'drop', blindersOn: true }), orb('fireworks'), fas('rainbow'), ppl('jump'))),
    ],
  },
  {
    id: 'intro', name: 'Intro', category: 'sections',
    blurb: 'Cold open through to the first hit',
    pads: [
      T('Dark', ['lights:dark'], mix(orb('off'), fas('off'), ppl('idle'))),
      T('Single beam', ['lights:white'], mix(rig({ look: 'intro', master: 0.5, haze: 1.4, gain: { beam: 1.2, wash: 0.1, spot: 0.3, strip: 0.2, blinder: 0, strobe: 0, laser: 0, uv: 0 } }), orb('off'), fas('off'))),
      T('Slow riser', ['lights:sweep'], mix(rig({ look: 'intro', master: 0.7, haze: 1.5 }), orb('rise', { speed: 0.5 }), fas('pulse', { speed: 0.5 }))),
      T('Cold wash', ['lights:blue'], mix(rig({ look: 'intro' }), orb('solid', { colorA: '#2f7bff' }), fas('solid', { colorA: '#1e6cff' }))),
      T('Haze glow', ['lights:soft'], mix(rig({ haze: 1.8, master: 0.75 }), orb('twinkle', { speed: 0.6 }), fas('sparkle'))),
      T('First colour', ['lights:sunset'], mix(rig({ look: 'anthem' }), orb('wave'), fas('wave'), ppl('mix'))),
      T('Beam sweep', ['lights:sweep'], mix(rig({ look: 'beamfan', behaviour: 'sweep' }), orb('sweep'), fas('chase'), ppl('mix'))),
      T('Reveal', ['lights:party'], mix(rig({ look: 'full' }), orb('rainbow'), fas('rainbow'), ppl('cheer'))),
      T('Hit', ['lights:strobe'], mix(rig({ look: 'hit', strobeOn: true, blindersOn: true }), orb('strobe'), fas('pulse'), ppl('jump'))),
    ],
  },
  {
    id: 'verse', name: 'Verse', category: 'sections',
    blurb: 'Restrained and moody — keeps the chorus somewhere to go',
    pads: [
      T('Dim blue', ['lights:blue'], mix(rig({ look: 'ballad', master: 0.6 }), orb('solid', { brightness: 0.4, colorA: '#2f7bff' }), fas('solid'), ppl('idle'))),
      T('Warm low', ['lights:soft'], mix(rig({ look: 'ballad', master: 0.7 }), orb('solid', { brightness: 0.5, colorA: '#ffb070' }), fas('solid', { colorA: '#ff8a5a' }), ppl('idle'))),
      T('Side wash', ['lights:sweep'], mix(rig({ look: 'acoustic', behaviour: 'park' }), orb('wave', { speed: 0.7 }), fas('wave', { speed: 0.7 }), ppl('idle'))),
      T('Mid amber', ['lights:sunset'], mix(rig({ look: 'acoustic' }), orb('solid', { colorA: '#ff7a1a' }), fas('stripes'), ppl('mix'))),
      T('Deep purple', ['lights:blue'], mix(rig({ look: 'ballad', colorA: '#9a4aff', colorB: '#5a2fd0' }), orb('solid', { colorA: '#9a4aff' }), fas('solid', { colorA: '#6a2fd0' }), ppl('mix'))),
      T('Soft pulse', ['lights:soft'], mix(rig({ look: 'ballad' }), orb('pulse', { speed: 0.8 }), fas('pulse', { speed: 0.8 }), ppl('mix'))),
      T('Beat tick', ['lights:sweep'], mix(rig({ look: 'intro', behaviour: 'tiltwave' }), orb('checker'), fas('chase'), ppl('mix'))),
      T('Lift', ['lights:sweep'], mix(rig({ look: 'anthem' }), orb('sweep'), fas('wave'), ppl('cheer'))),
      T('Verse peak', ['lights:party'], mix(rig({ look: 'anthem', master: 1 }), orb('rainwave'), fas('rainbow'), ppl('cheer'))),
    ],
  },
  {
    id: 'build', name: 'Build', category: 'sections',
    blurb: 'Pre-chorus riser — the nine steps up to a drop',
    pads: [
      T('Riser start', ['lights:sweep'], mix(rig({ look: 'intro', master: 0.7 }), orb('rise', { speed: 0.7 }), fas('pulse'))),
      T('Add lasers', ['lights:lasersky'], mix(rig({ lasersOn: true }), orb('rise'), fas('chase'))),
      T('Colour climb', ['lights:sunset'], mix(rig({ look: 'anthem' }), orb('rainwave', { speed: 1.3 }), fas('wave', { speed: 1.3 }))),
      T('Beam raise', ['lights:sweep'], mix(rig({ look: 'beamfan', behaviour: 'tiltwave' }), orb('sweep', { speed: 1.4 }), fas('chase', { speed: 1.4 }), ppl('mix'))),
      T('Haze push', ['lights:party'], mix(rig({ haze: 1.8, master: 1 }), orb('spiral'), fas('wave'), ppl('handsup'))),
      T('Fast pulse', ['lights:party'], mix(rig({ look: 'ballyhoo', behaviour: 'ballyhoo' }), orb('pulse', { speed: 2 }), fas('pulse', { speed: 2 }), ppl('handsup'))),
      T('Strobe build', ['lights:strobe'], mix(rig({ look: 'strobefit', strobeOn: true }), orb('strobe', { speed: 1.6 }), fas('pulse', { speed: 2 }), ppl('jump'))),
      T('White prep', ['lights:white'], mix(rig({ look: 'hit', blindersOn: true, master: 1 }), orb('solid', { colorA: '#ffffff', brightness: 1.6 }), fas('solid', { colorA: '#ffffff' }), ppl('jump'))),
      T('Snap to black', ['lights:dark'], mix(orb('off'), fas('off'), ppl('cheer'))),
    ],
  },
  {
    id: 'chorus', name: 'Chorus', category: 'sections',
    blurb: 'Big and anthemic — the bank you live in',
    pads: [
      T('Full colour', ['lights:party'], mix(rig({ look: 'anthem', master: 1 }), orb('sections'), fas('stripes'), ppl('cheer'))),
      T('Alt colour', ['lights:blue'], mix(rig({ look: 'anthem', colorA: '#35c8ff', colorB: '#2f7bff' }), orb('wave', { colorA: '#35c8ff' }), fas('wave'), ppl('cheer'))),
      T('Wide wash', ['lights:party'], mix(rig({ look: 'full', behaviour: 'fan' }), orb('rainbow'), fas('rainbow'), ppl('handsup'))),
      T('Beam spread', ['lights:sweep'], mix(rig({ look: 'beamfan', behaviour: 'fan' }), orb('sweep'), fas('chase'), ppl('handsup'))),
      T('Chase', ['lights:party'], mix(rig({ look: 'ballyhoo', behaviour: 'ballyhoo' }), orb('comet'), fas('chase', { speed: 1.6 }), ppl('cheer'))),
      T('Blinder kiss', ['lights:white'], mix(rig({ look: 'anthem', blindersOn: true }), orb('solid', { colorA: '#ffffff', brightness: 1.5 }), fas('pulse'), ppl('handsup'))),
      T('Laser sheet', ['lights:laserfan'], mix(rig({ look: 'lasershow', lasersOn: true }), orb('sparkle'), fas('chase'), ppl('handsup'))),
      T('Colour flip', ['lights:rainbow'], mix(rig({ look: 'rainbow' }), orb('rainwave', { speed: 1.5 }), fas('rainbow', { speed: 1.5 }), ppl('jump'))),
      T('Anthem', ['lights:party'], mix(rig({ look: 'drop', blindersOn: true, master: 1 }), orb('fireworks'), fas('rainbow'), ppl('jump'))),
    ],
  },
  {
    id: 'drop', name: 'Drop', category: 'sections',
    blurb: 'Impact hits — short, violent, one per moment',
    pads: [
      T('Cut to black', ['lights:dark'], mix(orb('off'), fas('off'), ppl('cheer'))),
      T('Impact white', ['lights:white'], mix(rig({ look: 'hit', blindersOn: true, master: 1 }), orb('solid', { colorA: '#ffffff', brightness: 2 }), fas('solid', { colorA: '#ffffff' }), ppl('jump'))),
      T('Bass bump', ['lights:fire'], mix(rig({ look: 'drop', behaviour: 'ballyhoo' }), orb('pulse', { speed: 2.2 }), fas('pulse', { speed: 2.2 }), ppl('jump'))),
      T('Strobe hit', ['lights:strobe'], mix(rig({ look: 'hit', strobeOn: true }), orb('strobe', { speed: 2 }), fas('pulse', { speed: 2.4 }), ppl('jump'))),
      T('Laser stab', ['lights:lasertunnel'], mix(rig({ look: 'lasershow', lasersOn: true }), orb('checker'), fas('chase', { speed: 2 }), ppl('jump'))),
      T('Blinder slam', ['lights:white'], mix(rig({ look: 'drop', blindersOn: true, strobeOn: true }), orb('solid', { colorA: '#fff2d0', brightness: 2 }), fas('pulse'), ppl('jump'))),
      T('Colour slam', ['lights:rainbow'], mix(rig({ look: 'drop' }), orb('rainbow', { speed: 2 }), fas('rainbow', { speed: 2 }), ppl('jump'))),
      T('Double hit', ['lights:strobe', 'fx:co2'], mix(rig({ look: 'hit', strobeOn: true, blindersOn: true }), orb('fireworks'), fas('pulse', { speed: 2.4 }), ppl('jump'))),
      T('Detonation', ['lights:party', 'fx:pyro'], mix(rig({ look: 'drop', blindersOn: true, strobeOn: true, master: 1 }), orb('fireworks', { speed: 2 }), fas('rainbow', { speed: 2 }), ppl('jump'))),
    ],
  },
  {
    id: 'breakdown', name: 'Breakdown', category: 'sections',
    blurb: 'Sparse and atmospheric — the room gets its air back',
    pads: [
      T('Near dark', ['lights:dark'], mix(rig({ look: 'blackout', haze: 1.6 }), orb('twinkle', { brightness: 0.3, speed: 0.4 }), fas('off'), ppl('idle'))),
      T('Lone beam', ['lights:white'], mix(rig({ look: 'intro', master: 0.45, haze: 1.7, gain: { beam: 1.4, wash: 0.05, spot: 0.4, strip: 0.1, blinder: 0, strobe: 0, laser: 0, uv: 0 } }), orb('off'), fas('off'))),
      T('Slow sweep', ['lights:sweep'], mix(rig({ look: 'intro', behaviour: 'sweep', master: 0.6 }), orb('sweep', { speed: 0.4 }), fas('wave', { speed: 0.4 }))),
      T('Cold pool', ['lights:blue'], mix(rig({ look: 'ballad', master: 0.6 }), orb('solid', { colorA: '#2f7bff', brightness: 0.5 }), fas('solid'))),
      T('Haze only', [], mix(rig({ look: 'blackout', haze: 2 }), orb('noise', { brightness: 0.35, speed: 0.5 }), fas('off'), ppl('idle'))),
      T('Drift colour', ['lights:soft'], mix(rig({ look: 'ballad' }), orb('rainwave', { speed: 0.4 }), fas('wave', { speed: 0.4 }), ppl('idle'))),
      T('Sparse tick', ['lights:sweep'], mix(rig({ look: 'acoustic', behaviour: 'tiltwave' }), orb('checker', { speed: 0.7 }), fas('chase', { speed: 0.6 }), ppl('mix'))),
      T('Swell', ['lights:sunset'], mix(rig({ look: 'anthem' }), orb('rise'), fas('pulse'), ppl('mix'))),
      T('Re-enter', ['lights:party'], mix(rig({ look: 'full' }), orb('rainbow'), fas('rainbow'), ppl('cheer'))),
    ],
  },
  {
    id: 'bridge', name: 'Bridge', category: 'sections',
    blurb: 'A different colour identity so the last chorus lands new',
    pads: [
      T('Mood shift', ['lights:blue'], mix(rig({ look: 'ballad', colorA: '#2fd0c0', colorB: '#2f7bff' }), orb('solid', { colorA: '#2fd0c0' }), fas('solid'), ppl('idle'))),
      T('New colour', ['lights:sunset'], mix(rig({ look: 'acoustic', colorA: '#ff2fb4', colorB: '#9a4aff' }), orb('solid', { colorA: '#ff2fb4' }), fas('stripes'), ppl('mix'))),
      T('Narrow beams', ['lights:sweep'], mix(rig({ look: 'beamfan', behaviour: 'park', haze: 1.5 }), orb('twinkle'), fas('off'), ppl('mix'))),
      T('Split colour', ['lights:blue'], mix(rig({ look: 'crossfire', colorA: '#ff7a1a', colorB: '#2f7bff' }), orb('sections'), fas('stripes'), ppl('mix'))),
      T('Slow chase', ['lights:sweep'], mix(rig({ look: 'tilt', behaviour: 'crossbeams' }), orb('comet', { speed: 0.7 }), fas('chase', { speed: 0.8 }), ppl('mix'))),
      T('Soft strobe', ['lights:strobe'], mix(rig({ look: 'strobefit', strobeOn: true, master: 0.8 }), orb('strobe', { speed: 0.8 }), fas('pulse'), ppl('handsup'))),
      T('Rise', ['lights:party'], mix(rig({ look: 'anthem' }), orb('rise', { speed: 1.3 }), fas('wave', { speed: 1.3 }), ppl('handsup'))),
      T('Turn', ['lights:rainbow'], mix(rig({ look: 'rainbow' }), orb('spiral'), fas('rainbow'), ppl('cheer'))),
      T('Bridge peak', ['lights:party'], mix(rig({ look: 'encore' }), orb('fireworks'), fas('rainbow'), ppl('jump'))),
    ],
  },
  {
    id: 'outro', name: 'Outro', category: 'sections',
    blurb: 'Wind-down to house lights',
    pads: [
      T('Last chorus', ['lights:party'], mix(rig({ look: 'encore', master: 1 }), orb('rainbow'), fas('rainbow'), ppl('cheer'))),
      T('Wind down', ['lights:sweep'], mix(rig({ look: 'anthem', master: 0.85 }), orb('wave', { speed: 0.8 }), fas('wave'), ppl('cheer'))),
      T('Fade colour', ['lights:soft'], mix(rig({ look: 'ballad', master: 0.7 }), orb('solid', { brightness: 0.7 }), fas('solid'), ppl('mix'))),
      T('Single wash', ['lights:white'], mix(rig({ look: 'acoustic', master: 0.6 }), orb('solid', { colorA: '#ffd7a0', brightness: 0.6 }), fas('solid'), ppl('mix'))),
      T('Haze fade', ['lights:soft'], mix(rig({ haze: 0.6, master: 0.5 }), orb('twinkle', { brightness: 0.4 }), fas('sparkle'), ppl('idle'))),
      T('Beam park', [], mix(rig({ look: 'intro', behaviour: 'park', master: 0.4 }), orb('off'), fas('off'), ppl('idle'))),
      T('Bow light', ['lights:white'], mix(rig({ look: 'full', master: 0.9 }), orb('solid', { colorA: '#ffffff' }), fas('solid', { colorA: '#ffffff' }), ppl('cheer'))),
      T('House warm', [], mix(rig({ look: 'preshow' }), orb('solid', { brightness: 0.5 }), fas('ads'), ppl('idle'))),
      T('House full', [], mix(rig({ look: 'blackout' }), orb('off'), fas('ads'), ppl('idle'))),
    ],
  },

  // ------------------------------------------------------------------ energy
  {
    id: 'strobe', name: 'Strobe', category: 'energy',
    blurb: 'Nine flavours of strobe and blinder, slow to brutal',
    pads: [
      T('Slow blink', ['lights:strobe'], mix(rig({ look: 'strobefit', strobeOn: true, master: 0.6, gain: { strobe: 0.5, beam: 0.6, wash: 0.4, spot: 0.5, strip: 0.6, blinder: 0, laser: 0, uv: 0 } }), orb('strobe', { speed: 0.5 }))),
      T('Half speed', ['lights:strobe'], mix(rig({ look: 'strobefit', strobeOn: true, master: 0.8 }), orb('strobe', { speed: 0.7 }), fas('pulse', { speed: 0.7 }))),
      T('On beat', ['lights:strobe'], mix(rig({ look: 'strobefit', strobeOn: true }), orb('strobe', { speed: 1 }), fas('pulse'), ppl('jump'))),
      T('Double time', ['lights:strobe'], mix(rig({ look: 'hit', strobeOn: true }), orb('strobe', { speed: 2 }), fas('pulse', { speed: 2 }), ppl('jump'))),
      T('Burst 4', ['lights:strobe'], mix(rig({ look: 'hit', strobeOn: true, gain: { strobe: 1.6, beam: 1, wash: 0.6, spot: 1, strip: 1, blinder: 0.4, laser: 0, uv: 0 } }), orb('checker', { speed: 2 }), ppl('jump'))),
      T('Burst 8', ['lights:strobe'], mix(rig({ look: 'hit', strobeOn: true, gain: { strobe: 2, beam: 1, wash: 0.5, spot: 1, strip: 1, blinder: 0.6, laser: 0, uv: 0 } }), orb('random', { speed: 2.4 }), ppl('jump'))),
      T('Blinder strobe', ['lights:white'], mix(rig({ look: 'hit', strobeOn: true, blindersOn: true }), orb('solid', { colorA: '#fff2d0', brightness: 1.8 }), fas('pulse', { speed: 2 }), ppl('jump'))),
      T('Colour strobe', ['lights:rainbow'], mix(rig({ look: 'strobefit', strobeOn: true }), orb('strobe', { speed: 1.6, colorA: '#ff2f6e', colorB: '#2f7bff' }), fas('rainbow', { speed: 2 }), ppl('jump'))),
      T('Machine gun', ['lights:strobe'], mix(rig({ look: 'drop', strobeOn: true, blindersOn: true, master: 1, gain: { strobe: 2, blinder: 1.4, beam: 1.2, wash: 0.4, spot: 1, strip: 1, laser: 0, uv: 0 } }), orb('strobe', { speed: 3 }), fas('pulse', { speed: 3 }), ppl('jump'))),
    ],
  },
  {
    id: 'lasers', name: 'Lasers', category: 'energy',
    blurb: 'Every laser shape the rig can throw',
    pads: [
      T('Off', [], mix(rig({ lasersOn: false }))),
      T('Single fan', ['lights:laserfan'], mix(rig({ lasersOn: true, laserPer: 2, laserSweep: 0.7 }), orb('twinkle'))),
      T('Wide fan', ['lights:laserfan'], mix(rig({ lasersOn: true, laserPer: 6, laserSweep: 1 }), orb('sparkle'))),
      T('Sheet low', ['lights:laserscan'], mix(rig({ lasersOn: true, laserRing: 1, laserSweep: 0.9 }), orb('wave'))),
      T('Sheet high', ['lights:lasersky'], mix(rig({ lasersOn: true, laserRing: 5, laserSweep: 0.8 }), orb('rise'))),
      T('Sweep slow', ['lights:laserscan'], mix(rig({ lasersOn: true, laserSweep: 0.5 }), orb('sweep', { speed: 0.6 }))),
      T('Sweep fast', ['lights:laserscan'], mix(rig({ lasersOn: true, laserSweep: 2 }), orb('sweep', { speed: 2 }), ppl('handsup'))),
      T('Tunnel', ['lights:lasertunnel'], mix(rig({ lasersOn: true, laserPer: 8 }), orb('spiral'), ppl('handsup'))),
      T('Full lattice', ['lights:lasers', 'lights:laserfan'], mix(rig({ look: 'lasershow', lasersOn: true, laserPer: 9, laserSweep: 1.4, master: 1 }), orb('fireworks'), fas('chase', { speed: 2 }), ppl('jump'))),
    ],
  },
  {
    id: 'full', name: 'Full', category: 'energy',
    blurb: 'Nine solid full-rig colours — the fastest way to change the room',
    pads: [
      T('White', ['lights:white'], mix(rig({ look: 'full', colorA: '#ffffff', colorB: '#ffffff' }), orb('solid', { colorA: '#ffffff' }), fas('solid', { colorA: '#ffffff' }))),
      T('Warm', ['lights:soft'], mix(rig({ look: 'full', colorA: '#ffb070', colorB: '#ff8a5a' }), orb('solid', { colorA: '#ffb070' }), fas('solid', { colorA: '#ff8a5a' }))),
      T('Cold', ['lights:blue'], mix(rig({ look: 'full', colorA: '#9ad8ff', colorB: '#35c8ff' }), orb('solid', { colorA: '#9ad8ff' }), fas('solid', { colorA: '#35c8ff' }))),
      T('Red', ['lights:fire'], mix(rig({ look: 'full', colorA: '#ff2020', colorB: '#c8102e' }), orb('solid', { colorA: '#ff2020' }), fas('solid', { colorA: '#c8102e' }))),
      T('Blue', ['lights:blue'], mix(rig({ look: 'full', colorA: '#2f7bff', colorB: '#1e3ccc' }), orb('solid', { colorA: '#2f7bff' }), fas('solid', { colorA: '#1e3ccc' }))),
      T('Green', [], mix(rig({ look: 'full', colorA: '#2fd06a', colorB: '#10a050' }), orb('solid', { colorA: '#2fd06a' }), fas('solid', { colorA: '#10a050' }))),
      T('Magenta', [], mix(rig({ look: 'full', colorA: '#ff2fb4', colorB: '#c01090' }), orb('solid', { colorA: '#ff2fb4' }), fas('solid', { colorA: '#c01090' }))),
      T('Amber', ['lights:sunset'], mix(rig({ look: 'full', colorA: '#ffa020', colorB: '#ff7a1a' }), orb('solid', { colorA: '#ffa020' }), fas('solid', { colorA: '#ff7a1a' }))),
      T('Rainbow', ['lights:rainbow'], mix(rig({ look: 'rainbow' }), orb('rainbow'), fas('rainbow'))),
    ],
  },
  {
    id: 'party', name: 'Party', category: 'energy',
    blurb: 'Bright, saturated and fun — nothing subtle in here',
    pads: [
      T('Bright pop', ['lights:party'], mix(rig({ look: 'anthem' }), orb('sections'), fas('stripes'), ppl('cheer'))),
      T('Candy colour', ['lights:rainbow'], mix(rig({ look: 'rainbow', colorA: '#ff2fb4', colorB: '#35c8ff' }), orb('rainwave'), fas('rainbow'), ppl('cheer'))),
      T('Bounce chase', ['lights:party'], mix(rig({ look: 'ballyhoo', behaviour: 'ballyhoo' }), orb('comet', { speed: 1.6 }), fas('chase', { speed: 1.6 }), ppl('jump'))),
      T('Colour spin', ['lights:rainbow'], mix(rig({ look: 'rainbow', behaviour: 'ballyhoo' }), orb('spiral', { speed: 1.5 }), fas('rainbow', { speed: 1.6 }), ppl('jump'))),
      T('Confetti pop', ['lights:party', 'fx:confetti'], mix(rig({ look: 'full' }), orb('sparkle'), fas('rainbow'), ppl('jump'))),
      T('Balloon drop', ['lights:party', 'crowd:balloons'], mix(rig({ look: 'full' }), orb('rainbow'), fas('rainbow'), ppl('cheer'))),
      T('Strobe party', ['lights:strobe'], mix(rig({ look: 'strobefit', strobeOn: true }), orb('strobe', { speed: 1.6 }), fas('pulse', { speed: 2 }), ppl('jump'))),
      T('Wristband party', ['crowd:rainbow'], mix(rig({ look: 'anthem', master: 0.7 }), orb('rainwave', { brightness: 1.8, speed: 1.5 }), fas('rainbow'), ppl('handsup'))),
      T('Everything', ['lights:party', 'fx:confetti', 'fx:co2'], mix(rig({ look: 'drop', blindersOn: true, master: 1 }), orb('fireworks'), fas('rainbow'), ppl('jump'))),
    ],
  },
  {
    id: 'crowd', name: 'Crowd', category: 'energy',
    blurb: 'Wristband and crowd-led moments — the bowl is the effect',
    pads: [
      T('Orbs off', ['crowd:off'], mix(orb('off'), ppl('idle'))),
      T('Dim glow', ['crowd:glow'], mix(orb('solid', { brightness: 0.45 }), ppl('idle'))),
      T('Slow breathe', ['crowd:heartbeat'], mix(orb('heartbeat', { speed: 0.6 }), ppl('idle'))),
      T('Colour wave', ['crowd:wave'], mix(orb('wave', { speed: 1 }), ppl('mix'))),
      T('Team colours', [], mix(orb('sections', { colorA: '#c8102e', colorB: '#1e3ccc' }), fas('stripes'), ppl('mix'))),
      T('Ripple', [], mix(orb('ripple', { speed: 1.2 }), fas('wave'), ppl('mix'))),
      T('Sparkle', ['crowd:twinkle'], mix(orb('twinkle', { speed: 1.4 }), fas('sparkle'), ppl('cheer'))),
      T('Sing-along', ['crowd:hands'], mix(orb('solid', { colorA: '#ffd7a0', brightness: 1.4 }), rig({ look: 'ballad', master: 0.6 }), ppl('handsup'))),
      T('Full blaze', ['crowd:rainbow', 'crowd:cheer'], mix(orb('fireworks', { brightness: 2, speed: 1.6 }), fas('rainbow'), ppl('jump'))),
    ],
  },
  {
    id: 'stabs', name: 'Blackout & stabs', category: 'energy',
    blurb: 'Dark room punctuated by hits — great under a rap verse',
    pads: [
      T('Blackout', ['lights:dark'], mix(orb('off'), fas('off'), ppl('idle'))),
      T('Beat stab', ['lights:white'], mix(rig({ look: 'hit', master: 0.9 }), orb('strobe', { speed: 1 }), fas('pulse'), ppl('mix'))),
      T('Off-beat stab', ['lights:white'], mix(rig({ look: 'hit', behaviour: 'tiltwave' }), orb('checker', { speed: 1 }), fas('pulse'), ppl('mix'))),
      T('White stab', ['lights:white'], mix(rig({ look: 'hit', blindersOn: true, colorA: '#ffffff', colorB: '#ffffff' }), orb('solid', { colorA: '#ffffff', brightness: 1.8 }), ppl('jump'))),
      T('Colour stab', ['lights:fire'], mix(rig({ look: 'hit', colorA: '#ff2020', colorB: '#ffc61a' }), orb('solid', { colorA: '#ff2020', brightness: 1.6 }), ppl('jump'))),
      T('Double', ['lights:strobe'], mix(rig({ look: 'hit', strobeOn: true }), orb('strobe', { speed: 2 }), fas('pulse', { speed: 2 }), ppl('jump'))),
      T('Triple', ['lights:strobe'], mix(rig({ look: 'hit', strobeOn: true, blindersOn: true }), orb('strobe', { speed: 2.6 }), fas('pulse', { speed: 2.6 }), ppl('jump'))),
      T('Long hold', ['lights:party'], mix(rig({ look: 'full', master: 1 }), orb('solid', { brightness: 1.6 }), fas('solid'), ppl('handsup'))),
      T('Return', ['lights:party'], mix(rig({ look: 'anthem' }), orb('rainbow'), fas('rainbow'), ppl('cheer'))),
    ],
  },

  // ------------------------------------------------------------------- genre
  {
    id: 'rock', name: 'Rock', category: 'genre',
    blurb: 'White, amber, blinders and haze — guitars, not colour',
    pads: [
      T('Dark amber', ['lights:sunset'], mix(rig({ look: 'ballad', colorA: '#ff7a1a', colorB: '#c8500a', master: 0.7, haze: 1.5 }), orb('solid', { brightness: 0.4 }), fas('off'), ppl('idle'))),
      T('Warm side', ['lights:soft'], mix(rig({ look: 'acoustic', colorA: '#ffb070' }), orb('solid', { colorA: '#ffb070', brightness: 0.6 }), fas('solid'), ppl('mix'))),
      T('White cross', ['lights:white'], mix(rig({ look: 'crossfire', colorA: '#ffffff', colorB: '#ffffff', haze: 1.6 }), orb('off'), fas('off'), ppl('mix'))),
      T('Blinder low', ['lights:white'], mix(rig({ look: 'anthem', blindersOn: true, gain: { blinder: 0.7, beam: 1, wash: 0.6, spot: 1, strip: 1, strobe: 0, laser: 0, uv: 0 } }), orb('solid', { colorA: '#fff2d0' }), ppl('handsup'))),
      T('Haze beams', ['lights:sweep'], mix(rig({ look: 'beamfan', behaviour: 'crossbeams', haze: 1.9 }), orb('off'), fas('off'), ppl('mix'))),
      T('Backlight wall', ['lights:white'], mix(rig({ look: 'full', colorA: '#ffffff', colorB: '#ffd7a0', master: 1 }), orb('solid', { colorA: '#ffffff', brightness: 1.4 }), fas('solid', { colorA: '#ffffff' }), ppl('handsup'))),
      T('Strobe rock', ['lights:strobe'], mix(rig({ look: 'strobefit', strobeOn: true, colorA: '#ffffff', colorB: '#ffffff' }), orb('strobe'), fas('pulse'), ppl('jump'))),
      T('Full white', ['lights:white'], mix(rig({ look: 'drop', blindersOn: true, colorA: '#ffffff', colorB: '#ffffff', master: 1 }), orb('solid', { colorA: '#ffffff', brightness: 2 }), fas('solid', { colorA: '#ffffff' }), ppl('jump'))),
      T('Big finish', ['lights:party', 'fx:pyro'], mix(rig({ look: 'encore', blindersOn: true, strobeOn: true, master: 1 }), orb('fireworks'), fas('rainbow'), ppl('jump'))),
    ],
  },
  {
    id: 'edm', name: 'EDM', category: 'genre',
    blurb: 'Aggressive colour, lattices and peak-time strobes',
    pads: [
      T('Sub dark', ['lights:dark'], mix(rig({ haze: 1.8 }), orb('noise', { brightness: 0.4, speed: 0.6 }), fas('off'), ppl('idle'))),
      T('Riser', ['lights:sweep'], mix(rig({ look: 'intro', master: 0.8, haze: 1.6 }), orb('rise', { speed: 1.4 }), fas('pulse', { speed: 1.4 }), ppl('mix'))),
      T('Lattice', ['lights:lasertunnel'], mix(rig({ look: 'lasershow', lasersOn: true, laserPer: 8 }), orb('spiral'), fas('chase'), ppl('handsup'))),
      T('Colour spin', ['lights:rainbow'], mix(rig({ look: 'rainbow', behaviour: 'ballyhoo' }), orb('rainwave', { speed: 1.6 }), fas('rainbow', { speed: 1.6 }), ppl('handsup'))),
      T('Fast chase', ['lights:party'], mix(rig({ look: 'ballyhoo', behaviour: 'ballyhoo' }), orb('comet', { speed: 2 }), fas('chase', { speed: 2 }), ppl('jump'))),
      T('Strobe wall', ['lights:strobe'], mix(rig({ look: 'hit', strobeOn: true, blindersOn: true }), orb('strobe', { speed: 2.4 }), fas('pulse', { speed: 2.4 }), ppl('jump'))),
      T('Laser sheet', ['lights:laserfan'], mix(rig({ look: 'lasershow', lasersOn: true, laserPer: 9, laserSweep: 1.4 }), orb('sparkle'), fas('chase', { speed: 2 }), ppl('jump'))),
      T('Drop hit', ['lights:strobe', 'fx:co2'], mix(rig({ look: 'drop', strobeOn: true, blindersOn: true, master: 1 }), orb('fireworks', { speed: 2 }), fas('rainbow', { speed: 2 }), ppl('jump'))),
      T('Peak time', ['lights:party', 'fx:pyro', 'fx:confetti'], mix(rig({ look: 'drop', blindersOn: true, strobeOn: true, master: 1, haze: 1.8 }), orb('fireworks', { speed: 2.4, brightness: 2 }), fas('rainbow', { speed: 2.4 }), ppl('jump'))),
    ],
  },
  {
    id: 'pop', name: 'Pop', category: 'genre',
    blurb: 'Clean, bright and colourful — camera-friendly throughout',
    pads: [
      T('Clean low', ['lights:soft'], mix(rig({ look: 'ballad', colorA: '#ffd7f0', colorB: '#d0e8ff', master: 0.75 }), orb('solid', { brightness: 0.6 }), fas('solid'), ppl('idle'))),
      T('Bright wash', ['lights:white'], mix(rig({ look: 'anthem', colorA: '#ffffff', colorB: '#ffd7f0' }), orb('solid', { colorA: '#ffffff', brightness: 1.2 }), fas('solid'), ppl('mix'))),
      T('Pastel colour', [], mix(rig({ look: 'anthem', colorA: '#ff9ad8', colorB: '#9ad8ff' }), orb('wave', { colorA: '#ff9ad8', colorB: '#9ad8ff' }), fas('wave'), ppl('mix'))),
      T('Colour change', ['lights:sunset'], mix(rig({ look: 'anthem', colorA: '#ffa020', colorB: '#ff2fb4' }), orb('sections'), fas('stripes'), ppl('cheer'))),
      T('Soft chase', ['lights:sweep'], mix(rig({ look: 'tilt', behaviour: 'fan' }), orb('comet', { speed: 1.1 }), fas('chase'), ppl('cheer'))),
      T('Sparkle', ['crowd:twinkle'], mix(rig({ look: 'anthem' }), orb('twinkle', { speed: 1.4, brightness: 1.5 }), fas('sparkle'), ppl('cheer'))),
      T('Lift', ['lights:party'], mix(rig({ look: 'full' }), orb('rise', { speed: 1.3 }), fas('wave', { speed: 1.3 }), ppl('handsup'))),
      T('Chorus pop', ['lights:party'], mix(rig({ look: 'anthem', master: 1 }), orb('rainwave'), fas('rainbow'), ppl('jump'))),
      T('Full sparkle', ['lights:party', 'fx:confetti'], mix(rig({ look: 'encore', blindersOn: true, master: 1 }), orb('fireworks'), fas('rainbow'), ppl('jump'))),
    ],
  },
  {
    id: 'hiphop', name: 'Hip-hop', category: 'genre',
    blurb: 'Hard colour stabs out of a dark room',
    pads: [
      T('Hard dark', ['lights:dark'], mix(rig({ haze: 1.5 }), orb('off'), fas('off'), ppl('idle'))),
      T('Red wash', ['lights:fire'], mix(rig({ look: 'ballad', colorA: '#ff2020', colorB: '#8a0a1a', master: 0.8 }), orb('solid', { colorA: '#ff2020', brightness: 0.8 }), fas('solid', { colorA: '#8a0a1a' }), ppl('mix'))),
      T('Strobe stab', ['lights:strobe'], mix(rig({ look: 'hit', strobeOn: true }), orb('strobe', { speed: 1.6 }), fas('pulse', { speed: 1.6 }), ppl('jump'))),
      T('Gold wash', ['lights:sunset'], mix(rig({ look: 'anthem', colorA: '#ffc61a', colorB: '#ff7a1a' }), orb('solid', { colorA: '#ffc61a' }), fas('solid', { colorA: '#ff7a1a' }), ppl('handsup'))),
      T('Blinder hit', ['lights:white'], mix(rig({ look: 'hit', blindersOn: true }), orb('solid', { colorA: '#fff2d0', brightness: 1.8 }), fas('pulse'), ppl('jump'))),
      T('Beam punch', ['lights:sweep'], mix(rig({ look: 'beamfan', behaviour: 'crossbeams', haze: 1.7 }), orb('checker', { speed: 1.4 }), fas('chase'), ppl('handsup'))),
      T('Colour slam', [], mix(rig({ look: 'drop', colorA: '#9a4aff', colorB: '#ff2fb4' }), orb('solid', { colorA: '#9a4aff', brightness: 1.8 }), fas('pulse', { speed: 2 }), ppl('jump'))),
      T('Bass flash', ['lights:strobe'], mix(rig({ look: 'drop', strobeOn: true, blindersOn: true, master: 1 }), orb('strobe', { speed: 2.4 }), fas('pulse', { speed: 2.4 }), ppl('jump'))),
      T('All in', ['lights:party', 'fx:co2', 'fx:confetti'], mix(rig({ look: 'drop', blindersOn: true, strobeOn: true, master: 1 }), orb('fireworks'), fas('rainbow'), ppl('jump'))),
    ],
  },
  {
    id: 'ballad', name: 'Ballad', category: 'genre',
    blurb: 'Soft, warm and slow — nothing moves fast',
    pads: [
      T('Single warm', ['lights:white'], mix(rig({ look: 'acoustic', colorA: '#ffd7a0', colorB: '#ffb070', master: 0.5, haze: 1.2 }), orb('off'), fas('off'), ppl('idle'))),
      T('Soft wash', ['lights:soft'], mix(rig({ look: 'ballad', master: 0.65 }), orb('solid', { brightness: 0.4, colorA: '#ffd7a0' }), fas('solid'), ppl('idle'))),
      T('Candle glow', ['lights:soft'], mix(rig({ look: 'ballad', colorA: '#ffb070', colorB: '#ff8a5a', master: 0.6 }), orb('twinkle', { speed: 0.4, brightness: 0.7, colorA: '#ffd7a0' }), fas('sparkle', { speed: 0.4 }), ppl('idle'))),
      T('Deep blue', ['lights:blue'], mix(rig({ look: 'ballad', colorA: '#2f7bff', colorB: '#1e3ccc', master: 0.6 }), orb('solid', { colorA: '#2f7bff', brightness: 0.6 }), fas('solid'), ppl('idle'))),
      T('Slow drift', ['lights:sweep'], mix(rig({ look: 'ballad', behaviour: 'sweep', master: 0.7 }), orb('rainwave', { speed: 0.35 }), fas('wave', { speed: 0.35 }), ppl('idle'))),
      T('Crowd glow', ['crowd:glow'], mix(rig({ look: 'ballad', master: 0.55 }), orb('solid', { colorA: '#ffd7a0', brightness: 1.5 }), fas('off'), ppl('handsup'))),
      T('Swell', ['lights:sunset'], mix(rig({ look: 'anthem', master: 0.9 }), orb('rise', { speed: 0.8 }), fas('pulse', { speed: 0.7 }), ppl('handsup'))),
      T('Warm peak', ['lights:party'], mix(rig({ look: 'full', colorA: '#ffb070', colorB: '#ffc61a', master: 1 }), orb('solid', { colorA: '#ffc61a', brightness: 1.5 }), fas('solid', { colorA: '#ffb070' }), ppl('cheer'))),
      T('Warm full', ['lights:white'], mix(rig({ look: 'encore', colorA: '#ffd7a0', colorB: '#ffffff', master: 1 }), orb('sparkle', { brightness: 1.6 }), fas('sparkle'), ppl('cheer'))),
    ],
  },

  // ----------------------------------------------------------------- moments
  {
    id: 'pyro', name: 'Pyro & confetti', category: 'moments',
    blurb: 'One-shot moments. A clears everything first',
    pads: [
      T('Safe / clear', ['fx:flamesoff'], mix({ showfx: { pyro: false, jets: false, flames: false, fog: false } })),
      T('Front jets', ['fx:co2'], mix(rig({ look: 'anthem' }), ppl('jump'))),
      T('Rear jets', ['fx:co2'], mix(rig({ look: 'anthem', behaviour: 'fan' }), ppl('jump'))),
      T('Flame bar', ['fx:fire'], mix({ showfx: { flames: true, flameMode: 'gold' } }, rig({ look: 'drop' }), ppl('jump'))),
      T('Confetti pop', ['fx:confetti'], mix(rig({ look: 'full' }), orb('sparkle'), ppl('cheer'))),
      T('Confetti storm', ['fx:confetti'], mix({ showfx: { confettiAmt: 1 } }, rig({ look: 'encore' }), orb('fireworks'), ppl('jump'))),
      T('Streamers', ['fx:streamers'], mix(rig({ look: 'encore' }), orb('rainbow'), ppl('cheer'))),
      T('Poppers', ['fx:poppers'], mix(rig({ look: 'hit' }), orb('sparkle'), ppl('jump'))),
      T('Full pyro', ['fx:pyro', 'fx:confetti', 'fx:co2'], mix({ showfx: { pyroPreset: 'finale' } }, rig({ look: 'drop', blindersOn: true, master: 1 }), orb('fireworks'), fas('rainbow'), ppl('jump'))),
    ],
  },
  {
    id: 'walkin', name: 'Walk-in', category: 'moments',
    blurb: 'Doors open through to lights-down',
    pads: [
      T('House full', [], mix(rig({ look: 'blackout' }), orb('off'), fas('ads'), ppl('idle'))),
      T('House dim', [], mix(rig({ look: 'preshow', master: 0.5 }), orb('off'), fas('ads'), ppl('idle'))),
      T('Pre-show wash', ['lights:soft'], mix(rig({ look: 'preshow' }), orb('solid', { brightness: 0.35 }), fas('ads'), ppl('idle'))),
      T('Colour drift', ['lights:sweep'], mix(rig({ look: 'preshow', behaviour: 'sweep', master: 0.6 }), orb('rainwave', { speed: 0.3, brightness: 0.5 }), fas('wave', { speed: 0.4 }), ppl('idle'))),
      T('Logo look', [], mix(rig({ look: 'preshow', master: 0.7 }), orb('sections', { brightness: 0.8 }), fas('ads'), ppl('idle'))),
      T('Announce', ['lights:white'], mix(rig({ look: 'acoustic', master: 0.6 }), orb('off'), fas('solid'), ppl('idle'))),
      T('Lights down', ['lights:dark'], mix(orb('off'), fas('off'), ppl('cheer'))),
      T('Cold open', [], mix(rig({ look: 'blackout', haze: 1.8 }), orb('twinkle', { brightness: 0.3, speed: 0.4 }), fas('off'), ppl('cheer'))),
      T('Go', ['lights:strobe'], mix(rig({ look: 'hit', strobeOn: true, blindersOn: true, master: 1 }), orb('strobe'), fas('pulse'), ppl('jump'))),
    ],
  },
  {
    id: 'encore', name: 'Encore', category: 'moments',
    blurb: 'Off-stage tease, build back, curtain',
    pads: [
      T('Dark tease', ['lights:dark'], mix(rig({ haze: 1.5 }), orb('off'), fas('off'), ppl('cheer'))),
      T('Crowd only', ['crowd:glow'], mix(rig({ look: 'blackout' }), orb('solid', { colorA: '#ffd7a0', brightness: 1.6 }), fas('off'), ppl('handsup'))),
      T('Single beam', ['lights:white'], mix(rig({ look: 'intro', master: 0.5, haze: 1.7 }), orb('twinkle', { brightness: 0.6 }), fas('off'), ppl('cheer'))),
      T('Build back', ['lights:sweep'], mix(rig({ look: 'intro', master: 0.8 }), orb('rise', { speed: 1.3 }), fas('pulse', { speed: 1.3 }), ppl('handsup'))),
      T('Full return', ['lights:party'], mix(rig({ look: 'encore', master: 1 }), orb('rainbow'), fas('rainbow'), ppl('jump'))),
      T('Blinder salute', ['lights:white'], mix(rig({ look: 'encore', blindersOn: true, master: 1 }), orb('solid', { colorA: '#ffffff', brightness: 1.8 }), fas('solid', { colorA: '#ffffff' }), ppl('handsup'))),
      T('Confetti', ['fx:confetti', 'fx:streamers'], mix(rig({ look: 'encore' }), orb('fireworks'), fas('rainbow'), ppl('jump'))),
      T('Anthem', ['lights:party'], mix(rig({ look: 'anthem', master: 1 }), orb('rainwave'), fas('rainbow'), ppl('handsup'))),
      T('Curtain', [], mix(rig({ look: 'preshow' }), orb('solid', { brightness: 0.5 }), fas('ads'), ppl('cheer'))),
    ],
  },

  // ----------------------------------------------------------------- systems
  {
    id: 'ribbon', name: 'Ribbon', category: 'systems',
    blurb: 'The fascia LED ring on its own — pair with any look',
    pads: [
      T('Off', [], fas('off')),
      T('Solid', [], fas('solid', { colorA: '#1e6cff' })),
      T('Two-tone', [], fas('stripes', { colorA: '#ff2f6e', colorB: '#2f7bff' })),
      T('Scroll slow', [], fas('wave', { speed: 0.5 })),
      T('Scroll fast', [], fas('wave', { speed: 2 })),
      T('Chase', [], fas('chase', { speed: 1.4 })),
      T('Sparkle', [], fas('sparkle', { speed: 1.2 })),
      T('Pulse', [], fas('pulse', { speed: 2 })),
      T('Rainbow run', [], fas('rainbow', { speed: 1.6 })),
    ],
  },
  {
    id: 'bstage', name: 'B-stage', category: 'systems',
    blurb: 'Thrust, catwalk and the b-stage ring',
    pads: [
      T('Off', [], { bstage: { ringMode: 'off', catMode: 'off', screenMode: 'content', brightness: 0.8 } }),
      T('Ring low', [], { bstage: { ringMode: 'solid', catMode: 'off', brightness: 0.5 } }),
      T('Ring colour', [], { bstage: { ringMode: 'solid', ringColor: '#ff2f6e', catMode: 'off', brightness: 1 } }),
      T('Screen on', [], { bstage: { screenMode: 'content', ringMode: 'solid', brightness: 1 } }),
      T('Screen pulse', [], { bstage: { screenMode: 'pulse', ringMode: 'pulse', speed: 1.4, brightness: 1.2 } }),
      T('Catwalk wash', [], { bstage: { catMode: 'solid', catColor: '#ffb070', ringMode: 'solid' } }),
      T('Catwalk chase', [], { bstage: { catMode: 'chase', ringMode: 'chase', speed: 1.6 } }),
      T('Ring strobe', [], { bstage: { ringMode: 'strobe', catMode: 'strobe', speed: 2 } }),
      T('B-stage full', [], { bstage: { ringMode: 'rainbow', catMode: 'rainbow', screenMode: 'pulse', speed: 1.6, brightness: 1.4 } }),
    ],
  },
  {
    id: 'screens', name: 'Screens', category: 'systems',
    blurb: 'Video walls, side screens and floor projection',
    pads: [
      T('Dark', ['video:dark'], {}),
      T('Main wall', ['video:wall'], {}),
      T('Sides on', ['video:sides'], {}),
      T('Surround', ['video:surround'], {}),
      T('Aurora', ['video:aurora'], {}),
      T('Waves', ['video:waves'], {}),
      T('Starfield', ['video:stars'], {}),
      T('Floor proj', [], { showfx: { projFloor: true } }),
      T('Play content', ['video:play'], {}),
    ],
  },
  {
    id: 'venue', name: 'Venue', category: 'systems',
    blurb: 'House lights, seat colour, banners and dressing',
    pads: [
      T('Show dark', ['lights:dark', 'venue:black'], mix(orb('off'), fas('off'))),
      T('Charcoal', ['venue:charcoal'], {}),
      T('Crimson', ['venue:crimson'], {}),
      T('Royal', ['venue:royal'], {}),
      T('Purple', ['venue:purple'], {}),
      T('Green', ['venue:green'], {}),
      T('Banners', ['venue:banners'], {}),
      T('Suites on', ['venue:suiteson'], {}),
      T('House full', [], mix(rig({ look: 'blackout' }), fas('ads'))),
    ],
  },
  {
    id: 'sound', name: 'Sound', category: 'systems',
    blurb: 'PA voicing and crowd audio',
    pads: [
      T('Flat', ['sound:flat'], {}),
      T('Clean', ['sound:clean'], {}),
      T('Arena', ['sound:arena'], {}),
      T('Stadium', ['sound:stadium'], {}),
      T('Club', ['sound:club'], {}),
      T('Warm', ['sound:warm'], {}),
      T('Bass', ['sound:bass'], {}),
      T('Crowd roar', ['sound:roar'], ppl('cheer')),
      T('Clap along', ['sound:clap'], ppl('handsup')),
    ],
  },
];

// The nine banks the belt is seeded with on a first run, in order.
// The banks the belt is seeded with on a first run. SEVEN, not nine: filling
// all MAX_LAYERS slots left "+ ADD" permanently disabled, so there was no way
// to grow the belt from the library without replacing something first.
// ---------------------------------------------------------------------- FX only
// These write showfx and NOTHING else, so firing one leaves the lighting, the
// orbs and the crowd exactly as they were — drop a confetti hit on top of a
// chorus without touching the chorus.
LAYER_PRESETS.push(
  {
    id: 'confetti', name: 'Confetti', category: 'fx',
    blurb: 'Paper and streamers, a puff to a whiteout',
    pads: [
      T('Clear', [], { showfx: { confettiAmt: 0.7 } }),
      T('Puff', ['fx:confetti'], { showfx: { confettiAmt: 0.25 } }),
      T('Pop', ['fx:confetti'], { showfx: { confettiAmt: 0.5 } }),
      T('Burst', ['fx:confetti'], { showfx: { confettiAmt: 0.7 } }),
      T('Big burst', ['fx:confetti'], { showfx: { confettiAmt: 0.9 } }),
      T('Whiteout', ['fx:confetti'], { showfx: { confettiAmt: 1 } }),
      T('Streamers', ['fx:streamers'], {}),
      T('Poppers', ['fx:poppers'], {}),
      T('Everything', ['fx:confetti', 'fx:streamers', 'fx:poppers'], { showfx: { confettiAmt: 1 } }),
    ],
  },
  {
    id: 'pyroonly', name: 'Pyro & flames', category: 'fx',
    blurb: 'Jets, flames and shell presets — nothing but the pyro',
    pads: [
      T('Safe / clear', ['fx:flamesoff'], { showfx: { pyro: false, jets: false, flames: false } }),
      T('CO2 jets', ['fx:co2'], {}),
      T('Flames red', ['fx:fire'], { showfx: { flames: true, flameMode: 'red' } }),
      T('Flames gold', ['fx:fire'], { showfx: { flames: true, flameMode: 'gold' } }),
      T('Flames blue', ['fx:fire'], { showfx: { flames: true, flameMode: 'blue' } }),
      T('Pyro classic', ['fx:pyro'], { showfx: { pyroPreset: 'classic' } }),
      T('Pyro willows', ['fx:pyro'], { showfx: { pyroPreset: 'willows' } }),
      T('Pyro crackle', ['fx:pyro'], { showfx: { pyroPreset: 'crackle' } }),
      T('Finale', ['fx:pyro', 'fx:co2'], { showfx: { pyroPreset: 'finale' } }),
    ],
  },
  {
    id: 'fireworks', name: 'Fireworks', category: 'fx',
    blurb: 'The outdoor shells over the roof, single to finale',
    pads: [
      T('Off', [], { showfx: { pyro: false } }),
      T('Single', ['fx:fireworks'], {}),
      T('Volley', ['fx:fwshow'], {}),
      T('Show', ['fx:fwshow'], {}),
      T('Rings', ['fx:fireworks'], { showfx: { pyroPreset: 'rings' } }),
      T('Willows', ['fx:fireworks'], { showfx: { pyroPreset: 'willows' } }),
      T('Gold storm', ['fx:fireworks'], { showfx: { pyroPreset: 'goldstorm' } }),
      T('Rainbow', ['fx:fireworks'], { showfx: { pyroPreset: 'rainbow' } }),
      T('Finale', ['fx:fwfinale'], { showfx: { pyroPreset: 'finale' } }),
    ],
  },
  {
    id: 'atmos', name: 'Smoke & haze', category: 'fx',
    blurb: 'Fog, jets, risers and the low-lying stuff',
    pads: [
      T('Clear', [], { showfx: { fog: false, jets: false, sheet: false } }),
      T('Light haze', [], { showfx: { fog: true } }),
      T('Fog bank', ['fx:fog'], {}),
      T('Jets low', ['fx:co2'], {}),
      T('Jets high', ['fx:co2'], { showfx: { jets: true } }),
      T('Risers up', ['fx:risersup'], {}),
      T('Risers down', ['fx:risersdown'], {}),
      T('Sheet fan', [], { showfx: { sheet: true, sheetMode: 'fan' } }),
      T('Everything', ['fx:fog', 'fx:co2'], { showfx: { fog: true, jets: true, sheet: true } }),
    ],
  },
);

export const SEED_IDS = ['default', 'verse', 'chorus', 'strobe', 'full', 'party', 'crowd'];

export const presetById = (id) => LAYER_PRESETS.find((p) => p.id === id) || null;

// deep-merge a sparse override onto a captured state
function merge(base, over) {
  for (const k of Object.keys(over)) {
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      merge(base[k], v);
    } else {
      base[k] = Array.isArray(v) ? v.slice() : v;
    }
  }
  return base;
}

// Turn a preset's nine recipes into nine real pad states.
//
// Recipes drive the console, which drives the engines, so the live show moves
// while this runs — it is saved first and put back afterwards. All synchronous:
// nothing repaints in between, so the flicker is never seen.
// Which subsystems does a state differ from the baseline in? Compared as JSON
// because every captured value is already JSON-safe (colours are hex strings).
function subsystemsChanged(base, after) {
  const out = [];
  for (const k of SUBSYS_KEYS) {
    if (SUBSYS[k].some((g) => JSON.stringify(base[g]) !== JSON.stringify(after[g]))) out.push(k);
  }
  return out;
}

export function materialise(preset, { runPreset, capture, apply }) {
  // Building a bank plays each look once, out of sight, to record what it
  // changes. One-shot effects (a crowd roar, fireworks, confetti) must not
  // really go off while that happens: main.js skips them while this is set.
  window.__presetQuiet = (window.__presetQuiet || 0) + 1;
  try { return materialiseNow(preset, { runPreset, capture, apply }); }
  finally { window.__presetQuiet -= 1; }
}
function materialiseNow(preset, { runPreset, capture, apply }) {
  const saved = capture();
  const out = preset.pads.map((t) => {
    if (!t) return null;
    // Same baseline for every trigger in the bank, so `writes` below measures
    // what THIS trigger changes rather than what the previous one left behind.
    apply(saved);
    const base = capture();
    for (const key of t.r) runPreset(key);
    // The deck stores { name, state } and fireAt() reaches for p.state — a flat
    // state with the name merged in paints correctly in every list and then
    // throws the moment the pad is actually fired.
    const state = merge(capture(), t.s);
    // `writes` is DERIVED, never hand-authored: the diff catches whatever the
    // macros touched, and the override's own top-level keys are unioned in so a
    // value that happens to equal the baseline still counts as written. Banks
    // therefore declare their scope correctly without anyone maintaining a list.
    // (The crowd mode itself is decided live in pads.js apply(), so that
    // toggling the orbs off drops the crowd from hands-up back to idle.)
    const explicit = SUBSYS_KEYS.filter((k) => SUBSYS[k].some((g) => g in t.s));
    const writes = [...new Set([...subsystemsChanged(base, state), ...explicit])];
    return { name: t.n.toUpperCase(), state, writes, from: preset.id };
  });
  apply(saved);
  return out;
}
