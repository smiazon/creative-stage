// Camera looks: a full-screen pass after tone mapping that turns the plain
// render into a point of view — a handheld camcorder, a fisheye, a film
// frame, a worn VHS tape, black-and-white noir, a drone feed, a dream, and
// then the odder glass: thermal, night vision, a security camera, cel-shaded
// anime, comic halftone, an 8-bit console, a glitching feed, a kaleidoscope,
// cross-processed Lomo, red/cyan anaglyph, a pencil sketch, a CRT television,
// underwater, cyberpunk split-toning, scratched 16 mm film, a tilt-shift
// miniature and infrared film. One shader, one `uMode`; main.js picks it
// from Settings and swaps the lens (fov) to match. HTML overlays (REC, drone
// HUD, thermal scale, night-vision reticle, security stamp) live in index.html.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const LOOKS = [
  { key: 'off', name: 'Off', mode: 0, fov: 72 },
  { key: 'camcorder', name: 'Camcorder', mode: 1, fov: 78, hud: 'rec' },
  { key: 'fisheye', name: 'Fisheye', mode: 2, fov: 104 },
  { key: 'film', name: 'Film', mode: 3, fov: 60 },
  { key: 'vhs', name: 'VHS tape', mode: 4, fov: 72, hud: 'vhs' },
  { key: 'noir', name: 'Noir', mode: 5, fov: 66 },
  { key: 'drone', name: 'Drone feed', mode: 6, fov: 96, hud: 'drone' },
  { key: 'dream', name: 'Dream', mode: 7, fov: 72 },
  { key: 'thermal', name: 'Thermal', mode: 8, fov: 60, hud: 'thermal' },
  { key: 'nightvision', name: 'Night vision', mode: 9, fov: 84, hud: 'nv' },
  { key: 'security', name: 'Security cam', mode: 10, fov: 92, hud: 'sec' },
  { key: 'anime', name: 'Anime', mode: 11, fov: 72 },
  { key: 'halftone', name: 'Comic book', mode: 12, fov: 72 },
  { key: 'pixel', name: '8-bit', mode: 13, fov: 72 },
  { key: 'glitch', name: 'Glitch', mode: 14, fov: 72 },
  { key: 'kaleido', name: 'Kaleidoscope', mode: 15, fov: 72 },
  { key: 'lomo', name: 'Lomo', mode: 16, fov: 68 },
  { key: 'anaglyph', name: '3D glasses', mode: 17, fov: 72 },
  { key: 'sketch', name: 'Pencil sketch', mode: 18, fov: 72 },
  { key: 'crt', name: 'Old TV', mode: 19, fov: 72 },
  { key: 'underwater', name: 'Underwater', mode: 20, fov: 80 },
  { key: 'cyberpunk', name: 'Cyberpunk', mode: 21, fov: 72 },
  { key: 'oldfilm', name: '16 mm film', mode: 22, fov: 62 },
  { key: 'tiltshift', name: 'Miniature', mode: 23, fov: 55 },
  { key: 'infrared', name: 'Infrared', mode: 24, fov: 72 },
];

export function makeLookPass() {
  const pass = new ShaderPass(new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uMode: { value: 0 },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1920, 1080) },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tDiffuse; uniform int uMode; uniform float uTime; uniform vec2 uRes;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
      // barrel/fisheye: push uv out from the centre by k*r^2 (aspect-true)
      vec2 barrel(vec2 uv, float k) {
        vec2 c = uv - 0.5; c.x *= uRes.x / uRes.y;
        float r2 = dot(c, c);
        c *= 1.0 + k * r2;
        c.x /= uRes.x / uRes.y;
        return c + 0.5;
      }
      vec3 chroma(vec2 uv, float amt) {
        vec2 d = (uv - 0.5) * amt;
        return vec3(texture2D(tDiffuse, uv + d).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d).b);
      }
      vec3 blur5(vec2 uv, float px) {
        vec2 o = px / uRes;
        vec3 s = texture2D(tDiffuse, uv).rgb * 0.4;
        s += texture2D(tDiffuse, uv + vec2(o.x, 0.0)).rgb * 0.15 + texture2D(tDiffuse, uv - vec2(o.x, 0.0)).rgb * 0.15;
        s += texture2D(tDiffuse, uv + vec2(0.0, o.y)).rgb * 0.15 + texture2D(tDiffuse, uv - vec2(0.0, o.y)).rgb * 0.15;
        return s;
      }
      float vignette(vec2 uv, float k) { vec2 c = uv - 0.5; return 1.0 - k * dot(c, c) * 2.2; }
      // Sobel edge strength on luma, px = sample spacing in pixels
      float edge(vec2 uv, float px) {
        vec2 o = px / uRes;
        float tl = luma(texture2D(tDiffuse, uv + vec2(-o.x,  o.y)).rgb), tc = luma(texture2D(tDiffuse, uv + vec2(0.0,  o.y)).rgb), tr = luma(texture2D(tDiffuse, uv + vec2( o.x,  o.y)).rgb);
        float ml = luma(texture2D(tDiffuse, uv + vec2(-o.x, 0.0)).rgb),                                                          mr = luma(texture2D(tDiffuse, uv + vec2( o.x, 0.0)).rgb);
        float bl = luma(texture2D(tDiffuse, uv + vec2(-o.x, -o.y)).rgb), bc = luma(texture2D(tDiffuse, uv + vec2(0.0, -o.y)).rgb), br = luma(texture2D(tDiffuse, uv + vec2( o.x, -o.y)).rgb);
        float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
        float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
        return length(vec2(gx, gy));
      }
      void main() {
        vec2 uv = vUv;
        vec3 col;
        if (uMode == 1) {                          // camcorder: cheap glass, hot colour, scanlines
          uv = barrel(uv, 0.06);
          col = chroma(uv, 0.006);
          col = (col - 0.5) * 1.18 + 0.5;
          col = mix(vec3(luma(col)), col, 1.25);
          col *= 0.94 + 0.06 * sin(uv.y * uRes.y * 1.5);
          col += (hash(uv * uRes + uTime) - 0.5) * 0.05;
          col *= vignette(uv, 0.5);
        } else if (uMode == 2) {                   // fisheye: a real circle image
          vec2 c = vUv - 0.5; c.x *= uRes.x / uRes.y;
          float r = length(c) / 0.56;
          if (r > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          uv = barrel(vUv, 0.75);
          col = chroma(uv, 0.012 * r);
          col *= 1.0 - 0.55 * pow(r, 3.0);
        } else if (uMode == 3) {                   // film: 2.39 frame, teal shadows, warm highlights, grain
          float bar = (1.0 - uRes.x / uRes.y / 2.39) * 0.5;
          if (vUv.y < bar || vUv.y > 1.0 - bar) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          col = texture2D(tDiffuse, uv).rgb;
          float l = luma(col);
          col = mix(col, vec3(l), 0.15);
          col += (vec3(-0.06, 0.02, 0.09)) * (1.0 - l) + vec3(0.08, 0.03, -0.05) * l;
          col = pow(max(col, 0.0), vec3(1.06));
          col += (hash(uv * uRes * 0.7 + fract(uTime * 7.0)) - 0.5) * 0.07;
          col *= vignette(uv, 0.65);
        } else if (uMode == 4) {                   // VHS: tracking wobble, bleeding chroma, noise band
          float line = floor(uv.y * uRes.y * 0.5);
          float wob = (hash(vec2(line, floor(uTime * 24.0))) - 0.5) * 0.004;
          float band = smoothstep(0.0, 0.02, abs(fract(uv.y - uTime * 0.13) - 0.5) - 0.47) ;
          uv.x += wob + (1.0 - band) * 0.03 * (hash(vec2(uTime, line)) - 0.5);
          float l = luma(texture2D(tDiffuse, uv).rgb);
          vec3 cb = blur5(uv + vec2(0.004, 0.0), 3.0);
          col = mix(vec3(l), cb, 0.75);
          col = mix(vec3(luma(col)), col, 0.8) * vec3(1.02, 0.98, 1.06);
          col *= 0.9 + 0.1 * sin(uv.y * uRes.y * 3.14159);
          col += (hash(uv * uRes + uTime * 3.0) - 0.5) * 0.12;
          col = mix(col, vec3(0.9), (1.0 - band) * 0.25);
          col *= vignette(uv, 0.35);
        } else if (uMode == 5) {                   // noir: silver halide
          col = texture2D(tDiffuse, uv).rgb;
          float l = luma(col);
          l = smoothstep(0.02, 0.92, pow(l, 0.85));
          col = vec3(l) * vec3(1.0, 0.98, 0.94);
          col += (hash(uv * uRes + uTime) - 0.5) * 0.09;
          col *= vignette(uv, 0.85);
        } else if (uMode == 6) {                   // drone: wide, crisp, cool
          uv = barrel(uv, 0.12);
          vec3 c0 = texture2D(tDiffuse, uv).rgb;
          vec3 b = blur5(uv, 2.0);
          col = c0 + (c0 - b) * 0.9;
          col = mix(vec3(luma(col)), col, 1.1) * vec3(0.95, 1.0, 1.08);
          col *= vignette(uv, 0.3);
        } else if (uMode == 7) {                   // dream: soft, lifted, haloed
          vec3 c0 = texture2D(tDiffuse, uv).rgb;
          vec3 b = blur5(uv, 6.0);
          b = blur5(uv, 12.0) * 0.5 + b * 0.5;
          col = mix(c0, b, 0.55) + b * 0.35;
          col = mix(vec3(luma(col)), col, 0.85);
          col = col * 0.9 + 0.08;
          col += chroma(uv, 0.02) * 0.1;
          col *= vignette(uv, 0.4);
        } else if (uMode == 8) {                   // thermal: ironbow palette by heat (brightness), soft sensor
          vec3 c0 = blur5(uv, 1.6);
          float l = clamp(luma(c0) * 1.35, 0.0, 1.0);
          vec3 pal = l < 0.25 ? mix(vec3(0.02, 0.0, 0.1), vec3(0.45, 0.0, 0.6), l / 0.25)
                   : l < 0.5 ? mix(vec3(0.45, 0.0, 0.6), vec3(0.95, 0.15, 0.05), (l - 0.25) / 0.25)
                   : l < 0.75 ? mix(vec3(0.95, 0.15, 0.05), vec3(1.0, 0.75, 0.05), (l - 0.5) / 0.25)
                   : mix(vec3(1.0, 0.75, 0.05), vec3(1.0, 1.0, 0.95), (l - 0.75) / 0.25);
          col = pal + (hash(uv * uRes + uTime) - 0.5) * 0.04;
        } else if (uMode == 9) {                   // night vision: green phosphor, huge gain, a tube's circle
          vec2 c = vUv - 0.5; c.x *= uRes.x / uRes.y;
          float r = length(c) / 0.62;
          if (r > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          vec3 c0 = texture2D(tDiffuse, uv).rgb;
          float l = pow(luma(c0) * 2.6, 0.75);
          l += (hash(uv * uRes * 0.8 + uTime * 13.0) - 0.5) * 0.28;
          l *= 0.9 + 0.1 * sin(uv.y * uRes.y * 2.0);
          col = vec3(0.15, 1.0, 0.35) * l * (1.0 - 0.4 * r * r) + vec3(0.0, 0.05, 0.0);
          col += vec3(0.5, 0.8, 0.5) * smoothstep(0.8, 1.4, l);   // hot spots blow out
        } else if (uMode == 10) {                  // security camera: low res, grey, rolling bar
          vec2 px = uRes / 3.0;
          uv = (floor(uv * px) + 0.5) / px;
          float l = pow(luma(texture2D(tDiffuse, uv).rgb), 0.9) * 1.1;
          col = vec3(l) * vec3(0.92, 0.96, 1.0);
          col *= 0.85 + 0.15 * sin(uv.y * uRes.y * 1.0 + uTime * 2.0);
          col *= 0.9 + 0.1 * smoothstep(0.02, 0.0, abs(fract(uv.y + uTime * 0.07) - 0.5));
          col += (hash(uv * uRes + uTime * 5.0) - 0.5) * 0.12;
          col *= vignette(uv, 0.7);
        } else if (uMode == 11) {                  // anime: flat cel shading with ink lines
          vec3 c0 = texture2D(tDiffuse, uv).rgb;
          vec3 q = floor(c0 * 5.0 + 0.5) / 5.0;
          float e = smoothstep(0.12, 0.35, edge(uv, 1.5));
          col = mix(q * 1.12, vec3(0.0), e);
        } else if (uMode == 12) {                  // comic book: a rotated halftone dot screen
          vec3 c0 = texture2D(tDiffuse, uv).rgb;
          float ang = 0.45; mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
          vec2 g = R * (vUv * uRes) / 7.0;
          vec2 cell = fract(g) - 0.5;
          vec3 cq = floor(c0 * 4.0 + 0.5) / 4.0;
          float rad = sqrt(clamp(luma(c0), 0.0, 1.0)) * 0.72;
          float dt = smoothstep(rad + 0.08, rad - 0.08, length(cell));
          col = cq * 1.3 * dt + vec3(0.02);
        } else if (uMode == 13) {                  // 8-bit: big pixels, four levels, ordered dither
          vec2 px = uRes / 6.0;
          uv = (floor(uv * px) + 0.5) / px;
          vec3 c0 = texture2D(tDiffuse, uv).rgb;
          float dth = (mod(floor(vUv.x * px.x), 2.0) + mod(floor(vUv.y * px.y), 2.0) * 2.0) / 4.0 - 0.375;
          col = floor(c0 * 4.0 + dth + 0.5) / 4.0;
          col = pow(max(col, 0.0), vec3(0.9));
        } else if (uMode == 14) {                  // glitch: block shifts, tears, split channels
          float blk = floor(uv.y * 24.0);
          float rnd = hash(vec2(blk, floor(uTime * 9.0)));
          float shift = (rnd > 0.86 ? (rnd - 0.86) * 0.8 : 0.0) * (hash(vec2(floor(uTime * 9.0), 1.0)) - 0.5);
          uv.x += shift;
          float tear = step(0.985, hash(vec2(floor(uTime * 15.0), 2.0)));
          uv.y += tear * (hash(vec2(floor(uTime * 15.0), 3.0)) - 0.5) * 0.1;
          vec2 d = vec2(0.012 + 0.03 * tear, 0.0);
          col = vec3(texture2D(tDiffuse, uv + d).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d).b);
          if (rnd > 0.95) col = col.gbr * 1.2;
          col *= 0.94 + 0.06 * sin(uv.y * uRes.y * 1.5);
          col += (hash(uv * uRes + uTime) - 0.5) * 0.06;
        } else if (uMode == 15) {                  // kaleidoscope: six mirrors, slowly turning
          vec2 c = vUv - 0.5; c.x *= uRes.x / uRes.y;
          float a = atan(c.y, c.x) + uTime * 0.08, r = length(c);
          float seg = 3.14159265 / 3.0;
          a = mod(a, seg * 2.0); a = abs(a - seg);
          vec2 p = vec2(cos(a), sin(a)) * r; p.x /= uRes.x / uRes.y;
          uv = clamp(p + 0.5, 0.0, 1.0);
          col = texture2D(tDiffuse, uv).rgb;
          col = mix(vec3(luma(col)), col, 1.3);
        } else if (uMode == 16) {                  // lomo: cross-processed, saturated, soft dark corners
          col = texture2D(tDiffuse, uv).rgb;
          col = pow(max(col, 0.0), vec3(0.92, 1.05, 1.15));
          float l = luma(col);
          col = mix(vec3(l), col, 1.55);
          col += vec3(0.05, 0.02, -0.06) * (1.0 - l) + vec3(0.1, 0.0, 0.04) * l;
          col = (col - 0.5) * 1.25 + 0.5;
          vec2 cc = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
          col = mix(col, blur5(uv, 5.0), smoothstep(0.35, 0.75, length(cc)));
          col *= vignette(uv, 1.1);
        } else if (uMode == 17) {                  // 3D glasses: red left eye, cyan right
          vec2 d = vec2(0.008, 0.0);
          vec3 L = texture2D(tDiffuse, uv - d).rgb, Rr = texture2D(tDiffuse, uv + d).rgb;
          col = vec3(luma(L) * 1.05, Rr.g, Rr.b);
        } else if (uMode == 18) {                  // pencil sketch: ink lines and hatching on paper
          float e = smoothstep(0.08, 0.4, edge(uv, 1.2));
          float paper = 0.93 + 0.05 * hash(uv * uRes * 0.35);
          float dark = 1.0 - luma(texture2D(tDiffuse, uv).rgb) * 1.6;
          float hatch = step(0.55, fract((vUv.x * uRes.x + vUv.y * uRes.y) / 6.0)) * smoothstep(0.3, 0.9, dark);
          col = vec3(paper) * (1.0 - e * 0.85) * (1.0 - hatch * 0.32) * vec3(1.0, 0.98, 0.94);
        } else if (uMode == 19) {                  // old TV: curved tube, phosphor triads, rounded mask
          vec2 c = vUv - 0.5; c *= 1.0 + 0.12 * dot(c, c); uv = c + 0.5;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          vec2 q = abs(uv - 0.5) * 2.0;
          float mask = 1.0 - smoothstep(0.985, 1.0, length(pow(q, vec2(8.0))));
          vec3 c0 = chroma(uv, 0.004);
          float ph = mod(floor(vUv.x * uRes.x), 3.0);
          vec3 tri = ph < 1.0 ? vec3(1.2, 0.7, 0.7) : ph < 2.0 ? vec3(0.7, 1.2, 0.7) : vec3(0.7, 0.7, 1.2);
          col = c0 * tri;
          col *= 0.8 + 0.2 * sin(vUv.y * uRes.y * 3.14159);
          col *= 0.97 + 0.03 * sin(uTime * 120.0);
          col = col * mask * vignette(uv, 0.5) + vec3(0.01, 0.012, 0.015) * mask;
        } else if (uMode == 20) {                  // underwater: wavy, blue-green, caustics, bubbles
          uv += vec2(sin(uv.y * 22.0 + uTime * 1.6), cos(uv.x * 18.0 + uTime * 1.3)) * 0.006;
          vec3 c0 = blur5(uv, 1.5);
          float depth = 1.0 - uv.y;
          col = c0 * vec3(0.55, 0.85, 1.0);
          col = mix(col, vec3(0.02, 0.12, 0.2), 0.3 + 0.3 * depth);
          float ca = sin(uv.x * 40.0 + uTime * 1.2 + sin(uv.y * 30.0 - uTime)) * sin(uv.y * 35.0 - uTime * 0.9);
          col += vec3(0.1, 0.25, 0.3) * smoothstep(0.5, 1.0, ca) * (0.4 + 0.6 * (1.0 - depth));
          vec2 bg = vec2(uv.x * 30.0, uv.y * 30.0 - uTime * 1.5); vec2 bid = floor(bg);
          float bh = hash(bid);
          vec2 boff = (vec2(hash(bid + 1.0), hash(bid + 2.0)) - 0.5) * 0.5;
          float bub = step(0.97, bh) * smoothstep(0.18, 0.05, length(fract(bg) - 0.5 - boff));
          col += bub * 0.5;
        } else if (uMode == 21) {                  // cyberpunk: teal shadows, magenta highs, neon glow
          vec3 c0 = texture2D(tDiffuse, uv).rgb;
          float l = luma(c0);
          vec3 shadow = vec3(0.0, 0.7, 0.9), high = vec3(1.0, 0.2, 0.75);
          col = mix(c0, mix(shadow, high, smoothstep(0.15, 0.85, l)) * (0.3 + l), 0.55);
          col += blur5(uv, 8.0) * 0.55 * smoothstep(0.35, 1.0, l);
          col *= 0.92 + 0.08 * sin(uv.y * uRes.y * 0.7 + uTime * 6.0);
          col *= vignette(uv, 0.55);
        } else if (uMode == 22) {                  // 16 mm: 4:3, sepia, gate weave, flicker, scratches, dust
          float bar = (1.0 - (4.0 / 3.0) / (uRes.x / uRes.y)) * 0.5;
          if (bar > 0.0 && (vUv.x < bar || vUv.x > 1.0 - bar)) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          float fr = floor(uTime * 24.0);
          uv += vec2(hash(vec2(fr, 0.0)) - 0.5, hash(vec2(fr, 1.0)) - 0.5) * 0.004;
          float l = luma(texture2D(tDiffuse, uv).rgb);
          col = vec3(l) * vec3(1.0, 0.86, 0.66) * (0.85 + 0.15 * hash(vec2(fr, 7.0)));
          float sx = hash(vec2(floor(uTime * 6.0), 3.0));
          col += step(abs(uv.x - sx), 0.0012) * 0.5 * step(0.6, hash(vec2(floor(uTime * 6.0), 4.0)));
          float dust = step(0.9985, hash(floor(uv * uRes / 3.0) + fr));
          col *= 1.0 - dust * 0.9;
          col += (hash(uv * uRes + uTime) - 0.5) * 0.14;
          col *= vignette(uv, 1.0);
        } else if (uMode == 23) {                  // miniature: tilt-shift blur bands, candy colour
          float band = abs(vUv.y - 0.5);
          float b = smoothstep(0.12, 0.45, band);
          vec3 c0 = texture2D(tDiffuse, uv).rgb;
          vec3 bl = blur5(uv, 5.0) * 0.5 + blur5(uv, 10.0) * 0.5;
          col = mix(c0, bl, b);
          col = mix(vec3(luma(col)), col, 1.5);
          col = (col - 0.5) * 1.1 + 0.5;
        } else if (uMode == 24) {                  // infrared film: foliage white, skies black, glowing whites
          vec3 c0 = texture2D(tDiffuse, uv).rgb;
          float ir = c0.g * 1.4 + c0.r * 0.6 - c0.b * 0.5;
          col = vec3(clamp(ir, 0.0, 1.5)) * vec3(1.0, 0.92, 0.85) + blur5(uv, 6.0).g * 0.3;
          col = pow(max(col, 0.0), vec3(0.9));
          col *= vignette(uv, 0.4);
        } else {
          col = texture2D(tDiffuse, uv).rgb;
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  return pass;
}
