import type { HTMLAttributes } from 'react';
import { ChartFrame } from '../chart-frame';
import { CHART_CHROME, toneVar } from '../palette';
import { linearScale } from '../scales';
import type { ChartA11y, ChartTone, DataFreshness, VizState } from '../types';
import chrome from '../chart-svg.module.css';

export interface HeatmapCell {
  /** Column label. */
  x: string;
  /** Row label. */
  y: string;
  value: number;
}

export interface HeatmapProps extends HTMLAttributes<HTMLDivElement> {
  cells: HeatmapCell[];
  a11y: ChartA11y;
  freshness?: DataFreshness;
  loading?: boolean;
  error?: boolean;
  state?: VizState;
  /** Intensity tone — cell opacity carries the value, not hue (spec §13). */
  tone?: ChartTone;
  width?: number;
  height?: number;
  /** Fluid sizing — svg fills container width, keeps viewBox aspect. */
  responsive?: boolean;
}

const PAD = { top: 8, right: 8, bottom: 40, left: 96 };

/**
 * Value-intensity grid. Magnitude maps to opacity of a single semantic
 * tone — palette stays theme-correct across all six themes.
 */
export function Heatmap({
  cells,
  a11y,
  freshness,
  loading,
  error,
  state,
  tone = 'energy',
  width = 640,
  height = 360,
  ...rest
}: HeatmapProps) {
  const resolved: VizState =
    state ?? (loading ? 'loading' : error ? 'error' : cells.length === 0 ? 'empty' : cells.some((c) => Number.isFinite(c.value)) ? 'ready' : 'insufficient');

  return (
    <ChartFrame
      testId="heatmap"
      a11y={a11y}
      state={resolved}
      freshness={freshness}
      width={width}
      height={height}
      {...rest}
    >
      <HeatSvg cells={cells} tone={tone} width={width} height={height} />
    </ChartFrame>
  );
}

function HeatSvg({ cells, tone, width, height }: { cells: HeatmapCell[]; tone: ChartTone; width: number; height: number }) {
  const xs: string[] = [];
  const ys: string[] = [];
  for (const c of cells) {
    if (!xs.includes(c.x)) xs.push(c.x);
    if (!ys.includes(c.y)) ys.push(c.y);
  }
  const cw = (width - PAD.left - PAD.right) / Math.max(1, xs.length);
  const ch = (height - PAD.top - PAD.bottom) / Math.max(1, ys.length);
  const vals = cells.map((c) => c.value).filter(Number.isFinite);
  const vMax = Math.max(...vals, 1);
  const alpha = linearScale([0, vMax], [0.08, 1]);
  const fill = toneVar(tone);

  return (
    <>
      {xs.map((x, i) => (
        <text aria-hidden="true" key={x} className={chrome.tickLabel} x={PAD.left + i * cw + cw / 2} y={height - PAD.bottom + 14} textAnchor="middle" fill={CHART_CHROME.label}>
          {x}
        </text>
      ))}
      {ys.map((y, i) => (
        <text aria-hidden="true" key={y} className={chrome.tickLabel} x={PAD.left - 8} y={PAD.top + i * ch + ch / 2} textAnchor="end" dominantBaseline="middle" fill={CHART_CHROME.label}>
          {y}
        </text>
      ))}
      {cells.map((c, i) => {
        if (!Number.isFinite(c.value)) return null;
        const xi = xs.indexOf(c.x);
        const yi = ys.indexOf(c.y);
        return (
          <rect
            key={`${c.x}-${c.y}-${i}`}
            data-cell={`${c.x}|${c.y}`}
            x={PAD.left + xi * cw + 1}
            y={PAD.top + yi * ch + 1}
            width={Math.max(0, cw - 2)}
            height={Math.max(0, ch - 2)}
            fill={fill}
            fillOpacity={alpha(c.value)}
          />
        );
      })}
    </>
  );
}
