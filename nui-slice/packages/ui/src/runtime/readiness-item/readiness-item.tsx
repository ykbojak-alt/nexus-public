import type { ReactNode } from 'react';
import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import type { ReadinessState } from '../types';
import styles from '../runtime.module.css';

const STATE_STATUS: Record<ReadinessState, NexusStatus> = {
  ready: 'online',
  checking: 'syncing',
  unavailable: 'warning',
  unknown: 'offline',
};

export interface ReadinessItemProps {
  className?: string;
  /** What is being checked — 'OS', 'Shell', 'Local worker', a tool name… */
  name: string;
  state: ReadinessState;
  /** Verbatim detail, e.g. a detected version. Never fabricated. */
  detail?: ReactNode;
}

/** One environment readiness row (OS, shell, worker, tool). Unknown probe
 *  results render as 'unknown', not as ready. */
export function ReadinessItem({ className, name, state, detail }: ReadinessItemProps) {
  return (
    <div className={[styles.readinessRow, className].filter(Boolean).join(' ')}
      data-state={state} data-testid="readiness-item">
      <span className={styles.readinessName}>{name}</span>
      {detail != null && <span className={styles.readinessDetail}>{detail}</span>}
      <StatusBadge status={STATE_STATUS[state]} label={state} />
    </div>
  );
}
