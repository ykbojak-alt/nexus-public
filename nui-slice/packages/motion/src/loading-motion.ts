import { DURATION_MS, EASING_BEZIER } from './presets';

/**
 * Loading motion (W4-1013): единый набор для состояний загрузки —
 * спиннеры, skeleton-shimmer, детерминированный прогресс и
 * неопределённый пульс.
 *
 * - `spinner` — inline-вращение (кнопка `nexus-spin`, `statusSpin`,
 *   `.runSpin`, `.micSpin`). 420ms `slow` — канонический оборот;
 *   кривая `linear` (вращение не сглаживается).
 * - `shimmer` — ambient-свип скелетона (`nexus-skeleton-shimmer`) и
 *   родственных фоновых волн. 1600ms = authored-ambient `motion.glow`;
 *   кривая `linear` — постоянная скорость свипа, infinite.
 * - `progressBar` — детерминированный заполнитель (`width`/`stroke`
 *   transition на `.progressFill`, `.budgetBarFill`, BootProgress fill).
 *   240ms `normal` / `standard`; `iterations: 'once'` — каждый шаг.
 * - `pulse` — неопределённый «живой» индикатор (`.loadingDot`,
 *   `warmStepDot`, `statusPulse`). 1100ms = authored-ambient
 *   `motion.pulse`; `ease-in-out` — симметричное дыхание, infinite.
 *
 * Reduced-motion/snapshot → 0ms: CSS-сторона живёт в
 * `prefers-reduced-motion: reduce`/`no-preference` блоках — индикаторы
 * остаются видимыми статикой (точка, кольцо, заполненная доля), без
 * промежуточных кадров.
 */
export type LoadingMotionVerb =
  | 'spinner'
  | 'shimmer'
  | 'progressBar'
  | 'pulse';

export const LOADING_MOTION_MS: Record<LoadingMotionVerb, number> = {
  spinner: DURATION_MS.slow,
  shimmer: 1600, // authored ambient — motion.glow value mirror
  progressBar: DURATION_MS.normal,
  pulse: 1100, // authored ambient — motion.pulse value mirror
};

export const LOADING_MOTION_EASING: Record<LoadingMotionVerb, string> = {
  spinner: 'linear',
  shimmer: 'linear',
  progressBar: `cubic-bezier(${EASING_BEZIER.standard.join(', ')})`,
  pulse: 'ease-in-out',
};

const LOADING_MOTION_ITERATIONS: Record<LoadingMotionVerb, 'once' | 'infinite'> = {
  spinner: 'infinite',
  shimmer: 'infinite',
  progressBar: 'once',
  pulse: 'infinite',
};

export interface LoadingMotionSpec {
  durationMs: number;
  delayMs: number;
  easing: string;
  reduced: boolean;
  iterations: 'once' | 'infinite';
}

export function loadingMotion(
  verb: LoadingMotionVerb,
  opts: { reducedMotion?: boolean; snapshot?: boolean } = {},
): LoadingMotionSpec {
  const reduced = opts.reducedMotion === true || opts.snapshot === true;
  return {
    durationMs: reduced ? 0 : LOADING_MOTION_MS[verb],
    delayMs: 0,
    easing: LOADING_MOTION_EASING[verb],
    reduced,
    iterations: LOADING_MOTION_ITERATIONS[verb],
  };
}
