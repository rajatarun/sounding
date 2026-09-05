/**
 * audio.js — Spatial audio core.
 *
 * All sound in SOUNDING is synthesized at runtime. There are no audio files.
 * Spatialization uses the Web Audio API's HRTF PannerNode, which gives real
 * binaural positioning over headphones.
 *
 * Design constraint (see docs/DESIGN.md § The Trained Ear):
 * cues are mixed deliberately faint. Gain curves here are tuned so a source is
 * near-inaudible when the listener is misaligned and only clearly present at
 * strong alignment. Do not "fix" quietness by raising these values — the
 * quietness is the mechanic.
 */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bus = null;
    this.buffers = {};
    this.audioScale = 1;
  }

  init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    this.buffers = {
      brown: this.makeNoise(4, 'brown'),
      white: this.makeNoise(2, 'white'),
      crackle: this.makeNoise(3, 'crackle'),
    };

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5; // intentionally low; see module header
    this.master.connect(this.ctx.destination);

    // Shared tone-shaping bus. Kept as a seam for per-era colouration
    // (later Narrowings may push this darker/harsher).
    this.bus = this.ctx.createBiquadFilter();
    this.bus.type = 'lowpass';
    this.bus.frequency.value = 13000;
    this.bus.connect(this.master);

    this.setListenerYaw(0);
  }

  close() {
    if (this.ctx) {
      try { this.ctx.close(); } catch (e) { /* already closed */ }
      this.ctx = null;
    }
  }

  /** Sets how loud this trial's cues are overall. See TRIAL_AUDIO_SCALE. */
  setAudioScale(scale) { this.audioScale = scale; }

  makeNoise(seconds, kind) {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(sr * seconds), sr);
    const d = buf.getChannelData(0);

    if (kind === 'brown') {
      // Brown noise: integrated white noise. Reads as wind/air rather than hiss.
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    } else if (kind === 'crackle') {
      // Sparse decaying impulses: embers, footfalls, dry material.
      let env = 0;
      for (let i = 0; i < d.length; i++) {
        if (Math.random() < 0.0025) env = 0.6 + Math.random() * 0.4;
        env *= 0.9;
        d[i] = (Math.random() * 2 - 1) * env;
      }
    } else {
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  /** Places a panner at a compass bearing (0 = ahead, 90 = right). */
  positionPanner(panner, deg, radius = 6) {
    const rad = (deg * Math.PI) / 180;
    const x = Math.sin(rad) * radius;
    const z = -Math.cos(rad) * radius;
    if (panner.positionX) {
      panner.positionX.value = x;
      panner.positionY.value = 0;
      panner.positionZ.value = z;
    } else {
      panner.setPosition(x, 0, z); // legacy Safari
    }
  }

  makePanner(deg, radius) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1;
    p.maxDistance = 20;
    p.rolloffFactor = 1;
    this.positionPanner(p, deg, radius);
    return p;
  }

  /** Rotates the listener. This is what turning the player's head/phone does. */
  setListenerYaw(deg) {
    const rad = (deg * Math.PI) / 180;
    const fx = Math.sin(rad);
    const fz = -Math.cos(rad);
    const L = this.ctx.listener;
    if (L.forwardX) {
      L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
      if (L.positionX) { L.positionX.value = 0; L.positionY.value = 0; L.positionZ.value = 0; }
    } else {
      L.setOrientation(fx, 0, fz, 0, 1, 0); // legacy Safari
      L.setPosition(0, 0, 0);
    }
  }

  /**
   * A continuous positioned drone (wind, drafts).
   * Returns handles so the level can modulate gain/filter each frame.
   */
  voice(angleDeg, opts = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[opts.color || 'brown'];
    src.loop = true;

    const filt = this.ctx.createBiquadFilter();
    filt.type = opts.filterType || 'bandpass';
    filt.frequency.value = opts.freq || 420;
    filt.Q.value = opts.Q || 0.7;

    const gain = this.ctx.createGain();
    gain.gain.value = opts.gain != null ? opts.gain : 0;

    const panner = this.makePanner(angleDeg);

    src.connect(filt); filt.connect(gain); gain.connect(panner); panner.connect(this.bus);
    src.start();

    return { src, filt, gain, panner, angle: angleDeg };
  }

  /** A one-shot positioned sound (rustle, footfall, ember crackle). */
  burst(o = {}) {
    const buf = this.buffers[o.color || 'white'];
    const dur = o.dur || 0.3;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filt = this.ctx.createBiquadFilter();
    filt.type = o.filterType || 'bandpass';
    filt.frequency.value = o.freq || 1000;
    filt.Q.value = o.Q != null ? o.Q : 1;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;

    const panner = this.makePanner(o.angleDeg || 0, o.distance || 6);
    src.connect(filt); filt.connect(gain); gain.connect(panner); panner.connect(this.bus);

    const now = this.ctx.currentTime;
    const attack = o.attack != null ? o.attack : 0.01;
    const peak = (o.gain != null ? o.gain : 0.5) * this.audioScale;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + attack);
    gain.gain.linearRampToValueAtTime(0.0001, now + dur);

    // Random offset avoids an audible repeating signature on short buffers.
    const offset = Math.random() * Math.max(0.01, buf.duration - dur - 0.05);
    try { src.start(now, offset); src.stop(now + dur + 0.05); } catch (e) { /* noop */ }
    src.onended = () => {
      try { src.disconnect(); filt.disconnect(); gain.disconnect(); panner.disconnect(); }
      catch (e) { /* noop */ }
    };
  }
}
