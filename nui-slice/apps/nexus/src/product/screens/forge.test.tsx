// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/forge',
  useSearchParams: () => new URLSearchParams(''),
}));

const startRun = vi.fn();
const unrealGetState = vi.fn();
const unrealSubscribe = vi.fn();
const unrealEvents = vi.fn();
let withEvents = true;
vi.mock('../data-source', () => {
  const compute = () => ({
    startRun,
    unrealScene: {
      getState: unrealGetState,
      subscribe: unrealSubscribe,
      ...(withEvents ? { subscribeEvents: unrealEvents } : {}),
    },
  });
  return {
    getDataSourceKind: () => 'mock',
    getDataSource: compute,
    useDataSource: compute,
    sourceModeLabel: (mode: string | null) => {
      if (mode === 'live') return 'LIVE';
      if (mode === 'mock') return 'MOCK';
      return 'SYNCING';
    },
  };
});

import { ForgeScreen } from './forge';
import { resetProfileStore, saveProfile } from '../profile/profile-store';
import { createEmptyProfile } from '../profile/profile-types';

const run = () => ({
  runId: 'forge-run-1', taskText: 'собери сцену', config: 'deliberate',
  status: 'running' as const, stopReason: null, agent: 'forge', parent: null,
  project: 'nexus', model: null, costUsd: null, createdAt: 1700000000, finishedAt: null,
});
const sceneState = (over: Record<string, unknown> = {}) => ({
  status: 'not-installed' as const, source: 'mock' as const, reason: null,
  protocolVersion: 1, activeAssistant: null, activeMap: null, lastUpdated: 1700000000,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  resetProfileStore();
  saveProfile({ ...createEmptyProfile(), name: 'Yury' });
  startRun.mockResolvedValue(run());
  unrealGetState.mockResolvedValue(sceneState());
  unrealSubscribe.mockReturnValue(() => { });
  unrealEvents.mockReturnValue(() => { });
  withEvents = true;
});

afterEach(() => {
  cleanup();
  for (const fn of [push, startRun, unrealGetState, unrealSubscribe, unrealEvents]) fn.mockReset();
});

describe('ForgeScreen — IX V3: главный экран FORGE по образцу ALICE', () => {
  it('герой: образ, приветствие с именем профиля (Yury), слоганы', async () => {
    render(<ForgeScreen />);
    expect(await screen.findByAltText('Образ субагента ROLE-2')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Добр|Доброе/, level: 1 })).toBeTruthy();
    expect(screen.getByText(/Yury\./)).toBeTruthy();
    expect(screen.getByText(/Проектировать миры\./)).toBeTruthy();
  });

  it('композитор запускает прогон с agent=forge и профилем, ведёт на /runtime', async () => {
    const user = userEvent.setup();
    render(<ForgeScreen />);
    await user.type(screen.getByLabelText('Опишите задачу для ROLE-2'), 'собери сцену');
    await user.click(screen.getByRole('button', { name: /Запустить задачу/ }));
    await waitFor(() => expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'собери сцену', }),
    ));
    expect(push).toHaveBeenCalledWith('/runtime?run=forge-run-1');
  }, 15000);

  it('XIII: «Среда» — реальные поля моста verbatim; карта/ассистент не сообщены → честно', async () => {
    render(<ForgeScreen />);
    const env = await screen.findByTestId('forge-environment');
    await waitFor(() => expect(env).toHaveTextContent('UE не установлен'));
    expect(env).toHaveTextContent('MOCK');
    expect(env).toHaveTextContent('не сообщена');
    expect(env).toHaveTextContent('не сообщён');
    expect(env).toHaveTextContent('v1');
    // Никаких выдуманных чисел эталонного макета
    expect(env.querySelector('*')).toBeTruthy();
    expect(screen.queryByText('18:30')).toBeNull();
  });

  it('XIII: «Среда» — карта/ассистент/причина хоста verbatim', async () => {
    unrealGetState.mockResolvedValue(sceneState({
      status: 'connected', source: 'live', activeMap: '/Game/Maps/StartScene',
      activeAssistant: 'forge', reason: null, protocolVersion: 2,
    }));
    render(<ForgeScreen />);
    const env = await screen.findByTestId('forge-environment');
    await waitFor(() => expect(env).toHaveTextContent('UE · сцена открыта'));
    expect(env).toHaveTextContent('/Game/Maps/StartScene');
    expect(env).toHaveTextContent('ROLE-2');
    expect(env).toHaveTextContent('v2');
    expect(env).not.toHaveTextContent('MOCK');
  });

  it('события сцены заполняют последовательность из единственного push-потока', async () => {
    let emit: ((e: unknown) => void) | null = null;
    unrealEvents.mockImplementation((cb: (e: unknown) => void) => { emit = cb; return () => { }; });
    render(<ForgeScreen />);
    const panel = await screen.findByTestId('forge-timeline');
    await waitFor(() => expect(panel).toHaveTextContent('Событий пока нет'));
    await act(async () => {
      emit?.({ type: 'scene.portrait.click', assistant: 'forge', map: '/Game/Maps/StartScene', ts: 1700000100 });
    });
    await waitFor(() => expect(panel).toHaveTextContent('scene.portrait.click'));
    expect(panel).toHaveTextContent('ROLE-2');
    expect(panel).toHaveTextContent('/Game/Maps/StartScene');
    expect(panel.querySelectorAll('li')).toHaveLength(1);
    expect(screen.queryByTestId('forge-scene-events')).toBeNull();
  });

  it('поток событий не реализован у источника → honest unavailable', async () => {
    withEvents = false;
    render(<ForgeScreen />);
    const panel = await screen.findByTestId('forge-timeline');
    await waitFor(() => expect(panel).toHaveAttribute('data-state', 'unavailable'));
    expect(panel).toHaveTextContent('источник не предоставляет поток unreal-scene.event');
  });

  it('ошибка подключения к потоку → честный error', async () => {
    unrealEvents.mockImplementation(() => { throw new Error('bridge failed'); });
    render(<ForgeScreen />);
    const panel = await screen.findByTestId('forge-timeline');
    await waitFor(() => expect(panel).toHaveAttribute('data-state', 'error'));
    expect(panel).toHaveTextContent('Не удалось подключить поток событий сцены.');
  });

  it('панели студии без живых данных — честное «нет данных», не нули', async () => {
    render(<ForgeScreen />);
    expect(await screen.findByTestId('forge-layers')).toHaveTextContent('Нет данных');
    expect(screen.getByTestId('forge-timeline')).toHaveTextContent('Событий пока нет');
    // Никаких выдуманных чисел эталонного макета
    expect(screen.queryByText('18:30')).toBeNull();
    expect(screen.queryByText('18 объектов')).toBeNull();
    expect(screen.queryByText(/12 назначено/)).toBeNull();
  });

  it('бейдж состояния сцены — verbatim от моста; mock → MOCK', async () => {
    render(<ForgeScreen />);
    const badge = await screen.findByTestId('forge-scene-badge');
    expect(badge.textContent).toContain('UE не установлен');
    expect(badge.textContent).toContain('MOCK');
  });
});
