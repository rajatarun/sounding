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
 * Disciplines whose every built level is now complete, and which haven't been
 * named to the Seeker yet.
 *
 * This is the rare beat — five times across the ten built levels — and it is
 * deterministic, never random. A Discipline is only named once the player has
 * actually finished practicing it, per docs/DESIGN.md's curriculum pillar.
 */
export function newlyRevealedDiscipline(progress, levels, trialsPerLevel) {
  const byDiscipline = new Map();
  Object.values(levels).forEach((lv) => {
    const key = lv.discipline.name;
    if (!byDiscipline.has(key)) byDiscipline.set(key, []);
    byDiscipline.get(key).push(lv);
  });

  for (const [name, group] of byDiscipline) {
    if (progress.revealed.includes(name)) continue;
    const all = group.every((lv) => isLevelComplete(progress, lv.id, trialsPerLevel));
    if (all) return group[0].discipline;
  }
  return null;
}

export function markRevealed(progress, disciplineName) {
  if (progress.revealed.includes(disciplineName)) return progress;
  return { ...progress, revealed: [...progress.revealed, disciplineName] };
}
