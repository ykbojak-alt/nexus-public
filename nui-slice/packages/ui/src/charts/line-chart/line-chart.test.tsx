import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// jest-dom + cleanup live in this file until Window 5's shared harness
// (test/setup.ts) lands; then the import moves there.
afterEach(cleanup);
import { LineChart } from './line-chart';
import type { NexusSeries } from '../types';

const TWO_POINTS: NexusSeries = {
  id: 'a',
  label: 'Series A',
  points: [
    { x: 0, y: 1 },
    { x: 1, y: 3 },
    { x: 2, y: 2 },
  ],
};

const a11y = { title: 'CPU load over time' };

describe('LineChart (spec §13)', () => {
  it('renders an accessible svg with series strokes from token vars', () => {
    render(<LineChart series={[TWO_POINTS]} a11y={a11y} />);
    const root = screen.getByTestId('line-chart');
    expect(root).toHaveAttribute('data-state', 'ready');
    const svg = screen.getByRole('img', { name: 'CPU load over time' });
    const line = svg.querySelector('polyline[data-series="a"]');
    expect(line).not.toBeNull();
    expect(line!.getAttribute('stroke')).toBe('var(--nexus-chart-series-1)');
    expect(line!.getAttribute('fill')).toBe('none');
  });

  it('applies explicit semantic tone, never a raw color', () => {
    render(<LineChart series={[{ ...TWO_POINTS, tone: 'negative' }]} a11y={a11y} />);
    const line = document.querySelector('polyline[data-series="a"]')!;
    expect(line.getAttribute('stroke')).toBe('var(--nexus-chart-negative)');
  });

  it('auto-assigns subsequent series to ordered palette slots', () => {
    const b: NexusSeries = { id: 'b', label: 'B', points: TWO_POINTS.points };
    render(<LineChart series={[TWO_POINTS, b]} a11y={a11y} />);
    expect(document.querySelector('polyline[data-series="b"]')!.getAttribute('stroke'))
      .toBe('var(--nexus-chart-series-2)');
  });

  it('shows insufficient-data state instead of a fabricated line', () => {
    const one: NexusSeries = { id: 'x', label: 'X', points: [{ x: 0, y: 5 }] };
    render(<LineChart series={[one]} a11y={a11y} />);
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-state', 'insufficient');
    expect(screen.getByText(/insufficient/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('honours empty/loading/error states in priority order', () => {
    const { rerender } = render(<LineChart series={[]} a11y={a11y} loading />);
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-state', 'loading');
    rerender(<LineChart series={[]} a11y={a11y} error />);
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-state', 'error');
    rerender(<LineChart series={[]} a11y={a11y} />);
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-state', 'empty');
  });

  it('carries freshness and stale state attributes', () => {
    render(<LineChart series={[TWO_POINTS]} a11y={a11y} freshness="stale" />);
    const root = screen.getByTestId('line-chart');
    expect(root).toHaveAttribute('data-freshness', 'stale');
    expect(root).toHaveAttribute('data-state', 'ready');
  });

  it('accepts controlled state override', () => {
    render(<LineChart series={[TWO_POINTS]} a11y={a11y} state="stale" />);
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-state', 'stale');
  });

  it('responsive mode keeps the viewBox but drops fixed width/height', () => {
    render(<LineChart series={[TWO_POINTS]} a11y={a11y} responsive width={800} height={400} />);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('viewBox')).toBe('0 0 800 400');
    expect(svg.getAttribute('width')).toBe('100%');
    expect(svg.getAttribute('height')).toBeNull();
  });

  it('renders grid and axis chrome from chart.* tokens', () => {
    render(<LineChart series={[TWO_POINTS]} a11y={a11y} />);
    const svg = screen.getByRole('img');
    const gridLines = svg.querySelectorAll('line');
    expect(gridLines.length).toBeGreaterThan(1);
    expect(
      [...gridLines].some((l) => l.getAttribute('stroke') === 'var(--nexus-chart-grid)'),
    ).toBe(true);
  });

  it('bare mode (VIS-W4-02 sparkline): line only, no axis/grid/ticks', () => {
    render(<LineChart series={[TWO_POINTS]} a11y={a11y} bare width={120} height={40} />);
    const svg = screen.getByRole('img');
    expect(svg.querySelector('polyline[data-series="a"]')).not.toBeNull();
    expect(svg.querySelectorAll('line')).toHaveLength(0);
    expect(svg.querySelectorAll('text')).toHaveLength(0);
  });
});
