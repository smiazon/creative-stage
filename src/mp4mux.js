// A small MP4 writer for the offline video render (main.js): H.264 video and
// AAC audio, as WebCodecs' encoders hand them over, put into one ordinary
// .mp4 that QuickTime, Premiere and every phone play. All the samples go in
// one 'mdat' (the video, then the audio); the 'moov' at the end says where
// each one is and when it plays.
//
//   const mux = new Mp4Mux({ width, height, fps, audio: { sampleRate, channels } })
//   mux.addVideo(chunk, meta)   (VideoEncoder output, avc format)
//   mux.addAudio(chunk, meta)   (AudioEncoder output, mp4a.40.2)
//   const blob = mux.finish()

const enc = new TextEncoder();
const u8 = (n) => new Uint8Array(n);
function be(bytes, n) {   // n as big-endian bytes
  const out = u8(bytes);
  for (let i = bytes - 1; i >= 0; i--) { out[i] = n % 256; n = Math.floor(n / 256); }
  return out;
}
const u16 = (n) => be(2, n), u24 = (n) => be(3, n), u32 = (n) => be(4, n), u64 = (n) => be(8, n);
const i32 = (n) => be(4, n < 0 ? 0x100000000 + n : n);
const str = (s) => enc.encode(s);
function cat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = u8(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const box = (type, ...parts) => { const body = cat(parts.flat()); return cat([u32(body.length + 8), str(type), body]); };
const full = (type, version, flags, ...parts) => box(type, u8(1).fill(version), u24(flags), ...parts);
// the identity matrix every track and the movie carry
const MATRIX = cat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);
// an MPEG-4 descriptor: tag, its length in four 7-bit bytes, the body
const desc = (tag, ...parts) => {
  const body = cat(parts.flat()), n = body.length;
  return cat([new Uint8Array([tag, 0x80 | ((n >> 21) & 0x7f), 0x80 | ((n >> 14) & 0x7f), 0x80 | ((n >> 7) & 0x7f), n & 0x7f]), body]);
};

export class Mp4Mux {
  constructor({ width, height, fps = 60, audio = null }) {
    this.w = width; this.h = height; this.fps = fps;
    this.vscale = 90000;   // video ticks a second
    this.video = [];       // { data, pts (ticks), key }
    this.avcC = null;
    this.audio = audio ? { sr: audio.sampleRate, ch: audio.channels, chunks: [], asc: null } : null;
  }
  addVideo(chunk, meta) {
    if (meta?.decoderConfig?.description && !this.avcC) this.avcC = new Uint8Array(meta.decoderConfig.description.slice ? meta.decoderConfig.description.slice(0) : meta.decoderConfig.description);
    const data = u8(chunk.byteLength);
    chunk.copyTo(data);
    this.video.push({ data, pts: Math.round((chunk.timestamp * this.vscale) / 1e6), key: chunk.type === 'key' });
  }
  addAudio(chunk, meta) {
    if (!this.audio) return;
    if (meta?.decoderConfig?.description && !this.audio.asc) this.audio.asc = new Uint8Array(meta.decoderConfig.description.slice ? meta.decoderConfig.description.slice(0) : meta.decoderConfig.description);
    const data = u8(chunk.byteLength);
    chunk.copyTo(data);
    const dur = chunk.duration ? Math.round((chunk.duration * this.audio.sr) / 1e6) : 1024;
    this.audio.chunks.push({ data, dur: dur || 1024 });
  }

  finish() {
    if (!this.video.length || !this.avcC) throw new Error('No video was encoded');
    const frameTicks = Math.round(this.vscale / this.fps);
    // decode order is the order the encoder gave; decode times are the
    // presentation times sorted, shifted so no frame shows before it decodes
    const V = this.video, ptsSorted = V.map((s) => s.pts).sort((a, b) => a - b);
    let shift = 0;
    for (let i = 0; i < V.length; i++) shift = Math.max(shift, ptsSorted[i] - V[i].pts);
    const dts = V.map((_, i) => ptsSorted[i] - shift);
    const offs = V.map((s, i) => s.pts - dts[i]);
    const reordered = offs.some((o) => o !== 0);
    const vDur = ptsSorted[ptsSorted.length - 1] + frameTicks - ptsSorted[0];
    const A = this.audio && this.audio.chunks.length ? this.audio : null;
    const aDur = A ? A.chunks.reduce((n, c) => n + c.dur, 0) : 0;
    const movieMs = Math.max(Math.round((vDur * 1000) / this.vscale), A ? Math.round((aDur * 1000) / A.sr) : 0);

    const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str('avc1'), str('mp41'));
    const vBytes = V.reduce((n, s) => n + s.data.length, 0);
    const aBytes = A ? A.chunks.reduce((n, c) => n + c.data.length, 0) : 0;
    const mdatHead = cat([u32(1), str('mdat'), u64(16 + vBytes + aBytes)]);   // 64-bit size: a 4K video runs to gigabytes
    const vOffset = ftyp.length + mdatHead.length, aOffset = vOffset + vBytes;

    // runs of equal values, for stts and ctts
    const runs = (list) => {
      const out = [];
      for (const v of list) { const last = out[out.length - 1]; if (last && last[1] === v) last[0]++; else out.push([1, v]); }
      return out;
    };
    const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
    // --- the video track ---
    const avc1 = box('avc1',
      u8(6), u16(1),                                  // reserved, data reference
      u16(0), u16(0), u32(0), u32(0), u32(0),         // pre-defined, reserved
      u16(this.w), u16(this.h), u32(0x00480000), u32(0x00480000), u32(0), u16(1),
      u8(32),                                         // compressor name, empty
      u16(0x0018), u16(0xffff),
      box('avcC', this.avcC),
      box('pasp', u32(1), u32(1)));
    const sttsV = runs(V.map((_, i) => (i + 1 < V.length ? dts[i + 1] - dts[i] : frameTicks)));
    const vStbl = box('stbl',
      full('stsd', 0, 0, u32(1), avc1),
      full('stts', 0, 0, u32(sttsV.length), ...sttsV.map(([n, d]) => [u32(n), u32(d)])),
      reordered ? (() => { const r = runs(offs); return full('ctts', 0, 0, u32(r.length), ...r.map(([n, o]) => [u32(n), u32(o)])); })() : u8(0),
      (() => { const keys = V.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean); return full('stss', 0, 0, u32(keys.length), ...keys.map(u32)); })(),
      full('stsz', 0, 0, u32(0), u32(V.length), ...V.map((s) => u32(s.data.length))),
      full('stsc', 0, 0, u32(1), u32(1), u32(V.length), u32(1)),
      full('co64', 0, 0, u32(1), u64(vOffset)));
    // with reordered frames the first one shows `shift` ticks into the media: start there
    const vEdts = shift > 0 ? box('edts', full('elst', 0, 0, u32(1), u32(Math.round((vDur * 1000) / this.vscale)), i32(shift), u32(0x00010000))) : u8(0);
    const vTrak = box('trak',
      full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(Math.round((vDur * 1000) / this.vscale)), u32(0), u32(0), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(this.w * 65536), u32(this.h * 65536)),
      vEdts,
      box('mdia',
        full('mdhd', 0, 0, u32(0), u32(0), u32(this.vscale), u32(vDur), u16(0x55c4), u16(0)),
        full('hdlr', 0, 0, u32(0), str('vide'), u32(0), u32(0), u32(0), str('VideoHandler\0')),
        box('minf', full('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)), dinf, vStbl)));
    // --- the audio track ---
    let aTrak = u8(0);
    if (A) {
      // AAC-LC's own description, made by hand if the encoder gave none
      const sfi = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000].indexOf(A.sr);
      const asc = A.asc || new Uint8Array([(2 << 3) | ((sfi >= 0 ? sfi : 3) >> 1), (((sfi >= 0 ? sfi : 3) & 1) << 7) | (A.ch << 3)]);
      const esds = full('esds', 0, 0, desc(0x03, u16(2), u8(1),
        desc(0x04, u8(1).fill(0x40), u8(1).fill(0x15), u24(0), u32(320000), u32(256000), desc(0x05, asc)),
        desc(0x06, u8(1).fill(0x02))));
      const mp4a = box('mp4a', u8(6), u16(1), u32(0), u32(0), u16(A.ch), u16(16), u16(0), u16(0), u32(A.sr * 65536), esds);
      const sttsA = runs(A.chunks.map((c) => c.dur));
      const aStbl = box('stbl',
        full('stsd', 0, 0, u32(1), mp4a),
        full('stts', 0, 0, u32(sttsA.length), ...sttsA.map(([n, d]) => [u32(n), u32(d)])),
        full('stsz', 0, 0, u32(0), u32(A.chunks.length), ...A.chunks.map((c) => u32(c.data.length))),
        full('stsc', 0, 0, u32(1), u32(1), u32(A.chunks.length), u32(1)),
        full('co64', 0, 0, u32(1), u64(aOffset)));
      aTrak = box('trak',
        full('tkhd', 0, 3, u32(0), u32(0), u32(2), u32(0), u32(Math.round((aDur * 1000) / A.sr)), u32(0), u32(0), u16(0), u16(1), u16(0x0100), u16(0), MATRIX, u32(0), u32(0)),
        box('mdia',
          full('mdhd', 0, 0, u32(0), u32(0), u32(A.sr), u32(aDur), u16(0x55c4), u16(0)),
          full('hdlr', 0, 0, u32(0), str('soun'), u32(0), u32(0), u32(0), str('SoundHandler\0')),
          box('minf', full('smhd', 0, 0, u16(0), u16(0)), dinf, aStbl)));
    }
    const moov = box('moov',
      full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieMs), u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0), MATRIX, u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(A ? 3 : 2)),
      vTrak, aTrak);
    return new Blob([ftyp, mdatHead, ...V.map((s) => s.data), ...(A ? A.chunks.map((c) => c.data) : []), moov], { type: 'video/mp4' });
  }
}
