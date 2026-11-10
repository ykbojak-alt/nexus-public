import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { FlowSteps, mapLifecycle } from './flow-steps';

const a11y = { title: 'Provider lifecycle' };

describe('FlowSteps (Runtime pack, plan 2026-10-13 §W4)', () => {
  it('renders each step with semantic tone from its status', () => {
    const { getByTestId, container } = render(
      <FlowSteps
        a11y={a11y}
        steps={[
          { id: 'connect', label: 'connect', status: 'done' },
          { id: 'auth', label: 'auth', status: 'current' },
          { id: 'ready', label: 'ready' },
        ]}
      />,
    );
    expect(getByTestId('flow-steps')).toHaveAttribute('data-state', 'ready');
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('role', 'img');
    const done = container.querySelector('[data-step="connect"] circle')!;
    expect(done.getAttribute('fill')).toBe('var(--nexus-chart-positive)');
    const cur = container.querySelector('[data-step="auth"] circle')!;
    expect(cur.getAttribute('fill')).toBe('var(--nexus-accent-primary)');
  });

  it('marks a blocked step negative and keeps later steps pending', () => {
    const steps = mapLifecycle(['offline', 'connecting', 'connected'], 'connecting', { blocked: 'connecting' });
    expect(steps.map((s) => s.status)).toEqual(['done', 'blocked', 'pending']);
    const { container } = render(<FlowSteps a11y={a11y} steps={steps} />);
    const blocked = container.querySelector('[data-step="connecting"] circle')!;
    expect(blocked.getAttribute('fill')).toBe('var(--nexus-chart-negative)');
  });

  it('keeps every step pending when the state is unknown', () => {
    const steps = mapLifecycle(['idle', 'running', 'paused'], null);
    expect(steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('reports empty when there is no lifecycle to show', () => {
    const { getByTestId } = render(<FlowSteps a11y={a11y} steps={[]} />);
    expect(getByTestId('flow-steps')).toHaveAttribute('data-state', 'empty');
  });
});
