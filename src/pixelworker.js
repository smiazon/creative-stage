// Reads a picture back to pixels, off the main thread. Turning a picture the
// graphics card drew (the camera pipeline's output) into bytes means waiting
// for the card to finish; done on the main thread, that wait stalled the room
// whenever hand tracking kept the card busy. Here it only holds up this
// worker. Each frame arrives as an ImageBitmap with the crop to take and the
// size to scale it to; the pixels go back transferred, not copied.
let canvas = null;
let ctx = null;

self.onmessage = (e) => {
  const { id, bitmap, w, h, sx, sy, sw, sh, mirror } = e.data || {};
  if (!bitmap) return;
  try {
    if (!canvas || canvas.width !== w || canvas.height !== h) {
      canvas = new OffscreenCanvas(w, h);
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? w : 0, 0);
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    self.postMessage({ id, pixels: img.data, pw: w, ph: h }, [img.data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  } finally {
    bitmap.close();
  }
};
