/**
 * sync.js — the three calls that move a Seeker's progress across devices.
 *
 * PROPOSAL / REFERENCE IMPLEMENTATION. Nothing imports this yet.
 *
 * The API takes and returns one field: `p`, the 54-character blob from
 * progress-codec.js. It is keyed server-side on the `sub` claim of the id
 * token — an opaque UUID — so the store never learns an email address and the
 * client never gets to say which row it is writing to.
 */

/** Stack output ProgressApiUrl. A public endpoint, not a secret. */
export const API = 'https://REPLACE_ME.execute-api.us-east-1.amazonaws.com';

async function req(method, idToken, body) {
  let res;
  try {
    res = await fetch(`${API}/progress`, {
      method,
      headers: {
        authorization: idToken,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { ok: false, state: 'offline' };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, state: 'session-expired' };
  if (res.status === 429) return { ok: false, state: 'rate-limited' };
  if (!res.ok) return { ok: false, state: res.status >= 500 ? 'service-down' : 'unknown' };
  const text = await res.text();
  return { ok: true, data: text ? JSON.parse(text) : {} };
}

/** Fetch the stored blob. `p` is null for a Seeker who has never synced. */
export async function pullProgress(idToken) {
  const r = await req('GET', idToken);
  return r.ok ? { ok: true, blob: r.data.p ?? null } : r;
}

/** Store the blob. Idempotent; the server keeps no history of prior values. */
export async function pushProgress(idToken, blob) {
  const r = await req('PUT', idToken, { p: blob });
  return r.ok ? { ok: true } : r;
}

/**
 * Erase the stored progress. Called on its own from "Erase synced progress",
 * and called first — always first — by the account-deletion flow, because a
 * deleted Cognito user leaves a `sub` that nothing can ever authenticate as
 * again. See cognito.js § deleteAccount.
 */
export async function deleteProgress(idToken) {
  const r = await req('DELETE', idToken);
  return r.ok ? { ok: true } : r;
}
