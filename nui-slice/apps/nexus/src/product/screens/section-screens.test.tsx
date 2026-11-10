// @vitest-environment jsdom
/** Волна XII — обзоры разделов Intelligence/Compute/Data: живые блоки
 *  из seam'ов, честные empty/unavailable/error без выдуманных чисел. */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/intelligence',
  useSearchParams: () => new URLSearchParams(''),
}));

const getMemoryStructure = vi.fn();
const listMemory = vi.fn();
const listModels = vi.fn();
const getModelRouter = vi.fn();
const getMetrics = vi.fn();
const listPresence = vi.fn();
const listRuns = vi.fn();
const getUsage = vi.fn();
const workerStatus = vi.fn();
const servicesList = vi.fn();
const tgGetState = vi.fn();
const igWebGetState = vi.fn();
const igApiGetState = vi.fn();

const seams = { worker: false, services: true, telegram: true, instagram: true };

const SECTION_DS = () => ({
  getMemoryStructure, listMemory, listModels, getModelRouter,
  getMetrics, listPresence, listRuns, getUsage,
  ...(seams.worker ? { workerStatus } : {}),
  ...(seams.services ? { services: { list: servicesList } } : {}),
  ...(seams.telegram ? { telegram: { getState: tgGetState } } : {}),
  ...(seams.instagram ? { instagram: { web: { getState: igWebGetState }, api: { getState: igApiGetState } } } : {}),
});
vi.mock('../data-source', () => ({
  getDataSourceKind: () => 'live',
  getDataSource: () => SECTION_DS(),
  // #418 (wave #418-2): mount-gated hook; stable via useMemo so
  // useAsyncValue([ds]) deps don't refetch-loop in the test.
  useDataSource: () => useMemo(SECTION_DS, []),
}));

import { IntelligenceScreen } from './section-intelligence';
import { ComputeScreen } from './section-compute';
import { DataScreen } from './section-data';
import { DialogsScreen } from './dialogs';

const METRICS = {
  cpuPct: 42, ramPct: 55, diskPct: 61, gpuPct: null, uptimeS: 300,
  counters: { modelCalls: 5, toolCalls: 3, tokensIn: 100, tokensOut: 200, costUsd: 0.01 },
  health: [], freshness: { state: 'live' as const, label: 'live' },
};

afterEach(() => {
  cleanup();
  for (const fn of [getMemoryStructure, listMemory, listModels, getModelRouter, getMetrics, listPresence, listRuns, getUsage, workerStatus, servicesList, tgGetState, igWebGetState, igApiGetState]) fn.mockReset();
  seams.worker = false;
  seams.services = true;
  seams.telegram = true;
  seams.instagram = true;
});

describe('IntelligenceScreen (волна XII)', () => {
  it('KPI и списки из живых seam-данных verbatim', async () => {
    getMemoryStructure.mockResolvedValue({ project: 'ai2', total: 17, perDay: [], sources: [{ name: 'run', count: 12 }] });
    listMemory.mockResolvedValue([{ id: 1, project: 'ai2', text: 'решение по шине', createdAt: 100 }]);
    listModels.mockResolvedValue([{ id: 'm1', label: 'Model One', free: null, isDefault: true }]);
    getModelRouter.mockResolvedValue({ nodes: [], edges: [{ from: 'a', to: 'b', kind: 'routes' }] });
    render(<IntelligenceScreen />);
    const kpi = await screen.findByTestId('intel-kpi-memory');
    await waitFor(() => expect(kpi.textContent).toContain('17'));
    expect(kpi.textContent).toContain('проект ai2');
    const mk = screen.getByTestId('intel-kpi-models');
    await waitFor(() => expect(mk.textContent).toContain('маршрутов: 1'));
    const mem = screen.getByTestId('intel-memory');
    expect(await within(mem).findByText(/решение по шине/)).toBeTruthy();
    expect(within(mem).getByText(/источники: run · 12/)).toBeTruthy();
    expect(within(screen.getByTestId('intel-models')).getByText('Model One')).toBeTruthy();
  });

  it('пустая память → «Нет данных»; ошибка структуры → error + повтор', async () => {
    getMemoryStructure.mockResolvedValue({ project: 'ai2', total: 0, perDay: [], sources: [] });
    listMemory.mockResolvedValue([]);
    listModels.mockResolvedValue([]);
    getModelRouter.mockResolvedValue({ nodes: [], edges: [] });
    render(<IntelligenceScreen />);
    const mem = await screen.findByTestId('intel-memory');
    const empty = await within(mem).findByTestId('empty-state');
    expect(empty.textContent).toContain('Нет данных');
    cleanup();
    getMemoryStructure.mockRejectedValue(new Error('down'));
    render(<IntelligenceScreen />);
    expect((await screen.findByTestId('intel-kpi-memory')).getAttribute('data-state')).toBe('error');
  });
});

describe('ComputeScreen (волна XII)', () => {
  it('метрики verbatim, GPU null → «нет данных», прогоны из listRuns', async () => {
    getMetrics.mockResolvedValue(METRICS);
    listPresence.mockResolvedValue([{ agent: 'a', state: 'running', task: 'x', runId: 'r1' }]);
    listRuns.mockResolvedValue([
      { runId: 'r1', taskText: 'собери отчёт', config: 'b', status: 'running', stopReason: null, agent: 'a', parent: null, project: null, model: null, costUsd: null, createdAt: 1, finishedAt: null },
    ]);
    getUsage.mockResolvedValue({ period: '2026-10', runsTotal: 9, runsSucceeded: 8, runsFailed: 1, runsCancelled: 0, runsTimeout: 0, runsRunning: 1, costUsd: 0.02, breakdown: [] });
    render(<ComputeScreen />);
    const load = await screen.findByTestId('compute-kpi-load');
    await waitFor(() => expect(load.textContent).toContain('CPU 42%'));
    expect(load.textContent).toContain('RAM 55%');
    expect(load.textContent).toContain('GPU нет данных');
    const procs = screen.getByTestId('compute-kpi-processes');
    await waitFor(() => expect(procs.textContent).toContain('в работе: 1'));
    const runsPanel = screen.getByTestId('compute-runs');
    expect(await within(runsPanel).findByText('собери отчёт')).toBeTruthy();
    // seam workerStatus отсутствует → честное «нет данных»
    const worker = screen.getByTestId('compute-worker');
    expect(worker.getAttribute('data-state')).toBe('unavailable');
    expect(within(worker).getByText(/seam workerStatus у источника отсутствует/)).toBeTruthy();
  });

  it('worker seam есть → состояние verbatim (ready → «работает»)', async () => {
    seams.worker = true;
    getMetrics.mockResolvedValue(METRICS);
    listPresence.mockResolvedValue([]);
    listRuns.mockResolvedValue([]);
    getUsage.mockResolvedValue({ period: '2026-10', runsTotal: 0, runsSucceeded: 0, runsFailed: 0, runsCancelled: 0, runsTimeout: 0, runsRunning: 0, costUsd: 0, breakdown: [] });
    workerStatus.mockResolvedValue({ state: 'ready', pid: 4321, restarts: 0, uptimeS: 120 });
    render(<ComputeScreen />);
    const worker = await screen.findByTestId('compute-worker');
    await waitFor(() => expect(worker.textContent).toContain('работает'));
    expect(worker.textContent).toContain('pid 4321');
    expect(worker.textContent).toContain('аптайм');
  });
});

describe('DataScreen (волна XII)', () => {
  it('каталог подключений verbatim + каналы; отсутствие seam → unavailable', async () => {
    servicesList.mockResolvedValue([
      { id: 'gmail.api', name: 'Gmail', mode: 'api', state: 'connected', scopes: [], summary: '', connectable: false },
      { id: 'slack.app', name: 'Slack', mode: 'native-app', state: 'needs-permission', scopes: [], summary: '', reason: 'нужен OAuth', connectable: true },
    ]);
    tgGetState.mockResolvedValue({ status: 'connected', authStep: 'ready', error: null });
    igWebGetState.mockResolvedValue({ state: 'open' });
    igApiGetState.mockResolvedValue({ status: 'connected', account: { handle: '@nexus', accountType: 'business', grantedScopes: [] }, error: null });
    render(<DataScreen />);
    const kpi = await screen.findByTestId('data-kpi-connections');
    await waitFor(() => expect(kpi.textContent).toContain('в каталоге: 2'));
    const cat = screen.getByTestId('data-catalog');
    expect(await within(cat).findByText('Gmail')).toBeTruthy();
    expect(within(cat).getByText('подключено')).toBeTruthy();
    expect(within(cat).getByText(/нужен OAuth/)).toBeTruthy();
    const tg = screen.getByTestId('data-telegram');
    await waitFor(() => expect(tg.textContent).toContain('статус: connected'));
    const ig = screen.getByTestId('data-instagram');
    await waitFor(() => expect(ig.textContent).toContain('@nexus'));
  });

  it('без seamов подключений/каналов → честные unavailable, не пустые строки', async () => {
    seams.services = false;
    seams.telegram = false;
    seams.instagram = false;
    render(<DataScreen />);
    const cat = await screen.findByTestId('data-catalog');
    expect(cat.getAttribute('data-state')).toBe('unavailable');
    expect(within(cat).getByText(/каталог подключений у источника отсутствует/)).toBeTruthy();
    expect(screen.getByTestId('data-telegram').getAttribute('data-state')).toBe('unavailable');
    expect(screen.getByTestId('data-instagram').getAttribute('data-state')).toBe('unavailable');
  });
});

describe('DialogsScreen — shared state components', () => {
  it('loading uses LoadingState', () => {
    listRuns.mockReturnValue(new Promise(() => {}));
    render(<DialogsScreen />);
    expect(screen.getByTestId('loading-state')).toBeTruthy();
  });

  it('error and empty inventory use shared states', async () => {
    listRuns.mockRejectedValueOnce(new Error('offline'));
    const { unmount } = render(<DialogsScreen />);
    expect(await screen.findByTestId('error-state')).toBeTruthy();
    unmount();

    listRuns.mockResolvedValueOnce([]);
    render(<DialogsScreen />);
    expect(await screen.findByTestId('empty-state')).toBeTruthy();
  });
});
