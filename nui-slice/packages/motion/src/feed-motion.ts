/**
 * Feed-motion timings use the shared UI duration tokens for discrete
 * transitions; ambient loops remain authored values outside that scale.
 * Feed-motion family — волна XIV W4: движение ленты агента. Лента и её
 * данные строит W3 (local-agent FeedItem, copilot-паттерны); здесь спека
 * глаголов, длительностей и бюджета производительности. Значения
 * зеркалируют токен-шкалу 80/140/240/420/700/1400, CSS-дубли в
 * feed-motion.module.css (CSS не читает TS-пакет).
 *
 * Что уже существует и НЕ дублируется: StreamingText, ExpandRegion,
 * NestedReveal, BusyDot живут в @nexus/ui/motion-copilot (волна XII) —
 * W3 использует их для каретки потока и тела карточки, эта семья даёт
 * остальное: вход события, чекпоинт, режим, ожидание, прогресс, perf.
 *
 * Reduced-motion/snapshot → 0ms: события появляются мгновенно, пульсы
 * гаснут, но индикаторы остаются видимыми (это состояние, не декорация).
 */

import { DURATION_MS } from './presets';

/** Семантические глаголы ленты агента. */
export type FeedMotionVerb =
  | 'feedIn'     // 240ms — новое событие входит в ленту (fade+rise)
  | 'stream'     // 1200ms — каретка потокового вывода (мигание)
  | 'collapse'   // 240ms — тело карточки / вложенные вызовы (grid-rows)
  | 'checkpoint' // 420ms — маркер чекпоинта (отрисовка галки + gold-pulse)
  | 'mode'       // 140ms — быстрый сегмент-переход agent|ask|plan
  | 'wait'       // 1400ms — пульс «ждёт подтверждения»
  | 'runBar';    // 240ms fill / 1400ms shimmer — прогресс фонового прогона

export type FeedMotionEasing = 'launch' | 'glide' | 'dissolve' | 'pop';

export const FEED_MOTION_MS: Record<FeedMotionVerb, number> = {
  feedIn: 240,
  stream: 1200,
  collapse: DURATION_MS.normal,
  checkpoint: 420,
  mode: DURATION_MS.fast,
  wait: 1400,
  runBar: 240,
};

export const FEED_MOTION_EASING: Record<FeedMotionEasing, string> = {
  launch: 'cubic-bezier(0.22, 0.9, 0.35, 1)',
  glide: 'cubic-bezier(0.25, 0.7, 0.3, 1)',
  dissolve: 'cubic-bezier(0.35, 0.6, 0.4, 1)',
  pop: 'cubic-bezier(0.3, 0.9, 0.3, 1.15)',
};

export interface FeedMotionSpec {
  durationMs: number;
  easing: string;
  reduced: boolean;
}

export function feedMotion(
  verb: FeedMotionVerb,
  easing: FeedMotionEasing = 'launch',
  opts: { reducedMotion?: boolean; snapshot?: boolean } = {},
): FeedMotionSpec {
  const reduced = opts.reducedMotion === true || opts.snapshot === true;
  return {
    durationMs: reduced ? 0 : FEED_MOTION_MS[verb],
    easing: FEED_MOTION_EASING[easing],
    reduced,
  };
}

/**
 * Бюджет производительности ленты (бриф: замер fps и long tasks на
 * 500 событиях, виртуализация при превышении).
 *
 * - `minFps` — целевой низ; устойчивое падение ниже → виртуализация;
 * - `maxLongTasksPerWindow` — лимит long tasks (>50ms) за `windowMs`;
 * - `windowMs` — окно замера fps/long tasks;
 * - `virtualizeAfter` — жёсткий порог: count выше → окно всегда;
 * - `overscan` — запас строк окна в обе стороны.
 */
export const FEED_PERF_BUDGET = {
  minFps: 55,
  longTaskMs: 50,
  maxLongTasksPerWindow: 4,
  windowMs: 5000,
  virtualizeAfter: 150,
  overscan: 8,
} as const;

export interface FeedPerfAssessment {
  fps: number | null;
  longTasks: number | null;
  overBudget: boolean | null;
  availability: 'measured' | 'partial' | 'unavailable';
}

/** Evaluate only observed metrics; unsupported values remain unknown. */
export function assessFeedPerformance(
  fps: number | null,
  longTasks: number | null,
): FeedPerfAssessment {
  const hasFps = fps != null && Number.isFinite(fps);
  const hasLongTasks = longTasks != null && Number.isFinite(longTasks);
  const hasMetrics = hasFps || hasLongTasks;
  return {
    fps: hasFps ? fps : null,
    longTasks: hasLongTasks ? longTasks : null,
    overBudget: hasMetrics
      ? (hasFps && fps < FEED_PERF_BUDGET.minFps)
        || (hasLongTasks && longTasks > FEED_PERF_BUDGET.maxLongTasksPerWindow)
      : null,
    availability: hasFps && hasLongTasks ? 'measured' : hasMetrics ? 'partial' : 'unavailable',
  };
}

/**
 * Окно виртуализации ленты — чистая функция (тестируема без DOM).
 * Возвращает диапазон индексов и отступы-паддинги (px) для spacer-стиля.
 */
export interface FeedWindowInput {
  count: number;
  /** Типовая высота строки (px) — оценка, не точная мера. */
  rowHeight: number;
  /** scrollTop контейнера (px). */
  scrollTop: number;
  /** Видимая высота контейнера (px). */
  viewportHeight: number;
  overscan?: number;
}

export interface FeedWindow {
  /** Показывать ли окно вообще (false — лента короткая, окно не нужно). */
  active: boolean;
  start: number;
  end: number;
  topPad: number;
  bottomPad: number;
}

export function feedWindow(
  { count, rowHeight, scrollTop, viewportHeight, overscan = FEED_PERF_BUDGET.overscan }: FeedWindowInput,
  opts: { force?: boolean } = {},
): FeedWindow {
  const active = opts.force === true || count > FEED_PERF_BUDGET.virtualizeAfter;
  if (!active || count <= 0 || rowHeight <= 0 || viewportHeight <= 0) {
    return { active, start: 0, end: count - 1, topPad: 0, bottomPad: 0 };
  }
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visRows = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const last = Math.min(count - 1, first + visRows - 1);
  return {
    active,
    start: first,
    end: last,
    topPad: first * rowHeight,
    bottomPad: Math.max(0, (count - 1 - last) * rowHeight),
  };
}
