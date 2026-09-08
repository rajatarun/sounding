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

/**
 * Nominal gain of the calibration reference, before the panner and master.
 * Deliberately the same number the old direct-connected tone used — this change
 * is about which path it travels, not how loud it is.
 */
const CALIBRATION_GAIN = 0.05;

/**
 * The radius every positioned voice is placed at, and therefore the level
 * plane the whole mix is referenced to.
 *
 * This is load-bearing in a way it did not look. The panner's inverse distance
 * model gives `refDistance / (refDistance + rolloff * (d - refDistance))`, so
 * at radius 6 with refDistance 1 every positioned voice is attenuated by a flat
 * 1/6 — about -15.6 dB — before it reaches the bus. A voice that skips the
 * panner, or sits at radius 1, does not pay that toll and is therefore 15.6 dB
 * louder than everything around it, for no reason anyone chose.
 *
 * See `nonPositioned` and `referenceTrim`: both exist so that "not positioned"
 * and "close" are spatial statements rather than accidental level changes.
 */
const REFERENCE_RADIUS = 6;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bus = null;
    this.nonPositioned = null;
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

    // Where a voice that is deliberately *not* positioned belongs — the cave's
    // own breath in level 4, the forge bed in level 9. Trimmed to the same
    // plane a positioned voice arrives on, so choosing not to place a sound in
    // the room does not silently make it the loudest thing in the mix.
    this.nonPositioned = this.ctx.createGain();
    this.nonPositioned.gain.value = this.distanceGain(REFERENCE_RADIUS);
    this.nonPositioned.connect(this.bus);

    this.setListenerYaw(0);
  }

  close() {
    if (this.ctx) {
      try { this.ctx.close(); } catch (e) { /* already closed */ }
      this.ctx = null;
    }
  }

  /**
   * The calibration reference — the tone the Seeker sets device volume against.
   *
   * It travels the game's own chain (voice -> panner -> bus -> master) rather
   * than connecting straight to the destination the way the calibration screen
   * used to. A reference on a different signal path calibrates nothing: the
   * panner's inverse distance model at radius 6 (refDistance 1, rolloff 1) is a
   * flat 1/6 on every positioned voice, ~-15.6 dB, and master is a further 0.5.
   * A tone that skips both is ~21.6 dB louder than a game cue of the same
   * nominal gain, so "just barely audible" was being set against something the
   * game never plays.
   *
   * Placed off-centre because the first sound the game makes should be audibly
   * spatial — the medium is the product, and this used to be mono.
   *
   * What CALIBRATION_GAIN means on the shared path, MEASURED rather than
   * computed: level 1's aligned cue on trial 1 renders ~15.9 dB above this
   * reference and its misaligned floor ~5.9 dB below it — a span of ~21.8 dB.
   * This used to read "~20 dB" and "~8 dB", which is the arithmetic on the
   * gain constants (0.52 and 0.02 against 0.05) and is not what leaves the
   * engine. The difference is timbre: level 1 raises the draft's bandpass Q
   * from 0.6 to 3.8 as the Seeker aligns, and narrowing a constant-peak
   * bandpass gives back about 6 dB of the level the gain curve just paid for.
   *
   * The lesson is larger than this docstring. On a broadband source a gain
   * constant does not predict a level, so any claim about this mix has to be
   * rendered and read rather than multiplied out. `npm run test:audio` renders
   * these two figures and prints them; that is where the numbers above came
   * from and how they stay true.
   *
   * The shape is the intended one — near-inaudible misaligned, clearly present
   * aligned — and the shape is what the suite asserts. The absolute values are
   * still unvalidated against an ear: they want a quiet room and real
   * headphones, like everything in constants.js.
   *
   * Note this raises nothing: master.gain and every per-level constant are
   * untouched. It makes the reference honest, which is the opposite edit.
   */
  calibrationTone(bearingDeg = 40) {
    if (!this.ctx) this.init();
    this.setListenerYaw(0);
    // Same brown noise and same bandpass the screen built by hand, so only the
    // routing changes and the tone's character is preserved exactly.
    const v = this.voice(bearingDeg, {
      color: 'brown', filterType: 'bandpass', freq: 500, Q: 0.7, gain: CALIBRATION_GAIN,
    });
    return {
      stop: () => { try { v.src.stop(); } catch (e) { /* already stopped */ } },
    };
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

  /**
   * The panner's own inverse-distance gain at a radius — the toll a voice pays
   * for being out in the room. Mirrors makePanner's distanceModel settings.
   */
  distanceGain(radius) {
    const ref = 1;
    const rolloff = 1;
    return ref / (ref + rolloff * (Math.max(radius, ref) - ref));
  }

  /**
   * What to multiply a voice by so that placing it nearer than the reference
   * radius changes where it *is* without changing how loud it is.
   *
   * Distance is a spatial parameter in this game, not a volume one — level is
   * a designed channel and carries alignment. A burst at radius 1 was getting
   * a free +15.6 dB on top of whatever gain its level asked for, which is how
   * the loudest single event in the First Narrowing ended up being the one
   * that fires when the Seeker errs.
   */
  referenceTrim(radius) {
    return this.distanceGain(REFERENCE_RADIUS) / this.distanceGain(radius);
  }

  /**
   * Moves an already-placed panner to a new bearing.
   *
   * Ramped, never assigned. Writing `positionX.value` every frame steps the
   * HRTF convolution discontinuously, which on a slow, quiet source is audible
   * as zipper noise — the worst possible artefact for a game mixed this faint.
   * The time constant is short enough to track a drift and long enough to take
   * the click off a gust.
   */
  movePanner(panner, deg, radius = REFERENCE_RADIUS, timeConstant = 0.03) {
    const rad = (deg * Math.PI) / 180;
    const x = Math.sin(rad) * radius;
    const z = -Math.cos(rad) * radius;
    if (panner.positionX) {
      const now = this.ctx.currentTime;
      panner.positionX.setTargetAtTime(x, now, timeConstant);
      panner.positionZ.setTargetAtTime(z, now, timeConstant);
    } else {
      panner.setPosition(x, 0, z); // legacy Safari: no AudioParams to ramp
    }
  }

  /** Places a panner at a compass bearing (0 = ahead, 90 = right). */
  positionPanner(panner, deg, radius = REFERENCE_RADIUS) {
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

  makePanner(deg, radius = REFERENCE_RADIUS) {
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

  /**
   * A positioned source, with its bearing and its level owned for you.
   *
   * `voice()` hands back raw nodes, which is why every audio defect this
   * project has had was written the same way: the level reached past the
   * engine and had to remember, per frame and by hand, to scale by the trial
   * and to move the panner it had placed. Three levels forgot one, one level
   * forgot the other, and none of it was visible from the interface.
   *
   * A Source cannot forget. `level()` applies audioScale; `bearing()` ramps
   * the panner. New levels should use this and reach for `voice()` only when
   * they genuinely need something it cannot express.
   *
   *   const draft = audio.source(angle, { color: 'brown', freq: 420 });
   *   draft.bearing(s.angle);      // moves the sound, not just the maths
   *   draft.level(0.02 + a * 0.5); // trial scaling applied for you
   */
  source(bearingDeg, opts = {}) {
    const v = this.voice(bearingDeg, opts);
    const engine = this;
    let currentBearing = bearingDeg;
    return {
      nodes: v,
      get angle() { return currentBearing; },
      /** Move the source. Ramped, never assigned — see movePanner. */
      bearing(deg) {
        if (deg === currentBearing) return this;
        currentBearing = deg;
        engine.movePanner(v.panner, deg);
        return this;
      },
      /** Set level *before* trial scaling; the scaling is applied here. */
      level(value, timeConstant = 0.25) {
        v.gain.gain.setTargetAtTime(
          Math.max(0, value) * engine.audioScale, engine.ctx.currentTime, timeConstant,
        );
        return this;
      },
      /** Shape the voice. A level-invariant channel — prefer it to gain. */
      timbre({ freq, Q }, timeConstant = 0.3) {
        const now = engine.ctx.currentTime;
        if (freq != null) v.filt.frequency.setTargetAtTime(freq, now, timeConstant);
        if (Q != null) v.filt.Q.setTargetAtTime(Q, now, timeConstant);
        return this;
      },
      stop() { try { v.src.stop(); } catch (e) { /* already stopped */ } },
    };
  }

  /**
   * A source that deliberately has no bearing — a room, a bed, a pressure.
   *
   * Routed through `nonPositioned`, so declining to place a sound costs no
   * decibels. Connecting to `this.bus` by hand is the thing this exists to
   * stop; `npm run check` treats that as an error.
   */
  ambient(opts = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[opts.color || 'brown'];
    src.loop = true;

    const filt = this.ctx.createBiquadFilter();
    filt.type = opts.filterType || 'lowpass';
    filt.frequency.value = opts.freq || 400;
    filt.Q.value = opts.Q || 0.7;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;

    src.connect(filt); filt.connect(gain); gain.connect(this.nonPositioned);
    src.start();

    const engine = this;
    return {
      nodes: { src, filt, gain },
      level(value, timeConstant = 0.25) {
        gain.gain.setTargetAtTime(
          Math.max(0, value) * engine.audioScale, engine.ctx.currentTime, timeConstant,
        );
        return this;
      },
      timbre({ freq, Q }, timeConstant = 0.3) {
        const now = engine.ctx.currentTime;
        if (freq != null) filt.frequency.setTargetAtTime(freq, now, timeConstant);
        if (Q != null) filt.Q.setTargetAtTime(Q, now, timeConstant);
        return this;
      },
      stop() { try { src.stop(); } catch (e) { /* already stopped */ } },
    };
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

    const radius = o.distance || REFERENCE_RADIUS;
    const panner = this.makePanner(o.angleDeg || 0, radius);
    src.connect(filt); filt.connect(gain); gain.connect(panner); panner.connect(this.bus);

    const now = this.ctx.currentTime;
    const attack = o.attack != null ? o.attack : 0.01;
    // referenceTrim keeps `distance` a statement about place, not about level.
    const peak = (o.gain != null ? o.gain : 0.5) * this.audioScale * this.referenceTrim(radius);
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
