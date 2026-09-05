# SOUNDING — Working Notes for Claude Code

An audio-first mobile game. The player perceives unseen physical forces through
3D binaural audio and minimal visuals. 100 levels across four eras.

**Read `docs/DESIGN.md` before changing gameplay.** The design has several
deliberate inversions of normal game-design instinct, and each one has been
broken and re-fixed at least once. They are listed below.

---

## Run it

No build step, no dependencies. ES modules over `file://` are blocked by CORS,
so serve it:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

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

**Levels 1–5 have no fail state, no timer, and no score.** Also intentional.
The First Narrowing is a training era; the player cannot lose. Do not add
health bars, countdowns, or scoring to anything in
`src/levels/first-narrowing.js`. Urgency is introduced deliberately in the
Third Narrowing and the contrast is the whole point.

**Level 2 lets you guess wrong with no penalty.** Yes. Guessing wrong just
means the moment passes and you keep listening.

**Trial 2 and 3 are much harder to hear.** Each level runs three trials at
decreasing audio clarity (`TRIAL_AUDIO_SCALE`). There is no pass threshold —
completing a trial always advances. Fainter is framed as "a deeper kind of
listening," not as a difficulty tier.

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

---

## Layout

```
index.html                      shell, screens, styles
src/engine/audio.js             HRTF spatialization, runtime synthesis
src/engine/input.js             compass/gyro steering, swipe fallback
src/engine/constants.js         tuning values + world vocabulary
src/levels/first-narrowing.js   levels 1–5 (built)
docs/DESIGN.md                  design pillars, the reasoning behind them
docs/ROADMAP.md                 phases, native wrapper path, open questions
docs/LEVELS.md                  the 100-level blueprint
```

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
are reasoned guesses, not playtested numbers. In particular: Trial 3 at 42%
clarity may cross from "hard" into "actually inaudible" on some
headphone/device combinations. Treat every constant in `constants.js` as
provisional.
