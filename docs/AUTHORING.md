# Adding a Level

Ninety of the hundred levels do not exist yet. This is how the tenth becomes
the eleventh without the game getting worse.

Read `docs/DESIGN.md` first if you have not. This document is the mechanics of
authoring; that one is why the mechanics are shaped this way.

---

## The shortest possible version

1. Add the level object to its era module in `src/levels/`.
2. Register the module in `ERAS` in `src/levels/registry.js` (only needed once
   per era, not per level).
3. `npm run check`. Fix every error. Read every warning and decide.
4. `npm test` if you touched the contract itself.
5. Play it on a phone, with headphones, in a quiet room. Nothing else counts.

---

## The level object

```js
{
  id: 11,
  name: 'The Parched River',
  discipline: DISCIPLINES.TRACE,   // always from constants.js
  force: FORCES.FLOW,              // always from constants.js
  control: 'hold',                 // 'hold' | 'commit' | 'breathe'

  tolerance: 14,                   // degrees counted as aligned
  holdSeconds: 24,
  decaySeconds: 16,

  actionLine: '...',               // the plain verb — see below
  briefing: '...',                 // HTML permitted
  revealsDiscipline: true,         // only on the level that closes a Discipline

  init(state, audio) {},
  update(state, dt, elapsed, ctx) {},
  onCommit(state, ctx) {},         // control: 'commit' only
  onBreathe(state, held) {},       // control: 'breathe' only
  cleanup(state) {},               // stop anything init started
  completionText: (state) => ({ text: '...', sub: '...' }),
}
```

`ctx` carries `yaw`, `audio`, `elapsed`, `complete()`, and the UI callbacks
`setPresence`, `setOrb`, `setWord`, `flash`.

---

## Sound: use the seams, not the nodes

Every audio defect this project has had was written the same way — a level
reached past the engine for a raw node and then had to remember something, by
hand, every frame. Three levels forgot the trial scaling. One placed a panner
and never moved it. None of it was visible from the interface, and it took a
four-reviewer audit to find.

**Prefer `audio.source()` and `audio.ambient()`.** They own the things that
were being forgotten:

```js
init(s, audio) {
  s.draft = audio.source(s.angle, { color: 'brown', freq: 420, Q: 0.7 });
  s.room  = audio.ambient({ color: 'brown', filterType: 'lowpass', freq: 400 });
},

update(s, dt, t, ctx) {
  s.angle = (s.angle + s.drift * dt) % 360;
  s.draft.bearing(s.angle);              // the sound moves, not just the maths
  s.draft.level(0.02 + align ** 2.6 * 0.5);  // trial scaling applied for you
  s.draft.timbre({ Q: 0.6 + align * 3.2 });  // level-invariant — prefer this
},

cleanup(s) { s.draft.stop(); s.room.stop(); },
```

Four rules, all of them enforced by `npm run check`:

- **Never connect to `audio.bus`.** Use `audio.ambient()`, or `nonPositioned`
  if you are building the graph by hand. The bus sits above the reference
  plane; connecting there is a silent +15.6 dB.
- **Never move a source with `positionPanner`.** It assigns; `movePanner`
  ramps. Assigning per frame is audible as zipper noise on a quiet source.
- **Never write a gain without `audioScale`.** A voice that skips it is
  identically loud on trial 3 as on trial 1, which is exactly what "a deeper
  kind of listening" promises it is not.
- **Never raise `master.gain` or a per-level constant to fix audibility.** The
  fix is the curve's shape, its domain, or the signal path.

**Prefer level-invariant channels.** Ranked by how well they survive a volume
the player set by hand, once, possibly wrong: timing > timbre > interaural >
level. Level is the least reliable channel in this game and it is already
carrying alignment. A rate, a bandwidth or an echo delay says the same thing
and says it at any volume.

For anything more than this, the `audio-engineer` agent owns the signal path
(`.claude/agents/audio-engineer.md`).

---

## The era contract

`NARROWINGS` in `constants.js` records `fails` per era, and this is now
enforced rather than described. A First or Second Narrowing level that sets
`timeLimit`, `countdown`, `lives`, `score` or `fails` is a check **error**.

That is not pedantry. The First Narrowing is a training era where the player
cannot lose, the Third introduces urgency deliberately, and the contrast is
the entire point. Note that a level can violate the spirit while passing the
letter: level 9 shipped an ember burst on overheating that functioned as a
punishment sting in a no-fail era. The check cannot catch that. You can.

---

## Disciplines and the rare beat

A Discipline is named once, when the level carrying `revealsDiscipline: true`
is finished. The contract enforces:

- **exactly one** closing level per Discipline;
- the closer is the **last** built level practising it — naming a Discipline
  while levels that practise it remain ahead would introduce it rather than
  let it be recognised.

So when you add a level practising an already-closed Discipline, you must move
the flag forward. `npm run check` will tell you if you forget.

---

## Presence marks

`PRESENCE_MARKS` (25/50/75/100) are answered with a dye front and never a
sound. If your level uses `depthAt`, keep its thresholds at least
`MARK_CLEARANCE` points away from every mark **in both directions**. A reveal
landing near a mark is heard as one event with it, which turns a deliberately
silent visual answer into a stinger by coupling rather than intent. Levels 1
and 6 both do this today and both are flagged as warnings.

---

## What the checks will not catch

Write these down honestly rather than assuming the runner has you covered:

- whether the level is **audible** — every constant in `constants.js` is a
  reasoned guess, not a measured one;
- whether the briefing **teaches**, or merely explains;
- whether the Discipline is **practised**, or only named — pillar 1's test is
  whether the player could articulate it afterward without being told;
- whether the level is **worth playing three times**, which is what
  `TRIALS_PER_LEVEL` asks of it.

None of that is testable from here. It needs a phone, headphones, a quiet room
and somebody who has not read the code.
