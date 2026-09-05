/**
 * App.jsx — Runtime shell.
 *
 * Same responsibility the old main.js carried (screens, level/trial state,
 * the engine instances) rewritten around React state instead of direct DOM
 * writes, and dressed in Tantu — the loom substrate, the selvedge shuttle,
 * cards, buttons, meters — rather than hand-rolled CSS.
 */
import { useMemo, useRef, useState } from 'react';
import { TantuLoom, TantuBleedCanvas, TantuAcousticToggle } from '@weaveaijs/tantu';

import { AudioEngine } from './engine/audio.js';
import { Steering } from './engine/input.js';
import { TRIALS_PER_LEVEL } from './engine/constants.js';
import { FIRST_NARROWING } from './levels/first-narrowing.js';

import { TitleScreen } from './screens/TitleScreen.jsx';
import { CalibrationScreen } from './screens/CalibrationScreen.jsx';
import { BriefingScreen } from './screens/BriefingScreen.jsx';
import { GameScreen } from './screens/GameScreen.jsx';
import { EndScreen } from './screens/EndScreen.jsx';

const TOTAL_LEVELS = 100;
const LEVELS = {};
FIRST_NARROWING.forEach((lv) => { LEVELS[lv.id] = lv; });

export function App() {
  const [screen, setScreen] = useState('title');
  const [currentLevel, setCurrentLevel] = useState(1);
  const [trial, setTrial] = useState(1);
  const [gyroActive, setGyroActive] = useState(false);
  const [endInfo, setEndInfo] = useState(null);

  // The engine instances live for the app's whole life — recreating an
  // AudioContext per level would just add startup latency for no reason.
  const audioRef = useRef(null);
  if (!audioRef.current) audioRef.current = new AudioEngine();
  const steeringRef = useRef(null);
  if (!steeringRef.current) steeringRef.current = new Steering();

  const level = LEVELS[currentLevel];

  function openBriefing(id) {
    setCurrentLevel(id);
    setScreen('briefing');
  }

  function beginLevel({ gyro }) {
    setGyroActive(gyro);
    setScreen('game');
  }

  function completeLevel(info) {
    setEndInfo(info);
    setScreen('end');
  }

  function retry() {
    setScreen('briefing');
  }

  function continueNext() {
    if (trial < TRIALS_PER_LEVEL) {
      setTrial((t) => t + 1);
    } else {
      setTrial(1);
      setCurrentLevel((id) => id + 1);
    }
    setScreen('briefing');
  }

  const hasNext = trial < TRIALS_PER_LEVEL || Boolean(LEVELS[currentLevel + 1]);

  return (
    <TantuLoom viewTalimCode={`SOUNDING-${String(currentLevel).padStart(2, '0')}`} shuttle>
      {/* The loom's own substrate — dye wicks outward from every touch,
          resting behind everything else in the game. */}
      <TantuBleedCanvas dye="#2b5377" trailInterval={0} maxRadius={520} saturation={0.35} />

      <div className="snd-toolbar">
        {/* Muted by default (Tantu's own default): SOUNDING's whole mechanic
            is audio mixed to sit at the edge of perceptibility, and Tantu's
            decorative loom sounds (shuttle clacks, batten strikes) are a
            second, unrelated audio system with the opposite goal — audible
            by design. A player who hasn't explicitly asked for them should
            never hear them layered under gameplay audio. */}
        <TantuAcousticToggle defaultMuted />
      </div>

      {screen === 'title' && (
        <TitleScreen
          levels={LEVELS}
          totalLevels={TOTAL_LEVELS}
          onCalibrate={() => setScreen('calibration')}
          onSelectLevel={(id) => { setTrial(1); openBriefing(id); }}
        />
      )}

      {screen === 'calibration' && (
        <CalibrationScreen onDone={() => setScreen('title')} />
      )}

      {screen === 'briefing' && level && (
        <BriefingScreen level={level} trial={trial} onBegin={beginLevel} />
      )}

      {screen === 'game' && level && (
        <GameScreen
          key={`${currentLevel}-${trial}`}
          level={level}
          trial={trial}
          gyroActive={gyroActive}
          audio={audioRef.current}
          steering={steeringRef.current}
          onComplete={completeLevel}
        />
      )}

      {screen === 'end' && endInfo && (
        <EndScreen
          info={endInfo}
          trial={trial}
          hasNext={hasNext}
          onRetry={retry}
          onContinue={continueNext}
        />
      )}
    </TantuLoom>
  );
}
