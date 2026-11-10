import type { ReactNode } from 'react';
import type { GlassTone } from '../../surfaces/glass-bars/glass-surface';
import styles from '../feedback.module.css';

export interface LoadingStateProps {
  className?: string;
  /** Hint text — what is loading, verbatim. */
  children: ReactNode;
  /** Persona tint of the pulse dot via [data-persona] → personaText.*. */
  tone?: GlassTone;
}

/** Inline loading hint (W2-02): the text-level counterpart of Skeleton —
 *  use when a populated panel reports "loading …" rather than a content
 *  shape. Announces politely via role="status"; the pulse dot is decorative
 *  and freezes under prefers-reduced-motion. */
export function LoadingState({ className, children, tone }: LoadingStateProps) {
  return (
    <p className={[styles.stateHint, className].filter(Boolean).join(' ')}
      data-testid="loading-state" data-state="loading" data-persona={tone} role="status">
      <span className={styles.loadingDot} aria-hidden="true" />
      {children}
    </p>
  );
}
