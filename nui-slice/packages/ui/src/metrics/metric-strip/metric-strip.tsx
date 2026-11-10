import type { ReactNode } from 'react';
import styles from '../metrics.module.css';

/** Horizontal strip of metrics with token separators. */
export function MetricStrip({className,  children, label }: { className?: string; children?: ReactNode; label?: string }) {
  return (
    <div className={[styles.strip, className].filter(Boolean).join(' ')} role="group" aria-label={label ?? 'Metrics'}>
      {children}
    </div>
  );
}
