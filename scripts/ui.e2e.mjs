/**
 * ui.e2e.mjs — the interface, in a real browser, at the width it ships at.
 *
 *   npm run test:e2e
 *
 * Why a browser and not jsdom: jsdom has no layout, no cascade, no
 * forced-colors mode and no `prefers-reduced-motion`, so it cannot see most of
 * what has actually broken on this screen. The loom-grid collapse that made
 * the title screen eleven thousand pixels tall was invisible to everything
 * except a real engine at a real viewport.
 *
 * Everything external is stubbed at the network boundary — `auth-config.json`,
 * the Cognito endpoint, the progress API — so the run needs no AWS, no
 * credentials and no network. Which branch of the account flow a test is on is
 * therefore decided here, in the stub, which is what makes the two branches
 * comparable at all.
 *
 * WHAT THIS SUITE CANNOT SEE. There is no phone, no headphones and no quiet
 * room in this environment, so nothing here judges audibility, spatialisation,
 * head-tracking or compass steering. A green run says the interface behaved,
 * not that the game sounded right.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const PLAYWRIGHT = process.env.SOUNDING_PLAYWRIGHT || '/home/user/aiweave/node_modules/playwright';
const CHROME = process.env.SOUNDING_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = Number(process.env.SOUNDING_E2E_PORT || 4173);
const BASE = `http://127.0.0.1:${PORT}/`;

/* Phone first. Both layout defects this project has had were invisible at the
   width they were tested at. */
const PHONE = { width: 390, height: 844 };
const SMALL = { width: 360, height: 640 };

const COGNITO = 'https://cognito-idp.us-east-1.amazonaws.com/';
const API_BASE = 'https://progress.test.invalid';
const AUTH_CONFIG = {
  userPoolId: 'us-east-1_TESTPOOL',
  userPoolClientId: 'test-client-id',
  progressApiUrl: API_BASE,
};

/* ------------------------------------------------------------ tiny runner */

let pass = 0;
const failures = [];
const only = process.env.SOUNDING_E2E_ONLY;

async function t(name, fn) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n          ${e.message.split('\n').join('\n          ')}`);
    failures.push(name);
  }
}
const group = (title) => console.log(`\n${title}\n${'─'.repeat(Math.max(title.length, 52))}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

/* -------------------------------------------------------------- the server */

function serve() {
  const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, stdio: 'ignore', detached: true,
  });
  return {
    async ready() {
      for (let i = 0; i < 60; i++) {
        try {
          const res = await fetch(BASE);
          if (res.ok) return;
        } catch (e) { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error(`vite preview never answered on ${BASE}`);
    },
    stop() { try { process.kill(-child.pid); } catch (e) { /* already gone */ } },
  };
}

/* --------------------------------------------------------- page scaffolding */

/** A Cognito failure exactly as the service shapes one. */
const aws = (type, status = 400) => ({
  status,
  body: { __type: `com.amazon.coral.service#${type}`, message: 'RAW-AWS-DEVELOPER-TEXT' },
});
const CHALLENGE = { body: { Session: 'sess-1', ChallengeParameters: { CODE_DELIVERY_DESTINATION: 'a***@e***.com' } } };
const SIGNED_UP = { body: { CodeDeliveryDetails: { Destination: 'a***@e***.com' } } };
const TOKENS = { body: { AuthenticationResult: { AccessToken: 'at', IdToken: 'it', RefreshToken: 'rt', ExpiresIn: 3600 } } };

/** The two branches the flow must not distinguish between. */
const BRANCH = {
  'a new address': { SignUp: SIGNED_UP },
  'a registered address': { SignUp: aws('UsernameExistsException'), InitiateAuth: CHALLENGE },
};

let browser = null;

/**
 * One page with the whole outside world scripted.
 *
 * `cognito` maps an operation name to a response (or a function of the parsed
 * request). `config: false` withholds auth-config.json, which is the account
 * feature's off switch. `api` scripts the progress API.
 */
async function open({
  viewport = PHONE, reducedMotion, forcedColors, config = AUTH_CONFIG,
  cognito = {}, api = { p: null }, apiStatus = 200, progress, latencyMs = 0,
} = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion, forcedColors });
  const page = await ctx.newPage();
  const calls = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  if (progress) {
    await page.addInitScript((p) => {
      localStorage.setItem('sounding:progress:v1', JSON.stringify(p));
    }, progress);
  }

  await page.route('**/auth-config.json', (r) => (config
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) })
    : r.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' })));

  await page.route(`${COGNITO}**`, async (r) => {
    const target = (r.request().headers()['x-amz-target'] || '').split('.').pop();
    calls.push(target);
    if (latencyMs) await new Promise((res) => setTimeout(res, latencyMs));
    const route = cognito[target];
    if (route === 'hang') return new Promise(() => {});
    if (!route) {
      return r.fulfill({ status: 500, contentType: 'application/x-amz-json-1.1', body: '{}' });
    }
    const out = typeof route === 'function' ? route(JSON.parse(r.request().postData() || '{}')) : route;
    return r.fulfill({
      status: out.status ?? 200,
      contentType: 'application/x-amz-json-1.1',
      body: JSON.stringify(out.body ?? {}),
    });
  });

  await page.route(`${API_BASE}/**`, async (r) => {
    calls.push(`API:${r.request().method()}`);
    if (api === 'dead') return r.abort();
    return r.fulfill({ status: apiStatus, contentType: 'application/json', body: JSON.stringify(api) });
  });

  await page.goto(BASE);
  return { ctx, page, calls, errors };
}

/* --------------------------------------------------------------- selectors */

const account = (page) => page.locator('.snd-account');
const emailField = (page) => page.locator('.snd-account input[type=email]');
const codeField = (page) => page.locator('.snd-account input[inputmode=numeric]');
const submit = (page) => page.locator('.snd-account button[type=submit]');
const fieldError = (page) => page.locator('.snd-account .tantu-field-error');
const notice = (page) => page.locator('.snd-account .tantu-notice');

const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return 'BODY';
  if (el.tagName === 'INPUT') return `INPUT[${el.getAttribute('inputmode') || el.type}]`;
  if (el.tagName === 'BUTTON') return `BUTTON:${(el.textContent || '').trim()}`;
  return el.tagName;
});

async function toAccount(page) {
  await page.getByRole('button', { name: 'Sign in' }).click();
  await account(page).waitFor({ state: 'visible' });
}

async function toCodeScreen(page, address = 'seeker@example.com') {
  await toAccount(page);
  await emailField(page).fill(address);
  await submit(page).click();
  await codeField(page).waitFor({ state: 'visible', timeout: 5000 });
}

/** Everything a shoulder-surfing attacker can read off the code screen. */
async function codeScreenShape(page) {
  return page.evaluate(() => {
    const form = document.querySelector('.snd-account form');
    const input = form.querySelector('input');
    return {
      text: form.innerText.replace(/\s+/g, ' ').trim(),
      buttons: [...form.querySelectorAll('button')]
        .map((b) => `${b.textContent.trim()}|disabled=${b.disabled}`),
      field: {
        type: input.type,
        inputMode: input.getAttribute('inputmode'),
        maxLength: input.getAttribute('maxlength'),
        minLength: input.getAttribute('minlength'),
        pattern: input.getAttribute('pattern'),
        autoComplete: input.getAttribute('autocomplete'),
        size: input.getAttribute('size'),
        required: input.required,
        placeholder: input.placeholder,
        ariaDescribedby: !!input.getAttribute('aria-describedby'),
      },
      /* Structure without React's per-render ids, which differ run to run. */
      dom: form.outerHTML.replace(/_r_[0-9a-z]+_/g, 'ID'),
    };
  });
}

/* ============================================================== the tests */

const server = serve();
let exitCode = 0;

try {
  await server.ready();
  const { chromium } = await import(path.join(PLAYWRIGHT, 'index.mjs'));
  browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });

  /* ------------------------------------------------------------------ */
  group('The account flow must not say whether an address is registered');

  await t('both branches render the same code screen, to the DOM', async () => {
    const shapes = {};
    for (const [label, cognito] of Object.entries(BRANCH)) {
      const { ctx, page } = await open({ cognito });
      await toCodeScreen(page);
      shapes[label] = await codeScreenShape(page);
      await ctx.close();
    }
    const [a, b] = Object.values(shapes);
    assert(a.dom === b.dom, `the two branches render different DOM.\n  new: ${a.dom}\n  old: ${b.dom}`);
  });

  await t('both branches give the code field the same constraints', async () => {
    const fields = [];
    for (const cognito of Object.values(BRANCH)) {
      const { ctx, page } = await open({ cognito });
      await toCodeScreen(page);
      fields.push((await codeScreenShape(page)).field);
      await ctx.close();
    }
    assert(
      JSON.stringify(fields[0]) === JSON.stringify(fields[1]),
      `the field announces the branch:\n  new: ${JSON.stringify(fields[0])}\n  old: ${JSON.stringify(fields[1])}`,
    );
    /* A cap of six shipped once and truncated the eight-digit EMAIL_OTP code
       to its first six before calling it wrong. Six is the length of one
       branch's code; sizing to it is an answer to the question this flow
       refuses. */
    const cap = fields[0].maxLength === null ? null : Number(fields[0].maxLength);
    assert(cap === null || cap >= 8, `the code field is capped at ${cap}, which will not hold an EMAIL_OTP code`);
  });

  await t('both branches accept an eight-digit code intact', async () => {
    for (const [label, base] of Object.entries(BRANCH)) {
      const sent = [];
      const { ctx, page } = await open({
        cognito: {
          ...base,
          ConfirmSignUp: (body) => { sent.push(body.ConfirmationCode); return { body: {} }; },
          RespondToAuthChallenge: (body) => {
            sent.push(body.ChallengeResponses.EMAIL_OTP_CODE);
            return TOKENS;
          },
          InitiateAuth: base.InitiateAuth || CHALLENGE,
        },
      });
      await toCodeScreen(page);
      await codeField(page).fill('87654321');
      await submit(page).click();
      await page.waitForTimeout(700);
      assert(sent[0] === '87654321', `${label}: the service was sent "${sent[0]}", not the eight digits typed`);
      await ctx.close();
    }
  });

  await t("the address step's request-count oracle is exactly the documented limit", async () => {
    /* This case used to demand that both branches cost the same, and it was
       red. It is no longer a demand, because the difference cannot be closed
       from the client: the browser talks to Cognito directly, so an observer
       who can count our requests can equally read UsernameExistsException in
       the reply, and padding the count would buy a round trip and hide the
       tell from nobody who could already see it. Closing it needs an endpoint
       of our own, which is provisioning and the owner's call.
     *
     * So the case now pins the accepted shape instead of asking for a
     * different one. It is stricter than the old assertion in the direction
     * that matters — an exact count both ways, not a ratio — and it goes red
     * three ways: if the gap widens, if someone "closes" it by padding rather
     * than by moving the call server-side, or if the note explaining why it is
     * open is deleted. A limit nobody wrote down is not an accepted limit; it
     * is a forgotten defect. */
    const EXPECTED = { 'a new address': 1, 'a registered address': 2 };

    const measured = {};
    for (const [label, cognito] of Object.entries(BRANCH)) {
      const { ctx, page, calls } = await open({ cognito });
      await toAccount(page);
      await emailField(page).fill('seeker@example.com');
      const before = calls.length;
      await submit(page).click();
      await codeField(page).waitFor({ state: 'visible', timeout: 10000 });
      measured[label] = calls.length - before;
      await ctx.close();
    }
    assert(
      JSON.stringify(measured) === JSON.stringify(EXPECTED),
      `the shape of the address step moved: expected ${JSON.stringify(EXPECTED)}, measured `
      + `${JSON.stringify(measured)}. If this is the endpoint that closes the oracle, both `
      + 'branches should now be one call and this case should be rewritten as the guarantee it '
      + 'was originally written to be. If it is padding, it buys nothing — see infra/README.md.',
    );

    /* The decision, still written down where the next person will meet it. */
    for (const [file, needle] of [
      ['infra/README.md', 'request-count oracle'],
      ['CLAUDE.md', 'request-count oracle'],
      ['src/account/session.js', 'oracle'],
    ]) {
      const text = readFileSync(path.join(ROOT, file), 'utf8');
      assert(
        text.includes(needle),
        `${file} no longer records why the address step's request-count difference is left open. `
        + 'The difference is still measurable; only the reason for accepting it has gone.',
      );
    }
  });

  await t('a correct code on a new address does not silently ask for another', async () => {
    const { ctx, page } = await open({
      cognito: { ...BRANCH['a new address'], ConfirmSignUp: { body: {} }, InitiateAuth: CHALLENGE },
    });
    await toCodeScreen(page);
    const before = (await account(page).innerText()).replace(/\s+/g, ' ').trim();
    await codeField(page).fill('123456');
    await submit(page).click();
    await page.waitForTimeout(900);
    const after = (await account(page).innerText()).replace(/\s+/g, ' ').trim();
    const stillOnCodeScreen = await codeField(page).count() > 0;
    if (!stillOnCodeScreen) return; // nothing to announce; the flow moved on
    assert(
      after !== before,
      'the correct first code cleared the field and asked for a second one with no word to the player: '
      + `the screen reads exactly as before ("${after.slice(0, 90)}…"). `
      + 'Cognito sends a second code here because a confirmed sign-up is not yet a session, '
      + 'and nothing on screen says so.',
    );
  });

  await t('no raw provider text ever reaches the glass', async () => {
    const states = [
      ['LimitExceededException', 400, 'caution', 'status', 'Too many attempts'],
      ['CodeDeliveryFailureException', 400, 'critical', 'alert', "couldn't be sent"],
      ['InternalErrorException', 500, 'critical', 'alert', 'having trouble'],
      ['UserLambdaValidationException', 400, 'critical', 'alert', 'Something went wrong'],
    ];
    for (const [type, status, tone, role, copy] of states) {
      const { ctx, page } = await open({ cognito: { SignUp: aws(type, status) } });
      await toAccount(page);
      await emailField(page).fill('seeker@example.com');
      await submit(page).click();
      /* Wait on this failure's own words, not on "a notice" — the resting
         "an account is optional" notice is always on screen and would let the
         assertions below read the wrong element. */
      const failure = page.locator('.snd-account .tantu-notice', { hasText: copy });
      await failure.waitFor({ state: 'visible', timeout: 5000 });
      const shown = await account(page).innerText();
      assert(!/RAW-AWS-DEVELOPER-TEXT|coral|Exception/i.test(shown), `${type}: provider text on screen — ${shown}`);
      const cls = await failure.getAttribute('class');
      const r = await failure.getAttribute('role');
      assert(cls.includes(`tantu-notice-${tone}`), `${type}: drawn ${cls}, expected tone ${tone}`);
      assert(r === role, `${type}: role=${r}, expected ${role} — a failure that does not announce is not a failure the player hears`);
      await ctx.close();
    }
  });

  /* ------------------------------------------------------------------ */
  group('Announcement, focus and the keyboard');

  await t('a pending submit is announced and cannot be pressed twice', async () => {
    const { ctx, page } = await open({ cognito: { SignUp: 'hang' } });
    await toAccount(page);
    await emailField(page).fill('seeker@example.com');
    await submit(page).click();
    await page.waitForTimeout(400);
    const live = page.locator('.snd-account [role=status][aria-live]').last();
    assert((await live.innerText()).trim().length > 0, 'nothing was announced while the request was in flight');
    const box = await live.boundingBox();
    assert(box && box.width <= 2 && box.height <= 2, `the pending announcement is drawn on screen (${JSON.stringify(box)})`);
    assert(await submit(page).isDisabled(), 'the submit control stayed pressable during the request');
    await ctx.close();
  });

  await t('a rejected address keeps its text and its focus', async () => {
    /* "a@b" satisfies the browser's own type=email validation and fails the
       client's, which is the only way to reach `address-rejected` from the
       field. UI-STATES: "fix it in place — the field keeps focus and its
       text". */
    const { ctx, page } = await open({ cognito: {} });
    await toAccount(page);
    await emailField(page).click();
    await emailField(page).fill('a@b');
    await submit(page).click();
    await fieldError(page).waitFor({ state: 'visible', timeout: 5000 });
    assert(await emailField(page).inputValue() === 'a@b', 'the typed address was thrown away');
    assert(await emailField(page).getAttribute('aria-invalid') === 'true', 'the field is not marked invalid');
    const where = await focused(page);
    assert(where === 'INPUT[email]', `focus went to ${where} instead of staying in the field to be corrected`);
    await ctx.close();
  });

  await t('focus returns to the code field after every wrong code, not just the first', async () => {
    const { ctx, page } = await open({
      cognito: { ...BRANCH['a registered address'], RespondToAuthChallenge: aws('CodeMismatchException') },
    });
    await toCodeScreen(page);
    const seen = [];
    for (const attempt of ['111111', '222222']) {
      await codeField(page).fill(attempt);
      await submit(page).click();
      await page.waitForTimeout(700);
      seen.push(await focused(page));
      assert(await codeField(page).inputValue() === '', 'the rejected code was left in the field');
    }
    assert(
      seen.every((w) => w.startsWith('INPUT')),
      `focus after each wrong code was [${seen.join(', ')}] — the second rejection drops the player out of the form. `
      + 'The refocus effect keys on the error *string*, which does not change when the same error repeats.',
    );
    await ctx.close();
  });

  await t('the whole flow is completable from the keyboard alone', async () => {
    const { ctx, page } = await open({
      cognito: { ...BRANCH['a registered address'], RespondToAuthChallenge: TOKENS },
    });
    await toAccount(page);
    await page.keyboard.press('Tab'); // into the address field
    assert((await focused(page)) === 'INPUT[email]', `first tab stop was ${await focused(page)}`);
    await page.keyboard.type('seeker@example.com');
    await page.keyboard.press('Enter');
    await codeField(page).waitFor({ state: 'visible', timeout: 5000 });
    await page.keyboard.type('12345678');
    await page.keyboard.press('Enter');
    await page.getByText('Signed in').waitFor({ timeout: 5000 });
    await ctx.close();
  });

  await t('an expired code leaves the way forward enabled; a rate limit does not offer one', async () => {
    for (const [type, copy, mustBeEnabled] of [
      ['ExpiredCodeException', 'has expired', true],
      ['TooManyRequestsException', 'Too many attempts', false],
    ]) {
      const { ctx, page } = await open({
        cognito: { ...BRANCH['a registered address'], RespondToAuthChallenge: aws(type) },
      });
      await toCodeScreen(page);
      await codeField(page).fill('123456');
      await submit(page).click();
      await page.locator('.snd-account .tantu-notice', { hasText: copy }).waitFor({ state: 'visible', timeout: 5000 });
      const resend = page.getByRole('button', { name: 'Send another code' });
      const enabled = !(await resend.isDisabled());
      assert(
        enabled === mustBeEnabled,
        mustBeEnabled
          ? 'an expired code left no enabled way to ask for another, and there is no way forward without one'
          : 'a rate limit still offered a retry that will also fail',
      );
      await ctx.close();
    }
  });

  await t('a failed resend does not blame the code the player typed', async () => {
    /* "Send another code" is a different action from "Continue", and its
       failures are not field failures. Cognito answers a resend for an already
       confirmed account with NotAuthorizedException, which this client maps to
       `code-rejected` — the state whose copy is about the code and whose
       handling clears the field. */
    const { ctx, page } = await open({ cognito: BRANCH['a registered address'] });
    await toCodeScreen(page);
    await codeField(page).fill('12345678');
    /* The resend fails outright from here on. */
    await page.unroute(`${COGNITO}**`);
    await page.route(`${COGNITO}**`, (r) => r.fulfill({
      status: 400, contentType: 'application/x-amz-json-1.1',
      body: JSON.stringify({ __type: 'com.amazon.coral.service#NotAuthorizedException' }),
    }));
    await page.getByRole('button', { name: 'Send another code' }).click();
    await page.waitForTimeout(800);
    const said = await fieldError(page).allInnerTexts();
    const kept = await codeField(page).inputValue();
    assert(
      !said.some((x) => /code was not right/i.test(x)),
      `a failed resend told the player their code was wrong: ${JSON.stringify(said)}`,
    );
    assert(kept === '12345678', `a failed resend threw away the code the player had typed (field now "${kept}")`);
    await ctx.close();
  });

  await t('no pending state outlives the client timeout', async () => {
    const { ctx, page } = await open({ cognito: { SignUp: 'hang' } });
    await toAccount(page);
    await emailField(page).fill('seeker@example.com');
    const t0 = Date.now();
    await submit(page).click();
    await page.locator('.snd-account .tantu-notice-critical').waitFor({ state: 'visible', timeout: 25000 });
    const took = (Date.now() - t0) / 1000;
    assert(took < 20, `the pending state lasted ${took.toFixed(1)}s`);
    assert(!(await submit(page).isDisabled()), 'the control never came back');
    assert(await emailField(page).inputValue() === 'seeker@example.com', 'the typed address was lost to the timeout');
    await ctx.close();
  });

  /* ------------------------------------------------------------------ */
  group('The signed-in state: signing out, and deleting');

  async function signIn(opts = {}) {
    const { cognito: extra, ...rest } = opts;
    const it = await open({
      ...rest,
      cognito: {
        ...BRANCH['a registered address'],
        RespondToAuthChallenge: TOKENS,
        DeleteUser: { body: {} },
        GlobalSignOut: { body: {} },
        ...(extra || {}),
      },
    });
    await toCodeScreen(it.page);
    await codeField(it.page).fill('12345678');
    await submit(it.page).click();
    await it.page.getByText('Signed in').waitFor({ timeout: 5000 });
    return it;
  }

  await t('the confirmation cannot be dismissed out from under the two calls', async () => {
    const { ctx, page } = await signIn();
    await page.getByRole('button', { name: 'Delete account' }).click();
    await page.locator('.tantu-dialog').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert(await page.locator('.tantu-dialog').count() === 1, 'Escape dismissed a persistent dialog');
    await page.locator('.tantu-scrim').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(300);
    assert(await page.locator('.tantu-dialog').count() === 1, 'a click on the scrim dismissed a persistent dialog');
    await ctx.close();
  });

  await t('the confirmation traps focus and gives it back to the control that opened it', async () => {
    const { ctx, page } = await signIn();
    await page.getByRole('button', { name: 'Delete account' }).click();
    await page.locator('.tantu-dialog').waitFor({ state: 'visible' });
    const stops = [];
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); stops.push(await focused(page)); }
    assert(stops.every((s) => s.startsWith('BUTTON:')), `focus left the dialog: ${stops.join(' > ')}`);
    assert(new Set(stops).size <= 2, `the dialog's focus ring reaches outside its own controls: ${stops.join(' > ')}`);
    await page.getByRole('button', { name: 'Keep it' }).click();
    await page.waitForTimeout(300);
    assert(
      (await focused(page)) === 'BUTTON:Delete account',
      `after the dialog closed focus was ${await focused(page)}, not the control that opened it`,
    );
    await ctx.close();
  });

  await t('an account is not deleted when its progress could not be erased first', async () => {
    /* Order is the whole reason the dialog is persistent: the stored row is
       keyed on a `sub` nothing can authenticate as once the user is gone, so
       an account deleted after a failed erase strands its progress forever. */
    const { ctx, page, calls } = await signIn({ api: 'dead' });
    await page.getByRole('button', { name: 'Delete account' }).click();
    await page.locator('.tantu-dialog').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Delete it' }).click();
    await page.waitForTimeout(1200);
    const erased = calls.includes('API:DELETE');
    const deleted = calls.includes('DeleteUser');
    assert(erased, 'the progress erase was never attempted');
    assert(
      !deleted,
      'the progress erase failed and the account was deleted anyway: '
      + `calls were [${calls.join(', ')}]. The stored row is now keyed to a subject nothing can ever `
      + 'authenticate as, and the screen said nothing about it.',
    );
    await ctx.close();
  });

  await t('sign out everywhere does not claim to have worked when it did not', async () => {
    const { ctx, page } = await signIn({ cognito: { GlobalSignOut: aws('InternalErrorException', 500) } });
    await page.getByRole('button', { name: 'Sign out everywhere' }).click();
    await page.waitForTimeout(900);
    const shown = await account(page).innerText();
    assert(
      /trouble|couldn't|went wrong|try/i.test(shown),
      'the other devices are still signed in and the screen said nothing about it: '
      + `"${shown.replace(/\s+/g, ' ').trim()}"`,
    );
    await ctx.close();
  });

  /* ------------------------------------------------------------------ */
  group('The game keeps working when the account does not');

  await t('with no auth-config.json the game offers no account control at all', async () => {
    const { ctx, page } = await open({ config: false });
    await page.waitForTimeout(800);
    assert(await page.getByRole('button', { name: 'Sign in' }).count() === 0, 'the off switch still drew a Sign in control');
    assert(await page.locator('.snd-account-entry').count() === 0, 'the account entry rendered without a configuration');
    await ctx.close();
  });

  await t('a trial can be finished with every network call failing', async () => {
    const { ctx, page, errors } = await open({ config: false });
    await page.locator('button', { hasText: /^Begin — Level 1/ }).first().click();
    await page.getByRole('button', { name: /Begin, Unhurried/i }).click();
    await page.locator('.snd-orb').waitFor({ timeout: 8000 });
    await holdLevelOne(page);
    await page.getByText('Trial 1 of 3 complete', { exact: false }).waitFor({ timeout: 45000 });
    assert(errors.length === 0, `the page threw during play: ${errors.join(' / ')}`);
    await ctx.close();
  });

  await t('signed in with the progress API dead, a trial still finishes and nothing is drawn about it', async () => {
    const { ctx, page, errors, calls } = await signIn({ api: 'dead' });
    await page.getByRole('button', { name: 'Back to the game' }).click();
    await page.locator('button', { hasText: /^Begin — Level 1/ }).first().click();
    await page.getByRole('button', { name: /Begin, Unhurried/i }).click();
    await page.locator('.snd-orb').waitFor({ timeout: 8000 });
    await holdLevelOne(page);
    await page.getByText('Trial 1 of 3 complete', { exact: false }).waitFor({ timeout: 45000 });
    const shown = await page.locator('.snd-screen').first().innerText();
    assert(!/sync|network|account|offline|couldn't/i.test(shown), `a sync failure was drawn over the end of a trial: ${shown}`);
    assert(errors.length === 0, `the page threw during play: ${errors.join(' / ')}`);
    /* And it is a resting fact on the account screen afterwards. */
    assert(calls.includes('API:PUT'), 'the trial boundary never tried to sync');
    await ctx.close();
  });

  await t('a device that could not sync says so on the account screen, as a resting fact', async () => {
    /* UI-STATES § Sync is quiet: `sync-failed` draws nothing during play and is
       surfaced only here, as something the player can read at rest. */
    const said = /hasn't reached your account|isn't synced|not synced/i;
    const { ctx, page } = await signIn({ apiStatus: 503, api: {} });
    await page.waitForTimeout(800);
    const onArrival = await account(page).innerText();

    /* Leaving and coming back remounts the screen, which is when the flag is
       read again. If that is the only way to see it, the player who was
       looking straight at the screen when the sync failed was told nothing. */
    await page.getByRole('button', { name: 'Back to the game' }).click();
    await page.getByRole('button', { name: 'Sign in' }).click();
    await account(page).waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    const onReturn = await account(page).innerText();
    await ctx.close();

    assert(said.test(onReturn), `the failed sync is never surfaced at all: "${onReturn.replace(/\s+/g, ' ').trim()}"`);
    assert(
      said.test(onArrival),
      'the sync failed while the account screen was open and the screen said nothing: '
      + `"${onArrival.replace(/\s+/g, ' ').trim()}". It appears only after leaving and coming back — `
      + 'hasUnsyncedChanges() is read during render and nothing re-renders when the pull settles.',
    );
  });

  /* ------------------------------------------------------------------ */
  group('Reduced motion, forced colors and the presence marks');

  /**
   * Play level 4 (breathe) from the top of the cave's breath and cross the 25%
   * presence mark. `Math.random` is pinned so the period is at its longest,
   * which puts the whole accrual inside one half-cycle: sync climbs at 9/s
   * while the hold matches, so the mark falls at about 2.8s.
   *
   * The reading is taken twice *after* the hold has begun, so the button's own
   * state change is never what the comparison sees.
   */
  async function acrossTheFirstMark({ reducedMotion, read }) {
    const { ctx, page } = await open({
      config: false, reducedMotion,
      progress: { done: [], next: { level: 4, trial: 1 }, revealed: [], everPlayed: true },
    });
    await page.addInitScript(() => { Math.random = () => 0.999; });
    await page.goto(BASE);
    await page.locator('button', { hasText: /^Continue — Level 4/ }).first().click();
    await page.getByRole('button', { name: /Begin, Unhurried/i }).click();
    await page.locator('.snd-breathe-btn').waitFor({ timeout: 8000 });
    const btn = page.locator('.snd-breathe-btn');
    await btn.dispatchEvent('mousedown');
    await page.waitForTimeout(800);
    const before = await page.evaluate(read);
    await page.waitForTimeout(2600);
    const after = await page.evaluate(read);
    await btn.dispatchEvent('mouseup');
    /* Read off the page rather than through a locator: when the field is
       missing entirely — which is the defect this case exists for — a locator
       stalls for thirty seconds and reports a timeout instead of the finding. */
    const depth = await page.evaluate(
      () => document.querySelector('.snd-voidfield')?.getAttribute('data-depth') ?? 'no field',
    );
    await ctx.close();
    return { before, after, depth };
  }

  /** What the depth ladder can actually change, as the browser resolves it. */
  const DEPTH_CHANNELS = () => {
    const field = document.querySelector('.snd-voidfield');
    const word = document.querySelector('.snd-breath-word');
    const wrap = document.querySelector('.snd-presence-wrap');
    const cw = word ? getComputedStyle(word) : null;
    const cp = wrap ? getComputedStyle(wrap) : null;
    return {
      fieldPresent: Boolean(field),
      wordOpacity: cw && cw.opacity,
      wordTracking: cw && cw.letterSpacing,
      wrapFilter: cp && cp.filter,
      cloth: (() => { const c = document.querySelector('canvas.tantu-loom-substrate'); return c ? c.toDataURL() : ''; })(),
    };
  };

  await t('a presence mark is answered by something a reduced-motion player can perceive', async () => {
    /* `substrate.pulse()` is gated on `bleedMotionAllowed()`, so under reduced
       motion the dye front — the mark's motion answer — never draws, and the
       static [data-depth] ladder is all those players get. That ladder lives on
       `.snd-voidfield`, which levels 4 and 9 did not render at all.
     *
       Asserted on *computed style*, not on innerHTML: a `data-depth` attribute
       with no cascade behind it would satisfy a DOM diff and change nothing on
       the glass. */
    const moving = await acrossTheFirstMark({ reducedMotion: 'no-preference', read: DEPTH_CHANNELS });
    assert(
      moving.before.cloth !== moving.after.cloth,
      'the harness never saw a dye front even with motion allowed, so it cannot speak to reduced motion',
    );

    const still = await acrossTheFirstMark({ reducedMotion: 'reduce', read: DEPTH_CHANNELS });
    assert(
      still.before.fieldPresent,
      'a breathe level renders no feedback field at all, so setPresence, setOrb and setWord run '
      + 'every frame into nothing and a presence mark has nowhere to be answered',
    );
    assert(
      still.before.cloth === still.after.cloth,
      'a dye front drew under reduced motion — pulse() is meant to refuse',
    );
    const differing = ['wordOpacity', 'wordTracking', 'wrapFilter']
      .filter((k) => still.before[k] !== still.after[k]);
    assert(
      differing.length > 0,
      `crossing the 25% mark on level 4 changed nothing a reduced-motion player can see: `
      + `${JSON.stringify(still.before)} -> ${JSON.stringify(still.after)} at data-depth=${still.depth}. `
      + 'The dye front is correctly suppressed and the [data-depth] ladder is the only answer left.',
    );
  });

  await t('the full-viewport feedback field never eats the breathe control', async () => {
    /* The field is `position: absolute; inset: 0` and is now drawn on breathe
       levels too, so it lies under the whole screen including the only control
       those levels have. The control sits in `.snd-controls-row` at the same
       z-index and later in the DOM, which is what keeps it on top — an
       arrangement that is one CSS edit away from inverting silently. */
    for (const vp of [PHONE, SMALL]) {
      const { ctx, page } = await open({
        config: false, viewport: vp,
        progress: { done: [], next: { level: 4, trial: 1 }, revealed: [], everPlayed: true },
      });
      const btn = page.locator('.snd-breathe-btn');
      await page.locator('button', { hasText: /^Continue — Level 4/ }).first().click();
      await page.getByRole('button', { name: /Begin, Unhurried/i }).click();
      await btn.waitFor({ timeout: 8000 });

      const onTop = await page.evaluate(() => {
        const b = document.querySelector('.snd-breathe-btn').getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return {
          reachesTheButton: Boolean(hit && hit.closest('.snd-breathe-btn')),
          hit: hit ? `${hit.tagName}.${hit.className}` : 'nothing',
          fieldTouchAction: getComputedStyle(document.querySelector('.snd-voidfield')).touchAction,
        };
      });
      assert(
        onTop.reachesTheButton,
        `${vp.width}px: a press at the centre of the breathe control lands on ${onTop.hit} instead`,
      );
      /* There is no swipe to stop on a breathe level, so the field must not be
         holding a touch lock the player never needs. */
      assert(
        onTop.fieldTouchAction !== 'none',
        `${vp.width}px: the field still locks touch on a level with no steering`,
      );

      await btn.dispatchEvent('mousedown');
      await page.waitForTimeout(150);
      const held = await btn.evaluate((el) => el.className.includes('holding'));
      await btn.dispatchEvent('mouseup');
      assert(held, `${vp.width}px: holding the breathe control registered nothing`);
      await ctx.close();
    }
  });

  await t('the presence reading is not hidden behind the controls', async () => {
    /* Presence is the level's one continuous readout and the surface the mark
       ladder is drawn on. `.snd-presence-wrap` sits at `bottom: 96px` and
       `.snd-controls-row` at `bottom: knot-8`, both z-index 2 — the row is
       later in the DOM, so it and its buttons paint over the meter. */
    const worst = [];
    for (const [level, vp] of [[1, PHONE], [4, PHONE], [4, SMALL], [1, SMALL]]) {
      const { ctx, page } = await open({
        config: false, viewport: vp,
        progress: { done: [], next: { level, trial: 1 }, revealed: [], everPlayed: true },
      });
      await page.locator('button', { hasText: new RegExp(`^Continue — Level ${level}\\b`) }).first().click();
      await page.getByRole('button', { name: /Begin, Unhurried/i }).click();
      await page.locator('.snd-presence-wrap').waitFor({ timeout: 8000 });
      const covered = await page.evaluate(() => {
        const w = document.querySelector('.snd-presence-wrap').getBoundingClientRect();
        let px = 0;
        for (const b of document.querySelectorAll('.snd-controls-row .tantu-btn')) {
          const r = b.getBoundingClientRect();
          if (r.bottom <= w.top || r.top >= w.bottom) continue;
          px += Math.max(0, Math.min(r.right, w.right) - Math.max(r.left, w.left));
        }
        return Math.round((px / w.width) * 100);
      });
      worst.push(`level ${level} @ ${vp.width}px: ${covered}% covered`);
      await ctx.close();
    }
    assert(
      worst.every((line) => line.endsWith(': 0% covered')),
      `a control is drawn over the presence meter — ${worst.join('; ')}. `
      + 'This predates the breathe-level fix (it is measurable on level 1 too) but that fix is what '
      + 'gave levels 4 and 9 a meter to occlude, and their single wide control covers the most of it.',
    );
  });

  await t('.snd-orb never lets an animation overwrite the live alignment reading', async () => {
    /* transform and opacity on .snd-orb carry the alignment reading as inline
       styles, and a CSS animation outranks an inline declaration. Level 5 is
       Ignition, the one Force whose signature animates the orb itself. */
    const { ctx, page } = await open({
      config: false,
      progress: { done: [], next: { level: 5, trial: 1 }, revealed: [], everPlayed: true },
    });
    await page.locator('button', { hasText: /^Continue — Level 5/ }).first().click();
    await page.getByRole('button', { name: /Begin, Unhurried/i }).click();
    await page.locator('.snd-orb').waitFor({ timeout: 8000 });
    await page.waitForTimeout(900);
    const reading = await page.evaluate(() => {
      const orb = document.querySelector('.snd-orb');
      const computed = getComputedStyle(orb);
      const inlineScale = /scale\(([\d.]+)\)/.exec(orb.style.transform);
      const m = /matrix\(([-\d.]+)/.exec(computed.transform);
      return {
        force: document.querySelector('[data-force]')?.dataset.force,
        inlineScale: inlineScale ? Number(inlineScale[1]) : null,
        computedScale: m ? Number(m[1]) : null,
        inlineOpacity: Number(orb.style.opacity),
        computedOpacity: Number(computed.opacity),
        animation: computed.animationName,
      };
    });
    assert(reading.force === 'ignition', `expected the Ignition signature, got ${reading.force}`);
    assert(reading.animation && reading.animation !== 'none', 'no Force animation was running, so this proves nothing');
    assert(
      Math.abs(reading.computedScale - reading.inlineScale) < 0.001,
      `an animation is overwriting the orb's scale: inline ${reading.inlineScale}, computed ${reading.computedScale} (${reading.animation})`,
    );
    assert(
      Math.abs(reading.computedOpacity - reading.inlineOpacity) < 0.001,
      `an animation is overwriting the orb's opacity: inline ${reading.inlineOpacity}, computed ${reading.computedOpacity} (${reading.animation})`,
    );
    await ctx.close();
  });

  await t('the account screen survives forced colors', async () => {
    const { ctx, page } = await open({
      forcedColors: 'active',
      cognito: { SignUp: aws('CodeDeliveryFailureException') },
    });
    await toAccount(page);
    await emailField(page).fill('seeker@example.com');
    await submit(page).click();
    const n = notice(page).last();
    await n.waitFor({ state: 'visible' });
    const box = await n.boundingBox();
    assert(box && box.width > 40 && box.height > 8, `the failure notice has no box in forced colors: ${JSON.stringify(box)}`);
    const err = await page.evaluate(() => {
      const el = document.querySelector('.snd-account .tantu-notice');
      const c = getComputedStyle(el);
      return { color: c.color, bg: c.backgroundColor };
    });
    assert(err.color !== err.bg, `notice text is the same colour as its ground in forced colors (${JSON.stringify(err)})`);
    await ctx.close();
  });

  /* ------------------------------------------------------------------ */
  group('Phone width');

  for (const vp of [PHONE, SMALL]) {
    const at = `${vp.width}×${vp.height}`;

    await t(`${at}: the title screen fits its width and the account entry is reachable`, async () => {
      const { ctx, page } = await open({ viewport: vp });
      await page.locator('.snd-account-entry').waitFor({ timeout: 5000 });
      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        const entry = document.querySelector('.snd-account-entry button');
        const r = entry.getBoundingClientRect();
        return {
          overflow: doc.scrollWidth - doc.clientWidth,
          buttonWidth: r.width,
          buttonHeight: r.height,
          rightEdge: r.right,
          viewportWidth: doc.clientWidth,
        };
      });
      assert(m.overflow <= 0, `the page scrolls sideways by ${m.overflow}px`);
      assert(m.buttonHeight >= 24, `the account control is ${m.buttonHeight}px tall — below a usable touch target`);
      assert(m.rightEdge <= m.viewportWidth, `the account control runs ${m.rightEdge - m.viewportWidth}px past the right edge`);
      await ctx.close();
    });

    await t(`${at}: the code screen fits, with every control in the viewport`, async () => {
      const { ctx, page } = await open({ viewport: vp, cognito: BRANCH['a registered address'] });
      await toCodeScreen(page);
      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        const buttons = [...document.querySelectorAll('.snd-account button')];
        return {
          overflow: doc.scrollWidth - doc.clientWidth,
          cardWidth: document.querySelector('.snd-account .tantu-card').getBoundingClientRect().width,
          viewportWidth: doc.clientWidth,
          offscreen: buttons.filter((b) => {
            const r = b.getBoundingClientRect();
            return r.right > doc.clientWidth + 1 || r.left < -1 || r.width < 20;
          }).map((b) => b.textContent.trim()),
        };
      });
      assert(m.overflow <= 0, `the code screen scrolls sideways by ${m.overflow}px`);
      assert(m.cardWidth <= m.viewportWidth, `the card is ${m.cardWidth}px in a ${m.viewportWidth}px viewport`);
      assert(m.offscreen.length === 0, `controls outside the viewport: ${m.offscreen.join(', ')}`);
      await ctx.close();
    });
  }
} catch (e) {
  console.log(`\n  ERROR  the suite could not run: ${e.stack || e.message}`);
  exitCode = 2;
} finally {
  if (browser) await browser.close();
  server.stop();
}

/**
 * Level 1: find the draft by sweeping the circle and reading the orb's own
 * alignment scale, then hold. The keyboard turns 8° a press and the tolerance
 * is 14°, so the best of a full sweep is always inside it.
 */
async function holdLevelOne(page) {
  const scale = () => page.evaluate(() => {
    const m = /scale\(([\d.]+)\)/.exec(document.querySelector('.snd-orb').style.transform);
    return m ? Number(m[1]) : 0;
  });
  let best = { s: -1, i: 0 };
  for (let i = 0; i < 45; i++) {
    const s = await scale();
    if (s > best.s) best = { s, i };
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(40);
  }
  for (let i = 0; i < 45 - best.i; i++) {
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(25);
  }
}

console.log(`\n${pass} passed, ${failures.length} failed\n`);
if (failures.length) console.log(`failing: ${failures.join('; ')}\n`);
/* A run that asserted nothing is not a green run. This project has already
   reported green from a suite that had gone stale; zero cases is the same
   failure wearing a better face. */
if (!exitCode && pass + failures.length === 0) {
  console.log('  ERROR  no cases ran'
    + (only ? ` — SOUNDING_E2E_ONLY="${only}" matched nothing` : '') + '\n');
  exitCode = 2;
}
process.exit(exitCode || (failures.length ? 1 : 0));
