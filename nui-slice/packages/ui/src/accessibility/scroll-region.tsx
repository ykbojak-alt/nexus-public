import type { HTMLAttributes, ReactNode } from 'react';
import './focus-ring.css';
import styles from './scroll-region.module.css';

export interface ScrollRegionProps extends HTMLAttributes<HTMLDivElement> {
  /** Accessible name for the scrollable area — required, Russian UI copy. */
  label: string;
  /** Scroll axis: 'y' (default) or 'both'. */
  axis?: 'y' | 'both';
  children?: ReactNode;
}

/**
 * Scrollable region that stays keyboard-reachable: tabIndex=0 puts it in the
 * tab order, `label` names it for assistive tech, and the focus ring comes
 * from the shared [tabindex]:focus-visible token rule. Fixes axe
 * scrollable-region-focusable on custom scroller divs — use instead of a
 * bare `overflow:auto` container.
 */
export function ScrollRegion({ label, axis = 'y', className, children, ...rest }: ScrollRegionProps) {
  return (
    <div
      {...rest}
      className={[styles.root, className].filter(Boolean).join(' ')}
      tabIndex={0}
      role="region"
      aria-label={label}
      data-axis={axis}
    >
      {children}
    </div>
  );
}
