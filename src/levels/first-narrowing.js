/**
 * first-narrowing.js — Levels 1–5.
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
 *   init(state, audio)          — build voices, seed randomness
 *   update(state, dt, t, ctx)   — per frame; call ctx.complete() to finish
 *   onCommit(state, ctx)        — only for control: 'commit'
 *   onBreathe(state, held)      — only for control: 'breathe'
 *   cleanup(state)              — stop any oscillators started in init
 *   completionText(state)       — { text, sub }
 */

import { angleDiff, alignment } from '../engine/input.js';
import { DISCIPLINES, FORCES } from '../engine/constants.js';

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
    decaySeconds: 10,  // gentle, not punishing

    briefing:
      'You wake in <b>total darkness</b>. No fire, no torch, no wall to trust. ' +
      'Somewhere in this cave, a single draft of outside air moves — a thread of ' +
      'wind toward the exit.<br><br>Turn slowly. There is no clock here. Let the ' +
      'draft grow clear and close, then simply stay with it. If your attention ' +
      "drifts, that's alright — settle back and continue.",

    init(s, audio) {
      s.sourceAngle = Math.floor(Math.random() * 360);
      s.hold = 0;
      s.voice = audio.voice(s.sourceAngle, {
        color: 'brown', filterType: 'bandpass', freq: 420, Q: 0.7, gain: 0,
      });
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
    tolerance: 28,
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
    tolerance: 12,
    holdSeconds: 22,
    decaySeconds: 10,

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
      gain.connect(audio.bus);
      osc.start(); noise.start();

      // Resonance tone: rises only as the player syncs. The reward is harmonic.
      const res = c.createOscillator(); res.type = 'sine'; res.frequency.value = 220;
      const resGain = c.createGain(); resGain.gain.value = 0;
      res.connect(resGain); resGain.connect(audio.bus); res.start();

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
      s.nodes.resGain.gain.setTargetAtTime((s.sync / 100) * 0.2, now, 0.25);

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
];
