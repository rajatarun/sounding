import { useState } from 'react';
import { TantuButton, TantuCard, TantuToggle } from '@weaveaijs/tantu';

import { Steering } from '../engine/input.js';
import { TRIALS_PER_LEVEL } from '../engine/constants.js';

/**
 * How each trial is named to the Seeker.
 *
 * Never a number. An earlier build printed the literal clarity figure
 * ("~72% as clear"), which is a difficulty readout — exactly what
 * docs/DESIGN.md § Trials says this must never read as. The scaling itself is
 * unchanged; only the language is, because the language is the mechanic here.
 */
const TRIAL_VOICE = [
  'Full clarity. Take whatever time you need.',
  'Quieter now — a deeper kind of listening.',
  'Quieter still — the deepest listening of the three.',
];

export function BriefingScreen({ level, trial, firstEver, onBegin }) {
  const [useGyro, setUseGyro] = useState(true);
  const [starting, setStarting] = useState(false);

  const trialNote = TRIAL_VOICE[Math.min(trial, TRIAL_VOICE.length) - 1];

  async function handleBegin() {
    setStarting(true);
    let gyro = false;
    if (level.control !== 'breathe' && useGyro) {
      gyro = await Steering.requestPermission();
    }
    onBegin({ gyro });
  }

  return (
    <div className="snd-screen snd-screen-centered">
      <TantuCard
        warpSpan={6}
        reliefLevel="zardozi"
        talimCode={`LVL-${level.id}`}
        className="snd-brief-card"
        data-trial={trial}
      >
        <div className="snd-brief-label">
          Level {level.id} · {level.name} — Trial {trial} of {TRIALS_PER_LEVEL}
        </div>

        {/* The plain instruction first, the atmosphere second. A first-time
            Seeker should never have to infer the verb from the prose. */}
        {level.actionLine && firstEver && (
          <p className="snd-action-line">{level.actionLine}</p>
        )}

        <div
          className="snd-brief-text"
          dangerouslySetInnerHTML={{ __html: level.briefing }}
        />
        <p className="snd-trial-note">{trialNote}</p>

        {level.control !== 'breathe' && (
          <label className="snd-toggle-row">
            <TantuToggle
              variant="switch"
              checked={useGyro}
              onChange={(e) => setUseGyro(e.target.checked)}
            >
              Turn by moving your phone (compass)
            </TantuToggle>
            <div className="snd-toggle-note">
              Falls back to swipe automatically if unavailable or denied.
            </div>
          </label>
        )}

        <TantuButton variant="secondary" disabled={starting} onClick={handleBegin}>
          Begin, Unhurried
        </TantuButton>
      </TantuCard>
    </div>
  );
}
