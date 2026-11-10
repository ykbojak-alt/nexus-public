import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import styles from './glass-backdrop.module.css';

/**
 * Подложка стеклянных баров (волна XVII, W4).
 *
 * `GlassBackdrop` — слой за оболочкой/барами: арт из референсов,
 * художественный blur (filter, не backdrop-filter — один дешёвый слой),
 * скрим к panel-цвету темы и медленный дрейф блика (гасится
 * prefers-reduced-motion). Ничего не выдумывает: src приходит от
 * продукта; без src — честная пустая подложка цвета темы.
 *
 * `GlassBar` — демонстрационный бар контракта прозрачности для витрины
 * и тестов; продовые рельс/шапка/статус-бары — зона W3.
 */

export interface GlassBackdropProps extends HTMLAttributes<HTMLDivElement> {
  /** Арт подложки (оптимизированный файл из public/art); без src — пустая
   *  подложка цвета темы, без выдуманной картинки. */
  src?: string | null;
  /** Блик-дрейф поверх арта. */
  sheen?: boolean;
}

export function GlassBackdrop({ src, sheen = true, className, style, ...rest }: GlassBackdropProps) {
  return (
    <div className={[styles.backdrop, className].filter(Boolean).join(' ')} aria-hidden="true" {...rest}>
      {src ? (
        <div className={styles.art} style={{ backgroundImage: `url(${src})` }} />
      ) : null}
      <div className={styles.scrim} />
      {sheen ? <div className={styles.sheen} /> : null}
    </div>
  );
}

export interface GlassBarProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  meta?: string;
  /** Принудительная демонстрация fallback-заливки без backdrop-filter —
   *  задаёт --nexus-glass-bar-bg локально (для витрины/тестов). */
  opaque?: boolean;
  children?: ReactNode;
}

export function GlassBar({ title, meta, opaque = false, className, style, children, ...rest }: GlassBarProps) {
  const merged: CSSProperties = opaque
    ? { background: 'var(--nexus-glass-bar-bg-strong, color-mix(in srgb, var(--nexus-surface-panel, #FBF8F1) 88%, transparent))', ...style }
    : { ...style };
  return (
    <div className={[styles.bar, className].filter(Boolean).join(' ')} style={merged} {...rest}>
      <span className={styles.barTitle}>{title}</span>
      {meta ? <span className={styles.barMeta}>{meta}</span> : null}
      {children}
    </div>
  );
}
