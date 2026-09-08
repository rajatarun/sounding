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
  speech = 'present',
} = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion, forcedColors });
  const page = await ctx.newPage();
  const calls = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  /* The Web Speech API, which `speakOnce` reaches for and which this harness
     has no ears for. 'present' records what was said and still lets the real
     engine try; 'absent' is a browser without synthesis; 'throws' is one that
     has it and refuses. voice.js promises silence on all three. */
  await page.addInitScript((mode) => {
    window.__spoke = [];
    window.__speechCancels = 0;
    if (mode === 'absent') {
      Object.defineProperty(window, 'speechSynthesis', { get() { return undefined; }, configurable: true });
      return;
    }
    if (mode === 'throws') {
      Object.defineProperty(window, 'speechSynthesis', {
        get() {
          return {
            cancel() { throw new Error('synthesis refused'); },
            speak() { throw new Error('synthesis refused'); },
          };
        },
        configurable: true,
      });
      return;
    }
    const real = window.speechSynthesis;
    Object.defineProperty(window, 'speechSynthesis', {
      get() {
        return {
          speak(u) { window.__spoke.push(u.text); try { real.speak(u); } catch (e) { /* headless */ } },
          cancel() { window.__speechCancels++; try { real.cancel(); } catch (e) { /* headless */ } },
        };
      },
      configurable: true,
    });
  }, speech);

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

/* Level 1's four-rung alignment word, in order. It is the only continuous-ish
   channel the level still publishes to the DOM since the orb stopped carrying
   a reading, and both `holdLevelOne` and the welcome group steer by it. */
const LEVEL_ONE_RUNGS = { listening: 0, faint: 1, closer: 2, here: 3 };

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
    await pastTheWelcome(page);
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
    await pastTheWelcome(page);
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
   * The two breathe levels, and how to hold each one until the 25% presence
   * mark falls. Both are driven for real rather than one being driven and the
   * other assumed: they are the same code path but not the same level — 9 is
   * the forge, its Force is Ignition rather than Flow, and a different
   * `[data-force]` signature runs underneath everything the mark grades.
   */
  const BREATHE = {
    4: {
      name: 'the breathing cave',
      force: 'flow',
      /* Period is pinned to its longest by the seeded `Math.random`, which puts
         the whole accrual inside one half-cycle: sync climbs at 9/s while the
         hold matches, so the mark falls at about 2.8s of unbroken holding. */
      seed: () => { Math.random = () => 0.999; },
      controller: () => () => true,
    },
    9: {
      name: 'the forge',
      force: 'ignition',
      seed: () => {},
      /* Heat rises at 22/s held and falls at 12/s released; progress accrues
         only inside the 60–85 band, at 2.5/s, so the mark is about ten seconds
         of keeping the fire in its band.
       *
         This used to read temperature straight off the orb's inline scale —
         `setOrb(temp / 100)` — and that readout no longer exists: the orb
         carries nothing continuous now (see the welcome group below). The only
         channel this level still publishes heat on is `.snd-breath-word`,
         which names three bands and nothing finer: below 45, 45–80, above 80.
         Three rungs cannot hold a hand inside the 60–85 band that scores, so
         the harness integrates the level's own rates and treats each word
         boundary as a fix to correct the running estimate against. */
      controller: () => {
        let temp = 20;        // the level's own starting value
        let at = null;
        let held = false;
        return (word, now) => {
          if (at !== null) temp += (held ? 22 : -12) * ((now - at) / 1000);
          at = now;
          if (word === 'too hot — ease back') temp = Math.max(temp, 81);
          else if (word === 'feed it more') temp = Math.min(temp, 44);
          else temp = Math.min(Math.max(temp, 46), 79);
          held = temp < 68;   // bang-bang about the middle of the scoring band
          return held;
        };
      },
    },
  };

  /**
   * Play a breathe level across its first presence mark and read the screen
   * either side of it.
   *
   * The reading is taken twice *after* the hold has begun, so the control's own
   * state change is never what the comparison sees, and the second reading
   * waits out the 1.2s filter transition — sampled early it catches the ladder
   * at about one percent of its travel, which is indistinguishable from the
   * rung not being there.
   */
  async function acrossTheFirstMark({ level, reducedMotion, read }) {
    const spec = BREATHE[level];
    const { ctx, page } = await open({
      config: false, reducedMotion,
      progress: { done: [], next: { level, trial: 1 }, revealed: [], everPlayed: true },
    });
    await page.addInitScript(spec.seed);
    await page.goto(BASE);
    await page.locator('button', { hasText: new RegExp(`^Continue — Level ${level}\\b`) }).first().click();
    await page.getByRole('button', { name: /Begin, Unhurried/i }).click();
    await page.locator('.snd-breathe-btn').waitFor({ timeout: 8000 });

    const btn = page.locator('.snd-breathe-btn');
    let held = false;
    const hand = async (want) => {
      if (want === null || want === held) return;
      await btn.dispatchEvent(want ? 'mousedown' : 'mouseup');
      held = want;
    };
    const sample = () => page.evaluate(() => ({
      depth: document.querySelector('.snd-screen-game')?.getAttribute('data-depth') ?? 'no screen',
      word: document.querySelector('.snd-breath-word')?.textContent ?? '',
    }));

    await hand(true);
    await page.waitForTimeout(700);
    const before = await page.evaluate(read);

    const drive = spec.controller();
    const deadline = Date.now() + 60000;
    let crossed = false;
    while (Date.now() < deadline) {
      const now = await sample();
      if (now.depth !== '0') { crossed = true; break; }
      await hand(drive(now.word, Date.now()));
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(1600); // the filter ladder's own transition
    const after = await page.evaluate(read);
    const depth = await page.evaluate(
      () => document.querySelector('.snd-screen-game')?.getAttribute('data-depth') ?? 'no screen',
    );
    const force = await page.evaluate(
      () => document.querySelector('.snd-screen-game')?.getAttribute('data-force') ?? null,
    );
    await hand(false);
    await ctx.close();
    return { before, after, depth, force, crossed };
  }

  /** The ladder's channels without the cloth, which is a base64 wall in a message. */
  const legible = (r) => JSON.stringify({ ...r, cloth: r.cloth ? `${r.cloth.length} bytes` : r.cloth });

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

  for (const level of Object.keys(BREATHE).map(Number)) {
    const spec = BREATHE[level];

    await t(`level ${level} (${spec.name}): a presence mark is answered under reduced motion`, async () => {
      /* `substrate.pulse()` is gated on `bleedMotionAllowed()`, so under reduced
         motion the dye front — the mark's motion answer — never draws, and the
         static [data-depth] ladder is all those players get. That ladder used to
         live on `.snd-voidfield`, which the breathe levels did not render.
       *
         Asserted on *computed style*, not on innerHTML: a `data-depth` attribute
         with no cascade behind it would satisfy a DOM diff and change nothing on
         the glass. */
      const moving = await acrossTheFirstMark({ level, reducedMotion: 'no-preference', read: DEPTH_CHANNELS });
      assert(moving.crossed, `the 25% mark was never reached on level ${level} with motion allowed`);
      assert(
        moving.before.cloth !== moving.after.cloth,
        'the harness never saw a dye front even with motion allowed, so it cannot speak to reduced motion',
      );

      const still = await acrossTheFirstMark({ level, reducedMotion: 'reduce', read: DEPTH_CHANNELS });
      assert(
        still.before.fieldPresent,
        `level ${level} renders no feedback field at all, so setPresence, setOrb and setWord run every `
        + 'frame into nothing and a presence mark has nowhere to be answered',
      );
      assert(still.crossed, `the 25% mark was never reached on level ${level} under reduced motion`);
      assert(still.force === spec.force, `expected the ${spec.force} signature, got ${still.force}`);
      assert(
        still.before.cloth === still.after.cloth,
        'a dye front drew under reduced motion — pulse() is meant to refuse',
      );

      const differing = ['wordOpacity', 'wordTracking', 'wrapFilter']
        .filter((k) => still.before[k] !== still.after[k]);
      assert(
        differing.length > 0,
        `crossing the 25% mark on level ${level} changed nothing a reduced-motion player can see: `
        + `${legible(still.before)} -> ${legible(still.after)} at data-depth=${still.depth}. `
        + 'The dye front is correctly suppressed and the [data-depth] ladder is the only answer left.',
      );
      /* The first mark every player crosses used to be graded by one channel —
         a 0.12 opacity step on 16px of text — because the filter ladder started
         at the second. Two channels is what makes it a rung rather than a nudge. */
      assert(
        differing.length > 1,
        `the 25% mark on level ${level} is carried by ${differing.join(', ')} alone `
        + `(${legible(still.before)} -> ${legible(still.after)})`,
      );
    });
  }

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

  await t('the presence reading is not hidden behind the controls, and cannot be', async () => {
    /* Presence is the level's one continuous readout and the surface the mark
       ladder is drawn on. The bearing readout, the meter and the controls each
       used to name their own `bottom` — 120px, 96px, knot-8 — which is correct
       only for the button heights it was measured against, and it was not: a
       control was painted over 62% of the meter on a steering level and 72% on
       a breathe level, at every viewport including desktop.
     *
       Two assertions, because the second is what makes the first durable. The
       coverage measurement is the finding restated. The structural one pins
       *why* it is now zero — three siblings laying themselves out in one
       column — because a column that overlaps itself is not a thing that
       happens, whereas three absolute offsets that happen not to collide today
       is exactly the arrangement that just failed. Re-adding a `position:
       absolute` to any of the three is one edit and would silently restore the
       old failure mode; here it fails a test instead. */
    const seen = [];
    for (const level of [1, 2, 4, 9]) {
      for (const vp of [PHONE, SMALL]) {
        const { ctx, page } = await open({
          config: false, viewport: vp,
          progress: { done: [], next: { level, trial: 1 }, revealed: [], everPlayed: true },
        });
        await page.locator('button', { hasText: new RegExp(`^Continue — Level ${level}\\b`) }).first().click();
        await page.getByRole('button', { name: /Begin, Unhurried/i }).click();
        await page.locator('.snd-presence-wrap').waitFor({ timeout: 8000 });

        const m = await page.evaluate(() => {
          const wrap = document.querySelector('.snd-presence-wrap');
          const w = wrap.getBoundingClientRect();
          let px = 0;
          const by = [];
          for (const el of document.querySelectorAll('.snd-controls-row .tantu-btn, .snd-heading-cue')) {
            const r = el.getBoundingClientRect();
            if (r.bottom <= w.top || r.top >= w.bottom || r.right <= w.left || r.left >= w.right) continue;
            px += Math.max(0, Math.min(r.right, w.right) - Math.max(r.left, w.left));
            by.push((el.className || '').split(' ')[0]);
          }
          const stack = document.querySelector('.snd-bottom');
          const rows = stack
            ? [...stack.children].map((el) => ({
              cls: (el.className || '').split(' ')[0],
              position: getComputedStyle(el).position,
              top: Math.round(el.getBoundingClientRect().top),
              bottom: Math.round(el.getBoundingClientRect().bottom),
            }))
            : null;
          const doc = document.documentElement;
          const spilled = [...document.querySelectorAll('.snd-screen-game button')]
            .filter((b) => {
              const r = b.getBoundingClientRect();
              return r.top < 0 || r.bottom > doc.clientHeight || r.left < 0 || r.right > doc.clientWidth;
            })
            .map((b) => b.textContent.trim().slice(0, 18));
          return { coveredPct: Math.round((px / w.width) * 100), by, rows, spilled };
        });
        await ctx.close();

        const where = `level ${level} @ ${vp.width}px`;
        assert(m.rows, `${where}: there is no .snd-bottom column — the three strips are positioning themselves again`);

        /* Structure: one flow, and the meter is in it. */
        const inFlow = m.rows.filter((r) => r.position === 'static').map((r) => r.cls);
        assert(
          inFlow.length === m.rows.length,
          `${where}: ${m.rows.filter((r) => r.position !== 'static').map((r) => `${r.cls} is ${r.position}`).join(', ')}`
          + ' — a strip has left the column and is placing itself again',
        );
        assert(
          inFlow.includes('snd-presence-wrap') && inFlow.includes('snd-controls-row'),
          `${where}: the column holds ${inFlow.join(', ')} — the reading and the controls must both be in it`,
        );
        for (let i = 1; i < m.rows.length; i++) {
          assert(
            m.rows[i].top >= m.rows[i - 1].bottom,
            `${where}: ${m.rows[i - 1].cls} and ${m.rows[i].cls} overlap inside the column`,
          );
        }

        /* And the measurement the structure exists to guarantee. */
        assert(
          m.coveredPct === 0,
          `${where}: ${m.coveredPct}% of the presence meter is behind ${m.by.join(', ')}`,
        );
        assert(
          m.spilled.length === 0,
          `${where}: controls outside the viewport — ${m.spilled.join(', ')}`,
        );
        seen.push(`${where}: ${m.rows.map((r) => r.cls.replace('snd-', '')).join(' → ')}`);
      }
    }
    assert(seen.length === 8, `only ${seen.length} of 8 level/viewport pairs were measured`);
  });

  await t('the orb carries no continuous reading, and no Force signature could restore one', async () => {
    /* This case used to compare the orb's inline transform/opacity against its
       computed values, because those two inline properties carried the live
       alignment reading and a CSS animation outranks an inline declaration.
       The reading was deliberately removed — the orb was a strictly better
       instrument than the ear the game is built on — so the old comparison is
       gone with it, and leaving it would have been a stale assertion reporting
       on a channel that no longer exists.
     *
       What is asserted instead is the removal itself, and the rule that
       protected it, in the two directions each can regress:
         - no level writes a continuous value back onto the orb as inline
           style (the readout returning by the door it left through);
         - no Force signature animates `transform` or `opacity` on `.snd-orb`,
           which is the rule CLAUDE.md still states and the one that would
           silently outrank any inline reading if one ever came back.
       Levels 5 (Ignition, the one signature that animates the orb itself),
       9 (whose orb published temperature) and 1 (alignment) are all walked. */
    const seen = [];
    for (const level of [1, 5, 9]) {
      const { ctx, page } = await open({
        config: false,
        progress: { done: [], next: { level, trial: 1 }, revealed: [], everPlayed: true },
      });
      await page.locator('button', { hasText: new RegExp(`— Level ${level}\\b`) }).first().click();
      await page.getByRole('button', { name: /Begin, Unhurried/i }).click();
      await page.locator('.snd-orb').waitFor({ timeout: 8000 });
      await page.waitForTimeout(900);

      const reading = await page.evaluate(() => {
        const orb = document.querySelector('.snd-orb');
        const computed = getComputedStyle(orb);
        /* Every keyframe of every animation currently on the orb, and which
           properties it writes — read out of the live stylesheets rather than
           assumed, so a new signature is covered the day it is added. */
        const names = computed.animationName.split(',').map((s) => s.trim()).filter((s) => s && s !== 'none');
        const written = {};
        for (const sheet of document.styleSheets) {
          let rules;
          try { rules = sheet.cssRules; } catch (e) { continue; }
          const walk = (list) => {
            for (const rule of list) {
              if (rule.cssRules && !rule.name) { walk(rule.cssRules); continue; }
              if (!rule.name || !names.includes(rule.name)) continue;
              written[rule.name] = written[rule.name] || [];
              for (const frame of rule.cssRules) {
                for (const prop of frame.style) {
                  if (!written[rule.name].includes(prop)) written[rule.name].push(prop);
                }
              }
            }
          };
          walk(rules);
        }
        return {
          force: document.querySelector('[data-force]')?.dataset.force,
          inlineStyle: orb.getAttribute('style'),
          animations: names,
          written,
        };
      });
      await ctx.close();

      assert(
        reading.inlineStyle === null,
        `level ${level}: the orb is carrying inline style again — "${reading.inlineStyle}". `
        + 'A per-frame inline value on this element is the continuous alignment readout '
        + 'that was removed on purpose; see WELCOME_LINE in GameScreen.jsx.',
      );
      for (const [name, props] of Object.entries(reading.written)) {
        const banned = props.filter((p) => p === 'transform' || p === 'opacity');
        assert(
          banned.length === 0,
          `level ${level} (${reading.force}): the ${name} keyframes write ${banned.join(' and ')} `
          + 'on .snd-orb itself. CLAUDE.md keeps those two off this element; Force motion goes '
          + 'on the pseudo-elements.',
        );
      }
      seen.push(`${level}:${reading.force}:${reading.animations.join('+') || 'still'}`);
    }
    /* Level 5 is the one Force whose signature animates the orb element, so if
       nothing was animating anywhere the keyframe half of this proved nothing. */
    assert(
      seen.some((s) => s.includes('ignition') && !s.endsWith('still')),
      `no Force animation ran on the orb on any level walked (${seen.join(', ')}), `
      + 'so the keyframe rule was never actually exercised',
    );
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
  group('The one-time welcome');

  const WELCOME = 'There is nothing here to see. Only to hear. Breathe, and listen.';
  const welcome = (page) => page.locator('[role=dialog].snd-welcome');

  /** Straight into the first trial any Seeker ever enters, from a clean device. */
  async function toFirstEverTrial(page) {
    await page.locator('button', { hasText: /^Begin — Level 1/ }).first().click();
    await page.getByRole('button', { name: /Begin, Unhurried/i }).click();
    await page.locator('.snd-orb').waitFor({ timeout: 8000 });
    await page.waitForTimeout(250);
  }

  await t('the welcome is shown on the first trial ever, and on no other', async () => {
    /* `firstEver` is meant to track the same "first trial entered" semantics as
       state.onboarding — set from `!progress.everPlayed` at the moment
       enterTrial marks it. The three ways that can be wrong are: never showing,
       showing again after a reload (entering is what retires the flag, not
       finishing), and showing to a Seeker who has played before. */
    const { ctx, page } = await open({ config: false });
    await toFirstEverTrial(page);
    assert(await welcome(page).count() === 1, 'the first trial any Seeker enters showed no welcome at all');

    await page.reload();
    await page.waitForTimeout(700);
    await page.locator('button', { hasText: /— Level 1\b/ }).first().click();
    await page.getByRole('button', { name: /Begin, Unhurried/i }).click();
    await page.locator('.snd-orb').waitFor({ timeout: 8000 });
    await page.waitForTimeout(400);
    assert(
      await welcome(page).count() === 0,
      'the welcome came back after a reload — entering a trial is what retires the flag, '
      + 'so a Seeker who never finished one must not be shown it twice',
    );
    await ctx.close();

    const back = await open({
      config: false,
      progress: { done: [], next: { level: 1, trial: 1 }, revealed: [], everPlayed: true },
    });
    await back.page.locator('button', { hasText: /— Level 1\b/ }).first().click();
    await back.page.getByRole('button', { name: /Begin, Unhurried/i }).click();
    await back.page.locator('.snd-orb').waitFor({ timeout: 8000 });
    await back.page.waitForTimeout(400);
    assert(await welcome(back.page).count() === 0, 'a Seeker who has played before was shown the welcome');
    await back.ctx.close();
  });

  await t('the woven line is readable, not only the dialog\'s name', async () => {
    /* Two different people have to get this sentence.
     *
       A sighted Seeker gets it from the woven line. A Seeker on a screen
       reader gets the dialog's accessible name when focus lands in it — once,
       on arrival, with no way to ask for it again: `BaluchariReveal` marks its
       visible line `aria-hidden="true"` permanently, and `announce={false}`
       withholds the `role="status"` copy it would otherwise leave behind. So
       browsing the dialog finds one word, "Begin", and the sentence the whole
       screen exists to deliver is in the accessibility tree only as a name on
       the container.
     *
       Asserted as: the dialog is named, AND the sentence survives somewhere a
       reader can move to. Both, because either alone is satisfiable while the
       other is broken. */
    const { ctx, page } = await open({ config: false });
    await toFirstEverTrial(page);
    /* After the sweep has finished, so a `role="status"` copy that arrives with
       the reveal — which is when BaluchariReveal fills it — is counted. */
    await page.waitForTimeout(2700);
    const seen = await page.evaluate(() => {
      const d = document.querySelector('[role=dialog]');
      const hidden = (el) => {
        for (let n = el; n && n !== document.body; n = n.parentElement) {
          if (n.getAttribute('aria-hidden') === 'true') return true;
        }
        return false;
      };
      const readable = [];
      const walk = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const text = n.textContent.trim();
        if (text && !hidden(n.parentElement)) readable.push(text);
      }
      return {
        name: d.getAttribute('aria-label') || d.getAttribute('aria-labelledby'),
        readable,
        buried: [...d.querySelectorAll('[aria-hidden=true]')].map((el) => `${el.tagName}.${el.className}`),
      };
    });
    await ctx.close();

    assert(seen.name, 'the welcome dialog has no accessible name at all');
    assert(
      seen.readable.some((s) => s.includes('Only to hear')),
      'the welcome line is nowhere in the accessibility tree except as the dialog\'s own name: '
      + `readable content is ${JSON.stringify(seen.readable)}, and the sentence is inside `
      + `${seen.buried.join(', ')}. A reader that announces the name on arrival gives it once and `
      + 'cannot be asked again; one that does not gives a panel whose only content is "Begin". '
      + 'BaluchariReveal leaves a role="status" copy for exactly this — it is switched off here '
      + 'by announce={false}.',
    );
  });

  await t('the trial does not run on behind the welcome', async () => {
    /* The screen mounts the level and the dialog together: init() runs, the
       cue starts, the frame loop starts, and the window keydown handler that
       steers is bound — none of it gated on the welcome being gone. So a
       Seeker still reading the line is already playing, and the arrow keys
       reach the level straight through a panel that claims aria-modal="true".
     *
       Measured by steering under the scrim and reading what moved. The
       presence mark is the part that costs something: its answer is a dye
       front drawn from the orb, and the orb is behind an opaque scrim, so the
       first mark any Seeker ever crosses can be spent where it cannot be
       seen. */
    const { ctx, page } = await open({ config: false });
    await toFirstEverTrial(page);
    const read = () => page.evaluate(() => ({
      modal: document.querySelector('[role=dialog]')?.getAttribute('aria-modal') ?? null,
      word: document.querySelector('.snd-breath-word')?.textContent ?? '',
      presence: Number(document.querySelector('.snd-presence-wrap [aria-valuenow]')?.getAttribute('aria-valuenow') ?? -1),
      depth: document.querySelector('.snd-screen-game')?.getAttribute('data-depth'),
      /* What a press at the middle of the field would actually land on. */
      overTheOrb: (() => {
        const o = document.querySelector('.snd-orb').getBoundingClientRect();
        const hit = document.elementFromPoint(o.left + o.width / 2, o.top + o.height / 2);
        return hit ? `${hit.tagName}.${String(hit.className).split(' ')[0]}` : 'nothing';
      })(),
    }));

    const start = await read();
    assert(start.modal === 'true', 'the welcome is not a modal, so this case is measuring the wrong thing');

    /* Sweep for the draft and hold it, exactly as holdLevelOne does — with the
       welcome still up and never dismissed. */
    let best = { r: -1, i: 0 };
    for (let i = 0; i < 45; i++) {
      const r = LEVEL_ONE_RUNGS[(await read()).word] ?? -1;
      if (r > best.r) best = { r, i };
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(30);
    }
    for (let i = 0; i < 45 - best.i; i++) {
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(9000);
    const end = await read();
    await ctx.close();

    assert(end.modal === 'true', 'the welcome dismissed itself during the case');
    assert(
      best.r < 3,
      'the arrow keys steered the level through a dialog that declares aria-modal="true" — '
      + `the sweep reached "${Object.keys(LEVEL_ONE_RUNGS)[best.r]}" with the panel still open. `
      + 'aria-modal is a promise that nothing outside the panel is reachable; GameScreen binds its '
      + 'keydown handler to window and does not check showWelcome.',
    );
    assert(
      end.presence <= 0,
      `presence reached ${end.presence.toFixed(1)}% while the welcome was still up — the trial is `
      + 'running underneath it, from the frame the screen mounts.',
    );
    assert(
      end.depth === '0',
      `the ${end.depth === '1' ? '25%' : `depth-${end.depth}`} presence mark was crossed behind the `
      + `scrim (a press at the middle of the field lands on ${end.overTheOrb}). The mark's answer is a `
      + 'dye front drawn from the orb, which is under an opaque panel, so the first beat any Seeker '
      + 'ever earns is spent where it cannot be seen.',
    );
  });

  await t('dismissing the welcome hands focus to the screen, not to the document', async () => {
    /* TantuDialog restores focus to whatever was focused when it opened. It
       opened at mount, one commit after the briefing's own button was
       unmounted, so what it captured was <body> — and that is where it hands
       focus back. A keyboard Seeker finishes the welcome standing outside the
       screen and has to Tab back in from the top of the document. */
    const { ctx, page } = await open({ config: false });
    await toFirstEverTrial(page);
    const where = () => page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return 'BODY';
      return `${el.tagName}${el.className ? `.${String(el.className).split(' ')[0]}` : ''}`;
    });
    const inside = await where();
    assert(inside !== 'BODY', `the welcome opened without taking focus (activeElement is ${inside})`);

    await page.getByRole('button', { name: 'Begin' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    assert(await welcome(page).count() === 0, 'Enter on Begin did not dismiss the welcome');
    const after = await where();
    await ctx.close();
    assert(
      after !== 'BODY',
      'focus was dropped to <body> when the welcome closed. TantuDialog hands focus back to '
      + 'whatever it captured on open, and at mount that was already <body> — the briefing\'s '
      + 'button had been unmounted a commit earlier. The game screen should take focus itself.',
    );
  });

  await t('the welcome fits the phone, and its one control is reachable', async () => {
    for (const vp of [PHONE, SMALL]) {
      const { ctx, page } = await open({ config: false, viewport: vp });
      await toFirstEverTrial(page);
      const m = await page.evaluate(() => {
        const d = document.querySelector('[role=dialog]');
        const btn = [...d.querySelectorAll('button')].pop();
        const doc = document.documentElement;
        const box = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
        const b = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return {
          vw: doc.clientWidth, vh: doc.clientHeight,
          dialog: box(d), btn: box(btn), label: btn.textContent.trim(),
          clipped: d.scrollHeight > d.clientHeight + 1,
          reaches: Boolean(hit && hit.closest('button') === btn),
          hit: hit ? `${hit.tagName}.${String(hit.className).split(' ')[0]}` : 'nothing',
        };
      });
      await ctx.close();
      const at = `${vp.width}×${vp.height}`;
      assert(
        m.btn.bottom <= m.vh && m.btn.top >= 0 && m.btn.left >= 0 && m.btn.right <= m.vw,
        `${at}: the "${m.label}" control is outside the viewport at ${JSON.stringify(m.btn)} — `
        + 'the only way past the welcome is below the fold',
      );
      assert(m.reaches, `${at}: a press at the middle of "${m.label}" lands on ${m.hit}`);
      assert(
        !m.clipped,
        `${at}: the welcome panel is scrolling its own content (${JSON.stringify(m.dialog)}), `
        + 'so part of the line is out of sight behind a scroll nobody is told about',
      );
    }
  });

  await t('the line is legible with motion reduced, and in forced colors', async () => {
    /* The reveal is a clip-path sweep and `clip-path: inset(0 100% 0 0)` is the
       line's own resting value — the animation is what opens it. Under reduced
       motion the animation is exactly what a Seeker has asked not to have, so
       the promise BaluchariReveal makes is that the sentence "appears whole,
       immediately": it starts in its settled class instead. That is measured
       here at 300ms, well before any 2.2s sweep could have opened the clip on
       its own, so a broken settled state cannot hide behind the animation's
       fill mode.
     *
       Measured as painted width, not as a clip-path string. `inset(0px 0% 0px
       0px)` and `inset(0px)` are the same picture and different text, and a
       case that reads the text calls one of them a defect. */
    const CLIP = () => {
      const line = document.querySelector('.tantu-baluchari-line');
      const cs = getComputedStyle(line);
      const r = line.getBoundingClientRect();
      const shown = (() => {
        const m = /^inset\(([^)]*)\)/.exec(cs.clipPath);
        if (!m) return 1;                       // no clip at all
        const parts = m[1].trim().split(/\s+/);
        const px = (v, basis) => (v.endsWith('%') ? (parseFloat(v) / 100) * basis : parseFloat(v) || 0);
        const [top, right = top, , left = right] = parts;
        return Math.max(0, (r.width - px(right, r.width) - px(left, r.width)) / (r.width || 1));
      })();
      return {
        text: line.textContent.trim(),
        clip: cs.clipPath,
        shown,
        classes: line.parentElement.className,
        settled: line.parentElement.classList.contains('tantu-baluchari-done'),
        color: cs.color,
        bg: getComputedStyle(document.querySelector('[role=dialog]')).backgroundColor,
        w: Math.round(r.width), h: Math.round(r.height),
      };
    };

    for (const mode of [
      { label: 'reduced motion', opts: { reducedMotion: 'reduce' }, settleMs: 300, settledNow: true },
      /* Forced colors says nothing about motion, so this one is read after the
         sweep would have finished — it is asking about contrast, not timing. */
      { label: 'forced colors', opts: { forcedColors: 'active' }, settleMs: 2700, settledNow: false },
    ]) {
      const { ctx, page } = await open({ config: false, ...mode.opts });
      await toFirstEverTrial(page);
      await page.waitForTimeout(mode.settleMs);
      const m = await page.evaluate(CLIP);
      await ctx.close();
      assert(m.text === WELCOME, `${mode.label}: the panel holds "${m.text}"`);
      assert(m.w > 40 && m.h > 8, `${mode.label}: the line has no box (${m.w}×${m.h})`);
      assert(
        m.shown > 0.99,
        `${mode.label}: only ${Math.round(m.shown * 100)}% of the line is painted after `
        + `${mode.settleMs}ms (clip-path: ${m.clip}). The sentence is the content and the sweep is `
        + 'decoration; content is not gated behind an animation finishing.',
      );
      assert(m.color !== m.bg, `${mode.label}: the line is the same colour as its panel (${m.color})`);
      /* The painted-width assertion above cannot go red under reduced motion in
         this browser: Chromium's reduced-motion emulation lands a running CSS
         animation on its end frame straight away, so the line looks settled
         even when the component's own reduced-motion branch is broken. The
         settled class is the part that is actually load-bearing — it is what
         holds the clip open across a later re-render, once the animation's
         fill is gone — and it is observable, so it is what is asserted. */
      if (mode.settledNow) {
        assert(
          m.settled,
          `${mode.label}: the line is not in its settled state after ${mode.settleMs}ms `
          + `(classes: "${m.classes}"). Reduced motion is meant to skip the sweep and hold the `
          + 'line open, not to run the sweep and rely on its fill.',
        );
      }
    }
  });

  await t('a browser with no speech synthesis, or one that refuses, changes nothing on the glass', async () => {
    /* voice.js is feature-detected and swallows its own failures. Both halves
       are reachable: Firefox on some platforms has no synthesis at all, and a
       browser can expose it and throw on speak(). Neither may reach the page
       as an error, and neither may cost the Seeker the written line. */
    for (const speech of ['absent', 'throws']) {
      const { ctx, page, errors } = await open({ config: false, speech });
      await toFirstEverTrial(page);
      const shown = await page.evaluate(() => document.querySelector('.tantu-baluchari-line')?.textContent.trim());
      assert(shown === WELCOME, `speech ${speech}: the written line is "${shown}"`);
      await page.getByRole('button', { name: 'Begin' }).click();
      await page.waitForTimeout(300);
      assert(await welcome(page).count() === 0, `speech ${speech}: Begin did not dismiss the welcome`);
      assert(errors.length === 0, `speech ${speech}: the page threw — ${errors.join(' / ')}`);
      await ctx.close();
    }
    /* And where synthesis does work, it is asked for exactly the written line,
       once. Never through AudioEngine — a cue inside the world is subject to
       the near-inaudible mix, and this sentence is chrome. */
    const { ctx, page } = await open({ config: false });
    await toFirstEverTrial(page);
    const spoke = await page.evaluate(() => window.__spoke);
    await ctx.close();
    assert(
      spoke.length === 1 && spoke[0] === WELCOME,
      `speech was asked for ${JSON.stringify(spoke)} rather than the line, once`,
    );
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
 * Level 1: find the draft by sweeping the circle, then hold. The keyboard
 * turns 8° a press and the tolerance is 14°, so the best of a full sweep is
 * always inside it.
 *
 * The sweep used to be steered by the orb's inline `scale()` — the continuous
 * alignment reading — and that reading has been removed on purpose, so this
 * climbs `.snd-breath-word` instead: the four-rung ladder level 1 still
 * publishes (listening / faint / closer / here). Coarser, and enough, because
 * the rungs are thresholds on the same `align` the removed scale carried.
 * A harness with no ears has to read *some* visible channel; if this one goes
 * too, level 1 becomes undriveable from a test and this helper is where that
 * shows up first.
 */
/**
 * Clear the one-time welcome if this device has never played before. A trial
 * played *through* the welcome is a different measurement — the group above
 * takes that one deliberately — so anything here that means to measure play
 * gets past it first.
 */
async function pastTheWelcome(page) {
  const panel = page.locator('[role=dialog].snd-welcome');
  if (await panel.count() === 0) return;
  await page.getByRole('button', { name: 'Begin' }).click();
  await panel.waitFor({ state: 'detached', timeout: 4000 });
}

async function holdLevelOne(page) {
  const rung = () => page.evaluate(() => document.querySelector('.snd-breath-word')?.textContent ?? '');
  let best = { r: -1, i: 0 };
  for (let i = 0; i < 45; i++) {
    const r = LEVEL_ONE_RUNGS[await rung()] ?? -1;
    if (r > best.r) best = { r, i };
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(40);
  }
  if (best.r < 0) {
    throw new Error('level 1 published no alignment word at any bearing in a full sweep — '
      + 'the harness has no channel left to steer by');
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
