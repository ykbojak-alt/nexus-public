// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/library',
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('../../integrations/ai2/desktop-bridge/adapter', () => ({
  getDesktopBridge: () => Promise.resolve(null),
  hasDesktopBridge: () => false,
}));

const listRuns = vi.fn();
const listAgents = vi.fn();
const listPresets = vi.fn();
vi.mock('../data-source', () => ({
  getDataSourceKind: () => 'mock',
  getDataSource: () => ({ listRuns, listAgents, listPresets }),
  // #418 (wave #418-2): mount-gated hook; stable via useMemo so
  // useAsyncValue([ds]) deps don't refetch-loop in the test.
  useDataSource: () => useMemo(() => ({ listRuns, listAgents, listPresets }), []),
}));

import { FileViewerScreen } from './file-viewer';

const run = (over: Partial<Record<string, unknown>> = {}) => ({
  runId: 'aaaa1111bbbb2222', taskText: 'собери отчёт', config: 'deliberate',
  status: 'done' as const, stopReason: null, agent: null, parent: null,
  project: 'ai2', costUsd: null, createdAt: 1700000000, finishedAt: 1700000100,
  ...over,
});

beforeEach(() => {
  listAgents.mockResolvedValue([{ name: 'alpha', description: null, config: null, capabilities: [], maxCostUsd: null }]);
  listPresets.mockResolvedValue([{ name: 'deliberate' }, { name: 'baseline' }]);
  listRuns.mockResolvedValue([run()]);
});

afterEach(() => {
  cleanup();
  for (const fn of [listRuns, listAgents, listPresets]) fn.mockReset();
});

describe('FileViewerScreen — библиотека прогонов (subagents-wave W3-1)', () => {
  it('данные → строки → ссылка на /run?id= verbatim', async () => {
    render(<FileViewerScreen />);
    const lib = await screen.findByTestId('runs-library');
    await waitFor(() => expect(lib.getAttribute('data-state')).toBe('ready'));

    const link = within(lib).getByRole('link', { name: /aaaa1111/ });
    expect(link.getAttribute('href')).toBe('/run?id=aaaa1111bbbb2222');
    expect(link.textContent).toContain('собери отчёт');
    expect(link.textContent).toContain('deliberate');
  });

  it('длинные значения сохраняются целиком, локальная история получает keyboard focus', async () => {
    const taskText = `Полная формулировка задачи ${'уточнение-'.repeat(24)}`;
    const agent = `длинное-имя-агента-${'alpha-'.repeat(18)}`;
    listRuns.mockResolvedValue([run({
      runId: `run-${'abcdef0123456789'.repeat(5)}`,
      taskText,
      agent,
    })]);
    render(<FileViewerScreen />);

    const lib = await screen.findByTestId('runs-library');
    const list = within(lib).getByRole('list', { name: 'Список прогонов' }) as HTMLUListElement;
    expect(list.tabIndex).toBe(0);
    list.focus();
    expect(document.activeElement).toBe(list);

    const link = within(list).getByRole('link');
    expect(link.textContent).toContain(taskText);
    expect(link.textContent).toContain(agent);
    expect(link.getAttribute('href')).toBe(`/run?id=${encodeURIComponent(`run-${'abcdef0123456789'.repeat(5)}`)}`);
  });

  it('empty: честное «прогонов не было», не выдуманные строки', async () => {
    listRuns.mockResolvedValue([]);
    render(<FileViewerScreen />);
    const lib = await screen.findByTestId('runs-library');
    await waitFor(() => expect(lib.getAttribute('data-state')).toBe('empty'));
    expect(within(lib).getByText(/Прогонов не было/)).toBeTruthy();
  });

  it('error: seam упал → ErrorState + retry перечитывает', async () => {
    listRuns.mockRejectedValueOnce(new Error('host down'));
    const user = userEvent.setup();
    render(<FileViewerScreen />);
    const lib = await screen.findByTestId('runs-library');
    await waitFor(() => expect(lib.getAttribute('data-state')).toBe('error'));

    await user.click(within(lib).getByRole('button', { name: /повторить/i }));
    await waitFor(() => expect(lib.getAttribute('data-state')).toBe('ready'));
    expect(listRuns).toHaveBeenCalledTimes(2);
  });

  it('фильтр агента уходит параметром в seam; статус фильтрует выборку', async () => {
    listRuns.mockResolvedValue([run(), run({ runId: 'cccc3333dddd4444', status: 'running' })]);
    const user = userEvent.setup();
    render(<FileViewerScreen />);
    const lib = await screen.findByTestId('runs-library');
    await waitFor(() => expect(lib.getAttribute('data-state')).toBe('ready'));

    await user.selectOptions(within(lib).getByLabelText('Фильтр по агенту'), 'alpha');
    await waitFor(() => expect(listRuns).toHaveBeenCalledWith(expect.objectContaining({ agent: 'alpha' })));

    await user.selectOptions(within(lib).getByLabelText('Фильтр по статусу'), 'done');
    await waitFor(() => expect(within(lib).queryByText(/cccc3333/)).toBeNull());
    expect(within(lib).getByText(/aaaa1111/)).toBeTruthy();
  });

  it('дочерние прогоны помечены ↳ по полю parent — без выдуманной иерархии', async () => {
    listRuns.mockResolvedValue([
      run(),
      run({ runId: 'eeee5555ffff6666', parent: 'aaaa1111bbbb2222', taskText: 'дочерняя подзадача' }),
    ]);
    render(<FileViewerScreen />);
    const lib = await screen.findByTestId('runs-library');
    await waitFor(() => expect(lib.getAttribute('data-state')).toBe('ready'));

    const childLink = within(lib).getByRole('link', { name: /eeee5555/ });
    expect(childLink.getAttribute('href')).toBe('/run?id=eeee5555ffff6666');
    expect(childLink.textContent).toContain('↳');
    expect(lib.textContent).toContain('дочерних прогонов в выборке: 1');
  });
});
