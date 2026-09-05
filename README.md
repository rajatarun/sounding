# SOUNDING

*The Unseen Vectors*

An audio-first mobile game about learning to hear. The player sits in a dark
room with headphones and perceives unseen physical forces — moving air, thermal
gradients, fluid pressure, spatial echo — through 3D binaural audio and almost
no visuals.

**Headphones are required. A quiet room is required.** The game is mixed
deliberately faint: cues are near-inaudible when you're facing the wrong way and
clearly present only when you're not. That is the mechanic, not a bug.

---

## Play

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000` on a phone, put on headphones, and start with
**Calibrate Your Ears** before your first level.

No build step and no dependencies — it's ES modules and the Web Audio API.

## Steer

Turn to listen, one of three ways:

- **Phone compass** — hold the device and physically turn your body (best)
- **Swipe** — drag left/right anywhere on screen
- **Arrows** — on-screen buttons

## Structure

100 levels across four eras — **the Narrowings** — each shorter and more urgent
than the last:

| Era | Levels | Character |
|---|---|---|
| The First Narrowing | 1–40 | Stillness. No timers, no fail states. |
| The Second Narrowing | 41–70 | Judgment and balance; soft deadlines appear. |
| The Third Narrowing | 71–90 | Urgency. Real-time pressure, real stakes. |
| The Fourth Narrowing | 91–100 | The extremes of both, back to back. |

Level counts compress 4:3:2:1 while session lengths run inversely — a First
Narrowing level may be a twenty-minute sit; a Fourth Narrowing level, ninety
seconds of precision.

**Levels 1–5 are built.** The rest are specified in `docs/LEVELS.md`.

## Docs

- [`CLAUDE.md`](CLAUDE.md) — orientation, guardrails, and the things that look like bugs but aren't
- [`docs/DESIGN.md`](docs/DESIGN.md) — design pillars and the reasoning behind them
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phases, the native head-tracking path, open questions
- [`docs/LEVELS.md`](docs/LEVELS.md) — the 100-level blueprint

## A note on vocabulary

All in-world terminology in this project is invented. An earlier draft drew on
real classical Indian philosophical vocabulary; it was deliberately removed
rather than risk misrepresenting a living tradition inside a commercial game.
Contributions should keep the invented vocabulary consistent and should not
reintroduce real religious or philosophical terminology.
