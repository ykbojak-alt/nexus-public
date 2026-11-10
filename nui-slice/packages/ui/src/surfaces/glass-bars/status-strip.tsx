import { ProgressBar } from '../../feedback/progress-bar/progress-bar';
import styles from './glass-bars.module.css';

export interface StatusStripProps {
  className?: string;
  /** Row label, e.g. «Статус системы». */
  label: string;
  /** Real value text; null/absent renders «—», never an invented number. */
  value?: string | null;
  /** 0..100 from live data; null/absent renders an indeterminate bar. */
  progress?: number | null;
}

/** Compact status row: label + translucent-track progress + value. */
export function StatusStrip({ className, label, value, progress }: StatusStripProps) {
  return (
    <div className={[styles.statusStrip, className].filter(Boolean).join(' ')}>
      <span className={styles.statusLabel}>{label}</span>
      <ProgressBar className={styles.statusBar} value={progress ?? undefined} label={label} />
      <span className={styles.statusValue}>{value ?? '—'}</span>
    </div>
  );
}
