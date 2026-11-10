import type { HTMLAttributes, ReactNode } from 'react';
import type { ChartA11y, DataFreshness, VizState } from './types';
import styles from './chart-frame.module.css';

export interface ChartFrameProps extends HTMLAttributes<HTMLDivElement> {
  /** Stable component id — becomes data-testid (harness contract §3). */
  testId: string;
  a11y: ChartA11y;
  state: VizState;
  freshness?: DataFreshness;
  width?: number;
  height?: number;
  /**
   * Fluid sizing: svg keeps the numeric viewBox but fills container
   * width and scales height by aspect — container-resize safe.
   */
  responsive?: boolean;
  /** SVG scene — rendered only for ready/stale states. */
  children?: ReactNode;
}

const STATE_TEXT: Record<Exclude<VizState, 'ready' | 'stale'>, string> = {
  loading: 'Loading…',
  empty: 'No data',
  error: 'Failed to load',
  insufficient: 'Insufficient data',
};

/**
 * Shared chart frame: root attrs (testid/state/freshness), honest state
 * panel for non-ready states, accessible svg wrapper for ready ones.
 * Geometry/chrome stay inside each chart — this owns only the shell.
 */
export function ChartFrame({
  testId,
  a11y,
  state,
  freshness,
  width = 640,
  height = 360,
  responsive = false,
  className,
  children,
  ...rest
}: ChartFrameProps) {
  const renderable = state === 'ready' || state === 'stale';
  return (
    <div
      data-testid={testId}
      data-state={state}
      data-freshness={freshness}
      className={[styles.root, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {renderable ? (
        <svg
          className={styles.svg}
          viewBox={`0 0 ${width} ${height}`}
          width={responsive ? '100%' : width}
          height={responsive ? undefined : height}
          style={responsive ? { height: 'auto' } : undefined}
          role="img"
          aria-label={a11y.title}
        >
          <title>{a11y.title}</title>
          {a11y.description ? <desc>{a11y.description}</desc> : null}
          {children}
        </svg>
      ) : (
        <div className={styles.statePanel} style={{ width, height }}>
          <span className={styles.stateText}>{STATE_TEXT[state]}</span>
        </div>
      )}
    </div>
  );
}
