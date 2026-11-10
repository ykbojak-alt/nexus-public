import type { HTMLAttributes, ReactNode } from 'react';
import styles from './adaptive-window.module.css';

/**
 * Adaptive-window компоненты (волна XVII, задача 4, W4) — визуальный
 * слой движения адаптивной оболочки AGENT-A Разметка и данные
 * рельса/полосы — W3 (89-alice-window-shell); здесь только контейнер
 * и слои: ширина колонки, гашение подписей, высота полосы иконок —
 * через container queries (nexus-window), без JS-таймеров и без
 * layout-сдвигов (анимируются grid-треки и opacity, не display).
 *
 * Подключение (для W3):
 *  - обернуть шелл в <AdaptiveShell> (он сам container);
 *  - навигацию рельса в <AdaptiveRail>, контент в <AdaptiveMain>,
 *    компактную навигацию в <AdaptiveStrip>;
 *  - текст пункта рельса в <AdaptiveLabel> — в режиме иконок гасится
 *    (140ms), ширина колонки плавно 240→72px (220ms);
 *  - ≤560px полоса разворачивается 0→52px (240ms), рельс схлопывается;
 *  - prefers-reduced-motion гасит все переходы (мгновенный режим);
 *  - data-force="icons"|"single" — детерминированный режим для
 *    сторис/тестов без ресайза окна.
 */

export type AdaptiveWindowMode = 'auto' | 'full' | 'icons' | 'single';

export interface AdaptiveShellProps extends HTMLAttributes<HTMLDivElement> {
  /** 'auto' — по ширине контейнера; force — для сторис/тестов. */
  mode?: AdaptiveWindowMode;
  children?: ReactNode;
}

/** Контейнер окна: внешний — container (запросы ширины), внутренний —
 *  grid strip(0fr→52px)/rail(240→72→0)+main. Вложенность обязательна:
 *  container queries не стилизуют сам контейнер. */
export function AdaptiveShell({ mode = 'auto', className, children, ...rest }: AdaptiveShellProps) {
  return (
    <div
      className={styles.container}
      data-force={mode === 'auto' ? undefined : mode}
    >
      <div className={[styles.shell, className].filter(Boolean).join(' ')} {...rest}>
        {children}
      </div>
    </div>
  );
}

/** Левая колонка рельса: ширина анимируется треком грида. */
export function AdaptiveRail({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <nav className={[styles.rail, className].filter(Boolean).join(' ')} {...rest} />;
}

/** Горизонтальная полоса иконок (≤560px): высота 0→52px + fade. */
export function AdaptiveStrip({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <div className={[styles.strip, className].filter(Boolean).join(' ')} {...rest} />;
}

/** Основная область: всегда во втором треке, растёт при схлопе рельса. */
export function AdaptiveMain({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <main className={[styles.main, className].filter(Boolean).join(' ')} {...rest} />;
}

/** Подпись пункта рельса: в режиме иконок гаснет и сжимается до 0. */
export function AdaptiveLabel({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={[styles.label, className].filter(Boolean).join(' ')} {...rest} />;
}
