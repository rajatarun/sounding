/**
 * session.js — the one-field flow, and what is held between calls.
 *
 * UI-STATES.md's central rule is that the player types an address, presses one
 * control, and lands on a code screen — with no sign-up-versus-sign-in choice
 * anywhere. This is where that is made true: `submitAddress` tries SignUp,
 * quietly falls through to InitiateAuth when the address already exists, and
 * remembers which branch it took so the code goes to the right API.
 *
 * That branch is never returned. A "that address is already registered"
 * message is an oracle — type an address, learn whether that person plays this
 * game — and this game asks people to sit alone in a dark room with
 * headphones. Who does that is not something a sign-in form should confirm to
 * a stranger.
 *
 * Tokens: the refresh token is the only one written to storage, because it is
 * the only one that must outlive a reload. The id and access tokens stay in
 * memory and are gone when the tab closes. There is nothing here worth
 * stealing but a resume point, and this keeps the long-lived credential in one
 * place rather than three.
 */
import {
  signUp, confirmSignUp, resendCode, beginSignIn, completeSignIn,
  refresh, signOutEverywhere, deleteAccount,
} from './cognito.js';
import { accountConfig } from './config.js';

const REFRESH_KEY = 'sounding:refresh:v1';

/** In memory only. Deliberately not persisted — see the note above. */
let tokens = { id: null, access: null };
/** Which branch submitAddress took, so the code goes to the right call. */
let pending = null;

const store = {
  read() { try { return window.localStorage.getItem(REFRESH_KEY); } catch (e) { return null; } },
  write(v) { try { window.localStorage.setItem(REFRESH_KEY, v); } catch (e) { /* private mode */ } },
  clear() { try { window.localStorage.removeItem(REFRESH_KEY); } catch (e) { /* private mode */ } },
};

export function isSignedIn() { return Boolean(tokens.id); }
export function idToken() { return tokens.id; }
export function hasRefreshToken() { return Boolean(store.read()); }

function keep(t) {
  tokens = { id: t.idToken, access: t.accessToken };
  if (t.refreshToken) store.write(t.refreshToken);
}

/** Forget everything on this device. Local game progress is never touched. */
export function forget() {
  tokens = { id: null, access: null };
  pending = null;
  store.clear();
}

/**
 * Step one: an address. Returns `awaiting-code` down either branch.
 *
 * The UserNotConfirmedException path matters more than it looks: a player who
 * asked for a code and closed the tab has an unconfirmed account, and typing
 * the same address must resend the sign-up code rather than dead-end. That is
 * why the code screen has to be reachable from a cold start.
 */
export async function submitAddress(email) {
  if (!(await accountConfig())) return { ok: false, state: 'unknown', code: 'NotConfigured' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, state: 'address-rejected' };

  const created = await signUp(email);
  if (created.ok) {
    pending = { email, mode: 'sign-up' };
    return { ok: true, state: 'awaiting-code', destination: created.destination };
  }

  if (created.state === 'already-registered') {
    const started = await beginSignIn(email);
    if (started.ok) {
      pending = { email, mode: 'sign-in', session: started.session };
      return { ok: true, state: 'awaiting-code', destination: started.destination };
    }
    if (started.state === 'unconfirmed') {
      const again = await resendCode(email);
      if (!again.ok) return again;
      pending = { email, mode: 'sign-up' };
      return { ok: true, state: 'awaiting-code', destination: again.destination };
    }
    return started;
  }

  return created;
}

/** Step two: six digits, routed by the branch step one took. */
export async function submitCode(code) {
  if (!pending) return { ok: false, state: 'code-expired' };

  if (pending.mode === 'sign-up') {
    const confirmed = await confirmSignUp(pending.email, code);
    if (!confirmed.ok) return confirmed;
    // A confirmed sign-up is not yet a session; ask for one, which sends a
    // second code. Cognito has no "confirm and authenticate" in one call.
    const started = await beginSignIn(pending.email);
    if (!started.ok) return started;
    pending = { ...pending, mode: 'sign-in', session: started.session };
    return { ok: true, state: 'awaiting-code', destination: started.destination };
  }

  const done = await completeSignIn(pending.email, pending.session, code);
  if (!done.ok) {
    // A refused challenge burns the session; the next attempt needs a new one.
    if (done.state === 'code-expired') pending = { email: pending.email, mode: 'sign-in' };
    return done;
  }
  keep(done.tokens);
  pending = null;
  return { ok: true, state: 'signed-in' };
}

/** Ask for another code, on whichever branch is in flight. */
export async function requestAnotherCode() {
  if (!pending) return { ok: false, state: 'code-expired' };
  if (pending.mode === 'sign-up') return resendCode(pending.email);
  const started = await beginSignIn(pending.email);
  if (started.ok) pending = { ...pending, session: started.session };
  return started;
}

/**
 * Restore a session from the stored refresh token, if there is one.
 * Quiet by design: a failure here means the player is signed out, which is a
 * resting state and not an error worth a screen.
 */
export async function restore() {
  const token = store.read();
  if (!token) return { ok: false, state: 'signed-out' };
  if (!(await accountConfig())) return { ok: false, state: 'signed-out' };
  const r = await refresh(token);
  if (!r.ok) { store.clear(); return { ok: false, state: 'signed-out' }; }
  keep(r.tokens);
  return { ok: true, state: 'signed-in' };
}

export async function signOutThisDevice() { forget(); return { ok: true, state: 'signed-out' }; }

export async function signOutAllDevices() {
  const r = tokens.access ? await signOutEverywhere(tokens.access) : { ok: true };
  forget();
  return r.ok ? { ok: true, state: 'signed-out' } : r;
}

/** The account, permanently. The caller deletes the row first — see the UI. */
export async function deleteThisAccount() {
  if (!tokens.access) return { ok: false, state: 'session-expired' };
  const r = await deleteAccount(tokens.access);
  if (r.ok) forget();
  return r;
}

/** Test seam: pretend a session exists without going near the network. */
export function __setTokensForTest(t) { tokens = t; }
