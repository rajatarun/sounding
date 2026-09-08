# SOUNDING — Working Notes for Claude Code

An audio-first mobile game. The player perceives unseen physical forces through
3D binaural audio and minimal visuals. 100 levels across four eras.

**Read `docs/DESIGN.md` before changing gameplay.** The design has several
deliberate inversions of normal game-design instinct, and each one has been
broken and re-fixed at least once. They are listed below.

---

## Run it

React + Vite, on top of `@weaveaijs/tantu` (see below — this used to be a
no-build, no-dependency project; it no longer is, by explicit decision):

```bash
npm install
npm run dev
# then open the printed http://localhost:5173 URL
```

`npm run build` / `npm run preview` for a production build. To reach it from
a phone on the same network, use `npm run dev -- --host`.

Test on a phone with headphones. **Desktop testing is not sufficient** — the
compass steering and the HRTF spatialization are the product, and neither is
properly exercised by a laptop with the built-in speakers.

---

## Things that look like bugs but are not

**The audio is very quiet.** Intentional. See `docs/DESIGN.md` § The Trained
Ear. Cues are mixed so they're near-inaudible when the player is misaligned and
only clearly present at strong alignment. The game asks the player to find a
silent room and raise their device volume. Do not "fix" this by raising
`master.gain` or the per-level gain constants.

One real defect did live next to this rule, and it is fixed: the calibration
reference tone used to connect straight to `destination`, skipping the panner
and master that every game cue passes through. The panner's inverse distance
model at radius 6 is a flat 1/6 (~-15.6 dB) and master is a further 0.5, so the
reference was ~21.6 dB louder than any in-game cue of the same nominal gain —
the Seeker was calibrating against a sound the game never makes. It now runs
through `AudioEngine.calibrationTone`, on the game's own chain. Nothing got
louder; the reference got honest. Keep it that way.

**A gain constant is not a level.** The engine's numbers are nominal; what
reaches the ear is nominal gain *after* the filter shape, and on broadband
noise those differ by a lot. Level 1 is the worked example: aligned it computes
to 20.3 dB above the calibration reference, and it renders at **15.9 dB**,
because alignment also narrows the draft's bandpass from Q 0.6 to Q 3.8 and a
narrowing constant-peak bandpass gives back about 6 dB. So `timbre()` is not
the "level-invariant channel" its docstring claims, and any statement about
this mix has to be rendered and read rather than multiplied out. `npm run
test:audio` does the rendering; it prints the figures rather than asserting
them, because they are provisional like everything else in `constants.js`.

**Every sound sits on one reference plane, and radius 6 defines it.**
`makePanner` uses an inverse distance model with `refDistance: 1`, so a voice
placed at `REFERENCE_RADIUS` (6) is attenuated by a flat 1/6 — about -15.6 dB —
before it reaches the bus. That toll is invisible until something skips it, and
three things did: voices connected straight to `audio.bus`, and bursts passing
`distance: 1`. Each was silently 15.6 dB above everything around it, which is
how the loudest single event in the First Narrowing came to be the ember burst
that fires when the Seeker *errs*.

Two seams keep this honest, and new code should use them rather than reach past
them:

- **`audio.nonPositioned`** — connect here, not to `audio.bus`, for a sound
  that deliberately has no bearing (level 4's breathing cave, level 9's forge).
  It is trimmed to the same plane a positioned voice arrives on, so choosing
  not to place a sound costs no decibels.
- **`referenceTrim(radius)`**, applied inside `burst()` — makes `distance` a
  statement about *where a thing is*, never about how loud it is. Level is a
  designed channel in this game and carries alignment; distance must not
  quietly write to it.

**A moving source must move its panner.** `movePanner` ramps position rather
than assigning it — writing `positionX.value` per frame steps the HRTF
convolution discontinuously, and on a quiet slow source that is audible as
zipper noise. Level 10 integrated its bearing every frame for the life of the
project while its panner stayed where `init()` put it, so the level whose whole
premise is a source that will not hold still had a source that never moved, and
the binaural image contradicted every other channel. If a level's source
bearing changes, `movePanner` is not optional.

**The feedback field is drawn on every level, steering or not.** Presence, the
breath word and the orb live in `.snd-voidfield`, and only the *drag surface*
and its hint are conditional on `control !== 'breathe'`. The whole block used to
be gated together, so levels 4 and 9 called `setPresence`, `setOrb` and
`setWord` every frame into nothing at all. It showed up first as an
accessibility defect: a presence mark's answer is a dye front, `pulse()`
correctly refuses to draw one under reduced motion, and the static
`[data-depth]` ladder that covers for it had no element to sit on — so on a
breathe level a reduced-motion Seeker crossed 25/50/75/100% and nothing changed
anywhere. Don't re-gate the field on the control scheme; gate the steering
affordance, which is the only part that is actually about steering.

The bearing readout, the presence meter and the controls now share one
`.snd-bottom` column rather than each naming its own `bottom` offset. The old
120px/96px/knot-8 arrangement was correct only for the button heights it was
measured against, and it was not: the meter sat *inside* the controls' band,
with 62% of it painted over by the turn buttons and 72% by a breathe level's
single wide one. `data-depth` moved to the screen root for the same reason —
it grades the meter and the word, and those two do not have to live in the
same box to be graded together. A column cannot overlap itself; keep them in
it.

**Levels 1–10 have no fail state, no timer, and no score.** Also intentional.
The First Narrowing is a training era; the player cannot lose. Do not add
health bars, countdowns, or scoring to anything in
`src/levels/first-narrowing.js`. Urgency is introduced deliberately in the
Third Narrowing and the contrast is the whole point.

**Level 2 lets you guess wrong with no penalty.** Yes. Guessing wrong just
means the moment passes and you keep listening.

**Trial 2 and 3 are much harder to hear.** Each level runs three trials at
decreasing audio clarity (`TRIAL_AUDIO_SCALE`). There is no pass threshold —
completing a trial always advances. Fainter is framed as "a deeper kind of
listening," not as a difficulty tier. **Never print the clarity figure.** An
earlier build showed "~72% as clear" on the briefing screen, which is a
difficulty readout and exactly what that framing rule forbids; the language
lives in `BriefingScreen`'s `TRIAL_VOICE` now, and it stays qualitative.

**Presence marks (25/50/75/100%) answer with a dye front, never a chime.**
`GameScreen`'s `MARKS` are fixed and deterministic on purpose. A *predictable*
tick is a progress bar with marks on it; an *unpredictable* one is the reward
schedule pillar 3 refuses. Don't add a stinger, a sound, or randomness to
them, and don't make the reward vary — the point is legibility, not surprise.

**Level 1 is easier the very first time anyone plays it.** `state.onboarding`
is true only for the first trial a Seeker ever *enters*, and level 1 uses it to
seed the draft 28–52° away instead of anywhere in the circle. It changes an
initial condition, never a mechanic — tolerance, hold and decay are identical
— and it never happens again. Don't extend it into a general difficulty assist;
a hint that returns in level 12 is a different thing entirely and undercuts the
trained-ear premise.

"Enters" is load-bearing and used not to be true. `everPlayed` was set only by
`completeTrial`, so the assist retired on first *success* — meaning a Seeker who
never finished a trial kept it indefinitely, which is precisely the population
this rule excludes. `enterTrial` in `progress.js` now marks it on entry, which
is what the flag's own docstring always claimed. The same fix gives the title
screen a Continue button the moment anyone has begun anything.

**The `actionLine` is scoped to control schemes, not to the first trial ever.**
It is shown the first time a Seeker meets each of `hold`, `commit` and
`breathe` — levels 1, 2 and 4 — via `hasPractisedControl`. Tying it to the
first trial ever, as it was, retired the plain verb exactly one level before
the controls first changed: level 2 introduces a commit button and level 4
removes steering altogether, both with no instruction. This is teaching the
verb, not easing the difficulty, and it must stay that way — it names *what
the control does*, never where the source is or how to find it.

**Progress is stored, but almost nothing about it is.** `src/engine/progress.js`
persists which trials are done, where to resume, and which Disciplines have
been revealed. It deliberately stores no times, no scores, and no dates, so
there is nothing for a future feature to build a streak out of — coming back
after a year and coming back after a day read identically.

---

## Vocabulary (clean-room — please keep it consistent)

All in-world terminology is invented. Earlier drafts of this project drew on
real classical Indian philosophical vocabulary; that was deliberately removed
to avoid misrepresenting a living tradition. **Do not reintroduce
Sanskrit or any real religious/philosophical terminology**, in code, comments,
UI copy, or docs — including as "flavor."

The canonical vocabulary lives in `src/engine/constants.js`:

| Concept | Terms |
|---|---|
| Eras | The First through Fourth Narrowing |
| Forces | Drift · Ignition · Flow · Mass · Void |
| Failure modes | The Weight · The Bloom |
| Disciplines (reasoning tools) | The Filter · The Trace · The Frame · The Plumb · The Balance |
| The five depths | Shell · Current · Weather · Lattice · Core |
| Player | The Seeker |

Every discipline name is simultaneously an acoustics term and a cognitive
operation. That is on purpose — the philosophy and the medium share one
vocabulary. New names should follow this rule.

**This vocabulary boundary applies to SOUNDING's own content only** — the
strings in `constants.js`, level briefings, UI copy. It does not extend to
the Tantu design system (see below), which is a separate, external dependency
with its own naming conventions this project does not control.

---

## The UI runs on Tantu — read this before touching chrome

The front end (everything under `src/screens/`, `src/App.jsx`, `index.html`,
the build tooling) was rebuilt on `@weaveaijs/tantu`, the published design
system from the `aiweave` repo. This is a real npm dependency with a real
build step (Vite/React) — a **deliberate, explicit override** of what used to
be this file's own "no build step, no dependencies" rule, made at the
project owner's direction after the tradeoff was laid out plainly. If you're
looking for the vanilla ES-modules build this file used to describe, it's
gone; `git log` has it.

Tantu's own naming is drawn directly from real Indian textile-craft
vocabulary (loom, dye, warp/weft, Kasuti, Jamdani, Patola, Talim) and, in at
least one component, real religious vocabulary (`TantuDarshanLens` — *darshan*
is the term for the reciprocal act of beholding the divine). **That is the
opposite choice from the one this project made about its own content**, and
it was adopted anyway, as-is, rather than forked or renamed — so:

- **Never launder Tantu's vocabulary into SOUNDING's own content.** A
  Discipline, Force, or briefing line should never borrow a Tantu term or pun
  against one (no "Trace the thread," no "Filter the weave"). Keep the two
  vocabularies visibly separate — SOUNDING's own copy in prose, Tantu's own
  metadata (talim codes, etc.) in its own mono/meta type role — rather than
  implying one team authored both.
- **Known naming collision:** Tantu ships `TantuTraceSearch`, unrelated to
  this game's Discipline **The Trace** (`DISCIPLINES.TRACE` in
  `constants.js`). Same word, different meaning — don't reuse
  `TantuTraceSearch` or its copy anywhere near Discipline copy; it will read
  as an intended pun that isn't one.
- **`TantuPanchang`** (a date-grid component named for a real Hindu
  calendar system) should not be reused for anything resembling a "daily
  ritual" framing in SOUNDING — that would put a real liturgical term right
  next to this game's own "Ear Calibration" framing, which is exactly the
  juxtaposition the vocabulary rule above exists to avoid.
- The one framing line on the title screen ("What you see is woven. What
  matters, you'll hear.") is the single, one-time acknowledgment of this
  boundary. Don't build a running theme out of it — repeating or extending it
  is how the two vocabularies end up blending, which is the risk this note
  exists to head off.
- Tantu's own decorative UI sound layer (shuttle clacks, batten strikes —
  `TantuAcousticToggle`/`getLoomAudio`) must stay muted by default
  (`<TantuAcousticToggle defaultMuted />` in `App.jsx`). It's a second,
  unrelated audio system with the opposite design goal of this game's own
  near-inaudible cues; don't flip that default.

---

## Layout

```
index.html                       Vite entry (mounts src/main.jsx)
src/main.jsx                     imports Tantu's styles/fonts, renders <App/>
src/App.jsx                      screen state machine, engine instances
src/screens/*.jsx                title / calibration / briefing / game / end
src/components/LoomSubstrate.jsx the dye canvas + pulse() for the game to use
src/styles/game.css              bespoke chrome, built from Tantu's tokens
src/engine/audio.js              HRTF spatialization, runtime synthesis
src/engine/input.js              compass/gyro steering, swipe fallback
src/engine/progress.js           resume point, trials done, Disciplines named
src/engine/constants.js          tuning values + world vocabulary
src/levels/registry.js           the era modules, assembled — the only importer
src/levels/contract.js           what a level must be, as checks not prose
src/levels/first-narrowing.js    levels 1–10 (built), of the era's 40
scripts/check-levels.mjs         `npm run check` — the contract over the game
scripts/contract.test.mjs        `npm test` — proves the contract catches things
docs/DESIGN.md                   design pillars, the reasoning behind them
docs/AUTHORING.md                how to add a level without making it worse
docs/ROADMAP.md                  phases, native wrapper path, open questions
docs/LEVELS.md                   the 100-level blueprint
```

### Scaling to a hundred

Three commands stand between a new level and the defects the first ten shipped:

```bash
npm run check       # the level contract; errors block, warnings ask
npm test            # proves the contract still catches what it claims to
npm run test:audio  # renders the real graph and measures what comes out
```

The registry is the only thing that imports an era module, so adding a block
of levels is one import and one entry in `ERAS`. The contract enforces what
used to be a comment at the top of a file: level shape, control handlers, the
era's fail contract, one closing level per Discipline and never one that names
it early, vocabulary drawn from `constants.js`, and the audio-routing rules
below. All of it exists because a four-reviewer audit of ten levels found four
defects that had been visible in the source the whole time — that does not
scale by a factor of ten, and a check run does.

### The title screen is one chart, not a list

The hundred levels are drawn by `TantuNaksha` (Tantu 0.3.2+): four bands, one
square per level, ten columns. Every square is the same size, so a band's
area *is* its level count and the 4:3:2:1 compression is drawn rather than
described. It replaced a 100-row table that read as an admin panel.

The component offers three states — `locked` / `active` / `completed` — and
nothing meaning "available but unvisited", deliberately, because a fourth
state is where a progress chart starts smuggling in a score. So built levels
ahead of the Seeker's resume point render locked and are not selectable,
which **is a behaviour change** from the old table: you can no longer open
level 7 without having reached it. That matches how the levels are actually
written — a curriculum where the Disciplines build — but if free jumping is
wanted back, `stateFor` in `TitleScreen.jsx` is the one place to change.

Also note the type roles: `note` on a band takes the game's own pacing word
from `NARROWINGS`, never a term borrowed from the design system.

### Two beats, deliberately different sizes

A trial ending and a Discipline being earned are not the same event, and they
must not look like it — collapse them together and the frequent one gets too
grand for pillar 3's register while the rare one stops registering as rare.

| Beat | When | What |
|---|---|---|
| Completion | every trial | `SikkuKolamLoader` snapping taut, dyed by the level's Force (`GameScreen`) |
| Discipline reveal | 5× in levels 1–10 | `ChambaRumalCard`'s dye-flip, turned over by the player (`EndScreen`) |

A Discipline is named when the level carrying `revealsDiscipline: true` is
finished (`newlyRevealedDiscipline`) — deterministic, never random.

This used to ask whether *every* built level practising a Discipline was
complete, which made the position of the rarest beat a function of the build
backlog: FILTER is {2,3,8} and lands at level 8 today, but shipping more FILTER
levels in the 11–40 block would have moved it later, retroactively, for every
new Seeker. The flags are placed to reproduce the old reveals exactly (levels
6, 7, 8, 9, 10) — this was a correctness fix, not a re-pacing. Whether a reveal
should land earlier is a live design question, and it is now one field per
level rather than an emergent property of set arithmetic.

### The five Forces have five different signatures

`constants.js` always promised a perceptual channel per Force; `game.css`'s
`[data-force]` block is where they finally live — a drifting wisp, a flicker,
a swell, device haptics for Mass, echo rings for Void. One rule when editing
them: **never animate `transform` or `opacity` on `.snd-orb`.** Those two
carry the live alignment reading as inline styles, and a CSS animation
outranks an inline declaration — animating them silently overwrites the
feedback the level is built on. Motion goes on the pseudo-elements.

## Hand UI work to QA

**Every change a player can see or press goes to the `qa-ui` agent** — anything
under `src/screens/`, `src/components/`, `src/App.jsx` or `src/styles/`. Code
it, run your own sanity checks, then hand it over. Your checks are not QA's:
you know what you intended, and the point of the handover is what the code
actually does.

The handover carries what you changed, what you already ran, and what you are
unsure about. QA writes the end-to-end, integration and accessibility tests,
runs them in a real browser at phone width, and reports findings as findings.
Do not summarise a run greener than it was, and do not treat a failing suite as
a formality — the last three defects on this screen were all found after the
author had satisfied himself the work was done:

- a control nobody could find, because its label was a euphemism for the plain
  verb the copy rules required;
- a code field capped at six digits, silently truncating the eight-digit code
  the service actually sends;
- a title screen laid out in a 92px column on desktop, invisible at the width
  it had been tested at.

### How a finding is answered

**Start from the finding being true.** A QA report describes what the code did.
The author describes what they meant. When those disagree the code is what
shipped, so the default is to fix it, not to explain it.

This matters because the opposite posture is self-reinforcing and quietly
expensive. An author who answers findings by looking for reasons they do not
count will find some, QA will start writing defensively to survive that, and
the loop produces argument instead of fixes. So:

- **Do not answer a finding with intent.** "That is not what it is for" and
  "nobody would do that" are not rebuttals; a player did, or QA did, which
  means it is reachable.
- **A finding you think is wrong is still yours to close.** Sometimes the test
  is genuinely at fault — it has happened here twice, both times a stale
  assertion left behind by a change. The answer is to prove it with evidence
  and *fix the test in the same commit*, never to wave the finding away and
  never to loosen or delete the case.
- **Never ask QA to soften one.** Downgrading a finding is a decision about the
  product, and it belongs to the owner, in the open, with the reason written
  down.

QA owes the reciprocal: findings precise enough to act on. What was done, what
happened, at what viewport, with the failing output — not an impression. A
report that overstates costs the same as one that is ignored, because work gets
spent on the wrong thing.

Committed suites live in `scripts/` and run from `npm test` and `npm run check`.
A test written into a scratch directory and run once is not a test — this
project has already reported green from a suite that had gone stale against the
UI it was asserting on.

---

## Adding a level

**Read `docs/AUTHORING.md`.** Short version: add the object to its era module,
register the module in `src/levels/registry.js`, run `npm run check`, fix every
error, read every warning, then play it on a phone with headphones.

Build sound with `audio.source()` and `audio.ambient()` rather than raw
`voice()` nodes. They own the two things levels kept forgetting by hand — the
trial scaling and moving the panner — which is where every audio defect in this
project came from. The contract treats a direct `audio.bus` connection and a
`positionPanner` move as errors.

Match the era's contract. A First or Second Narrowing level must not be able to
fail; `npm run check` now enforces that rather than trusting the comment.
Note it can only catch the letter: level 9 shipped an ember burst on overheat
that read as a punishment sting in a no-fail era, and no checker would have
called that. That one is on the author.

---

## Known limits

**Nothing automated here has ever heard the game.** `npm run test:audio`
renders the engine's real graph through Chromium's Web Audio — HRTF included —
and measures the samples, so it can say a source is 3.5 dB louder in the right
ear, that a burst at radius 1 is not 15.6 dB hot, and that turning right
centres a source on the right. It cannot say whether any of it is *audible*,
whether the spatial image reads as a direction, or whether the quietness lands
as tension rather than as a broken build. Front-to-back separation measures
1.4 dB and a timbre change, which is thin and is the one number most likely to
fail an ear. A green audio run is a floor. `docs/DESIGN.md`'s requirement — a
quiet room, real headphones, a phone — is unchanged and unmet.

**AirPods head tracking is not available to web pages.** Apple exposes
`CMHeadphoneMotionManager` only to native iOS. The current build uses the
*phone's* compass instead, which works but tracks the device, not the head
independently. The upgrade path is a thin native `WKWebView` wrapper that
bridges head-tracking yaw into `Steering.turn()` — the engine already takes
relative deltas, so this needs no gameplay changes. See `docs/ROADMAP.md`.

**The account step-one branch is a request-count oracle.** A new address costs
one Cognito call, a registered one costs two. The screen hides which branch you
are on; the network does not. It cannot be closed from the client — the browser
talks to Cognito directly, so anyone counting our requests can also read
`UsernameExistsException` in the reply, and padding the count would buy a round
trip and nothing else. The fix is an endpoint of our own that makes both
branches one opaque call, which is provisioning, not a refactor: see
`infra/README.md` § the address step, and the note above `submitAddress` in
`src/account/session.js`.

**Tuning is unvalidated.** The gain curves, hold durations, and trial scaling
are reasoned guesses, not playtested numbers. `TRIAL_AUDIO_SCALE` was raised
from `[1.0, 0.68, 0.42]` to `[1.0, 0.72, 0.50]` on a game-theory review's
concern that 42% clarity, stacked on an already-wide dynamic range, was more
likely to cross from "hard" into "actually inaudible" than to read as
intended; 50% is still meaningfully fainter than Trial 1 without pushing that
far. Treat every constant in `constants.js` as provisional.
