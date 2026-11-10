/**
 * prefers-reduced-motion detection — injectable-safe like detectWebGL.
 * Components default to the media query; the `reducedMotion` prop is
 * an explicit override (harness stubs matchMedia in ReducedMotionDecorator).
 */

export function prefersReducedMotion(queryFn?: (q: string) => { matches: boolean }): boolean {
  const fn = queryFn ?? (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : undefined);
  if (!fn) return false;
  try {
    return fn('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Resolve effective reduced-motion flag: explicit prop wins, else media query. */
export function resolveReducedMotion(override?: boolean): boolean {
  return override ?? prefersReducedMotion();
}
