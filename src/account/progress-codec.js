/**
 * progress-codec.js — the whole of a Seeker's progress, as 40 fixed bytes.
 *
 *  * This is the mechanism that answers the hard requirement in
 * .claude/agents/aws-infra.md: the forbidden fields must be *impossible*, not
 * merely absent. A JSON document with a `done` array has room for a
 * `lastPlayedAt` beside it and no reason to refuse one. A fixed-width bitfield
 * does not: every bit is spoken for, the width is asserted on both sides of
 * the wire, and the five spare bits are checked to be zero. There is nowhere
 * for a date to go, and putting one there means changing the width in three
 * files at once — a visible change, not a quiet one.
 *
 *   bits   0..299   done[(level-1) * 3 + (trial-1)], levels 1..100
 *   bits 300..306   next.level, 7 bits, value 1..100
 *   bits 307..308   next.trial - 1, 2 bits, value 0..2
 *   bits 309..313   revealed, one bit per discipline in DISCIPLINE_ORDER
 *   bit       314   everPlayed
 *   bits 315..319   reserved, MUST be zero
 *
 * 320 bits = 40 bytes = 54 base64url characters, always, for every Seeker at
 * every point in the game. The blob a player who has finished nothing sends is
 * the same size as the blob a player who has finished everything sends, which
 * also means the stored object length says nothing about how far anyone got.
 */

const LEVELS = 100;
const TRIALS = 3; // TRIALS_PER_LEVEL in src/engine/constants.js
const BYTES = 40;

/**
 * Frozen order. This is a wire format: appending is safe, reordering silently
 * relabels every existing Seeker's earned Disciplines. Matches the keys of
 * DISCIPLINES in src/engine/constants.js.
 */
const DISCIPLINE_ORDER = ['FILTER', 'TRACE', 'FRAME', 'PLUMB', 'BALANCE'];

const DONE_BITS = LEVELS * TRIALS; // 300
const NEXT_LEVEL_BIT = DONE_BITS; // 300
const NEXT_TRIAL_BIT = 307;
const REVEALED_BIT = 309;
const EVER_PLAYED_BIT = 314;

const getBit = (b, i) => (b[i >> 3] >> (7 - (i & 7))) & 1;
const setBit = (b, i, v) => {
  if (v) b[i >> 3] |= 1 << (7 - (i & 7));
};

function readInt(b, start, width) {
  let n = 0;
  for (let i = 0; i < width; i++) n = (n << 1) | getBit(b, start + i);
  return n;
}

function writeInt(b, start, width, n) {
  for (let i = 0; i < width; i++) setBit(b, start + i, (n >> (width - 1 - i)) & 1);
}

/**
 * A progress object as src/engine/progress.js holds it -> 54 base64url chars.
 *
 * `names` maps a Discipline display name ("The Filter") back to its key, since
 * progress.revealed stores the display names. Pass DISCIPLINES from
 * constants.js and this reads it off that, rather than duplicating the strings.
 */
export function encode(progress, disciplines) {
  const bytes = new Uint8Array(BYTES);

  for (const key of progress.done || []) {
    const [lv, tr] = String(key).split(':').map(Number);
    if (!(lv >= 1 && lv <= LEVELS && tr >= 1 && tr <= TRIALS)) continue;
    setBit(bytes, (lv - 1) * TRIALS + (tr - 1), 1);
  }

  const level = Math.min(Math.max(progress.next?.level ?? 1, 1), LEVELS);
  const trial = Math.min(Math.max(progress.next?.trial ?? 1, 1), TRIALS);
  writeInt(bytes, NEXT_LEVEL_BIT, 7, level);
  writeInt(bytes, NEXT_TRIAL_BIT, 2, trial - 1);

  DISCIPLINE_ORDER.forEach((key, i) => {
    if ((progress.revealed || []).includes(disciplines[key].name)) setBit(bytes, REVEALED_BIT + i, 1);
  });

  setBit(bytes, EVER_PLAYED_BIT, progress.everPlayed ? 1 : 0);
  // bits 315..319 are left zero, and stay that way.

  return toBase64Url(bytes);
}

/** 54 base64url chars -> a progress object, or null if the blob is not one. */
export function decode(blob, disciplines) {
  const bytes = fromBase64Url(blob);
  if (!bytes || bytes.length !== BYTES) return null;
  for (let i = 315; i < 320; i++) if (getBit(bytes, i)) return null; // reserved

  const done = [];
  for (let lv = 1; lv <= LEVELS; lv++) {
    for (let tr = 1; tr <= TRIALS; tr++) {
      if (getBit(bytes, (lv - 1) * TRIALS + (tr - 1))) done.push(`${lv}:${tr}`);
    }
  }

  const level = readInt(bytes, NEXT_LEVEL_BIT, 7);
  if (level < 1 || level > LEVELS) return null;

  const revealed = DISCIPLINE_ORDER.filter((_, i) => getBit(bytes, REVEALED_BIT + i)).map(
    (key) => disciplines[key].name,
  );

  return {
    done,
    next: { level, trial: readInt(bytes, NEXT_TRIAL_BIT, 2) + 1 },
    revealed,
    everPlayed: Boolean(getBit(bytes, EVER_PLAYED_BIT)),
  };
}

/**
 * Reconcile a local progress object with one that came back from the server.
 *
 * The union, always — never a last-write-wins on a clock, because there is no
 * clock. Two devices that each finished different trials both keep them, and
 * the resume point is whichever is further along. This is the merge rule that
 * a store with no timestamps forces, and it is also the merge rule this game
 * would want anyway: nothing a Seeker has actually done can be lost to the
 * order two tabs happened to sync in.
 */
export function merge(a, b) {
  if (!a) return b;
  if (!b) return a;
  const done = [...new Set([...a.done, ...b.done])];
  const ahead = (p) => p.next.level * 10 + p.next.trial;
  return {
    done,
    next: ahead(a) >= ahead(b) ? a.next : b.next,
    revealed: [...new Set([...a.revealed, ...b.revealed])],
    everPlayed: a.everPlayed || b.everPlayed,
  };
}

function toBase64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(blob) {
  if (typeof blob !== 'string' || !/^[A-Za-z0-9_-]{54}$/.test(blob)) return null;
  try {
    const bin = atob(blob.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (e) {
    return null;
  }
}
