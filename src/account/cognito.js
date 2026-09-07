/**
 * cognito.js — a zero-dependency Cognito user-pool client.
 *
 * The wire half of accounts. Grew out of the reference implementation that
 * still sits in infra/ beside the template provisioning the pool, changed in
 * one way: the pool is handed in at runtime by config.js rather than baked in,
 * so rotating it needs no rebuild and its absence is how the game ships with
 * accounts switched off.
 *
 * Why not a library: see infra/README.md § 1. The short version is that the
 * unauthenticated user-pool operations are plain unsigned JSON POSTs — no
 * SigV4, no SRP maths, no credential chain — so the whole client is the shape
 * below. `amazon-cognito-identity-js` costs 27 KB gzipped to do this, which is
 * 29% of the game's entire current bundle, and almost all of that weight is
 * the SRP implementation this design does not use.
 *
 * Every function returns { ok: true, ... } or { ok: false, state, ... } where
 * `state` is one of the UI states enumerated in infra/UI-STATES.md. Callers
 * never see a raw Cognito error code; the mapping is done once, here.
 */

const REGION = 'us-east-1';
const ENDPOINT = `https://cognito-idp.${REGION}.amazonaws.com/`;

/**
 * Every call is bounded. UI-STATES.md requires no pending state can last
 * forever; a hung socket is indistinguishable from a dead network to the
 * person holding the phone, and both should end up on the same retryable
 * screen rather than a spinner nobody can leave.
 */
const TIMEOUT_MS = 15000;

/**
 * Public identifiers, not secrets — a user pool id and an app client id with no
 * client secret are designed to ship in a browser. They arrive from
 * auth-config.json, which the deploy publishes beside the game from the stack
 * outputs; see config.js.
 */
export const POOL = { userPoolId: null, clientId: null };

/** Point the client at a pool. Called once, by config.js, before any call. */
export function configure({ userPoolId, userPoolClientId }) {
  POOL.userPoolId = userPoolId;
  POOL.clientId = userPoolClientId;
}

/** One unsigned JSON-1.1 call to the user-pool endpoint. */
async function call(target, body) {
  if (!POOL.clientId) return { ok: false, state: 'unknown', code: 'NotConfigured' };

  let res;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
  } catch (e) {
    // fetch() rejects on network failure, CORS, and our own abort — never on a
    // 4xx. All of them mean the same thing to the player: try again.
    return { ok: false, state: 'offline' };
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    /* a non-JSON body from a proxy or a 5xx page */
  }
  if (res.ok) return { ok: true, data: json };

  // "com.amazon.coral.service#NotAuthorizedException" -> "NotAuthorizedException"
  const type = String(json.__type || '').split('#').pop() || `Http${res.status}`;
  return { ok: false, state: mapError(type, res.status), code: type };
}

/**
 * Cognito's error taxonomy, collapsed onto the states the UI can draw.
 *
 * The default is deliberately 'unknown' rather than showing the raw message:
 * Cognito's messages are written for developers ("Invalid session for the
 * user, session is expired") and several of them leak whether an address is
 * registered, which is the one thing this flow must not tell an attacker.
 */
function mapError(type, status) {
  switch (type) {
    case 'UsernameExistsException':
      return 'already-registered';
    case 'UserNotFoundException':
    case 'NotAuthorizedException':
      // Both mean "that did not work" and must be indistinguishable — see
      // UI-STATES.md § Enumeration.
      return 'code-rejected';
    case 'CodeMismatchException':
      return 'code-rejected';
    case 'ExpiredCodeException':
      return 'code-expired';
    case 'UserNotConfirmedException':
      return 'unconfirmed';
    case 'LimitExceededException':
    case 'TooManyRequestsException':
    case 'TooManyFailedAttemptsException':
      return 'rate-limited';
    case 'InvalidParameterException':
      return 'address-rejected';
    case 'InvalidPasswordException':
      return 'password-rejected';
    case 'CodeDeliveryFailureException':
      return 'delivery-failed';
    case 'UserLambdaValidationException':
      return 'unknown';
    default:
      return status >= 500 ? 'service-down' : 'unknown';
  }
}

/* ------------------------------------------------------------------ sign-up */

/**
 * Create an account. The pool takes one attribute — an email address — and no
 * password: `AllowedFirstAuthFactors: [EMAIL_OTP]` makes the pool passwordless,
 * so there is no password to choose, forget, reset, or leak.
 *
 * UNVERIFIED: whether SignUp accepts an omitted `Password` on a passwordless
 * pool is not stated in any documentation I could reach (see infra/README.md
 * § Could not verify). If the API rejects the call with
 * InvalidParameterException naming Password, the fallback is one line — send a
 * cryptographically random 32-character password and discard it, since nothing
 * will ever authenticate with it:
 *
 *   Password: [...crypto.getRandomValues(new Uint8Array(24))]
 *     .map((b) => b.toString(36)).join('').slice(0, 32) + 'Aa1!'
 *
 * Test this against the real pool before wiring the UI.
 */
export async function signUp(email) {
  const r = await call('SignUp', {
    ClientId: POOL.clientId,
    Username: email,
    UserAttributes: [{ Name: 'email', Value: email }],
  });
  if (!r.ok) return r;
  return { ok: true, state: 'awaiting-code', destination: r.data?.CodeDeliveryDetails?.Destination };
}

/** Confirm a new account with the six-digit code that was emailed. */
export async function confirmSignUp(email, code) {
  const r = await call('ConfirmSignUp', {
    ClientId: POOL.clientId,
    Username: email,
    ConfirmationCode: code,
  });
  return r.ok ? { ok: true, state: 'confirmed' } : r;
}

/** Send the confirmation code again. Rate-limited by Cognito, not by us. */
export async function resendCode(email) {
  const r = await call('ResendConfirmationCode', { ClientId: POOL.clientId, Username: email });
  return r.ok ? { ok: true, state: 'awaiting-code' } : r;
}

/* ------------------------------------------------------------------ sign-in */

/**
 * Begin sign-in. Returns an opaque `session` the caller hands back with the
 * code. The session is short-lived (Cognito expires it in about three minutes)
 * and is not a credential — it authenticates nothing on its own.
 */
export async function beginSignIn(email) {
  const r = await call('InitiateAuth', {
    ClientId: POOL.clientId,
    AuthFlow: 'USER_AUTH',
    AuthParameters: { USERNAME: email, PREFERRED_CHALLENGE: 'EMAIL_OTP' },
  });
  if (!r.ok) return r;
  return {
    ok: true,
    state: 'awaiting-code',
    session: r.data.Session,
    destination: r.data?.ChallengeParameters?.CODE_DELIVERY_DESTINATION,
  };
}

/** Finish sign-in with the emailed code. Returns the token set. */
export async function completeSignIn(email, session, code) {
  const r = await call('RespondToAuthChallenge', {
    ClientId: POOL.clientId,
    ChallengeName: 'EMAIL_OTP',
    Session: session,
    ChallengeResponses: { USERNAME: email, EMAIL_OTP_CODE: code },
  });
  if (!r.ok) return r;
  const t = r.data.AuthenticationResult;
  if (!t) {
    // A challenge we did not ask for and cannot draw. Treat as a dead end
    // rather than half-signing-in.
    return { ok: false, state: 'unknown', code: r.data.ChallengeName };
  }
  return { ok: true, state: 'signed-in', tokens: shape(t) };
}

/** Exchange a refresh token for a new access/id token pair. */
export async function refresh(refreshToken) {
  const r = await call('InitiateAuth', {
    ClientId: POOL.clientId,
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  });
  if (!r.ok) return r;
  const t = r.data.AuthenticationResult;
  if (!t) return { ok: false, state: 'signed-out' };
  // A refresh response carries no new refresh token unless rotation is on,
  // which this pool does not enable — REFRESH_TOKEN_AUTH is unavailable when
  // it is. Keep the one we hold.
  return { ok: true, state: 'signed-in', tokens: { ...shape(t), refreshToken } };
}

function shape(t) {
  return {
    accessToken: t.AccessToken,
    idToken: t.IdToken,
    refreshToken: t.RefreshToken,
    // Seconds, relative. Deliberately not stored as an absolute date — see
    // infra/README.md § 3. The scheduler holds it in memory for this tab only.
    expiresIn: t.ExpiresIn,
  };
}

/* ----------------------------------------------------------------- lifecycle */

/** Invalidate every refresh token this Seeker holds, on every device. */
export async function signOutEverywhere(accessToken) {
  const r = await call('GlobalSignOut', { AccessToken: accessToken });
  return r.ok ? { ok: true, state: 'signed-out' } : r;
}

/**
 * Delete the account itself. Self-service: it needs only the Seeker's own
 * access token, no administrative credential and no support request.
 *
 * ORDER MATTERS. Call deleteProgress() first (infra/reference-client/sync.js).
 * Once the user record is gone the JWT authorizer will still accept the token
 * until it expires, but nothing can re-issue one — and the DynamoDB item is
 * keyed on `sub`, which no longer resolves to anybody. Deleting the account
 * first would leave an unreachable orphan row.
 */
export async function deleteAccount(accessToken) {
  const r = await call('DeleteUser', { AccessToken: accessToken });
  return r.ok ? { ok: true, state: 'deleted' } : r;
}
