import type { HTMLAttributes } from 'react';
import { ChartFrame } from '../chart-frame';
import { formatTick } from '../chart-math';
import { CHART_CHROME, seriesColor } from '../palette';
import { bandScale, linearScale } from '../scales';
import { resolveVizState } from '../sufficiency';
import type { ChartA11y, DataFreshness, NexusSeries, VizState } from '../types';
import chrome from '../chart-svg.module.css';

export interface StackedBarChartProps extends HTMLAttributes<HTMLDivElement> {
  /** Series stack within each category; missing points count as zero. */
  series: NexusSeries[];
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

const PAD = { top: 16, right: 16, bottom: 32, left: 48 };

/**
 * Stacked bar chart — composition of a total per category. Positive
 * and negative contributions stack from the zero baseline separately
 * (spec §13).
 */
export function StackedBarChart({
  series,
  a11y,
  freshness,
  loading,
  error,
  state,
  width = 640,
  height = 360,
  ...rest
}: StackedBarChartProps) {
  const resolved: VizState = state ?? resolveVizState({ loading, error, series, min: 1 });
  return (
    <ChartFrame
      testId="stacked-bar-chart"
      a11y={a11y}
      state={resolved}
      freshness={freshness}
      width={width}
      height={height}
      {...rest}
    >
      <StackSvg series={series} width={width} height={height} />
    </ChartFrame>
  );
}

function StackSvg({ series, width, height }: { series: NexusSeries[]; width: number; height: number }) {
  const cats: string[] = [];
  for (const s of series) {
    for (const p of s.points) {
      const c = String(p.x);
      if (!cats.includes(c)) cats.push(c);
    }
  }
  // Stacked extent = largest cumulative sum in each direction.
  let lo = 0;
  let hi = 0;
  for (const c of cats) {
    let pos = 0;
    let neg = 0;
    for (const s of series) {
      const p = s.points.find((pt) => String(pt.x) === c);
      const v = p && Number.isFinite(p.y) ? p.y : 0;
      if (v >= 0) pos += v;
      else neg += v;
    }
    if (pos > hi) hi = pos;
    if (neg < lo) lo = neg;
  }
  if (lo === hi) hi = 1;

  const x = bandScale(cats, [PAD.left, width - PAD.right], 0.3);
  const y = linearScale([lo * 1.05 || lo, hi * 1.05], [height - PAD.bottom, PAD.top]);
  const baseline = y(0);

  return (
    <>
      {y.ticks(5).map((t) => (
        <g key={t}>
          <line className={chrome.grid} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={CHART_CHROME.grid} />
          <text aria-hidden="true" className={chrome.tickLabel} x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fill={CHART_CHROME.label}>
            {formatTick(t)}
          </text>
        </g>
      ))}
      <line className={chrome.axis} x1={PAD.left} x2={width - PAD.right} y1={baseline} y2={baseline} stroke={CHART_CHROME.axis} />

      {cats.map((c) => (
        <text aria-hidden="true"
          key={c}
          className={chrome.tickLabel}
          x={x(c) + x.bandwidth() / 2}
          y={height - PAD.bottom + 14}
          textAnchor="middle"
          fill={CHART_CHROME.label}
        >
          {c}
        </text>
      ))}

      {cats.map((c) => {
        let posAcc = 0;
        let negAcc = 0;
        return series.map((s, si) => {
          const p = s.points.find((pt) => String(pt.x) === c);
          const v = p && Number.isFinite(p.y) ? p.y : 0;
          if (v === 0) return null;
          const a0 = v >= 0 ? posAcc : negAcc;
          const a1 = a0 + v;
          if (v >= 0) posAcc = a1;
          else negAcc = a1;
          return (
            <rect
              key={`${c}-${s.id}`}
              className={chrome.bar}
              data-series={s.id}
              data-category={c}
              x={x(c)}
              y={Math.min(y(a0), y(a1))}
              width={x.bandwidth()}
              height={Math.abs(y(a0) - y(a1))}
              fill={seriesColor(s.tone, si)}
            />
          );
        });
      })}
    </>
  );
}
