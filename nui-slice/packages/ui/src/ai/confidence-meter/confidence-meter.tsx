import styles from '../ai.module.css';
import type { ConfidenceValue } from '../types';

const SEGMENTS: Record<'low' | 'medium' | 'high', number> = { low: 1, medium: 2, high: 3 };

/**
 * Confidence indicator. Categorical confidence renders as a 3-segment scale —
 * never converted into a fake percentage. Percent kind shows an honest bar.
 */
export function ConfidenceMeter({ className, value, label = 'Confidence' }: { className?: string; value: ConfidenceValue; label?: string }) {
  if (value.kind === 'percent') {
    const pct = Math.min(100, Math.max(0, value.value));
    return (
      <span className={[styles.meter, className].filter(Boolean).join(' ')} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span className={styles.meterPct}>
          <span className={styles.meterPctFill} style={{ display: 'block', width: `${pct}%` }} />
        </span>
        <span className={styles.meterLabel}>{pct}%</span>
      </span>
    );
  }
  const on = SEGMENTS[value.value];
  return (
    <span className={[styles.meter, className].filter(Boolean).join(' ')} role="img" aria-label={`${label}: ${value.value}`} data-testid="confidence-meter">
      <span className={styles.meterTrack} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={styles.meterSeg} data-on={i < on ? value.value : undefined} />
        ))}
      </span>
      <span className={styles.meterLabel}>{value.value}</span>
    </span>
  );
}
