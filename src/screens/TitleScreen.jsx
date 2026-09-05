import { CapillaryBleedSurface, TantuButton, TantuCard, TantuTable, TantuTag } from '@weaveaijs/tantu';

export function TitleScreen({ levels, totalLevels, onCalibrate, onSelectLevel }) {
  const rows = Array.from({ length: totalLevels }, (_, i) => i + 1).map((n) => ({
    n,
    level: levels[n] || null,
  }));

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
        {/* Said once, here, and never again: names the frame in plain
            English rather than letting the two vocabularies (SOUNDING's
            invented one, the loom underneath the screen) blend into each
            other by default. See CLAUDE.md's design-system integration
            note for why this line exists and why it doesn't repeat. */}
        <p className="snd-subtitle snd-frame-note">What you see is woven. What matters, you'll hear.</p>
        <TantuButton variant="secondary" onClick={onCalibrate}>Calibrate Your Ears</TantuButton>
      </CapillaryBleedSurface>

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
              cell: (row) =>
                row.level ? (
                  <TantuTag
                    tone="accent"
                    solid
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectLevel(row.n)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onSelectLevel(row.n);
                    }}
                  >
                    Begin
                  </TantuTag>
                ) : (
                  <TantuTag tone="neutral">Locked</TantuTag>
                ),
            },
          ]}
        />
      </TantuCard>
    </div>
  );
}
