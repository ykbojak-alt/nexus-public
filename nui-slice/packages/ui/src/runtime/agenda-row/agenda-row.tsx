import type { ReactNode } from 'react';
import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import styles from '../runtime.module.css';

/** How much of the event the provider lets us show. `private` — the event
 *  exists but details are withheld by the source account; `unknown` —
 *  details were not fetched. Never render fabricated details for either. */
export type AgendaDetailState = 'visible' | 'private' | 'unknown';

const PRIVACY_STATUS: Record<AgendaDetailState, NexusStatus | undefined> = {
  visible: undefined,
  private: 'warning',
  unknown: 'offline',
};

const PRIVACY_LABELS: Record<AgendaDetailState, string | undefined> = {
  visible: undefined,
  private: 'Private',
  unknown: 'Details unavailable',
};

export interface AgendaRowProps {
  className?: string;
  /** Display time or range — caller formats ('12:00–13:00'). */
  time?: string;
  /** Event title — for private/unknown pass a neutral caller-provided label. */
  title: string;
  details?: AgendaDetailState;
  /** Calendar/account label, verbatim. */
  source?: string;
  /** Extra details (location, attendees) — render only when visible. */
  meta?: ReactNode;
}

/** Calendar agenda/event row. Private and unknown detail states are shown
 *  honestly — the row never fills in content the provider did not give. */
export function AgendaRow({ className, time, title, details = 'visible', source, meta }: AgendaRowProps) {
  return (
    <div className={[styles.agendaRow, className].filter(Boolean).join(' ')}
      data-details={details} data-testid="agenda-row">
      {time != null && <time className={styles.eventTime}>{time}</time>}
      <div className={styles.agendaBody}>
        <span className={styles.agendaTitle}>{title}</span>
        {details === 'visible' && meta != null && (
          <span className={styles.agendaMeta}>{meta}</span>
        )}
        {source != null && <span className={styles.agendaSource}>{source}</span>}
      </div>
      {PRIVACY_LABELS[details] != null && (
        <StatusBadge status={PRIVACY_STATUS[details] ?? 'offline'} label={PRIVACY_LABELS[details]} />
      )}
    </div>
  );
}
