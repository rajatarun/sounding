/**
 * check-levels.mjs — `npm run check`.
 *
 * Runs the level contract over every registered era plus a source-text pass
 * over each era module. Exits non-zero on errors only; warnings are printed
 * and never block, because a warning that blocks is a warning that gets
 * suppressed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { ERAS, BUILT_IDS, TOTAL_LEVELS, buildStatus } from '../src/levels/registry.js';
import { checkLevels, checkAudioSource } from '../src/levels/contract.js';

const here = dirname(fileURLToPath(import.meta.url));
const levelsDir = resolve(here, '../src/levels');

const findings = checkLevels(ERAS);
for (const era of ERAS) {
  const src = readFileSync(resolve(levelsDir, era.module), 'utf8');
  findings.push(...checkAudioSource(src, era.module));
}

const errors = findings.filter((f) => f.severity === 'error');
const warnings = findings.filter((f) => f.severity === 'warning');

const status = buildStatus();
console.log(`\nSOUNDING — level contract\n${'─'.repeat(52)}`);
for (const s of status) {
  const bar = '█'.repeat(Math.round((s.built / s.planned) * 20)).padEnd(20, '·');
  console.log(`  ${String(s.ordinal)}. ${s.name.padEnd(22)} ${bar} ${String(s.built).padStart(3)}/${s.planned}`);
}
console.log(`  ${' '.repeat(25)}${' '.repeat(20)} ${String(BUILT_IDS.length).padStart(3)}/${TOTAL_LEVELS} built\n`);

const show = (list, heading) => {
  if (!list.length) return;
  console.log(`${heading} (${list.length})`);
  for (const f of list) console.log(`  [${f.rule}] level ${f.level}: ${f.message}`);
  console.log('');
};
show(errors, 'ERRORS — these block');
show(warnings, 'WARNINGS — look, then decide');

if (!findings.length) console.log('No findings. Every built level satisfies the contract.\n');
else console.log(`${errors.length} error(s), ${warnings.length} warning(s).\n`);

process.exit(errors.length ? 1 : 0);
