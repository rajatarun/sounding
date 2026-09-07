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
import { LEVELS, BUILT_IDS } from './levels/registry.js';
import {
  loadProgress, saveProgress, completeTrial, nextTrialFor,
  newlyRevealedDiscipline, markRevealed, enterTrial, hasPractisedControl,
} from './engine/progress.js';

import { LoomSubstrate } from './components/LoomSubstrate.jsx';
import { TitleScreen } from './screens/TitleScreen.jsx';
import { CalibrationScreen } from './screens/CalibrationScreen.jsx';
import { BriefingScreen } from './screens/BriefingScreen.jsx';
import { GameScreen } from './screens/GameScreen.jsx';
import { EndScreen } from './screens/EndScreen.jsx';

export function App() {
  const [screen, setScreen] = useState('title');
  const [progress, setProgress] = useState(loadProgress);
  const [currentLevel, setCurrentLevel] = useState(progress.next.level);
  const [trial, setTrial] = useState(progress.next.trial);
  const [gyroActive, setGyroActive] = useState(false);
  const [endInfo, setEndInfo] = useState(null);
  // Whether the trial currently being played is the first one this Seeker has
  // ever entered. Snapshotted at entry rather than derived, because entering
  // is now what retires the flag — see beginLevel.
  const [runFirstEver, setRunFirstEver] = useState(false);

  // The engine instances live for the app's whole life — recreating an
  // AudioContext per level would just add startup latency for no reason.
  const audioRef = useRef(null);
  if (!audioRef.current) audioRef.current = new AudioEngine();
  const steeringRef = useRef(null);
  if (!steeringRef.current) steeringRef.current = new Steering();

  const level = LEVELS[currentLevel];
  // The plain verb is shown the first time each control scheme is met, not
  // only on the first trial ever — the schemes change at levels 1, 2 and 4.
  const showActionLine = Boolean(level)
    && !hasPractisedControl(progress, LEVELS, level.control, TRIALS_PER_LEVEL);

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
    // Entering a trial is what retires the onboarding scaffolding, so take the
    // reading before marking it. `everPlayed` used to be set only on success,
    // which meant a Seeker who never finished one kept the level-1 seeding
    // indefinitely — CLAUDE.md documents that assist as never happening again.
    // It also means the title screen offers Continue the moment anyone begins.
    setRunFirstEver(!progress.everPlayed);
    persist(enterTrial(progress));
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
          <CalibrationScreen audio={audioRef.current} onDone={() => setScreen('title')} />
        )}

        {screen === 'briefing' && level && (
          <BriefingScreen
            level={level}
            trial={trial}
            showActionLine={showActionLine}
            onBegin={beginLevel}
          />
        )}

        {screen === 'game' && level && (
          <GameScreen
            key={`${currentLevel}-${trial}`}
            level={level}
            trial={trial}
            firstEver={runFirstEver}
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
