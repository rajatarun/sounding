import { createContext, useContext, useMemo } from 'react';
import { useCapillaryBleed, bleedMotionAllowed } from '@weaveaijs/tantu';

/**
 * The loom substrate, and a way for the game to write on it.
 *
 * This is Tantu's `useCapillaryBleed` driven directly rather than through the
 * `TantuBleedCanvas` wrapper, for one reason: the wrapper never forwards the
 * engine's `bleed(x, y)` handle out, so nothing outside it can start a dye
 * front. The engine underneath has always taken raw coordinates — a dye front
 * is not inherently a response to a pointer — so the substrate here answers
 * both the reader's touch (`onContact`) and the game's own milestones, through
 * `pulse()`.
 *
 * The canvas is fixed, full-viewport and `pointer-events: none` (Tantu's own
 * `.tantu-loom-substrate` class), so canvas-local coordinates and client
 * coordinates are the same thing — an element's `getBoundingClientRect()`
 * centre can be handed straight to `pulse()`.
 */
const SubstrateContext = createContext({ pulse: () => {} });

export const useSubstrate = () => useContext(SubstrateContext);

export function LoomSubstrate({ children, dye = '#2b5377' }) {
  const { canvasRef, bleed } = useCapillaryBleed({
    global: true,
    onContact: true,
    trailInterval: 0,
    dye,
    duration: 2600,
    maxRadius: 520,
    fray: 1,
    saturation: 0.35,
  });

  const value = useMemo(() => ({
    /**
     * Wick dye outward from a point in viewport coordinates.
     *
     * A gameplay pulse has no gesture behind it, so there is nothing for the
     * bleed bus to arbitrate — but reduced motion still applies, and it is
     * checked here so every caller honours it without having to remember to.
     */
    pulse(x, y) {
      if (!bleedMotionAllowed()) return;
      bleed(x, y);
    },
  }), [bleed]);

  return (
    <SubstrateContext.Provider value={value}>
      <canvas ref={canvasRef} aria-hidden="true" className="tantu-loom-substrate" />
      {children}
    </SubstrateContext.Provider>
  );
}
