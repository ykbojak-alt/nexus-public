import type { HTMLAttributes } from 'react';
import styles from './compact-summary.module.css';

export interface CompactBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Exact number of compacted messages. */
  count: number;
  /** True when count is a lower bound (displayed with +), not an exact total. */
  atLeast?: boolean;
  expanded?: boolean;
}

function messageNoun(count: number): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'сообщений';
  switch (count % 10) {
    case 1: return 'сообщение';
    case 2:
    case 3:
    case 4: return 'сообщения';
    default: return 'сообщений';
  }
}

export function formatCompactMessageCount(count: number, atLeast = false): { display: string; accessible: string } | null {
  if (!Number.isSafeInteger(count) || count < 0) return null;
  const formatted = new Intl.NumberFormat('ru-RU').format(count);
  const quantity = `${formatted}${atLeast ? '+' : ''}`;
  const noun = messageNoun(count);
  return {
    display: `${quantity} ${noun}`,
    accessible: `${atLeast ? 'Не менее ' : ''}${formatted} ${noun} сжато`,
  };
}

/** Compact message count with a full Russian accessible label. */
export function CompactBadge({
  count,
  atLeast = false,
  expanded = false,
  className,
  ...rest
}: CompactBadgeProps) {
  const formatted = formatCompactMessageCount(count, atLeast);
  const visualCount = formatted == null ? '—' : `${new Intl.NumberFormat('ru-RU').format(count)}${atLeast ? '+' : ''}`;
  const label = formatted == null
    ? 'Счётчик сжатых сообщений недоступен'
    : formatted.accessible;

  return (
    <span
      {...rest}
      className={[styles.badge, className].filter(Boolean).join(' ')}
      data-state={expanded ? 'expanded' : 'default'}
      role="img"
      aria-label={label}
      title={label}
    >
      {visualCount}
    </span>
  );
}
