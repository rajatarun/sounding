/**
 * registry.js — Where the hundred levels are assembled.
 *
 * Levels used to be imported straight from `first-narrowing.js` by App.jsx,
 * which worked at ten and does not work at a hundred: the First Narrowing
 * alone runs to level 40, and at the current density that file would be some
 * three and a half thousand lines before the second era starts.
 *
 * So era modules register here and nothing else imports them. Each exports a
 * flat array of level objects; this file is the only place that knows how many
 * there are, which era a level belongs to, and what is built versus specified.
 * Adding a block of levels is one import and one entry in ERAS.
 *
 * Nothing here validates. `contract.js` does that, and `npm run check` runs it
 * — deliberately separate so the game never pays a validation cost at startup
 * and the checks can be as thorough as they like.
 */
import { NARROWINGS, narrowingFor } from '../engine/constants.js';
import { FIRST_NARROWING } from './first-narrowing.js';

/**
 * The era modules, in order. A new block is added here and nowhere else.
 *
 * `ordinal` ties the module to its entry in NARROWINGS, so a level whose id
 * falls outside its era's range is a check failure rather than a mystery.
 */
export const ERAS = [
  { ordinal: 1, module: 'first-narrowing.js', levels: FIRST_NARROWING },
];

/** Every built level, flat and in id order. */
export const ALL_LEVELS = ERAS
  .flatMap((era) => era.levels)
  .slice()
  .sort((a, b) => a.id - b.id);

/** Built levels keyed by id — what the runtime actually indexes. */
export const LEVELS = {};
ALL_LEVELS.forEach((lv) => { LEVELS[lv.id] = lv; });

/** Ascending ids of every built level. Progress uses this to find "next". */
export const BUILT_IDS = ALL_LEVELS.map((lv) => lv.id);

/** How many levels the game will have when it is finished. */
export const TOTAL_LEVELS = NARROWINGS[NARROWINGS.length - 1].levels[1];

/** The built levels belonging to one era, by ordinal. */
export function levelsInNarrowing(ordinal) {
  return ALL_LEVELS.filter((lv) => narrowingFor(lv.id)?.ordinal === ordinal);
}

/**
 * Build progress per era — what the title chart draws, and the one honest
 * answer to "how far along is this". Counts only; no dates, no times.
 */
export function buildStatus() {
  return NARROWINGS.map((era) => {
    const [from, to] = era.levels;
    return {
      ordinal: era.ordinal,
      name: era.name,
      planned: to - from + 1,
      built: levelsInNarrowing(era.ordinal).length,
    };
  });
}
