/**
 * sync.test.mjs — the account's copy of progress, and whether it ever arrives.
 *
 * `mirror.js` is the whole point of the account: localStorage stays
 * authoritative, and signing in on a second device folds the account's copy
 * into this one. That fold is one line of shape-matching between two modules
 * that were written apart — `sync.pullProgress` answers `{ ok, blob }` and
 * `mirror.pull` reads `r.data.p` — and if the two ever disagree the failure is
 * *silent*: the merge is skipped, the local copy is returned unchanged, and
 * nothing anywhere reports a problem. A player would see a fresh game on their
 * new phone and have no reason to think anything broke.
 *
 * So the seam is asserted end to end here rather than per-module: encode a
 * remote progress that is plainly further along than this device's, answer the
 * API with it, and require the merged result to carry it.
 *
 * Pure Node, with fetch stubbed. Browser behaviour lives in ui.e2e.mjs.
 */

let pass = 0; const failures = [];
const t = (name, fn) => fn().then(
  () => { console.log(`  PASS  ${name}`); pass++; },
  (e) => { console.log(`  FAIL  ${name}\n          ${e.message}`); failures.push(name); },
);
const assert = (c, m) => { if (!c) throw new Error(m); };

/* A localStorage the engine modules can reach, before any of them load. */
const cell = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (cell.has(k) ? cell.get(k) : null),
    setItem: (k, v) => cell.set(k, String(v)),
    removeItem: (k) => cell.delete(k),
  },
};

const { DISCIPLINES } = await import('../src/engine/constants.js');
const { encode } = await import('../src/account/progress-codec.js');
const { normalizeProgress, loadProgress, saveProgress } = await import('../src/engine/progress.js');
const { configure } = await import('../src/account/sync.js');
const { __setTokensForTest } = await import('../src/account/session.js');
const { pull, push, hasUnsyncedChanges } = await import('../src/account/mirror.js');

configure({ progressApiUrl: 'https://progress.invalid' });

/** A signed-in device, without going near Cognito. */
const asSignedIn = () => __setTokensForTest({ id: 'id-token', access: 'access-token' });
const asSignedOut = () => __setTokensForTest({ id: null, access: null });

/** Replace the whole network with a scripted answer per method. */
function api(routes) {
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    seen.push(method);
    const r = routes[method];
    if (typeof r === 'function') return r(init);
    if (!r) return { ok: false, status: 500, text: async () => '' };
    return { ok: true, status: 200, text: async () => JSON.stringify(r) };
  };
  return seen;
}

/** A device that has finished level 1 and is partway through level 5. */
function aheadOfThisOne() {
  return normalizeProgress({
    done: ['1:1', '1:2', '1:3', '4:1'],
    next: { level: 5, trial: 2 },
    revealed: [DISCIPLINES.TRACE.name],
    everPlayed: true,
  });
}

console.log('\nThe account as a mirror of progress\n' + '─'.repeat(52));

await t('signing in folds the account\'s copy into this device', async () => {
  cell.clear();
  asSignedIn();
  const remote = aheadOfThisOne();
  api({ GET: { p: encode(remote, DISCIPLINES) } });

  const local = loadProgress();
  assert(local.next.level === 1, `the fixture is not a fresh device: ${JSON.stringify(local.next)}`);

  const merged = await pull();
  assert(merged, 'pull() returned nothing at all');
  assert(
    merged.next.level === 5 && merged.next.trial === 2,
    `the account's resume point never arrived: local was level 1, the account said level 5 trial 2, `
    + `the merge produced ${JSON.stringify(merged.next)}`,
  );
  assert(
    merged.done.includes('1:1') && merged.done.includes('4:1'),
    `finished trials from the account were dropped: ${JSON.stringify(merged.done)}`,
  );
});

await t('what push() sends is what pull() restores', async () => {
  cell.clear();
  asSignedIn();
  const sent = [];
  api({
    PUT: (init) => { sent.push(JSON.parse(init.body).p); return { ok: true, status: 200, text: async () => '' }; },
    GET: () => ({ ok: true, status: 200, text: async () => JSON.stringify({ p: sent[sent.length - 1] }) }),
  });

  const mine = aheadOfThisOne();
  await push(mine);
  assert(sent.length === 1, 'push() sent nothing');

  cell.clear(); // a different device, nothing stored
  const merged = await pull();
  assert(
    merged && merged.next.level === mine.next.level && merged.next.trial === mine.next.trial,
    `round trip lost the resume point: sent ${JSON.stringify(mine.next)}, got ${JSON.stringify(merged && merged.next)}`,
  );
});

await t('a merge never rolls this device back', async () => {
  cell.clear();
  asSignedIn();
  saveProgress(normalizeProgress({ done: ['1:1', '1:2', '1:3', '2:1'], next: { level: 6, trial: 1 }, everPlayed: true }));
  api({ GET: { p: encode(aheadOfThisOne(), DISCIPLINES) } });

  const merged = await pull();
  assert(merged, 'pull() returned nothing at all');
  assert(merged.next.level === 6, `the further-along local resume point was overwritten: ${JSON.stringify(merged.next)}`);
  assert(merged.done.includes('4:1'), `the union dropped a trial the account had finished: ${JSON.stringify(merged.done)}`);
  assert(merged.done.includes('2:1'), `the union dropped a trial this device had finished: ${JSON.stringify(merged.done)}`);
});

await t('an unreachable progress API leaves local progress alone and says so later', async () => {
  cell.clear();
  asSignedIn();
  saveProgress(normalizeProgress({ done: ['1:1'], next: { level: 3, trial: 1 }, everPlayed: true }));
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };

  const merged = await pull();
  assert(merged === null, 'a failed pull should return nothing rather than a half-merge');
  assert(loadProgress().next.level === 3, 'a failed pull touched local progress');
  assert(hasUnsyncedChanges(), 'a failed sync left no resting fact for the account screen');
});

await t('a push failure is remembered, and a later success clears it', async () => {
  cell.clear();
  asSignedIn();
  globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => '' });
  await push(aheadOfThisOne());
  assert(hasUnsyncedChanges(), 'a 5xx push was not recorded as unsynced');

  api({ PUT: {} });
  await push(aheadOfThisOne());
  assert(!hasUnsyncedChanges(), 'a successful push did not clear the unsynced flag');
});

await t('a blob this build cannot read never costs the player their local copy', async () => {
  cell.clear();
  asSignedIn();
  saveProgress(normalizeProgress({ done: ['1:1'], next: { level: 2, trial: 3 }, everPlayed: true }));
  api({ GET: { p: 'not-a-valid-blob' } });

  const merged = await pull();
  assert(merged, 'pull() returned nothing for an unreadable blob');
  assert(merged.next.level === 2 && merged.next.trial === 3, `local progress was lost to a bad blob: ${JSON.stringify(merged.next)}`);
});

await t('a signed-out device never calls the progress API', async () => {
  cell.clear();
  asSignedOut();
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, status: 200, text: async () => '{}' }; };
  await pull();
  await push(aheadOfThisOne());
  assert(!called, 'the progress API was called with no session');
});

console.log(`\n${pass} passed, ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
