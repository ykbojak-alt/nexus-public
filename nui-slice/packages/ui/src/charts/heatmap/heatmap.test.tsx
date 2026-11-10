import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Heatmap } from './heatmap';

afterEach(cleanup);

const CELLS = [
  { x: 'Mon', y: 'planner', value: 3 },
  { x: 'Mon', y: 'executor', value: 9 },
  { x: 'Tue', y: 'planner', value: 1 },
];

describe('Heatmap (spec §13)', () => {
  it('renders cells with value-driven opacity on a semantic tone', () => {
    render(<Heatmap cells={CELLS} a11y={{ title: 'Activity' }} />);
    const cells = document.querySelectorAll('rect[data-cell]');
    expect(cells).toHaveLength(3);
    for (const c of cells) {
      expect(c.getAttribute('fill')).toBe('var(--nexus-accent-energy)');
    }
    const hot = document.querySelector('rect[data-cell="Mon|executor"]')!;
    const cold = document.querySelector('rect[data-cell="Tue|planner"]')!;
    expect(Number(hot.getAttribute('fill-opacity'))).toBeGreaterThan(Number(cold.getAttribute('fill-opacity')));
  });

  it('honours tone override and empty state', () => {
    const { rerender } = render(<Heatmap cells={CELLS} a11y={{ title: 'T' }} tone="positive" />);
    expect(document.querySelector('rect[data-cell]')!.getAttribute('fill')).toBe('var(--nexus-chart-positive)');
    rerender(<Heatmap cells={[]} a11y={{ title: 'T' }} />);
    expect(screen.getByTestId('heatmap')).toHaveAttribute('data-state', 'empty');
  });
});
