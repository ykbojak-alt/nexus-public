import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StackedBarChart } from './stacked-bar-chart';
import type { NexusSeries } from '../types';

afterEach(cleanup);

const SERIES: NexusSeries[] = [
  { id: 'cpu', label: 'CPU', points: [{ x: 'Q1', y: 30 }, { x: 'Q2', y: 40 }] },
  { id: 'gpu', label: 'GPU', points: [{ x: 'Q1', y: 20 }, { x: 'Q2', y: 10 }] },
];

describe('StackedBarChart (spec §13)', () => {
  it('stacks series within a category — cumulative offsets', () => {
    render(<StackedBarChart series={SERIES} a11y={{ title: 'Load' }} />);
    const q1Cpu = document.querySelector('rect[data-series="cpu"][data-category="Q1"]')!;
    const q1Gpu = document.querySelector('rect[data-series="gpu"][data-category="Q1"]')!;
    const cpuH = Number(q1Cpu.getAttribute('height'));
    // gpu segment starts where cpu ends (y grows downward).
    expect(Number(q1Gpu.getAttribute('y'))).toBeCloseTo(Number(q1Cpu.getAttribute('y')) - Number(q1Gpu.getAttribute('height')), 3);
    expect(cpuH).toBeGreaterThan(0);
  });

  it('keeps negative contributions below the baseline', () => {
    const s: NexusSeries[] = [
      { id: 'a', label: 'A', points: [{ x: 'Q1', y: 10 }] },
      { id: 'b', label: 'B', points: [{ x: 'Q1', y: -5 }] },
    ];
    render(<StackedBarChart series={s} a11y={{ title: 'T' }} />);
    const pos = document.querySelector('rect[data-series="a"]')!;
    const neg = document.querySelector('rect[data-series="b"]')!;
    expect(Number(neg.getAttribute('y'))).toBeGreaterThan(Number(pos.getAttribute('y')));
  });

  it('marks empty for no series', () => {
    render(<StackedBarChart series={[]} a11y={{ title: 'T' }} />);
    expect(screen.getByTestId('stacked-bar-chart')).toHaveAttribute('data-state', 'empty');
  });
});
