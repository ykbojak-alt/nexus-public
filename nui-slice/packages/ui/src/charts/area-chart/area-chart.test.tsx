import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AreaChart } from './area-chart';
import type { NexusSeries } from '../types';

afterEach(cleanup);

const S: NexusSeries = {
  id: 'a', label: 'A',
  points: [{ x: 0, y: 1 }, { x: 1, y: 4 }, { x: 2, y: 2 }],
};

describe('AreaChart (spec §13)', () => {
  it('renders fill polygon + stroke line per series from tone vars', () => {
    render(<AreaChart series={[S]} a11y={{ title: 'Coverage' }} />);
    const g = document.querySelector('g[data-series="a"]')!;
    const poly = g.querySelector('polygon')!;
    const line = g.querySelector('polyline')!;
    expect(poly.getAttribute('fill')).toBe('var(--nexus-chart-series-1)');
    expect(poly.getAttribute('fill-opacity')).toBe('0.16');
    expect(line.getAttribute('stroke')).toBe('var(--nexus-chart-series-1)');
    expect(line.getAttribute('fill')).toBe('none');
  });

  it('shows insufficient state under 2 points', () => {
    render(<AreaChart series={[{ id: 'x', label: 'X', points: [{ x: 0, y: 1 }] }]} a11y={{ title: 'T' }} />);
    expect(screen.getByTestId('area-chart')).toHaveAttribute('data-state', 'insufficient');
    expect(screen.getByText(/insufficient/i)).toBeInTheDocument();
  });

  it('carries freshness and empty state', () => {
    const { rerender } = render(<AreaChart series={[S]} a11y={{ title: 'T' }} freshness="syncing" />);
    expect(screen.getByTestId('area-chart')).toHaveAttribute('data-freshness', 'syncing');
    rerender(<AreaChart series={[]} a11y={{ title: 'T' }} />);
    expect(screen.getByTestId('area-chart')).toHaveAttribute('data-state', 'empty');
  });
});
