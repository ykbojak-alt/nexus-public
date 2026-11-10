import type { HTMLAttributes } from 'react';
import { ChartFrame } from '../chart-frame';
import { CHART_CHROME, toneVar } from '../palette';
import { linearScale } from '../scales';
import { formatTick } from '../chart-math';
import type { ChartA11y, ChartTone, DataFreshness, VizState } from '../types';
import chrome from '../chart-svg.module.css';

/**
 * Point-in-time event on a shared time axis (Runtime event ribbon,
 * plan 2026-10-13 §W4). Unlike TimelineChart spans, an event has no
 * duration — its meaning is WHEN + WHAT, never an invented interval.
 */
export interface RibbonEvent {
  id: string;
  ts: number | Date;
  /** Lane label — events with the same lane share a row (e.g. agent role). */
  lane: string;
  label: string;
  /** Semantic tone — never a raw color (spec §13). */
  tone?: ChartTone;
}

export interface EventRibbonProps extends HTMLAttributes<HTMLDivElement> {
  events: RibbonEvent[];
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

const PAD = { top: 12, right: 20, bottom: 30, left: 96 };
const LANE_H = 26;

function ts(v: number | Date): number {
  return v instanceof Date ? v.getTime() : v;
}

/**
 * Structural mapper: Runtime run events (RunEventView-compatible
 * `{seq, type, role, ts, body}`) → ribbon events. Event-type → tone:
 * - `final` → positive, unless stop_reason marks failure → negative;
 * - `error`/`timeout`/`cancelled`-ish → negative;
 * - `spawn`/`handoff`/`approval`/`checkpoint`/`pause`/`resume` → threshold
 *   (control boundary markers — spec: statuses handoff/checkpoint);
 * - `plan.*` → primary; `model_call` → violet; `tool_*` → energy;
 * - everything else → neutral. Unknown event types are never dropped —
 *   they render neutral, because hidden events lie about the run.
 */
export function mapRunEvents(
  events: ReadonlyArray<{ seq?: number; type: string; role?: string | null; ts?: number | Date; body?: unknown }>,
): RibbonEvent[] {
  return events.map((e, i) => {
    const body = (e.body ?? {}) as Record<string, unknown>;
    return {
      id: `ev-${e.seq ?? i}`,
      ts: e.ts ?? 0,
      lane: e.role ?? 'run',
      label: eventLabel(e, body),
      tone: eventTone(e.type, body),
    };
  });
}

function eventLabel(e: { seq?: number; type: string; role?: string | null }, body: Record<string, unknown>): string {
  const step = typeof body.step === 'number' ? ` #${body.step}` : '';
  const tool = typeof body.tool === 'string' ? ` ${body.tool}` : '';
  const reason = typeof body.stop_reason === 'string' ? ` (${body.stop_reason})` : '';
  const model = typeof body.model === 'string' ? ` ${body.model}` : '';
  const agent = typeof body.agent === 'string' ? ` → ${body.agent}` : '';
  return `${e.type}${step}${tool}${model}${agent}${reason}`;
}

function eventTone(type: string, body: Record<string, unknown>): ChartTone {
  if (type === 'final') {
    const stop = String(body.stop_reason ?? 'done');
    return stop === 'done' ? 'positive' : 'negative';
  }
  if (/error|timeout|cancelled|failed/.test(type)) return 'negative';
  if (/spawn|handoff|approval|checkpoint|pause|resume/.test(type)) return 'threshold';
  if (/^plan\./.test(type)) return 'primary';
  if (/model_call/.test(type)) return 'violet';
  if (/tool_/.test(type)) return 'energy';
  return 'neutral';
}

/**
 * Event ribbon — readable run-event tape. Lanes preserve first-appearance
 * order (deterministic, no sorting surprises); malformed timestamps drop
 * out, and if nothing valid remains the frame reports `insufficient`.
 */
export function EventRibbon({
  events,
  a11y,
  freshness,
  loading,
  error,
  state,
  width = 720,
  height,
  ...rest
}: EventRibbonProps) {
  const valid = events.filter((e) => Number.isFinite(ts(e.ts)));
  const resolved: VizState =
    state ?? (loading ? 'loading' : error ? 'error' : events.length === 0 ? 'empty' : valid.length === 0 ? 'insufficient' : 'ready');
  const lanes: string[] = [];
  for (const e of valid) if (!lanes.includes(e.lane)) lanes.push(e.lane);
  const effectiveHeight = height ?? PAD.top + PAD.bottom + lanes.length * LANE_H;

  return (
    <ChartFrame testId="event-ribbon" a11y={a11y} state={resolved} freshness={freshness} width={width} height={effectiveHeight} {...rest}>
      <RibbonSvg events={valid} lanes={lanes} width={width} height={effectiveHeight} />
    </ChartFrame>
  );
}

function RibbonSvg({ events, lanes, width, height }: { events: RibbonEvent[]; lanes: string[]; width: number; height: number }) {
  const xs = events.map((e) => ts(e.ts));
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const x = linearScale([lo, hi === lo ? lo + 1 : hi], [PAD.left, width - PAD.right]);
  const laneY = (lane: string) => PAD.top + lanes.indexOf(lane) * LANE_H + LANE_H / 2;

  return (
    <>
      {lanes.map((lane) => (
        <g key={lane}>
          <text aria-hidden="true"
            className={chrome.tickLabel}
            x={PAD.left - 10}
            y={laneY(lane)}
            textAnchor="end"
            dominantBaseline="middle"
            fill={CHART_CHROME.label}
          >
            {lane}
          </text>
          <line
            className={chrome.grid}
            x1={PAD.left}
            x2={width - PAD.right}
            y1={laneY(lane)}
            y2={laneY(lane)}
            stroke={CHART_CHROME.grid}
            strokeDasharray="2 4"
          />
        </g>
      ))}

      {events.map((e) => (
        <circle
          key={e.id}
          data-event={e.id}
          cx={x(ts(e.ts))}
          cy={laneY(e.lane)}
          r={4.5}
          className={chrome.dot}
          fill={toneVar(e.tone ?? 'neutral')}
          stroke={CHART_CHROME.axis}
        >
          <title>{`${e.lane} · ${e.label}`}</title>
        </circle>
      ))}

      <line
        className={chrome.axis}
        x1={PAD.left}
        x2={width - PAD.right}
        y1={height - PAD.bottom + 8}
        y2={height - PAD.bottom + 8}
        stroke={CHART_CHROME.axis}
      />
      {x.ticks(5).map((t) => (
        <text aria-hidden="true"
          key={t}
          className={chrome.tickLabel}
          x={x(t)}
          y={height - PAD.bottom + 24}
          textAnchor="middle"
          fill={CHART_CHROME.label}
        >
          {formatTick(t)}
        </text>
      ))}
    </>
  );
}
