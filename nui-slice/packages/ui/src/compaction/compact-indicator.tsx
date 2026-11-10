import type { HTMLAttributes } from 'react';
import styles from './compact-block.module.css';

export type CompactState = 'normal' | 'warning' | 'active';
export type CompactIndicatorPattern = 'dots' | 'bar';

export interface CompactIndicatorProps extends HTMLAttributes<HTMLSpanElement> {
  state: CompactState;
  pattern?: CompactIndicatorPattern;
}

const stateLabels: Record<CompactState, string> = {
  normal: 'Обычный режим',
  warning: 'Скоро потребуется компактизация',
  active: 'Идёт компактизация',
};

/** Non-metric state glyph. State is conveyed by text as well as its pattern/color. */
export function CompactIndicator({
  state,
  pattern = 'dots',
  className,
  ...rest
}: CompactIndicatorProps) {
  const label = stateLabels[state];
  return (
    <span
      {...rest}
      className={[styles.indicator, styles[pattern], className].filter(Boolean).join(' ')}
      data-state={state}
      role="img"
      aria-label={label}
    >
      {pattern === 'dots'
        ? <><i /><i /><i /></>
        : <><i /><i /></>}
    </span>
  );
}
