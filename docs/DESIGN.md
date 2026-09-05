# Design

Five pillars. Each one is a deliberate inversion of a normal design instinct,
and each is load-bearing — changing one quietly breaks the others.

---

## 1. Mechanic-embodied reasoning

The closest tonal comparison to this game, *The Talos Principle*, is most often
criticized for the same thing: its puzzles and its philosophy don't organically
connect. The ideas live in text terminals *next to* the puzzle rather than
inside it.

SOUNDING avoids this by construction. **The Filter** is not a quote screen — it
is the act of muting a false audio layer to isolate a true one. **The Trace** is
not narrated — it is inferring an unseen draft from pitch and clarity. The
reasoning tool and the input mechanic are the same object.

When adding a level, the test is: *could the player articulate the discipline
after playing, without ever being told its name?* If the discipline only exists
in the briefing text, the level isn't done.

---

## 2. The Trained Ear

Before ambient technology — engines, HVAC, notification chimes — hearing was
tuned by necessity against genuine silence. A snapped twig mattered enough to
register at the edge of perception.

The game recreates that condition rather than simulating it:

- Cues carry real dynamic range: near-silent when misaligned, clearly audible
  only at strong alignment
- Master gain sits low, so the player raises their **device** volume rather than
  the game shouting over a noisy room
- An **Ear Calibration** step plays a faint reference tone and asks the player to
  raise volume until it's *just* audible — that becomes their level for the session

This makes silence the difficulty curve rather than a workaround for it. It also
means the game genuinely does not work in a loud room, and that's an accepted
constraint, not a defect to engineer around.

---

## 3. Presence over performance

Most puzzle and survival games run a dopamine loop: depleting resource, ticking
clock, fail state, quick retry. The First and Second Narrowings remove all of
it.

There is no way to lose. Levels complete when the player holds genuine alignment
for an unhurried stretch of real time — twenty-plus seconds, not three — and
drifting attention decays progress gently instead of ending the session.

An earlier build of this project had a depleting "Warmth" meter, a rising
heartbeat, and a 60% score gate. It was rebuilt without them because the result
felt like a performance test, which is the wrong genre for what this is.

**This pillar is scoped to the first two eras.** See below.

---

## 4. The Narrowings — stillness into urgency

Not every level is meditative, and that's the design.

The First Narrowing trains the ear and the patience under zero pressure. As the
eras advance and the stakes rise from personal survival to the survival of
civilizations, the pacing shifts to match. The Third Narrowing introduces real
timers, real fail states, precision-under-clock.

The contrast is the point: **a player who has genuinely learned to listen in
silence experiences real tension when that attentiveness is suddenly tested
against a clock.** Urgency lands harder for having been withheld for forty
levels.

The four eras compress 4:3:2:1 (40/30/20/10 levels). This is a production
decision as much as a thematic one — the cheapest content to build
(contemplative, single-mechanic, reusing the First Narrowing engine) is where
there are the most levels; the most expensive (real-time systems, fail states,
simulation) is where there are the fewest. Session lengths run inversely, so
total playtime across eras stays roughly balanced.

---

## 5. Progression as curriculum

The 100-level arc introduces the five disciplines in sequence, each drilled
mechanically and repeatedly before the game ever names it. A player who finishes
the First Narrowing hasn't just solved forty puzzles — they've been trained in a
specific reasoning tool.

The curriculum is the difficulty curve, not a layer on top of it.

---

## Trials

Every level runs three trials at decreasing audio clarity (100% → 68% → 42%).
There is no pass threshold; completing a trial always advances. Fainter is
framed to the player as *a deeper kind of listening*, never as a difficulty
tier — the language matters, because the moment it reads as "hard mode" it
becomes a performance test and pillar 3 collapses.

---

## Vocabulary

All in-world terminology is invented, and deliberately so. An earlier draft used
real classical Indian philosophical vocabulary; it was removed rather than risk
misrepresenting a living tradition inside a commercial product. The trade is
real — that framing was distinctive — but the invented vocabulary carries no
cultural-accuracy exposure and needs no external review.

The disciplines are all simultaneously acoustics terms and cognitive operations
(*filter, trace, frame, plumb, balance*), so the philosophy and the medium share
one language. Keep new terms inside that convention.
