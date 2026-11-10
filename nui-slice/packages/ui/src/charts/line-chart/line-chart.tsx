import type { HTMLAttributes } from 'react';
import { ChartFrame } from '../chart-frame';
import { CHART_CHROME, seriesColor } from '../palette';
import { linearScale, seriesExtent } from '../scales';
import { resolveVizState } from '../sufficiency';
import type { ChartA11y, DataFreshness, NexusSeries, VizState } from '../types';
import styles from './line-chart.module.css';

export interface LineChartProps extends HTMLAttributes<HTMLDivElement> {
  series: NexusSeries[];
  /** Accessible title/description — required, never decorative (spec §14). */
  a11y: ChartA11y;
  /** Live-data freshness marker (spec §13). */
  freshness?: DataFreshness;
  /** Domain overrides; state is resolved from loading/error/data when absent. */
  loading?: boolean;
  error?: boolean;
  state?: VizState;
  /** Include zero baseline in the y domain. */
  includeZero?: boolean;
  /** Axis-less sparkline mode — Lux KPI tiles (VIS-W4-02). */
  bare?: boolean;
  width?: number;
  height?: number;
  /** Fluid sizing — svg fills container width, keeps viewBox aspect. */
  responsive?: boolean;
}

const W = 640;
const H = 360;
const PAD = { top: 16, right: 16, bottom: 32, left: 48 };

function xValue(p: { x: number | string | Date }): number {
  if (p.x instanceof Date) return p.x.getTime();
  if (typeof p.x === 'string') return Number.NaN; // banded x resolved by index below
  return p.x;
}

/**
 * Continuous-series line chart. SVG render, token styling, honest
 * states — never a decorative fake curve (spec §13).
 */
export function LineChart({
  series,
  a11y,
  freshness,
  loading,
  error,
  state,
  includeZero = true,
  bare = false,
  width = W,
  height = H,
  ...rest
}: LineChartProps) {
  const resolved: VizState = state ?? resolveVizState({ loading, error, series, min: 2 });

  return (
    <ChartFrame
      testId="line-chart"
      a11y={a11y}
      state={resolved}
      freshness={freshness}
      width={width}
      height={height}
      {...rest}
    >
      <ChartSvg series={series} includeZero={includeZero} bare={bare} width={width} height={height} />
    </ChartFrame>
  );
}

const BARE_PAD = { top: 4, right: 4, bottom: 4, left: 4 };

function ChartSvg({
  series,
  includeZero,
  bare,
  width,
  height,
}: {
  series: NexusSeries[];
  includeZero: boolean;
  /** Axis-less sparkline mode — Lux KPI tiles (VIS-W4-02). */
  bare: boolean;
  width: number;
  height: number;
}) {
  const pad = bare ? BARE_PAD : PAD;
  // X domain: numeric/Date → extent; string x → categorical index positions.
  const categorical = series.some((s) => s.points.some((p) => typeof p.x === 'string'));
  const xs: number[] = [];
  for (const s of series) {
    s.points.forEach((p, i) => xs.push(categorical ? i : xValue(p)));
  }
  const xsNum = xs.filter(Number.isFinite);
  const xMin = xsNum.length ? Math.min(...xsNum) : 0;
  const xMax = xsNum.length ? Math.max(...xsNum) : 1;

  const x = linearScale(
    [Number.isFinite(xMin) ? xMin : 0, Number.isFinite(xMax) && xMax !== xMin ? xMax : xMin + 1],
    [pad.left, width - pad.right],
  );
  const y = linearScale(seriesExtent(series, { includeZero }), [height - pad.bottom, pad.top]);

  return (
    <>
      {!bare &&
        y.ticks(5).map((t) => (
          <g key={t}>
            <line
              className={styles.grid}
              x1={pad.left}
              x2={width - pad.right}
              y1={y(t)}
              y2={y(t)}
              stroke={CHART_CHROME.grid}
            />
            <text aria-hidden="true"
              className={styles.tickLabel}
              x={pad.left - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fill={CHART_CHROME.label}
            >
              {formatTick(t)}
            </text>
          </g>
        ))}
      {!bare && (
        <line
          className={styles.axis}
          x1={pad.left}
          x2={width - pad.right}
          y1={height - pad.bottom}
          y2={height - pad.bottom}
          stroke={CHART_CHROME.axis}
        />
      )}

      {series.map((s, i) => {
        const pts = s.points
          .map((p, idx) => {
            const px = x(categorical ? idx : xValue(p));
            const py = y(p.y);
            return Number.isFinite(px) && Number.isFinite(py) ? `${px},${py}` : null;
          })
          .filter(Boolean)
          .join(' ');
        return (
          <polyline
            key={s.id}
            className={styles.series}
            data-series={s.id}
            points={pts}
            fill="none"
            stroke={seriesColor(s.tone, i)}
          />
        );
      })}
    </>
  );
}

function formatTick(v: number): string {
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1_000_000 || abs < 0.01)) return v.toExponential(1);
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
}
