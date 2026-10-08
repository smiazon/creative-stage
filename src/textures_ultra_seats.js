// Ultra seat bakes — drop-in upgrades for makeSeatShading / makeSeatBillboard
// plus a courtside cushion set. All pure canvas, deterministic, zero assets.
import * as THREE from 'three';

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// ---------------------------------------------------------------------------
// SEAT SHADING — 512x512 UV-space bake for the merged pan+backrest box.
// MULTIPLIES instanceColor, so it must stay a near-white AO/shading map:
// every final pixel lives in the 150–255 band. Clamped, not tiled.
// ---------------------------------------------------------------------------
export function makeUltraSeatShading() {
  const S = 512;
  const rand = mulberry32(90210);
  const [c, ctx] = makeCanvas(S, S);

  // base shell tone
  ctx.fillStyle = '#e4e4e6';
  ctx.fillRect(0, 0, S, S);

  // large-scale: soft centre-pad highlight where the moulding bulges forward
  const pad = ctx.createRadialGradient(S * 0.5, S * 0.44, S * 0.06, S * 0.5, S * 0.44, S * 0.52);
  pad.addColorStop(0, 'rgba(255,255,255,0.55)');
  pad.addColorStop(0.55, 'rgba(255,255,255,0.22)');
  pad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = pad;
  ctx.fillRect(0, 0, S, S);

  // strong AO at all four box edges — the geometry has none of its own
  const edge = S * 0.13;
  const ao = (x0, y0, x1, y1) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(152,152,158,0.72)');
    g.addColorStop(0.55, 'rgba(152,152,158,0.28)');
    g.addColorStop(1, 'rgba(152,152,158,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  };
  ao(0, 0, edge, 0);
  ao(S, 0, S - edge, 0);
  ao(0, 0, 0, edge);
  ao(0, S, 0, S - edge);

  // mid-scale: two vertical ergonomic grooves flanking the pad
  for (const gx of [S * 0.5 - 88, S * 0.5 + 88]) {
    const g = ctx.createLinearGradient(gx - 9, 0, gx + 5, 0);
    g.addColorStop(0, 'rgba(158,158,164,0)');
    g.addColorStop(0.62, 'rgba(158,158,164,0.42)');
    g.addColorStop(1, 'rgba(158,158,164,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(gx - 9, edge * 0.85, 14, S - edge * 1.7);
    // lower lip of the groove catching light
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(gx + 5, edge * 0.85, 2.5, S - edge * 1.7);
  }

  // crisp injection seam — one hard dark line with a bright flash under it
  const seamY = S * 0.485;
  ctx.fillStyle = 'rgba(146,146,152,0.6)';
  ctx.fillRect(edge * 0.7, seamY, S - edge * 1.4, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(edge * 0.7, seamY + 2, S - edge * 1.4, 1.5);

  // wear-polish band where thighs rub — faint horizontal brightening
  const wear = ctx.createLinearGradient(0, S * 0.60, 0, S * 0.76);
  wear.addColorStop(0, 'rgba(255,255,255,0)');
  wear.addColorStop(0.5, 'rgba(255,255,255,0.26)');
  wear.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = wear;
  ctx.fillRect(edge * 0.6, S * 0.60, S - edge * 1.2, S * 0.16);

  // fine plastic grain, +-4 of value
  for (let i = 0; i < 9000; i++) {
    const x = rand() * S, y = rand() * S;
    ctx.fillStyle = rand() < 0.5
      ? `rgba(255,255,255,${0.02 + rand() * 0.03})`
      : `rgba(140,140,146,${0.02 + rand() * 0.03})`;
    ctx.fillRect(x, y, 1, 1);
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// SEAT BILLBOARD ATLAS — 1024x512, two 512px cells: LEFT = seat from the
// front, RIGHT = same seat from behind. Empty flip seats sit with the pan
// folded UP against the backrest, so both views read as a tall shell with the
// pan underside (front) / pan back (rear) filling the lower half. Painted in
// near-white greys — instanceColor multiplies. alphaTest 0.45 eats the AA
// fringe, so every stroke is hard-edged; no soft floating shadows.
// ---------------------------------------------------------------------------
export function makeUltraSeatBillboard() {
  const W = 1024, H = 512;
  const rand = mulberry32(41414);
  const [c, x] = makeCanvas(W, H);
  x.clearRect(0, 0, W, H);
  const half = W / 2;

  const cell = (ox, back) => {
    const cx = ox + half / 2;

    // side stanchions + armrests, drawn first so the shell overlaps them
    for (const s of [-1, 1]) {
      const sx = cx + s * 182;
      const sg = x.createLinearGradient(sx - 13, 0, sx + 13, 0);
      if (back) { sg.addColorStop(0, '#8e8e96'); sg.addColorStop(0.5, '#a6a6ae'); sg.addColorStop(1, '#7e7e86'); }
      else { sg.addColorStop(0, '#c6c6ce'); sg.addColorStop(0.5, '#e2e2ea'); sg.addColorStop(1, '#a8a8b2'); }
      x.fillStyle = sg;
      x.beginPath(); x.roundRect(sx - 13, 168, 26, 322, [6, 6, 3, 3]); x.fill();
      // armrest cap reaching inward
      x.fillStyle = back ? '#9a9aa2' : '#d4d4dc';
      x.beginPath(); x.roundRect(sx - (s > 0 ? 92 : 14), 148, 106, 26, 13); x.fill();
      x.fillStyle = back ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.12)';
      x.fillRect(sx - (s > 0 ? 92 : 14) + 4, 168, 98, 5); // AO under the pad
    }

    // backrest shell — upper portion visible above the folded pan
    const bw = 292, bTop = 42, bBot = 268;
    const bg = x.createLinearGradient(cx - bw / 2, bTop, cx + bw / 2, bBot);
    if (back) { bg.addColorStop(0, '#84848c'); bg.addColorStop(0.5, '#a2a2ab'); bg.addColorStop(1, '#74747c'); }
    else { bg.addColorStop(0, '#d8d8e0'); bg.addColorStop(0.45, '#f7f7fd'); bg.addColorStop(1, '#bcbcc6'); }
    x.fillStyle = bg;
    x.beginPath(); x.roundRect(cx - bw / 2, bTop, bw, bBot - bTop, [46, 46, 8, 8]); x.fill();

    if (!back) {
      // moulded flutes on the backrest face
      x.strokeStyle = 'rgba(0,0,0,0.14)';
      x.lineWidth = 5;
      for (let i = -2; i <= 2; i++) {
        x.beginPath();
        x.moveTo(cx + i * 50, bTop + 30);
        x.lineTo(cx + i * 50, bBot - 30);
        x.stroke();
      }
      x.strokeStyle = 'rgba(255,255,255,0.35)';
      x.lineWidth = 2;
      for (let i = -2; i <= 2; i++) {
        x.beginPath();
        x.moveTo(cx + i * 50 + 4, bTop + 30);
        x.lineTo(cx + i * 50 + 4, bBot - 30);
        x.stroke();
      }
    } else {
      // recessed stiffener panel on the shell back
      x.strokeStyle = 'rgba(0,0,0,0.24)';
      x.lineWidth = 6;
      x.beginPath(); x.roundRect(cx - bw / 2 + 22, bTop + 26, bw - 44, bBot - bTop - 48, 18); x.stroke();
      // row/seat tag plate
      x.fillStyle = '#d6d6da';
      x.beginPath(); x.roundRect(cx - 44, bTop + 40, 88, 42, 6); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.3)';
      x.lineWidth = 2;
      x.beginPath(); x.roundRect(cx - 44, bTop + 40, 88, 42, 6); x.stroke();
      x.fillStyle = 'rgba(56,56,62,0.9)';
      x.font = 'bold 24px sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('K 14', cx, bTop + 62);
    }

    // seat pan folded UP against the backrest — its underside (front view) /
    // its back (rear view) is the big lower panel
    const pw = 312, pTop = 240, pBot = 478;
    const pg = x.createLinearGradient(0, pTop, 0, pBot);
    if (back) { pg.addColorStop(0, '#787880'); pg.addColorStop(0.5, '#8e8e96'); pg.addColorStop(1, '#68686f'); }
    else { pg.addColorStop(0, '#c4c4cc'); pg.addColorStop(0.4, '#d2d2da'); pg.addColorStop(1, '#9c9ca6'); }
    x.fillStyle = pg;
    x.beginPath(); x.roundRect(cx - pw / 2, pTop, pw, pBot - pTop, [12, 12, 34, 34]); x.fill();

    // AO in the fold crease where the pan tucks against the shell
    const crease = x.createLinearGradient(0, pTop, 0, pTop + 34);
    crease.addColorStop(0, back ? 'rgba(0,0,0,0.42)' : 'rgba(0,0,0,0.34)');
    crease.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = crease;
    x.fillRect(cx - pw / 2 + 4, pTop, pw - 8, 34);

    if (!back) {
      // moulded ribs + pivot boss on the pan underside
      x.strokeStyle = 'rgba(0,0,0,0.16)';
      x.lineWidth = 4;
      for (const ry of [pTop + 74, pTop + 128, pTop + 182]) {
        x.beginPath();
        x.moveTo(cx - pw / 2 + 26, ry);
        x.lineTo(cx + pw / 2 - 26, ry);
        x.stroke();
      }
      x.fillStyle = 'rgba(0,0,0,0.14)';
      x.beginPath(); x.arc(cx, pTop + 128, 26, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.4)';
      x.beginPath(); x.arc(cx - 7, pTop + 121, 9, 0, Math.PI * 2); x.fill();
    } else {
      x.strokeStyle = 'rgba(0,0,0,0.2)';
      x.lineWidth = 5;
      x.beginPath(); x.roundRect(cx - pw / 2 + 20, pTop + 30, pw - 40, pBot - pTop - 56, 22); x.stroke();
    }

    // side edge shading pins the silhouette to a curved shell
    for (const s of [-1, 1]) {
      const ex = cx + s * (pw / 2 - 14);
      const eg = x.createLinearGradient(ex - s * 16, 0, ex + s * 8, 0);
      eg.addColorStop(0, 'rgba(0,0,0,0)');
      eg.addColorStop(1, 'rgba(0,0,0,0.2)');
      x.fillStyle = eg;
      x.fillRect(Math.min(ex - s * 16, ex + s * 8), pTop + 8, 24, pBot - pTop - 16);
    }

    // fine grain over both panels, kept inside the silhouette
    for (let i = 0; i < 1400; i++) {
      const gx = cx - pw / 2 + 14 + rand() * (pw - 28);
      const gy = bTop + 14 + rand() * (pBot - bTop - 28);
      x.fillStyle = rand() < 0.5
        ? `rgba(255,255,255,${0.02 + rand() * 0.04})`
        : `rgba(30,30,36,${0.02 + rand() * 0.04})`;
      x.fillRect(gx, gy, 1.5, 1.5);
    }
  };

  cell(0, false);
  cell(half, true);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// COURTSIDE CUSHION — 256x256 albedo + roughness for a padded quilted seat.
// Near-black leather; the read comes from the roughness contrast (matte pad,
// shinier piping), so the albedo range stays very tight. Clamped, per-cushion.
// ---------------------------------------------------------------------------
export function makeUltraCushion() {
  const S = 256;
  const rand = mulberry32(777);
  const [c, ctx] = makeCanvas(S, S);
  const [rc, rctx] = makeCanvas(S, S);

  // base leather
  ctx.fillStyle = '#0a0b0e';
  ctx.fillRect(0, 0, S, S);
  rctx.fillStyle = 'rgb(140,140,140)';
  rctx.fillRect(0, 0, S, S);

  // large-scale mottling — barely-there tone drift
  for (let i = 0; i < 7; i++) {
    const mx = rand() * S, my = rand() * S, mr = 40 + rand() * 70;
    const m = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
    m.addColorStop(0, `rgba(22,24,30,${0.12 + rand() * 0.1})`);
    m.addColorStop(1, 'rgba(22,24,30,0)');
    ctx.fillStyle = m;
    ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
  }

  // 2x2 quilted pucker — each cell puffs toward its centre
  for (let gy = 0; gy < 2; gy++) {
    for (let gx = 0; gx < 2; gx++) {
      const px = 64 + gx * 128, py = 64 + gy * 128;
      const q = ctx.createRadialGradient(px, py - 6, 4, px, py, 78);
      q.addColorStop(0, 'rgba(34,37,46,0.6)');
      q.addColorStop(0.55, 'rgba(18,19,24,0.25)');
      q.addColorStop(1, 'rgba(0,0,0,0.4)');
      ctx.fillStyle = q;
      ctx.fillRect(px - 78, py - 78, 156, 156);
      // pucker centres polish slightly with use
      const qr = rctx.createRadialGradient(px, py, 0, px, py, 46);
      qr.addColorStop(0, 'rgba(112,112,112,0.55)');
      qr.addColorStop(1, 'rgba(112,112,112,0)');
      rctx.fillStyle = qr;
      rctx.fillRect(px - 46, py - 46, 92, 92);
    }
  }

  // quilt seams — dark crease with a faint catch-line either side
  const seam = (x0, y0, x1, y1) => {
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = 'rgba(52,56,68,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0 + 2, y0 + 2); ctx.lineTo(x1 + 2, y1 + 2); ctx.stroke();
    rctx.strokeStyle = 'rgba(158,158,158,0.7)';   // creases collect dust: rougher
    rctx.lineWidth = 3;
    rctx.beginPath(); rctx.moveTo(x0, y0); rctx.lineTo(x1, y1); rctx.stroke();
  };
  seam(128, 16, 128, 240);
  seam(16, 128, 240, 128);

  // piping around the border — the one bright accent, and the shiny one
  ctx.strokeStyle = '#1e2026';
  ctx.lineWidth = 8;
  ctx.beginPath(); ctx.roundRect(7, 7, S - 14, S - 14, 16); ctx.stroke();
  ctx.strokeStyle = 'rgba(150,156,172,0.3)';      // top-left highlight on the roll
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.roundRect(5.5, 5.5, S - 14, S - 14, 16); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';            // tuck shadow inside the piping
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(13, 13, S - 26, S - 26, 12); ctx.stroke();
  rctx.strokeStyle = 'rgb(90,90,90)';
  rctx.lineWidth = 9;
  rctx.beginPath(); rctx.roundRect(7, 7, S - 14, S - 14, 16); rctx.stroke();

  // fine leather grain + a couple of sat-on crease strokes
  for (let i = 0; i < 2400; i++) {
    const gx = rand() * S, gy = rand() * S;
    ctx.fillStyle = rand() < 0.5
      ? `rgba(40,44,54,${0.04 + rand() * 0.05})`
      : `rgba(0,0,0,${0.05 + rand() * 0.06})`;
    ctx.fillRect(gx, gy, 1, 1);
    if (i < 900) {
      rctx.fillStyle = `rgba(${rand() < 0.5 ? 128 : 152},128,128,0.25)`;
      rctx.fillRect(gx, gy, 1.5, 1.5);
    }
  }
  for (let i = 0; i < 5; i++) {
    const sx = 30 + rand() * 196, sy = 30 + rand() * 196, a = rand() * Math.PI;
    const len = 18 + rand() * 30;
    ctx.strokeStyle = 'rgba(30,33,42,0.3)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(
      sx + Math.cos(a) * len * 0.5 + (rand() - 0.5) * 8,
      sy + Math.sin(a) * len * 0.5 + (rand() - 0.5) * 8,
      sx + Math.cos(a) * len, sy + Math.sin(a) * len
    );
    ctx.stroke();
  }

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  const roughnessMap = new THREE.CanvasTexture(rc);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.ClampToEdgeWrapping;
  return { map, roughnessMap };
}
