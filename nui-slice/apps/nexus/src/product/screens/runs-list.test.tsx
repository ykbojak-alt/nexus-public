// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunSummary } from '@nexus/mock-data/types';

const listRuns = vi.fn();
vi.mock('../data-source', () => ({
  getDataSource: () => ({ listRuns }),
  useDataSource: () => ({ listRuns }),
}));

import { RunsScreen } from './runs-list';

afterEach(() => {
  cleanup();
  listRuns.mockReset();
});

function run(i: number, over: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: `run-${String(i).padStart(4, '0')}`,
    taskText: `задача ${i}`,
    config: '',
    status: 'done',
    stopReason: null,
    agent: null,
    parent: null,
    retryOf: null,
    project: null,
    model: null,
    costUsd: null,
    createdAt: 1_700_000_000 + i * 60,
    finishedAt: 1_700_000_000 + i * 60 + 30,
    ...over,
  };
}

describe('RunsScreen — список прогонов', () => {
  it('рендерит newest-first строки: бейдж, время, задача, длительность, ссылка в /runtime', async () => {
    listRuns.mockResolvedValue([run(3, { agent: 'worker' }), run(2), run(1)]);
    render(<RunsScreen />);

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(3);
    // порядок — как отдал seam, без перестановки
    expect(within(items[0]).getByText('задача 3')).toBeTruthy();
    expect(within(items[2]).getByText('задача 1')).toBeTruthy();

    expect(within(items[0]).getByText('ЗАВЕРШЁН')).toBeTruthy();
    expect(within(items[0]).getByText(/30 с/)).toBeTruthy();
    expect(within(items[0]).getByText(/агент: worker/)).toBeTruthy();

    const link = within(items[0]).getByRole('link', { name: /Открыть прогон run-0003/ });
    expect(link.getAttribute('href')).toBe(`/runtime?run=${encodeURIComponent('run-0003')}`);
    expect(listRuns).toHaveBeenCalledWith({ limit: 50, status: undefined });
  });

  it('фильтр по статусу запрашивает сервер с тем статусом и перестраивает список', async () => {
    listRuns
      .mockResolvedValueOnce([run(1), run(2)])
      .mockResolvedValueOnce([run(9, { status: 'running', finishedAt: null })]);
    render(<RunsScreen />);
    await screen.findAllByRole('listitem');

    fireEvent.click(screen.getByRole('button', { name: 'В работе' }));
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith({ limit: 50, status: 'running' }));

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText('задача 9')).toBeTruthy();
    expect(within(items[0]).getByText('ИДЁТ')).toBeTruthy();
    // идущий прогон — без выдуманной длительности
    expect(items[0].querySelector('time')).not.toBeNull();
    expect(within(items[0]).queryByText(/мин| с$/)).toBeNull();
  });

  it('пустой ответ → честный empty-state; фильтр пуст → свой текст', async () => {
    listRuns.mockResolvedValue([]);
    render(<RunsScreen />);
    expect(await screen.findByTestId('empty-state')).toBeTruthy();
    expect(screen.getByText(/Прогонов пока нет/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Отменённые' }));
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith({ limit: 50, status: 'cancelled' }));
    expect(await screen.findByTestId('empty-state')).toBeTruthy();
    expect(screen.getByText(/Прогонов с таким статусом нет/)).toBeTruthy();
  });

  it('ошибка seam → ErrorState; Повторить перезапрашивает', async () => {
    listRuns
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce([run(1)]);
    render(<RunsScreen />);
    expect(await screen.findByTestId('error-state')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(listRuns).toHaveBeenCalledTimes(2);
  });

  it('infinite-пагинация: полная страница → «Загрузить ещё» с offset, короткая → конец', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => run(i + 1));
    const page2 = [run(51), run(52)];
    listRuns.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    render(<RunsScreen />);
    await screen.findAllByRole('listitem');
    expect(screen.getByRole('button', { name: 'Загрузить ещё' })).toBeTruthy();
    expect(screen.queryByText('Вся лента загружена')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё' }));
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith({ limit: 50, offset: 50, status: undefined }));

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(52);
    expect(within(items[51]).getByText('задача 52')).toBeTruthy();
    expect(await screen.findByText('Вся лента загружена')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Загрузить ещё' })).toBeNull();
  });
});
