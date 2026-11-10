import type { HTMLAttributes } from 'react';
import { ChartFrame } from '../chart-frame';
import { CHART_CHROME, seriesVar, toneVar } from '../palette';
import { resolveVizState } from '../sufficiency';
import type { ChartA11y, ChartTone, DataFreshness, NexusSeries, VizState } from '../types';
import chrome from '../chart-svg.module.css';

export interface DonutChartProps extends HTMLAttributes<HTMLDivElement> {
  /** Exactly one series — each point is a segment (x=label, y=value). */
  series: NexusSeries;
  a11y: ChartA11y;
  freshness?: DataFreshness;
  loading?: boolean;
  error?: boolean;
  state?: VizState;
  /** Per-segment tones; absent → auto palette slot. */
  tones?: ChartTone[];
  /** Inner radius ratio of the donut hole (0–0.95). */
  innerRadius?: number;
  width?: number;
  height?: number;
  /** Fluid sizing — svg fills container width, keeps viewBox aspect. */
  responsive?: boolean;
}

/**
 * Donut chart — parts of a whole. Segments take the ordered chart
 * palette; center stays DOM-readable via role/aria (spec §13/§14).
 */
export function DonutChart({
  series,
  a11y,
  freshness,
  loading,
  error,
  state,
  tones,
  innerRadius = 0.62,
  width = 360,
  height = 360,
  ...rest
}: DonutChartProps) {
  const resolved: VizState =
    state ??
    resolveVizState({
      loading,
      error,
      series: [series],
      min: 1,
    });
  const total = series.points.reduce((acc, p) => acc + (Number.isFinite(p.y) && p.y > 0 ? p.y : 0), 0);
  const effective: VizState = resolved === 'ready' && total <= 0 ? 'insufficient' : resolved;

  return (
    <ChartFrame
      testId="donut-chart"
      a11y={a11y}
      state={effective}
      freshness={freshness}
      width={width}
      height={height}
      {...rest}
    >
      <DonutSvg series={series} tones={tones} inner={innerRadius} width={width} height={height} total={total} />
    </ChartFrame>
  );
}

function DonutSvg({
  series,
  tones,
  inner,
  width,
  height,
  total,
}: {
  series: NexusSeries;
  tones?: ChartTone[];
  inner: number;
  width: number;
  height: number;
  total: number;
}) {
  const cx = width / 2;
  const cy = height / 2;
  const rOuter = Math.min(width, height) / 2 - 8;
  const rInner = rOuter * Math.min(0.95, Math.max(0, inner));
  let angle = -Math.PI / 2; // start at top

  return (
    <>
      {series.points.map((p, i) => {
        if (!Number.isFinite(p.y) || p.y <= 0 || total <= 0) return null;
        const frac = p.y / total;
        const a0 = angle;
        const a1 = angle + frac * Math.PI * 2;
        angle = a1;
        return (
          <path
            key={String(p.x)}
            data-segment={String(p.x)}
            d={donutSlice(cx, cy, rOuter, rInner, a0, a1)}
            fill={tones?.[i] ? toneVar(tones[i]) : seriesVar(i)}
          />
        );
      })}
      <text aria-hidden="true"
        className={chrome.tickLabel}
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={CHART_CHROME.label}
      >
        {series.label}
      </text>
    </>
  );
}

function polar(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function donutSlice(cx: number, cy: number, ro: number, ri: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, ro, a0);
  const [x1, y1] = polar(cx, cy, ro, a1);
  const [x2, y2] = polar(cx, cy, ri, a1);
  const [x3, y3] = polar(cx, cy, ri, a0);
  // Full circle degenerates to two arcs — handled by 99.99% cap upstream.
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    const mid = a0 + Math.PI;
    const [mx, my] = polar(cx, cy, ro, mid);
    const [mx2, my2] = polar(cx, cy, ri, mid);
    return `M ${x0} ${y0} A ${ro} ${ro} 0 1 1 ${mx} ${my} A ${ro} ${ro} 0 1 1 ${x1} ${y1} L ${x2} ${y2} A ${ri} ${ri} 0 1 0 ${mx2} ${my2} A ${ri} ${ri} 0 1 0 ${x3} ${y3} Z`;
  }
  return `M ${x0} ${y0} A ${ro} ${ro} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${ri} ${ri} 0 ${large} 0 ${x3} ${y3} Z`;
}
