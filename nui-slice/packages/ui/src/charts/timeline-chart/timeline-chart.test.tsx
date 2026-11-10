import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TimelineChart } from './timeline-chart';

afterEach(cleanup);

const SPANS = [
  { id: 's1', lane: 'planner', start: 0, end: 120 },
  { id: 's2', lane: 'executor', start: 100, end: 300 },
  { id: 's3', lane: 'planner', start: 150, end: 200 },
];

describe('TimelineChart (spec §13)', () => {
  it('renders one rect per span, rows per lane', () => {
    render(<TimelineChart spans={SPANS} a11y={{ title: 'Run timeline' }} />);
    const rects = document.querySelectorAll('rect[data-span]');
    expect(rects).toHaveLength(3);
    const planner = document.querySelector('rect[data-span="s1"]')!;
    const executor = document.querySelector('rect[data-span="s2"]')!;
    // different lanes → different rows
    expect(Number(planner.getAttribute('y'))).not.toBe(Number(executor.getAttribute('y')));
    // width encodes duration
    expect(Number(executor.getAttribute('width'))).toBeGreaterThan(Number(planner.getAttribute('width')));
  });

  it('drops malformed spans and marks insufficient', () => {
    render(<TimelineChart spans={[{ id: 'bad', lane: 'x', start: 10, end: 5 }]} a11y={{ title: 'T' }} />);
    expect(screen.getByTestId('timeline-chart')).toHaveAttribute('data-state', 'insufficient');
  });

  it('supports Date endpoints', () => {
    const spans = [{ id: 'd', lane: 'run', start: new Date(0), end: new Date(60_000) }];
    render(<TimelineChart spans={spans} a11y={{ title: 'T' }} />);
    expect(document.querySelector('rect[data-span="d"]')).toBeInTheDocument();
  });
});
