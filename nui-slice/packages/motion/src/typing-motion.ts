import { EASING_BEZIER } from './presets';

/** Typing dots use the existing motion.pulse semantic token (1100ms). */
export const TYPING_MOTION_MS = 1100;
export const TYPING_MOTION_EASING = `cubic-bezier(${EASING_BEZIER.enter.join(', ')})`;

export interface TypingMotionSpec {
  durationMs: number;
  easing: string;
  reduced: boolean;
  iterations: 'infinite';
}

export function typingMotion(opts: { reducedMotion?: boolean; snapshot?: boolean } = {}): TypingMotionSpec {
  const reduced = opts.reducedMotion === true || opts.snapshot === true;
  return {
    durationMs: reduced ? 0 : TYPING_MOTION_MS,
    easing: TYPING_MOTION_EASING,
    reduced,
    iterations: 'infinite',
  };
}
