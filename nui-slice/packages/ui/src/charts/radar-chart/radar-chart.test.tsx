import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RadarChart } from './radar-chart';
import type { NexusSeries } from '../types';

afterEach(cleanup);

const S: NexusSeries[] = [
  { id: 'a', label: 'A', points: [{ x: 'speed', y: 8 }, { x: 'power', y: 5 }, { x: 'range', y: 7 }] },
];

describe('RadarChart (spec §13)', () => {
  it('renders web rings and one polygon per series', () => {
    render(<RadarChart series={S} a11y={{ title: 'Profile' }} />);
    const poly = document.querySelectorAll('polygon[data-series]');
    expect(poly).toHaveLength(1);
    const pairs = poly[0].getAttribute('points')!.split(' ');
    expect(pairs).toHaveLength(3); // one "x,y" pair per axis
    expect(pairs.every((p) => p.includes(','))).toBe(true);
    expect(document.querySelectorAll('polygon:not([data-series])')).toHaveLength(4); // default 4 rings
  });

  it('needs at least 3 axes — fewer reports insufficient', () => {
    const s: NexusSeries[] = [{ id: 'a', label: 'A', points: [{ x: 'x', y: 1 }, { x: 'y', y: 2 }] }];
    render(<RadarChart series={s} a11y={{ title: 'T' }} />);
    expect(screen.getByTestId('radar-chart')).toHaveAttribute('data-state', 'insufficient');
  });

  it('normalizes each axis to its own max across series', () => {
    const s: NexusSeries[] = [
      { id: 'a', label: 'A', points: [{ x: 'u', y: 100 }, { x: 'v', y: 1 }, { x: 'w', y: 50 }] },
      { id: 'b', label: 'B', points: [{ x: 'u', y: 50 }, { x: 'v', y: 2 }, { x: 'w', y: 25 }] },
    ];
    render(<RadarChart series={s} a11y={{ title: 'T' }} />);
    // Per-axis maxima: u=100 (A), v=2 (B), w=50 (A) → A's v point is at frac 0.5.
    const pts = document.querySelector('polygon[data-series="a"]')!.getAttribute('points')!.split(' ').map((pair) => pair.split(',').map(Number));
    const cx = 240;
    const cy = 200;
    const dist = pts.map(([x, y]) => Math.hypot(x - cx, y - cy));
    expect(dist[0]).toBeGreaterThan(dist[1]); // u=frac 1 vs v=frac 0.5
    expect(dist[1]).toBeCloseTo(dist[0] / 2, 0);
  });
});
