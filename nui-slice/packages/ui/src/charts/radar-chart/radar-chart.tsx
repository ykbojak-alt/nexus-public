import type { HTMLAttributes } from 'react';
import { ChartFrame } from '../chart-frame';
import { CHART_CHROME, seriesColor } from '../palette';
import { resolveVizState } from '../sufficiency';
import type { ChartA11y, DataFreshness, NexusSeries, VizState } from '../types';
import chrome from '../chart-svg.module.css';

export interface RadarChartProps extends HTMLAttributes<HTMLDivElement> {
  /** Each point.x is an axis label; y is the value on that axis. */
  series: NexusSeries[];
  a11y: ChartA11y;
  freshness?: DataFreshness;
  loading?: boolean;
  error?: boolean;
  state?: VizState;
  /** Explicit axis order; defaults to union of point.x in first-seen order. */
  axes?: string[];
  /** Fractional rings drawn as reference web (default 4 → 25/50/75/100%). */
  rings?: number;
  width?: number;
  height?: number;
  /** Fluid sizing — svg fills container width, keeps viewBox aspect. */
  responsive?: boolean;
}

const LABEL_R = 14;

/**
 * Radar/spider chart — multivariate profile. Each axis normalizes to
 * its own max so heterogeneous units stay comparable (spec §13).
 * Needs ≥3 axes to read as a polygon — fewer renders insufficient.
 */
export function RadarChart({
  series,
  a11y,
  freshness,
  loading,
  error,
  state,
  axes,
  rings = 4,
  width = 480,
  height = 400,
  ...rest
}: RadarChartProps) {
  const base: VizState = state ?? resolveVizState({ loading, error, series, min: 1 });
  const axisCount = axes?.length ?? unionAxes(series).length;
  const resolved: VizState = base === 'ready' && axisCount < 3 ? 'insufficient' : base;
  return (
    <ChartFrame
      testId="radar-chart"
      a11y={a11y}
      state={resolved}
      freshness={freshness}
      width={width}
      height={height}
      {...rest}
    >
      <RadarSvg series={series} axes={axes ?? unionAxes(series)} rings={rings} width={width} height={height} />
    </ChartFrame>
  );
}

function unionAxes(series: NexusSeries[]): string[] {
  const out: string[] = [];
  for (const s of series) {
    for (const p of s.points) {
      const a = String(p.x);
      if (!out.includes(a)) out.push(a);
    }
  }
  return out;
}

function RadarSvg({
  series,
  axes,
  rings,
  width,
  height,
}: {
  series: NexusSeries[];
  axes: string[];
  rings: number;
  width: number;
  height: number;
}) {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - LABEL_R - 12;
  const n = Math.max(3, axes.length);
  const angleAt = (i: number) => -Math.PI / 2 + (i * Math.PI * 2) / n;

  // Per-axis max for normalization (floor at 1e-9 to avoid /0).
  const max = axes.map((a) => {
    let m = 0;
    for (const s of series) {
      const p = s.points.find((pt) => String(pt.x) === a);
      if (p && Number.isFinite(p.y) && Math.abs(p.y) > m) m = Math.abs(p.y);
    }
    return m || 1e-9;
  });

  const pt = (i: number, frac: number): [number, number] => [
    cx + r * frac * Math.cos(angleAt(i)),
    cy + r * frac * Math.sin(angleAt(i)),
  ];

  return (
    <>
      {Array.from({ length: rings }, (_, ri) => {
        const f = (ri + 1) / rings;
        const d = axes.map((_, i) => pt(i, f).join(',')).join(' ');
        return (
          <polygon
            key={ri}
            className={chrome.grid}
            points={`${d} Z`}
            fill="none"
            stroke={ri === rings - 1 ? CHART_CHROME.gridMajor : CHART_CHROME.grid}
          />
        );
      })}
      {axes.map((a, i) => {
        const [ex, ey] = pt(i, 1);
        const [lx, ly] = pt(i, 1 + LABEL_R / r);
        return (
          <g key={a}>
            <line x1={cx} y1={cy} x2={ex} y2={ey} stroke={CHART_CHROME.grid} className={chrome.grid} />
            <text aria-hidden="true" className={chrome.tickLabel} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fill={CHART_CHROME.label}>
              {a}
            </text>
          </g>
        );
      })}
      {series.map((s, si) => {
        const pts = axes.map((a, i) => {
          const p = s.points.find((pt2) => String(pt2.x) === a);
          const v = p && Number.isFinite(p.y) ? Math.abs(p.y) / max[i] : 0;
          return pt(i, Math.min(1, v));
        });
        const color = seriesColor(s.tone, si);
        return (
          <polygon
            key={s.id}
            className={chrome.series}
            data-series={s.id}
            points={pts.map((p) => p.join(',')).join(' ')}
            fill={color}
            fillOpacity={0.16}
            stroke={color}
          />
        );
      })}
    </>
  );
}
