import {
  useEffect, useRef, useState, useSyncExternalStore,
  type HTMLAttributes, type ImgHTMLAttributes, type ReactNode,
} from 'react';
import { bootMotion, consumeBootHandoff } from './boot-motion';
import styles from './boot-motion.module.css';

/**
 * Boot-моушн-компоненты NEU (волна XIV, W4) — визуальный слой стартового
 * экрана загрузки и вейл-переход на выбор ассистента. Спека длительностей —
 * `boot-motion.ts`; CSS-дубли значений в `boot-motion.module.css`
 * (CSS не читает TS-пакет — конвенция ui/motion).
 *
 * Честность: BootProgress анимирует только приход реальной доли; при
 * неизвестном этапе показывает shimmer без выдуманного процента.
 * prefers-reduced-motion гасится CSS-блоком и таймером вейла; prop
 * `animated={false}` — статичный probe для скриншотов.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribeMotion(fn: () => void): () => void {
  const mq = globalThis.matchMedia?.(QUERY);
  if (!mq) return () => {};
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}

/** Внутренний слушатель reduced-motion (тот же паттерн, что у приложения). */
export function useBootReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => globalThis.matchMedia?.(QUERY).matches === true,
    () => false,
  );
}

export interface BootEmblemProps extends HTMLAttributes<HTMLDivElement> {
  /** false — статичный конечный кадр (probe/скриншоты). */
  animated?: boolean;
  children: ReactNode;
}

/** Появление логотипа: fade+rise 700ms launch. Дети — разметка владельца. */
export function BootEmblem({ animated = true, className, children, ...rest }: BootEmblemProps) {
  return (
    <div
      className={[animated ? styles.emblem : '', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface BootFigureProps extends ImgHTMLAttributes<HTMLImageElement> {
  /** false — статичный конечный кадр. */
  animated?: boolean;
}

/** Проявление образа ассистента: fade+scale 900ms glide, async-декод. */
export function BootFigure({ animated = true, className, alt, ...rest }: BootFigureProps) {
  return (
    <img
      className={[animated ? styles.figure : '', className].filter(Boolean).join(' ')}
      decoding="async"
      alt={alt ?? ''}
      data-hero-figure
      {...rest}
    />
  );
}

export interface BootProgressProps extends HTMLAttributes<HTMLDivElement> {
  /** 0..100 — доля завершившихся реальных этапов; null/undefined → shimmer. */
  value?: number | null;
  /** Доступная подпись прогрессбара. */
  label?: string;
}

/**
 * Полоса загрузки: determinate — fill подрастает к наблюдаемой доле
 * (width-transition 240ms, монотонно, без ускорений); indeterminate —
 * бесконечная подметка 1400ms, aria без valuemin/max/now.
 * reduced-motion: fill прыгает к значению, shimmer — статичная полоса.
 */
export function BootProgress({ value, label, className, ...rest }: BootProgressProps) {
  const measured = value != null && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : null;
  const indeterminate = measured == null;
  return (
    <div className={[styles.track, className].filter(Boolean).join(' ')} {...rest}>
      <div
        className={[styles.fill, indeterminate ? styles.shimmer : ''].filter(Boolean).join(' ')}
        role="progressbar"
        aria-label={label}
        aria-valuemin={indeterminate ? undefined : 0}
        aria-valuemax={indeterminate ? undefined : 100}
        aria-valuenow={measured ?? undefined}
        style={indeterminate ? undefined : { width: `${measured}%` }}
      />
    </div>
  );
}

export interface BootHandoffProps {
  /** Вызов после завершения вейла (или сразу, когда флага нет). */
  onSettled?: () => void;
}

/**
 * Вейл прибытия на выбранный маршрут: монтируется только если boot
 * поставил флаг `markBootHandoff()` перед replace — играет 700ms dissolve
 * (стекло: blur+полупрозрачная подложка; золото: нижняя кромка-градиент),
 * затем самоуничтожается. Прямой заход без флага — без вейла.
 * reduced-motion → короткое 140ms затухание opacity.
 */
export function BootHandoff({ onSettled }: BootHandoffProps) {
  // Флаг читается в эффекте, не в инициализаторе: sessionStorage недоступен
  // при SSR/пререндере — чтение на клиенте не ломает гидратацию.
  const [show, setShow] = useState(false);
  const [gone, setGone] = useState(false);
  const reduced = useBootReducedMotion();
  const done = useRef(false);

  useEffect(() => {
    if (!consumeBootHandoff()) return;
    if (reduced) {
      // Reduced-motion: вейл вообще не монтируется — статичный кадр
      // подложки не должен мелькать между consume и settle.
      done.current = true;
      onSettled?.();
      return;
    }
    setShow(true);
  }, [reduced, onSettled]);

  useEffect(() => {
    if (!show || gone || done.current) return;
    const ms = bootMotion('handoff', 'dissolve', { reducedMotion: reduced }).durationMs;
    if (ms === 0) {
      done.current = true;
      setGone(true);
      onSettled?.();
      return;
    }
    // Fallback-таймер: jsdom/WebKit могут пропустить animationend.
    const t = setTimeout(() => { done.current = true; setGone(true); onSettled?.(); }, ms + 80);
    return () => clearTimeout(t);
  }, [show, gone, reduced, onSettled]);

  if (!show || gone) return null;
  return (
    <div
      className={styles.veil}
      data-testid="boot-handoff-veil"
      aria-hidden="true"
      onAnimationEnd={() => { if (!done.current) { done.current = true; setGone(true); onSettled?.(); } }}
    />
  );
}
