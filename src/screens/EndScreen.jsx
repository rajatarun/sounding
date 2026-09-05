import { TantuButton, TantuCard } from '@weaveaijs/tantu';
import { TRIALS_PER_LEVEL } from '../engine/constants.js';

export function EndScreen({ info, trial, hasNext, onRetry, onContinue }) {
  return (
    <div className="snd-screen snd-screen-centered">
      <TantuCard warpSpan={6} reliefLevel="zardozi" talimCode="END">
        <div className="snd-end-glyph">STILLNESS FOUND</div>
        <p className="snd-end-text">{info.text}</p>
        <p className="snd-end-sub">
          Trial {trial} of {TRIALS_PER_LEVEL} complete. {info.sub}
        </p>
        <div className="snd-btnrow">
          <TantuButton variant="ghost" onClick={onRetry}>Sit With This Again</TantuButton>
          {hasNext && (
            <TantuButton variant="secondary" onClick={onContinue}>
              {trial < TRIALS_PER_LEVEL ? 'Continue, Quieter Still' : 'Continue'}
            </TantuButton>
          )}
        </div>
      </TantuCard>
    </div>
  );
}
