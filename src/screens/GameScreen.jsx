import { useEffect, useRef, useState } from 'react';
import { TantuButton, TantuMeter } from '@weaveaijs/tantu';

import { TRIAL_AUDIO_SCALE } from '../engine/constants.js';

function headingTextFor(steering) {
  const r = steering.relativeYaw;
  if (Math.abs(r) < 4) return 'facing forward';
  return r > 0 ? `turned ${Math.round(r)}° right` : `turned ${Math.round(-r)}° left`;
}

/**
 * GameScreen — the frame loop.
 *
 * Levels (src/levels/*.js) are plain, framework-agnostic objects — the same
 * ones the old vanilla runtime drove. Only the ui callbacks they receive
 * changed: they write into React state here instead of touching the DOM
 * directly, and the surrounding chrome (buttons, the presence meter) is
 * Tantu rather than hand-rolled CSS.
 */
export function GameScreen({ level, trial, gyroActive, audio, steering, onComplete }) {
  const [presence, setPresenceState] = useState(0);
  const [orb, setOrbState] = useState({ strength: 0, notice: false });
  const [word, setWordState] = useState('listening');
  const [heading, setHeading] = useState('facing forward');
  const [breatheHeld, setBreatheHeld] = useState(false);

  const levelStateRef = useRef({});
  const runningRef = useRef(false);
  const rafRef = useRef(null);
  const lastFrameRef = useRef(0);
  const elapsedRef = useRef(0);
  const flashTimeoutRef = useRef(null);
  const dragzoneRef = useRef(null);
  const commitRef = useRef(() => {});

  useEffect(() => {
    const state = levelStateRef.current;

    audio.init();
    audio.setAudioScale(TRIAL_AUDIO_SCALE[Math.min(trial, TRIAL_AUDIO_SCALE.length) - 1]);

    steering.reset();
    steering.onChange = () => {
      if (audio.ctx) audio.setListenerYaw(steering.yaw);
      if (runningRef.current) setHeading(headingTextFor(steering));
    };
    if (gyroActive) steering.enableGyro();

    const ui = {
      setPresence(v) { setPresenceState(Math.max(0, Math.min(100, v))); },
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
      onComplete(info);
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

    function onKeyDown(e) {
      if (!runningRef.current) return;
      if (e.key === 'ArrowLeft') steering.turn(-8);
      if (e.key === 'ArrowRight') steering.turn(8);
      if ((e.key === ' ' || e.key === 'Enter') && level.control === 'commit') tryCommit();
    }
    window.addEventListener('keydown', onKeyDown);

    function tryCommit() {
      if (!runningRef.current || !level.onCommit) return;
      level.onCommit(state, levelCtx());
    }
    // Exposed on a ref so the commit button (below) can reach the same
    // closure without re-deriving levelCtx.
    commitRef.current = tryCommit;

    return () => {
      runningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearTimeout(flashTimeoutRef.current);
      window.removeEventListener('keydown', onKeyDown);
      if (level.cleanup) { try { level.cleanup(state); } catch { /* noop */ } }
      audio.close();
      steering.disableGyro();
      steering.onChange = () => {};
    };
    // Mounted once per level+trial (see the `key` prop in App.jsx).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="snd-screen snd-screen-game">
      <div className="snd-control-badge">
        steering · {gyroActive ? 'phone compass' : 'swipe'}
      </div>

      {level.control !== 'breathe' && (
        <div className="snd-voidfield" ref={dragzoneRef}>
          <div className="snd-drag-hint">
            {gyroActive ? 'turn your body or phone to steer' : '◂ swipe to turn ▸'}
          </div>
          <div className="snd-breath-word">{word}</div>
          <div
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
