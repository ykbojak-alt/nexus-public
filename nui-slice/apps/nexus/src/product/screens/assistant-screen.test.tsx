// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/mech',
  useSearchParams: () => new URLSearchParams(''),
}));

const startRun = vi.fn();
const streamRun = vi.fn();
const listRuns = vi.fn();
const getMetrics = vi.fn();
vi.mock('../data-source', () => ({
  getDataSourceKind: () => 'mock',
  getDataSource: () => ({ startRun, streamRun, listRuns, getMetrics }),
  useDataSource: () => ({ startRun, streamRun, listRuns, getMetrics }),
}));

// next/image в jsdom — обычный img, стабить не нужно.
import { AssistantScreen } from './assistant-screen';
import { resetProfileStore, saveProfile } from '../profile/profile-store';
import { createEmptyProfile } from '../profile/profile-types';

const run = (over: Partial<Record<string, unknown>> = {}) => ({
  runId: 'asst-run-1', taskText: 'диагностика воркера', config: 'deliberate',
  status: 'running' as const, stopReason: null, agent: null, parent: null,
  project: 'nexus', model: null, costUsd: null, createdAt: 1700000000, finishedAt: null,
  ...over,
});
const metrics = {
  cpuPct: 12, ramPct: 40, diskPct: 50, gpuPct: null, uptimeS: 60,
  counters: { modelCalls: 0, toolCalls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 },
  health: [], freshness: 'live',
};

beforeEach(() => {
  localStorage.clear();
  resetProfileStore();
  saveProfile({ ...createEmptyProfile(), name: 'Yury' });
  listRuns.mockResolvedValue([run()]);
  getMetrics.mockResolvedValue(metrics);
  startRun.mockResolvedValue(run());
  streamRun.mockImplementation(() => () => { });
});

afterEach(() => {
  cleanup();
  for (const fn of [push, startRun, streamRun, listRuns, getMetrics]) fn.mockReset();
});

describe('AssistantScreen — VII V1.3 (общая геометрия, свой стиль)', () => {
  it('mech: имя, бриф, скоуп data-theme=mech, арт персоны', async () => {
    render(<AssistantScreen id="mech" />);
    expect(await screen.findByText('M.E.C.H. · СУБАГЕНТ NEXUS')).toBeTruthy();
    expect(screen.getByText(/Исполнитель: процессы, диагностика/)).toBeTruthy();
    // Персона-скоуп: экран внутри data-theme=mech
    expect(screen.getByText('M.E.C.H. · СУБАГЕНТ NEXUS').closest('[data-theme]')).toHaveAttribute('data-theme', 'mech');
    // next/image переписывает src через /_next/image?url=… — ассерт по alt.
    expect(screen.getByAltText(/Образ субагента M\.E\.C\.H\./)).toBeTruthy();
  });

  it('композитор запускает прогон с agent=<persona> и раскрывает эхо без перехода', async () => {
    const user = userEvent.setup();
    render(<AssistantScreen id="codex" />);
    await user.type(screen.getByLabelText('Опишите задачу для ROLE-1'), 'сделай ревизию патча');
    await user.click(screen.getByRole('button', { name: /Запустить задачу/ }));
    await waitFor(() => expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'сделай ревизию патча', }),
    ));
    // Экран остаётся на месте: эхо в hero, /runtime — только по ссылке.
    expect(push).not.toHaveBeenCalled();
    const echo = await screen.findByTestId('home-runtime-echo');
    expect(echo.getAttribute('data-state')).toBeTruthy();
    expect(within(echo).getByRole('link', { name: /Открыть прогон/ }).getAttribute('href'))
      .toBe('/runtime?run=asst-run-1');
  }, 15000);

  it('кнопка «Открыть 3D-сцену» на месте; без seam — честный unavailable', async () => {
    render(<AssistantScreen id="arch" />);
    const el = await screen.findByTestId('scene-launch');
    expect(el.getAttribute('data-state')).toBe('unavailable');
    expect(el.textContent).toContain('Мост сцены недоступен');
  });

  it('рейл: активный прогон verbatim; метрики verbatim; ошибка → честные строки', async () => {
    render(<AssistantScreen id="arch" />);
    expect(await screen.findByText('диагностика воркера')).toBeTruthy();
    expect(await screen.findByText('12%')).toBeTruthy();
    cleanup();
    listRuns.mockRejectedValue(new Error('down'));
    getMetrics.mockRejectedValue(new Error('down'));
    render(<AssistantScreen id="mech" />);
    expect(await screen.findByText('Состояние рантайма недоступно')).toBeTruthy();
    expect(await screen.findByText('Метрики недоступны')).toBeTruthy();
  });

  it('рейл использует общие LoadingState-компоненты до ответа seam', () => {
    listRuns.mockReturnValue(new Promise(() => { }));
    getMetrics.mockReturnValue(new Promise(() => { }));
    render(<AssistantScreen id="arch" />);
    expect(screen.getAllByTestId('loading-state')).toHaveLength(2);
  });

  it('NQ-095/100: contrast scope covers mode control and all assistant rail panels', () => {
    render(<AssistantScreen id="arch" />);
    const mode = screen.getByTestId('assistant-mode-switch');
    expect(mode.querySelector('button[data-mode="agent"][data-active]')).toBeTruthy();
    expect(screen.getAllByTestId('assistant-rail-panel')).toHaveLength(3);
  });
});
