'use client';

import { useId, type ReactNode } from 'react';
import styles from './panel-header.module.css';

export type PanelHeaderLevel = 'panel' | 'section' | 'screen';

export interface PanelHeaderProps {
  /** Ступень шкалы title.*: panel (18/26), section (28/36), screen (40/48).
   *  По умолчанию 'panel'; heading rank выводится из уровня (h3/h2/h1),
   *  при необходимости переопределяется через headingLevel. */
  level?: PanelHeaderLevel;
  title: ReactNode;
  /** Scope-line под заголовком — слоган или пометка секции. */
  subtitle?: ReactNode;
  /** Декоративный глиф слева (aria-hidden) — интерактивные кнопки передавать в actions. */
  icon?: ReactNode;
  /** Слот действий справа; не сжимается заголовком. */
  actions?: ReactNode;
  /** Нижняя hairline-кромка (--nexus-title-divider). По умолчанию true. */
  divider?: boolean;
  /** Явный heading rank 1–6, если порядок заголовков на странице требует другого. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** id заголовка — для aria-labelledby у владеющего региона/панели. */
  titleId?: string;
  className?: string;
}

const DEFAULT_HEADING: Record<PanelHeaderLevel, 1 | 2 | 3> = {
  panel: 3,
  section: 2,
  screen: 1,
};

/** Единая шапка панели/секции: icon + title (+subtitle) + actions + divider.
 *  Типографика и хром идут через токены --nexus-title-*. */
export function PanelHeader({
  level = 'panel',
  title,
  subtitle,
  icon,
  actions,
  divider = true,
  headingLevel,
  titleId,
  className,
}: PanelHeaderProps) {
  const autoId = useId();
  const HeadingTag = `h${headingLevel ?? DEFAULT_HEADING[level]}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  return (
    <header
      className={[styles.panelHeader, styles[`level${level}`], className].filter(Boolean).join(' ')}
      data-level={level}
      data-divider={divider}
    >
      {icon != null && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <div className={styles.body}>
        <HeadingTag id={titleId ?? autoId} className={styles.title}>
          {title}
        </HeadingTag>
        {subtitle != null && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {actions != null && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
