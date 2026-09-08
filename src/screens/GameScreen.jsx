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
  const commitRef = useRef(() => {});
  const markRef = useRef(0);

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

  function dismissWelcome() { setShowWelcome(false); }

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
      level.onCommit(state, levelCtx());
    }
    commitRef.current = tryCommit;

    function onKeyDown(e) {
      if (!runningRef.current) return;
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
    <div className="snd-screen snd-screen-game" data-force={force} data-depth={depth}>
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
        {/* announce=false: the dialog's own aria-label already gives a
            screen reader the sentence the moment focus lands in it — a
            second announcement here, arriving ~2s later when the sweep
            finishes, would just repeat it. */}
        <BaluchariReveal className="snd-welcome-line" durationMs={2200} announce={false}>
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
