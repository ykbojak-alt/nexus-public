// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnrealSceneHostState, UnrealSceneStatus } from '@nexus/mock-data';
import type { ProductDataSource } from '../data-source';

vi.mock('next/navigation', () => ({
  usePathname: () => '/runtime',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=scene'),
}));

// Optional-seam toggle: absent → the tab renders `unavailable`, never a
// fabricated bridge call.
let unrealScene: ProductDataSource['unrealScene'] | undefined;
// Stable sub-objects for useAsyncValue deps; the outer object is fresh on
// each compute() call but sub-refs are hoisted to module scope.
const _listPresets = () => Promise.resolve([]);
const _listAgents = () => Promise.resolve([]);
const _listRuns = () => Promise.resolve([]);
const _listApprovals = () => Promise.resolve([]);
vi.mock('../data-source', () => {
  const compute = () => ({
    listPresets: _listPresets,
    listAgents: _listAgents,
    listRuns: _listRuns,
    listApprovals: _listApprovals,
    unrealScene,
  });
  return {
    getDataSource: compute,
    useDataSource: compute,
    getDataSourceKind: () => 'live',
  };
});

import { RuntimeScreen } from './runtime';
import { resetWarmRuntime } from '../runtime-warmup';

const hostState = (status: UnrealSceneStatus | string, over: Partial<UnrealSceneHostState> = {}): UnrealSceneHostState => ({
  status: status as UnrealSceneStatus,
  source: 'live',
  reason: null,
  lastUpdated: 1_800_000_000,
  protocolVersion: 1,
  activeAssistant: null,
  activeMap: null,
  ...over,
});

const panel = () => screen.findByTestId('tab-scene');

describe('RuntimeScene — host-driven states (unreal card Task 3)', () => {
  beforeEach(() => { unrealScene = undefined; resetWarmRuntime(); });
  // Vitest config без globals — авто-cleanup RTL не регистрируется,
  // DOM предыдущего теста остаётся в document → дубли findByTestId.
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('seam absent → unavailable with the bridge-method explanation', async () => {
    render(<RuntimeScreen />);
    const p = await panel();
    expect(p.getAttribute('data-state')).toBe('unavailable');
    expect(p.textContent).toContain('unreal_scene_state');
    expect(screen.queryByRole('button', { name: 'Открыть 3D-сцену' })).toBeNull();
  });

  it('not-installed → badge + host reason verbatim + disabled open', async () => {
    unrealScene = {
      getState: () => Promise.resolve(hostState('not-installed', { source: null, reason: 'пакет сцены не найден в data_dir', protocolVersion: null })),
      open: vi.fn(),
    };
    render(<RuntimeScreen />);
    const p = await panel();
    await waitFor(() => expect(p.textContent).toContain('НЕ УСТАНОВЛЕНА'));
    expect(p.textContent).toContain('пакет сцены не найден');
    expect((screen.getByRole('button', { name: 'Открыть 3D-сцену' }) as HTMLButtonElement).disabled).toBe(true);
    // not-installed never implies live provenance — no LIVE badge
    expect(p.textContent).not.toContain('LIVE');
  });

  it('connected renders LIVE only from the host report', async () => {
    unrealScene = {
      getState: () => Promise.resolve(hostState('connected')),
      open: vi.fn(),
    };
    render(<RuntimeScreen />);
    const p = await panel();
    await waitFor(() => expect(p.textContent).toContain('LIVE'));
    expect(p.textContent).toContain('протокол v1');
    // open disabled while connected — a second launch is not an action
    expect((screen.getByRole('button', { name: 'Открыть 3D-сцену' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('mock source always carries the DEMO badge', async () => {
    unrealScene = {
      getState: () => Promise.resolve(hostState('disconnected', { source: 'mock' })),
      open: vi.fn().mockResolvedValue(hostState('starting', { source: 'mock' })),
    };
    render(<RuntimeScreen />);
    const p = await panel();
    await waitFor(() => expect(p.textContent).toContain('ОТКЛЮЧЕНА'));
    expect(p.textContent).toContain('DEMO');
    // disconnected → open is the honest action; returns next host state
    fireEvent.click(screen.getByRole('button', { name: 'Открыть 3D-сцену' }));
    await waitFor(() => expect(p.textContent).toContain('ЗАПУСК'));
    expect(p.textContent).toContain('DEMO');
  });

  it('stale and unknown statuses never read as healthy', async () => {
    for (const [status, label] of [['stale', 'STALE'], ['unknown', 'НЕИЗВЕСТНО'], ['future-enum', 'НЕИЗВЕСТНО']] as const) {
      unrealScene = { getState: () => Promise.resolve(hostState(status)), open: vi.fn() };
      const { unmount } = render(<RuntimeScreen />);
      const p = await panel();
      await waitFor(() => expect(p.textContent).toContain(label));
      expect(p.textContent).not.toContain('LIVE');
      unmount();
    }
  });

  it('freshness markup: host-vocabulary data-freshness + measured data-fresh-age', async () => {
    unrealScene = {
      getState: () => Promise.resolve(hostState('connected', {
        lastUpdated: Math.floor(Date.now() / 1000) - 90,
      })),
      open: vi.fn(),
    };
    render(<RuntimeScreen />);
    const p = await panel();
    await waitFor(() => expect(p.getAttribute('data-freshness')).toBe('live'));
    // measured age is present and numeric (host owns the stale threshold)
    const ageAttr = p.getAttribute('data-fresh-age');
    expect(ageAttr).not.toBeNull();
    expect(Number(ageAttr)).toBeGreaterThan(60);
    expect(p.textContent).toContain('мин назад');
  });

  it('stale status → data-freshness mirrors the host verdict verbatim', async () => {
    unrealScene = {
      getState: () => Promise.resolve(hostState('stale', { reason: 'хост не отвечает 40 с' })),
      open: vi.fn(),
    };
    render(<RuntimeScreen />);
    const p = await panel();
    await waitFor(() => expect(p.getAttribute('data-freshness')).toBe('stale'));
    expect(p.textContent).toContain('хост не отвечает 40 с');
  });

  it('getState rejection → error state with a working retry', async () => {
    const getState = vi.fn()
      .mockRejectedValueOnce(new Error('desktop bridge unavailable'))
      .mockResolvedValue(hostState('disconnected'));
    unrealScene = { getState, open: vi.fn() };
    render(<RuntimeScreen />);
    const p = await panel();
    await waitFor(() => expect(p.getAttribute('data-state')).toBe('error'));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(p.textContent).toContain('ОТКЛЮЧЕНА'));
    expect(getState).toHaveBeenCalledTimes(2);
  });

  it('header chip and scene tab share one state subscription and clean it up', async () => {
    const unsubscribeState = vi.fn();
    const unsubscribeEvents = vi.fn();
    const getState = vi.fn().mockResolvedValue(hostState('connected'));
    const subscribe = vi.fn(() => unsubscribeState);
    const subscribeEvents = vi.fn(() => unsubscribeEvents);
    unrealScene = { getState, subscribe, subscribeEvents, open: vi.fn() };
    const { unmount } = render(<RuntimeScreen />);

    await screen.findByText('LIVE');
    await screen.findByTestId('tab-scene');
    expect(getState).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribeEvents).toHaveBeenCalledTimes(1);

    unmount();
    expect(unsubscribeState).toHaveBeenCalledTimes(1);
    expect(unsubscribeEvents).toHaveBeenCalledTimes(1);
  });

  it('nexus-scene-v1: activeAssistant — verbatim строкой; без поля строки нет', async () => {
    unrealScene = {
      getState: () => Promise.resolve(hostState('connected', { activeAssistant: 'mech' })),
      open: vi.fn(),
    };
    render(<RuntimeScreen />);
    const p = await panel();
    const row = await screen.findByTestId('scene-assistant');
    expect(row.textContent).toContain('mech');
    cleanup();
    unrealScene = {
      getState: () => Promise.resolve(hostState('connected')),
      open: vi.fn(),
    };
    render(<RuntimeScreen />);
    await panel();
    await screen.findByText('LIVE');
    expect(screen.queryByTestId('scene-assistant')).toBeNull();
  });

  it('VII V3-3: активная карта verbatim + ожидаемая карта по канону; без полей строк нет', async () => {
    unrealScene = {
      getState: () => Promise.resolve(hostState('connected', {
        activeAssistant: 'alice', activeMap: '/Game/Maps/StartScene_Alice',
      })),
      open: vi.fn(),
    };
    render(<RuntimeScreen />);
    const mapRow = await screen.findByTestId('scene-map');
    expect(mapRow.textContent).toContain('/Game/Maps/StartScene_Alice');
    const expected = await screen.findByTestId('scene-map-expected');
    expect(expected.textContent).toContain('/Game/Maps/StartScene_Alice');
    cleanup();
    unrealScene = {
      getState: () => Promise.resolve(hostState('connected')),
      open: vi.fn(),
    };
    render(<RuntimeScreen />);
    await panel();
    await screen.findByText('LIVE');
    expect(screen.queryByTestId('scene-map')).toBeNull();
    expect(screen.queryByTestId('scene-map-expected')).toBeNull();
  });

  it('VII V3-1: subscribeEvents → последнее событие verbatim (тип, карта, время)', async () => {
    let emit: ((e: { type: string; map?: string; ts?: number }) => void) | undefined;
    unrealScene = {
      getState: () => Promise.resolve(hostState('connected')),
      open: vi.fn(),
      subscribeEvents: (cb) => { emit = cb; return () => { }; },
    };
    render(<RuntimeScreen />);
    await panel();
    await screen.findByText('LIVE');
    expect(screen.queryByTestId('scene-event')).toBeNull(); // нет событий — нет блока
    emit?.({ type: 'map-error', map: '/Game/Maps/SelectScene', ts: 1_800_000_000 });
    const row = await screen.findByTestId('scene-event');
    expect(row.textContent).toContain('map-error');
    expect(row.textContent).toContain('/Game/Maps/SelectScene');
  });
});
