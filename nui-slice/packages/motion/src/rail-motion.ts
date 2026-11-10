/**
 * Rail-motion family — волна XIV W4: движение узкой иконочной полосы
 * (strip-режим левой панели, strip строит W3) и стаггер-колоды карточек
 * выбора ассистента. Авторская полоса как у game/boot-motion: бриф задаёт
 * сворачивание/раскрытие 180–240ms — `rail` взят 240ms = токен normal
 * (совпадает с шириной-переходом колонки WindowFrame); значения
 * зеркалируют токены,
 * CSS-дубли в rail-motion.module.css (CSS не читает TS-пакет).
 *
 * Reduced-motion/snapshot → 0ms: полоса переключается мгновенно,
 * подписи остаются доступными (tooltip виден без задержки — это
 * контент, не декорация).
 */

/** Семантические глаголы иконочной полосы и колоды персон. */
export type RailMotionVerb =
  | 'rail'     // 240ms — ширина колонки strip↔full (полоса 180–240 из брифа)
  | 'railOut'  // 140ms — exit-окно keep-alive рейла (W4-1012, →hidden)
  | 'marker'   // 200ms — золотая кромка активного раздела
  | 'tip'      // 140ms — всплывающая подпись иконки
  | 'deck';    // 240ms — стаггер-появление карточки в колоде выбора

export type RailMotionEasing = 'launch' | 'glide' | 'dissolve' | 'pop';

export const RAIL_MOTION_MS: Record<RailMotionVerb, number> = {
  rail: 240,
  railOut: 140,
  marker: 200,
  tip: 140,
  deck: 240,
};

export const RAIL_MOTION_EASING: Record<RailMotionEasing, string> = {
  launch: 'cubic-bezier(0.22, 0.9, 0.35, 1)',
  glide: 'cubic-bezier(0.25, 0.7, 0.3, 1)',
  dissolve: 'cubic-bezier(0.35, 0.6, 0.4, 1)',
  pop: 'cubic-bezier(0.3, 0.9, 0.3, 1.15)',
};

export interface RailMotionSpec {
  durationMs: number;
  easing: string;
  reduced: boolean;
}

export function railMotion(
  verb: RailMotionVerb,
  easing: RailMotionEasing = 'launch',
  opts: { reducedMotion?: boolean; snapshot?: boolean } = {},
): RailMotionSpec {
  const reduced = opts.reducedMotion === true || opts.snapshot === true;
  return {
    durationMs: reduced ? 0 : RAIL_MOTION_MS[verb],
    easing: RAIL_MOTION_EASING[easing],
    reduced,
  };
}
