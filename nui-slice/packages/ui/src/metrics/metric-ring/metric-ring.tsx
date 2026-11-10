import { ProgressArc } from '../../feedback/progress-arc/progress-arc';
import styles from '../metrics.module.css';

export interface MetricRingProps {
  className?: string;
  /** 0..100 */
  value: number;
  size?: number;
  label?: string;
  display?: string;   // center text override (e.g. "61.8")
}

/** Ring progress with a centered value — the canonical spec metric glyph. */
export function MetricRing({className,  value, size = 64, label, display }: MetricRingProps) {
  return (
    <span className={[styles.ringWrap, className].filter(Boolean).join(' ')} data-testid="metric-ring">
      <ProgressArc value={value} size={size} label={label} />
      <span className={styles.ringCenter} aria-hidden="true">
        <span style={{ fontSize: Math.round(size / 4.5) }}>{display ?? `${Math.round(value)}%`}</span>
        {label != null && <small>{label}</small>}
      </span>
    </span>
  );
}
