import styles from '../metrics.module.css';

export type HealthLevel = 'ok' | 'warn' | 'error';

/** Component health indicator — colored dot + label. */
export function StatusGauge({className,  health, label, detail }: { className?: string; health: HealthLevel; label: string; detail?: string }) {
  return (
    <span className={[styles.gauge, className].filter(Boolean).join(' ')} data-testid="status-gauge" title={detail}>
      <span className={styles.gaugeDot} data-health={health} aria-hidden="true" />
      <span style={{ color: 'var(--nexus-text-secondary, #B0B7C2)' }}>{label}</span>
    </span>
  );
}
