import { useEffect, useRef, useState } from 'react';
import { TantuButton, TantuMeter, SikkuKolamLoader } from '@weaveaijs/tantu';

import { TRIAL_AUDIO_SCALE } from '../engine/constants.js';
import { useSubstrate } from '../components/LoomSubstrate.jsx';

/**
 * Cumulative-presence marks that the loom answers.
 *
 * Deliberately fixed and deterministic, not a variable schedule: a predictable
 * tick is a progress bar with marks on it, where an unpredictable one is the
 * reward loop docs/DESIGN.md § 3 exists to refuse. The answer is a dye front
 * wicking outward from the orb — continuous, no stinger — for the same reason.
 */
const MARKS = [25, 50, 75, 100];
/** How far presence must fall back before a mark can answer again. */
const REARM = 12;

/** How long the completion beat holds the screen before the end card. */
const BEAT_MS = 2100;

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
        // A breathe level shows no orb — dye from the middle of the cloth.
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

  const orbScale = (0.78 + orb.strength * 0.42).toFixed(3);
  const orbOpacity = (0.4 + orb.strength * 0.5).toFixed(2);

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

  return (
    <div className="snd-screen snd-screen-game" data-force={force}>
      <div className="snd-control-badge">
        steering · {gyroActive ? 'phone compass' : 'swipe'}
      </div>

      {level.control !== 'breathe' && (
        <div className="snd-voidfield" ref={dragzoneRef} data-depth={depth}>
          <div className="snd-drag-hint">
            {gyroActive ? 'turn your body or phone to steer' : '◂ swipe to turn ▸'}
          </div>
          <div className="snd-breath-word">{word}</div>
          <div
            ref={orbRef}
            className={`snd-orb${orb.notice ? ' snd-orb-notice' : ''}`}
            style={{ transform: `scale(${orbScale})`, opacity: orbOpacity }}
          />
          <div className="snd-presence-wrap">
            <TantuMeter value={presence} label="Presence" />
          </div>
        </div>
      )}

      {level.control !== 'breathe' && <div className="snd-heading-cue">{heading}</div>}

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
  );
}
