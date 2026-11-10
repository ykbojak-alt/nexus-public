import type { ReactNode } from 'react';
import styles from '../navigation.module.css';

export interface PageHeaderProps {
  className?: string;
  title: string;
  /** Scope line under the title — slogan or section note. */
  subtitle?: string;
  /** KPI strip slot (MetricStrip/StatCards) — caller supplies real data;
   *  the header never fabricates metrics. */
  kpi?: ReactNode;
  /** Page-level actions, right-aligned. */
  actions?: ReactNode;
}

/** Section page header — title, optional slogan, KPI strip slot and actions.
 *  One per screen; the KPI slot belongs to the page, not the rail. */
export function PageHeader({ className, title, subtitle, kpi, actions }: PageHeaderProps) {
  return (
    <div className={[styles.pageHeader, className].filter(Boolean).join(' ')} data-testid="page-header">
      <div className={styles.pageHeaderRow}>
        <div className={styles.pageHeaderContent}>
          <h1 className={styles.pageTitle}>{title}</h1>
          {subtitle != null && <p className={styles.pageSubtitle}>{subtitle}</p>}
        </div>
        {actions != null && <div className={styles.pageActions}>{actions}</div>}
      </div>
      {kpi != null && <div className={styles.pageKpis}>{kpi}</div>}
    </div>
  );
}
