import { useId, useState, type HTMLAttributes, type ReactNode } from 'react';
import type { CompactIndicatorPattern, CompactState } from './compact-indicator';
import { CompactIndicator } from './compact-indicator';
import styles from './compact-block.module.css';

const stateLabels: Record<CompactState, string> = {
  normal: 'Обычный режим',
  warning: 'Скоро потребуется компактизация',
  active: 'Идёт компактизация',
};

export interface CompactBlockProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: string;
  state?: CompactState;
  indicator?: CompactIndicatorPattern;
  defaultExpanded?: boolean;
  children: ReactNode;
}

/** Shared collapsible glass-toned block for compacted dialogue context. */
export function CompactBlock({
  title,
  state = 'normal',
  indicator = 'dots',
  defaultExpanded = false,
  children,
  className,
  ...rest
}: CompactBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentId = useId();
  return (
    <section
      {...rest}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-state={state}
      data-expanded={expanded}
      role="group"
      aria-label={title}
    >
      <button
        className={styles.toggle}
        type="button"
        aria-label={`${title} — ${stateLabels[state]}`}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={styles.heading}>{title}</span>
        <span className={styles.status}>
          <CompactIndicator state={state} pattern={indicator} />
          {stateLabels[state]}
        </span>
        <span className={styles.chevron} aria-hidden="true" />
      </button>
      <div id={contentId} className={styles.content} role="region" aria-label={`${title} — содержимое`} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
