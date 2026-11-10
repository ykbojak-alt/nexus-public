import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BarChart } from './bar-chart';
import type { NexusSeries } from '../types';

afterEach(cleanup);

const A: NexusSeries = { id: 'a', label: 'A', points: [{ x: 'Q1', y: 10 }, { x: 'Q2', y: 20 }] };
const B: NexusSeries = { id: 'b', label: 'B', points: [{ x: 'Q1', y: 5 }, { x: 'Q2', y: 8 }] };

describe('BarChart (spec §13)', () => {
  it('renders one rect per point with series tone var', () => {
    render(<BarChart series={[A]} a11y={{ title: 'Revenue' }} />);
    const bars = document.querySelectorAll('rect[data-series="a"]');
    expect(bars).toHaveLength(2);
    expect(bars[0].getAttribute('fill')).toBe('var(--nexus-chart-series-1)');
    expect(Number(bars[0].getAttribute('height'))).toBeGreaterThan(0);
  });

  it('groups series side-by-side in the same category', () => {
    render(<BarChart series={[A, B]} a11y={{ title: 'T' }} />);
    const aQ1 = document.querySelector('rect[data-series="a"][data-category="Q1"]')!;
    const bQ1 = document.querySelector('rect[data-series="b"][data-category="Q1"]')!;
    expect(bQ1.getAttribute('fill')).toBe('var(--nexus-chart-series-2)');
    expect(Number(bQ1.getAttribute('x'))).toBeGreaterThan(Number(aQ1.getAttribute('x')));
  });

  it('supports a single point (min=1) but stays honest on empty', () => {
    const { rerender } = render(<BarChart series={[{ id: 'x', label: 'X', points: [{ x: 'a', y: 3 }] }]} a11y={{ title: 'T' }} />);
    expect(screen.getByTestId('bar-chart')).toHaveAttribute('data-state', 'ready');
    rerender(<BarChart series={[]} a11y={{ title: 'T' }} />);
    expect(screen.getByTestId('bar-chart')).toHaveAttribute('data-state', 'empty');
  });

  it('marks insufficient when all y are unusable', () => {
    render(<BarChart series={[{ id: 'x', label: 'X', points: [{ x: 'a', y: NaN }] }]} a11y={{ title: 'T' }} />);
    expect(screen.getByTestId('bar-chart')).toHaveAttribute('data-state', 'insufficient');
  });

  it('bare mode (VIS-W4-02 sparkline): no axes/ticks, bars still rendered rounded', () => {
    render(<BarChart series={[A]} a11y={{ title: 'Spark' }} bare width={120} height={40} />);
    expect(document.querySelectorAll('rect[data-series="a"]')).toHaveLength(2);
    expect(document.querySelector('line.grid, line[class*="grid"], .tickLabel')).not.toBeInTheDocument();
    expect(document.querySelector('text')).not.toBeInTheDocument();
    expect(Number(document.querySelector('rect[data-series="a"]')!.getAttribute('rx'))).toBeGreaterThan(0);
    const first = document.querySelector('rect[data-series="a"]')!;
    expect(Number(first.getAttribute('x'))).toBeLessThan(48); // bare pad, not axis pad
  });
});
