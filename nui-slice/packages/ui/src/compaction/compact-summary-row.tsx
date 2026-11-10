import { useId, useState, type HTMLAttributes, type ReactNode } from 'react';
import { CompactBadge, formatCompactMessageCount } from './compact-badge';
import styles from './compact-summary.module.css';

export interface CompactSummaryRowProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Exact count from the compaction record. */
  count: number;
  /** Optional lower-bound marker for saturated counts such as 120+. */
  atLeast?: boolean;
  /** Already formatted source timestamps, e.g. "10:24–10:31". */
  timeRange: string;
  defaultExpanded?: boolean;
  children?: ReactNode;
}

/** Shared collapsed/expanded compact-history row for conversation feeds. */
export function CompactSummaryRow({
  count,
  atLeast = false,
  timeRange,
  defaultExpanded = false,
  children,
  className,
  ...rest
}: CompactSummaryRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentId = useId();
  const messageCount = formatCompactMessageCount(count, atLeast)?.display ?? 'Количество сообщений недоступно';

  return (
    <section
      {...rest}
      className={[styles.row, className].filter(Boolean).join(' ')}
      data-expanded={expanded}
      role="group"
      aria-label="Сжатая история"
    >
      <button
        className={styles.toggle}
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={styles.copy}>
          <span className={styles.primary}>Сжатая история</span>
          <span className={styles.secondary}>{messageCount} · {timeRange}</span>
        </span>
        <CompactBadge count={count} atLeast={atLeast} expanded={expanded} />
        <span className={styles.disclosure} aria-hidden="true" />
      </button>
      <div id={contentId} className={styles.content} role="region" aria-label="Содержимое сжатой истории" hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
