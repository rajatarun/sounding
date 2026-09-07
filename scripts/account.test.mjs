/**
 * account.test.mjs — the one-field flow, and the thing it must never say.
 *
 * The rule this protects: typing an address that already has an account and
 * typing one that does not must be indistinguishable. Otherwise the form
 * answers "does this person play this game?" for anyone who can type — and
 * this game asks people to sit alone in a dark room with headphones on.
 *
 * Pure Node, with fetch stubbed. The browser walk of every UI state is run
 * separately against Chromium; this is the half that must never regress
 * quietly, so it runs on every `npm test`.
 */
import { submitAddress, submitCode, forget } from '../src/account/session.js';

let pass = 0; const failures = [];
const t = (name, fn) => fn().then(
  () => { console.log(`  PASS  ${name}`); pass++; },
  (e) => { console.log(`  FAIL  ${name}\n          ${e.message}`); failures.push(name); },
);
const assert = (c, m) => { if (!c) throw new Error(m); };

/** Minimal browser surface: a config fetch, then Cognito by x-amz-target. */
function stub(routes) {
  globalThis.window = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('auth-config.json')) {
      return { ok: true, json: async () => ({ userPoolId: 'us-east-1_T', userPoolClientId: 'c', progressApiUrl: 'https://api.invalid' }) };
    }
    const target = (init.headers?.['x-amz-target'] || '').split('.').pop();
    const r = routes[target];
    if (!r) return { ok: false, status: 500, text: async () => '{}' };
    return { ok: r.ok !== false, status: r.ok === false ? 400 : 200, text: async () => JSON.stringify(r.body || {}) };
  };
}
const AWS = (type) => ({ ok: false, body: { __type: `com.amazon.coral.service#${type}`, message: 'developer-facing text' } });
const CHALLENGE = { body: { Session: 's', ChallengeParameters: { CODE_DELIVERY_DESTINATION: 'a***@e***.com' } } };

console.log('\nThe single-field flow\n' + '─'.repeat(52));

await t('a new address lands on the code screen', async () => {
  forget();
  stub({ SignUp: { body: { CodeDeliveryDetails: { Destination: 'a***@e***.com' } } } });
  const r = await submitAddress('new@example.com');
  assert(r.ok && r.state === 'awaiting-code', `got ${JSON.stringify(r)}`);
});

await t('an EXISTING address lands on the same screen, saying nothing', async () => {
  forget();
  stub({ SignUp: AWS('UsernameExistsException'), InitiateAuth: CHALLENGE });
  const r = await submitAddress('taken@example.com');
  assert(r.ok && r.state === 'awaiting-code', `got ${JSON.stringify(r)}`);
  const leaked = JSON.stringify(r);
  assert(!/exist|registered|already/i.test(leaked), `the result leaks the branch: ${leaked}`);
});

await t('an unconfirmed account resends rather than dead-ending', async () => {
  forget();
  stub({
    SignUp: AWS('UsernameExistsException'),
    InitiateAuth: AWS('UserNotConfirmedException'),
    ResendConfirmationCode: { body: {} },
  });
  const r = await submitAddress('half@example.com');
  assert(r.ok && r.state === 'awaiting-code', `got ${JSON.stringify(r)}`);
});

await t('a malformed address never reaches the network', async () => {
  forget();
  let called = false;
  stub({}); const real = globalThis.fetch;
  globalThis.fetch = async (u, i) => { if (!String(u).includes('auth-config')) called = true; return real(u, i); };
  const r = await submitAddress('not-an-address');
  assert(!r.ok && r.state === 'address-rejected', `got ${JSON.stringify(r)}`);
  assert(!called, 'it asked Cognito about a string that is not an address');
});

await t('no raw AWS message is ever returned to the caller', async () => {
  forget();
  stub({ SignUp: AWS('UsernameExistsException'), InitiateAuth: AWS('TooManyRequestsException') });
  const r = await submitAddress('rate@example.com');
  assert(!r.ok && r.state === 'rate-limited', `got ${JSON.stringify(r)}`);
  assert(!/developer-facing/.test(JSON.stringify(r)), 'the developer message escaped');
});

await t('a code with no flow in flight asks for a new one', async () => {
  forget();
  stub({});
  const r = await submitCode('123456');
  assert(!r.ok && r.state === 'code-expired', `got ${JSON.stringify(r)}`);
});

console.log(`\n${pass} passed, ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
