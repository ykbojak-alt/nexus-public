import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LineChart } from './line-chart/line-chart';
import { AreaChart } from './area-chart/area-chart';
import { BarChart } from './bar-chart/bar-chart';
import { DonutChart } from './donut-chart/donut-chart';
import { Heatmap } from './heatmap/heatmap';
import type { NexusSeries } from './types';

afterEach(cleanup);

const a11y = { title: 'M' };
const ZERO: NexusSeries = { id: 'z', label: 'Z', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] };
const MIXED: NexusSeries = { id: 'm', label: 'M', points: [{ x: 0, y: 5 }, { x: 1, y: Number.NaN }, { x: 2, y: 8 }] };

/**
 * Runbook W4-02 — cross-family state matrix. Honest rules under test:
 * y=0 is data (renders), y=NaN/unknown is NOT data (never a zero bar),
 * every family answers loading/empty/insufficient/error/stale,
 * responsive mode swaps fixed size for fluid viewBox.
 */
describe('chart state matrix (W4-02)', () => {
  it('zero values render as data — a flat zero series is honest, not empty', () => {
    render(<BarChart series={[ZERO]} a11y={a11y} />);
    expect(screen.getByTestId('bar-chart')).toHaveAttribute('data-state', 'ready');
    const bars = document.querySelectorAll('rect[data-series="z"]');
    expect(bars).toHaveLength(3); // zero bars exist (height 0), not dropped
  });

  it('unknown (NaN) is never rendered as a zero series point', () => {
    render(<BarChart series={[MIXED]} a11y={a11y} />);
    const bars = document.querySelectorAll('rect[data-series="m"]');
    expect(bars).toHaveLength(2); // NaN category produces NO bar — not a zero-height fake
  });

  it('all-unknown series → insufficient, not a flat-line illusion', () => {
    const unknown: NexusSeries = { id: 'u', label: 'U', points: [{ x: 0, y: Number.NaN }, { x: 1, y: Number.NaN }] };
    render(<LineChart series={[unknown]} a11y={a11y} />);
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-state', 'insufficient');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('donut ignores non-positive slices — zero/NaN never occupies arc space', () => {
    render(
      <DonutChart
        series={{ id: 'd', label: 'D', points: [{ x: 'a', y: 3 }, { x: 'b', y: 0 }, { x: 'c', y: Number.NaN }] }}
        a11y={a11y}
      />,
    );
    expect(screen.getByTestId('donut-chart')).toHaveAttribute('data-state', 'ready');
    expect(document.querySelectorAll('[data-segment]')).toHaveLength(1);
  });

  it('heatmap with all-unknown cells → insufficient', () => {
    render(
      <Heatmap
        cells={[{ x: 'c', y: 'r', value: Number.NaN }]}
        a11y={a11y}
      />,
    );
    expect(screen.getByTestId('heatmap')).toHaveAttribute('data-state', 'insufficient');
  });

  it('stale state renders data with data-state=stale (not blocked)', () => {
    render(<AreaChart series={[ZERO]} a11y={a11y} state="stale" />);
    expect(screen.getByTestId('area-chart')).toHaveAttribute('data-state', 'stale');
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('responsive charts keep viewBox and drop fixed width across families', () => {
    render(
      <>
        <LineChart series={[ZERO]} a11y={a11y} responsive width={400} height={200} />
        <AreaChart series={[ZERO]} a11y={a11y} responsive width={400} height={200} />
        <BarChart series={[ZERO]} a11y={a11y} responsive width={400} height={200} />
      </>,
    );
    const svgs = document.querySelectorAll('svg[viewBox="0 0 400 200"]');
    expect(svgs).toHaveLength(3);
    svgs.forEach((s) => {
      expect(s.getAttribute('width')).toBe('100%');
      expect(s.getAttribute('height')).toBeNull();
    });
  });
});
