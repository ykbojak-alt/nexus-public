// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listRuns = vi.fn();
vi.mock('../data-source', () => ({
  getDataSourceKind: () => 'mock',
  getDataSource: () => ({ listRuns }),
  useDataSource: () => ({ listRuns }),
}));

import { SettingsUsageScreen } from './settings-usage';

const run = (over: Partial<Record<string, unknown>> = {}) => ({
  runId: 'u1', taskText: 'задача', config: 'baseline', status: 'done',
  stopReason: null, agent: null, parent: null, project: 'nexus',
  model: null, costUsd: null, createdAt: 1700000000, finishedAt: 1700000060,
  ...over,
});

beforeEach(() => {
  listRuns.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  listRuns.mockReset();
});

describe('SettingsUsageScreen — R-W3.6 finance-дашборд', () => {
  it('агрегирует cost_usd по дням — бары и суммы verbatim', async () => {
    const day1 = 1700000000; // 2023-11-14
    const day2 = 1700086400;
    listRuns.mockResolvedValue([
      run({ runId: 'a', costUsd: 0.5, createdAt: day1 }),
      run({ runId: 'b', costUsd: 0.25, createdAt: day1 }),
      run({ runId: 'c', costUsd: 1.0, createdAt: day2 }),
    ]);
    render(<SettingsUsageScreen />);
    const rows = await screen.findAllByTestId('usage-day');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('$1.750')).toBeTruthy(); // Σ
    expect(screen.getByText(/\$0\.750 · 2 прогонов/)).toBeTruthy(); // day1
    expect(screen.getByText('3')).toBeTruthy(); // прогоны с ценой
  });

  it('без прогонов — честный empty; без cost_usd — «не отчитана»', async () => {
    render(<SettingsUsageScreen />);
    expect(await screen.findByText('Нет данных о расходе')).toBeTruthy();
    cleanup();
    listRuns.mockResolvedValue([run({ costUsd: null })]);
    render(<SettingsUsageScreen />);
    expect(await screen.findByText('Стоимость не отчитана')).toBeTruthy();
  });

  it('ошибка seam → error + retry', async () => {
    listRuns.mockRejectedValue(new Error('down'));
    render(<SettingsUsageScreen />);
    expect(await screen.findByText(/Не удалось загрузить прогоны/)).toBeTruthy();
  });
});
