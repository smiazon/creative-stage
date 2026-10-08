// The show designer's engine; showdesigner.js is its window. It knows which
// section every wristband sits in, lays each zone's look over that zone's
// seats, and paints the colours whenever OrbFX runs in 'design' mode. It can
// also play any set of zones on a small map of the arena, which is how the
// demo cards show what they will look like.
//
// A zone is one look on a set of sections:
//   { id, sections: ['b0-5', 'b0-6', 'floor'...], look: 'chevrons',
//     a: '#ff2f6e', b: '#000000', speed: 1, size: 1, dir: 1,
//     span: 'across' | 'each', text: { str, font, size }, phase: seconds }
// Section keys are 'b<tier>-<span>' for the bowl and 'floor' for every seat
// on the floor. 'across' lays one picture over all of a zone's sections, so
// it runs round a ring unbroken; 'each' gives every section its own copy.
// Text always runs across: a section is too narrow to read a word in. When
// two zones claim a section, the later one plays there. A wash zone (look
// 'wash') gives every band the same effect at once, the way the PixMob node
// drives a crowd: { fx: 'strobe', cmode: 'a' | 'rainbow' | 'cycle', prob }.
// An IR zone (look 'ir') hands its bands to the IR moving heads (irheads.js),
// which light only the bands inside their beams:
// { motion: 'sweep', fx, gobo: 'circle', size, speed, prob, cmode, heads }.
// A grouping zone (look 'group', span 'each') treats each of its sections as
// a zone of its own (the floor as one), cuts every one into groups, and
// lights them in turn (showlooks.js):
// { groups: 3, gsplit: 'across', order: 'around', inner: 'together', dir,
//   step, tail, base, fxSpeed, cmode, fx: [{ fx, a }...], floor: { fx,
//   cols: [colour...], mode }, origin: [x, z] of the stage }. The floor is
//   cut into as many parts as it has colours.
import * as THREE from 'three';
import { SPEC } from './venue.js';
import { sectionAt, baseUAt, sectionLabel, spanBaseU, perimeterAt, bowlOffsetAt, baseToRingMapper, BOWL_A, BOWL_B, BOWL_R } from './bowl.js';
import { LOOK, WASH, HK, hueRGB, washRGB, makeTextStrip, textAt, hash, groupFx, groupFxRGB, stepLevel } from './showlooks.js';

export const FLOOR = 'floor';
const SLANT = 2;   // a tier's face runs back about as far again as it climbs: its face is about twice its height
const INV_TAU = 1 / (Math.PI * 2);
const TAU = Math.PI * 2;
const frac = (v) => v - Math.floor(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// The festival field (venue.js) has no stands: its bowl is out of sight and
// its seats take no part in the show, and the crowd on the grass is cut into
// the "tiers": bands from the stage back, each split into pens across the
// field. Its pictures are laid across the crowd as the stage sees it.
const HIDE_BOWL = !!SPEC.bowl.hidden, BANDS = !!SPEC.crowdBands, FACING = SPEC.floorFacing === 'stage';
const BAND_AT = [0, 0.16, 0.4, 0.68];   // where each band starts, as a share of the crowd's depth

export function initShowEngine({ orbFX }) {
  // --- the sections ------------------------------------------------------------
  const tiers = SPEC.bowl.tiers.map((t, i) => ({ tier: i, name: BANDS ? t.name : `${t.name}s`, n: t.sections || SPEC.bowl.aisles, keys: [] }));
  const sections = new Map();
  for (const T of tiers) {
    for (let j = 0; j < T.n; j++) {
      const key = `b${T.tier}-${j}`;
      const [u0, u1] = spanBaseU(T.n, j);
      sections.set(key, {
        key, tier: T.tier, span: j, u0, u1, count: 0, cx: 0, cz: 0,
        label: BANDS ? `${T.name} ${j + 1}` : String(sectionLabel(T.n, j, (T.tier + 1) * 100 + 1)),
      });
      T.keys.push(key);
    }
  }
  sections.set(FLOOR, { key: FLOOR, tier: -1, span: 0, label: 'Floor', count: 0, cx: 0, cz: 0 });
  const keys = [...sections.keys()];
  const idOf = new Map(keys.map((k, i) => [k, i]));
  const FLOOR_ID = idOf.get(FLOOR);
  const SEAM = baseUAt(-1e4, 0);   // behind a far stage: where a whole ring's picture meets itself

  // --- every seat's section, per orb group (the concert floor gets rebuilt) -----
  const index = [];
  let indexStamp = 0;
  function indexGroup(gi) {
    const g = orbFX.groups[gi];
    const n = g.n, pos = g.pos;
    const sec = new Int16Array(n), u = new Float32Array(n), off = new Float32Array(n);
    // the festival's bands run from the front of the crowd to the back of the field
    const x0 = SPEC.downstageX + 2, depth = Math.max(1, BOWL_A - x0);
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], z = pos[i * 3 + 2];
      if (gi === 0) {
        if (HIDE_BOWL) { sec[i] = -1; continue; }
        const s = sectionAt(x, z);
        sec[i] = s ? (idOf.get(`b${s.tier}-${s.span}`) ?? -1) : -1;
        u[i] = baseUAt(x, z);
        off[i] = bowlOffsetAt(x, z);
      } else if (BANDS) {
        const f = (x - x0) / depth;
        let t = 0;
        for (let k = BAND_AT.length - 1; k > 0; k--) if (f >= BAND_AT[k]) { t = k; break; }
        const nn = tiers[t].n;
        const span = Math.max(0, Math.min(nn - 1, Math.floor(((z + BOWL_B) / (2 * BOWL_B)) * nn)));
        sec[i] = idOf.get(`b${t}-${span}`) ?? FLOOR_ID;
      } else {
        sec[i] = FLOOR_ID;   // courtside, the basketball floor and the concert floor
      }
    }
    // the floor's seats are laid out flat, as seen from above, whatever section they are in
    index[gi] = { pos, n, sec, u, off, phase: g.phase, planar: gi > 0 };
  }
  // how many seats each section has, and its middle
  function measure() {
    for (const s of sections.values()) { s.count = 0; s.cx = 0; s.cz = 0; }
    orbFX.groups.forEach((g, gi) => {
      const ix = index[gi];
      for (let i = 0; i < ix.n; i++) {
        const id = ix.sec[i];
        if (id < 0) continue;
        const s = sections.get(keys[id]);
        s.count++;
        s.cx += ix.pos[i * 3];
        s.cz += ix.pos[i * 3 + 2];
      }
    });
    for (const s of sections.values()) if (s.count) { s.cx /= s.count; s.cz /= s.count; }
  }
  function ensureIndex() {
    let changed = false;
    orbFX.groups.forEach((g, gi) => {
      const ix = index[gi];
      if (!ix || ix.pos !== g.pos || ix.n !== g.n) { indexGroup(gi); changed = true; }
    });
    if (changed) { measure(); indexStamp++; }
    return changed;
  }

  // --- a grouping: its zones (the sections and the floor) and their groups ------------
  const imod = (i, n) => ((i % n) + n) % n;
  // the colours "By tier" gives: the floor, then the tiers from the front
  const TIER_COLS = ['#ffffff', '#ff1818', '#ff7800', '#ffff28', '#00ff50', '#1e5aff'];
  // Everything a grouping needs per zone, worked out once per build: for each
  // section with seats in it, its place in every order (round the room, from
  // the stage end, ring by ring...), and its colours for the colour modes.
  function groupSetup(z, zi, zoneOf) {
    const T = tiers.length;
    const K = BANDS ? Math.max(2, tiers[0]?.n || 5) : clamp(tiers[0]?.n || 24, 8, 48);   // places round the room
    const K2 = Math.ceil(K / 2), B = 8;
    const [ox, oz] = Array.isArray(z.origin) ? z.origin : [SPEC.downstageX ?? -BOWL_A, 0];
    const present = [];
    for (let id = 0; id < keys.length; id++) if (zoneOf[id] === zi && sections.get(keys[id]).count) present.push(id);
    const bowlIds = present.filter((id) => id !== FLOOR_ID);
    let D = 1;
    for (const id of bowlIds) { const sc = sections.get(keys[id]); D = Math.max(D, Math.hypot(sc.cx - ox, sc.cz - oz)); }
    // the snake: ring by ring from the front, round each ring
    const snake = new Map([...bowlIds].sort((p, q) => {
      const a = sections.get(keys[p]), b = sections.get(keys[q]);
      return a.tier - b.tier || a.span - b.span;
    }).map((id, k) => [id, k]));
    const tierLin = TIER_COLS.map(lin), recs = new Array(keys.length).fill(null);
    for (const id of present) {
      if (id === FLOOR_ID) { recs[id] = { t: -1, pos: 0, side: 0, band: 0, snake: 0, par: 0, rgb: tierLin[0], tint: tierLin[0] }; continue; }
      const sc = sections.get(keys[id]);
      // round the room from the far end (a festival's pens: across the field)
      const a = BANDS ? (sc.span + 0.5) / Math.max(1, tiers[sc.tier]?.n || 1) : frac(Math.atan2(sc.cz, sc.cx) / TAU);
      // 0 at the stage end, 1 at the far end, the same both sides
      const side = BANDS ? Math.abs(sc.cz) / Math.max(1, BOWL_B) : Math.abs(Math.atan2(sc.cz, -sc.cx)) / Math.PI;
      const rgb = [0, 0, 0];
      hueRGB(a, rgb);
      recs[id] = {
        t: sc.tier, pos: Math.floor(frac(a + 0.5 / K) * K) % K, side: Math.min(K2 - 1, Math.floor(side * K2)),
        band: Math.min(B - 1, Math.floor((Math.hypot(sc.cx - ox, sc.cz - oz) / D) * B)),
        snake: snake.get(id) ?? 0, par: (sc.span + sc.tier) & 1, rgb, tint: tierLin[Math.min(tierLin.length - 1, sc.tier + 1)],
      };
    }
    const G = clamp(Math.round(z.groups || 3), 1, 4), Sn = Math.max(1, snake.size);
    const fx = [...Array(G)].map((_, g) => { const f = (z.fx || [])[g] || (z.fx || [])[0] || {}; return { e: groupFx(f.fx || 'solid'), a: lin(f.a || '#ffffff') }; });
    const fl = z.floor || {};
    const fcols = (Array.isArray(fl.cols) && fl.cols.length ? fl.cols : [fl.a || '#ffffff']).slice(0, 4).map(lin);
    return {
      G, K, K2, B, T, Sn, recs, present, gsplit: z.gsplit || 'across',
      order: z.order || 'around', inner: z.inner || 'together', dir: z.dir < 0 ? -1 : 1,
      step: clamp(z.step ?? 0.5, 0.04, 8), tail: clamp(z.tail ?? 0, 0, 6), base: clamp(z.base ?? 0, 0, 1),
      fxSpeed: clamp(z.fxSpeed ?? 1, 0.1, 4), cmode: z.cmode || 'group',
      fx, floor: { e: groupFx(fl.fx || 'pulse'), cols: fcols, mode: fl.mode || 'always' }, GF: fcols.length,
      zl: new Float32Array(keys.length), gl: new Float32Array(G), glr: new Float32Array(keys.length * G), fgl: new Float32Array(fcols.length),
    };
  }
  // whether a zone is lit at step i of the grouping's order
  function zoneLit(Q, R, i, id) {
    const rev = Q.dir < 0, { K, K2, B, T, Sn } = Q;
    switch (Q.order) {
      case 'around': { const j = imod(i, K); return R.pos === (rev ? K - 1 - j : j); }
      case 'pingpong': { const P = 2 * K - 2, j = imod(i, P), q = j < K ? j : P - j; return R.pos === (rev ? K - 1 - q : q); }
      case 'sides': { const j = imod(i, K2); return R.side === (rev ? K2 - 1 - j : j); }
      case 'climb': { const j = imod(i, T + 1); return R.t + 1 === (rev ? T - j : j); }
      case 'snake': { const j = imod(i, Sn); return R.snake === (rev ? Sn - 1 - j : j); }
      case 'stage': { const j = imod(i, B); return R.band === (rev ? B - 1 - j : j); }
      case 'build': return (rev ? K - 1 - R.pos : R.pos) <= imod(i, K + 2);
      case 'random': return hash(id * 0.731 + 0.3, i) < 0.24;
      case 'alternate': return R.par === imod(i, 2);
      default: return true;
    }
  }
  // which of a zone's G groups is lit at inner step i
  const innerPick = (i, id, G) => Math.floor(hash(id * 1.37 + 0.5, i * 0.173 + 2.9) * G);
  function innerLit(Q, i, g, G) {
    if (Q.inner === 'chase') { const j = imod(i, G); return g === (Q.dir < 0 ? G - 1 - j : j); }
    if (Q.inner === 'alternate') return (g & 1) === imod(i, 2);
    return true;
  }
  // every zone's level and every group's at this moment of the clock, once
  // per update: the bands only look them up. Inside a chase the groups run
  // through all their turns while their zone has its step.
  function groupLevels(Q, clock) {
    const s = clock / Q.step;
    for (const id of Q.present) {
      const R = Q.recs[id];
      if (id === FLOOR_ID && Q.floor.mode !== 'chase') { Q.zl[id] = Q.floor.mode === 'off' ? 0 : 1; continue; }
      Q.zl[id] = Q.order === 'all' ? 1 : stepLevel((i) => zoneLit(Q, R, i, id), s, Q.tail);
    }
    const G = Q.G, gs = clock / (Q.order === 'all' ? Q.step : Q.step / G);
    if (Q.inner === 'random' && G > 1) {
      for (const id of Q.present) for (let g = 0; g < G; g++) Q.glr[id * G + g] = stepLevel((i) => innerPick(i, id, G) === g, gs, Q.tail);
    } else {
      for (let g = 0; g < G; g++) Q.gl[g] = Q.inner === 'together' || G < 2 ? 1 : stepLevel((i) => innerLit(Q, i, g, G), gs, Q.tail);
    }
    // the floor's parts, one per colour, take their turns the same way
    const F = Q.GF, fs = clock / (Q.order === 'all' ? Q.step : Q.step / F);
    for (let g = 0; g < F; g++) {
      Q.fgl[g] = Q.inner === 'together' || F < 2 ? 1
        : Q.inner === 'random' ? stepLevel((i) => innerPick(i, FLOOR_ID, F) === g, fs, Q.tail)
          : stepLevel((i) => innerLit(Q, i, g, F), fs, Q.tail);
    }
  }

  // --- zones -> each seat's place in its zone's picture ---------------------------
  const lin = (hex) => { const c = new THREE.Color(hex || '#000000'); return [c.r, c.g, c.b]; };
  function build(zones, clocks) {
    const zoneOf = new Int16Array(keys.length).fill(-1);
    zones.forEach((z, zi) => {
      for (const k of z.sections) { const id = idOf.get(k); if (id !== undefined) zoneOf[id] = zi; }
    });
    const each = zones.map((z) => z.span === 'each' && z.look !== 'text');
    // pass 1: how far each zone (or, for 'each', each section) reaches
    const blank = () => ({ yMin: Infinity, yMax: -Infinity, off: 0, n: 0 });
    const st = zones.map(() => ({
      ...blank(), hist: new Uint8Array(360), fx0: Infinity, fx1: -Infinity, fz0: Infinity, fz1: -Infinity,
      ax0: Infinity, ax1: -Infinity, az0: Infinity, az1: -Infinity,   // every seat's, for a grouping's split
    }));
    const sst = new Map();
    const isGroup = zones.map((z) => !!LOOK[z.look]?.group);
    const pb = new Map();   // a grouping's planar sections (the floor, a festival's pens): their plan bounds
    index.forEach((ix) => {
      for (let i = 0; i < ix.n; i++) {
        const id = ix.sec[i];
        if (id < 0) continue;
        const zi = zoneOf[id];
        if (zi < 0) continue;
        const s = st[zi];
        {
          const x = ix.pos[i * 3], z = ix.pos[i * 3 + 2];
          if (x < s.ax0) s.ax0 = x;
          if (x > s.ax1) s.ax1 = x;
          if (z < s.az0) s.az0 = z;
          if (z > s.az1) s.az1 = z;
        }
        if (id === FLOOR_ID || ix.planar) {
          const x = ix.pos[i * 3], z = ix.pos[i * 3 + 2];
          if (isGroup[zi]) {
            const q = pb.get(id) || pb.set(id, { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }).get(id);
            if (x < q.x0) q.x0 = x;
            if (x > q.x1) q.x1 = x;
            if (z < q.z0) q.z0 = z;
            if (z > q.z1) q.z1 = z;
          }
          if (x < s.fx0) s.fx0 = x;
          if (x > s.fx1) s.fx1 = x;
          if (z < s.fz0) s.fz0 = z;
          if (z > s.fz1) s.fz1 = z;
          continue;
        }
        const y = ix.pos[i * 3 + 1];
        const into = each[zi] ? (sst.get(id) || sst.set(id, blank()).get(id)) : s;
        if (y < into.yMin) into.yMin = y;
        if (y > into.yMax) into.yMax = y;
        into.off += ix.off[i];
        into.n++;
        s.hist[Math.min(359, (ix.u[i] * 360) | 0)] = 1;
      }
    });
    // per zone: where its picture starts round the ring, how long and tall it
    // is, and whether it closes into a loop. Distance along the ring is
    // measured on the zone's own middle ring, not on the bowl's inner edge:
    // the corners of a ring further out are longer than the edge's (the
    // straights are not), so measured on the edge, a picture stretched as it
    // went round a corner and a message swelled into a smear there. One ring
    // for the whole zone keeps a letter's upright strokes upright.
    const shape = (r) => {
      const off = r.n ? r.off / r.n : 0;
      const L = perimeterAt(BOWL_A, BOWL_B, BOWL_R, off);
      const H = Math.max(1, (r.yMax - r.yMin) * SLANT);
      return { L, H, yMin: r.yMin, span: Math.max(1e-3, r.yMax - r.yMin), ring: baseToRingMapper(off) };
    };
    const info = zones.map((z, zi) => {
      const s = st[zi];
      const out = { ...shape(s), u0: SEAM, r0: 0, wrap: 0, len: 1, fx0: s.fx0, fz0: s.fz0, fH: Math.max(1, s.fz1 - s.fz0) };
      // the biggest stretch of ring the zone leaves dark: the picture starts
      // just after it. None at all: a whole ring, which wraps at the seam.
      let best = 0, bestEnd = -1, run = 0;
      for (let k = 0; k < 720; k++) {
        if (s.hist[k % 360]) { run = 0; continue; }
        if (++run > best && run <= 360) { best = run; bestEnd = k % 360; }
      }
      if (best === 0) {
        out.wrap = out.L / out.H;
        out.len = out.wrap;
      } else {
        out.u0 = ((bestEnd + 1) % 360) / 360;
        const gap = ((bestEnd - best + 1 + 360) % 360) / 360;   // where the dark stretch begins
        out.len = frac(out.ring(gap) - out.ring(out.u0)) * (out.L / out.H);
      }
      out.r0 = out.ring(out.u0);
      // a zone that is all floor and faces the stage: across the crowd, in crowd depths
      if (FACING && s.n === 0 && isFinite(s.fz0)) {
        out.fD = Math.max(1, s.fx1 - s.fx0);
        out.len = (s.fz1 - s.fz0) / out.fD;
        out.wrap = 0;
      }
      return out;
    });
    const secShape = new Map();
    for (const [id, r] of sst) {
      const S = shape(r), sec = sections.get(keys[id]);
      S.r0 = S.ring(sec.u0);
      S.len = frac(S.ring(sec.u1) - S.r0) * (S.L / S.H);
      secShape.set(id, S);
    }
    // a grouping: its zones and their places in the orders
    const setups = zones.map((z, zi) => (isGroup[zi] ? groupSetup(z, zi, zoneOf) : null));
    // which of its zone's n groups a seat is in: across the section, by its rows, or scattered
    const groupOf = (Q, across, rows, p, n = Q.G) => {
      const v = Q.gsplit === 'rows' ? rows : Q.gsplit === 'scatter' ? hash(p * 13.7, 3.1) : across;
      return clamp(Math.floor(v * n), 0, n - 1);
    };
    // pass 2: every seat's place in its zone's picture
    const maps = index.map((ix) => {
      const zone = new Int16Array(ix.n).fill(-1), X = new Float32Array(ix.n), Y = new Float32Array(ix.n);
      const grp = new Uint8Array(ix.n);
      for (let i = 0; i < ix.n; i++) {
        const id = ix.sec[i];
        if (id < 0) continue;
        const zi = zoneOf[id];
        if (zi < 0) continue;
        const I = info[zi];
        zone[i] = zi;
        const Q = setups[zi], p = Q ? (ix.phase ? ix.phase[i] * INV_TAU : hash(i, 1.7)) : 0;
        if (id === FLOOR_ID || ix.planar) {   // the floor, seen from above
          if (FACING) {   // across the crowd as the stage sees it; the front row nearest the stage
            const D = I.fD || Math.max(1, I.fx1 - I.fx0);
            X[i] = (ix.pos[i * 3 + 2] - I.fz0) / D;
            Y[i] = 1 - (ix.pos[i * 3] - I.fx0) / D;
          } else {
            X[i] = (ix.pos[i * 3] - I.fx0) / I.fH;
            Y[i] = (ix.pos[i * 3 + 2] - I.fz0) / I.fH;
          }
          if (Q) {   // across the floor (or the pen) as the stage sees it, rows back from the stage
            const q = pb.get(id);
            const across = q ? (ix.pos[i * 3 + 2] - q.z0) / Math.max(0.5, q.z1 - q.z0) : 0.5;
            const rows = q ? (ix.pos[i * 3] - q.x0) / Math.max(0.5, q.x1 - q.x0) : 0.5;
            grp[i] = groupOf(Q, across, rows, p, id === FLOOR_ID ? Q.GF : Q.G);   // the floor: one part per colour
          }
          continue;
        }
        const y = ix.pos[i * 3 + 1];
        if (each[zi]) {
          const S = secShape.get(id);
          X[i] = frac(S.ring(ix.u[i]) - S.r0) * (S.L / S.H);
          Y[i] = 1 - (y - S.yMin) / S.span;
          if (Q) grp[i] = groupOf(Q, X[i] / Math.max(1e-3, S.len), 1 - Y[i], p);   // rows: from the front row back
        } else {
          X[i] = frac(I.ring(ix.u[i]) - I.r0) * (I.L / I.H);
          Y[i] = 1 - (y - I.yMin) / I.span;
        }
      }
      return { zone, x: X, y: Y, grp };
    });
    // what painting needs per zone
    const compiled = zones.map((z, zi) => {
      const look = LOOK[z.look] || LOOK.solid;
      const c = {
        f: look.f, hue: !!look.hue, hk: !!look.hk, text: !!look.text,
        // a wash: the node's effect, colour mode and probability (showlooks.js)
        wash: look.wash ? WASH[z.fx] || WASH.solid : null, cmode: z.cmode || 'a', prob: clamp(z.prob ?? 1, 0.02, 1),
        // IR moving heads: what they do, for irheads.js
        ir: look.ir ? {
          motion: z.motion || 'sweep', fx: z.fx || 'solid', gobo: z.gobo || 'circle', size: clamp(z.size ?? 1, 0.3, 5),
          speed: clamp(z.speed ?? 1, 0, 4), prob: clamp(z.prob ?? 1, 0.02, 1), cmode: z.cmode || 'rainbow', a: lin(z.a),
          heads: Math.max(0, Math.round(z.heads ?? 0)),   // how many send; 0 = all
          pal: Array.isArray(z.pal) && z.pal.length ? z.pal.map(lin) : null,   // the colours picked: a head each
        } : null,
        // a grouping: its zones, their groups and how they take turns
        group: setups[zi],
        a: lin(z.a), b: lin(z.b), size: clamp(z.size ?? 1, 0.3, 4), dir: z.dir < 0 ? -1 : 1,
        rainbow: !!z.rainbow,
        pal: Array.isArray(z.pal) && z.pal.length ? z.pal.map(lin) : null,   // the colours picked, for a wash's mix   // the picked colour is "rainbow": the pattern keeps its light, the colour runs round the bowl
        speed: clamp(z.speed ?? 1, 0, 4), len: info[zi].len, id: z.id,
        phase: z.phase || 0, clock: clocks?.get(z.id) ?? (z.phase || 0),   // phase: where its clock starts
      };
      if (each[zi]) {   // the stadium wave runs through one section at a time
        let sum = 0, cnt = 0;
        for (const k of z.sections) {
          const S = secShape.get(idOf.get(k));
          if (S) { sum += S.len; cnt++; }
        }
        if (cnt) c.len = sum / cnt;
      }
      if (c.text) {
        const strip = makeTextStrip(z.text?.str, z.text?.font);
        const tsize = clamp(z.text?.size ?? 0.85, 0.3, 1);
        let kx = 1 / (tsize * c.size);   // zone units -> text heights; size widens the letters
        const wrap = info[zi].wrap;
        if (wrap > 0) {                  // a whole ring: a whole number of passes, so it loops with no seam
          const passes = Math.max(1, Math.round((wrap * kx) / strip.period));
          kx = (passes * strip.period) / wrap;
        }
        Object.assign(c, { strip, tsize, kx });
      }
      return c;
    });
    return { maps, compiled, stamp: indexStamp, irZone: compiled.findIndex((c) => c.ir) };
  }

  // one seat's colour (linear, 0..1) from its zone, at that zone's clock; in
  // a grouping, sid is the seat's section (its zone there) and g its group
  const _rb = [0, 0, 0];
  function seatRGB(c, clock, x, y, p, out, g = 0, sid = -1) {
    seatRGB0(c, clock, x, y, p, out, g, sid);
    if (c.rainbow) {
      const L = Math.max(out[0], out[1], out[2]);
      if (L > 0.002) {
        hueRGB(x / Math.max(1, c.len) + clock * 0.03, _rb);
        out[0] = _rb[0] * L; out[1] = _rb[1] * L; out[2] = _rb[2] * L;
      }
    }
    return out;
  }
  function seatRGB0(c, clock, x, y, p, out, g = 0, sid = -1) {
    if (c.group) {
      const Q = c.group, R = Q.recs[sid];
      const floor = R && R.t < 0;
      const lit = !R ? 0 : floor ? Q.zl[sid] * Q.fgl[g]
        : Q.zl[sid] * (Q.inner === 'random' && Q.G > 1 ? Q.glr[sid * Q.G + g] : Q.gl[g]);
      const m = Q.base + (1 - Q.base) * lit;
      if (!R || m <= 0.001) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
      if (floor) groupFxRGB(Q.floor.e, Q.floor.cols[g] || Q.floor.cols[0], clock * Q.fxSpeed, -x, y, p, c.len, out);
      else {
        const f = Q.fx[g] || Q.fx[0];
        groupFxRGB(f.e, Q.cmode === 'rainbow' ? R.rgb : Q.cmode === 'tier' ? R.tint : f.a, clock * Q.fxSpeed, -x, y, p, c.len, out);
      }
      out[0] *= m; out[1] *= m; out[2] *= m;
    } else if (c.text) {
      const k = textAt(c.strip, x, y, c.tsize, c.kx, clock * 1.2 * c.dir);
      out[0] = c.b[0] + (c.a[0] - c.b[0]) * k; out[1] = c.b[1] + (c.a[1] - c.b[1]) * k; out[2] = c.b[2] + (c.a[2] - c.b[2]) * k;
    } else if (c.wash) {
      washRGB(c.wash, c.cmode, c.a, c.prob, clock, p, out, c.pal);
    } else if (c.hk) {
      const k = c.f(-c.dir * x, y, clock, c.size, p, c.len);
      hueRGB(HK.hue, out);
      out[0] *= k; out[1] *= k; out[2] *= k;
    } else if (c.hue) {
      hueRGB(c.f(-c.dir * x, y, clock, c.size, p, c.len), out);
    } else {
      const k = c.f(-c.dir * x, y, clock, c.size, p, c.len);
      out[0] = c.b[0] + (c.a[0] - c.b[0]) * k; out[1] = c.b[1] + (c.a[1] - c.b[1]) * k; out[2] = c.b[2] + (c.a[2] - c.b[2]) * k;
    }
    return out;
  }

  // --- the live show ------------------------------------------------------------------
  let zones = [];
  let live = null, dirty = true;
  let tempo = 1;
  let ir = null;   // the IR moving heads (irheads.js), for 'ir' zones
  // The master level: a dimmer over the whole show, and the fades that move
  // it. The effect keeps running underneath (a strobe goes on strobing while
  // it darkens); only how bright the bands show changes. Levels are what the
  // eye sees, 0..1, so a fade looks even; the bands get it as linear light.
  const fade = { from: 1, to: 1, t0: 0, dur: 0, loop: 0 };
  const nowS = () => performance.now() / 1000;
  const ease = (k) => k * k * (3 - 2 * k);
  function levelNow() {
    const t = nowS() - fade.t0;
    if (fade.loop > 0) {   // down and back up, over and over, from where it was
      const ph = (t / fade.loop) % 2;
      return fade.from * (1 - ease(ph < 1 ? ph : 2 - ph));
    }
    const k = fade.dur > 0 ? Math.min(1, t / fade.dur) : 1;
    return fade.from + (fade.to - fade.from) * ease(k);
  }
  let shown = 1;   // this update's level, as linear light
  const clocks = new Map();   // zone id -> its clock, kept across edits so nothing jumps
  function ensureLive() {
    const changed = ensureIndex();
    if (changed || dirty || !live) { live = build(zones, clocks); dirty = false; }
  }
  // OrbFX calls this per orb group in 'design' mode
  let lastT = null;
  const col = [0, 0, 0];
  function paint(g, gi, arr, br, t) {
    ensureLive();
    if (gi === 0) {   // once per update: every zone's clock moves on at its own speed
      const dt = lastT === null ? 0 : clamp(t - lastT, 0, 0.2) * tempo;
      lastT = t;
      for (const c of live.compiled) { c.clock += dt * c.speed; clocks.set(c.id, c.clock); }
      for (const c of live.compiled) if (c.group) groupLevels(c.group, c.clock);
      shown = levelNow() ** 2.2;
    }
    br *= shown;
    const m = live.maps[gi], ph = g.phase, cz = live.compiled, sec = index[gi].sec;
    // the moving heads colour the whole group; other zones paint over their own sections
    const irz = ir ? live.irZone : -1;
    if (irz >= 0) ir.paint(g, gi, arr, br, cz[irz].ir);
    for (let i = 0, j = 0, n = g.n; i < n; i++, j += 3) {
      const zi = m.zone[i];
      if (zi < 0) { arr[j] = 0; arr[j + 1] = 0; arr[j + 2] = 0; continue; }
      if (zi === irz) continue;
      const c = cz[zi];
      seatRGB(c, c.clock, m.x[i], m.y[i], ph[i] * INV_TAU, col, m.grp[i], sec[i]);
      arr[j] = col[0] * br; arr[j + 1] = col[1] * br; arr[j + 2] = col[2] * br;
    }
  }

  // --- small maps of the arena, playing any set of zones (the demo cards) -------------
  // one layout per canvas size: a sample of the seats, each with its pixel
  const layouts = new Map();
  function layoutFor(W, H, visible) {
    ensureIndex();
    const vis = orbFX.groups.map((g, gi) => (gi === 0 ? !HIDE_BOWL : !!visible?.(g)));
    const key = `${W}x${H}|${indexStamp}|${vis.map((v) => (v ? 1 : 0)).join('')}`;
    let L = layouts.get(key);
    if (L) return L;
    const b = planBounds();
    const k = Math.min(W / (b.x1 - b.x0), H / (b.z1 - b.z0));
    const ox = (W - (b.x1 - b.x0) * k) / 2, oy = (H - (b.z1 - b.z0) * k) / 2;
    const total = index.reduce((n, ix, gi) => n + (vis[gi] ? ix.n : 0), 0);
    const step = Math.max(1, Math.round(total / Math.max(1500, W * H * 0.09)));
    const seats = [];
    index.forEach((ix, gi) => {
      if (!vis[gi]) return;
      const at = [], px = [];
      for (let i = 0; i < ix.n; i += step) {
        const X = Math.round(ox + (ix.pos[i * 3] - b.x0) * k), Y = Math.round(oy + (ix.pos[i * 3 + 2] - b.z0) * k);
        if (X < 0 || X >= W - 1 || Y < 0 || Y >= H - 1) continue;
        at.push(i); px.push(Y * W + X);
      }
      seats.push({ gi, at: Int32Array.from(at), px: Int32Array.from(px) });
    });
    L = { W, H, seats };
    layouts.clear();   // sizes rarely change: keep just the current one
    layouts.set(key, L);
    return L;
  }
  let bounds = null;
  function planBounds() {
    if (bounds) return bounds;
    const pos = orbFX.groups[0].pos;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]);
      z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]);
    }
    return (bounds = { x0: x0 - 3, x1: x1 + 3, z0: z0 - 3, z1: z1 + 3 });
  }
  // a player for one set of zones: draw(ctx, t) paints the arena as it would look
  function preview(list) {
    let built = null;
    const img = { data: null, w: 0, h: 0 };
    return {
      draw(ctx, t, visible) {
        ensureIndex();
        if (!built || built.stamp !== indexStamp) built = build(list, null);
        const W = ctx.canvas.width, H = ctx.canvas.height;
        const L = layoutFor(W, H, visible);
        if (!img.data || img.w !== W || img.h !== H) { img.data = ctx.createImageData(W, H); img.w = W; img.h = H; }
        const d = img.data.data;
        for (let q = 0; q < d.length; q += 4) { d[q] = 8; d[q + 1] = 9; d[q + 2] = 12; d[q + 3] = 255; }
        for (const c of built.compiled) if (c.group) groupLevels(c.group, t * tempo * c.speed + c.phase);
        for (const s of L.seats) {
          const m = built.maps[s.gi], ph = index[s.gi].phase, sec = index[s.gi].sec;
          for (let k = 0; k < s.at.length; k++) {
            const i = s.at[k], zi = m.zone[i];
            let r = 30, g = 32, b = 38;
            if (zi >= 0) {
              const c = built.compiled[zi];
              if (c.ir) {
                const P = index[s.gi].pos;
                if (ir) ir.previewRGB(c.ir, t * tempo * c.ir.speed, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], ph ? ph[i] : 0, col);
                else col[0] = col[1] = col[2] = 0;
              } else seatRGB(c, t * tempo * c.speed + c.phase, m.x[i], m.y[i], ph ? ph[i] * INV_TAU : 0, col, m.grp[i], sec[i]);
              r = Math.sqrt(Math.min(1, col[0])) * 255; g = Math.sqrt(Math.min(1, col[1])) * 255; b = Math.sqrt(Math.min(1, col[2])) * 255;
              if (r + g + b < 30) { r = Math.max(r, 30); g = Math.max(g, 32); b = Math.max(b, 38); }
            }
            const p = s.px[k] * 4;
            d[p] = r; d[p + 1] = g; d[p + 2] = b;
            d[p + 4] = r; d[p + 5] = g; d[p + 6] = b;
            d[p + W * 4] = r; d[p + W * 4 + 1] = g; d[p + W * 4 + 2] = b;
            d[p + W * 4 + 4] = r; d[p + W * 4 + 5] = g; d[p + W * 4 + 6] = b;
          }
        }
        ctx.putImageData(img.data, 0, 0);
      },
    };
  }

  return {
    sections, tiers, keys, idOf,
    setZones(list) { zones = list || []; dirty = true; },
    noStands: HIDE_BOWL,   // the festival field: a crowd on the grass, no bowl
    paint, preview,
    get tempo() { return tempo; },
    set tempo(v) { const n = Number(v); tempo = clamp(Number.isFinite(n) ? n : 1, 0, 4); },
    set ir(v) { ir = v; },
    // the master level and its fades (seconds); a loop fades down and back up
    fadeTo(to, seconds = 0) {
      fade.from = levelNow(); fade.to = clamp(Number(to) || 0, 0, 1);
      fade.t0 = nowS(); fade.dur = Math.max(0, Number(seconds) || 0); fade.loop = 0;
    },
    fadeLoop(seconds) {
      const lv = levelNow();
      fade.from = lv > 0.05 ? lv : 1; fade.to = fade.from;
      fade.t0 = nowS(); fade.dur = 0; fade.loop = Math.max(0.2, Number(seconds) || 2);
    },
    get level() { return levelNow(); },
    get looping() { return fade.loop > 0; },
    get fading() { return fade.loop > 0 || nowS() - fade.t0 < fade.dur; },
    // what the IR moving heads are doing in the show, or null with no IR zone
    get irParams() {
      ensureLive();
      return live.irZone >= 0 ? live.compiled[live.irZone].ir : null;
    },
    // the section at a point of the plan: a bowl section, the floor, or nothing
    keyAt(x, z) {
      const s = sectionAt(x, z);
      if (s) return `b${s.tier}-${s.span}`;
      return bowlOffsetAt(x, z) < 0 ? FLOOR : null;
    },
    // each seat's section number (an index into keys), per orb group
    seatSections(gi) { ensureIndex(); return index[gi]?.sec || null; },
    // the bowl sections that pass a test on their tier, span and middle (cx, cz)
    where(test) {
      ensureIndex();
      return [...sections.values()].filter((s) => s.key !== FLOOR && s.count && test(s)).map((s) => s.key);
    },
    planBounds,
  };
}
