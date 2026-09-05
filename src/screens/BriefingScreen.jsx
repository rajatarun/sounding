import { useState } from 'react';
import { TantuButton, TantuCard, TantuToggle } from '@weaveaijs/tantu';

import { Steering } from '../engine/input.js';
import { TRIALS_PER_LEVEL, TRIAL_AUDIO_SCALE } from '../engine/constants.js';

export function BriefingScreen({ level, trial, onBegin }) {
  const [useGyro, setUseGyro] = useState(true);
  const [starting, setStarting] = useState(false);

  const pct = Math.round(TRIAL_AUDIO_SCALE[trial - 1] * 100);
  const trialNote = trial === 1
    ? `Trial 1 of ${TRIALS_PER_LEVEL} — full clarity. Take whatever time you need.`
    : `Trial ${trial} of ${TRIALS_PER_LEVEL} — quieter now (~${pct}% as clear). A deeper kind of listening.`;

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
      <TantuCard warpSpan={6} reliefLevel="zardozi" talimCode={`LVL-${level.id}`}>
        <div className="snd-brief-label">
          Level {level.id} · {level.name} — Trial {trial} of {TRIALS_PER_LEVEL}
        </div>
        <div
          className="snd-brief-text"
          dangerouslySetInnerHTML={{ __html: `${level.briefing}<br /><br /><i>${trialNote}</i>` }}
        />
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
