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
