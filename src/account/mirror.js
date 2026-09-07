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

/** Set when a push failed, so the account screen can say so as a resting fact. */
let unsynced = false;
export function hasUnsyncedChanges() { return unsynced; }

/**
 * Fold the account's copy into this device's. Called once, after a sign-in.
 * Returns the merged progress so the caller can re-render from it.
 */
export async function pull() {
  if (!isSignedIn()) return null;
  const r = await pullProgress(idToken());
  if (!r.ok) { unsynced = true; return null; }
  const local = loadProgress();
  if (!r.data || !r.data.p) return local;
  let remote;
  try {
    remote = decode(r.data.p, DISCIPLINES);
  } catch (e) {
    // A blob this build cannot read is not worth losing the local copy over.
    return local;
  }
  return saveProgress(mergeProgress(local, remote));
}

/**
 * Send this device's progress up. Fire-and-forget by design — the caller does
 * not await it at a trial boundary, and a failure only sets a flag.
 */
export async function push(progress) {
  if (!isSignedIn()) return;
  const r = await pushProgress(idToken(), encode(progress, DISCIPLINES));
  unsynced = !r.ok;
}
