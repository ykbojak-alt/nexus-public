import { StatusBadge } from '../../feedback/status-badge/status-badge';
import styles from '../runtime.module.css';

export interface ThreadRowProps {
  className?: string;
  /** Chat/thread title — verbatim. */
  title: string;
  /** Last-message preview — verbatim. */
  preview?: string;
  /** Unread count — badge shown only for a positive number. */
  unread?: number;
  /** Access/limit note shown verbatim (e.g. 'read-only'). */
  note?: string;
  /** Marks the active thread in a picker list. */
  selected?: boolean;
  /** When provided the row renders as a button (keyboard focusable). */
  onSelect?: () => void;
}

/** One conversation row in a provider chat/DM list. Selection is a local
 *  UI fact (data-selected); unread and access notes are provider facts —
 *  rendered verbatim, never derived. */
export function ThreadRow({ className, title, preview, unread, note, selected, onSelect }: ThreadRowProps) {
  const Tag = onSelect ? 'button' : 'div';
  return (
    <Tag
      type={onSelect ? 'button' : undefined}
      className={[styles.threadRow, className].filter(Boolean).join(' ')}
      data-selected={selected === true ? 'true' : undefined}
      data-testid="thread-row"
      onClick={onSelect}
    >
      <span className={styles.rowMain}>
        <span title={title}>{title}</span>
        {preview != null && <span className={styles.rowSub} title={preview}>{preview}</span>}
      </span>
      {unread != null && unread > 0 && <StatusBadge status="info" label={`${unread}`} />}
      {note != null && <StatusBadge status="info" label={note} />}
    </Tag>
  );
}
