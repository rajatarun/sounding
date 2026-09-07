import { useEffect, useRef, useState } from 'react';
import { TantuButton, TantuCard, TantuNotice } from '@weaveaijs/tantu';

/**
 * Ear Calibration.
 *
 * The reference tone now comes from the game's own AudioEngine rather than a
 * private AudioContext wired straight to the destination. That old arrangement
 * asked the Seeker to set their volume against a sound the game never makes:
 * skipping the panner and master put it roughly 21.6 dB above any in-game cue
 * of the same nominal gain, so a correctly-followed calibration still left the
 * game far quieter than intended. See AudioEngine.calibrationTone.
 *
 * It is also positioned rather than mono now. The first sound this game plays
 * should demonstrate the thing the game is made of.
 */
export function CalibrationScreen({ audio, onDone }) {
  const [playing, setPlaying] = useState(false);
  const toneRef = useRef(null);

  function stop() {
    if (toneRef.current) {
      toneRef.current.stop();
      toneRef.current = null;
      // The engine is shared and every level re-inits it, so leaving a context
      // open here would be orphaned by the next init() rather than reused.
      audio.close();
    }
    setPlaying(false);
  }

  function toggle() {
    if (toneRef.current) { stop(); return; }
    toneRef.current = audio.calibrationTone();
    setPlaying(true);
  }

  useEffect(() => () => stop(), []);

  return (
    <div className="snd-screen snd-screen-centered">
      <TantuCard warpSpan={6} reliefLevel="zardozi" talimCode="EAR-CAL">
        <div className="snd-brief-label">Ear Calibration</div>
        <TantuNotice tone="info">
          Before engines, screens, or fans humming in every room, ears were
          trained by necessity — tuned to catch a snapped twig or a shift in
          wind against true silence.
          <br /><br />
          Find a room as quiet as you can. Put on headphones. Play the faint
          tone below, then <b>raise your device volume slowly</b> until it is
          just barely audible — present, but easy to lose if your mind wanders.
          <br /><br />
          It sits a little to one side. If it does not, check that your
          headphones are the right way round.
          <br /><br />
          That volume is correct for the whole experience. Louder defeats the
          point.
        </TantuNotice>
        <div className="snd-btnrow">
          <TantuButton onClick={toggle}>{playing ? 'Stop' : 'Play Faint Tone'}</TantuButton>
          <TantuButton variant="ghost" onClick={() => { stop(); onDone(); }}>Done — Return</TantuButton>
        </div>
      </TantuCard>
    </div>
  );
}
