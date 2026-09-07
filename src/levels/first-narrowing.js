/**
 * first-narrowing.js — Levels 1–10.
 *
 * THE FIRST NARROWING CONTRACT:
 * No timers. No depleting resources. No fail states. A level ends when the
 * player completes it, and only then. Drifting attention decays progress
 * gently; it never ends the session. Do not add urgency mechanics to any level
 * in this file — urgency belongs to the Third and Fourth Narrowings, and the
 * contrast between them is the point. See docs/DESIGN.md § Presence.
 *
 * LEVEL INTERFACE
 *   id, name, discipline, force
 *   control: 'hold' | 'commit' | 'breathe'
 *   briefing: string (HTML permitted)
 *   actionLine: string          — optional; the plain verb, shown above the
 *                                 briefing to a Seeker who has never finished
 *                                 a trial, then never again
 *   init(state, audio)          — build voices, seed randomness. `state.onboarding`
 *                                 is true only for the first trial anyone ever
 *                                 plays; a level may use it to soften an initial
 *                                 condition, never to change its mechanic
 *   update(state, dt, t, ctx)   — per frame; call ctx.complete() to finish
 *   onCommit(state, ctx)        — only for control: 'commit'
 *   onBreathe(state, held)      — only for control: 'breathe'
 *   cleanup(state)              — stop any oscillators started in init
 *   completionText(state)       — { text, sub }
 *
 * Levels 6-10 pick up the narrative directly after level 5's ember: the tribe
 * has fire now, and these are its first uses (warmth, water, distance-
 * signaling, smelting, defense). Between them they touch Frame and Plumb —
 * the two Disciplines levels 1-5 didn't reach — so by level 10 all five have
 * been exercised mechanically, per DESIGN.md pillars 1 and 5, without the
 * game ever naming one.
 */

import { angleDiff, alignment } from '../engine/input.js';
import { DISCIPLINES, FORCES, DEPTHS } from '../engine/constants.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const FIRST_NARROWING = [
  {
    id: 1,
    name: 'The Absolute Void',
    discipline: DISCIPLINES.TRACE,
    force: FORCES.DRIFT,
    control: 'hold',
    tolerance: 14,     // degrees counted as "aligned"
    holdSeconds: 24,   // sustained presence required
    decaySeconds: 16,  // gentle, not punishing — this is the player's first
                        // level; it should be the most forgiving one, not the
                        // harshest (a 10s decay against a 24s hold made it the
                        // steepest ratio of any First Narrowing level, which
                        // real compass jitter could trip on its own)

    /**
     * The plain verb, before any atmosphere. Shown only to a Seeker who has
     * never finished a trial — after that the prose can carry it alone.
     */
    actionLine: 'Turn until you can hear the draft clearly, then stay with it.',

    /**
     * Cumulative hold, as a percentage, at which the draft resolves further.
     * The same continuous-reveal idea as level 6's depths, at a gentler scale:
     * no new sound arrives, the one sound simply comes into focus. Deliberately
     * fixed and stinger-free — see GameScreen's MARKS for why.
     */
    depthAt: [0, 45, 80],

    briefing:
      'You wake in <b>total darkness</b>. No fire, no torch, no wall to trust. ' +
      'Somewhere in this cave, a single draft of outside air moves — a thread of ' +
      'wind toward the exit.<br><br>Turn slowly. There is no clock here. Let the ' +
      'draft grow clear and close, then simply stay with it. If your attention ' +
      "drifts, that's alright — settle back and continue.",

    init(s, audio) {
      // A Seeker's very first trial starts within a turn or two of the draft,
      // so presence begins to move while they are still learning what moving
      // it feels like. Everything else about the level — tolerance, hold,
      // decay — is untouched, and this never happens again.
      if (s.onboarding) {
        const off = (28 + Math.random() * 24) * (Math.random() < 0.5 ? -1 : 1);
        s.sourceAngle = Math.round((off + 360) % 360);
      } else {
        s.sourceAngle = Math.floor(Math.random() * 360);
      }
      s.hold = 0;
      s.voices = [
        // The draft itself.
        audio.voice(s.sourceAngle, { color: 'brown', filterType: 'bandpass', freq: 420, Q: 0.7, gain: 0 }),
        // Its body: the weight of moving air, heard once you have settled.
        audio.voice(s.sourceAngle, { color: 'brown', filterType: 'lowpass', freq: 180, Q: 0.6, gain: 0 }),
        // Its edge: the fine hiss of outside, the last thing to resolve.
        audio.voice(s.sourceAngle, { color: 'white', filterType: 'highpass', freq: 3200, Q: 0.6, gain: 0 }),
      ];
      s.voice = s.voices[0];
    },

    update(s, dt, t, ctx) {
      const align = alignment(ctx.yaw, s.sourceAngle);
      const now = ctx.audio.ctx.currentTime;

      // Wind wanders naturally so the cue never feels like a test tone.
      const gust = Math.sin(t * 0.25) * 50 + Math.sin(t * 0.7) * 18;

      s.voice.gain.gain.setTargetAtTime(
        (0.02 + Math.pow(align, 2.6) * 0.5) * ctx.audio.audioScale, now, 0.25,
      );
      s.voice.filt.frequency.setTargetAtTime(300 + gust + align * 40, now, 0.3);
      s.voice.filt.Q.setTargetAtTime(0.6 + align * 3.2, now, 0.3);

      // The two supporting layers fade in on cumulative hold, not on time, and
      // they stay gated by alignment — drifting away loses the newest one first.
      for (let i = 1; i < s.voices.length; i++) {
        const open = s.hold >= this.depthAt[i];
        const v = s.voices[i];
        v.gain.gain.setTargetAtTime(
          open ? (0.01 + Math.pow(align, 2.6) * (i === 1 ? 0.16 : 0.07)) * ctx.audio.audioScale : 0,
          now, 0.6,
        );
      }

      const aligned = angleDiff(ctx.yaw, s.sourceAngle) <= this.tolerance;
      s.hold = aligned
        ? Math.min(100, s.hold + (100 / this.holdSeconds) * dt)
        : Math.max(0, s.hold - (100 / this.decaySeconds) * dt);

      ctx.setPresence(s.hold);
      ctx.setOrb(align);
      ctx.setWord(aligned ? 'here' : align > 0.6 ? 'closer' : align > 0.3 ? 'faint' : 'listening');

      if (s.hold >= 100) ctx.complete();
    },

    completionText: () => ({
      text: 'A thread of cold, clean air brushes your face. You stayed with it long enough for the dark to open.',
      sub: 'Presence held.',
    }),
  },

  {
    id: 2,
    name: "The Predator's Whisper",
    discipline: DISCIPLINES.FILTER,
    force: FORCES.DRIFT,
    control: 'commit',
    commitLabel: 'I notice this',

    /** The plain verb for `commit` — the first level that is not a hold. */
    actionLine: 'Turn toward each rhythm you hear, then tap to acknowledge it.',
    tolerance: 20,  // tightened from 28° — wide enough to forgive normal
                    // compass jitter, tight enough that a commit still means
                    // the player located the rhythm, not just faced its
                    // general half of the room
    required: 3,

    briefing:
      'Somewhere nearby, dry leaves stir — and every so often, something moves ' +
      "with a rhythm that isn't wind. There is no danger in this practice, only " +
      'the quiet discipline of telling a true rhythm from ambient noise.<br><br>' +
      'When you sense a rhythmic presence, turn toward it and acknowledge it. ' +
      'If you are mistaken, nothing is lost — simply keep listening.',

    init(s) {
      s.phase = 'idle';
      s.angle = 0;
      s.endsAt = 0;
      s.thuds = 0;
      s.startedAt = 0;
      s.nextAt = 3;
      s.found = 0;
    },

    update(s, dt, t, ctx) {
      if (s.phase === 'idle' && t >= s.nextAt) {
        s.angle = Math.floor(Math.random() * 360);
        if (Math.random() < 0.4) {
          s.phase = 'rhythm'; s.thuds = 0; s.startedAt = t; s.endsAt = t + 2.6;
        } else {
          s.phase = 'leaf'; s.endsAt = t + 0.9;
          ctx.audio.burst({
            angleDeg: s.angle, color: 'white', filterType: 'highpass',
            freq: 2200, Q: 0.8, dur: 0.45, gain: 0.16, attack: 0.02,
          });
        }
      }

      if (s.phase === 'rhythm') {
        // Three evenly spaced footfalls — the regularity IS the tell.
        while (s.thuds < 3 && t - s.startedAt >= s.thuds * 0.46) {
          ctx.audio.burst({
            angleDeg: s.angle, color: 'crackle', filterType: 'lowpass',
            freq: 150, Q: 0.6, dur: 0.22, gain: 0.35, attack: 0.005,
          });
          s.thuds++;
        }
      }

      // A missed event simply passes. No penalty — see file header.
      if (s.phase !== 'idle' && t >= s.endsAt) {
        s.phase = 'idle';
        s.nextAt = t + 4 + Math.random() * 5;
      }

      const active = s.phase === 'rhythm';
      ctx.setOrb(active ? 0.75 : s.phase === 'leaf' ? 0.3 : 0.12, active);
      ctx.setWord(active ? 'a rhythm' : s.phase === 'leaf' ? 'just leaves' : 'listening');
      ctx.setPresence((s.found / this.required) * 100);
    },

    onCommit(s, ctx) {
      if (s.phase !== 'rhythm') { ctx.flash('only the wind'); return; }

      if (angleDiff(ctx.yaw, s.angle) <= this.tolerance) {
        s.found++;
        ctx.audio.burst({
          angleDeg: s.angle, color: 'crackle', filterType: 'highpass',
          freq: 900, dur: 0.4, gain: 0.22,
        });
        s.phase = 'idle';
        s.nextAt = ctx.elapsed + 3;
        ctx.flash('noticed, clearly');
        if (s.found >= this.required) ctx.complete();
      } else {
        s.phase = 'idle';
        ctx.flash('close — keep listening');
      }
    },

    completionText: () => ({
      text: 'Three times you told the true rhythm from the false, calmly, without alarm. The clearing settles back into quiet.',
      sub: 'Signal recognized.',
    }),
  },

  {
    id: 3,
    name: 'Crossing Drafts',
    discipline: DISCIPLINES.FILTER,
    force: FORCES.DRIFT,
    control: 'hold',
    tolerance: 15,     // widened from 12° — clear of typical phone-magnetometer
                       // jitter (±5-8°), so a miss reads as attention drifting,
                       // not sensor noise
    holdSeconds: 22,
    decaySeconds: 13,  // raised to keep the decay:accrual ratio roughly where
                       // it was before the tolerance widened

    briefing:
      'Three passages breathe into this chamber. Two gust and wander. One ' +
      '<b>climbs</b> — its pitch rising steadily, breath by breath, toward the ' +
      'surface.<br><br>There is no rush to choose. Turn until the climbing draft ' +
      'is unmistakable, then simply rest your attention there.',

    init(s, audio) {
      const base = Math.random() * 360;
      s.angles = [
        base,
        (base + 110 + Math.random() * 40) % 360,
        (base + 220 + Math.random() * 40) % 360,
      ];
      s.trueIdx = Math.floor(Math.random() * 3);
      s.hold = 0;
      s.voices = s.angles.map((a, i) => {
        const v = audio.voice(a, {
          color: 'brown', filterType: 'bandpass',
          freq: [380, 520, 660][i], Q: 0.8, gain: 0,
        });
        v.isTrue = i === s.trueIdx;
        v.pulseRate = 0.4 + Math.random() * 0.5;
        v.phase = Math.random() * Math.PI * 2;
        return v;
      });
    },

    update(s, dt, t, ctx) {
      const now = ctx.audio.ctx.currentTime;
      let trueAlign = 0;

      s.voices.forEach((v) => {
        const align = alignment(ctx.yaw, v.angle);
        // Decoys pulse in volume; the true draft holds steady and climbs in pitch.
        const env = v.isTrue
          ? 1
          : 0.35 + 0.65 * (Math.sin(t * v.pulseRate + v.phase) * 0.5 + 0.5);

        v.gain.gain.setTargetAtTime(
          (0.02 + Math.pow(align, 2.6) * 0.45) * env * ctx.audio.audioScale, now, 0.25,
        );
        v.filt.Q.setTargetAtTime(0.6 + align * 3, now, 0.3);

        if (v.isTrue) {
          trueAlign = align;
          const climb = (t % 9) / 9; // audible rise, resets every 9s
          v.filt.frequency.setTargetAtTime(320 + climb * 520, now, 0.2);
        }
      });

      const aligned = angleDiff(ctx.yaw, s.angles[s.trueIdx]) <= this.tolerance;
      s.hold = aligned
        ? Math.min(100, s.hold + (100 / this.holdSeconds) * dt)
        : Math.max(0, s.hold - (100 / this.decaySeconds) * dt);

      ctx.setPresence(s.hold);
      ctx.setOrb(trueAlign);
      ctx.setWord(aligned ? 'here' : trueAlign > 0.6 ? 'closer' : 'listening');

      if (s.hold >= 100) ctx.complete();
    },

    completionText: () => ({
      text: 'One breath never faltered. You rested with it past stone and silence, and the air turned sharp with the smell of outside.',
      sub: 'The climbing current found.',
    }),
  },

  {
    id: 4,
    name: 'The Sound of Breath',
    discipline: DISCIPLINES.BALANCE,
    force: FORCES.FLOW,
    control: 'breathe',

    /** The plain verb for `breathe` — the first level with no steering at all. */
    actionLine: 'Hold the button while the wind rises; release as it falls.',

    briefing:
      'A door hides in the rock, sealed by nothing but rhythm. The cave itself is ' +
      '<b>breathing</b> — a slow swell and fade in the air.<br><br>There is no ' +
      'deadline to this. Hold as you breathe in while the wind rises, release as ' +
      'you breathe out while it falls. Let two rhythms become one, at whatever ' +
      'pace that takes.',

    init(s, audio) {
      // Period sits at a comfortable human breath, NOT a literal metronome
      // tempo — a faster cycle reads as a reflex test rather than breathing.
      s.period = 5.5 + Math.random() * 1.5;
      s.sync = 0;
      s.held = false;

      const c = audio.ctx;
      const osc = c.createOscillator(); osc.type = 'sine'; osc.frequency.value = 110;
      const oscGain = c.createGain(); oscGain.gain.value = 0.04;
      const noise = c.createBufferSource(); noise.buffer = audio.buffers.brown; noise.loop = true;
      const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 400;
      const gain = c.createGain(); gain.gain.value = 0.1;

      osc.connect(oscGain); oscGain.connect(gain);
      noise.connect(filt); filt.connect(gain);
      // The cave's breath is the room, so it is rightly not placed at a
      // bearing — but connecting past the panner also skipped its distance
      // attenuation, making "unpositioned" mean "+15.6 dB" by accident.
      gain.connect(audio.nonPositioned);
      osc.start(); noise.start();

      // Resonance tone: rises only as the player syncs. The reward is harmonic.
      const res = c.createOscillator(); res.type = 'sine'; res.frequency.value = 220;
      const resGain = c.createGain(); resGain.gain.value = 0;
      res.connect(resGain); resGain.connect(audio.nonPositioned); res.start();

      s.nodes = { osc, noise, filt, gain, res, resGain };
    },

    update(s, dt, t, ctx) {
      const now = ctx.audio.ctx.currentTime;
      const target = Math.sin((2 * Math.PI * t) / s.period);
      const matched = (target >= 0) === s.held;

      // Slow accrual: syncing should take a minute or more of real breathing.
      s.sync = clamp(s.sync + (matched ? 9 * dt : -5 * dt), 0, 100);

      s.nodes.gain.gain.setTargetAtTime(
        (0.07 + Math.abs(target) * 0.13) * ctx.audio.audioScale, now, 0.15,
      );
      s.nodes.filt.frequency.setTargetAtTime(280 + Math.abs(target) * 450, now, 0.15);
      // Scales with the trial like every other voice. It did not, and it is the
      // one sound the Seeker earns — so trial 3 asked for a deeper kind of
      // listening while the reward for it arrived at full strength regardless.
      s.nodes.resGain.gain.setTargetAtTime(
        (s.sync / 100) * 0.2 * ctx.audio.audioScale, now, 0.25,
      );

      ctx.setPresence(s.sync);
      ctx.setOrb(s.sync / 100);
      ctx.setWord(s.sync > 75 ? 'almost one breath' : matched ? 'in rhythm' : 'settling in');

      if (s.sync >= 100) ctx.complete();
    },

    onBreathe(s, held) { s.held = held; },

    cleanup(s) {
      if (!s.nodes) return;
      try { s.nodes.osc.stop(); s.nodes.noise.stop(); s.nodes.res.stop(); }
      catch (e) { /* already stopped */ }
    },

    completionText: () => ({
      text: "Your rhythm and the cave's become the same sound. Somewhere ahead, stone gives way.",
      sub: 'Rhythm matched.',
    }),
  },

  {
    id: 5,
    name: 'The Unlit Hearth',
    discipline: DISCIPLINES.TRACE,
    force: FORCES.IGNITION,
    control: 'hold',
    tolerance: 16,
    holdSeconds: 26,
    decaySeconds: 45, // very forgiving; the ember dims slowly

    briefing:
      'A dead ember waits in a blind hollow, one spark from catching. You cannot ' +
      'see it — only hear its faint, dying crackle.<br><br>Turn to face it and ' +
      'simply stay there, unhurried. Feed it steadily, for as long as it takes, ' +
      'and the tribe has its first fire.',

    init(s) {
      s.emberAngle = Math.floor(Math.random() * 360);
      s.spark = 0;
      s.lastCrackle = 0;
    },

    update(s, dt, t, ctx) {
      const align = alignment(ctx.yaw, s.emberAngle);

      // Crackles quicken and brighten as you face it — the only cue you get.
      if (t - s.lastCrackle >= 1.0 - align * 0.5) {
        ctx.audio.burst({
          angleDeg: s.emberAngle, color: 'crackle', filterType: 'highpass',
          freq: 1300 + Math.random() * 800, Q: 1, dur: 0.28,
          gain: 0.03 + align * 0.32, attack: 0.01,
        });
        s.lastCrackle = t;
      }

      const aligned = angleDiff(ctx.yaw, s.emberAngle) <= this.tolerance;
      s.spark = aligned
        ? Math.min(100, s.spark + (100 / this.holdSeconds) * dt)
        : Math.max(0, s.spark - (100 / this.decaySeconds) * dt);

      ctx.setPresence(s.spark);
      ctx.setOrb(align);
      ctx.setWord(s.spark > 70 ? 'it catches' : aligned ? 'steady' : 'faint');

      if (s.spark >= 100) {
        ctx.audio.burst({
          angleDeg: s.emberAngle, color: 'crackle', filterType: 'lowpass',
          freq: 2000, dur: 0.8, gain: 0.42, attack: 0.02,
        });
        ctx.complete();
      }
    },

    completionText: () => ({
      text: 'The ember catches, flares, and holds. For the first time in this dark, you can see your own hands.',
      sub: 'The tribe has fire.',
    }),
  },

  {
    id: 6,
    name: 'The Buried Warmth',
    discipline: DISCIPLINES.PLUMB,
    // Closes this Discipline: see newlyRevealedDiscipline in progress.js.
    revealsDiscipline: true,
    force: FORCES.MASS,
    control: 'hold',
    tolerance: 15,
    holdSeconds: 35,
    decaySeconds: 14,
    // Cumulative hold, as a percentage, at which each successive depth
    // (DEPTHS: Shell, Current, Weather, Lattice, Core) reveals itself.
    depthAt: [0, 20, 45, 70, 90],

    briefing:
      'Cold has soaked through the ground itself. Somewhere below this frozen ' +
      'clearing, warmth is rising — not from a fire, but from the rock. Turn ' +
      'until you find it.<br><br>What you hear first is only the surface: a ' +
      'thin, cold hiss. Stay with it, unhurried, and something under that hiss ' +
      'will begin to show itself — then something under <b>that</b>. There is ' +
      'no single moment of arrival here. Keep listening past what first seems ' +
      'like an answer.',

    init(s, audio) {
      s.ventAngle = Math.floor(Math.random() * 360);
      s.hold = 0;
      // One voice per depth, all at the same bearing — deeper layers sit
      // lower in frequency and rougher in texture.
      const layers = [
        { color: 'white', filterType: 'highpass', freq: 2600, Q: 0.6 },
        { color: 'brown', filterType: 'bandpass', freq: 700, Q: 1 },
        { color: 'brown', filterType: 'lowpass', freq: 260, Q: 0.8 },
        { color: 'crackle', filterType: 'bandpass', freq: 420, Q: 2 },
        { color: 'brown', filterType: 'lowpass', freq: 120, Q: 0.6 },
      ];
      s.voices = layers.map((l) => audio.voice(s.ventAngle, { ...l, gain: 0 }));
    },

    update(s, dt, t, ctx) {
      const align = alignment(ctx.yaw, s.ventAngle);
      const now = ctx.audio.ctx.currentTime;
      const aligned = angleDiff(ctx.yaw, s.ventAngle) <= this.tolerance;

      s.hold = aligned
        ? Math.min(100, s.hold + (100 / this.holdSeconds) * dt)
        : Math.max(0, s.hold - (100 / this.decaySeconds) * dt);

      s.voices.forEach((v, i) => {
        const unlocked = s.hold >= this.depthAt[i];
        const target = unlocked ? (0.015 + Math.pow(align, 2.6) * 0.4) * ctx.audio.audioScale : 0;
        v.gain.gain.setTargetAtTime(target, now, i === 0 ? 0.25 : 0.6);
      });

      const depthIdx = this.depthAt.filter((th) => s.hold >= th).length - 1;
      const words = [
        'cold surface',
        'something moves beneath',
        'a slow pulse, deeper',
        'the rock itself hums',
        'warmth, at the root of it',
      ];

      ctx.setPresence(s.hold);
      ctx.setOrb(align);
      ctx.setWord(aligned ? words[Math.max(0, depthIdx)] : 'listening');

      if (s.hold >= 100) ctx.complete();
    },

    completionText: () => ({
      text: `Heat rises through your palms, up from the rock itself, real and unmistakable — you had to go past ${DEPTHS.length - 1} false floors to find it.`,
      sub: 'The vent is found.',
    }),
  },

  {
    id: 7,
    name: "The River's Two Voices",
    discipline: DISCIPLINES.FRAME,
    // Closes this Discipline: see newlyRevealedDiscipline in progress.js.
    revealsDiscipline: true,
    force: FORCES.FLOW,
    control: 'commit',
    commitLabel: 'This is the crossing',
    tolerance: 20,      // phase 1: finding the simple, regular tick
    trueTolerance: 14,  // phase 2: finding the true, irregular groan

    briefing:
      'The river has frozen over, but it hasn’t gone silent. A steady ' +
      'tick-tick-tick creaks somewhere in the ice — easy to find, easy to ' +
      'trust. Turn toward it and mark it.<br><br>That’s a start, not an ' +
      'answer. Once you’ve marked it, listen further — the ice has a ' +
      'second voice, slower and less regular, that the first one was ' +
      'covering. When you hear it, let the first go, and mark <b>that</b> ' +
      'instead.',

    init(s) {
      s.simpleAngle = Math.floor(Math.random() * 360);
      do {
        s.trueAngle = Math.floor(Math.random() * 360);
      } while (angleDiff(s.simpleAngle, s.trueAngle) < 90);
      s.framed = false;
      s.nextTick = 0.6;
      s.revealElapsed = 0;
      s.nextGroanAt = null;
    },

    update(s, dt, t, ctx) {
      const alignSimple = alignment(ctx.yaw, s.simpleAngle);
      const alignTrue = alignment(ctx.yaw, s.trueAngle);

      if (!s.framed) {
        if (t >= s.nextTick) {
          ctx.audio.burst({
            angleDeg: s.simpleAngle, color: 'crackle', filterType: 'highpass',
            freq: 1800, Q: 1, dur: 0.16, attack: 0.005,
            gain: 0.05 + Math.pow(alignSimple, 2.6) * 0.4,
          });
          s.nextTick = t + 1.4;
        }
        ctx.setPresence(0);
        ctx.setOrb(alignSimple, false);
        ctx.setWord(angleDiff(ctx.yaw, s.simpleAngle) <= this.tolerance ? 'a shape, steady' : 'ticking, somewhere');
        return;
      }

      // Phase 2: the simple tick fades out over ten seconds while the true,
      // irregular groan takes over — inverting the "regular = real" instinct
      // levels 2 and 3 just trained. Discarding that instinct is the point.
      s.revealElapsed += dt;
      if (s.revealElapsed < 10 && t >= s.nextTick) {
        const fade = Math.max(0, 1 - s.revealElapsed / 10);
        ctx.audio.burst({
          angleDeg: s.simpleAngle, color: 'crackle', filterType: 'highpass',
          freq: 1800, dur: 0.16, attack: 0.005,
          gain: (0.05 + Math.pow(alignSimple, 2.6) * 0.4) * fade,
        });
        s.nextTick = t + 1.4;
      }
      if (s.nextGroanAt == null) s.nextGroanAt = t + 1 + Math.random();
      if (t >= s.nextGroanAt) {
        ctx.audio.burst({
          angleDeg: s.trueAngle, color: 'brown', filterType: 'lowpass',
          freq: 200 - Math.random() * 60, Q: 0.6, dur: 1.1, attack: 0.05,
          gain: 0.05 + Math.pow(alignTrue, 2.6) * 0.5,
        });
        s.nextGroanAt = t + 3 + Math.random() * 2;
      }

      ctx.setPresence(60);
      ctx.setOrb(alignTrue, true);
      ctx.setWord(angleDiff(ctx.yaw, s.trueAngle) <= this.trueTolerance ? 'the true voice' : 'listen further');
    },

    onCommit(s, ctx) {
      if (!s.framed) {
        if (angleDiff(ctx.yaw, s.simpleAngle) <= this.tolerance) {
          s.framed = true;
          s.revealElapsed = 0;
          s.nextGroanAt = null;
          ctx.flash('a shape, at least');
        } else {
          ctx.flash('nothing there yet');
        }
        return;
      }
      if (angleDiff(ctx.yaw, s.trueAngle) <= this.trueTolerance) {
        ctx.complete();
      } else if (angleDiff(ctx.yaw, s.simpleAngle) <= this.tolerance) {
        ctx.flash('only the shape you already knew');
      } else {
        ctx.flash('close — the true voice is slower');
      }
    },

    completionText: () => ({
      text: 'The ice groans low and slow, nothing like the ticking that first caught your ear. You mark the true crossing, and the tribe passes over safely.',
      sub: "The river's real voice found.",
    }),
  },

  {
    id: 8,
    name: 'Between Two Cliffs',
    discipline: DISCIPLINES.FILTER,
    // Closes this Discipline: see newlyRevealedDiscipline in progress.js.
    revealsDiscipline: true,
    force: FORCES.VOID,
    control: 'hold',
    tolerance: 13,
    holdSeconds: 30,
    decaySeconds: 12,

    briefing:
      'Across this valley, someone answers when you call — but a call thrown ' +
      'against two cliff faces comes back to you many times, thick with its ' +
      'own echo, before the true answer ever arrives.<br><br>The echoes are ' +
      'loud and close. The true answer is quieter, and comes late. Learn to ' +
      'want the quiet one.',

    init(s, audio) {
      s.trueAngle = Math.floor(Math.random() * 360);
      s.hold = 0;
      s.nextCallAt = 2;
      s.pendingTrueAt = null;
      s.voice = audio.voice(s.trueAngle, {
        color: 'brown', filterType: 'bandpass', freq: 500, Q: 0.7, gain: 0,
      });
    },

    update(s, dt, t, ctx) {
      const align = alignment(ctx.yaw, s.trueAngle);
      const now = ctx.audio.ctx.currentTime;

      s.voice.gain.gain.setTargetAtTime(
        (0.015 + Math.pow(align, 2.6) * 0.3) * ctx.audio.audioScale, now, 0.25,
      );

      if (t >= s.nextCallAt) {
        const decoys = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < decoys; i++) {
          ctx.audio.burst({
            angleDeg: Math.floor(Math.random() * 360), color: 'crackle',
            filterType: 'lowpass', freq: 500 + Math.random() * 300, Q: 2.5,
            dur: 0.5 + Math.random() * 0.3, gain: 0.3, attack: 0.02,
          });
        }
        s.pendingTrueAt = t + 1.2;
        s.nextCallAt = t + 5 + Math.random() * 2;
      }
      if (s.pendingTrueAt != null && t >= s.pendingTrueAt) {
        ctx.audio.burst({
          angleDeg: s.trueAngle, color: 'white', filterType: 'bandpass',
          freq: 900, Q: 1.2, dur: 0.32, gain: 0.16, attack: 0.01,
        });
        s.pendingTrueAt = null;
      }

      const aligned = angleDiff(ctx.yaw, s.trueAngle) <= this.tolerance;
      s.hold = aligned
        ? Math.min(100, s.hold + (100 / this.holdSeconds) * dt)
        : Math.max(0, s.hold - (100 / this.decaySeconds) * dt);

      ctx.setPresence(s.hold);
      ctx.setOrb(align);
      ctx.setWord(aligned ? 'clean, close' : align > 0.5 ? 'nearly' : 'echo, not it');

      if (s.hold >= 100) ctx.complete();
    },

    completionText: () => ({
      text: 'Under the din of your own voice thrown back at you, one answer comes through clean and small and real. Someone is there.',
      sub: 'The true call found.',
    }),
  },

  {
    id: 9,
    name: 'The Bellows and the Flame',
    discipline: DISCIPLINES.BALANCE,
    // Closes this Discipline: see newlyRevealedDiscipline in progress.js.
    revealsDiscipline: true,
    force: FORCES.IGNITION,
    control: 'breathe',
    holdSeconds: 40,   // cumulative time within the healthy band
    decaySeconds: 16,

    briefing:
      'Ore won’t go liquid on its own. The bellows need breath — but a ' +
      'flame this hungry punishes both a stinting hand and a greedy one.' +
      '<br><br>There is no rhythm to copy here, no beat to match. Hold when ' +
      'it needs air, release when it’s had enough, and mind that what ' +
      'you bank now, you may pay for later.',

    init(s, audio) {
      s.temp = 20;
      s.held = false;
      s.progress = 0;
      s.overheatTimer = 0;

      const c = audio.ctx;
      const noise = c.createBufferSource(); noise.buffer = audio.buffers.brown; noise.loop = true;
      const filt = c.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.value = 300; filt.Q.value = 0.8;
      const gain = c.createGain(); gain.gain.value = 0.08;
      // Unpositioned for the same reason as level 4's breath, and on the same
      // reference plane so that choice costs no decibels.
      noise.connect(filt); filt.connect(gain); gain.connect(audio.nonPositioned);
      noise.start();
      s.nodes = { noise, filt, gain };
    },

    update(s, dt, t, ctx) {
      const now = ctx.audio.ctx.currentTime;

      s.temp = clamp(s.temp + (s.held ? 22 * dt : -12 * dt), 0, 100);

      // Hoarding heat costs heat — Balance made literal, not just named.
      if (s.temp > 80) {
        s.overheatTimer += dt;
        if (s.overheatTimer > 1.2) {
          s.temp = Math.max(55, s.temp - 30);
          ctx.audio.burst({
            angleDeg: 0, distance: 1, color: 'crackle', filterType: 'highpass',
            freq: 2000, dur: 0.4, gain: 0.4, attack: 0.01,
          });
          s.overheatTimer = 0;
        }
      } else {
        s.overheatTimer = 0;
      }

      const inBand = s.temp >= 60 && s.temp <= 85;
      s.progress = inBand
        ? Math.min(100, s.progress + (100 / this.holdSeconds) * dt)
        : Math.max(0, s.progress - (100 / this.decaySeconds) * dt);

      s.nodes.gain.gain.setTargetAtTime((0.05 + (s.temp / 100) * 0.25) * ctx.audio.audioScale, now, 0.15);
      s.nodes.filt.frequency.setTargetAtTime(220 + s.temp * 6, now, 0.15);

      ctx.setPresence(s.progress);
      ctx.setOrb(s.temp / 100, s.temp > 80);
      ctx.setWord(s.temp > 80 ? 'too hot — ease back' : s.temp < 45 ? 'feed it more' : 'holding true heat');

      if (s.progress >= 100) ctx.complete();
    },

    onBreathe(s, held) { s.held = held; },

    cleanup(s) {
      if (!s.nodes) return;
      try { s.nodes.noise.stop(); } catch (e) { /* already stopped */ }
    },

    completionText: () => ({
      text: 'The ore slumps, brightens, and runs — the first true melt the tribe has ever made.',
      sub: 'The crucible holds.',
    }),
  },

  {
    id: 10,
    name: 'The Turning Wind',
    discipline: DISCIPLINES.TRACE,
    // Closes this Discipline: see newlyRevealedDiscipline in progress.js.
    revealsDiscipline: true,
    force: FORCES.DRIFT,
    control: 'hold',
    tolerance: 18,
    holdSeconds: 38,
    decaySeconds: 20,

    briefing:
      'The fire is lit, and a squall has found it. The wind won’t sit ' +
      'still long enough to name a direction and be done with it — it ' +
      'shifts, and shifts again.<br><br>Stay with it anyway. You are not ' +
      'finding a place to rest; you are finding it, over and over, for as ' +
      'long as it keeps changing.',

    init(s, audio) {
      s.threatAngle = Math.floor(Math.random() * 360);
      s.driftVel = (Math.random() * 2 - 1) * 8;
      s.nextGustAt = 4 + Math.random() * 4;
      s.hold = 0;
      s.misalignedFor = 0;
      s.lastCrackle = 0;
      s.voice = audio.voice(s.threatAngle, {
        color: 'brown', filterType: 'bandpass', freq: 400, Q: 0.7, gain: 0,
      });
    },

    update(s, dt, t, ctx) {
      // Continuous random walk, with occasional larger gusts — the target
      // never settles, so tracking it never gets to stop either.
      s.driftVel = Math.max(-25, Math.min(25, s.driftVel + (Math.random() * 2 - 1) * 6 * dt));
      s.threatAngle = (s.threatAngle + s.driftVel * dt + 360) % 360;
      if (t >= s.nextGustAt) {
        s.threatAngle = (s.threatAngle + (Math.random() * 2 - 1) * 70 + 360) % 360;
        s.nextGustAt = t + 5 + Math.random() * 6;
      }

      // The sound goes where the wind went. This level integrates threatAngle
      // every frame and gusts it by up to +/-70 degrees, but the panner was
      // placed once in init() and never moved again — so in the one level whose
      // whole premise is that the source will not hold still, the source did
      // not move. Gain and the on-screen word tracked the new bearing while the
      // binaural image stayed nailed to wherever the wind started, which is a
      // confidently false spatial cue in the level that closes The Trace.
      ctx.audio.movePanner(s.voice.panner, s.threatAngle);

      const align = alignment(ctx.yaw, s.threatAngle);
      const now = ctx.audio.ctx.currentTime;
      const gust = Math.sin(t * 0.3) * 40;
      s.voice.gain.gain.setTargetAtTime((0.02 + Math.pow(align, 2.6) * 0.5) * ctx.audio.audioScale, now, 0.2);
      s.voice.filt.frequency.setTargetAtTime(320 + gust + align * 40, now, 0.25);

      const aligned = angleDiff(ctx.yaw, s.threatAngle) <= this.tolerance;
      s.hold = aligned
        ? Math.min(100, s.hold + (100 / this.holdSeconds) * dt)
        : Math.max(0, s.hold - (100 / this.decaySeconds) * dt);
      s.misalignedFor = aligned ? 0 : s.misalignedFor + dt;

      // The flame itself: a fixed ember drone that dims through a long
      // misalignment stretch — felt stakes, with no fail state attached.
      if (t - s.lastCrackle >= 1.4) {
        const dim = Math.max(0, 1 - s.misalignedFor / 6);
        ctx.audio.burst({
          angleDeg: 0, distance: 1, color: 'crackle', filterType: 'highpass',
          freq: 1400, dur: 0.3, gain: 0.05 + 0.2 * dim, attack: 0.01,
        });
        s.lastCrackle = t;
      }

      ctx.setPresence(s.hold);
      ctx.setOrb(align);
      ctx.setWord(aligned ? 'here, again' : align > 0.5 ? 'it moved' : 'tracking');

      if (s.hold >= 100) ctx.complete();
    },

    completionText: () => ({
      text: "The wind circles, doubles back, tries the other side — and every time, you're already there. It gives up before the flame does.",
      sub: "The fire endures its first storm.",
    }),
  },
];
