import type { HTMLAttributes } from 'react';
import { ChartFrame } from '../chart-frame';
import { isCategoricalX, xPositions, xValue, formatTick } from '../chart-math';
import { CHART_CHROME, seriesColor } from '../palette';
import { linearScale, seriesExtent } from '../scales';
import { resolveVizState } from '../sufficiency';
import type { ChartA11y, DataFreshness, NexusSeries, VizState } from '../types';
import chrome from '../chart-svg.module.css';

export interface AreaChartProps extends HTMLAttributes<HTMLDivElement> {
  series: NexusSeries[];
  a11y: ChartA11y;
  freshness?: DataFreshness;
  loading?: boolean;
  error?: boolean;
  state?: VizState;
  /** Fill opacity of the area under each series (restrained, spec §9). */
  fillOpacity?: number;
  includeZero?: boolean;
  /** Axis-less sparkline mode — Lux KPI tiles (VIS-W4-02). */
  bare?: boolean;
  width?: number;
  height?: number;
  /** Fluid sizing — svg fills container width, keeps viewBox aspect. */
  responsive?: boolean;
}

const PAD = { top: 16, right: 16, bottom: 32, left: 48 };

/**
 * Area chart — same geometry as LineChart plus a token-toned fill to
 * the zero baseline. SVG render, honest states (spec §13).
 */
export function AreaChart({
  series,
  a11y,
  freshness,
  loading,
  error,
  state,
  fillOpacity = 0.16,
  includeZero = true,
  bare = false,
  width = 640,
  height = 360,
  ...rest
}: AreaChartProps) {
  const resolved: VizState = state ?? resolveVizState({ loading, error, series, min: 2 });
  return (
    <ChartFrame
      testId="area-chart"
      a11y={a11y}
      state={resolved}
      freshness={freshness}
      width={width}
      height={height}
      {...rest}
    >
      <AreaSvg series={series} includeZero={includeZero} fillOpacity={fillOpacity} bare={bare} width={width} height={height} />
    </ChartFrame>
  );
}

const BARE_PAD = { top: 4, right: 4, bottom: 4, left: 4 };

function AreaSvg({
  series,
  includeZero,
  fillOpacity,
  bare,
  width,
  height,
}: {
  series: NexusSeries[];
  includeZero: boolean;
  fillOpacity: number;
  bare: boolean;
  width: number;
  height: number;
}) {
  const pad = bare ? BARE_PAD : PAD;
  const categorical = isCategoricalX(series);
  const xs = xPositions(series, categorical);
  const xMin = xs.length ? Math.min(...xs) : 0;
  const xMax = xs.length ? Math.max(...xs) : 1;
  const x = linearScale(
    [Number.isFinite(xMin) ? xMin : 0, xMax !== xMin ? xMax : xMin + 1],
    [pad.left, width - pad.right],
  );
  const y = linearScale(seriesExtent(series, { includeZero }), [height - pad.bottom, pad.top]);
  const baseline = y(0);

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

      {series.map((s, i) => {
        const pts = s.points
          .map((p, idx) => {
            const px = x(categorical ? idx : xValue(p));
            return Number.isFinite(px) && Number.isFinite(p.y) ? ([px, y(p.y)] as const) : null;
          })
          .filter((p): p is readonly [number, number] => p !== null);
        if (pts.length < 2) return null;
        const line = pts.map(([px, py]) => `${px},${py}`).join(' ');
        const area = `${pts[0][0]},${baseline} ${line} ${pts[pts.length - 1][0]},${baseline}`;
        const color = seriesColor(s.tone, i);
        return (
          <g key={s.id} data-series={s.id}>
            <polygon points={area} fill={color} fillOpacity={fillOpacity} stroke="none" />
            <polyline className={chrome.series} points={line} fill="none" stroke={color} />
          </g>
        );
      })}
    </>
  );
}
