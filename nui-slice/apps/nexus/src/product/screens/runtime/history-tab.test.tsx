// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HistoryTab } from './history-tab';
import type { RunSummary } from '@nexus/mock-data';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const ds = {
  listRuns: async (): Promise<RunSummary[]> => [],
  listProjects: async (): Promise<string[]> => [],
};

vi.mock('../../data-source', () => ({
  getDataSource: () => ds,
  useDataSource: () => ds,
}));

describe('Runtime HistoryTab — honest states', () => {
  it('empty → “Прогонов под фильтром нет.” + data-state=empty', async () => {
    ds.listRuns = async () => [];
    ds.listProjects = async () => [];
    render(<HistoryTab />);
    await waitFor(() => expect(screen.getByTestId('tab-history')).toHaveAttribute('data-state', 'empty'));
    expect(screen.getByText('Прогонов под фильтром нет.')).toBeTruthy();
  });

  it('ready with runs → список + “все” ≥2', async () => {
    const runs: RunSummary[] = [
      { runId: 'r1', taskText: 't1', config: 'baseline', status: 'done', stopReason: 'done', agent: null, parent: null, project: 'p', costUsd: 0.1, createdAt: 1, finishedAt: 2 },
      { runId: 'r2', taskText: 't2', config: 'baseline', status: 'error', stopReason: 'error: x', agent: null, parent: null, project: 'p2', costUsd: null, createdAt: 3, finishedAt: 4 },
    ];
    ds.listRuns = async () => runs;
    ds.listProjects = async () => ['p', 'p2'];
    render(<HistoryTab />);
    await waitFor(() => expect(screen.getByTestId('tab-history')).toHaveAttribute('data-state', 'ready'));
    expect(screen.getAllByRole('button', { name: 'все' }).length).toBeGreaterThanOrEqual(2);
  });

  it('error → “Не удалось загрузить историю.” + data-state=error', async () => {
    ds.listRuns = async () => { throw new Error('boom'); };
    ds.listProjects = async () => [];
    render(<HistoryTab />);
    await waitFor(() => expect(screen.getByTestId('tab-history')).toHaveAttribute('data-state', 'error'));
    expect(screen.getByText('Не удалось загрузить историю.')).toBeTruthy();
  });
});
