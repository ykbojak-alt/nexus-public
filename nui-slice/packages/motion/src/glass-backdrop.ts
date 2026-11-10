/**
 * Glass backdrop contract (wave XVII, W4) — подложка под стеклянные бары.
 *
 * Только нецветовые токены: радиусы blur, прозрачности скрима/блика.
 * Цвета — `packages/themes` (`surface.glass`, `text.*`); здесь они не
 * переопределяются, а потребляются через var().
 *
 * Бюджет (perf-budgets.json → motion): ≤4 backdrop-filter-слоёв на экран —
 * поэтому подложка обходится НУЛЕМ backdrop-filter (арт размывается
 * собственным `filter: blur()`), а бары считаются отдельно продуктом.
 */

export const GLASS_BACKDROP = {
  /** Радиус живого размытия подложки: арт мягкий по построению (backalice),
   *  художественный blur держим умеренным — крупные радиусы дороги в
   *  software-raster (см. wave-XV-W4-motion-budget: 550мс кадры). */
  artBlurPx: 24,
  /** Blur демо-бара — зеркалит временный --nexus-glass-bar-blur из app-shell. */
  barBlurPx: 18,
  /** Скрим подложки к panel-цвету темы (тема сама решает: светлая —
   *  засветка, тёмная — затемнение). Одно значение на все схемы. */
  scrimAlpha: 0.34,
  /** Непрозрачность заливки бара; fallback без backdrop-filter — плотнее. */
  barAlpha: 0.62,
  barAlphaFallback: 0.88,
  /** Блик подложки: доля и угол диагонального sheen-градиента. */
  sheen: { alpha: 0.10, angleDeg: 105 },
  /** Дрейф блика — единственная анимация подложки; гасится reduced-motion. */
  sheenDriftMs: 14000,
  /** Бюджет из perf-budgets.json → motion.blurLayersMax. */
  maxBlurLayersPerScreen: 4,
} as const;

/** CSS custom properties, которые читает модуль. Имена стабильны —
 *  продукт может поднять их на :root, чтобы тонировать всю подложку. */
export const GLASS_BACKDROP_VARS = {
  artBlur: '--nexus-glass-backdrop-art-blur',
  scrim: '--nexus-glass-backdrop-scrim',
  sheenAlpha: '--nexus-glass-backdrop-sheen-alpha',
  sheenAngle: '--nexus-glass-backdrop-sheen-angle',
  sheenDuration: '--nexus-glass-backdrop-sheen-duration',
  barBlur: '--nexus-glass-bar-blur',
  barBg: '--nexus-glass-bar-bg',
  barBgStrong: '--nexus-glass-bar-bg-strong',
  barBorder: '--nexus-glass-bar-border',
} as const;

/**
 * WCAG-helpers для тестов и сториз. Композитинг скрима поверх арта идёт
 * в sRGB (как делает браузер), светимость — по формуле WCAG.
 * Каналы rgb — 0..1.
 */
export function compositeScrim(
  artRgb: readonly [number, number, number],
  scrimRgb: readonly [number, number, number],
  scrimAlpha: number,
): [number, number, number] {
  return [
    artRgb[0] * (1 - scrimAlpha) + scrimRgb[0] * scrimAlpha,
    artRgb[1] * (1 - scrimAlpha) + scrimRgb[1] * scrimAlpha,
    artRgb[2] * (1 - scrimAlpha) + scrimRgb[2] * scrimAlpha,
  ];
}

function channelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Относительная светимость WCAG 2.x для rgb 0..1. */
export function wcagLuminance(rgb: readonly [number, number, number]): number {
  return 0.2126 * channelToLinear(rgb[0])
    + 0.7152 * channelToLinear(rgb[1])
    + 0.0722 * channelToLinear(rgb[2]);
}

/** Контраст WCAG текста на подложке (art + scrim). */
export function contrastOnBackdrop(
  artRgb: readonly [number, number, number],
  scrimRgb: readonly [number, number, number],
  scrimAlpha: number,
  textRgb: readonly [number, number, number],
): number {
  const l1 = wcagLuminance(compositeScrim(artRgb, scrimRgb, scrimAlpha));
  const l2 = wcagLuminance(textRgb);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
