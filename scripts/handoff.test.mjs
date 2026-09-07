/**
 * handoff.test.mjs — the origin move must not lose anyone's place.
 *
 * SOUNDING moved from https://aiweave.org/sounding/ to its own origin, and
 * browser storage is scoped to the origin. Every Seeker who played before the
 * move has their only save on the old one. `legacy-origin/index.html` hands it
 * over in the URL fragment and `src/engine/handoff.js` receives it.
 *
 * The merge is the part worth testing: it runs on a document that arrived from
 * outside, it can run more than once, and it can run in either order relative
 * to play on the new origin. Getting it wrong rolls a player backwards, which
 * in a game with no scores and no dates is the only harm the save file can
 * come to.
 *
 * Pure Node, no browser and no dependency — the full two-origin redirect is
 * exercised separately against Chromium.
 */
import { mergeProgress } from '../src/engine/handoff.js';

let pass = 0; const failures = [];
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); failures.push(name); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const P = (done, level, trial, revealed = [], everPlayed = true) =>
  ({ done, next: { level, trial }, revealed, everPlayed });

console.log('\nHandoff merge\n' + '─'.repeat(52));

t('carries a save onto an empty origin', () => {
  const m = mergeProgress(P([], 1, 1, [], false), P(['1:1', '1:2'], 1, 3));
  assert(m.done.length === 2, 'trials lost');
  assert(m.next.level === 1 && m.next.trial === 3, 'resume point lost');
  assert(m.everPlayed === true, 'everPlayed lost');
});

t('never rolls a player backwards', () => {
  const ahead = P(['1:1', '1:2', '1:3', '2:1'], 2, 2);
  const behind = P(['1:1'], 1, 2);
  for (const m of [mergeProgress(ahead, behind), mergeProgress(behind, ahead)]) {
    assert(m.next.level === 2 && m.next.trial === 2, `rolled back to ${JSON.stringify(m.next)}`);
    assert(m.done.length === 4, 'work lost');
  }
});

t('advances the trial within a level', () => {
  assert(mergeProgress(P([], 3, 1), P([], 3, 3)).next.trial === 3, 'trial not advanced');
});

t('is order-independent', () => {
  const a = P(['1:1', '3:2'], 3, 3, ['The Plumb']);
  const b = P(['2:1'], 2, 1, ['The Frame']);
  assert(JSON.stringify(mergeProgress(a, b)) === JSON.stringify(mergeProgress(b, a)),
    'merge depends on argument order');
});

t('is idempotent — following the old bookmark twice is harmless', () => {
  const a = P(['1:1', '1:2'], 1, 3, ['The Trace']);
  const once = mergeProgress(a, a);
  assert(JSON.stringify(once) === JSON.stringify(mergeProgress(once, a)), 'second pass changed the document');
});

t('unions trials rather than replacing them', () => {
  const m = mergeProgress(P(['1:1', '1:2'], 1, 3), P(['1:1', '4:1'], 4, 2));
  assert(m.done.length === 3 && m.done.includes('4:1') && m.done.includes('1:2'), `got ${m.done}`);
});

t('never loses a named Discipline, and never duplicates one', () => {
  const m = mergeProgress(P([], 7, 1, ['The Plumb']), P([], 7, 1, ['The Plumb', 'The Frame']));
  assert(m.revealed.length === 2, `got ${m.revealed}`);
});

t('adds no field the store does not already define', () => {
  const keys = Object.keys(mergeProgress(P(['1:1'], 1, 2), P(['1:2'], 1, 3))).sort();
  assert(JSON.stringify(keys) === '["done","everPlayed","next","revealed"]',
    `the merge invented a field: ${keys}`);
});

console.log(`\n${pass} passed, ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
