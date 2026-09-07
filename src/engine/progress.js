/**
 * progress.js — Where a session is picked back up.
 *
 * Trial boundaries are save points. A Seeker who stops after the first trial
 * of a level returns to exactly that place: nothing re-earned, nothing
 * re-explained. This is deliberately the *only* thing persisted — there is no
 * score to store, no streak to break, and no record of how long anything took.
 * A gap of one day and a gap of one year read identically here, which is the
 * point: coming back is never something the game can tell you that you did
 * late.
 */

const KEY = 'sounding:progress:v1';

const EMPTY = {
  /** "level:trial" strings for trials that have been completed. */
  done: [],
  /** Where "Continue" resumes. */
  next: { level: 1, trial: 1 },
  /** Discipline keys whose built levels are all complete (the rare reveal). */
  revealed: [],
  /** False until the very first trial is entered — gates onboarding scaffolding. */
  everPlayed: false,
};

const trialKey = (level, trial) => `${level}:${trial}`;

/** Reading storage can throw outright in private mode — never let that be fatal. */
export function loadProgress() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return {
      ...EMPTY,
      ...parsed,
      next: { ...EMPTY.next, ...(parsed.next || {}) },
      done: Array.isArray(parsed.done) ? parsed.done : [],
      revealed: Array.isArray(parsed.revealed) ? parsed.revealed : [],
    };
  } catch (e) {
    return { ...EMPTY };
  }
}

export function saveProgress(progress) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(progress));
  } catch (e) {
    /* private mode: the session simply doesn't survive a reload */
  }
  return progress;
}

/**
 * Record that a trial has been *entered*.
 *
 * `everPlayed` gates the onboarding scaffolding, and it used to be set only by
 * completeTrial() — on success. That had two costs. A Seeker who played for
 * four minutes and closed the tab came back to a screen with no Continue
 * button and no trace of them; and, because `firstEver` is its inverse, the
 * level-1 seeding and the action line repeated indefinitely for anyone who
 * never finished a trial — the one population they were written to exclude.
 * CLAUDE.md documents that assist as retired permanently after the first
 * trial, so this is the line that makes the code keep the documented contract.
 */
export function enterTrial(progress) {
  if (progress.everPlayed) return progress;
  return { ...progress, everPlayed: true };
}

/**
 * Has this Seeker already practised a given control scheme?
 *
 * Used to decide whether a level's plain-verb `actionLine` still needs to be
 * shown. The First Narrowing introduces three schemes — hold, commit, breathe
 * — at levels 1, 2 and 4, and scaffolding that retires after the first trial
 * ever stops exactly one level before the controls first change.
 */
export function hasPractisedControl(progress, levels, control, trialsPerLevel) {
  return Object.values(levels).some(
    (lv) => lv.control === control && trialsDone(progress, lv.id, trialsPerLevel) > 0,
  );
}

export function isTrialDone(progress, level, trial) {
  return progress.done.includes(trialKey(level, trial));
}

/** How far into a level the Seeker has already gone, 0 to trialsPerLevel. */
export function trialsDone(progress, level, trialsPerLevel) {
  let n = 0;
  for (let t = 1; t <= trialsPerLevel; t++) if (isTrialDone(progress, level, t)) n++;
  return n;
}

export function isLevelComplete(progress, level, trialsPerLevel) {
  return trialsDone(progress, level, trialsPerLevel) >= trialsPerLevel;
}

/** The trial a level should open on — the first one not yet finished. */
export function nextTrialFor(progress, level, trialsPerLevel) {
  for (let t = 1; t <= trialsPerLevel; t++) if (!isTrialDone(progress, level, t)) return t;
  return trialsPerLevel;
}

/**
 * Record a finished trial and move the resume point forward: the next trial
 * of this level, or the first trial of the next built level once this one is
 * done. Returns a new progress object; the caller persists it.
 */
export function completeTrial(progress, level, trial, { trialsPerLevel, builtIds }) {
  const done = progress.done.includes(trialKey(level, trial))
    ? progress.done
    : [...progress.done, trialKey(level, trial)];
  const withTrial = { ...progress, done, everPlayed: true };

  let next;
  if (trial < trialsPerLevel) {
    next = { level, trial: trial + 1 };
  } else {
    const following = builtIds.find((id) => id > level);
    next = following ? { level: following, trial: 1 } : { level, trial: trialsPerLevel };
  }
  return { ...withTrial, next };
}

/**
 * The Discipline, if any, that the Seeker has just earned the naming of.
 *
 * This used to ask whether *every* built level practising a Discipline was
 * complete. That made the position of the game's rarest beat a function of the
 * build backlog: FILTER is {2,3,8} today and lands at level 8, but shipping
 * five more FILTER levels in the 11-40 block would silently move it to level
 * 35 — retroactively, for every new Seeker. A beat whose timing drifts with
 * what happens to be built next is not a designed beat.
 *
 * So the closing level of each Discipline is now authored, with
 * `revealsDiscipline: true`. The flags are placed to reproduce exactly the
 * reveals the old rule produced across the ten built levels (6, 7, 8, 9, 10) —
 * this is a correctness fix, not a re-pacing. Whether a reveal should land
 * earlier is a design decision, and it now lives in one editable field per
 * level instead of emerging from set arithmetic.
 *
 * Still deterministic, still never random, still only after genuine practice.
 */
export function newlyRevealedDiscipline(progress, levels, trialsPerLevel) {
  for (const lv of Object.values(levels)) {
    if (!lv.revealsDiscipline) continue;
    if (progress.revealed.includes(lv.discipline.name)) continue;
    if (isLevelComplete(progress, lv.id, trialsPerLevel)) return lv.discipline;
  }
  return null;
}

export function markRevealed(progress, disciplineName) {
  if (progress.revealed.includes(disciplineName)) return progress;
  return { ...progress, revealed: [...progress.revealed, disciplineName] };
}
