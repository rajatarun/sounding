import { useEffect, useRef, useState } from 'react';
import { TantuButton, TantuCard, TantuNotice } from '@weaveaijs/tantu';

/**
 * Ear Calibration. The faint reference tone is synthesized the same way the
 * old vanilla build did it — a filtered brown-noise loop just above silence —
 * kept independent of the game's own AudioEngine so calibrating doesn't
 * require starting a level.
 */
export function CalibrationScreen({ onDone }) {
  const [playing, setPlaying] = useState(false);
  const ctxRef = useRef(null);

  function stop() {
    if (ctxRef.current) {
      try { ctxRef.current.close(); } catch { /* noop */ }
      ctxRef.current = null;
    }
    setPlaying(false);
  }

  function toggle() {
    if (ctxRef.current) { stop(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    ctxRef.current = ctx;

    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(1, sr * 3, sr);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }

    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 500; filt.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0.05;

    src.connect(filt); filt.connect(g); g.connect(ctx.destination);
    src.start();
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
