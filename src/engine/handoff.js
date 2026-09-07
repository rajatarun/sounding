/**
 * handoff.js — receiving a resume point from the old origin.
 *
 * SOUNDING used to be served from https://aiweave.org/sounding/ and is now
 * served from https://sounding.aiweave.org/. Browser storage is scoped to the
 * origin, not the path, so that move orphans the saved place of every Seeker
 * who played before it — their progress is still on the old origin, and the
 * only code that can read it is a page served from there.
 *
 * `legacy-origin/index.html`, which now occupies the old path, is that page.
 * It encodes the stored document into the URL fragment and sends the player
 * here. This file is the other half.
 *
 * Three properties are load-bearing:
 *
 * 1. **The fragment, not a query string.** A fragment is never sent to the
 *    server, so a Seeker's progress never lands in a CDN or bucket access log.
 * 2. **Merge, never overwrite.** A player who opened the new address first and
 *    played, then followed an old bookmark, must not be rolled back. The rule
 *    is a union — every trial either side has finished stays finished, and the
 *    resume point is whichever is further along. Nothing anyone actually did
 *    is lost to the order two pages happened to load in, and repeating the
 *    handoff is therefore harmless.
 * 3. **No new fields.** The merge reads and writes exactly the four keys
 *    progress.js defines. There is no `migratedAt`, no `importedFrom`, and
 *    nowhere to put one — the same rule the store itself keeps.
 *
 * This file has nothing to do with player accounts. It is needed because the
 * hostname changed, and it would be needed if accounts are never built. The
 * union rule below is also the rule an account sync would need, and the
 * encoding below is most of a device-to-device transfer code, so neither of
 * those would repeat this work.
 */
import { loadProgress, saveProgress, normalizeProgress } from './progress.js';

const MARK = 'sounding-handoff-v1=';

/** Is `a`'s resume point at or past `b`'s? Level first, then trial. */
function atLeastAsFar(a, b) {
  if (a.level !== b.level) return a.level > b.level;
  return a.trial >= b.trial;
}

/** "12:3" -> sorts after "2:1". Level first, then trial, both numeric. */
function byTrial(x, y) {
  const [lx, tx] = x.split(':').map(Number);
  const [ly, ty] = y.split(':').map(Number);
  return lx - ly || tx - ty;
}

/**
 * Union two progress documents. Order-independent, which is what makes it safe
 * to run on every load and safe to run twice.
 *
 * The sorts are the reason that claim is true rather than nearly true. A Set
 * preserves insertion order, so unioning the same two documents in the
 * opposite order produces the same *members* in a different sequence — equal
 * state serialising to different bytes. Nothing today compares the stored
 * string, but a sync that asks "has this changed since I last wrote it" is
 * exactly what an account would add, and it would answer yes forever. Sorting
 * makes the stored document canonical: one state, one serialisation.
 */
export function mergeProgress(a, b) {
  return {
    done: [...new Set([...a.done, ...b.done])].sort(byTrial),
    revealed: [...new Set([...a.revealed, ...b.revealed])].sort(),
    everPlayed: Boolean(a.everPlayed || b.everPlayed),
    next: atLeastAsFar(a.next, b.next) ? { ...a.next } : { ...b.next },
  };
}

function decode(value) {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const bin = window.atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * If this load carries a handoff, merge it in and clean the address bar.
 *
 * Must run before anything reads progress — see main.jsx. Returns true only if
 * a handoff was actually applied.
 *
 * On failure the fragment is left in place on purpose: it is the player's own
 * progress and not a credential, and leaving it means a reload can retry
 * rather than the state being quietly dropped. Their copy on the old origin is
 * never deleted either, so the old bookmark keeps working as a second attempt.
 */
export function consumeHandoff() {
  try {
    const hash = window.location.hash || '';
    if (!hash.startsWith(`#${MARK}`)) return false;

    const incoming = normalizeProgress(decode(hash.slice(MARK.length + 1)));
    saveProgress(mergeProgress(loadProgress(), incoming));

    // Drop the fragment so the blob is not bookmarked, shared or shoulder-read.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return true;
  } catch (e) {
    return false;
  }
}
