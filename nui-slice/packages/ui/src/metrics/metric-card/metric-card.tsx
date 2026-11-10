import type { ReactNode } from 'react';
import { Card } from '../../surfaces/card/card';
import styles from '../metrics.module.css';

export interface MetricCardProps {
  className?: string;
  label: string;
  /** null = источника нет — карточка говорит «нет данных», не 0. */
  value: string | null;
  delta?: { value: string; direction: 'up' | 'down' | 'flat' };
  /** data-state contract (W5): page-level state surfacing. */
  state?: 'loading' | 'ready' | 'empty' | 'error' | 'stale' | 'offline' | 'unavailable';
  freshness?: 'live' | 'stale' | 'archived';
  children?: ReactNode;   // slot for Sparkline / MetricRing
}

export function MetricCard({ className, label, value, delta, state, freshness, children }: MetricCardProps) {
  return (
    <Card className={[styles.metricCard, className].filter(Boolean).join(' ')} data-testid="metric-card"
      data-state={state} data-freshness={freshness}>
      <span className={styles.metricLabel}>{label}</span>
      {value == null
        ? <span className={styles.metricValue} data-empty="true">нет данных</span>
        : <span className={styles.metricValue}>{value}</span>}
      {delta != null && (
        <span className={styles.metricDelta} data-dir={delta.direction}>
          {delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '—'} {delta.value}
        </span>
      )}
      {children}
    </Card>
  );
}
