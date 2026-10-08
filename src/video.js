// Video-to-orbs source: decodes a local video file into a small pixel
// buffer each frame so the seat orbs can sample it like an LED map.
export class VideoSource {
  constructor(w = 128, h = 96) {
    this.w = w;
    this.h = h;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    this.ctx = c.getContext('2d', { willReadFrequently: true });
    this.data = null;

    this.el = document.createElement('video');
    this.el.muted = true;
    this.el.loop = true;
    this.el.playsInline = true;
    this.url = null;
  }

  load(file) {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(file);
    this.el.srcObject = null;
    this.el.src = this.url;
    this.el.play();
  }

  toggle() {
    if (this.el.paused) this.el.play();
    else this.el.pause();
    return !this.el.paused;
  }

  get active() {
    return this.el.readyState >= 2;
  }

  update() {
    if (this.el.readyState >= 2 && !this.el.paused) {
      // stretch-fit the video onto the arena footprint
      this.ctx.drawImage(this.el, 0, 0, this.w, this.h);
      this.data = this.ctx.getImageData(0, 0, this.w, this.h).data;
    }
  }
}
