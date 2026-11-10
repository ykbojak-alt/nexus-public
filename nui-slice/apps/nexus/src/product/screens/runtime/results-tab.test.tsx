// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ResultsTab } from './results-tab';
import type { RunDetail, RunSummary } from '@nexus/mock-data';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const ds = {
  listRuns: async (): Promise<RunSummary[]> => [],
  getRunDetail: (async () => null) as ((id: string) => Promise<RunDetail | null>) | null,
};

vi.mock('../../data-source', () => ({
  getDataSource: () => ds,
  useDataSource: () => ds,
  getDataSourceKind: () => 'mock',
  // results-tab.tsx читает статус конфигурации источника (mock/live/misconfigured).
  getDataSourceConfigStatus: () => 'ready' as const,
}));

describe('Runtime ResultsTab — honest states', () => {
  it('unavailable (getRunDetail null) → data-state=unavailable + подсказка', async () => {
    ds.getRunDetail = null;
    render(<ResultsTab />);
    await waitFor(() => expect(screen.getByTestId('tab-results')).toHaveAttribute('data-state', 'unavailable'));
    expect(screen.getByText('Источник данных не реализует получение результата прогона.')).toBeTruthy();
  });

  it('empty (no finished runs with result) → data-state=empty', async () => {
    ds.getRunDetail = async () => null;
    ds.listRuns = async () => [{ runId: 'r1', taskText: 't1', status: 'done' } as RunSummary];
    render(<ResultsTab />);
    await waitFor(() => expect(screen.getByTestId('tab-results')).toHaveAttribute('data-state', 'empty'));
  });

  it('ready → рендерит run + статус “выберите два для сравнения”', async () => {
    ds.getRunDetail = async (id) => ({ run: { runId: id, taskText: 't1', status: 'done' }, result: { score: 1 } } as unknown as RunDetail);
    ds.listRuns = async () => [{ runId: 'r1', taskText: 't1', status: 'done' } as RunSummary];
    render(<ResultsTab />);
    await waitFor(() => expect(screen.getByTestId('tab-results')).toHaveAttribute('data-state', 'ready'));
    expect(screen.getByTestId('tab-results')).toHaveAttribute('data-state', 'ready');
  });

  it('error (listRuns rejects) → data-state=error + “Не удалось загрузить результаты.”', async () => {
    ds.getRunDetail = async () => null;
    ds.listRuns = async () => { throw new Error('boom'); };
    render(<ResultsTab />);
    await waitFor(() => expect(screen.getByTestId('tab-results')).toHaveAttribute('data-state', 'error'));
    expect(screen.getByText('Не удалось загрузить результаты.')).toBeTruthy();
  });
});
