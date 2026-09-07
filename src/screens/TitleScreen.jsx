import {
  CapillaryBleedSurface, TantuAcousticToggle, TantuButton, TantuCard, TantuNaksha,
} from '@weaveaijs/tantu';

import { NARROWINGS, TRIALS_PER_LEVEL } from '../engine/constants.js';
import { isLevelComplete } from '../engine/progress.js';

/**
 * The hundred levels as one chart.
 *
 * This replaced a 100-row table with Begin/Locked tags, which read as an
 * admin panel rather than a journey. The band widths are the level counts —
 * 40/30/20/10 — so the 4:3:2:1 compression of the Narrowings is drawn by the
 * lattice itself rather than described in a caption, and a Seeker can see how
 * the shape of the thing changes before walking any of it.
 *
 * On the three states: `locked` covers the ninety levels that do not exist
 * yet *and* the built ones ahead of where the Seeker has reached. That second
 * part is a real behaviour change — the old table let you open any built
 * level in any order — and it is the honest mapping rather than a workaround:
 * the component offers locked/active/completed and nothing that means
 * "available but unvisited", because a fourth state is how a progress chart
 * starts smuggling in a score. Linear reach also matches the curriculum the
 * levels are actually written as; the Disciplines build on each other. If
 * free jumping is wanted back, `stateFor` below is the single place to change.
 */
function stateFor(level, id, progress) {
  if (!level) return 'locked';
  if (isLevelComplete(progress, id, TRIALS_PER_LEVEL)) return 'completed';
  if (id === progress.next.level) return 'active';
  return 'locked';
}

export function TitleScreen({ levels, progress, onCalibrate, onSelectLevel, onResume }) {
  const bands = NARROWINGS.map((era) => {
    const [from, to] = era.levels;
    return {
      id: `narrowing-${era.ordinal}`,
      label: era.name,
      // The game's own pacing word, straight from NARROWINGS — never a term
      // borrowed from the design system. See CLAUDE.md.
      note: era.pacing,
      nodes: Array.from({ length: to - from + 1 }, (_, i) => {
        const id = from + i;
        const level = levels[id];
        return {
          id: `level-${id}`,
          label: level ? `Level ${id}, ${level.name}` : `Level ${id}`,
          state: stateFor(level, id, progress),
        };
      }),
    };
  });

  /*
   * The one primary action, and it is always present.
   *
   * This used to render only for a returning Seeker (`progress.everPlayed`),
   * which left a genuine first run with no primary button at all: the only
   * button on the screen was the secondary "Calibrate Your Ears", and the way
   * into the game was discovering that exactly one square in a hundred — in a
   * chart where ninety-nine render locked — was tappable. The 100-row table
   * this chart replaced carried a solid accent "Begin" tag on level 1's row;
   * that affordance went out with the table rather than by decision. Restored.
   */
  const startLevel = levels[progress.next.level];
  const startLabel = progress.everPlayed
    ? `Continue — Level ${progress.next.level}, Trial ${progress.next.trial}`
    : `Begin — Level ${progress.next.level}, ${startLevel ? startLevel.name : ''}`;

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
            rather than letting the two vocabularies blend by default. */}
        <p className="snd-subtitle snd-frame-note">What you see is woven. What matters, you'll hear.</p>

        <div className="snd-btnrow">
          {startLevel && (
            <TantuButton variant="primary" onClick={onResume}>{startLabel}</TantuButton>
          )}
          <TantuButton variant="secondary" onClick={onCalibrate}>Calibrate Your Ears</TantuButton>
        </div>
      </CapillaryBleedSurface>

      <TantuCard warpSpan={12} reliefLevel="kanthi" talimCode="THE-HUNDRED" className="snd-naksha-card">
        <TantuNaksha
          label="The hundred levels"
          columns={10}
          bands={bands}
          currentId={`level-${progress.next.level}`}
          onSelect={(node) => onSelectLevel(Number(node.id.slice('level-'.length)))}
        />
        <p className="snd-naksha-note">
          Band widths are the level counts: the eras shrink as they go on, while
          the sittings get shorter and sharper. Nothing in the first two can be lost.
        </p>
      </TantuCard>

      {/* Tantu's own chrome sounds — not the game's cues — are muted by
          default and set once, here. */}
      <div className="snd-toolbar">
        <TantuAcousticToggle defaultMuted />
      </div>
    </div>
  );
}
