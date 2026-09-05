import { TantuButton, TantuCard, ChambaRumalCard } from '@weaveaijs/tantu';
import { TRIALS_PER_LEVEL } from '../engine/constants.js';

/**
 * EndScreen — the close of a trial, and occasionally something rarer.
 *
 * Two beats live in this app and they are deliberately different sizes. The
 * frequent one (every trial) is the thread snapping taut, back in GameScreen.
 * The rare one is here: five times across the ten built levels, when every
 * level practising a Discipline is finished, the Discipline is finally named —
 * on a card the Seeker turns over themselves. Scarcity is the whole value of
 * it, so it must not look like the small beat wearing a hat.
 */
export function EndScreen({ info, trial, hasNext, onRetry, onContinue }) {
  return (
    <div className="snd-screen snd-screen-centered">
      {info.discipline && (
        <ChambaRumalCard
          warpSpan={6}
          className="snd-reveal"
          flipLabel="Turn it over"
          backLabel="Turn it back"
          obverse={(
            <div className="snd-reveal-face">
              <div className="snd-reveal-eyebrow">Something has been practised</div>
              <p className="snd-reveal-lede">
                Not taught, and never named until now — you have been doing it
                since the first dark room.
              </p>
            </div>
          )}
          reverse={(
            <div className="snd-reveal-face">
              <div className="snd-reveal-eyebrow">You have been practising</div>
              <h2 className="snd-reveal-name">{info.discipline.name}</h2>
              <p className="snd-reveal-op">{info.discipline.op}</p>
            </div>
          )}
        />
      )}

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
