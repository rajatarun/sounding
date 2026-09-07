/**
 * App.jsx — Runtime shell.
 *
 * Screens, level/trial state, the engine instances, and the resume point.
 * Dressed in Tantu — the loom substrate, the selvedge shuttle, cards, buttons,
 * meters — rather than hand-rolled CSS.
 */
import { useRef, useState } from 'react';
import { TantuLoom } from '@weaveaijs/tantu';

import { AudioEngine } from './engine/audio.js';
import { Steering } from './engine/input.js';
import { TRIALS_PER_LEVEL } from './engine/constants.js';
import { FIRST_NARROWING } from './levels/first-narrowing.js';
import {
  loadProgress, saveProgress, completeTrial, nextTrialFor,
  newlyRevealedDiscipline, markRevealed,
} from './engine/progress.js';

import { LoomSubstrate } from './components/LoomSubstrate.jsx';
import { TitleScreen } from './screens/TitleScreen.jsx';
import { CalibrationScreen } from './screens/CalibrationScreen.jsx';
import { BriefingScreen } from './screens/BriefingScreen.jsx';
import { GameScreen } from './screens/GameScreen.jsx';
import { EndScreen } from './screens/EndScreen.jsx';

const LEVELS = {};
FIRST_NARROWING.forEach((lv) => { LEVELS[lv.id] = lv; });
const BUILT_IDS = FIRST_NARROWING.map((lv) => lv.id).sort((a, b) => a - b);

export function App() {
  const [screen, setScreen] = useState('title');
  const [progress, setProgress] = useState(loadProgress);
  const [currentLevel, setCurrentLevel] = useState(progress.next.level);
  const [trial, setTrial] = useState(progress.next.trial);
  const [gyroActive, setGyroActive] = useState(false);
  const [endInfo, setEndInfo] = useState(null);

  // The engine instances live for the app's whole life — recreating an
  // AudioContext per level would just add startup latency for no reason.
  const audioRef = useRef(null);
  if (!audioRef.current) audioRef.current = new AudioEngine();
  const steeringRef = useRef(null);
  if (!steeringRef.current) steeringRef.current = new Steering();

  const level = LEVELS[currentLevel];
  // The very first trial anyone ever plays gets onboarding scaffolding that
  // never appears again. See first-narrowing.js's level 1.
  const firstEver = !progress.everPlayed;

  function persist(next) {
    setProgress(next);
    saveProgress(next);
    return next;
  }

  /** Open a level at the first trial not yet finished — never re-earned. */
  function openLevel(id) {
    setCurrentLevel(id);
    setTrial(nextTrialFor(progress, id, TRIALS_PER_LEVEL));
    setScreen('briefing');
  }

  function resumeSession() {
    setCurrentLevel(progress.next.level);
    setTrial(progress.next.trial);
    setScreen('briefing');
  }

  function beginLevel({ gyro }) {
    setGyroActive(gyro);
    setScreen('game');
  }

  function completeLevel(info) {
    let next = completeTrial(progress, currentLevel, trial, {
      trialsPerLevel: TRIALS_PER_LEVEL,
      builtIds: BUILT_IDS,
    });

    // A Discipline is named only once every built level that practices it is
    // finished — five moments across the ten built levels, deterministic and
    // never random. See docs/DESIGN.md § Progression as curriculum.
    const discipline = newlyRevealedDiscipline(next, LEVELS, TRIALS_PER_LEVEL);
    if (discipline) next = markRevealed(next, discipline.name);
    persist(next);

    setEndInfo({ ...info, discipline });
    setScreen('end');
  }

  function retry() { setScreen('briefing'); }

  function continueNext() {
    setCurrentLevel(progress.next.level);
    setTrial(progress.next.trial);
    setScreen('briefing');
  }

  const hasNext = trial < TRIALS_PER_LEVEL || Boolean(LEVELS[currentLevel + 1]);

  return (
    <LoomSubstrate>
      <TantuLoom viewTalimCode={`SOUNDING-${String(currentLevel).padStart(2, '0')}`} shuttle>
        {screen === 'title' && (
          <TitleScreen
            levels={LEVELS}
            progress={progress}
            onCalibrate={() => setScreen('calibration')}
            onSelectLevel={openLevel}
            onResume={resumeSession}
          />
        )}

        {screen === 'calibration' && (
          <CalibrationScreen onDone={() => setScreen('title')} />
        )}

        {screen === 'briefing' && level && (
          <BriefingScreen level={level} trial={trial} firstEver={firstEver} onBegin={beginLevel} />
        )}

        {screen === 'game' && level && (
          <GameScreen
            key={`${currentLevel}-${trial}`}
            level={level}
            trial={trial}
            firstEver={firstEver}
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
    </LoomSubstrate>
  );
}
