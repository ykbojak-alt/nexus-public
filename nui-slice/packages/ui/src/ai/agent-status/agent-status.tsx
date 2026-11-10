import styles from '../ai.module.css';
import type { AgentPresenceKind } from '../types';

const LABELS: Record<AgentPresenceKind, string> = {
  online: 'online', busy: 'busy', idle: 'idle', offline: 'offline', error: 'error',
};

/** Presence dot + optional text label; dot alone when label=false. */
export function AgentStatus({className,  status, label = true }: { className?: string; status: AgentPresenceKind; label?: boolean }) {
  return (
    <span className={[styles.statusRow, className].filter(Boolean).join(' ')} data-testid="agent-status">
      <span className={styles.presenceDot} data-status={status} aria-hidden="true" />
      {label && <span>{LABELS[status]}</span>}
    </span>
  );
}
