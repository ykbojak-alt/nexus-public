import type { HTMLAttributes } from 'react';
import { ChartFrame } from '../chart-frame';
import { formatTick } from '../chart-math';
import { CHART_CHROME, seriesColor, seriesVar } from '../palette';
import { linearScale } from '../scales';
import type { ChartA11y, ChartTone, DataFreshness, VizState } from '../types';
import chrome from '../chart-svg.module.css';

export interface TimelineSpan {
  id: string;
  /** Lane label — spans with the same lane share a row. */
  lane: string;
  start: number | Date;
  end: number | Date;
  tone?: ChartTone;
  label?: string;
}

export interface TimelineChartProps extends HTMLAttributes<HTMLDivElement> {
  spans: TimelineSpan[];
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

const PAD = { top: 16, right: 16, bottom: 32, left: 120 };
const LANE_H = 28;

function ts(v: number | Date): number {
  return v instanceof Date ? v.getTime() : v;
}

/**
 * Timeline chart — interval spans on a shared time axis, one row per
 * lane. Spans with end ≤ start are dropped as malformed (spec §13:
 * honest rendering, no fabricated geometry).
 */
export function TimelineChart({
  spans,
  a11y,
  freshness,
  loading,
  error,
  state,
  width = 720,
  height = 280,
  ...rest
}: TimelineChartProps) {
  const valid = spans.filter((s) => Number.isFinite(ts(s.start)) && Number.isFinite(ts(s.end)) && ts(s.end) > ts(s.start));
  const resolved: VizState =
    state ?? (loading ? 'loading' : error ? 'error' : spans.length === 0 ? 'empty' : valid.length === 0 ? 'insufficient' : 'ready');
  const laneCount = new Set(valid.map((s) => s.lane)).size;
  const effectiveHeight = Math.max(height, PAD.top + laneCount * (LANE_H + 8) + PAD.bottom);
  return (
    <ChartFrame
      testId="timeline-chart"
      a11y={a11y}
      state={resolved}
      freshness={freshness}
      width={width}
      height={effectiveHeight}
      {...rest}
    >
      <TimelineSvg spans={valid} width={width} height={effectiveHeight} />
    </ChartFrame>
  );
}

function TimelineSvg({ spans, width, height }: { spans: TimelineSpan[]; width: number; height: number }) {
  const lanes: string[] = [];
  for (const s of spans) {
    if (!lanes.includes(s.lane)) lanes.push(s.lane);
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of spans) {
    lo = Math.min(lo, ts(s.start));
    hi = Math.max(hi, ts(s.end));
  }
  const pad = Math.max(1, (hi - lo) * 0.02);
  const x = linearScale([lo - pad, hi + pad], [PAD.left, width - PAD.right]);
  const laneIndex = new Map(lanes.map((l, i) => [l, i]));
  const laneY = (i: number) => PAD.top + i * (LANE_H + 8);

  return (
    <>
      {x.ticks(6).map((t) => (
        <g key={t}>
          <line className={chrome.grid} x1={x(t)} x2={x(t)} y1={PAD.top - 4} y2={height - PAD.bottom} stroke={CHART_CHROME.grid} />
          <text aria-hidden="true" className={chrome.tickLabel} x={x(t)} y={height - PAD.bottom + 14} textAnchor="middle" fill={CHART_CHROME.label}>
            {formatTick(t)}
          </text>
        </g>
      ))}
      {lanes.map((l, i) => (
        <text aria-hidden="true" key={l} className={chrome.tickLabel} x={PAD.left - 8} y={laneY(i) + LANE_H / 2} textAnchor="end" dominantBaseline="middle" fill={CHART_CHROME.label}>
          {l}
        </text>
      ))}
      {spans.map((s) => {
        const i = laneIndex.get(s.lane) ?? 0;
        const y0 = laneY(i);
        const fill = s.tone === undefined ? seriesVar(i) : seriesColor(s.tone, i);
        return (
          <rect
            key={s.id}
            className={chrome.bar}
            data-lane={s.lane}
            data-span={s.id}
            x={x(ts(s.start))}
            y={y0}
            width={x(ts(s.end)) - x(ts(s.start))}
            height={LANE_H}
            rx={4}
            fill={fill}
          />
        );
      })}
    </>
  );
}
