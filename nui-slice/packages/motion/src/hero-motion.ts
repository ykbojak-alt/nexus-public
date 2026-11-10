/**
 * Hero & KPI-strip motion contract (wave XVII, W4) — главная по main2/main7.
 *
 * Глаголы:
 * - heroIn   — появление героя: fade+rise 640ms, одно проигрывание;
 * - breathe  — медленное «дыхание» света поверх героя 9.6s alternate,
 *              только opacity; бесконечное, но медленное (бриф запрещает
 *              быстрые зацикленные петли, а не дыхание);
 * - kpiIn    — появление карточки KPI-полосы 420ms, стаггер 70ms;
 * - kpiValue — столбец значения растёт один раз 700ms (scaleX), НЕ цикл.
 *
 * Данные KPI всегда приходят пропсами от продукта — модуль значений
 * не знает и не рисует.
 */

export type HeroMotionVerb = 'heroIn' | 'breathe' | 'kpiIn' | 'kpiValue';

export const HERO_MOTION_MS = {
  heroIn: 640,
  breathe: 9600,
  kpiIn: 420,
  kpiValue: 700,
  kpiStaggerMs: 70,
} as const;

export const HERO_MOTION_EASING = 'cubic-bezier(0.22, 0.9, 0.35, 1)';

export interface HeroMotionSpec {
  durationMs: number;
  easing: string;
  reduced: boolean;
  /** infinite только у breathe; входные глаголы — single-run. */
  iterations: 'once' | 'infinite';
  /** Только композитные свойства — layout не трогаем. */
  properties: readonly string[];
}

export function heroMotion(
  verb: HeroMotionVerb,
  opts: { reducedMotion?: boolean; snapshot?: boolean } = {},
): HeroMotionSpec {
  const reduced = opts.reducedMotion === true || opts.snapshot === true;
  const infinite = verb === 'breathe';
  return {
    durationMs: reduced ? 0 : HERO_MOTION_MS[verb],
    easing: HERO_MOTION_EASING,
    reduced,
    iterations: infinite && !reduced ? 'infinite' : 'once',
    properties:
      verb === 'kpiValue'
        ? ['transform']
        : verb === 'breathe'
          ? ['opacity']
          : ['opacity', 'transform'],
  };
}
