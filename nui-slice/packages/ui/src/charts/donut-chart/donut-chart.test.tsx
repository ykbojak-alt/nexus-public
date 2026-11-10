import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DonutChart } from './donut-chart';
import type { NexusSeries } from '../types';

afterEach(cleanup);

const S: NexusSeries = {
  id: 'share', label: 'Share',
  points: [{ x: 'A', y: 40 }, { x: 'B', y: 35 }, { x: 'C', y: 25 }],
};

describe('DonutChart (spec §13)', () => {
  it('renders one arc path per segment with palette fills', () => {
    render(<DonutChart series={S} a11y={{ title: 'Share' }} />);
    const segs = document.querySelectorAll('path[data-segment]');
    expect(segs).toHaveLength(3);
    expect(segs[0].getAttribute('fill')).toBe('var(--nexus-chart-series-1)');
    expect(segs[1].getAttribute('fill')).toBe('var(--nexus-chart-series-2)');
    expect(segs[0].getAttribute('d')).toMatch(/^M /);
  });

  it('skips non-positive segments honestly', () => {
    const s: NexusSeries = { id: 's', label: 'S', points: [{ x: 'A', y: 5 }, { x: 'B', y: 0 }, { x: 'C', y: NaN }] };
    render(<DonutChart series={s} a11y={{ title: 'T' }} />);
    expect(document.querySelectorAll('path[data-segment]')).toHaveLength(1);
  });

  it('marks insufficient when total is zero', () => {
    const s: NexusSeries = { id: 's', label: 'S', points: [{ x: 'A', y: 0 }, { x: 'B', y: 0 }] };
    render(<DonutChart series={s} a11y={{ title: 'T' }} />);
    expect(screen.getByTestId('donut-chart')).toHaveAttribute('data-state', 'insufficient');
  });
});
