'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(fn: () => void): () => void {
  const mq = globalThis.matchMedia?.(QUERY);
  if (!mq) return () => {};
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}

function getSnapshot(): boolean {
  return globalThis.matchMedia?.(QUERY).matches === true;
}

/** True while the user agent requests reduced motion (spec §10 reduction contract). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
