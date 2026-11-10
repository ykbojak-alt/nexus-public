// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ResourcesTab } from './resources-tab';
import type { SystemMetrics, UsageSummary } from '@nexus/mock-data';

const ds = {
  getMetrics: async (): Promise<SystemMetrics | null> => null,
  getUsage: async (): Promise<UsageSummary | null> => null,
};

vi.mock('../../data-source', () => ({
  getDataSource: () => ds,
  useDataSource: () => ds,
}));

describe('Runtime ResourcesTab — honest states', () => {
  it('ready (metrics+usage) → data-state=ready', async () => {
    ds.getMetrics = async () => ({
      cpuPct: 10, ramPct: 20, diskPct: 30, gpuPct: 40, uptimeS: 60,
      counters: { modelCalls: 1, toolCalls: 2, tokensIn: 3, tokensOut: 4, costUsd: 0.5 },
      health: [{ component: 'host', status: 'ok', detail: null }],
      freshness: 'live',
    } as SystemMetrics);
    ds.getUsage = async () => ({ period: '1d', runsTotal: 1, runsSucceeded: 1, runsFailed: 0, runsCancelled: 0, runsTimeout: 0, runsRunning: 0, costUsd: 0.5, breakdown: [] } as UsageSummary);
    render(<ResourcesTab />);
    await waitFor(() => expect(screen.getByTestId('system-overview')).toHaveAttribute('data-state', 'ready'));
  });

  it('error (getMetrics rejects) → data-state=error', async () => {
    ds.getMetrics = async () => { throw new Error('boom'); };
    ds.getUsage = async () => { throw new Error('boom'); };
    render(<ResourcesTab />);
    await waitFor(() => expect(screen.getByTestId('system-overview')).toHaveAttribute('data-state', 'error'));
  });
});
