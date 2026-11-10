import type { ReactNode } from 'react';
import { ToolBadge } from '../../ai/tool-badge/tool-badge';
import styles from '../runtime.module.css';
import type { RuntimeEventKind } from '../types';

export interface EventRowProps {
  className?: string;
  kind: RuntimeEventKind;
  /** Severity for log filtering (Streaming Logs): info default. */
  level?: 'info' | 'warn' | 'error';
  /** Event time — caller formats; pass a Date-friendly string. */
  time?: string;
  /** Agent or host actor that produced the event. */
  actor?: string;
  /** Event origin — 'host', 'worker', tool name, policy id… */
  source?: string;
  children: ReactNode;
}

/** One row in the local-session action feed. Shows what happened with its
 *  actor and source — payloads are rendered verbatim by the caller; secret
 *  values must already be stripped upstream. */
export function EventRow({ className, kind, level, time, actor, source, children }: EventRowProps) {
  return (
    <div className={[styles.eventRow, className].filter(Boolean).join(' ')}
      data-kind={kind} data-level={level !== 'info' ? level : undefined} data-testid="event-row">
      {time != null && <time className={styles.eventTime}>{time}</time>}
      <ToolBadge name={kind} />
      <div className={styles.eventBody}>
        {children}
        {(actor != null || source != null) && (
          <div className={styles.eventMeta}>
            {actor != null && <span>{actor}</span>}
            {source != null && <span className={styles.eventSource}>{source}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
