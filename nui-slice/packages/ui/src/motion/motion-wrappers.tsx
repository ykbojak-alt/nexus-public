import type { HTMLAttributes } from 'react';
import { staggerDelay } from './motion-helpers';
import styles from './motion.module.css';

export interface MotionEnterProps extends HTMLAttributes<HTMLDivElement> {
  /** Порядковый индекс в группе — задаёт стаггер (--enter-delay). */
  index?: number;
  /** false — без анимации (probe/скриншоты). */
  animated?: boolean;
}

/**
 * Появление карточки/панели: fade + подъём (ключевые кадры nxEnter),
 * стаггер по `index`. Под prefers-reduced-motion кончается мгновенно
 * в конечном состоянии — контент никогда не зависит от анимации.
 */
export function MotionEnter({ index = 0, animated = true, className,
  style, children, ...rest }: MotionEnterProps) {
  const cls = [animated ? styles.enter : '', className].filter(Boolean).join(' ');
  return (
    <div className={cls} style={{ ...staggerDelay(index), ...style }} {...rest}>
      {children}
    </div>
  );
}

export interface AmbientPulseProps extends HTMLAttributes<HTMLSpanElement> {
  /** false — статичный статус (probe/скриншоты). */
  animated?: boolean;
}

/**
 * Пульс статуса: дышащее свечение вокруг обёрнутого элемента (инлайн,
 * раскладку не меняет). Для элементов, чей статус уже читается из
 * текста/цвета — пульс только усиливает, никогда не несёт данные.
 */
export function AmbientPulse({ animated = true, className, children, ...rest }: AmbientPulseProps) {
  const cls = [animated ? styles.statusPulse : '', className].filter(Boolean).join(' ');
  return <span className={cls} {...rest}>{children}</span>;
}

export interface AmbientGlowProps extends HTMLAttributes<HTMLDivElement> {
  animated?: boolean;
}

/** Мягкое дышащее свечение контура (nxGlow) — для hero/рамок. */
export function AmbientGlow({ animated = true, className, children, ...rest }: AmbientGlowProps) {
  const cls = [animated ? styles.glow : '', className].filter(Boolean).join(' ');
  return <div className={cls} {...rest}>{children}</div>;
}
