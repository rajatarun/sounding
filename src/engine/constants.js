/**
 * constants.js — Tuning values and world vocabulary.
 *
 * Everything here is deliberately in one file: these are the numbers most
 * likely to be re-tuned from playtesting, and the words most likely to appear
 * in UI copy. Change them here, not inline in levels.
 */

/** Trials per level. Each repeats the level at lower audio clarity. */
export const TRIALS_PER_LEVEL = 3;

/**
 * Per-trial audio scaling. Trial 1 is full clarity; each subsequent trial is
 * quieter, framed to the player as "a deeper kind of listening" rather than
 * a difficulty tier. There is no score gate — completing a trial advances.
 */
export const TRIAL_AUDIO_SCALE = [1.0, 0.72, 0.50];

/**
 * Cumulative-presence marks the loom answers with a dye front.
 *
 * These live here rather than in GameScreen because they are a *curriculum*
 * constant, not a chrome one: a level's `depthAt` thresholds have to be read
 * against them. A reveal landing a few points after a mark is perceived as
 * having been caused by it, which quietly turns the mark into the stinger
 * CLAUDE.md forbids. `npm run check` warns when the two collide.
 *
 * Fixed and deterministic on purpose — see CLAUDE.md. A predictable tick is a
 * progress bar with marks on it; an unpredictable one is a reward schedule.
 */
export const PRESENCE_MARKS = [25, 50, 75, 100];

/** How far presence must fall back before a mark can answer again. */
export const MARK_REARM = 12;

/**
 * How close a `depthAt` threshold may sit above a presence mark before the
 * two read as one event. Used by the level contract check.
 */
export const MARK_CLEARANCE = 8;

/**
 * The room layer's headroom against the cue, in A-WEIGHTED decibels.
 *
 * A level's room — a cave's drips, a hollow's floor — sits underneath the
 * alignment-carrying voice at every alignment value. These numbers are what
 * "underneath" means.
 *
 * WHY A-WEIGHTED, and it is the whole reason the room shipped inaudible. This
 * game is played at the threshold of hearing: the Seeker sets device volume so
 * a 500 Hz reference tone is barely there. A flat RMS says nothing about
 * audibility down there, because the ear's sensitivity falls off a cliff below
 * about 200 Hz. The 85 Hz bed this file shipped measured 4.7 dB under the cue's
 * misaligned floor flat — comfortably inside the old rule — and 18.3 dB under
 * it A-weighted, which is 26.9 dB below the Seeker's own reference. Not quiet:
 * absent. Every number here is now weighted, and `npm run test:audio` reports
 * both so the gap between them stays visible.
 *
 *   bedBelowCue      A bed runs continuously, so it is judged against the cue
 *                    at FULL alignment: the thing the Seeker steers toward must
 *                    stay the loudest thing in the mix by a wide margin.
 *   eventBelowCue    A drip competes only for the tenths of a second it lasts,
 *                    so it is judged over the loudest ~43 ms window. The margin
 *                    is smaller because the duty cycle is a few percent, and it
 *                    is not zero because an event must never BE the cue's peak.
 *   bedInCueBand     The one per-band rule, and the one that actually protects
 *                    the mechanic: a bed's energy inside the cue's own critical
 *                    band, against what the cue's misaligned floor puts there.
 *                    Broadband level is a register question; this is the
 *                    masking question, and only this one can flatten the bottom
 *                    of the alignment gradient the Seeker is hunting along.
 *
 * WHAT WAS DROPPED, named rather than quietly widened. The old rule bounded a
 * bed against the cue's MISALIGNED FLOOR broadband. That floor sits 8.6 dB
 * below the calibration reference A-weighted — below the Seeker's own
 * just-audible point — so "quieter than the floor" and "inaudible" were the
 * same requirement, and no room a person could hear could ever have satisfied
 * it. The shipped beds now sit ABOVE that floor broadband, by design and at the
 * project owner's direction, which is a real relaxation of a stated pillar: the
 * room is no longer guaranteed to be quieter than the cue at its quietest.
 * What replaces the guarantee is narrower and more honest — the cue at full
 * alignment still dominates by 17 dB, and the cue's own band stays cleaner than
 * its own floor leaves it.
 *
 * These are ceilings, not targets. Like everything in this file they are
 * reasoned and rendered, never validated against an ear.
 */
export const ROOM_CEILING = { bedBelowCue: 12, eventBelowCue: 3, bedInCueBand: 2 };

/**
 * THE NARROWINGS — the four eras.
 *
 * Level counts follow a 4:3:2:1 compression. This is a production decision as
 * much as a thematic one: the cheapest content to build (contemplative,
 * single-mechanic, reusing the First Narrowing engine) is where there are the
 * most levels; the most expensive (real-time systems, fail states, simulation)
 * is where there are the fewest.
 *
 * Session length runs inversely — a First Narrowing level may be a 20-minute
 * sit, a Fourth Narrowing level 90 seconds of precision. Total playtime across
 * eras stays roughly balanced despite the uneven level counts.
 */
export const NARROWINGS = [
  {
    ordinal: 1,
    name: 'The First Narrowing',
    levels: [1, 40],
    pacing: 'stillness',
    fails: false,
    summary: 'No timers, no fail states. Sustained-presence holds. The player is being trained, not tested.',
  },
  {
    ordinal: 2,
    name: 'The Second Narrowing',
    levels: [41, 70],
    pacing: 'stillness, lightly tested',
    fails: false,
    summary: 'Unhurried judgment and resource balance, with occasional soft multi-cycle deadlines.',
  },
  {
    ordinal: 3,
    name: 'The Third Narrowing',
    levels: [71, 90],
    pacing: 'urgency',
    fails: true,
    summary: 'Real-time pressure as systemic crises escalate. Precision-under-clock enters the design.',
  },
  {
    ordinal: 4,
    name: 'The Fourth Narrowing',
    levels: [91, 100],
    pacing: 'full spectrum',
    fails: true,
    summary: 'Oscillates between the most extreme urgency in the game and its most expansive stillness.',
  },
];

export function narrowingFor(levelId) {
  return NARROWINGS.find((n) => levelId >= n.levels[0] && levelId <= n.levels[1]);
}

/**
 * THE FIVE FORCES — the physical phenomena the player learns to perceive.
 * Named as phenomena, not personified.
 */
export const FORCES = {
  DRIFT: { name: 'Drift', domain: 'Vector and velocity — moving air', channel: 'HRTF spatial audio' },
  IGNITION: { name: 'Ignition', domain: 'Thermal energy, transformation', channel: 'Volumetric light, particle dissipation' },
  FLOW: { name: 'Flow', domain: 'Pressure, fluid dynamics, balance', channel: 'Surface shaders, low-frequency audio' },
  MASS: { name: 'Mass', domain: 'Density, gravity, seismic resonance', channel: 'Haptic pulses' },
  VOID: { name: 'Void', domain: 'Space, echo delay, negative space', channel: 'Reverb and echo-delay' },
};

/** The two systemic failure modes the player learns to diagnose. */
export const FAILURE_MODES = {
  WEIGHT: { name: 'The Weight', meaning: 'Rigidity, inertia, unchecked growth, deadlock' },
  BLOOM: { name: 'The Bloom', meaning: 'Cascading feedback — every patch spawns two new failures' },
};

/**
 * THE FIVE DISCIPLINES — the reasoning tools.
 * Each is simultaneously an acoustics term and a cognitive operation, so the
 * philosophy and the medium share one vocabulary.
 */
export const DISCIPLINES = {
  FILTER: { name: 'The Filter', op: 'Strip away what is false until only the irreducible remains' },
  TRACE: { name: 'The Trace', op: 'Infer an unseen cause from its observable effects' },
  FRAME: { name: 'The Frame', op: 'Build a temporary simplified model, then dismantle it' },
  PLUMB: { name: 'The Plumb', op: 'Diagnose across five nested depths, surface to core' },
  BALANCE: { name: 'The Balance', op: 'Nothing can be hoarded without cost elsewhere' },
};

/** The five nested depths examined by The Plumb, outermost to innermost. */
export const DEPTHS = ['Shell', 'Current', 'Weather', 'Lattice', 'Core'];
