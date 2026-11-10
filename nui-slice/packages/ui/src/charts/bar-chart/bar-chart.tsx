import type { HTMLAttributes } from 'react';
import { ChartFrame } from '../chart-frame';
import { formatTick } from '../chart-math';
import { CHART_CHROME, seriesColor } from '../palette';
import { bandScale, linearScale, seriesExtent } from '../scales';
import { resolveVizState } from '../sufficiency';
import type { ChartA11y, DataFreshness, NexusSeries, VizState } from '../types';
import chrome from '../chart-svg.module.css';

export interface BarChartProps extends HTMLAttributes<HTMLDivElement> {
  /** Series points: x = category label (string) or index. */
  series: NexusSeries[];
  a11y: ChartA11y;
  freshness?: DataFreshness;
  loading?: boolean;
  error?: boolean;
  state?: VizState;
  /** Grouped bars place series side-by-side inside a category slot. */
  grouped?: boolean;
  /** Axis-less sparkline mode — Lux KPI tiles (VIS-W4-02). */
  bare?: boolean;
  width?: number;
  height?: number;
  /** Fluid sizing — svg fills container width, keeps viewBox aspect. */
  responsive?: boolean;
}

const PAD = { top: 16, right: 16, bottom: 32, left: 48 };

/**
 * Vertical bar chart on categorical x. Bars always rise from the zero
 * baseline; grouped mode splits the band between series (spec §13).
 */
export function BarChart({
  series,
  a11y,
  freshness,
  loading,
  error,
  state,
  grouped = true,
  bare = false,
  width = 640,
  height = 360,
  ...rest
}: BarChartProps) {
  const resolved: VizState = state ?? resolveVizState({ loading, error, series, min: 1 });
  return (
    <ChartFrame
      testId="bar-chart"
      a11y={a11y}
      state={resolved}
      freshness={freshness}
      width={width}
      height={height}
      {...rest}
    >
      <BarSvg series={series} grouped={grouped} bare={bare} width={width} height={height} />
    </ChartFrame>
  );
}

const BARE_PAD = { top: 4, right: 4, bottom: 4, left: 4 };

function BarSvg({
  series,
  grouped,
  bare,
  width,
  height,
}: {
  series: NexusSeries[];
  grouped: boolean;
  bare: boolean;
  width: number;
  height: number;
}) {
  const pad = bare ? BARE_PAD : PAD;
  // Union of category labels in first-seen order.
  const cats: string[] = [];
  for (const s of series) {
    for (const p of s.points) {
      const c = String(p.x);
      if (!cats.includes(c)) cats.push(c);
    }
  }
  const x = bandScale(cats, [pad.left, width - pad.right], 0.25);
  const y = linearScale(seriesExtent(series, { includeZero: true }), [height - pad.bottom, pad.top]);
  const baseline = y(0);
  const slots = grouped ? series.length : 1;
  const slotW = x.bandwidth() / slots;

  return (
    <>
      {!bare &&
        y.ticks(5).map((t) => (
          <g key={t}>
            <line className={chrome.grid} x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={CHART_CHROME.grid} />
            <text aria-hidden="true" className={chrome.tickLabel} x={pad.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fill={CHART_CHROME.label}>
              {formatTick(t)}
            </text>
          </g>
        ))}
      {!bare && (
        <line className={chrome.axis} x1={pad.left} x2={width - pad.right} y1={baseline} y2={baseline} stroke={CHART_CHROME.axis} />
      )}

      {!bare &&
        cats.map((c) => (
          <text aria-hidden="true"
            key={c}
            className={chrome.tickLabel}
            x={x(c) + x.bandwidth() / 2}
            y={height - pad.bottom + 14}
            textAnchor="middle"
            fill={CHART_CHROME.label}
          >
            {c}
          </text>
        ))}

      {series.map((s, si) =>
        s.points.map((p) => {
          const cat = String(p.x);
          if (!Number.isFinite(p.y)) return null;
          const top = Math.min(y(p.y), baseline);
          const h = Math.abs(y(p.y) - baseline);
          return (
            <rect
              key={`${s.id}-${cat}`}
              className={chrome.bar}
              data-series={s.id}
              data-category={cat}
              x={x(cat) + (grouped ? si * slotW : 0)}
              y={top}
              width={Math.max(1, grouped ? slotW - 2 : x.bandwidth())}
              height={h}
              rx={Math.min(3, Math.max(0, h / 2))}
              fill={seriesColor(s.tone, si)}
            />
          );
        }),
      )}
    </>
  );
}
