import type { HTMLAttributes } from 'react';
import { TypingIndicator } from '../typing-indicator/typing-indicator';
import styles from './status-badge.module.css';

/** Domain status vocabulary — spec §9. Interaction states are NOT statuses. */
export type NexusStatus =
  | 'online' | 'active' | 'thinking' | 'waiting' | 'syncing'
  | 'validating' | 'executing' | 'complete' | 'paused' | 'error'
  | 'warning' | 'offline' | 'info';

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: NexusStatus;
  label?: string;
}

/**
 * Status indicator using state.* tokens. Label defaults to the canonical
 * uppercase vocabulary word — pass `label` for localized/other text.
 */
export function StatusBadge({ status, label, className, ...rest }: StatusBadgeProps) {
  return (
    <span
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-status={status}
      data-testid="status-badge"
      {...rest}
    >
      {status === 'thinking' ? (
        <TypingIndicator label={label ?? 'печатает…'} />
      ) : (
        <>
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.text}>{label ?? status.toUpperCase()}</span>
        </>
      )}
    </span>
  );
}
