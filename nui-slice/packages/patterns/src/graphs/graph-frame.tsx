import type { HTMLAttributes, ReactNode } from 'react';
import type { DataFreshness, VizState } from './types';

export interface GraphFrameProps extends HTMLAttributes<HTMLDivElement> {
  testId: string;
  title: string;
  description?: string;
  state: VizState;
  freshness?: DataFreshness;
  width?: number;
  height?: number;
  /** True when the svg hosts focusable node controls — svg gets role="group". */
  interactive?: boolean;
  children?: ReactNode;
}

const STATE_TEXT: Record<Exclude<VizState, 'ready' | 'stale'>, string> = {
  loading: 'Loading…',
  empty: 'No data',
  error: 'Failed to load',
  insufficient: 'Insufficient data',
};

/** Shared graph shell — same contract as ChartFrame (state/freshness/a11y). */
export function GraphFrame({
  testId,
  title,
  description,
  state,
  freshness,
  width = 640,
  height = 400,
  interactive = false,
  className,
  children,
  ...rest
}: GraphFrameProps) {
  const renderable = state === 'ready' || state === 'stale';
  return (
    <div data-testid={testId} data-state={state} data-freshness={freshness} className={className} {...rest}>
      {renderable ? (
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role={interactive ? 'group' : 'img'} aria-label={title}>
          <title>{title}</title>
          {description ? <desc>{description}</desc> : null}
          {children}
        </svg>
      ) : (
        <div role="status" style={{ width, height, display: 'grid', placeItems: 'center' }}>
          {STATE_TEXT[state]}
        </div>
      )}
    </div>
  );
}

/** Node status → generated state token (semantic/state.tokens.json). */
export function statusVar(status: string | undefined): string {
  switch (status) {
    case 'active':
      return 'var(--nexus-state-active)';
    case 'executing':
      return 'var(--nexus-state-executing)';
    case 'done':
    case 'complete':
      return 'var(--nexus-state-complete)';
    case 'failed':
    case 'error':
      return 'var(--nexus-state-error)';
    case 'skipped':
    case 'offline':
      return 'var(--nexus-state-offline)';
    case 'waiting':
    case 'pending':
      return 'var(--nexus-state-waiting)';
    case 'syncing':
      return 'var(--nexus-state-syncing)';
    case 'thinking':
      return 'var(--nexus-state-thinking)';
    case 'validating':
      return 'var(--nexus-state-validating)';
    case 'warning':
      return 'var(--nexus-state-warning)';
    case 'info':
      return 'var(--nexus-state-info)';
    case 'idle':
      return 'var(--nexus-state-waiting)';
    case 'busy':
      return 'var(--nexus-state-executing)';
    case 'online':
      return 'var(--nexus-state-online)';
    case 'paused':
      return 'var(--nexus-state-paused)';
    default:
      return 'var(--nexus-chart-axis)';
  }
}
