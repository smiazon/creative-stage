// The PIXMOB logo (assets/pixmob-logo.png, white on clear), for the signs drawn
// on canvases: the arena's jumbotron and the stadium's boards. It loads once;
// a sign drawn before it arrives draws the plain word, then redraws itself
// with the logo (onLogo).
export const LOGO_ASPECT = 871 / 136;   // width / height of the trimmed artwork
const img = new Image();
img.src = './assets/pixmob-logo.png';
const waiting = [];
img.onload = () => { for (const f of waiting.splice(0)) f(); };
export const logoReady = () => img.complete && img.naturalWidth > 0;
export function onLogo(fn) { if (logoReady()) fn(); else waiting.push(fn); }

// the logo centred at (cx, cy), `h` tall, with a soft coloured glow; returns its width
export function drawLogo(g, cx, cy, h, { glow = '#8fa0ff', blur = h * 0.25 } = {}) {
  const w = h * LOGO_ASPECT;
  g.save();
  if (logoReady()) {
    g.shadowColor = glow;
    g.shadowBlur = blur;
    g.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    g.shadowBlur = 0;
    g.drawImage(img, cx - w / 2, cy - h / 2, w, h);   // a second pass: crisp letters over the glow
  } else {
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${Math.round(h * 1.05)}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    g.fillText('PIXMOB', cx, cy);
  }
  g.restore();
  return w;
}
