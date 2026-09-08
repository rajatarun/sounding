/**
 * audio.e2e.mjs — the signal path, measured.
 *
 *   npm run test:audio
 *
 * WHAT THIS IS. Every sound in SOUNDING is synthesized at runtime, which means
 * the mix is not a set of files someone listened to once — it is the output of
 * `src/engine/audio.js`, computed fresh on every device, and until now nothing
 * has ever read it back. This suite renders the engine's real graph through
 * Chromium's real Web Audio implementation — HRTF convolution included — into
 * an `OfflineAudioContext`, and measures the samples that come out.
 *
 * WHY IT IS WORTH HAVING. Every audio defect this project has shipped was a
 * routing mistake that was invisible in the source and inaudible without a
 * comparison: a calibration tone that skipped the panner and was therefore
 * ~21.6 dB above the cues it was calibrating; voices wired past the distance
 * toll; bursts at `distance: 1` collecting a free 15.6 dB, which is how the
 * loudest event in the First Narrowing came to be the one that fires when the
 * Seeker errs; a level that integrated a bearing every frame while its panner
 * never moved. Every one of those is a number, and a number can be read.
 *
 * WHAT IT IS NOT. There is no room, no headphones and no ear here. This suite
 * says what the engine produces; it cannot say whether a cue is audible to a
 * person, whether the spatial image reads as a direction, or whether the
 * quietness lands as tension rather than as a broken build. `docs/DESIGN.md`
 * asks for a quiet room and real headphones and that requirement is unchanged.
 * A green run is a floor, not a verdict.
 *
 * DETERMINISM. `makeNoise` draws from `Math.random`, so the page seeds a small
 * LCG before the engine is constructed. Two runs of the same case therefore
 * render the same samples, and a tolerance in here is measuring the thing under
 * test rather than the noise.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const PLAYWRIGHT = process.env.SOUNDING_PLAYWRIGHT || '/home/user/aiweave/node_modules/playwright';
const CHROME = process.env.SOUNDING_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = Number(process.env.SOUNDING_AUDIO_PORT || 4177);
const ORIGIN = `http://127.0.0.1:${PORT}`;
/* A blank page on the dev server's own origin. The app is not booted — this
   suite tests the engine, and a React tree in the way is only a source of
   noise. The origin is what matters: it makes `/src/engine/*.js` importable. */
const HARNESS = `${ORIGIN}/__audio-harness`;

/* ------------------------------------------------------------ tiny runner */

let pass = 0;
const failures = [];
const only = process.env.SOUNDING_AUDIO_ONLY;

async function t(name, fn) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n          ${e.message.split('\n').join('\n          ')}`);
    failures.push(name);
  }
}
const group = (title) => console.log(`\n${title}\n${'─'.repeat(Math.max(title.length, 52))}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

/* --------------------------------------------------------------- decibels */

/** Ratio to dB. The unit every claim in the audio docstrings is written in. */
const dB = (ratio) => 20 * Math.log10(Math.max(ratio, 1e-12));
const dBBetween = (a, b) => dB(a) - dB(b);
const near = (actual, expected, tol, what) => assert(
  Math.abs(actual - expected) <= tol,
  `${what}: expected ${expected} ± ${tol}, measured ${actual.toFixed(3)}`,
);

/* -------------------------------------------------------------- the server */

function serve() {
  /* The dev server, not `vite preview`: this suite imports engine modules by
     source path, which only the dev server serves. */
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, stdio: 'ignore', detached: true,
  });
  return {
    async ready() {
      for (let i = 0; i < 80; i++) {
        try {
          const res = await fetch(`${ORIGIN}/src/engine/audio.js`);
          if (res.ok) return;
        } catch (e) { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error(`vite dev never served the engine on ${ORIGIN}`);
    },
    stop() { try { process.kill(-child.pid); } catch (e) { /* already gone */ } },
  };
}

/* ------------------------------------------------------------ the renderer */

/**
 * Installs the render harness on a blank page of the dev server's origin.
 *
 * Two substitutions happen here and nowhere else, both before the engine is
 * constructed so it never sees anything but its normal world:
 *
 *  - `window.AudioContext` is made to hand back the `OfflineAudioContext` for
 *    this render. `AudioEngine.init()` does `new (window.AudioContext)()`, so
 *    this is the whole of what it takes to render the engine's real graph
 *    offline. Nothing in `audio.js` is aware of, or altered for, this suite.
 *  - `Math.random` is seeded. `makeNoise` draws from it, and unseeded noise
 *    would put a few tenths of a dB of run-to-run jitter under every
 *    measurement — small, but exactly the size of the effects being measured.
 */
async function harness(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.route(HARNESS, (r) => r.fulfill({
    status: 200, contentType: 'text/html',
    body: '<!doctype html><meta charset="utf-8"><title>audio harness</title>',
  }));
  await page.goto(HARNESS);

  await page.evaluate(() => {
    window.__render = async ({ seconds, sampleRate, seed, windows, windowMs, buildSrc }) => {
      const mod = await import('/src/engine/audio.js');

      const realRandom = Math.random;
      let s = (seed >>> 0) || 1;
      Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };

      const oc = new OfflineAudioContext(2, Math.round(sampleRate * seconds), sampleRate);
      const realAC = window.AudioContext;
      window.AudioContext = function () { return oc; };

      let buf;
      try {
        const audio = new mod.AudioEngine();
        audio.init();
        // eslint-disable-next-line no-eval
        const build = eval(`(${buildSrc})`);
        /* Mutate the graph mid-render at a real transport time. The engine
           reads `ctx.currentTime` when it ramps, so a change scheduled this
           way is scheduled exactly as it would be from a game frame. */
        const at = (time, fn) => { oc.suspend(time).then(async () => { await fn(); oc.resume(); }); };
        await build({ audio, ctx: oc, mod, at });
        buf = await oc.startRendering();
      } finally {
        window.AudioContext = realAC;
        Math.random = realRandom;
      }

      const L = buf.getChannelData(0);
      const R = buf.getChannelData(1);
      const rms = (a, from = 0, to = a.length) => {
        let sum = 0;
        for (let i = from; i < to; i++) sum += a[i] * a[i];
        return Math.sqrt(sum / Math.max(1, to - from));
      };
      const peak = (a) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); return m; };

      /* The loudest short window in the render.
         Masking is a question about a moment, not about an average: a 130 ms
         drip and a 24-second draft have wildly different full-render RMS and
         that difference says nothing about whether one covers the other. The
         window is ~50 ms because that is roughly the ear's integration time,
         so it is the window in which a transient can mask a steady sound.
         Hopped at half a window so an event cannot fall across a boundary and
         measure quiet. */
      const wLen = Math.max(1, Math.round(sampleRate * (windowMs || 50) / 1000));
      let maxWin = 0;
      for (let from = 0; from + wLen <= L.length; from += Math.floor(wLen / 2)) {
        const v = Math.sqrt((rms(L, from, from + wLen) ** 2 + rms(R, from, from + wLen) ** 2) / 2);
        if (v > maxWin) maxWin = v;
      }

      const n = windows || 24;
      const step = Math.floor(L.length / n);
      const win = [];
      for (let w = 0; w < n; w++) {
        const from = w * step;
        const to = w === n - 1 ? L.length : from + step;
        win.push({ t: from / sampleRate, rmsL: rms(L, from, to), rmsR: rms(R, from, to) });
      }

      return {
        rmsL: rms(L), rmsR: rms(R), peakL: peak(L), peakR: peak(R),
        rms: Math.sqrt((rms(L) ** 2 + rms(R) ** 2) / 2),
        maxWin,
        windows: win,
        frames: L.length,
      };
    };
  });

  return {
    /**
     * Render one graph and measure it.
     *
     * `build` runs in the page and receives `{ audio, ctx, mod, at }`. It is
     * stringified to get there, so it must not close over anything in this
     * file — everything it needs comes through `args`, which arrives as a
     * global `A` inside the build.
     */
    async render(build, { seconds = 1, sampleRate = 48000, seed = 20260908, windows = 24, windowMs = 50, args = {} } = {}) {
      const out = await page.evaluate(
        ([opts, a]) => {
          window.A = a;
          return window.__render(opts);
        },
        [{ seconds, sampleRate, seed, windows, windowMs, buildSrc: build.toString() }, args],
      );
      if (errors.length) throw new Error(`page error during render: ${errors.join('; ')}`);
      return out;
    },
    /** The game's own tuning values, read from source rather than retyped.
        A test that hardcodes a constant stops testing it the moment it moves. */
    async constants() {
      return page.evaluate(() => import('/src/engine/constants.js').then((m) => ({ ...m })));
    },
    /**
     * What the levels themselves build, read out of the level module.
     *
     * The room specs are module-local to `first-narrowing.js` and they should
     * stay that way, so this spies on `audio.room` and runs each level's real
     * `init`. What comes back is what the game ships, not a copy of it kept in
     * a test — the difference is the whole reason the trial-scaling cases read
     * TRIAL_AUDIO_SCALE from source. The engine here is built on a throwaway
     * OfflineAudioContext that is never rendered; only the specs are wanted.
     */
    async levelData() {
      const out = await page.evaluate(async () => {
        const [engineMod, levelMod] = await Promise.all([
          import('/src/engine/audio.js'),
          import('/src/levels/first-narrowing.js'),
        ]);
        const oc = new OfflineAudioContext(2, 4800, 48000);
        const realAC = window.AudioContext;
        window.AudioContext = function () { return oc; };
        /* Seeded for the same reason the renders are: a level's init draws its
           room bearings from Math.random, and an HRTF level varies a couple of
           decibels with bearing. Unseeded, the figures this suite prints would
           wobble by about the size of the things it is measuring. */
        const realRandom = Math.random;
        let seedState = 20260908;
        Math.random = () => {
          seedState = (Math.imul(seedState, 1664525) + 1013904223) >>> 0;
          return seedState / 4294967296;
        };
        try {
          return levelMod.FIRST_NARROWING.map((lv) => {
            const audio = new engineMod.AudioEngine();
            audio.init();
            const specs = [];
            const realRoom = audio.room.bind(audio);
            audio.room = (spec) => { specs.push(spec); return realRoom(spec); };
            const state = { onboarding: false };
            try { lv.init(state, audio); } catch (e) { /* a level the harness cannot drive */ }
            return {
              id: lv.id,
              name: lv.name,
              beds: specs.flatMap((sp) => sp.beds || []),
              events: specs.flatMap((sp) => sp.events || []),
              depthTrim: lv.depthTrim || null,
            };
          });
        } finally { window.AudioContext = realAC; Math.random = realRandom; }
      });
      if (errors.length) throw new Error(`page error: ${errors.join('; ')}`);
      return out;
    },
    /**
     * Ask the engine a question that is not about samples.
     *
     * Some things worth pinning are shape rather than signal — what an
     * interface will and will not accept. Built on a throwaway
     * OfflineAudioContext that is never rendered.
     */
    async engine(fn, args = {}) {
      const out = await page.evaluate(
        async ([src, a]) => {
          const mod = await import('/src/engine/audio.js');
          const oc = new OfflineAudioContext(2, 4800, 48000);
          const realAC = window.AudioContext;
          window.AudioContext = function () { return oc; };
          try {
            const audio = new mod.AudioEngine();
            audio.init();
            // eslint-disable-next-line no-eval
            return eval(`(${src})`)({ audio, mod, args: a });
          } finally { window.AudioContext = realAC; }
        },
        [fn.toString(), args],
      );
      if (errors.length) throw new Error(`page error: ${errors.join('; ')}`);
      return out;
    },
    /** Run something in the page against the steering module, not the audio one. */
    async steering(fn, args = {}) {
      const out = await page.evaluate(
        async ([src, a]) => {
          const mod = await import('/src/engine/input.js');
          // eslint-disable-next-line no-eval
          return eval(`(${src})`)({ mod, args: a });
        },
        [fn.toString(), args],
      );
      if (errors.length) throw new Error(`page error: ${errors.join('; ')}`);
      return out;
    },
    close: () => ctx.close(),
  };
}

/* ============================================================== the tests */

const server = serve();
let h = null;
let browser = null;
let exitCode = 0;

try {
  await server.ready();
  const { chromium } = await import(path.join(PLAYWRIGHT, 'index.mjs'));
  browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  h = await harness(browser);

  /* ------------------------------------------------------------------ */
  group('Steering: the compass, and which way it turns you');

  await t('a compass turn to the right turns the Seeker to the right', async () => {
    /* The one that would be a shipped catastrophe and has never been checked.
       An inverted compass is not subtle to a player and is nearly invisible in
       review: every other channel still works, the source is simply always on
       the wrong side, and the game becomes unplayable while looking correct. */
    const yaw = await h.steering(({ mod }) => {
      const s = new mod.Steering();
      s.enableGyro();
      const fire = (heading) => window.dispatchEvent(
        Object.assign(new Event('deviceorientation'), { webkitCompassHeading: heading, alpha: 360 - heading }),
      );
      fire(0);    // first event only seeds the reference
      fire(30);   // turned 30 degrees clockwise — to the player's right
      return s.yaw;
    });
    near(yaw, 30, 0.01, 'turning 30 degrees clockwise should give yaw +30');
  });

  await t('the first orientation event is a reference, not a turn', async () => {
    /* Whatever way the player happens to be facing when a trial starts is
       "forward". If the first event turned them, every trial would begin with
       the world rotated by the Seeker's arbitrary compass heading. */
    const yaw = await h.steering(({ mod }) => {
      const s = new mod.Steering();
      s.enableGyro();
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), { webkitCompassHeading: 217 }));
      return s.yaw;
    });
    near(yaw, 0, 1e-9, 'the first event must not move the listener');
  });

  await t('turning across north is a small turn, not a 358-degree one', async () => {
    const yaw = await h.steering(({ mod }) => {
      const s = new mod.Steering();
      s.enableGyro();
      const fire = (heading) => window.dispatchEvent(
        Object.assign(new Event('deviceorientation'), { webkitCompassHeading: heading }),
      );
      fire(359); fire(1); fire(3);
      return s.yaw;
    });
    near(yaw, 4, 0.01, 'crossing 360->0 should accumulate +4, not -356');
  });

  await t('sensor jitter below the deadzone does not move the listener', async () => {
    const out = await h.steering(({ mod }) => {
      const s = new mod.Steering();
      s.enableGyro();
      const fire = (heading) => window.dispatchEvent(
        Object.assign(new Event('deviceorientation'), { webkitCompassHeading: heading }),
      );
      fire(10);
      for (let i = 0; i < 200; i++) fire(10 + (i % 2 ? 0.03 : -0.03));
      return s.yaw;
    });
    near(out, 0, 1e-9, '200 sub-deadzone jitters should sum to no rotation');
  });

  await t('alignment is dead across the whole half-circle behind 90 degrees', async () => {
    /* Pinned deliberately, and it is not an endorsement. `max(0, cos(diff))`
       means every bearing more than 90 degrees off-target produces byte-
       identical feedback in gain, orb and word — half the circle carries no
       gradient at all, so a Seeker facing 100 degrees away and one facing 180
       degrees away are told exactly the same thing. Whether that is right is a
       live design question. This case exists so that changing it is a decision
       someone makes on purpose rather than a number that drifts. */
    const out = await h.steering(({ mod }) => {
      const at = (d) => mod.alignment(d, 0);
      return { d80: at(80), d90: at(90), d100: at(100), d140: at(140), d180: at(180) };
    });
    assert(out.d80 > 0.15, `80 degrees off should still carry signal, got ${out.d80}`);
    near(out.d90, 0, 1e-9, 'alignment at exactly 90 degrees');
    for (const [k, v] of Object.entries(out)) {
      if (k === 'd80') continue;
      near(v, k === 'd90' ? 0 : 0, 1e-9, `alignment at ${k.slice(1)} degrees is flat zero`);
    }
  });

  await t('a slow turn is not lost to the deadzone', async () => {
    /* The defect this suite found. `_lastHeading` used to advance before the
       deadzone check, so a sub-threshold delta was discarded AND became the
       new reference — making 0.08 degrees per event a RATE gate of about
       4.8 deg/s at a 60 Hz sensor. Every rotation slower than that produced
       exactly zero yaw, forever, in a game whose entire instruction is "turn
       slowly" and whose tolerances are 13 to 20 degrees. */
    const yaw = await h.steering(({ mod }) => {
      const s = new mod.Steering();
      s.enableGyro();
      const fire = (heading) => window.dispatchEvent(
        Object.assign(new Event('deviceorientation'), { webkitCompassHeading: heading }),
      );
      fire(0);
      // 30 degrees delivered in 600 events: 0.05 each, about 3 deg/s at 60 Hz.
      for (let i = 1; i <= 600; i++) fire(i * 0.05);
      return s.yaw;
    });
    near(yaw, 30, 1, 'a 30-degree turn taken slowly should still be a 30-degree turn');
  });

  await t('the two compass sources agree on which way is right', async () => {
    /* iOS hands over `webkitCompassHeading`; everything else is reconstructed
       from Euler angles. If those two disagree in sign, the game is mirrored
       on one platform and nowhere else — the kind of defect that survives
       every review because each half is self-consistent. Tilt only adds a
       constant offset, which relative deltas absorb, so the assertion is on
       direction across the tilts a phone is actually held at. */
    const out = await h.steering(({ mod }) => {
      const run = (make) => {
        const s = new mod.Steering();
        s.enableGyro();
        for (let i = 0; i <= 10; i++) window.dispatchEvent(Object.assign(new Event('deviceorientation'), make(i)));
        s.disableGyro();
        return s.relativeYaw;
      };
      const results = { ios: run((i) => ({ webkitCompassHeading: i * 2 })) };
      for (const beta of [30, 60, 90]) {
        for (const gamma of [-20, 0, 20]) {
          // Clockwise in the world is DECREASING alpha, which is why the
          // compass heading is 360 - alpha.
          results[`b${beta}g${gamma}`] = run((i) => ({ alpha: (360 - i * 2) % 360, beta, gamma }));
        }
      }
      return results;
    });
    assert(out.ios > 0, `precondition: the iOS path turns right, got ${out.ios}`);
    for (const [k, v] of Object.entries(out)) {
      assert(v > 0, `${k}: the same physical turn to the right gave yaw ${v.toFixed(2)} — mirrored`);
      near(v, out.ios, 1, `${k} against the iOS path`);
    }
  });

  await t('a phone lying flat still has a compass', async () => {
    /* `_fromEuler` collapses to atan2(0, 0) when beta and gamma are both zero
       — which is 0, not NaN, so it reported due north for every alpha and the
       `360 - alpha` fallback in `_heading` could never fire. A phone flat on a
       table, or held out level, had no steering at all. */
    const yaw = await h.steering(({ mod }) => {
      const s = new mod.Steering();
      s.enableGyro();
      for (let i = 0; i <= 10; i++) {
        window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: (360 - i * 2) % 360, beta: 0, gamma: 0 }));
      }
      return s.relativeYaw;
    });
    near(yaw, 20, 0.5, 'a flat phone turned 20 degrees clockwise');
  });

  await t('alignment is symmetric, monotone and never negative', async () => {
    /* The properties, not the curve. The exponent and the floors in the levels
       are tuning and will move; these four are what the levels are entitled to
       assume. "Never negative" is the load-bearing one: every shipped level
       writes alignment straight into a `setTargetAtTime` on a gain, and a
       negative gain is a phase-inverted voice — `Math.max(0, value)` only
       guards the `source()` seam, which the levels do not all use yet. */
    const out = await h.steering(({ mod }) => {
      const samples = [];
      for (let d = 0; d <= 180; d += 1) samples.push(mod.alignment(d, 0));
      return {
        samples,
        mirrored: [10, 45, 80, 120].map((d) => [mod.alignment(360 - d, 0), mod.alignment(d, 0)]),
        atZero: mod.alignment(0, 0),
      };
    });
    near(out.atZero, 1, 1e-9, 'alignment facing the source');
    for (const v of out.samples) assert(v >= 0, `alignment returned ${v} — a negative gain is an inverted voice`);
    for (let i = 1; i < out.samples.length; i++) {
      assert(out.samples[i] <= out.samples[i - 1] + 1e-12,
        `alignment rose while turning away, at ${i} degrees off`);
    }
    for (const [a, b] of out.mirrored) near(a, b, 1e-9, 'turning left and right by the same amount');
  });

  /* ------------------------------------------------------------------ */
  group('Spatialisation: the medium is the product');

  /* The game's own draft timbre, so these measure the sound SOUNDING makes
     rather than a test tone chosen to make the numbers look good. */
  const DRAFT = { color: 'brown', filterType: 'bandpass', freq: 420, Q: 0.7 };
  const ild = (m) => dBBetween(m.rmsR, m.rmsL);
  const placed = (bearing, yaw = 0) => h.render(({ audio }) => {
    audio.setListenerYaw(A.yaw);
    audio.source(A.bearing, A.opts).level(0.5, 0.001);
  }, { args: { bearing, yaw, opts: DRAFT }, seconds: 2 });

  await t('a source on the right arrives at the right ear first and loudest', async () => {
    const right = await placed(90);
    const left = await placed(270);
    assert(ild(right) > 2, `a source at 90 degrees should favour the right ear, measured ${ild(right).toFixed(2)} dB`);
    assert(ild(left) < -2, `a source at 270 degrees should favour the left ear, measured ${ild(left).toFixed(2)} dB`);
    near(ild(right), -ild(left), 0.5, 'the two sides should mirror each other');
  });

  await t('dead ahead is centred', async () => {
    near(ild(await placed(0)), 0, 0.3, 'a source straight ahead should sit between the ears');
  });

  await t('turning toward a source centres it', async () => {
    /* The compass half of the loop the game is built on, measured in the
       signal rather than in the maths: a source 90 degrees to the right must
       become a source dead ahead when the Seeker turns 90 degrees right. If
       the listener orientation and the compass ever disagree in sign, this is
       what catches it — every other channel would still look correct. */
    const before = ild(await placed(90, 0));
    const after = ild(await placed(90, 90));
    assert(before > 2, `precondition: source starts to the right, measured ${before.toFixed(2)} dB`);
    near(after, 0, 0.5, 'after turning 90 degrees right, the source should be centred');
  });

  await t('front and back are not the same sound', async () => {
    /* Both sit at ILD zero — the ears are equidistant — so the only thing
       separating "ahead" from "behind" is what the HRTF does to the spectrum.
       It is 1.4 dB and a timbre change, which is thin, and it is why levels
       lean on turning rather than on a single held judgement. Asserted as
       "distinguishable at all", not as "sufficient": whether it is enough for
       a player is an ear question this suite cannot answer. */
    const ahead = await placed(0);
    const behind = await placed(180);
    near(ild(ahead), 0, 0.3, 'a source ahead is centred');
    near(ild(behind), 0, 0.3, 'a source behind is also centred — that is the problem');
    const apart = Math.abs(dBBetween(ahead.rms, behind.rms));
    assert(apart > 0.5, `front and back differ by only ${apart.toFixed(2)} dB — nothing separates them`);
  });

  /* ------------------------------------------------------------------ */
  group('The reference plane: every defect this project shipped lived here');

  await t('a burst placed close is not a burst made louder', async () => {
    /* The shipped defect: `distance` fed the panner's inverse distance model
       with nothing compensating, so a burst at radius 1 skipped the flat 1/6
       every positioned voice pays and arrived 15.6 dB hot. That is how the
       loudest single event in the First Narrowing came to be the ember that
       fires when the Seeker errs. `referenceTrim` is what holds this line. */
    const near1 = await h.render(({ audio }) => { audio.burst({ angleDeg: 0, distance: 1, gain: 0.5, dur: 0.3 }); }, { seconds: 0.5 });
    const far = await h.render(({ audio }) => { audio.burst({ angleDeg: 0, distance: 6, gain: 0.5, dur: 0.3 }); }, { seconds: 0.5 });
    near(dBBetween(near1.peakL, far.peakL), 0, 0.5, 'a burst at radius 1 against the same burst at radius 6');
  });

  await t('the calibration reference travels the chain the game travels', async () => {
    /* It used to connect straight to `destination`, skipping the panner's
       1/6 and master's 0.5 — about 21.6 dB above any cue of the same nominal
       gain, so the Seeker set their volume against a sound the game never
       makes. Re-routing it past the chain is a one-line edit that changes
       nothing visible; this is the only thing that would notice. */
    const tone = await h.render(({ audio }) => { audio.calibrationTone(40); }, { seconds: 2 });
    const cue = await h.render(({ audio }) => {
      audio.voice(40, { color: 'brown', filterType: 'bandpass', freq: 500, Q: 0.7, gain: A.gain });
    }, { args: { gain: 0.05 }, seconds: 2 });
    near(dBBetween(tone.rms, cue.rms), 0, 0.5,
      'the reference against a positioned cue of the same nominal gain');
  });

  await t('the trial scaling reaches every way a level can make a sound', async () => {
    /* Three levels forgot this by hand, which is why `source`/`ambient`/
       `burst` own it now. A fourth way in that forgets it again would make a
       trial-3 level louder than trial 1 in exactly one voice. */
    const { TRIAL_AUDIO_SCALE } = await h.constants();
    const trial3 = TRIAL_AUDIO_SCALE[TRIAL_AUDIO_SCALE.length - 1];
    const expected = dB(trial3);
    const pair = async (build, opts) => {
      const full = await h.render(build, { ...opts, args: { ...opts.args, scale: 1 } });
      const half = await h.render(build, { ...opts, args: { ...opts.args, scale: trial3 } });
      return dBBetween(half.rms, full.rms);
    };
    const s = await pair(({ audio }) => {
      audio.setAudioScale(A.scale);
      audio.source(0, A.opts).level(0.5, 0.001);
    }, { args: { opts: DRAFT }, seconds: 2 });
    /* Read from constants.js, never typed in here: TRIAL_AUDIO_SCALE has
       already been re-tuned once, and a test carrying its own copy of a
       provisional number stops testing it the moment it moves. */
    const a = await pair(({ audio }) => {
      audio.setAudioScale(A.scale);
      audio.ambient({ color: 'brown', filterType: 'lowpass', freq: 400 }).level(0.5, 0.001);
    }, { args: {}, seconds: 2 });
    const b = await pair(({ audio }) => {
      audio.setAudioScale(A.scale);
      audio.burst({ angleDeg: 0, gain: 0.5, dur: 0.3 });
    }, { args: {}, seconds: 0.5 });
    near(s, expected, 0.3, `source() at trial-3 scale (${trial3})`);
    near(a, expected, 0.3, `ambient() at trial-3 scale (${trial3})`);
    near(b, expected, 0.5, `burst() at trial-3 scale (${trial3})`);
  });

  await t('distanceGain mirrors the panner it claims to mirror', async () => {
    /* `distanceGain()` is a hand-written copy of the panner's inverse distance
       model, and `referenceTrim` — the thing standing between the game and a
       repeat of the 15.6 dB burst defect — is built entirely out of it. If the
       helper and the node ever disagree, every compensation in the engine is
       computed against a model the audio does not use. Asserted inside
       maxDistance; beyond it the two are only reported, because whether the
       inverse model clamps is a spec question this suite is here to answer,
       not to assume. */
    const FLAT = { color: 'brown', filterType: 'lowpass', freq: 2000, Q: 0.7, gain: 0.5 };
    const atRadius = async (r) => {
      const m = await h.render(({ audio }) => {
        const v = audio.voice(0, A.opts);
        audio.positionPanner(v.panner, 0, A.r);
      }, { args: { r, opts: FLAT }, seconds: 2 });
      return m.rms;
    };
    const base = await atRadius(6);
    const predicted = (r) => dB((1 / (1 + (Math.max(r, 1) - 1))) / (1 / 6));
    const rows = [];
    for (const r of [1, 2, 6, 12, 20]) {
      const measured = dBBetween(await atRadius(r), base);
      rows.push(`r=${r}: ${measured.toFixed(2)} dB measured, ${predicted(r).toFixed(2)} predicted`);
      near(measured, predicted(r), 0.3, `the panner at radius ${r} against distanceGain(${r})`);
    }
    /* Beyond maxDistance (20) the helper has no clamp. Reported, not asserted. */
    const beyond = dBBetween(await atRadius(40), base);
    console.log(`          r=40 (past maxDistance): ${beyond.toFixed(2)} dB measured, ${predicted(40).toFixed(2)} predicted by the helper`);
  });

  await t('declining to place a sound costs no decibels', async () => {
    /* `nonPositioned` exists so that "this sound is the room" is a spatial
       statement rather than a level one — it is pre-trimmed by
       distanceGain(6) to land where a positioned voice lands. What it cannot
       compensate for is the HRTF itself: a positioned voice is convolved and
       an ambient one is not, and nobody has ever measured what that costs.
       Level 4's breathing cave and level 9's forge bed are the two sounds
       riding on the answer. Same buffer, same filter, same nominal gain,
       one difference. */
    const SAME = { color: 'brown', filterType: 'lowpass', freq: 400, Q: 0.7 };
    const positioned = await h.render(({ audio }) => { audio.source(0, A.o).level(0.5, 0.001); }, { args: { o: SAME }, seconds: 2 });
    const side = await h.render(({ audio }) => { audio.source(90, A.o).level(0.5, 0.001); }, { args: { o: SAME }, seconds: 2 });
    const room = await h.render(({ audio }) => { audio.ambient(A.o).level(0.5, 0.001); }, { args: { o: SAME }, seconds: 2 });
    const ahead = dBBetween(room.rms, positioned.rms);
    const beside = dBBetween(room.rms, side.rms);
    console.log(`          HRTF insertion: an ambient bed sits ${ahead.toFixed(2)} dB from a source ahead, ${beside.toFixed(2)} dB from one at 90 degrees`);
    assert(Math.abs(ahead) < 2 && Math.abs(beside) < 2,
      `an unplaced sound is ${ahead.toFixed(2)} dB from a placed one — the trim is not holding the plane`);
  });

  await t('the calibration reference sits inside the range it calibrates', async () => {
    /* The shape, not the numbers. What has to be true is that the Seeker sets
       their volume against something the game brackets: level 1's aligned draft
       above the reference, its misaligned floor below it, and enough span
       between them that "near-inaudible misaligned, clearly present aligned"
       is a real distance rather than a sentence. The two figures are printed
       because they are the honest version of a docstring that has been
       quoting nominal gain as though it were output. */
    const ref = await h.render(({ audio }) => { audio.calibrationTone(40); }, { seconds: 2 });
    /* Level 1's own draft, at the two ends of its alignment curve. Gain and
       timbre both move with alignment there, and the timbre move is not
       level-neutral — a bandpass narrowing 0.6 -> 3.8 hands back several dB
       the gain curve just paid for, which is exactly why this is measured
       rather than computed. */
    const draft = (gain, freq, Q) => h.render(({ audio }) => {
      audio.voice(0, { color: 'brown', filterType: 'bandpass', freq: A.freq, Q: A.Q, gain: A.gain });
    }, { args: { gain, freq, Q }, seconds: 2 });
    const aligned = dBBetween((await draft(0.52, 340, 3.8)).rms, ref.rms);
    const floor = dBBetween((await draft(0.02, 300, 0.6)).rms, ref.rms);
    console.log(`          measured: aligned ${aligned >= 0 ? '+' : ''}${aligned.toFixed(1)} dB, misaligned ${floor.toFixed(1)} dB, span ${(aligned - floor).toFixed(1)} dB`);
    assert(aligned > 6, `the aligned cue must sit clearly above the reference, measured ${aligned.toFixed(1)} dB`);
    assert(floor < -2, `the misaligned floor must sit below the reference, measured ${floor.toFixed(1)} dB`);
    assert(aligned - floor >= 18, `level 1's range is ${(aligned - floor).toFixed(1)} dB — too little to carry alignment`);
  });

  await t('the calibration reference does not move with the trial', async () => {
    /* It is the fixed thing the trials are heard against. If `setAudioScale`
       ever reached it, trial 3 would quietly recalibrate the Seeker's ear to
       trial 3. True today only because `voice()` never touches `opts.gain`,
       which is an accident rather than a decision — so it is pinned here. */
    const at = (scale) => h.render(({ audio }) => {
      audio.setAudioScale(A.scale);
      audio.calibrationTone(40);
    }, { args: { scale }, seconds: 2 });
    const full = await at(1);
    const faint = await at(0.5);
    near(dBBetween(faint.rms, full.rms), 0, 0.2, 'the reference under trial-3 scaling');
  });

  /* ------------------------------------------------------------------ */
  group('The room: a space that never competes with the cue');

  /* The two yardsticks every room number in this file is quoted against, and
     the reason they are rendered rather than written down: a gain constant
     does not predict a level on a broadband source. Level 1's own draft at
     the two ends of its alignment curve. */
  const l1 = (gain, freq, Q) => h.render(({ audio }) => {
    audio.voice(0, { color: 'brown', filterType: 'bandpass', freq: A.freq, Q: A.Q, gain: A.gain });
  }, { args: { gain, freq, Q }, seconds: 3 });
  const cueAligned = (await l1(0.52, 340, 3.8)).rms;
  const cueFloor = (await l1(0.02, 300, 0.6)).rms;
  const levels = await h.levelData();
  const withRooms = levels.filter((lv) => lv.beds.length || lv.events.length);

  await t('a room belongs to the space its level is actually in', async () => {
    /* Pinned deliberately, and it is a design decision rather than a physical
       fact — which is exactly why it is pinned. "Natural" here has to mean
       true to THIS space, not cave SFX everywhere: a forge does not drip, a
       frozen clearing has no limestone floor, and level 7's frozen river
       cannot take a low bed at all because its true cue is the low, late,
       quiet voice a bed would bury. Four of the five silent levels are silent
       because a room would damage a discrimination the level is teaching. If
       this list changes, someone should have decided to change it. */
    const ids = withRooms.map((lv) => lv.id);
    const expected = [1, 3, 4, 5, 8];
    assert(ids.join() === expected.join(),
      `levels carrying a room are ${ids.join(', ')} — expected ${expected.join(', ')}`);
    for (const lv of withRooms) {
      console.log(`          level ${lv.id} ${lv.name}: ${lv.beds.length} bed(s), ${lv.events.length} event(s)`);
    }
  });

  await t('the room cannot see the player', async () => {
    /* Structural, and the reason it is worth a case: this is the only thing
       standing between a room layer and the reward schedule pillar 3 refuses.
       `update` takes the transport time and nothing else, so no room event can
       be made to answer a presence mark, a hold, or an alignment — not by
       policy but because the interface has nowhere to put one. Event spacing
       is drawn from a range, which is a room and not a variable ratio: the
       randomness is in where the furniture is, and there is no payoff for it
       to attach to. If a third parameter ever appears here, that changes. */
    const got = await h.engine(({ audio }) => {
      const r = audio.room({ beds: [], events: [] });
      return { arity: r.update.length, keys: Object.keys(r).sort().join(',') };
    });
    assert(got.arity === 1, `room().update takes ${got.arity} parameters — it may only take time`);
    assert(got.keys === 'stop,update', `room() exposes ${got.keys} — expected stop,update`);
  });

  await t("the room's loudest moment stays under the cue at full alignment", async () => {
    /* The rule that keeps a drip from becoming the loudest thing in the First
       Narrowing, which is the shape of a defect this project has already
       shipped once (the ember burst on error, at radius 1). Measured over
       ~50 ms rather than over the whole render, because that is the window in
       which a transient can mask a steady sound; comparing a 130 ms drip's
       full-render RMS to a draft's would flatter it by an order of magnitude
       and prove nothing. */
    const { ROOM_CEILING } = await h.constants();
    for (const lv of withRooms) {
      for (const e of lv.events) {
        const m = await h.render(({ audio }) => { audio.burst(A.e); }, {
          args: { e: { ...e, angleDeg: e.bearing } }, seconds: Math.max(1, (e.dur || 0.3) + 0.4),
        });
        const over = dBBetween(m.maxWin, cueAligned);
        /* The same spec measures differently at different bearings — the HRTF
           is worth about 2.5 dB across the circle — so these figures are one
           sample of a band, not a constant. Deterministic here only because
           `levelData` seeds the bearings; on a device they are redrawn each
           trial, which is why the margins are generous. */
        console.log(`          level ${lv.id} ${e.freq} Hz event: ${over.toFixed(1)} dB against the aligned cue`);
        assert(over <= -ROOM_CEILING.eventBelowCue,
          `level ${lv.id}'s ${e.freq} Hz room event is ${over.toFixed(1)} dB from the aligned cue — the ceiling is -${ROOM_CEILING.eventBelowCue}`);
      }
    }
  });

  await t("the room's bed stays under the cue at its quietest", async () => {
    /* The stricter of the two rules and the one that protects the first minute
       of level 1. A bed runs continuously, so it is judged against the cue at
       its WORST — the misaligned floor — and not against the cue at its best.
       A room louder than the cue in a misaligned moment is a room that has
       replaced the mechanic with scenery.

       Rendered with an instant ramp rather than `room()`'s 1.5 s fade: the
       rule is about the bed's steady level, and the fade is a shape. */
    const { ROOM_CEILING } = await h.constants();
    for (const lv of withRooms) {
      for (const b of lv.beds) {
        const m = await h.render(({ audio }) => { audio.ambient(A.b).level(A.b.gain, 0.001); },
          { args: { b }, seconds: 3 });
        const over = dBBetween(m.rms, cueFloor);
        console.log(`          level ${lv.id} ${b.freq} Hz bed: ${over.toFixed(1)} dB against the misaligned floor`);
        assert(over <= -ROOM_CEILING.bedBelowFloor,
          `level ${lv.id}'s ${b.freq} Hz bed is ${over.toFixed(1)} dB from the misaligned floor — the ceiling is -${ROOM_CEILING.bedBelowFloor}`);
      }
    }
  });

  await t('the room gets quieter on later trials, so its headroom is constant', async () => {
    /* The invariance that makes one measurement cover all three trials. If the
       room did not scale, trial 3 would quietly hand the room 6 dB of the cue's
       ground — the cue would recede for "a deeper kind of listening" and the
       scenery would not. Both halves are checked, because they reach the
       scaling by different routes: beds through `ambient()`, events through
       `burst()`. */
    const { TRIAL_AUDIO_SCALE, ROOM_CEILING } = await h.constants();
    const trial3 = TRIAL_AUDIO_SCALE[TRIAL_AUDIO_SCALE.length - 1];
    const spec = withRooms.find((lv) => lv.id === 1);
    const bedAt = (scale) => h.render(({ audio }) => {
      audio.setAudioScale(A.scale);
      audio.room({ beds: [A.b], fade: 0.001 });
    }, { args: { scale, b: spec.beds[0] }, seconds: 3 });
    const eventAt = (scale) => h.render(({ audio, at }) => {
      audio.setAudioScale(A.scale);
      const r = audio.room({ events: [{ ...A.e, every: [0.1, 0.1] }] });
      at(0.2, () => r.update(1));
    }, { args: { scale, e: { ...spec.events[0], bearing: 0 } }, seconds: 1 });
    near(dBBetween((await bedAt(trial3)).rms, (await bedAt(1)).rms), dB(trial3), 0.3,
      `the room bed at trial-3 scale (${trial3})`);
    near(dBBetween((await eventAt(trial3)).maxWin, (await eventAt(1)).maxWin), dB(trial3), 0.5,
      `a room event at trial-3 scale (${trial3})`);
    console.log(`          headroom against the cue is therefore the same on all ${TRIAL_AUDIO_SCALE.length} trials`
      + ` (bed -${ROOM_CEILING.bedBelowFloor} dB, events -${ROOM_CEILING.eventBelowCue} dB or better)`);
  });

  await t("level 6's five depths arrive on one ladder, not on five", async () => {
    /* The defect CLAUDE.md has been carrying as known-and-unfixed. All five
       depth layers shared one gain curve, and a shared gain is not a shared
       level: at the curve's aligned value they rendered +25.9, +14.5, +23.0,
       -9.2 and +19.8 dB against the calibration reference — a 35.1 dB spread.
       The surface hiss sat on top of everything the briefing promises is
       underneath it, and the Lattice, reached only by holding through 70% of a
       35-second hold, was 35 dB down and inaudible. `depthTrim` is the fix and
       this is what holds it.

       Two spreads, because the textures are not alike. Four layers are
       continuous and are matched on RMS; the Lattice is impulsive, with a
       crest factor about 8 dB above the others, so matching its RMS would have
       put its clicks proud of everything around it. It is matched on its
       loudest 50 ms instead, which is why the RMS spread is the looser bound.

       Not asserted, and worth saying: equal rendered level is not equal
       LOUDNESS. At this game's listening level the 120 Hz Core will read
       softer than the 2.6 kHz Shell even though they now measure the same.
       That needs an ear, a phone and a quiet room. */
    const lv = levels.find((l) => l.id === 6);
    assert(lv && lv.depthTrim, 'level 6 must carry a depthTrim');
    const layers = [
      { color: 'white', filterType: 'highpass', freq: 2600, Q: 0.6 },
      { color: 'brown', filterType: 'bandpass', freq: 700, Q: 1 },
      { color: 'brown', filterType: 'lowpass', freq: 260, Q: 0.8 },
      { color: 'crackle', filterType: 'bandpass', freq: 420, Q: 2 },
      { color: 'brown', filterType: 'lowpass', freq: 120, Q: 0.6 },
    ];
    const aligned = 0.015 + 0.4; // the level's own curve at alignment 1
    const rms = [];
    const win = [];
    let power = 0;
    for (let i = 0; i < layers.length; i++) {
      const m = await h.render(({ audio }) => {
        audio.voice(0, { ...A.o, gain: A.gain });
      }, { args: { o: layers[i], gain: aligned * lv.depthTrim[i] }, seconds: 3 });
      rms.push(dBBetween(m.rms, cueAligned));
      win.push(dBBetween(m.maxWin, cueAligned));
      power += m.rms ** 2;
      console.log(`          depth ${i} (${layers[i].freq} Hz): ${rms[i].toFixed(1)} dB rms,`
        + ` ${win[i].toFixed(1)} dB over 50 ms, against level 1's aligned draft`);
    }
    const spread = (a) => Math.max(...a) - Math.min(...a);
    console.log(`          the whole stack, open and aligned: ${dBBetween(Math.sqrt(power), cueAligned).toFixed(1)} dB`
      + " against level 1's aligned draft");
    assert(spread(rms) <= 8, `the five depths span ${spread(rms).toFixed(1)} dB rms — they were 35.1 apart, and one ladder is the point`);
    assert(spread(win) <= 5, `the five depths span ${spread(win).toFixed(1)} dB over 50 ms`);
  });

  /* ------------------------------------------------------------------ */
  group('Movement: a source that moves must move its panner, and ramp it');

  await t('movePanner ramps where positionPanner steps', async () => {
    /* Level 10's premise is a source that will not hold still, and for the
       life of the project its panner never moved. The fix was `movePanner`,
       and the reason it ramps rather than assigns is that stepping the HRTF
       convolution on a quiet slow source is audible as zipper noise. Both
       halves are asserted: that the image moves at all, and that it arrives
       gradually. Measured at 3 kHz, where the head shadow is strong enough
       for the trajectory to be read cleanly. */
    const SHARP = { color: 'white', filterType: 'bandpass', freq: 3000, Q: 0.7, gain: 0.5 };
    const trace = async (useMove) => {
      const r = await h.render(({ audio, at }) => {
        const v = audio.voice(0, A.opts);
        at(0.5, () => { if (A.useMove) audio.movePanner(v.panner, 90); else audio.positionPanner(v.panner, 90); });
      }, { args: { useMove, opts: SHARP }, seconds: 1, windows: 50 });
      const curve = r.windows.map((w) => dBBetween(w.rmsR, w.rmsL));
      const settled = curve.slice(45).reduce((x, y) => x + y, 0) / 5;
      return { settled, at40ms: curve[27] / settled };  // window 25 is the move; 20ms each
    };
    const ramped = await trace(true);
    const stepped = await trace(false);
    assert(ramped.settled > 8, `the source must actually arrive on the right, measured ${ramped.settled.toFixed(1)} dB`);
    assert(stepped.at40ms > 0.8,
      `precondition: an assigned position should be there almost at once, measured ${(stepped.at40ms * 100).toFixed(0)}%`);
    assert(ramped.at40ms < 0.4,
      `movePanner should still be travelling 40ms in, measured ${(ramped.at40ms * 100).toFixed(0)}% of the way`);
  });
} catch (e) {
  console.log(`\n  ERROR  ${e.stack || e.message}\n`);
  exitCode = 2;
} finally {
  if (h) await h.close();
  if (browser) await browser.close();
  server.stop();
}

console.log(`\n${pass} passed, ${failures.length} failed\n`);
if (failures.length) console.log(`failing: ${failures.join('; ')}\n`);
/* A run that asserted nothing is not a green run — the same rule the UI suite
   carries, for the same reason. */
if (!exitCode && pass + failures.length === 0) {
  console.log('  ERROR  no cases ran'
    + (only ? ` — SOUNDING_AUDIO_ONLY="${only}" matched nothing` : '') + '\n');
  exitCode = 2;
}
process.exit(exitCode || (failures.length ? 1 : 0));
