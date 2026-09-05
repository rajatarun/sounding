# Roadmap

## Where this is

**Phase 0 — done.** Levels 1–5 playable. The HRTF engine, compass steering,
trial scaling, and ear calibration all work. Five genuinely distinct mechanics
(sustained hold, signal discrimination, three-way triangulation, breath
matching, sustained ignition) share one engine, which is the thing that needed
proving before committing to 95 more levels.

**What Phase 0 has not done: validated any of the tuning.** Every constant is a
reasoned guess. See "Open questions" below.

---

## Phases

| Phase | Scope | Notes |
|---|---|---|
| 1 | First Narrowing, levels 6–40 | Built on the existing engine. Introduces Ignition, Flow, Mass, Void as playable forces. Haptics pass. |
| 2 | Polish + closed playtest | Full audio pass, mobile performance, external testers in real rooms. |
| 3 | Soft launch | Instrument session *length* and return rate — not completion speed. See metrics note below. |
| 4 | Second Narrowing, 41–70 | Judgment/balance systems; soft deadlines. New tooling for resource-equilibrium levels. |
| 5 | Third Narrowing, 71–90 | **The urgency engine.** Real timers, fail states, retry flow. This is new architecture, not a reskin. |
| 6 | Fourth Narrowing, 91–100 | The extremes of both. Full release. |

Phase durations are deliberately unestimated until Phase 1 gives real data on
how long a contemplative level takes to tune. A meditative game has no
leaderboard shortcut for judging pacing — you have to sit with each level, which
makes per-level iteration slower than a scored game.

---

## The native wrapper

**AirPods head tracking is not reachable from web.** Apple exposes
`CMHeadphoneMotionManager` only to native iOS, so no browser or PWA can read it.
The current build uses the phone's own compass, which works but tracks the
device rather than the head independently.

The path, when it's worth doing:

1. Thin Swift app, `WKWebView` loading this build unchanged
2. Native layer reads `CMHeadphoneMotionManager` yaw
3. Bridge into the page via `evaluateJavaScript` or a `WKScriptMessageHandler`,
   calling `Steering.turn(delta)`

`Steering` already consumes **relative** deltas rather than absolute headings
specifically so this swap needs no gameplay changes. Requires H1/H2 chip
hardware (AirPods Pro, Max, 3, 4) and a physical device — the simulator won't
exercise it.

---

## Open questions

**Is Trial 3 audible?** 42% clarity stacked on an already-wide dynamic range may
cross from "hard" to "actually inaudible" on some headphone/device combinations.
Needs testing across cheap earbuds, good over-ears, and AirPods before the
scaling is trusted.

**Are the hold durations right?** 22–26 seconds of sustained alignment was
chosen to feel meditative rather than reflexive. It may be too long before the
player understands the mechanic, and too short once they do. Consider whether
Trial 1 should hold shorter than Trial 3.

**Does Level 2 fit the era?** It's the only First Narrowing level built on
*reacting* to events rather than sustaining attention. The framing was softened
("there is no danger in this practice") but the underlying loop is still more
alert than its neighbours. If it reads as tonally off in testing, the fix is a
"notice and let pass" structure rather than "detect and respond."

**What are the right metrics?** Standard engagement instrumentation will
mismeasure this game — fast completion is not success here, and a player who
sits in a level for twenty minutes is engaged, not stuck. Session *length* and
return rate matter; completion *speed* is close to meaningless.

**Does the Second Narrowing's content survive reproportioning?** The 100-level
blueprint in `LEVELS.md` was originally written against an even 25/25/25/25
split. Moving to 40/30/20/10 means the later eras shed levels and the first
absorbs more. Some economic and civic-systems levels need to migrate earlier,
and the final era needs merging down to its strongest ten concepts.
