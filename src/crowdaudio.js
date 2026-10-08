// Crowd audio — pure Web Audio synthesis, no assets, no fetch.
//
// initCrowdAudio() -> { play(name), stop() }
//   play('roar')  ~4s stadium roar (layered filtered noise, breathing LFO)
//   play('ole')   ~6s "Olé, Olé Olé Olé" chant (formant-filtered saw stack
//                 over a crowd-noise bed)
//   play('clap')  ~4s rhythmic stadium clap at 132bpm (jittered noise bursts)
//   stop()        fades every live one-shot out over 0.3s
//
// The AudioContext is created lazily on the first play() call — play() is
// always driven from a click handler, so the autoplay policy is satisfied.
// Each one-shot is a self-contained scheduled graph parented to its own gain
// node; when its clock runs out it disconnects itself. Overlapping play()
// calls simply layer.

export function initCrowdAudio() {
  let ctx = null;          // AudioContext, lazily created
  let master = null;       // master gain ~0.5 -> destination
  let noiseBuf = null;     // shared 2s white-noise buffer
  const live = new Set();  // active one-shots: { gain, sources[], timer }

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      // 2 seconds of white noise, reused by every layer (loop for beds)
      const n = Math.floor(ctx.sampleRate * 2);
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Bookkeeping wrapper: one gain node per shot, auto-cleanup after `dur`s.
  function openShot(dur) {
    const gain = ctx.createGain();
    gain.connect(master);
    const shot = { gain, sources: [], timer: 0 };
    shot.timer = setTimeout(() => closeShot(shot), (dur + 0.2) * 1000);
    live.add(shot);
    return shot;
  }

  function closeShot(shot) {
    if (!live.has(shot)) return;
    live.delete(shot);
    clearTimeout(shot.timer);
    for (const s of shot.sources) {
      try { s.stop(); } catch (e) { /* already stopped */ }
    }
    // let tails through the gain node die before disconnecting
    setTimeout(() => { try { shot.gain.disconnect(); } catch (e) {} }, 50);
  }

  function noiseSource(shot, loop) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = !!loop;
    shot.sources.push(src);
    return src;
  }

  // Crowd-noise bed: looped noise -> bandpass -> gain envelope.
  // Returns the bed gain so callers can shape swells on top.
  function crowdBed(shot, t0, dur, level, { freq = 700, q = 0.5 } = {}) {
    const src = noiseSource(shot, true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(level, t0 + 0.4);
    g.gain.setValueAtTime(level, t0 + dur - 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(shot.gain);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    return g;
  }

  // ---- 'roar' ~4s ------------------------------------------------------
  function playRoar() {
    const t0 = ctx.currentTime + 0.02;
    const DUR = 4.0;
    const shot = openShot(DUR);

    // main body: bandpass noise swelling 0 -> peak over 0.8s, then decaying
    const body = noiseSource(shot, true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(400, t0);
    bp.frequency.exponentialRampToValueAtTime(1200, t0 + 0.8);
    bp.frequency.exponentialRampToValueAtTime(600, t0 + DUR);
    const bodyG = ctx.createGain();
    bodyG.gain.setValueAtTime(0.0001, t0);
    bodyG.gain.exponentialRampToValueAtTime(0.9, t0 + 0.8);
    bodyG.gain.exponentialRampToValueAtTime(0.0001, t0 + DUR);
    body.connect(bp).connect(bodyG).connect(shot.gain);
    body.start(t0); body.stop(t0 + DUR + 0.05);

    // LFO breathing on the body filter frequency (±120Hz at ~1.7Hz)
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1.7;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 120;
    lfo.connect(lfoG).connect(bp.frequency);
    lfo.start(t0); lfo.stop(t0 + DUR + 0.05);
    shot.sources.push(lfo);

    // low rumble: lowpass 200Hz, slower swell, longer hold
    const rum = noiseSource(shot, true);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 200;
    const rumG = ctx.createGain();
    rumG.gain.setValueAtTime(0.0001, t0);
    rumG.gain.exponentialRampToValueAtTime(0.7, t0 + 1.1);
    rumG.gain.exponentialRampToValueAtTime(0.0001, t0 + DUR);
    rum.connect(lp).connect(rumG).connect(shot.gain);
    rum.start(t0); rum.stop(t0 + DUR + 0.05);

    // bright splash: highpass 3kHz, quick in, short (~1.6s)
    const spl = noiseSource(shot, true);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const splG = ctx.createGain();
    splG.gain.setValueAtTime(0.0001, t0);
    splG.gain.exponentialRampToValueAtTime(0.28, t0 + 0.5);
    splG.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
    spl.connect(hp).connect(splG).connect(shot.gain);
    spl.start(t0); spl.stop(t0 + 1.7);
  }

  // ---- 'ole' ~6s -------------------------------------------------------
  // Massed-voices note: 6 detuned saws -> two parallel formant bandpasses
  // (~800Hz / ~1150Hz, Q 5) -> lowpass -> per-syllable gain envelope.
  function oleNote(shot, tAt, freq, dur, level) {
    const mix = ctx.createGain();
    mix.gain.value = 1 / 6;
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass'; f1.frequency.value = 800; f1.Q.value = 5;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2400;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, tAt);
    env.gain.exponentialRampToValueAtTime(level, tAt + 0.06);   // 60ms attack
    env.gain.setValueAtTime(level, tAt + dur);
    env.gain.exponentialRampToValueAtTime(0.0001, tAt + dur + 0.15); // 150ms rel
    mix.connect(f1).connect(lp);
    mix.connect(f2).connect(lp);
    lp.connect(env).connect(shot.gain);
    for (let i = 0; i < 6; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = (Math.random() * 2 - 1) * 25;   // ±25 cents
      osc.connect(mix);
      osc.start(tAt);
      osc.stop(tAt + dur + 0.2);
      shot.sources.push(osc);
    }
  }

  function playOle() {
    const t0 = ctx.currentTime + 0.02;
    const DUR = 6.0;
    const shot = openShot(DUR);

    // quiet crowd bed under the whole chant
    const bed = crowdBed(shot, t0, DUR, 0.3, { freq: 800, q: 0.5 });

    // "Olé, ... Olé, Olé, Olé" — roughly in D
    const A3 = 220.0, D4 = 293.66, E4 = 329.63, FS4 = 369.99;
    const V = 0.5; // chant level: kept under the bed so it reads as a crowd
    oleNote(shot, t0 + 0.0, A3, 0.35, V * 0.8);  // O-
    oleNote(shot, t0 + 0.4, D4, 0.5, V);         // -lé  (long)
    oleNote(shot, t0 + 1.3, D4, 0.4, V);         // Olé
    oleNote(shot, t0 + 2.0, E4, 0.4, V);         // Olé
    oleNote(shot, t0 + 2.7, FS4, 0.7, V * 1.1);  // Olé  (held)

    // crowd swell to finish
    bed.gain.setValueAtTime(0.3, t0 + 3.6);
    bed.gain.exponentialRampToValueAtTime(0.85, t0 + 4.6);
    bed.gain.exponentialRampToValueAtTime(0.0001, t0 + DUR);
  }

  // ---- 'clap' ~4s --------------------------------------------------------
  function clapBurst(shot, tAt) {
    const src = noiseSource(shot, false);
    // random offset into the noise buffer so bursts don't phase-stack
    const off = Math.random() * 1.5;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500 + Math.random() * 1500;   // 1.5–3kHz
    bp.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, tAt);
    g.gain.exponentialRampToValueAtTime(0.5 + Math.random() * 0.3, tAt + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, tAt + 0.02);   // 20ms burst
    src.connect(bp).connect(g).connect(shot.gain);
    src.start(tAt, off, 0.03);
  }

  function playClap() {
    const t0 = ctx.currentTime + 0.05;
    const DUR = 4.0;
    const shot = openShot(DUR);

    // crowd bed underneath, quiet
    crowdBed(shot, t0, DUR, 0.22, { freq: 600, q: 0.5 });

    // the classic slow clap: 132bpm, every beat for 8 beats,
    // each beat = ~8 bursts jittered ±25ms ("many hands")
    const beat = 60 / 132;
    for (let b = 0; b < 8; b++) {
      const tb = t0 + b * beat;
      for (let h = 0; h < 8; h++) {
        clapBurst(shot, tb + (Math.random() * 2 - 1) * 0.025);
      }
    }
  }

  const shots = { roar: playRoar, ole: playOle, clap: playClap };

  function play(name) {
    const fn = shots[name];
    if (!fn) return;
    ensureCtx();
    fn();
  }

  function stop() {
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const shot of Array.from(live)) {
      const g = shot.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.3);      // 0.3s fade-out
      clearTimeout(shot.timer);
      shot.timer = setTimeout(() => closeShot(shot), 350);
    }
  }

  // --- ambience loop -----------------------------------------------------------
  // The 20-minute crowd bed. No audio ships with the sim: drop a file at
  // arena/assets/crowd-loop.mp3 and this plays it, looping, at bed level.
  let loopEl = null;
  async function playLoop() {
    if (!loopEl) {
      loopEl = new Audio('./assets/crowd-loop.mp3');
      loopEl.loop = true;
      loopEl.volume = 0.38;
    }
    try {
      await loopEl.play();
      return true;
    } catch (e) {
      return false;   // file missing or blocked — caller shows the hint
    }
  }
  function stopLoop() {
    loopEl?.pause();
  }

  return { playLoop, stopLoop, play, stop };
}
