'use client';

import { useCallback, useState } from 'react';

/**
 * Shared window-manager z-order for NEWF floating layers.
 * All floating surfaces (FloatingPane, FloatingTerminal, future panes)
 * draw from ONE counter so focus-raise works across systems.
 */
let zCounter = 100;

export function nextZ(): number {
  return ++zCounter;
}

/** Current top — tests/observers. */
export function topZ(): number {
  return zCounter;
}

/**
 * Per-window z-order. Initial mount gets an increasing z (new window on top);
 * call `raise()` on pointerdown to bring the window to front.
 */
export function useZIndex(): { zIndex: number; raise: () => void } {
  const [z, setZ] = useState<number>(() => nextZ());
  const raise = useCallback(() => {
    setZ((current) => {
      const next = nextZ();
      return next > current ? next : current;
    });
  }, []);
  return { zIndex: z, raise };
}
