import { useEffect, useRef, useState } from 'react';
import { TantuButton, TantuMeter, SikkuKolamLoader, TantuDialog, BaluchariReveal } from '@weaveaijs/tantu';

import { TRIAL_AUDIO_SCALE, PRESENCE_MARKS, MARK_REARM } from '../engine/constants.js';
import { useSubstrate } from '../components/LoomSubstrate.jsx';
import { speakOnce } from '../engine/voice.js';

/**
 * Cumulative-presence marks that the loom answers, and the fall-back needed
 * before one can answer again. Both moved to constants.js so the level
 * contract check can read a level's `depthAt` against them — see there for
 * why they are fixed and deterministic.
 */
const MARKS = PRESENCE_MARKS;
const REARM = MARK_REARM;

/** How long the completion beat holds the screen before the end card. */
const BEAT_MS = 2100;

/**
 * Floor on how often a `commit`-control level's `onCommit` can fire, in
 * game-elapsed seconds. This is a rate limit on the INPUT, not a penalty on
 * being wrong: a wrong commit still costs nothing per attempt (see pillar 3
 * and CLAUDE.md's "Level 2 lets you guess wrong with no penalty"), but
 * nothing stopped it from being repeated fast enough to substitute for
 * listening entirely. Without this, holding a turn key (which repeats under
 * normal OS key-repeat) while mashing Space/Enter/click sweeps the whole
 * circle past any level's tolerance window within a single short episode —
 * a wall-clock-cheap way to "win" that requires no discrimination at all.
 * Lives here rather than in any one level's `onCommit` because it is a
 * property of the shared commit plumbing (every keydown and every click
 * reaches `tryCommit` with no debounce of its own) and every `commit`-
 * control level shares the exposure — level 2's rhythm-vs-leaf judgement and
 * level 7's phase-1 static bearing both go through this same path. ~1.0s is
 * roughly 2x level 2's 0.46s footfall stride: a genuine single deliberate
 * commit per real judgement is unaffected; only sub-second mashing is.
 */
const COMMIT_MIN_INTERVAL = 1.0;

/**
 * The one line this game says out loud, and only once — the first time any
 * Seeker ever enters a trial, gated on the same `firstEver` flag level 1
 * already uses to soften its opening (see `state.onboarding` in
 * first-narrowing.js). It exists because the orb used to answer that
 * question itself: `setOrb(align)` drove scale and opacity directly, a
 * continuous, zero-latency, hardware-independent readout of the exact
 * scalar every level is built on. A sighted player watching it wasn't
 * taking a shortcut — they were using the more reliable sensor — and the
 * trained-ear premise only survived because players volunteered not to
 * look. The orb no longer carries that signal (see the render below); this
 * line is what replaces it, once, as an explicit acknowledgment rather than
 * a visual crutch nobody was told about.
 *
 * Second person, not first — no narrator character is established anywhere
 * in this game's fiction, and inventing one for a single line risks reading
 * as more world than was asked for. Kept short: it is spoken AND woven in
 * text at once, and neither should outlast the other by much.
 */
const WELCOME_LINE = 'There is nothing here to see. Only to hear. Breathe, and listen.';

function headingTextFor(steering) {
  const r = steering.relativeYaw;
  if (Math.abs(r) < 4) return 'facing forward';
  return r > 0 ? `turned ${Math.round(r)}° right` : `turned ${Math.round(-r)}° left`;
}

/**
 * GameScreen — the frame loop.
 *
 * Levels (src/levels/*.js) are plain, framework-agnostic objects. Only the ui
 * callbacks they receive changed when this moved to React: they write into
 * state here instead of touching the DOM, and the surrounding chrome is Tantu.
 */
export function GameScreen({ level, trial, firstEver, gyroActive, audio, steering, onComplete }) {
  const [presence, setPresenceState] = useState(0);
  const [orb, setOrbState] = useState({ strength: 0, notice: false });
  const [word, setWordState] = useState('listening');
  const [heading, setHeading] = useState('facing forward');
  const [breatheHeld, setBreatheHeld] = useState(false);
  const [depth, setDepth] = useState(0);
  const [finishing, setFinishing] = useState(null);
  // Shown once, only for the very first trial any Seeker ever enters. Not
  // re-derived from `firstEver` on every render — `firstEver` describes the
  // trial being entered, and once dismissed this stays dismissed even though
  // that prop does not change for the rest of this mount.
  const [showWelcome, setShowWelcome] = useState(firstEver);

  const levelStateRef = useRef({});
  const runningRef = useRef(false);
  const rafRef = useRef(null);
  const lastFrameRef = useRef(0);
  const elapsedRef = useRef(0);
  const flashTimeoutRef = useRef(null);
  const dragzoneRef = useRef(null);
  const orbRef = useRef(null);
  const screenRef = useRef(null);
  const commitRef = useRef(() => {});
  const markRef = useRef(0);
  // Game-elapsed time (matches ctx.elapsed) of the last onCommit that was
  // actually dispatched — see COMMIT_MIN_INTERVAL above.
  const lastCommitAtRef = useRef(-Infinity);
  // Read inside the frame loop and the window keydown handler, both set up
  // once in the mount effect below and closed over `showWelcome` at that
  // moment only — a ref is what lets them see it change.
  const showWelcomeRef = useRef(firstEver);
  useEffect(() => { showWelcomeRef.current = showWelcome; }, [showWelcome]);

  const substrate = useSubstrate();
  const force = level.force.name.toLowerCase();
  const isMass = level.force.name === 'Mass';

  // Speaks WELCOME_LINE once, independent of and in addition to the woven
  // text — never through AudioEngine, see voice.js for why. Feature-detected
  // and silent on failure; a Seeker with no speech synthesis, or one who has
  // denied it, still gets the woven line dismissWelcome() below reacts to.
  useEffect(() => {
    if (!showWelcome) return undefined;
    const spoken = speakOnce(WELCOME_LINE);
    return () => spoken.stop();
  }, [showWelcome]);

  function dismissWelcome() {
    setShowWelcome(false);
    // TantuDialog restores focus to whatever was focused when it opened —
    // and it opens at mount, one commit after the briefing screen's own
    // button has already unmounted, so what it captured was <body>. Left
    // alone, dismissing hands focus back to <body> and a keyboard Seeker is
    // standing outside the screen. Deferred one tick so this runs after that
    // restoration rather than racing it.
    setTimeout(() => screenRef.current?.focus(), 0);
  }

  useEffect(() => {
    const state = levelStateRef.current;
    // The very first trial anyone plays starts near the source, so presence
    // moves within seconds of the first turn. An initial condition, not a
    // changed mechanic: nothing about the hold, the tolerance or the decay
    // differs. Retired permanently after that one trial.
    state.onboarding = firstEver;

    audio.init();
    audio.setAudioScale(TRIAL_AUDIO_SCALE[Math.min(trial, TRIAL_AUDIO_SCALE.length) - 1]);

    steering.reset();
    steering.onChange = () => {
      if (audio.ctx) audio.setListenerYaw(steering.yaw);
      if (runningRef.current) setHeading(headingTextFor(steering));
    };
    if (gyroActive) steering.enableGyro();

    /** Answer a crossed mark: dye from the orb, and — for Mass — a real pulse. */
    function answerMark() {
      const node = orbRef.current;
      if (node) {
        const box = node.getBoundingClientRect();
        substrate.pulse(box.left + box.width / 2, box.top + box.height / 2);
      } else {
        // Only before the orb has mounted — dye from the middle of the cloth.
        substrate.pulse(window.innerWidth / 2, window.innerHeight / 2);
      }
      // FORCES.MASS names haptics as its channel; this is the only level family
      // that fires them, and only on a mark, so it can never become a buzz.
      if (isMass && typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(18); } catch (e) { /* unsupported */ }
      }
    }

    const ui = {
      setPresence(v) {
        const p = Math.max(0, Math.min(100, v));
        setPresenceState(p);

        let idx = markRef.current;
        while (idx < MARKS.length && p >= MARKS[idx]) { answerMark(); idx++; }
        while (idx > 0 && p < MARKS[idx - 1] - REARM) idx--;
        if (idx !== markRef.current) {
          markRef.current = idx;
          setDepth(idx);
        }
      },
      setOrb(strength, notice = false) { setOrbState({ strength, notice }); },
      setWord(w) { setWordState(w); },
      flash(msg) {
        setHeading(msg);
        clearTimeout(flashTimeoutRef.current);
        flashTimeoutRef.current = setTimeout(() => {
          if (runningRef.current) setHeading(headingTextFor(steering));
        }, 1600);
      },
    };

    function complete() {
      runningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const info = level.completionText(state);
      // The beat holds the screen before the end card: the moment the hold
      // lands is the thing being answered, not the screen after it.
      setFinishing({ info, snapped: false });
    }

    function levelCtx() {
      return { yaw: steering.yaw, audio, elapsed: elapsedRef.current, complete, ...ui };
    }

    level.init(state, audio);
    runningRef.current = true;

    function frame(ts) {
      if (!runningRef.current) return;
      if (showWelcomeRef.current) {
        // The trial does not run behind the welcome — see the dialog's own
        // comment below. Held at frame 0 rather than merely un-advanced, so
        // the first real frame after dismissal starts clean instead of
        // charging a multi-second dt for time the Seeker spent reading.
        lastFrameRef.current = 0;
        rafRef.current = requestAnimationFrame(frame);
        return;
      }
      if (!lastFrameRef.current) lastFrameRef.current = ts;
      const dt = Math.min((ts - lastFrameRef.current) / 1000, 0.1);
      lastFrameRef.current = ts;
      elapsedRef.current += dt;

      level.update(state, dt, elapsedRef.current, levelCtx());

      if (runningRef.current) rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);

    if (level.control !== 'breathe' && dragzoneRef.current) {
      steering.attachDrag(dragzoneRef.current);
    }

    function tryCommit() {
      if (!runningRef.current || !level.onCommit) return;
      // Rate-limited, not penalised: a commit inside the floor is dropped
      // silently — no flash, no state change, nothing the level even sees —
      // so mashing costs nothing and gains nothing, same as a single wrong
      // commit does. See COMMIT_MIN_INTERVAL.
      const now = elapsedRef.current;
      if (now - lastCommitAtRef.current < COMMIT_MIN_INTERVAL) return;
      lastCommitAtRef.current = now;
      level.onCommit(state, levelCtx());
    }
    commitRef.current = tryCommit;

    function onKeyDown(e) {
      if (!runningRef.current || showWelcomeRef.current) return;
      if (e.key === 'ArrowLeft') steering.turn(-8);
      if (e.key === 'ArrowRight') steering.turn(8);
      if ((e.key === ' ' || e.key === 'Enter') && level.control === 'commit') tryCommit();
    }
    window.addEventListener('keydown', onKeyDown);

    return () => {
      runningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearTimeout(flashTimeoutRef.current);
      window.removeEventListener('keydown', onKeyDown);
      if (level.cleanup) { try { level.cleanup(state); } catch (e) { /* noop */ } }
      audio.close();
      steering.disableGyro();
      steering.onChange = () => {};
    };
    // Mounted once per level+trial (see the `key` prop in App.jsx).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A level owns the whole viewport and is steered by swiping, so the page
  // must not scroll beneath it. Scoped to this screen's lifetime rather than
  // set globally on the body, which is what made the title screen unscrollable.
  useEffect(() => {
    document.body.classList.add('snd-noscroll');
    return () => document.body.classList.remove('snd-noscroll');
  }, []);

  // The beat: the thread winds, snaps taut, and the end card follows.
  useEffect(() => {
    if (!finishing) return undefined;
    const snap = setTimeout(() => setFinishing((f) => (f ? { ...f, snapped: true } : f)), 380);
    const done = setTimeout(() => onComplete(finishing.info), BEAT_MS);
    return () => { clearTimeout(snap); clearTimeout(done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(finishing)]);

  function turn(deg) { steering.turn(deg); }
  function commit() { commitRef.current(); }
  function breathe(held) {
    return (e) => {
      if (e.cancelable) e.preventDefault();
      setBreatheHeld(held);
      if (level.onBreathe) level.onBreathe(levelStateRef.current, held);
    };
  }

  if (finishing) {
    return (
      <div className="snd-screen snd-screen-game snd-beat" data-force={force}>
        <SikkuKolamLoader
          state={finishing.snapped ? 'resolved' : 'spinning'}
          audio={false}
          warpDots={6}
          weftDots={4}
          label="The hold settles"
        />
      </div>
    );
  }

  const steers = level.control !== 'breathe';

  return (
    // `data-depth` is a fact about the trial, not about the steering surface,
    // and it lives here so the elements it grades are free to sit wherever the
    // layout needs them. It used to hang off `.snd-voidfield`, which pinned the
    // presence meter inside a full-viewport field and left it to fend for
    // itself against the controls — which it lost, by 62–72%.
    <div
      ref={screenRef}
      tabIndex={-1}
      className="snd-screen snd-screen-game"
      data-force={force}
      data-depth={depth}
    >
      {/* What the player's hands are doing. It read "steering · swipe" on the
          two breathe levels, which have no steering at all — the same gate
          this screen kept getting wrong in the other direction. */}
      <div className="snd-control-badge">
        {steers ? `steering · ${gyroActive ? 'phone compass' : 'swipe'}` : 'breath · hold and release'}
      </div>

      {/* The field is the level's feedback — presence, the word, the orb — and
          it belongs to every level. Only the *steering* half of it is
          conditional: the drag surface and its hint. This whole block used to
          be gated on `control !== 'breathe'`, which meant levels 4 and 9 called
          setPresence, setOrb and setWord every frame into nothing at all. The
          visible cost landed on the presence marks: their motion answer is a
          dye front, and a dye front is correctly suppressed under reduced
          motion, so the static [data-depth] ladder is the only answer those
          players get — and on a breathe level it had no element to sit on. */}
      <div
        className={`snd-voidfield${steers ? '' : ' snd-voidfield-still'}`}
        ref={steers ? dragzoneRef : undefined}
      >
        {steers && (
          <div className="snd-drag-hint">
            {gyroActive ? 'turn your body or phone to steer' : '◂ swipe to turn ▸'}
          </div>
        )}
        <div className="snd-breath-word">{word}</div>
        {/* No longer scaled or faded by `orb.strength`. It used to be:
            `style={{ transform: scale(orbScale), opacity: orbOpacity }}`, a
            continuous, zero-latency, hardware-independent readout of the
            exact alignment value every level is built on — a strictly
            better instrument than the audio itself, with none of its
            thresholds or HRTF ambiguity. A sighted player watching it solve
            a level by eye wasn't cheating; they were reading the more
            reliable sensor. See WELCOME_LINE above for what replaces the
            signal this removes. `orb.notice` is unaffected — it is a
            discrete flag (a false rhythm, an overheat), not a continuous
            reading, and CLAUDE.md's Force-signature motion on this element's
            pseudo-elements is likewise untouched. */}
        <div ref={orbRef} className={`snd-orb${orb.notice ? ' snd-orb-notice' : ''}`} />
      </div>

      {/* Shown once, ever — see WELCOME_LINE above. A real TantuDialog rather
          than a hand-rolled scrim: this project has already shipped a focus-
          trap defect on its one other modal moment (the account screen's
          delete confirmation), and that is exactly the class of bug a proven
          primitive avoids. Not `persistent` — Escape and a scrim tap both
          dismiss it, alongside the button, because nothing here is
          destructive and this era's whole premise is that the Seeker cannot
          lose; nothing should trap them on the way in either. */}
      {/* No `title` — a heading above the woven line would fight the reveal
          it introduces. `aria-label` gives the dialog its accessible name
          instead, so it is announced immediately rather than left unnamed. */}
      <TantuDialog
        open={showWelcome}
        onClose={dismissWelcome}
        aria-label={WELCOME_LINE}
        className="snd-welcome"
      >
        {/* The dialog's own aria-label announces the sentence once, the
            moment focus lands — but a name is given on arrival and cannot be
            asked for again, and BaluchariReveal's drawn line is permanently
            aria-hidden. Without `announce`, a Seeker who has already moved
            past that first announcement and comes back to browse the panel
            finds only "Begin". Left at its default (true) so the role="status"
            copy BaluchariReveal leaves behind once the sweep finishes is the
            second, reachable place this sentence lives. */}
        <BaluchariReveal className="snd-welcome-line" durationMs={2200}>
          {WELCOME_LINE}
        </BaluchariReveal>
        <div className="snd-btnrow">
          <TantuButton variant="secondary" bleed={false} onClick={dismissWelcome}>
            Begin
          </TantuButton>
        </div>
      </TantuDialog>

      {/* One stack, so the reading and the controls cannot land on each other.
          These were three absolutely-positioned strips at 120px, 96px and
          knot-8, which held only as long as nobody changed a button's height:
          the meter sat inside the controls' band and every level painted 62%
          of it over — 72% on a breathe level, whose one wide button covers the
          most of the channel that level has fewest of. */}
      <div className="snd-bottom">
        {/* A bearing readout, and a breathe level has no bearing. */}
        {steers && <div className="snd-heading-cue">{heading}</div>}

        <div className="snd-presence-wrap">
          <TantuMeter value={presence} label="Presence" />
        </div>

      {level.control === 'commit' && (
        <div className="snd-controls-row">
          <TantuButton variant="ghost" className="snd-turn-btn" aria-label="Turn left" onClick={() => turn(-15)}>‹</TantuButton>
          <TantuButton variant="secondary" onClick={commit}>{level.commitLabel}</TantuButton>
          <TantuButton variant="ghost" className="snd-turn-btn" aria-label="Turn right" onClick={() => turn(15)}>›</TantuButton>
        </div>
      )}

      {level.control === 'hold' && (
        <div className="snd-controls-row">
          <TantuButton variant="ghost" className="snd-turn-btn" aria-label="Turn left" onClick={() => turn(-15)}>‹</TantuButton>
          <TantuButton variant="ghost" className="snd-turn-btn" aria-label="Turn right" onClick={() => turn(15)}>›</TantuButton>
        </div>
      )}

      {level.control === 'breathe' && (
        <div className="snd-controls-row">
          <TantuButton
            variant="primary"
            className={`snd-breathe-btn${breatheHeld ? ' snd-breathe-btn-holding' : ''}`}
            onTouchStart={breathe(true)}
            onTouchEnd={breathe(false)}
            onMouseDown={breathe(true)}
            onMouseUp={breathe(false)}
            onMouseLeave={breathe(false)}
          >
            Hold to Breathe In
          </TantuButton>
        </div>
      )}
      </div>
    </div>
  );
}
