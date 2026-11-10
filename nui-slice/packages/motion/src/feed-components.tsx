import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import {
  FEED_PERF_BUDGET, assessFeedPerformance, feedWindow,
  type FeedPerfAssessment, type FeedWindow,
} from './feed-motion';
import styles from './feed-motion.module.css';

/**
 * Feed-моушн-компоненты (волна XIV, W4) — визуальный слой ленты агента.
 * Разметка/данные ленты — W3 (local-agent FeedItem и copilot-паттерны);
 * здесь только движение. Спека — `feed-motion.ts`; prefers-reduced-motion
 * гасится CSS-блоком модуля, snapshot — пропом `animated={false}`.
 *
 * Уже существующее (не дублируем): StreamingText, ExpandRegion,
 * NestedReveal, BusyDot — `@nexus/ui` (motion-copilot). W3 подключает
 * их для каретки потока и раскрытия карточки.
 *
 * Подключение (для W3):
 *  - вход события: `<FeedItemIn>` вокруг каждого нового FeedItem
 *    (стаггер только у хвоста — индекс ограничить до 4);
 *  - потоковый вывод: `<StreamingText text active>` из @nexus/ui;
 *  - раскрытие карточки/вложенные: `<ExpandRegion>` + `<NestedReveal>`;
 *  - чекпоинт: `<CheckpointMark />` рядом с checkpoint-событием
 *    (галка дорисовывается 420ms, золотое кольцо гаснет);
 *  - режим: `<ModePill modes value />` — быстрый бегунок использует duration.fast;
 *  - ожидание подтверждения: `<WaitMark active label="ждёт подтверждения" />`
 *    (пульс 1400ms, aria-live polite);
 *  - фоновый прогон: `<RunBar value={0..1|null} />` — null = неизвестная
 *    доля → честный shimmer, без выдуманного прогресса;
 *  - perf: `useFeedPerf()` → {fps,longTasks,overBudget,shouldVirtualize};
 *    окно строк: `useFeedWindow(ref,count,rowH)` или чистый `feedWindow()`.
 */

/** Вход нового события ленты (fade+rise 240ms, стаггер index*50ms). */
export function FeedItemIn({ index = 0, animated = true, className, style, children, ...rest }:
  HTMLAttributes<HTMLDivElement> & { index?: number; animated?: boolean; children: ReactNode }) {
  return (
    <div
      className={[animated ? styles.itemIn : '', className].filter(Boolean).join(' ')}
      style={{ animationDelay: animated && index > 0 ? `${Math.min(index, 4) * 50}ms` : undefined, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Маркер чекпоинта: галка дорисовывается, золотое кольцо гаснет. */
export function CheckpointMark({ animated = true, ...rest }:
  HTMLAttributes<HTMLSpanElement> & { animated?: boolean }) {
  return (
    <span className={animated ? styles.checkpoint : styles.checkpointStatic} aria-hidden="true" {...rest}>
      <svg viewBox="0 0 14 14" width="14" height="14" className={styles.checkpointTick}>
        <path d="M3 7.4 6 10.2 11 4.2" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
      </svg>
    </span>
  );
}

export interface ModePillProps extends HTMLAttributes<HTMLDivElement> {
  /** Сегменты в порядке отображения: agent | ask | plan. */
  modes: readonly { id: string; label: string }[];
  /** Активный режим (реальное состояние владельца). */
  value: string;
  animated?: boolean;
}

/** Переключатель режима agent|ask|plan — бегунок скользит к активному. */
export function ModePill({ modes, value, animated = true, className, ...rest }: ModePillProps) {
  const idx = Math.max(0, modes.findIndex((m) => m.id === value));
  return (
    <div
      className={[styles.modePill, className].filter(Boolean).join(' ')}
      role="tablist"
      data-mode={value}
      {...rest}
    >
      <span
        className={animated ? styles.modeSlider : styles.modeSliderStatic}
        style={{
          inlineSize: `${100 / modes.length}%`,
          '--mode-slide-ltr': `${idx * 100}%`,
          '--mode-slide-rtl': `-${idx * 100}%`,
        } as CSSProperties}
        aria-hidden="true"
      />
      {modes.map((m) => (
        <span key={m.id} role="tab" aria-selected={m.id === value} data-active={m.id === value || undefined}
          className={styles.modeLabel}>
          {m.label}
        </span>
      ))}
    </div>
  );
}

export interface WaitMarkProps extends HTMLAttributes<HTMLSpanElement> {
  /** Ждём подтверждения пользователя — пульс; false → статичная метка. */
  active?: boolean;
  /** Подпись для скринридера/визуала (по-русски у владельца). */
  label?: string;
}

/** Индикатор «ждёт подтверждения»: золотое кольцо дышит 1400ms.
 *  aria-live="polite" — ожидание доносится без движения тоже. */
export function WaitMark({ active = true, label, className, ...rest }: WaitMarkProps) {
  return (
    <span className={[styles.wait, className].filter(Boolean).join(' ')} aria-live="polite" {...rest}>
      <span className={active ? styles.waitRing : styles.waitRingStatic} aria-hidden="true" />
      {label != null && <span className={styles.waitLabel}>{label}</span>}
    </span>
  );
}

export interface RunBarProps extends HTMLAttributes<HTMLDivElement> {
  /** Доля 0..1; null/undefined — доля неизвестна → indeterminate-shimmer. */
  value?: number | null;
  /** Подпись рядом с полосой (реальные данные владельца). */
  label?: string;
}

/** Прогресс фонового прогона: fill 240ms; value=null → честный shimmer. */
export function RunBar({ value, label, className, ...rest }: RunBarProps) {
  const known = value != null && Number.isFinite(value);
  const frac = known ? Math.max(0, Math.min(1, value as number)) : 0;
  return (
    <div className={[styles.runBar, className].filter(Boolean).join(' ')}
      role="progressbar"
      aria-valuemin={0} aria-valuemax={100}
      {...(known ? { 'aria-valuenow': Math.round(frac * 100) } : {})}
      {...rest}
    >
      <span className={styles.runTrack}>
        <span className={known ? styles.runFill : styles.runFillUnknown}
          style={known ? { transform: `scaleX(${frac})` } : undefined} />
      </span>
      {label != null && <span className={styles.runLabel}>{label}</span>}
    </div>
  );
}

/* ─── Бюджет производительности ─────────────────────────────────────── */

export interface FeedPerf extends FeedPerfAssessment {
  /** Рекомендация: включать окно виртуализации. */
  shouldVirtualize: boolean;
}

/**
 * Замер fps (rAF) и long tasks (PerformanceObserver) за `windowMs`.
 * Реальные числа браузера; в jsdom/SSR — null для недоступных источников.
 */
export function useFeedPerf(opts: { windowMs?: number; itemCount?: number } = {}): FeedPerf {
  const windowMs = opts.windowMs ?? FEED_PERF_BUDGET.windowMs;
  const countRequiresWindow = (opts.itemCount ?? 0) > FEED_PERF_BUDGET.virtualizeAfter;
  const [m, setM] = useState<FeedPerf>(() => ({
    ...assessFeedPerformance(null, null),
    shouldVirtualize: countRequiresWindow,
  }));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
    let frames = 0;
    let longTasks = 0;
    let running = true;
    let frame = 0;
    let longTasksSupported = false;
    let previousSample = performance.now();
    const tick = () => {
      if (!running) return;
      frames += 1;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    let obs: PerformanceObserver | undefined;
    try {
      obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (e.duration >= FEED_PERF_BUDGET.longTaskMs) longTasks += 1;
      });
      obs.observe({ entryTypes: ['longtask'] });
      longTasksSupported = true;
    } catch { /* Long Tasks unavailable: retain null, FPS still measures. */ }
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = now - previousSample;
      const fps = dt > 0 ? Math.round((frames / dt) * 1000) : null;
      const lt = longTasksSupported ? longTasks : null;
      const assessment = assessFeedPerformance(fps, lt);
      const big = (opts.itemCount ?? 0) > FEED_PERF_BUDGET.virtualizeAfter;
      setM({
        ...assessment,
        shouldVirtualize: assessment.overBudget === true || big,
      });
      frames = 0;
      longTasks = 0;
      previousSample = now;
    }, windowMs);
    return () => {
      running = false;
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
      obs?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowMs, opts.itemCount]);
  return {
    ...m,
    shouldVirtualize: m.overBudget === true || countRequiresWindow,
  };
}

/**
 * Окно виртуализации по scroll-контейнеру: возвращает диапазон и
 * паддинги; пересчёт на scroll (rAF-throttle). `force` — от perf-бюджета.
 */
export function useFeedWindow(
  ref: RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number,
  opts: { force?: boolean; overscan?: number } = {},
): FeedWindow {
  const [w, setW] = useState<FeedWindow>(() =>
    feedWindow({ count, rowHeight, scrollTop: 0, viewportHeight: 0, overscan: opts.overscan }, { force: opts.force }));
  const raf = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (el == null) return;
    const update = () => {
      raf.current = 0;
      setW(feedWindow({
        count, rowHeight,
        scrollTop: el.scrollTop,
        viewportHeight: el.clientHeight,
        overscan: opts.overscan,
      }, { force: opts.force }));
    };
    const onScroll = () => { if (!raf.current) raf.current = requestAnimationFrame(update); };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : undefined;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf.current) cancelAnimationFrame(raf.current);
      ro?.disconnect();
    };
  }, [ref, count, rowHeight, opts.force, opts.overscan]);
  return w;
}
