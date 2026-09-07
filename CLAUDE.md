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
is true only for the first trial a Seeker ever starts, and level 1 uses it to
seed the draft 28–52° away instead of anywhere in the circle. It changes an
initial condition, never a mechanic — tolerance, hold and decay are identical
— and it never happens again. Same for the `actionLine` above the briefing.
Don't extend either into a general difficulty assist; a hint that returns in
level 12 is a different thing entirely and undercuts the trained-ear premise.

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
src/levels/first-narrowing.js    levels 1–10 (built)
docs/DESIGN.md                   design pillars, the reasoning behind them
docs/ROADMAP.md                  phases, native wrapper path, open questions
docs/LEVELS.md                   the 100-level blueprint
```

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

A Discipline is named only once *every* built level practising it is finished
(`newlyRevealedDiscipline`) — deterministic, never random.

### The five Forces have five different signatures

`constants.js` always promised a perceptual channel per Force; `game.css`'s
`[data-force]` block is where they finally live — a drifting wisp, a flicker,
a swell, device haptics for Mass, echo rings for Void. One rule when editing
them: **never animate `transform` or `opacity` on `.snd-orb`.** Those two
carry the live alignment reading as inline styles, and a CSS animation
outranks an inline declaration — animating them silently overwrites the
feedback the level is built on. Motion goes on the pseudo-elements.

## Adding a level

Levels are plain objects. The interface is documented at the top of
`src/levels/first-narrowing.js`. A level gets `init`, `update`, an optional
`onCommit`/`onBreathe`, `cleanup`, and `completionText`. The runtime passes a
`ctx` with `yaw`, `audio`, `elapsed`, and the UI callbacks
(`setPresence`, `setOrb`, `setWord`, `flash`, `complete`).

Match the era's contract. A First or Second Narrowing level must not be able to
fail. A Third or Fourth Narrowing level may — that's what `fails: true` in
`NARROWINGS` records.

---

## Known limits

**AirPods head tracking is not available to web pages.** Apple exposes
`CMHeadphoneMotionManager` only to native iOS. The current build uses the
*phone's* compass instead, which works but tracks the device, not the head
independently. The upgrade path is a thin native `WKWebView` wrapper that
bridges head-tracking yaw into `Steering.turn()` — the engine already takes
relative deltas, so this needs no gameplay changes. See `docs/ROADMAP.md`.

**Tuning is unvalidated.** The gain curves, hold durations, and trial scaling
are reasoned guesses, not playtested numbers. `TRIAL_AUDIO_SCALE` was raised
from `[1.0, 0.68, 0.42]` to `[1.0, 0.72, 0.50]` on a game-theory review's
concern that 42% clarity, stacked on an already-wide dynamic range, was more
likely to cross from "hard" into "actually inaudible" than to read as
intended; 50% is still meaningfully fainter than Trial 1 without pushing that
far. Treat every constant in `constants.js` as provisional.
