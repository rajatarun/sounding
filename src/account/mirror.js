/**
 * mirror.js — keeping an account's copy of progress level with this device's.
 *
 * localStorage stays authoritative. The account is a mirror, never a source of
 * truth, so every function here can fail and the game carries on: a player who
 * is offline, signed out, or whose token expired mid-trial notices nothing.
 *
 * The merge is the union in handoff.js — the same rule the move between origins
 * needed, for the same reason. A store with no clock cannot do last-write-wins,
 * because there is no "last". So every trial either side has finished stays
 * finished and the resume point is whichever is further along, which makes the
 * order two devices happen to sync in irrelevant.
 *
 * Nothing here draws anything. UI-STATES.md § Sync is quiet: progress writes
 * land at trial boundaries, which is exactly where this game is at its most
 * deliberate, and a spinner or a checkmark there is the reward stinger
 * CLAUDE.md refuses by another name.
 */
import { DISCIPLINES } from '../engine/constants.js';
import { loadProgress, saveProgress } from '../engine/progress.js';
import { mergeProgress } from '../engine/handoff.js';
import { encode, decode } from './progress-codec.js';
import { idToken, isSignedIn } from './session.js';
import { pullProgress, pushProgress } from './sync.js';

/**
 * Set when a sync failed, so the account screen can say so as a resting fact.
 *
 * Observable rather than merely readable: a screen that calls the getter during
 * render only learns the answer when it happens to re-render, so a failure that
 * happened while the player was watching stayed invisible until they left and
 * came back. Still nothing during play — see the note at the top of this file.
 */
let unsynced = false;
const watchers = new Set();

export function hasUnsyncedChanges() { return unsynced; }

/** Subscribe to changes. Returns an unsubscribe, for useEffect to call. */
export function onSyncChange(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function setUnsynced(value) {
  if (unsynced === value) return;
  unsynced = value;
  watchers.forEach((fn) => fn(value));
}

/**
 * Fold the account's copy into this device's. Called once, after a sign-in.
 * Returns the merged progress so the caller can re-render from it.
 */
export async function pull() {
  if (!isSignedIn()) return null;
  const r = await pullProgress(idToken());
  if (!r.ok) { setUnsynced(true); return null; }
  const local = loadProgress();
  // `blob`, not `data.p`. This read the raw API envelope through a client that
  // had already unwrapped it, so `r.data` was always undefined, the guard below
  // always returned early, and the merge never ran once — a Seeker signing in
  // on a second device got a fresh game and no error anywhere, which is the
  // worst shape a bug can have in a store whose whole job is not losing a place.
  if (!r.blob) return local;
  // decode() answers null for a blob it cannot read rather than throwing, so a
  // try/catch never sees it and mergeProgress(local, null) is what throws. Test
  // the value, not the control flow.
  const remote = decode(r.blob, DISCIPLINES);
  if (!remote) return local;
  return saveProgress(mergeProgress(local, remote));
}

/**
 * Send this device's progress up. Fire-and-forget by design — the caller does
 * not await it at a trial boundary, and a failure only sets a flag.
 */
export async function push(progress) {
  if (!isSignedIn()) return;
  const r = await pushProgress(idToken(), encode(progress, DISCIPLINES));
  setUnsynced(!r.ok);
}
