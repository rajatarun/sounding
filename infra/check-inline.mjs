/**
 * check-inline.mjs — the Lambda in the template is the Lambda in the file.
 *
 * infra/lambda/index.js is the readable, lintable, `node --check`-able source.
 * infra/sounding-identity.yaml carries a verbatim copy as Code.ZipFile so the
 * stack applies with no build step and no artifact bucket. Two copies of
 * anything drift; this is the thing that notices.
 *
 *   node infra/check-inline.mjs
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'lambda/index.js'), 'utf8').replace(/\n+$/, '');
const template = readFileSync(join(here, 'sounding-identity.yaml'), 'utf8');

const block = template.match(/\n {6}Code:\n {8}ZipFile: \|\n((?: {10}.*\n| *\n)+)/);
if (!block) {
  console.error('FAIL: no `Code: ZipFile: |` block found in sounding-identity.yaml');
  process.exit(1);
}

const inlined = block[1]
  .split('\n')
  .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
  .join('\n')
  .replace(/\n+$/, '');

// Trailing whitespace cannot survive a YAML block scalar round-trip, so compare
// the source with the same trimming applied rather than reporting a false diff.
const expected = source.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n');

if (inlined !== expected) {
  const a = expected.split('\n');
  const b = inlined.split('\n');
  const i = a.findIndex((line, n) => line !== b[n]);
  console.error('FAIL: infra/lambda/index.js and the template have drifted apart.');
  console.error(`  first difference at line ${i + 1}`);
  console.error(`  file:     ${JSON.stringify(a[i])}`);
  console.error(`  template: ${JSON.stringify(b[i])}`);
  process.exit(1);
}

execSync(`node --check ${JSON.stringify(join(here, 'lambda/index.js'))}`);
console.log(`ok: the inlined function matches infra/lambda/index.js (${expected.split('\n').length} lines) and parses`);
