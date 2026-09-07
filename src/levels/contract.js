/**
 * contract.js — What a level must be, checked rather than described.
 *
 * The level interface has always been a comment at the top of a file. That
 * held at ten levels because ten levels fit in one reading. It will not hold
 * at a hundred, and the evidence is already in: a four-reviewer, three-round
 * audit of ten levels found a source whose panner never moved, a reward tone
 * that never scaled with the trial, and three voices sitting 15.6 dB above
 * everything around them. Every one of those was visible in the source the
 * whole time. Prose does not catch that; a check run does.
 *
 * Two severities, and the distinction matters:
 *
 *   ERROR   the level is malformed or breaks a rule the game relies on.
 *           `npm run check` exits non-zero. These must never be committed.
 *   WARNING something a person should look at and may legitimately keep.
 *           Reported, never blocking — a warning that blocks becomes a
 *           warning that gets suppressed.
 *
 * This module is pure: no DOM, no audio context, no imports from the runtime.
 * It reads level objects and their source text and returns findings.
 */
import {
  DISCIPLINES, FORCES, NARROWINGS, narrowingFor,
  PRESENCE_MARKS, MARK_CLEARANCE, TRIALS_PER_LEVEL,
} from '../engine/constants.js';

const CONTROLS = ['hold', 'commit', 'breathe'];
const DISCIPLINE_NAMES = Object.values(DISCIPLINES).map((d) => d.name);
const FORCE_NAMES = Object.values(FORCES).map((f) => f.name);

const err = (level, rule, message) => ({ severity: 'error', level, rule, message });
const warn = (level, rule, message) => ({ severity: 'warning', level, rule, message });

/** Shape: the fields and callbacks the runtime will actually reach for. */
function checkShape(lv) {
  const out = [];
  const id = lv.id ?? '?';

  for (const field of ['id', 'name', 'briefing']) {
    if (!lv[field]) out.push(err(id, 'shape', `missing \`${field}\``));
  }
  for (const fn of ['init', 'update', 'completionText']) {
    if (typeof lv[fn] !== 'function') out.push(err(id, 'shape', `\`${fn}\` must be a function`));
  }

  if (!CONTROLS.includes(lv.control)) {
    out.push(err(id, 'shape', `control must be one of ${CONTROLS.join(' | ')} — got ${JSON.stringify(lv.control)}`));
  }
  // A control scheme whose handler is missing is a level the Seeker cannot
  // finish, and it fails silently: the button renders and does nothing.
  if (lv.control === 'commit') {
    if (typeof lv.onCommit !== 'function') out.push(err(id, 'shape', "control 'commit' requires onCommit()"));
    if (!lv.commitLabel) out.push(err(id, 'shape', "control 'commit' requires commitLabel"));
  }
  if (lv.control === 'breathe' && typeof lv.onBreathe !== 'function') {
    out.push(err(id, 'shape', "control 'breathe' requires onBreathe()"));
  }

  if (!lv.discipline || !DISCIPLINE_NAMES.includes(lv.discipline.name)) {
    out.push(err(id, 'vocabulary', 'discipline must come from DISCIPLINES in constants.js'));
  }
  if (!lv.force || !FORCE_NAMES.includes(lv.force.name)) {
    out.push(err(id, 'vocabulary', 'force must come from FORCES in constants.js'));
  }
  return out;
}

/** Era: a level must sit inside a Narrowing and honour that era's contract. */
function checkEra(lv, declaredOrdinal) {
  const out = [];
  const era = narrowingFor(lv.id);
  if (!era) {
    out.push(err(lv.id, 'era', `id ${lv.id} falls outside every Narrowing (1..${NARROWINGS.at(-1).levels[1]})`));
    return out;
  }
  if (declaredOrdinal != null && era.ordinal !== declaredOrdinal) {
    out.push(err(lv.id, 'era', `registered under Narrowing ${declaredOrdinal} but its id belongs to ${era.ordinal}`));
  }
  // The era contract, enforced rather than described. NARROWINGS.fails has
  // been data nothing read since it was written; a no-fail era that grows a
  // fail state is the single most damaging thing that can happen to the
  // First Narrowing, and the contrast with the Third is the whole design.
  if (!era.fails) {
    for (const field of ['fails', 'timeLimit', 'countdown', 'lives', 'score']) {
      if (lv[field] !== undefined) {
        out.push(err(lv.id, 'era-contract',
          `\`${field}\` is set, but ${era.name} cannot fail or score (NARROWINGS.fails === false)`));
      }
    }
  }
  return out;
}

/**
 * Reveal marks: exactly one closing level per Discipline, and never one that
 * names a Discipline before the Seeker has finished practising it.
 */
function checkDisciplineClosers(levels) {
  const out = [];
  const byDiscipline = new Map();
  levels.forEach((lv) => {
    const key = lv.discipline?.name;
    if (!key) return;
    if (!byDiscipline.has(key)) byDiscipline.set(key, []);
    byDiscipline.get(key).push(lv);
  });

  for (const [name, group] of byDiscipline) {
    const closers = group.filter((lv) => lv.revealsDiscipline);
    if (closers.length === 0) {
      out.push(warn(group.at(-1).id, 'reveal',
        `${name} is practised by ${group.length} built level(s) but none carries revealsDiscipline — it can never be named`));
    }
    if (closers.length > 1) {
      out.push(err(closers[1].id, 'reveal',
        `${name} has ${closers.length} closing levels (${closers.map((l) => l.id).join(', ')}) — exactly one may carry revealsDiscipline`));
    }
    // Naming before practising inverts pillar 5: the Discipline is supposed to
    // be recognised, not introduced.
    if (closers.length === 1) {
      const later = group.filter((lv) => lv.id > closers[0].id);
      if (later.length) {
        out.push(err(closers[0].id, 'reveal',
          `${name} is named at level ${closers[0].id} but still practised later at ${later.map((l) => l.id).join(', ')} — it would be named before it is finished`));
      }
    }
  }
  return out;
}

/**
 * Depth reveals must not sit within a few points of a presence mark.
 *
 * A layer opening close to a mark is heard as *one event* with it, which turns
 * a deliberately silent dye front into the stinger CLAUDE.md forbids — by
 * coupling rather than intent, which is why it survived four reviewers. At
 * level 1's hold rate, five points of presence is about 1.2 seconds.
 *
 * Proximity is checked in both directions on purpose. A reveal landing *after*
 * a mark reads as the mark's answer (level 1 opens its third layer at 80
 * against a mark at 75). A reveal landing *before* one reads as having summoned
 * it. Both couple two channels the design keeps apart; only the story the
 * player invents differs.
 */
function checkMarkCollisions(lv) {
  const out = [];
  if (!Array.isArray(lv.depthAt)) return out;
  for (const threshold of lv.depthAt) {
    for (const mark of PRESENCE_MARKS) {
      const gap = threshold - mark;
      if (gap === 0 || Math.abs(gap) >= MARK_CLEARANCE) continue;
      const how = gap > 0
        ? `lands ${gap} point(s) after the ${mark}% mark — it will read as the mark's answer`
        : `opens ${-gap} point(s) before the ${mark}% mark — the mark will read as answering it`;
      out.push(warn(lv.id, 'mark-collision', `depth reveal at ${threshold}% ${how}`));
    }
  }
  return out;
}

/**
 * Audio routing, read from the level's own source text.
 *
 * These are exactly the four defects the audit found, expressed as rules so
 * they cannot come back. Source-text checks are blunt, but the alternative is
 * running every level's audio graph, and blunt-and-run-every-commit beats
 * precise-and-run-never.
 */
export function checkAudioSource(source, label = 'level source') {
  const out = [];
  const line = (idx) => source.slice(0, idx).split('\n').length;

  for (const m of source.matchAll(/\baudio\.bus\b|\bctx\.audio\.bus\b/g)) {
    out.push(err(`${label}:${line(m.index)}`, 'audio-routing',
      'connects straight to the bus, skipping the reference plane — use audio.nonPositioned'));
  }
  for (const m of source.matchAll(/\bpositionPanner\s*\(/g)) {
    out.push(err(`${label}:${line(m.index)}`, 'audio-routing',
      'positionPanner assigns without ramping — a level that moves a source must use movePanner'));
  }
  // A per-frame gain write that forgets the trial scaling produces a voice
  // identically loud on trial 3 as on trial 1 — precisely what "a deeper kind
  // of listening" promises it is not. This is how level 4's reward tone, the
  // one sound the Seeker earns, stayed at full strength on every trial.
  //
  // The value is often computed a line earlier, so a bare identifier is
  // resolved back to its assignment before the write is called unscaled.
  for (const m of source.matchAll(/\.gain\.setTargetAtTime\(\s*([\s\S]{0,240}?)\)\s*;/g)) {
    const args = m[1];
    let text = args;
    const bare = args.match(/^\s*([A-Za-z_$][\w$]*)\s*,/);
    if (bare) {
      const decl = new RegExp(`\\b${bare[1]}\\s*=([\\s\\S]{0,240}?);`);
      const before = source.slice(Math.max(0, m.index - 600), m.index);
      const found = before.match(decl);
      if (found) text += found[1];
    }
    if (!/audioScale/.test(text)) {
      out.push(warn(`${label}:${line(m.index)}`, 'audio-scale',
        'per-frame gain write with no audioScale — this voice will not get quieter on later trials'));
    }
  }
  return out;
}

/** Run every structural check over a registry. Source checks are separate. */
export function checkLevels(eras) {
  const findings = [];
  const seen = new Map();

  for (const era of eras) {
    for (const lv of era.levels) {
      if (seen.has(lv.id)) {
        findings.push(err(lv.id, 'shape', `duplicate id — also defined in ${seen.get(lv.id)}`));
      }
      seen.set(lv.id, era.module);
      findings.push(...checkShape(lv));
      findings.push(...checkEra(lv, era.ordinal));
      findings.push(...checkMarkCollisions(lv));
    }
  }

  const all = eras.flatMap((e) => e.levels).slice().sort((a, b) => a.id - b.id);
  findings.push(...checkDisciplineClosers(all));

  // Continuity: a gap in the built range means a resume point can step over a
  // level, and the title chart draws a hole.
  for (let i = 1; i < all.length; i++) {
    if (all[i].id !== all[i - 1].id + 1) {
      findings.push(warn(all[i].id, 'continuity',
        `gap in built levels between ${all[i - 1].id} and ${all[i].id}`));
    }
  }

  // The plain verb is what makes a new control scheme learnable; the Seeker
  // meets each of the three exactly once.
  const firstOfControl = new Map();
  all.forEach((lv) => { if (!firstOfControl.has(lv.control)) firstOfControl.set(lv.control, lv); });
  for (const [control, lv] of firstOfControl) {
    if (!lv.actionLine) {
      findings.push(warn(lv.id, 'scaffolding',
        `level ${lv.id} introduces control '${control}' with no actionLine — the plain verb is never shown for it`));
    }
  }

  return findings;
}

export const CONTRACT_META = { TRIALS_PER_LEVEL, CONTROLS, MARK_CLEARANCE };
