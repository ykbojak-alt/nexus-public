import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { HERO_MOTION_MS } from './hero-motion';
import styles from './hero-motion.module.css';

/**
 * Герой и KPI-полоса главной (волна XVII, W4).
 * Вход — одно проигрывание; «дыхание» — медленная петля на opacity,
 * гасится prefers-reduced-motion. Числа и подписи приходят пропсами
 * от продукта — компонент значений не знает; пустое = «нет данных».
 */

export interface HeroArtProps extends HTMLAttributes<HTMLDivElement> {
  /** Арт героя (оптимизированный webp из public/art); без src — честный
   *  пустой герой цвета фона, без выдуманной картинки. */
  src?: string | null;
  alt?: string;
  /** Подсветка-«дыхание» поверх арта. */
  breathe?: boolean;
}

export function HeroArt({ src, alt = '', breathe = true, className, style, children, ...rest }: HeroArtProps) {
  return (
    <div
      className={styles.heroIn}
      style={{ position: 'relative', overflow: 'hidden', ...style }}
      data-hero=""
      {...rest}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : null}
      {breathe ? (
        <div
          className={styles.breathe}
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background:
              'radial-gradient(60% 50% at 30% 25%, rgba(246,240,228,0.85), rgba(201,164,92,0.10) 60%, transparent 75%)',
          }}
        />
      ) : null}
      {children}
    </div>
  );
}

export interface KpiItemProps extends HTMLAttributes<HTMLDivElement> {
  /** Подпись показателя из данных продукта. */
  label: string;
  /** Значение как строка от источника данных; undefined → «нет данных». */
  value?: string | null;
  /** Доля столбца 0..1 от данных; undefined → столбец не рисуется. */
  ratio?: number | null;
  /** Позиция в полосе — стаггер появления. */
  index?: number;
}

export function KpiItem({ label, value, ratio, index = 0, className, style, children, ...rest }: KpiItemProps) {
  const hasRatio = ratio != null && Number.isFinite(ratio);
  const w = hasRatio ? Math.min(1, Math.max(0, ratio)) : null;
  return (
    <div
      className={styles.kpiIn}
      style={{ animationDelay: `${index * HERO_MOTION_MS.kpiStaggerMs}ms`, ...style }}
      {...rest}
    >
      <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {value ?? 'нет данных'}
      </div>
      {w != null ? (
        <div
          className={styles.kpiBar}
          style={{
            height: 3, marginTop: 6, borderRadius: 2,
            background: 'currentColor', opacity: 0.55,
            ['--nexus-kpi-ratio' as string]: w,
            // под reduce-motion анимации нет — конечная ширина inline.
            transform: `scaleX(${w})`,
            transformOrigin: 'left center',
          }}
        />
      ) : null}
      {children}
    </div>
  );
}
