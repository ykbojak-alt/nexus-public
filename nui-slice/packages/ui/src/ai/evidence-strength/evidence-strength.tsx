import styles from '../ai.module.css';

export type EvidenceLevel = 'none' | 'weak' | 'moderate' | 'strong';
const BARS: Record<EvidenceLevel, number> = { none: 0, weak: 1, moderate: 2, strong: 3 };

/** Evidence strength — discrete bars + count of sources; honest, no fake precision. */
export function EvidenceStrength({className,  level, sources, label = 'Evidence' }: { className?: string; level: EvidenceLevel; sources?: number; label?: string }) {
  const on = BARS[level];
  return (
    <span className={[styles.meter, className].filter(Boolean).join(' ')} role="img" aria-label={`${label}: ${level}${sources != null ? `, ${sources} sources` : ''}`}
      data-testid="evidence-strength">
      <span className={styles.meterTrack} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={styles.meterSeg} data-on={i < on ? (level === 'strong' ? 'high' : level === 'moderate' ? 'medium' : 'low') : undefined} />
        ))}
      </span>
      <span className={styles.meterLabel}>{level}{sources != null && ` · ${sources}`}</span>
    </span>
  );
}
