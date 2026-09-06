import {
  CapillaryBleedSurface, TantuAcousticToggle, TantuButton, TantuCard, TantuTable, TantuTag,
} from '@weaveaijs/tantu';

import { NARROWINGS, TRIALS_PER_LEVEL, narrowingFor } from '../engine/constants.js';
import { isLevelComplete, trialsDone } from '../engine/progress.js';

/**
 * The arc, shown before it is walked.
 *
 * The four Narrowings compress 4:3:2:1, and the widths here are that ratio —
 * so the shape of the whole hundred levels is legible on the first screen
 * rather than buried in a design document. This answers the honest question a
 * new Seeker has ("how long is this going to ask me to sit still?") without
 * putting a clock on any level, which is a thing the game never does.
 */
const ORDINALS = ['I', 'II', 'III', 'IV'];

function EraArc({ currentLevel }) {
  const here = narrowingFor(currentLevel);
  return (
    <div className="snd-arc">
      <div className="snd-arc-track" role="list" aria-label="The four Narrowings">
        {NARROWINGS.map((era) => {
          const span = era.levels[1] - era.levels[0] + 1;
          const isHere = here && here.ordinal === era.ordinal;
          return (
            <div
              key={era.ordinal}
              className="snd-arc-band"
              role="listitem"
              style={{ flexGrow: span }}
              data-here={isHere || undefined}
              data-fails={era.fails || undefined}
              /* The bands are proportional, so the narrowest is a quarter the
                 width of the widest and no name fits in it. The numeral and
                 the range are what the band shows; the full name goes to
                 assistive tech and to the legend underneath. */
              aria-label={`${era.name}, levels ${era.levels[0]} to ${era.levels[1]}, ${era.pacing}${isHere ? ' — you are here' : ''}`}
            >
              <span className="snd-arc-ordinal">{ORDINALS[era.ordinal - 1]}</span>
              <span className="snd-arc-span">{era.levels[0]}–{era.levels[1]}</span>
            </div>
          );
        })}
      </div>
      <p className="snd-arc-note">
        <b>I</b> The First Narrowing · <b>II</b> The Second · <b>III</b> The
        Third · <b>IV</b> The Fourth. The band widths are the level counts:
        they shrink as the eras go on, while the sittings get shorter and
        sharper. Nothing in the first two can be lost.
      </p>
    </div>
  );
}

export function TitleScreen({ levels, totalLevels, progress, onCalibrate, onSelectLevel, onResume }) {
  const rows = Array.from({ length: totalLevels }, (_, i) => i + 1).map((n) => ({
    n,
    level: levels[n] || null,
  }));

  const resumeLevel = levels[progress.next.level];
  const canResume = progress.everPlayed && resumeLevel;

  function statusFor(row) {
    if (!row.level) return { tone: 'neutral', label: 'Locked', solid: false, act: false };
    if (isLevelComplete(progress, row.n, TRIALS_PER_LEVEL)) {
      return { tone: 'success', label: 'Complete', solid: false, act: true };
    }
    const done = trialsDone(progress, row.n, TRIALS_PER_LEVEL);
    if (done > 0) {
      return { tone: 'zari', label: `Trial ${done + 1}`, solid: true, act: true };
    }
    return { tone: 'accent', label: 'Begin', solid: true, act: true };
  }

  return (
    <div className="snd-screen snd-screen-title">
      <CapillaryBleedSurface dye="zari" duration={1600} maxRadius={260} className="snd-hero">
        <div className="snd-eyebrow">The Unseen Vectors</div>
        <div className="snd-act">The First Narrowing</div>
        <h1 className="snd-title">SOUNDING</h1>
        <div className="snd-tagline">a practice of listening</div>
        <p className="snd-subtitle">
          Headphones, a silent room, and as much time as you need. Nothing here
          can be lost — only settled into.
        </p>
        {/* Said once, here, and never again: names the frame in plain English
            rather than letting the two vocabularies (SOUNDING's invented one,
            the loom underneath the screen) blend into each other by default.
            See CLAUDE.md's design-system integration note. */}
        <p className="snd-subtitle snd-frame-note">What you see is woven. What matters, you'll hear.</p>

        <div className="snd-btnrow">
          {canResume && (
            <TantuButton variant="primary" onClick={onResume}>
              Continue — Level {progress.next.level}, Trial {progress.next.trial}
            </TantuButton>
          )}
          <TantuButton variant="secondary" onClick={onCalibrate}>Calibrate Your Ears</TantuButton>
        </div>
      </CapillaryBleedSurface>

      <TantuCard warpSpan={12} reliefLevel="flat" talimCode="THE-ARC" className="snd-arc-card">
        <EraArc currentLevel={progress.next.level} />
      </TantuCard>

      <TantuCard warpSpan={12} reliefLevel="kanthi" talimCode="LEVEL-MAP" className="snd-levelmap-card">
        <TantuTable
          caption="Levels of the four Narrowings"
          rows={rows}
          rowKey={(row) => row.n}
          empty="No levels recorded."
          columns={[
            { key: 'num', header: '#', width: '3.5em', cell: (row) => String(row.n).padStart(2, '0') },
            {
              key: 'name',
              header: 'Level',
              cell: (row) => (row.level ? row.level.name : '·'),
            },
            {
              key: 'status',
              header: 'Status',
              width: '7em',
              cell: (row) => {
                const s = statusFor(row);
                if (!s.act) return <TantuTag tone={s.tone}>{s.label}</TantuTag>;
                return (
                  <TantuTag
                    tone={s.tone}
                    solid={s.solid}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectLevel(row.n)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onSelectLevel(row.n);
                    }}
                  >
                    {s.label}
                  </TantuTag>
                );
              },
            },
          ]}
        />
      </TantuCard>

      {/* Tantu's own chrome sounds — the shuttle and batten, not the game's
          cues — are muted by default and set once, here. It used to float
          over every screen, where it covered the level map on this one and
          the steering readout during a level; a set-once preference doesn't
          need to follow the Seeker into a dark room. */}
      <div className="snd-toolbar">
        <TantuAcousticToggle defaultMuted />
      </div>
    </div>
  );
}
