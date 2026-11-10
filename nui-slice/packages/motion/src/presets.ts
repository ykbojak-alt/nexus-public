/**
 * Motion presets — spec §10. Components consume presets and agent
 * signatures, never raw durations/easings. Values mirror
 * packages/tokens/src/primitives/motion.tokens.json; when the token
 * generator emits tokens.ts these literals are replaced by imports —
 * the scale itself (80/140/240/420/700) is contract-frozen.
 */

export type MotionDuration = 'instant' | 'fast' | 'normal' | 'slow' | 'cinematic';
export type MotionEasing = 'standard' | 'enter' | 'exit' | 'spring' | 'pop' | 'dissolve';

export const DURATION_MS: Record<MotionDuration, number> = {
  instant: 80,
  fast: 140,
  normal: 240,
  slow: 420,
  cinematic: 700,
};

export const EASING_BEZIER: Record<MotionEasing, readonly [number, number, number, number]> = {
  standard: [0.2, 0.0, 0.0, 1.0],
  enter: [0.0, 0.0, 0.2, 1.0],
  exit: [0.4, 0.0, 1.0, 1.0],
  spring: [0.34, 1.3, 0.4, 1.0],
  pop: [0.3, 0.9, 0.3, 1.15],
  dissolve: [0.35, 0.6, 0.4, 1.0],
};

export type MotionPresetName = 'micro' | 'panel' | 'spatial' | 'intelligence';

export interface MotionPreset {
  /** Animation style verbs allowed in this preset — reduced-motion strips transform-space verbs. */
  verbs: readonly string[];
  duration: MotionDuration;
  easing: MotionEasing;
}

/**
 * Four motion levels (spec §10):
 * micro — hover/focus/press affordances; panel — surfaces entering/leaving;
 * spatial — camera/depth/orbital movement; intelligence — agent/state energy.
 */
export const MOTION_PRESETS: Record<MotionPresetName, MotionPreset> = {
  micro: { verbs: ['fade', 'scale'], duration: 'instant', easing: 'standard' },
  panel: { verbs: ['fade', 'slide', 'scale'], duration: 'fast', easing: 'enter' },
  spatial: { verbs: ['fade', 'slide', 'orbit', 'camera'], duration: 'slow', easing: 'standard' },
  intelligence: { verbs: ['pulse', 'breathe', 'orbit', 'converge', 'glow'], duration: 'normal', easing: 'spring' },
};
