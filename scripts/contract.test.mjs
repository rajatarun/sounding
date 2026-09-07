/**
 * contract.test.mjs — `npm test`.
 *
 * Proves the level contract catches the defects it was written for. Every case
 * below is a real bug that shipped in this project and survived review, or a
 * malformation the runtime would fail silently on.
 */
import { checkLevels, checkAudioSource } from '../src/levels/contract.js';
import { DISCIPLINES, FORCES } from '../src/engine/constants.js';

let pass = 0; const failures = [];
const has = (findings, rule, severity) =>
  findings.some((f) => f.rule === rule && (!severity || f.severity === severity));

function t(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); failures.push(name); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

const base = (over = {}) => ({
  id: 1, name: 'A Level', discipline: DISCIPLINES.TRACE, force: FORCES.DRIFT,
  control: 'hold', briefing: 'x', actionLine: 'Turn, then stay.',
  init() {}, update() {}, completionText: () => ({}),
  ...over,
});
const era = (levels, ordinal = 1) => [{ ordinal, module: 'test.js', levels }];

console.log('\nLevel contract\n' + '─'.repeat(52));

t('accepts a well-formed level', () => {
  assert(checkLevels(era([base({ revealsDiscipline: true })])).length === 0, 'clean level produced findings');
});

t('catches a control scheme with no handler (silent dead button)', () => {
  const f = checkLevels(era([base({ control: 'commit' })]));
  assert(has(f, 'shape', 'error'), 'commit without onCommit not flagged');
});

t('catches a misspelled control', () => {
  assert(has(checkLevels(era([base({ control: 'holdd' })])), 'shape', 'error'), 'bad control not flagged');
});

t('catches vocabulary invented outside constants.js', () => {
  const f = checkLevels(era([base({ discipline: { name: 'The Whisper' } })]));
  assert(has(f, 'vocabulary', 'error'), 'off-vocabulary discipline not flagged');
});

t('catches a fail state in a no-fail era (the First Narrowing contract)', () => {
  const f = checkLevels(era([base({ timeLimit: 30 })]));
  assert(has(f, 'era-contract', 'error'), 'timeLimit in era 1 not flagged');
  const g = checkLevels(era([base({ score: 10 })]));
  assert(has(g, 'era-contract', 'error'), 'score in era 1 not flagged');
});

t('catches a level registered under the wrong era', () => {
  const f = checkLevels(era([base({ id: 75 })], 1));
  assert(has(f, 'era', 'error'), 'era mismatch not flagged');
});

t('catches an id past the end of the game', () => {
  assert(has(checkLevels(era([base({ id: 101 })])), 'era', 'error'), 'out-of-range id not flagged');
});

t('catches duplicate ids', () => {
  const f = checkLevels(era([base({ revealsDiscipline: true }), base({ name: 'Twin' })]));
  assert(has(f, 'shape', 'error'), 'duplicate id not flagged');
});

t('catches two closers for one Discipline', () => {
  const f = checkLevels(era([
    base({ id: 1, revealsDiscipline: true }),
    base({ id: 2, revealsDiscipline: true }),
  ]));
  assert(has(f, 'reveal', 'error'), 'double closer not flagged');
});

t('catches a Discipline named before it is finished being practised', () => {
  const f = checkLevels(era([
    base({ id: 1, revealsDiscipline: true }),
    base({ id: 2 }),
  ]));
  assert(has(f, 'reveal', 'error'), 'premature naming not flagged');
});

t('warns when a Discipline can never be named', () => {
  assert(has(checkLevels(era([base()])), 'reveal', 'warning'), 'unreachable reveal not flagged');
});

t('warns on a depth reveal colliding with a presence mark', () => {
  const f = checkLevels(era([base({ depthAt: [0, 45, 80], revealsDiscipline: true })]));
  assert(f.filter((x) => x.rule === 'mark-collision').length === 2, 'expected both collisions');
});

t('warns when a new control scheme has no plain verb', () => {
  const f = checkLevels(era([base({ revealsDiscipline: true, actionLine: undefined })]));
  assert(has(f, 'scaffolding', 'warning'), 'missing actionLine not flagged');
});

t('warns on a gap in the built range', () => {
  const f = checkLevels(era([base({ id: 1, revealsDiscipline: true }), base({ id: 5, discipline: DISCIPLINES.FILTER })]));
  assert(has(f, 'continuity', 'warning'), 'gap not flagged');
});

console.log('\nAudio routing (source text)\n' + '─'.repeat(52));

t('catches a voice connected straight to the bus (+15.6 dB, level 4 and 9)', () => {
  assert(has(checkAudioSource('gain.connect(audio.bus);'), 'audio-routing', 'error'), 'bus bypass not flagged');
});

t('accepts the reference-plane seam', () => {
  assert(checkAudioSource('gain.connect(audio.nonPositioned);').length === 0, 'nonPositioned wrongly flagged');
});

t('catches positionPanner used to move a source (level 10 zipper noise)', () => {
  assert(has(checkAudioSource('ctx.audio.positionPanner(s.voice.panner, s.a);'), 'audio-routing', 'error'), 'unramped move not flagged');
});

t('accepts movePanner', () => {
  assert(checkAudioSource('ctx.audio.movePanner(s.voice.panner, s.a);').length === 0, 'movePanner wrongly flagged');
});

t('catches a gain write with no trial scaling (level 4 reward tone)', () => {
  assert(has(checkAudioSource('s.nodes.resGain.gain.setTargetAtTime((s.sync / 100) * 0.2, now, 0.25);'), 'audio-scale', 'warning'),
    'unscaled gain not flagged');
});

t('accepts a scaled gain write, inline or via a local', () => {
  assert(checkAudioSource('v.gain.setTargetAtTime(0.2 * ctx.audio.audioScale, now, 0.25);').length === 0, 'inline scale flagged');
  assert(checkAudioSource('const target = 0.4 * ctx.audio.audioScale;\nv.gain.setTargetAtTime(target, now, 0.6);').length === 0,
    'scale via local variable flagged');
});

console.log(`\n${pass} passed, ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
