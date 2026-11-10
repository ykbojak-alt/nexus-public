import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { modelRouter, modelsList, presets, usage } from '@nexus/mock-data';
import { ModelCenter } from './model-center';
import { ModelComparison } from './model-comparison';
import { ModelRouter } from './model-router';
import { ModelPerformance } from './model-performance';
import { modelFreeLabel, routerRows } from './model-map';

afterEach(cleanup);

describe('ModelCenter', () => {
  it('renders models with honest free tri-state', () => {
    render(<ModelCenter models={modelsList} />);
    expect(screen.getByTestId('model-center').dataset.state).toBe('ready');
    expect(screen.getByText('exec-1')).toBeTruthy();
    // free: null (default) → '—', free: true → 'free', false → 'платная'
    const tags = screen.getAllByText(/^—$/);
    expect(tags.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('free')).toBeTruthy();
    expect(screen.getAllByText('платная').length).toBe(2);
  });

  it('selection is a callback', () => {
    const onSelect = vi.fn();
    render(<ModelCenter models={modelsList} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('critic-1'));
    expect(onSelect).toHaveBeenCalledWith('analyt/critic-1');
  });
});

describe('ModelComparison', () => {
  it('renders flags matrix; subagents flag only in deep', () => {
    render(<ModelComparison presets={presets} />);
    expect(screen.getByText('sub-агенты')).toBeTruthy();
    const deep = screen.getByText('deep').closest('tr')!;
    expect(deep.querySelectorAll('[data-on="true"]').length).toBe(5);
    const fast = screen.getByText('fast').closest('tr')!;
    expect(fast.querySelectorAll('[data-on="true"]').length).toBe(1); // memory only
  });

  it('null description renders honest dash, never fabricated text', () => {
    render(<ModelComparison presets={presets} />);
    const row = screen.getByText('custom-x').closest('tr')!;
    const descCell = row.querySelector('[data-null="true"]')!;
    expect(descCell.textContent).toBe('—');
  });
});

describe('ModelRouter', () => {
  it('renders preset → role chains and marks fallback edges', () => {
    render(<ModelRouter data={modelRouter} />);
    expect(screen.getByText('baseline')).toBeTruthy();
    expect(screen.getByText(/planner → executor → critic → arbiter/)).toBeTruthy();
    expect(screen.getByText(/fallback: arbiter → planner-2/)).toBeTruthy();
  });

  it('empty state renders nothing fabricated', () => {
    render(<ModelRouter data={{ nodes: [], edges: [] }} state="empty" />);
    expect(screen.getByText('Маршрутов нет.')).toBeTruthy();
  });
});

describe('ModelPerformance', () => {
  it('shows totals incl. timeout count and honest derived $/run', () => {
    render(<ModelPerformance usage={usage} />);
    expect(screen.getByText(/timeout 4/)).toBeTruthy();
    // 21.305/152 = 0.140
    const baseline = screen.getByText('baseline').closest('tr')!;
    expect(baseline.textContent).toContain('152');
    expect(baseline.textContent).toContain('$0.140');
  });

  it('no invented latency or per-config success rate', () => {
    render(<ModelPerformance usage={usage} />);
    expect(screen.queryByText(/латент/i)).toBeNull();
    expect(screen.queryByText(/успешность/i)).toBeNull();
  });
});

describe('model-map', () => {
  it('modelFreeLabel tri-state', () => {
    expect(modelFreeLabel(true).state).toBe('yes');
    expect(modelFreeLabel(false).state).toBe('no');
    expect(modelFreeLabel(null).state).toBe('unknown');
  });

  it('routerRows groups routes per preset and collects fallbacks', () => {
    const rows = routerRows(modelRouter);
    const baseline = rows.find((r) => r.preset === 'baseline')!;
    expect(baseline.roles).toEqual(['planner', 'executor', 'critic', 'arbiter']);
    expect(baseline.fallbacks).toEqual([{ from: 'arbiter', to: 'planner-2' }]);
    const fast = rows.find((r) => r.preset === 'fast')!;
    expect(fast.roles).toEqual(['executor']);
    expect(fast.fallbacks).toEqual([]);
  });
});
