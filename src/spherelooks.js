// Skins for the stadium's giant video sphere. Earth and Moon are NASA's public
// domain maps (assets/); the rest are drawn here so the sphere always has
// something to wear even offline. Every texture is an equirectangular map —
// SphereGeometry's UVs wrap longitude around u and latitude down v, so a
// world map lands where a globe would put it.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function finish(c) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

const loader = new THREE.TextureLoader();
const cache = new Map();
// NASA maps: loaded once, on first use; the sphere shows black for the frame
// or two the file takes, then the planet pops in
export function loadSkin(url) {
  if (cache.has(url)) return cache.get(url);
  const tex = loader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  cache.set(url, tex);
  return tex;
}

// boiling star: yellow-white cells with darker seams and a few dark spots
export function makeSunTexture() {
  if (cache.has('sun')) return cache.get('sun');
  const W = 2048, H = 1024;
  const [c, ctx] = canvas(W, H);
  const rand = rng(7);
  ctx.fillStyle = '#ffb21a';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) {
    const r = 3 + rand() * 22, x = rand() * W, y = rand() * H;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,${210 + rand() * 45},${120 + rand() * 90},0.55)`);
    g.addColorStop(0.7, `rgba(240,120,20,${0.15 + rand() * 0.2})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 26; i++) {   // sunspots
    const r = 8 + rand() * 26, x = rand() * W, y = H * 0.25 + rand() * H * 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(90,30,0,0.9)'); g.addColorStop(0.5, 'rgba(200,80,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = finish(c);
  cache.set('sun', tex);
  return tex;
}

// The looks the console offers. `spin` is radians per second about the
// axis; `glow` tints the thin atmosphere shell around the sphere (null = off).
export const SPHERE_LOOKS = {
  earth: { name: 'Earth', tex: () => loadSkin('./assets/earth-2k.jpg'), tint: 1.15, spin: 0.045, glow: 0x4f8fff },
  night: { name: 'Earth at night', tex: () => loadSkin('./assets/earth-night-2k.jpg'), tint: 1.6, spin: 0.035, glow: 0x2f5fbf },
  moon: { name: 'Moon', tex: () => loadSkin('./assets/moon-1k.jpg'), tint: 1.35, spin: 0.02, glow: null },
  // kept under the bloom gate (1.25 max channel): a sun that glows, not a white blot
  sun: { name: 'Sun', tex: () => makeSunTexture(), tint: 1.05, spin: 0.06, glow: 0xffa020, glowK: 0.5 },
  // shader patterns (stage.js patternMat, uMode) — colourful, animated, seamless
  plasma: { name: 'Plasma', pattern: 1, spin: 0.02 },
  candy: { name: 'Candy spiral', pattern: 2, spin: 0.03 },
  disco: { name: 'Disco ball', pattern: 3, spin: 0.14 },
  lava: { name: 'Lava', pattern: 4, spin: 0.015, glow: 0xff5a1a, glowK: 0.45 },
  ripple: { name: 'Ripples', pattern: 5, spin: 0 },
  matrix: { name: 'Matrix rain', pattern: 6, spin: 0.01 },
  neon: { name: 'Neon grid', pattern: 7, spin: 0.02 },
  nebula: { name: 'Nebula', pattern: 8, spin: 0.01, glow: 0x6a3cff, glowK: 0.6 },
  video: { name: 'Show video', tex: null, tint: 1.4, spin: 0, glow: null },     // whatever the screens route
  rig: { name: 'Rig colour', tex: null, tint: 1, spin: 0, glow: null },        // solid, follows colour A
  off: { name: 'Off', tex: null, tint: 0, spin: 0, glow: null },
};
