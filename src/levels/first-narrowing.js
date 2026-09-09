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
 *   onCommit(state, ctx)        — only for control: 'commit'. GameScreen rate-
 *                                 limits dispatch to it (COMMIT_MIN_INTERVAL,
 *                                 ~1s) — a level never sees calls faster than
 *                                 that, so it need not (and must not) build
 *                                 its own commit-mashing guard
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
import {
  DISCIPLINES, FORCES, DEPTHS, PRESENCE_MARKS, MARK_REARM,
} from '../engine/constants.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ── The word in the field ──────────────────────────────────────────────────
 *
 * `.snd-breath-word` is the one line of text a level publishes while it is
 * being played, and for the whole life of this file it was a live readout of
 * the exact hidden scalar the Seeker was supposed to be estimating by ear.
 * Level 1 shipped `aligned ? 'here' : align > 0.6 ? 'closer' : align > 0.3 ?
 * 'faint' : 'listening'` — a three-threshold quantizer on `align`, recomputed
 * every frame, printed on the glass.
 *
 * THIS IS THE ORB DEFECT, ONE ELEMENT OVER. The orb's `scale(orbScale)` was
 * removed because it was a continuous, zero-latency, hardware-independent
 * readout of `align` — not a shortcut so much as a strictly better sensor than
 * the audio, with none of the audio's thresholds, equal-loudness tilt or HRTF
 * ambiguity. Every argument in that removal applies here unchanged. A word
 * ladder is coarser than a scale factor, and coarser is not the same as safe:
 *
 *   - It is sampled continuously. A Seeker sweeping the circle does not read
 *     one word, they read every BOUNDARY CROSSING, and two contour lines
 *     bracket the source far more precisely than either rung names. Level 1's
 *     `align > 0.3` edge and its `> 0.6` edge, bisected, locate a source to
 *     within a few degrees against a tolerance of 14.
 *   - `.snd-heading-cue` prints the bearing in degrees, one metre away on the
 *     same screen. The word supplies the contour, the heading supplies the
 *     axis to plot it against. Together they are a protractor.
 *   - It resolves the ambiguity the ear cannot. Front-to-back separation in
 *     this build measures 1.4 dB (CLAUDE.md § Known limits) — the single
 *     hardest read in the game. The word answers front-versus-back instantly,
 *     unambiguously, and for free. So it does not merely duplicate the audio
 *     channel; it carries information the audio genuinely does not.
 *
 * The evidence that this is reachable is not hypothetical and was not found by
 * a player. `scripts/ui.e2e.mjs` drove level 1 to completion by sweeping the
 * circle reading this word and turning back to the best rung, and drove level
 * 9's forge to its first presence mark with a closed-loop controller fed by
 * nothing but the three temperature words. A harness with no ears cleared two
 * levels off this channel alone. That is the whole finding.
 *
 * THE RULE, AND IT IS THE MECHANISM RATHER THAN THE WORDING: the word may
 * report only what the Seeker has ALREADY EARNED, never what they are trying
 * to estimate. Concretely it is a function of cumulative presence and of
 * nothing else — the same scalar the meter draws, the same one `[data-depth]`
 * grades. Presence is a sanctioned channel: it is on screen already, it is
 * deterministic, and reading it tells a Seeker nothing they did not do. It
 * cannot be bisected against a bearing because it does not move when you turn
 * — it moves when you have stayed.
 *
 * `ladderWord` below is how a level says that, and `checkWordSource` in
 * contract.js is what stops the next edit saying it the old way: a setWord
 * argument may not name the alignment family, and may not compare anything to
 * a numeric literal. Thresholds go in the ladder, never in the call.
 *
 * Level 2 is the one level that does not use this and is not a leak. Its word
 * says an event is sounding and never which KIND — the classification is the
 * task, and that half was taken off this channel already; see the long block
 * about its commit answer below.
 *
 * WHAT THIS COSTS, said plainly rather than buried. Levels 4 and 9 lose the
 * only explicit statement of the thing they ask for — level 4 no longer says
 * whether you are in phase with the cave, level 9 no longer names the heat
 * band. Those levels get harder in a way that is not a tuning change: they
 * now require the ear they were always described as requiring. Level 9's
 * upper edge survives on `orb.notice`, which is a discrete flag and was never
 * the problem; its lower edge is now audible-only. Whether that reads or
 * frustrates is a question for a real playtest, not for this comment.
 */

/**
 * The rung of a fixed word ladder that cumulative progress has reached.
 *
 * Mirrors GameScreen's own mark logic exactly — the same thresholds, the same
 * `MARK_REARM` hysteresis — so the word, the meter and the `[data-depth]`
 * ladder cannot disagree about how deep a trial has got. The hysteresis is not
 * cosmetic: without it a Seeker resting on a threshold sees the word flicker in
 * time with their own alignment, which is the readout coming back in miniature.
 *
 * `marks` is overridable for a level whose own reveal ladder is the honest
 * index (level 6's depths). It must be thresholds on EARNED progress; anything
 * a bearing can move belongs nowhere near this function.
 */
function ladderWord(s, ladder, progress, marks = PRESENCE_MARKS) {
  let i = s.rung ?? 0;
  while (i < marks.length && progress >= marks[i]) i++;
  while (i > 0 && progress < marks[i - 1] - MARK_REARM) i--;
  s.rung = i;
  return ladder[Math.min(i, ladder.length - 1)];
}

/* ── The room ───────────────────────────────────────────────────────────────
 *
 * The space a level stands in, distinct from the thing it is listening for.
 * Built with `audio.room()`, which routes beds through `ambient()` and events
 * through `burst({ positioned: false })`, so the trial scaling and the
 * reference plane are owned for these the same way they are for a cue.
 *
 * NOT EVERY LEVEL GETS ONE, and that is the point. A forge does not drip and
 * a frozen clearing does not rumble like limestone, so a bed that suits level
 * 1 contradicts level 6's own briefing. Five levels carry a room; five
 * deliberately do not, each for a reason written at the level.
 *
 * NOTHING IN A ROOM HAS A BEARING. Beds never did; events used to, panned to a
 * point drawn once per trial. That was wrong, and it is the second thing this
 * pass fixed. A panned drip carries ITD, ILD and pinna colouration — it says
 * "over there" — and this game rests on there being exactly ONE direction worth
 * finding per level. An un-gated second bearing is still a second compass, and
 * a careful Seeker sorting real directional information from real directional
 * information has no way to know which one the level meant. `room()` now routes
 * events through `nonPositioned` exactly as it routes beds, so a room event's
 * ear balance is flat at every listener yaw while the draft's swings 7 dB
 * across the circle. Measured, not asserted in prose.
 *
 * It also removed a lottery: an identical drip used to measure 11.7 dB under
 * the aligned cue at one bearing and 14.1 dB at another, purely from the HRTF,
 * so a room's level was partly decided by a random draw. Without a panner every
 * figure below is a constant.
 *
 * THE LEVELS ARE MEASURED, NOT CHOSEN BY EAR, AND THE MEASURE IS A-WEIGHTED.
 * A gain constant does not predict a level on a broadband source, and a flat
 * level does not predict audibility at the threshold this game is played at.
 * Both lessons were learned the same way — by shipping something and finding
 * out. Every figure below is rendered through the real graph and A-weighted,
 * in dB relative to the calibration reference (0 dB is roughly "just audible"
 * at the volume the Seeker chose). The yardsticks:
 *
 *   level 1's aligned draft        +14.8 dB   the cue at its loudest
 *   the calibration reference        0.0 dB   just audible, by construction
 *   level 1's misaligned floor      -8.6 dB   the cue at its quietest, and
 *                                             therefore already inaudible
 *
 * WHAT CHANGED AND WHY, because the previous numbers were defended in this same
 * comment and were wrong. The room shipped silent on a real device. Rendered
 * flat it looked correctly placed; rendered A-weighted the beds sat 27-30 dB
 * below the Seeker's own reference and the rock settle 14 dB below it. Those
 * are not quiet sounds, they are absent ones, and the old broadband rule was
 * what put them there — it bounded the room against a cue floor that is itself
 * below audibility, so the only room that satisfied it was one nobody hears.
 * ROOM_CEILING in constants.js now bounds the room against the cue at FULL
 * alignment instead, and says plainly which pillar that relaxes.
 *
 * The drips are the surprise in the other direction: they were never the quiet
 * ones. A-weighted, DRIP_NEAR was 1.4 dB under the aligned draft — effectively
 * tying the loudest thing in the level — because the flat measure understates a
 * 1.9 kHz transient by about 8 dB. Both drips came DOWN about 2 dB. If they
 * were not heard on a device, spacing rather than level is the likely reason,
 * and the spacing is what changed for them.
 *
 * SPACING IS THE THIRD AXIS, and the cheapest one. A room whose first event is
 * fifteen seconds away is a room the Seeker has already decided is not there,
 * and every interval below used to open with its own longest silence. Two
 * changes: the ranges came in, and `room()` now pulls the FIRST firing to about
 * a third of a drawn interval, so level 1's cave drips within about five
 * seconds instead of within fifteen. Neither makes the room a metronome — the
 * ranges are still wide and still drawn — and neither is a payoff arriving
 * sooner, because `update` still sees only the transport clock. What is being
 * timed is furniture being in the room when the lights come up.
 */

/**
 * The floor of an enclosed space. Low, so it is felt as enclosure rather than
 * attended to as a sound, but no longer so low that no phone can render it:
 * 85 Hz was below what earbuds reproduce and below where the ear has much
 * sensitivity left, which is a bad place to spend a bed's entire budget.
 *
 * Measured A-weighted: -3.5 dB against the calibration reference, 18.3 dB
 * under level 1's aligned draft, and its energy inside the draft's own critical
 * band is 3.0 dB BELOW what the draft's misaligned floor puts there — so it
 * cannot flatten the bottom of the gradient the Seeker hunts along.
 * That is +23.4 dB on what shipped.
 */
const STONE = { color: 'brown', filterType: 'lowpass', freq: 110, Q: 0.7, gain: 0.15 };

/**
 * The same floor, opened out — a valley has one too, and it is bigger, so it
 * sits lower and carries further. Level 8's two cues are at 500 and 900 Hz, far
 * clear of it. Measured -2.9 dB against the reference, 17.6 dB under the cue.
 * That is +26.7 dB on what shipped.
 */
const VALLEY = { color: 'brown', filterType: 'lowpass', freq: 95, Q: 0.7, gain: 0.20 };

/**
 * Water, falling somewhere in the room — nowhere in particular in it, now that
 * events are not positioned.
 *
 * Two drip voices rather than one, because one is a metronome and two whose
 * intervals never divide into each other are a place. They differ in SPECTRUM,
 * not in level, and that is now literally true rather than nearly true: the
 * nominal gain is identical and the 3.1 dB between them as rendered is the Q 9
 * bandpass sitting at two different centre frequencies. NEAR is a tight small
 * pool, DEEP a wider one.
 *
 * Measured A-weighted over the loudest window: NEAR +11.4 dB and DEEP +8.3 dB
 * against the calibration reference, 3.3 and 6.4 dB under the aligned draft.
 * Both came down about 2 dB from what shipped — see the block above.
 */
const DRIP_NEAR = {
  color: 'white', filterType: 'bandpass', freq: 1900, Q: 9, dur: 0.13, attack: 0.004, gain: 0.20,
};
const DRIP_DEEP = {
  color: 'white', filterType: 'bandpass', freq: 1150, Q: 9, dur: 0.18, attack: 0.006, gain: 0.20,
};

/**
 * Rock, settling. The rumble the ask named twice, and the one element of the
 * room that was asked for by name and then shipped inaudible: at 90 Hz and
 * gain 0.05 it rendered 13.8 dB below the Seeker's own reference. It is now
 * +3.1 dB against it, a raise of 16.9 dB, and it moved up to 120 Hz for the
 * same reason the bed did — a rumble no transducer reproduces is not a rumble.
 *
 * It stays an event rather than a bed because 2.6 s every forty seconds or so
 * is a few percent of the time, so it can be genuinely present without ever
 * being the thing the Seeker is listening through. Slow attack — it arrives,
 * it does not strike, which is also what keeps it clear of the ember-burst
 * shape this era must not have.
 *
 * The one figure worth watching, and the clearest cost in this whole change:
 * inside the draft's critical band this lands 7.8 dB above what the misaligned
 * floor puts there, so for its 2.6 seconds it covers the very bottom of the
 * alignment gradient. At [30, 60] s that is four to eight percent of a trial.
 * Reported by the suite rather than bounded by it, because an event's cost in
 * the cue's band is limited by its duty cycle and a bed's is not — but it is a
 * cost, it is the reason this is not louder still, and if the gradient's bottom
 * ever reads as unreliable this is the first constant to look at.
 */
const SETTLE = {
  color: 'brown', filterType: 'lowpass', freq: 120, Q: 0.7, dur: 2.6, attack: 0.9, gain: 0.24,
};

/* ── Level 2's rhythm cue ───────────────────────────────────────────────────
 *
 * Player feedback: "I don't understand level 2 at all, rhythm is barely
 * visible and frustrating without having any clue." Tracing the loop —
 * cue, decision window, action, feedback — the break wasn't the audio
 * itself, it was the window around it.
 *
 * A rhythm episode used to be three footfalls (0.46 s apart) and then
 * nothing: 2.6 seconds total, at a bearing drawn fresh for that one
 * episode, with every footfall at the same fixed gain regardless of where
 * the Seeker was facing. That asks a Seeker to notice a three-pulse
 * pattern, classify it as the true rhythm, localise a bearing from it, turn
 * a phone or body to within `tolerance`, and commit — all inside one
 * exposure with no signal telling them whether the turn they'd just made
 * helped. Get any part of that wrong once and the sound is gone; the next
 * episode starts over at a new, unrelated bearing. That is a blind
 * single-shot guess wearing a discrimination task's clothes, not a skill a
 * Seeker can build over repeated tries within one episode.
 *
 * Two changes, both structural rather than louder:
 *
 * 1. The three-footfall stride now repeats RHYTHM_GROUPS times per episode
 *    (still 0.46 s apart within a stride — that spacing is the pattern
 *    being taught, untouched) instead of firing once and ending. The
 *    episode runs RHYTHM_DURATION (~5.8 s, was 2.6 s) — room to actually
 *    hear the regularity repeat, not just once, and room to turn.
 * 2. Each footfall's gain now answers the Seeker's CURRENT alignment to the
 *    episode's bearing (thudGain), not a fixed 0.35 regardless of facing.
 *    That gives this level the "getting warmer" channel every hold level in
 *    this file already has and this one never did — a channel that answers
 *    back within the same episode, not just across separate guesses.
 *
 * Peak gain at full alignment is unchanged (0.35, RHYTHM_THUD_GAIN) — this
 * is not a louder mix, it is gain that now varies with facing instead of
 * being constant regardless of it.
 *
 * A game-theory review of this same change caught what removing the
 * per-wrong-commit episode reset opened up: with wrong commits no longer
 * ending the episode, and GameScreen's commit path having no rate limit of
 * its own, a Seeker could hold a turn key (OS key-repeat) while mashing
 * commit and sweep the whole circle past `tolerance` well inside one
 * episode — clearing the level at a wall-clock cost competitive with actual
 * listening, with no need to ever tell a rhythm from a leaf. That gap was
 * general to every `commit`-control level (level 7's static phase-1 bearing
 * has the identical exposure, reset or no reset), so the fix is
 * `COMMIT_MIN_INTERVAL` in `GameScreen.jsx`'s `tryCommit`, not anything
 * local to this level: it floors the interval between dispatched
 * `onCommit` calls per trial. A commit inside that floor is dropped
 * silently — pillar 3 still holds, a wrong (or too-fast) commit costs
 * nothing — it just can't be repeated fast enough to substitute for
 * listening.
 *
 * AND THEN THE COMMIT ANSWER ITSELF WAS THE LEAK. Removing the per-wrong-
 * commit reset made a wrong commit free, which is right; what it also did was
 * make the commit answer a free oracle, which is not. The three answers used
 * to decompose the Seeker's assertion into its two halves and report each
 * separately: "only the wind" whenever no rhythm was sounding, "close — keep
 * listening" whenever one was and the aim was off. So a single press at the
 * first instant of any event named its class, with no listening, no aim and
 * no wait — the same ground truth that had just been taken off
 * `.snd-breath-word` for exactly that reason, moved one channel over and
 * gated behind one keypress instead of zero.
 *
 * That is a pillar-3 defect and NOT a clear-rate exploit, and the difference
 * matters for what the fix has to be. Commits are free, so knowing which kind
 * of event is sounding buys almost no wall-clock: a blind masher at the 1.0 s
 * floor lands a commit with probability P(a rhythm is sounding) × P(inside
 * tolerance) = 0.247 × (40/360) = 0.0275, so ~109 dispatches — about 109 s of
 * uninterrupted mashing — for the three this trial needs, with or without the
 * leak. (Duty cycle: mean event 0.4 × 5.78 + 0.6 × 0.9 = 2.85 s against a mean
 * 6.5 s idle gap; rhythms occupy 2.312/9.352 = 0.247 of the clock.) What the
 * leak actually cost was the Discipline: two Seekers with genuinely different
 * ears cleared at the same rate, because the classification FILTER exists to
 * train was being handed over rather than heard.
 *
 * THE FIX IS THAT A COMMIT ANSWERS THE WHOLE ASSERTION OR NOTHING. A commit
 * says "there is a true rhythm, and it is *there*"; the level confirms that
 * conjunction or it does not, and it never reports the halves separately.
 * Every way of not landing — nothing sounding, a leaf, or the true rhythm at a
 * bearing outside `tolerance` — answers with the one string below.
 *
 * Measured as information: a blind press used to carry the full H(0.4) = 0.971
 * bits of the event's class. It now carries 0.061 bits — P(rhythm) moves 0.400
 * → 0.372 on a miss — and that residue is only the fact that succeeding is
 * itself evidence, which is not a leak but the task being done.
 *
 * The Seeker loses nothing they were entitled to. "Am I getting warmer?" is
 * still answered inside the same episode, by `thudGain`, at 0.46 s resolution,
 * in the channel this level is about — nine footfalls whose gain reads the
 * live alignment. The old "close" flash was a redundant, silent, visual copy
 * of that channel that also gave away the half the ear was supposed to earn.
 * Moving the answer out of text and back into the mechanic is pillar 1.
 */

/**
 * The answer to a commit that did not land. ONE string for every way of not
 * landing, and the sameness is the mechanic — not a shortage of copy.
 *
 * Do not split it back into a per-cause set, however much better three
 * specific answers read than one general one. Anything that distinguishes
 * "no rhythm was sounding" from "a rhythm was sounding and you were aimed
 * wrong" hands over the classification this level exists to ask for by ear.
 * `scripts/ui.e2e.mjs` § 'a commit does not say which kind of event is
 * sounding' is the guard, and it is written against the two cases being
 * indistinguishable, not against any particular wording.
 *
 * It is deliberately about the Seeker's act and silent about the world:
 * "nothing noticed", not "only the wind". A Seeker who correctly heard the
 * rhythm and simply aimed 30° off is not wrong about the clearing, and a
 * level whose whole job is teaching that judgement must not tell them they
 * were. It also keeps the briefing's own promise verbatim — "if you are
 * mistaken, nothing is lost — simply keep listening" — and pairs with the
 * commit label ("I notice this") and the success answer ("noticed, clearly"),
 * so all three sit on one verb and the contrast between them is legible.
 */
const COMMIT_MISS = 'nothing noticed — keep listening';
const RHYTHM_STEPS = 3;        // footfalls per stride — unchanged, this is
                                // the pattern ("the regularity IS the tell")
const RHYTHM_STRIDE = 0.46;    // seconds between footfalls — unchanged
const RHYTHM_GROUP_GAP = 0.9;  // silence between stride repeats
const RHYTHM_GROUPS = 3;       // stride repeats per episode (was 1)
const RHYTHM_CYCLE = RHYTHM_STEPS * RHYTHM_STRIDE + RHYTHM_GROUP_GAP; // 2.28s
const RHYTHM_TOTAL_THUDS = RHYTHM_STEPS * RHYTHM_GROUPS; // 9, was 3
const RHYTHM_DURATION = (RHYTHM_GROUPS - 1) * RHYTHM_CYCLE
  + (RHYTHM_STEPS - 1) * RHYTHM_STRIDE + 0.3; // ~5.78s, was 2.6s
const RHYTHM_THUD_GAIN = 0.35; // peak gain, at full alignment — unchanged
/** Firing time of the k-th footfall (0-indexed) relative to episode start. */
const thudTime = (k) => Math.floor(k / RHYTHM_STEPS) * RHYTHM_CYCLE
  + (k % RHYTHM_STEPS) * RHYTHM_STRIDE;
/** Louder as the Seeker turns toward the episode's bearing; never louder
 *  than the old fixed value at full alignment. */
const thudGain = (align) => RHYTHM_THUD_GAIN * (0.3 + 0.7 * Math.pow(align, 1.6));

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

    /**
     * The field's word, by how long the draft has been held — never by where
     * the Seeker is facing. This ladder used to be `align > 0.6 ? 'closer' :
     * align > 0.3 ? 'faint' : 'listening'`, which is the level's own hidden
     * bearing printed on the glass at 60 Hz; see the block at the top of this
     * file. Nothing here can be read before it has been earned.
     */
    words: ['listening', 'the dark gives a little', 'cold, and moving', 'a way out, breathing'],

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
      // The cave the briefing opens in, finally audible as a cave: a sub-bass
      // floor, two drip points, and rock settling somewhere out of reach. None
      // of it is gated by alignment or by presence — it runs identically at
      // hold 0 and hold 99, which is what makes it a place rather than a
      // reward. See the room block at the top of this file for the levels.
      s.room = audio.room({
        beds: [STONE],
        events: [
          { ...DRIP_NEAR, every: [5, 11] },
          { ...DRIP_DEEP, every: [8, 17] },
          // Still the rare one, but no longer rare enough that a Seeker can
          // finish a whole trial without ever hearing the rock move.
          { ...SETTLE, every: [30, 60] },
        ],
      });
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
      s.room.update(t);
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
      ctx.setWord(ladderWord(s, this.words, s.hold));

      if (s.hold >= 100) ctx.complete();
    },

    cleanup(s) {
      if (s.room) s.room.stop();
      if (s.voices) s.voices.forEach((v) => { try { v.src.stop(); } catch (e) { /* stopped */ } });
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

    // NO ROOM LAYER, deliberately. This level is an impulse-discrimination
    // task — telling a true rhythm from ambient noise — and a room that drips
    // adds a third class of impulse to a two-class judgement. That is not
    // atmosphere, it is a change to the mechanic, and a quieter continuous bed
    // is no better: the leaf bursts are near threshold by design and anything
    // continuous under them is a masker of a detection task. The clearing
    // stays silent between events, which is also what its own briefing says.
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
          s.phase = 'rhythm'; s.thuds = 0; s.startedAt = t; s.endsAt = t + RHYTHM_DURATION;
        } else {
          s.phase = 'leaf'; s.endsAt = t + 0.9;
          ctx.audio.burst({
            angleDeg: s.angle, color: 'white', filterType: 'highpass',
            freq: 2200, Q: 0.8, dur: 0.45, gain: 0.16, attack: 0.02,
          });
        }
      }

      if (s.phase === 'rhythm') {
        // Three evenly spaced footfalls, repeated RHYTHM_GROUPS times — the
        // regularity IS the tell, and it now repeats long enough to actually
        // be recognised, located and turned toward instead of heard once and
        // gone. Each footfall reads the Seeker's alignment AT THE MOMENT IT
        // FIRES, so a Seeker who turns closer during the episode hears the
        // next footfall answer that turn — the "getting warmer" channel this
        // cue never had before.
        while (s.thuds < RHYTHM_TOTAL_THUDS && t - s.startedAt >= thudTime(s.thuds)) {
          const align = alignment(ctx.yaw, s.angle);
          ctx.audio.burst({
            angleDeg: s.angle, color: 'crackle', filterType: 'lowpass',
            freq: 150, Q: 0.6, dur: 0.22, attack: 0.005, gain: thudGain(align),
          });
          s.thuds++;
        }
      }

      // A missed event simply passes. No penalty — see file header.
      if (s.phase !== 'idle' && t >= s.endsAt) {
        s.phase = 'idle';
        s.nextAt = t + 4 + Math.random() * 5;
      }

      // Neither channel says which KIND of event this is — that
      // classification is the whole discrimination task this level asks the
      // Seeker to do by ear. Naming it on screen ("a rhythm" vs "just
      // leaves") used to answer FILTER's own question for them regardless of
      // whether they had listened at all; both words now only say something
      // is happening, never what.
      const eventActive = s.phase !== 'idle';
      ctx.setOrb(eventActive ? 0.6 : 0.12, false);
      ctx.setWord(eventActive ? 'something stirs' : 'listening');
      ctx.setPresence((s.found / this.required) * 100);
    },

    onCommit(s, ctx) {
      // A commit asserts BOTH halves at once — "there is a true rhythm, and it
      // is there" — so it is tested as one conjunction and answered as one
      // thing. The three cases that fail it (nothing sounding, a leaf, the
      // rhythm at a bearing outside tolerance) are deliberately not told
      // apart; see COMMIT_MISS. Keep this a single branch: written as an early
      // return per cause, the next edit that wants a kinder message for one of
      // them reopens the oracle without anyone noticing.
      const landed = s.phase === 'rhythm'
        && angleDiff(ctx.yaw, s.angle) <= this.tolerance;

      if (!landed) {
        // Nothing else changes. The episode, if one is sounding, keeps
        // sounding rather than ending on a wrong guess — the briefing promises
        // "if you are mistaken, nothing is lost — simply keep listening", and
        // ending it here made that false the moment anyone acted on it,
        // because the only thing left to keep listening to was silence. A
        // Seeker who turned too far hears the same footfalls, hears them come
        // up as they turn back (thudGain), and can commit again inside this
        // episode's own window. That warming is now the only answer to "was
        // that a rhythm, and where?" — which is the point.
        ctx.flash(COMMIT_MISS);
        return;
      }

      s.found++;
      ctx.audio.burst({
        angleDeg: s.angle, color: 'crackle', filterType: 'highpass',
        freq: 900, dur: 0.4, gain: 0.22,
      });
      s.phase = 'idle';
      s.nextAt = ctx.elapsed + 3;
      ctx.flash('noticed, clearly');
      if (s.found >= this.required) ctx.complete();
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

    /** By held progress, not by facing — see the block at the top of this file. */
    words: ['listening', 'one breath holds steady', 'the climb, unmistakable', 'the air smells of outside'],

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
      // A chamber, so the same cave room as level 1 — but sparser. Three
      // drafts already occupy the band the ear is sorting through here, and
      // the discrimination is between continuous voices, so a drip competes
      // with nothing; it just has less silence to sit in. No settle: this
      // chamber is busy enough without the rock joining in.
      s.room = audio.room({
        beds: [STONE],
        events: [
          { ...DRIP_NEAR, every: [9, 18] },
          { ...DRIP_DEEP, every: [13, 25] },
        ],
      });
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
      s.room.update(t);
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
      ctx.setWord(ladderWord(s, this.words, s.hold));

      if (s.hold >= 100) ctx.complete();
    },

    cleanup(s) {
      if (s.room) s.room.stop();
      if (s.voices) s.voices.forEach((v) => { try { v.src.stop(); } catch (e) { /* stopped */ } });
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

    /**
     * By accumulated sync, not by whether this instant is in phase.
     *
     * The old word was `matched ? 'in rhythm' : 'settling in'` — a live,
     * per-frame in-phase flag, which is the entire judgement this level asks
     * the Seeker to make by ear. Holding the button flat and watching for the
     * flip read the cave's breath period off the screen without hearing it.
     * These four say only how far the two rhythms have come together, which is
     * what the meter beside them already says.
     */
    words: ['settling in', 'two rhythms, nearly', 'the cave takes it up', 'one breath, both of you'],

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

      // Drips, and no stone bed. The cave's breath IS this level's low end —
      // it is the cue, and the Seeker matches their own rhythm to it — so a
      // second sub-bass layer would sit directly on the channel being read.
      // The drip intervals are long and irregular against the 5.5-7 s breath
      // period on purpose: a regular drip inside that range would be a
      // metronome, and this level's own init note says it must not have one.
      s.room = audio.room({
        events: [
          { ...DRIP_NEAR, every: [8, 17] },
          { ...DRIP_DEEP, every: [12, 23] },
        ],
      });

      s.nodes = { osc, noise, filt, gain, res, resGain };
    },

    update(s, dt, t, ctx) {
      s.room.update(t);
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
      ctx.setWord(ladderWord(s, this.words, s.sync));

      if (s.sync >= 100) ctx.complete();
    },

    onBreathe(s, held) { s.held = held; },

    cleanup(s) {
      if (s.room) s.room.stop();
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

    /** By the spark fed, not by facing — the crackle rate is the only cue. */
    words: ['faint, and dying', 'the ember remembers', 'it glows', 'it catches'],

    briefing:
      'A dead ember waits in a blind hollow, one spark from catching. You cannot ' +
      'see it — only hear its faint, dying crackle.<br><br>Turn to face it and ' +
      'simply stay there, unhurried. Feed it steadily, for as long as it takes, ' +
      'and the tribe has its first fire.',

    init(s, audio) {
      s.emberAngle = Math.floor(Math.random() * 360);
      s.spark = 0;
      s.lastCrackle = 0;
      // A blind hollow: the enclosure, and rock settling in it. No drips —
      // the only cue in this level is a crackle whose RATE and brightness the
      // Seeker reads, and a random pitched impulse in the same stream is
      // something that could be counted as a crackle. The settle is safe
      // beside it because nothing about a 2.6 s low swell resembles a 0.28 s
      // highpassed tick; it cannot be mistaken for the ember.
      s.room = audio.room({
        beds: [STONE],
        events: [{ ...SETTLE, every: [28, 55] }],
      });
    },

    update(s, dt, t, ctx) {
      s.room.update(t);
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
      ctx.setWord(ladderWord(s, this.words, s.spark));

      if (s.spark >= 100) {
        ctx.audio.burst({
          angleDeg: s.emberAngle, color: 'crackle', filterType: 'lowpass',
          freq: 2000, dur: 0.8, gain: 0.42, attack: 0.02,
        });
        ctx.complete();
      }
    },

    cleanup(s) { if (s.room) s.room.stop(); },

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

    /**
     * One word per depth, on the same ladder the layers themselves open on —
     * `depthAt`, minus its leading 0, which is the rung every trial starts at.
     * These are the DEPTHS the briefing promises are under each other, and
     * they arrive only by having held. See the block at the top of this file
     * for the gate that used to sit in front of them.
     */
    words: [
      'cold surface',
      'something moves beneath',
      'a slow pulse, deeper',
      'the rock itself hums',
      'warmth, at the root of it',
    ],

    /**
     * Per-layer level trim, and the fix for this level's real defect.
     *
     * All five depths shared one gain curve, and a shared gain is not a shared
     * level: rendered through the real graph at the curve's aligned value
     * (0.415), the five arrived at +25.9, +14.5, +23.0, -9.2 and +19.8 dB
     * relative to the calibration reference. That is a 35.1 dB spread across
     * layers the design intends as one ladder — and the two worst placed are
     * the ones that matter most. The surface hiss, a white-noise highpass at
     * 2.6 kHz, is the widest band in the set and sat on top of everything the
     * briefing promises is underneath it; the Lattice, a crackle bandpassed to
     * 420 Hz at Q 2, sat 35 dB below the surface and was inaudible in
     * practice. A Seeker who held for 70% of a 35-second hold to reach the
     * fourth depth was being answered with silence.
     *
     * These trims put the four continuous layers at a common rendered level of
     * about +9 dB, which is chosen so the whole five-layer stack, fully open
     * and aligned, sums to +15.3 dB — level 1's aligned draft, to within half a
     * decibel. So the level gets QUIETER: the fully-open stack drops 13.2 dB
     * from where it was. Four of these five numbers are reductions. The fifth
     * is a 13 dB raise on the Lattice, and it is named here rather than
     * buried: it is not a fix for quietness, which would be forbidden, but for
     * a layer sitting 35 dB below its own siblings by accident of texture.
     *
     * The Lattice is matched on its loudest 50 ms rather than on RMS, because
     * it is the one impulsive texture here and its crest factor is 8 dB above
     * the others'. Equalising RMS would have put its clicks 8 dB proud of
     * every layer around it — the same masking defect, upside down.
     *
     * UNVALIDATED, and in a known direction. Equal rendered level is not equal
     * LOUDNESS: at the quiet reproduction level this game asks for, the 120 Hz
     * Core will read as considerably softer than the 2.6 kHz Shell even though
     * they now measure the same. Correcting that needs an equal-loudness
     * judgement at a real listening level, which means a phone, headphones and
     * a quiet room. The error runs one way — the deep layers are the quiet
     * ones — so a future correction lifts the bottom of the ladder, it does
     * not lower the top again.
     */
    depthTrim: [0.143, 0.529, 0.199, 4.5, 0.288],

    // NO ROOM LAYER. The briefing puts this on a frozen clearing, in the open,
    // on ice — it does not drip and it does not have a cave's stone floor, and
    // pumping level 1's room in here would contradict the level's own first
    // sentence. It has no headroom for one either: five depth layers already
    // fill the spectrum from 120 Hz to the top of the bus, which is exactly
    // the analysis above.

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
        // depthTrim is what makes the shared curve a shared LEVEL — see above.
        const target = unlocked
          ? (0.015 + Math.pow(align, 2.6) * 0.4) * this.depthTrim[i] * ctx.audio.audioScale
          : 0;
        v.gain.gain.setTargetAtTime(target, now, i === 0 ? 0.25 : 0.6);
      });

      ctx.setPresence(s.hold);
      ctx.setOrb(align);
      // The five depth words were always the right idea — they name a layer
      // the Seeker has opened, which is earned and cannot be read early. The
      // leak was the gate they hung on: `aligned ? words[...] : 'listening'`
      // is a live binary "you are inside 15°", published every frame, and a
      // Seeker sweeping the circle reads the tolerance window straight off it.
      // Same words, indexed by this level's own reveal ladder and nothing else.
      ctx.setWord(ladderWord(s, this.words, s.hold, this.depthAt.slice(1)));

      if (s.hold >= 100) ctx.complete();
    },

    cleanup(s) {
      if (s.voices) s.voices.forEach((v) => { try { v.src.stop(); } catch (e) { /* stopped */ } });
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

    // NO ROOM LAYER, and this is the clearest case in the file. A frozen
    // river does have a room tone — water moving under ice — and it lives at
    // exactly the frequencies the true cue does: the groan is a lowpass at
    // 140-200 Hz, and it is deliberately the quieter, later, harder voice.
    // A bed there would mask the one sound this level asks the Seeker to
    // prefer over the loud, easy, regular one. Nor can it take impulses: the
    // whole level is a judgement between two kinds of impulse.
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
        // This level has no cumulative presence to ladder — it publishes 0 and
        // then 60 — so its word reports the only earned thing it has: which
        // phase the Seeker's own commit has moved it into. It used to report
        // `angleDiff(yaw, simpleAngle) <= tolerance`, a live aim check, which
        // is the same ground truth the commit is supposed to buy and gave it
        // away for nothing. The commit flashes below stay the earned answer.
        ctx.setWord('ticking, somewhere');
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
      ctx.setWord('something slower, underneath');
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

    /** By the true call held, not by facing — the echoes are the whole problem. */
    words: ['echo, and echo again', 'something small under the din', 'clearer, and late', 'someone is there'],

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
      // A valley, so a floor and nothing else. Sub-bass, well under both cues
      // (a 500 Hz bandpass drone and a 900 Hz true call), and it gives the
      // space a size — this is the first level in the file that is a big
      // outdoors rather than a room. No events of any kind: the level is a
      // discrimination between an echo and a true call, both impulsive, and
      // a third impulse from the scenery would be a decoy the design did not
      // author.
      s.room = audio.room({ beds: [VALLEY] });
      s.voice = audio.voice(s.trueAngle, {
        color: 'brown', filterType: 'bandpass', freq: 500, Q: 0.7, gain: 0,
      });
    },

    update(s, dt, t, ctx) {
      s.room.update(t);
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
      ctx.setWord(ladderWord(s, this.words, s.hold));

      if (s.hold >= 100) ctx.complete();
    },

    cleanup(s) {
      if (s.room) s.room.stop();
      if (s.voice) { try { s.voice.src.stop(); } catch (e) { /* stopped */ } }
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

    /**
     * By the melt earned, not by the heat.
     *
     * This is the largest single removal in this pass and it deserves naming.
     * The word here was `s.temp > 80 ? 'too hot — ease back' : s.temp < 45 ?
     * 'feed it more' : 'holding true heat'` — the two edges of the band and
     * the middle, printed live. That is not a hint toward the answer, it IS
     * the answer: hold until the first, release until the second, repeat, and
     * the level completes with the sound off. The e2e harness does exactly
     * that, and it is committed, so a deaf bang-bang controller clearing this
     * level is not a hypothesis.
     *
     * What the Seeker keeps: the fire bed's own level and brightness, which
     * track temperature continuously (gain 0.05→0.30, centre 220→820 Hz), and
     * `orb.notice` above 80 — a discrete overheat flag, the sanctioned kind of
     * signal, and never the thing that was wrong here. What they lose is the
     * lower edge, which is now audible-only. Whether 45 is findable by ear at
     * this mix is a real question and I cannot answer it from the source;
     * it wants a phone, headphones and a quiet room.
     */
    words: ['the ore is cold', 'the ore softens', 'it runs at the edges', 'nearly liquid'],

    briefing:
      'Ore won’t go liquid on its own. The bellows need breath — but a ' +
      'flame this hungry punishes both a stinting hand and a greedy one.' +
      '<br><br>There is no rhythm to copy here, no beat to match. Hold when ' +
      'it needs air, release when it’s had enough, and mind that what ' +
      'you bank now, you may pay for later.',

    // NO ROOM LAYER. A forge does not drip and has no stone floor to hear
    // under it, and more to the point its room tone IS its cue: the fire bed
    // below is what the Seeker reads temperature from, and any second
    // broadband layer is a masker of the only channel this level has.
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
      ctx.setWord(ladderWord(s, this.words, s.progress));

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

    /** By how long you have stayed with it, not by whether you are on it now. */
    words: ['tracking', 'staying with it', 'it turns, and you turn', 'the wind cannot lose you'],

    briefing:
      'The fire is lit, and a squall has found it. The wind won’t sit ' +
      'still long enough to name a direction and be done with it — it ' +
      'shifts, and shifts again.<br><br>Stay with it anyway. You are not ' +
      'finding a place to rest; you are finding it, over and over, for as ' +
      'long as it keeps changing.',

    // NO ROOM LAYER. The squall is the cue and the fire is the second layer;
    // a third continuous texture is mud. Everything a squall's room would
    // sound like — rain, gusts in cover, more moving air — is broadband and
    // lands on top of a broadband moving cue, which is the worst case for
    // masking in this file.
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
      // not move. Gain tracked the new bearing (and so, at the time, did the
      // on-screen word) while the binaural image stayed nailed to wherever the
      // wind started — a confidently false spatial cue in the level that closes
      // The Trace. The word no longer reports a bearing at all; the panner
      // move is what carries it now, which is the correct channel for it.
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
      ctx.setWord(ladderWord(s, this.words, s.hold));

      if (s.hold >= 100) ctx.complete();
    },

    completionText: () => ({
      text: "The wind circles, doubles back, tries the other side — and every time, you're already there. It gives up before the flame does.",
      sub: "The fire endures its first storm.",
    }),
  },
];
