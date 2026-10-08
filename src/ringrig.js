// The in-the-round rig for the giant sphere: generated as a RIG PLAN so it
// rides the same path a hand-drawn rig does (placed exactly, never shifted or
// stretched onto an end-stage deck). Three circle trusses and a floor package,
// ~620 fixtures — a stadium in-the-round package, not an arena one:
//
//   inner ring  (r 12, y 28)  — over the globe: 48 heads shooting DOWN onto it,
//                               24 beams shooting UP into the sky, 16 lasers out
//   mid ring    (r 24, y 25)  — over the deck edge: 48 movers, strobes,
//                               blinders, 24 lasers, 48 pixel bars, all OUTWARD
//   outer ring  (r 36, y 22)  — around the deck: 96 movers, 48 strobes, 24
//                               blinders, 32 lasers, 72 pixel bars, all OUTWARD
//   deck edge   (r 25, deck)  — floor package: 48 beams raking up and out,
//                               strobes, UV, cannons, pyro, flames
//
// Every entry carries `yaw` (the direction its face points, world radians
// measured x->z) so cells, cannons and speakers turn radially, and `grp` so
// the console's fixture groups mean something: lx1 = outer + mid rings,
// lx2 = inner down, lx3 = inner up, floor = deck edge. Trusses carry their
// steel `section` (m): rig.js sizes the tubes, the polygon and the motors
// from it, so the big rings hang on 1 m truss and a motor every 7 m.
export function makeRingRigPlan(S, deckH = 1.5) {
  const trusses = [], fixtures = [], fx = [], speakers = [];
  const ring = (r, y, section) => trusses.push({ shape: 'ring', r, x: 0, z: 0, y, len: 4, rot: 0, section });
  const IN_R = 12, IN_Y = 28, MID_R = 24, MID_Y = 25, OUT_R = 36, OUT_Y = 22;
  const DECK_R = S.deckR - 1.0, DECK_Y = deckH + 0.55;
  const domeTop = deckH + S.cap;
  ring(IN_R, IN_Y, 0.8);
  ring(MID_R, MID_Y, 0.9);
  ring(OUT_R, OUT_Y, 1.0);
  // a fixture at azimuth `a` on radius `r`, facing outward (or inward when `inward`)
  const at = (r, y, a, type, grp, aimY, inward = false, outDist = 30) => {
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const k = inward ? -0.5 : 1;
    fixtures.push({
      type, x: +x.toFixed(3), y, z: +z.toFixed(3), grp,
      yaw: +(Math.PI / 2 - (inward ? a + Math.PI : a)).toFixed(4),
      aim: [+(x + Math.cos(a) * outDist * k).toFixed(2), aimY, +(z + Math.sin(a) * outDist * k).toFixed(2)],
    });
  };
  const around = (n, off, fn) => { for (let i = 0; i < n; i++) fn((i / n) * Math.PI * 2 + off, i); };
  const TAU = Math.PI * 2;
  // --- inner ring: 48 down onto the globe, 24 up, 16 lasers ------------------------
  around(48, 0, (a, i) => at(IN_R, IN_Y - 0.35, a, i % 3 === 0 ? 'spot' : i % 3 === 1 ? 'wash' : 'beam', 'lx2', domeTop, true, 6));
  around(24, TAU / 96, (a) => at(IN_R, IN_Y + 0.7, a, 'beam', 'lx3', IN_Y + 40, false, 8));     // aims above: an "up" fixture
  around(16, TAU / 32, (a) => at(IN_R + 0.5, IN_Y - 0.7, a, 'laser', 'lx2', 8, false, 60));
  // --- mid ring: the second outward tier, tighter to the deck --------------------------
  around(48, TAU / 96, (a, i) => at(MID_R, MID_Y - 0.35, a, i % 4 === 0 ? 'spot' : i % 4 === 2 ? 'wash' : 'beam', 'lx1', 2, false, 44));
  around(24, 0, (a) => at(MID_R + 0.3, MID_Y + 0.35, a, 'strobe', 'lx1', 0));
  around(16, TAU / 32, (a) => at(MID_R + 0.3, MID_Y + 0.85, a, 'blinder', 'lx1', 0));
  around(24, TAU / 48, (a) => at(MID_R + 0.4, MID_Y - 0.85, a, 'laser', 'lx1', 14, false, 80));
  around(48, TAU / 96, (a) => at(MID_R + 0.2, MID_Y + 0.05, a, 'strip', 'lx1', 0));
  // --- outer ring: movers, cells, lasers, all outward -------------------------------
  around(96, 0, (a, i) => at(OUT_R, OUT_Y - 0.35, a, i % 4 === 0 ? 'spot' : i % 4 === 2 ? 'wash' : 'beam', 'lx1', 0, false, 40));
  around(48, TAU / 96, (a) => at(OUT_R + 0.3, OUT_Y + 0.35, a, 'strobe', 'lx1', 0));
  around(24, TAU / 48, (a) => at(OUT_R + 0.3, OUT_Y + 0.95, a, 'blinder', 'lx1', 0));
  around(32, TAU / 64, (a) => at(OUT_R + 0.45, OUT_Y - 0.9, a, 'laser', 'lx1', 12, false, 80));
  around(72, TAU / 144, (a) => at(OUT_R + 0.2, OUT_Y + 0.05, a, 'strip', 'lx1', 0));
  // --- deck edge: the floor package raking up and out, UV under the lip -------------
  around(48, TAU / 96, (a) => at(DECK_R, DECK_Y, a, 'beam', 'floor', DECK_Y + 30, false, 14));   // aims above: raked up and out
  around(24, TAU / 24, (a) => at(DECK_R, DECK_Y + 0.2, a, 'strobe', 'floor', 0));
  around(24, 0, (a) => at(DECK_R + 0.6, deckH - 0.3, a, 'uv', 'floor', 0));
  // --- effects round the deck: cannons, pyro, flames, poppers, streamers ------------
  around(16, TAU / 32, (a) => fx.push({ type: 'confetti', x: +(Math.cos(a) * (DECK_R - 0.5)).toFixed(2), z: +(Math.sin(a) * (DECK_R - 0.5)).toFixed(2), yaw: +a.toFixed(4) }));
  around(24, 0, (a) => fx.push({ type: 'pyro', x: +(Math.cos(a) * (DECK_R - 1.6)).toFixed(2), z: +(Math.sin(a) * (DECK_R - 1.6)).toFixed(2) }));
  around(16, TAU / 32, (a) => fx.push({ type: 'flame', x: +(Math.cos(a) * (DECK_R - 2.4)).toFixed(2), z: +(Math.sin(a) * (DECK_R - 2.4)).toFixed(2) }));
  around(12, TAU / 24, (a) => {
    fx.push({ type: 'popper', x: +(Math.cos(a + 0.12) * (DECK_R - 3)).toFixed(2), z: +(Math.sin(a + 0.12) * (DECK_R - 3)).toFixed(2) });
    fx.push({ type: 'streamer', x: +(Math.cos(a - 0.12) * (DECK_R - 3)).toFixed(2), z: +(Math.sin(a - 0.12) * (DECK_R - 3)).toFixed(2) });
  });
  // --- PA: twelve hangs off the outer ring, each facing its slice of the crowd -------
  around(12, TAU / 24, (a) => speakers.push({ type: 'main', x: +(Math.cos(a) * (OUT_R + 1.4)).toFixed(2), z: +(Math.sin(a) * (OUT_R + 1.4)).toFixed(2), y: OUT_Y - 1.0, yaw: +(-a).toFixed(4) }));
  return {
    name: 'Ring Rig · Giant Sphere', version: 3, ring: true,
    roofY: 49.4,                 // the spider grid the chain motors hang from (stage.js builds it)
    domeTop,                     // where the inner ring's downlights land
    trusses, fixtures, fx, speakers, barricades: [], stages: [], screens: [],
    venue: { position: 'middle', middleShape: 'sphere' },
  };
}
