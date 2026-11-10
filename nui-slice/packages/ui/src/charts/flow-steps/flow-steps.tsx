import type { HTMLAttributes } from 'react';
import { ChartFrame } from '../chart-frame';
import { CHART_CHROME, toneVar } from '../palette';
import type { ChartA11y, ChartTone, DataFreshness, VizState } from '../types';
import chrome from '../chart-svg.module.css';

/**
 * One step in a provider/session lifecycle (Runtime pack,
 * plan 2026-10-13 §W4). The caller owns the truth — a step's status is
 * mapped from the confirmed contract vocabulary, never invented.
 */
export type FlowStepStatus = 'done' | 'current' | 'pending' | 'blocked' | 'skipped';

export interface FlowStep {
  id: string;
  label: string;
  status?: FlowStepStatus;
}

export interface FlowStepsProps extends HTMLAttributes<HTMLDivElement> {
  steps: FlowStep[];
  a11y: ChartA11y;
  freshness?: DataFreshness;
  loading?: boolean;
  error?: boolean;
  state?: VizState;
  width?: number;
  height?: number;
  /** Fluid sizing — svg fills container width, keeps viewBox aspect. */
  responsive?: boolean;
}

const W = 640;
const H = 120;
const PAD = { top: 30, right: 40, bottom: 26, left: 40 };
const NODE_R = 7;

const STATUS_TONE: Record<FlowStepStatus, ChartTone> = {
  done: 'positive',
  current: 'primary',
  pending: 'neutral',
  blocked: 'negative',
  skipped: 'neutral',
};

/**
 * Structural lifecycle mapper: an ordered contract vocabulary plus the
 * confirmed current state → steps with statuses. `current: null` means
 * the state is unknown — every step stays pending, and nothing is
 * marked done that was not confirmed.
 */
export function mapLifecycle(
  states: readonly string[],
  current: string | null,
  outcome?: { blocked?: string | null; skipped?: readonly string[] },
): FlowStep[] {
  const idx = current == null ? -1 : states.indexOf(current);
  return states.map((s, i) => ({
    id: s,
    label: s,
    status:
      outcome?.blocked === s
        ? 'blocked'
        : outcome?.skipped?.includes(s)
          ? 'skipped'
          : idx < 0
            ? 'pending'
            : i < idx
              ? 'done'
              : i === idx
                ? 'current'
                : 'pending',
  }));
}

/**
 * Flow steps — a lifecycle strip for provider/session states (connect →
 * auth → ready, open → close, permission → sync, idle → running →
 * paused). Steps sit on one axis; a blocked step marks the boundary the
 * flow stopped at. No progress is drawn that the source did not state.
 */
export function FlowSteps({
  steps,
  a11y,
  freshness,
  loading,
  error,
  state,
  width = W,
  height = H,
  ...rest
}: FlowStepsProps) {
  const resolved: VizState =
    state ?? (loading ? 'loading' : error ? 'error' : steps.length === 0 ? 'empty' : 'ready');

  return (
    <ChartFrame testId="flow-steps" a11y={a11y} state={resolved} freshness={freshness} width={width} height={height} {...rest}>
      <StepsSvg steps={steps} width={width} height={height} />
    </ChartFrame>
  );
}

function StepsSvg({ steps, width, height }: { steps: FlowStep[]; width: number; height: number }) {
  const n = steps.length;
  const y = PAD.top;
  const x = (i: number) => (n === 1 ? width / 2 : PAD.left + (i * (width - PAD.left - PAD.right)) / (n - 1));

  return (
    <>
      {steps.slice(0, -1).map((_, i) => (
        <line
          key={`e-${i}`}
          className={chrome.grid}
          x1={x(i) + NODE_R}
          x2={x(i + 1) - NODE_R}
          y1={y}
          y2={y}
          stroke={CHART_CHROME.grid}
          strokeDasharray={steps[i].status === 'done' ? undefined : '2 4'}
        />
      ))}

      {steps.map((s, i) => {
        const tone = STATUS_TONE[s.status ?? 'pending'];
        return (
          <g key={s.id} data-step={s.id} data-status={s.status ?? 'pending'}>
            <circle
              cx={x(i)}
              cy={y}
              r={NODE_R}
              className={chrome.dot}
              fill={toneVar(tone)}
              stroke={CHART_CHROME.axis}
              strokeDasharray={s.status === 'skipped' ? '2 2' : undefined}
            >
              <title>{`${s.label} · ${s.status ?? 'pending'}`}</title>
            </circle>
            <text aria-hidden="true"
              className={chrome.tickLabel}
              x={x(i)}
              y={y + NODE_R + 16}
              textAnchor="middle"
              fill={s.status === 'current' ? toneVar('primary') : CHART_CHROME.label}
            >
              {s.label}
            </text>
          </g>
        );
      })}
    </>
  );
}
