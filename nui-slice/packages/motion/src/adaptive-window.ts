/**
 * Adaptive-window family — волна XVII, задача 4: движение адаптивного
 * окна AGENT-A Бриф Yury 17.10: шире 1000px обычный вид; до 1000px
 * рельс сворачивается в иконки (72px); до 560px одна колонка с
 * горизонтальной полосой иконок сверху. Оболочку собирает W3
 * (задача 89-alice-window-shell) — здесь только примитивы движения:
 * ширина колонки рельса, видимость подписей, высота полосы иконок.
 * Всё на container queries + CSS-переходах, без JS-таймеров.
 *
 * Reduced-motion/snapshot → 0ms: режим переключается мгновенно —
 * точные ширины/высоты заданы классами, переходы только смягчают.
 * Значения согласованы с rail-motion (rail 240ms, tip 140ms).
 */

/** Брейкпоинты оболочки по ширине контейнера (px). */
export const ADAPTIVE_WINDOW_BREAKPOINTS = {
  /** >1000px — полный рельс; ≤1000px — рельс 72px с иконками. */
  iconsAt: 1000,
  /** ≤560px — одна колонка + горизонтальная полоса иконок. */
  singleAt: 560,
} as const;

/** Целевые размеры режимов (px). */
export const ADAPTIVE_WINDOW_SIZES = {
  railFullWidth: 240,
  railIconWidth: 72,
  stripHeight: 52,
} as const;

/** Семантические глаголы адаптивного окна. */
export type AdaptiveWindowVerb =
  | 'rail'    // 240ms — ширина колонки рельса full↔icons↔hidden
  | 'labels'  // 140ms — появление/гашение подписей пунктов
  | 'strip';  // 240ms — высота горизонтальной полосы иконок

export type AdaptiveWindowEasing = 'launch' | 'glide';

export const ADAPTIVE_WINDOW_MOTION_MS: Record<AdaptiveWindowVerb, number> = {
  rail: 240,
  labels: 140,
  strip: 240,
};

export const ADAPTIVE_WINDOW_EASING: Record<AdaptiveWindowEasing, string> = {
  launch: 'cubic-bezier(0.22, 0.9, 0.35, 1)',
  glide: 'cubic-bezier(0.25, 0.7, 0.3, 1)',
};

export interface AdaptiveWindowMotionSpec {
  durationMs: number;
  easing: string;
  reduced: boolean;
}

export function adaptiveWindowMotion(
  verb: AdaptiveWindowVerb,
  easing: AdaptiveWindowEasing = 'launch',
  opts: { reducedMotion?: boolean; snapshot?: boolean } = {},
): AdaptiveWindowMotionSpec {
  const reduced = opts.reducedMotion === true || opts.snapshot === true;
  return {
    durationMs: reduced ? 0 : ADAPTIVE_WINDOW_MOTION_MS[verb],
    easing: ADAPTIVE_WINDOW_EASING[easing],
    reduced,
  };
}
