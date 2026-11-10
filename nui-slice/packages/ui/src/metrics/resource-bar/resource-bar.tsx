import styles from '../metrics.module.css';

export interface ResourceBarProps {
  className?: string;
  label: string;
  /** 0..100; null renders an honest "n/a". */
  value: number | null;
  warnAt?: number;
  criticalAt?: number;
  /** Budget/quota cap marker on the track — actual vs limit stays visible. */
  limitAt?: number;
  /** `inline` keeps label, track and value on one row (ALICE home rail). */
  layout?: 'stacked' | 'inline';
}

/** Resource utilization bar — warn/critical thresholds via state tokens. */
export function ResourceBar({ className, label, value, warnAt = 75, criticalAt = 90, limitAt, layout = 'stacked' }: ResourceBarProps) {
  const pct = value == null ? null : Math.min(100, Math.max(0, value));
  const level = pct == null ? undefined : pct >= criticalAt ? 'critical' : pct >= warnAt ? 'warn' : undefined;
  const limit = limitAt == null ? null : Math.min(100, Math.max(0, limitAt));
  return (
    <div className={[styles.resBar, className].filter(Boolean).join(' ')} data-testid="resource-bar" data-layout={layout}>
      <div className={styles.resBarLabel}>
        <span>{label}</span>
        <span>{pct == null ? 'n/a' : `${pct.toFixed(0)}%`}</span>
      </div>
      <div className={styles.resBarTrack} role="meter" aria-label={label}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
        <div className={styles.resBarFill} data-level={level}
          data-empty={pct == null || pct === 0 ? 'true' : undefined}
          style={{ width: `${pct ?? 0}%` }} />
        {limit != null && <span className={styles.resBarLimit} style={{ left: `${limit}%` }} />}
      </div>
    </div>
  );
}

