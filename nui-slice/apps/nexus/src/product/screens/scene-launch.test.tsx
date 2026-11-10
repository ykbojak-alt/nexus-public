// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnrealSceneHostState, UnrealSceneStatus } from '@nexus/mock-data';
import type { ProductDataSource } from '../data-source';

let unrealScene: ProductDataSource['unrealScene'] | undefined;
vi.mock('../data-source', () => ({
  getDataSource: () => ({ unrealScene }),
  useDataSource: () => ({ unrealScene }),
}));

import { SceneLaunchButton } from './scene-launch';

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

describe('SceneLaunchButton — VII V1.4 (состояния моста verbatim)', () => {
  beforeEach(() => { unrealScene = undefined; });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('seam отсутствует → кнопка disabled, «Мост сцены недоступен»', () => {
    render(<SceneLaunchButton />);
    const el = screen.getByTestId('scene-launch');
    expect(el.getAttribute('data-state')).toBe('unavailable');
    expect(screen.getByTestId('scene-launch-status').textContent).toContain('Мост сцены недоступен');
    expect((screen.getByRole('button', { name: 'Открыть 3D-сцену' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disconnected → «UE не запущен», клик зовёт seam.open() и показывает ответ verbatim', async () => {
    const open = vi.fn().mockResolvedValue(hostState('starting'));
    unrealScene = {
      getState: () => Promise.resolve(hostState('disconnected')),
      open,
    };
    render(<SceneLaunchButton />);
    await screen.findByText('UE не запущен');
    const btn = screen.getByRole('button', { name: 'Открыть 3D-сцену' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await screen.findByText('UE запускается…');
    expect(open).toHaveBeenCalledTimes(1);
    // локального апгрейда до connected нет — показываем ответ хоста
    expect(screen.getByTestId('scene-launch').getAttribute('data-state')).toBe('starting');
  });

  it('connected → «Сцена открыта», запуск недоступен (статус только от хоста)', async () => {
    unrealScene = {
      getState: () => Promise.resolve(hostState('connected')),
      open: vi.fn(),
    };
    render(<SceneLaunchButton />);
    await screen.findByText('Сцена открыта');
    expect((screen.getByRole('button', { name: 'Открыть 3D-сцену' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('not-installed → «UE не установлен» + reason verbatim, кнопка disabled', async () => {
    unrealScene = {
      getState: () => Promise.resolve(hostState('not-installed', { source: null, reason: 'пакет сцены не найден в data_dir' })),
      open: vi.fn(),
    };
    render(<SceneLaunchButton />);
    await screen.findByText('UE не установлен');
    expect(screen.getByText('пакет сцены не найден в data_dir')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Открыть 3D-сцену' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('getState reject → «Мост сцены не ответил», состояние error', async () => {
    unrealScene = {
      getState: () => Promise.reject(new Error('desktop bridge unavailable')),
      open: vi.fn(),
    };
    render(<SceneLaunchButton />);
    await screen.findByText('Мост сцены не ответил');
    expect(screen.getByTestId('scene-launch').getAttribute('data-state')).toBe('error');
  });

  it('mock-источник помечается DEMO; unknown/иной enum → «Статус сцены неизвестен»', async () => {
    unrealScene = {
      getState: () => Promise.resolve(hostState('disconnected', { source: 'mock' })),
      open: vi.fn(),
    };
    render(<SceneLaunchButton />);
    await screen.findByText(/UE не запущен/);
    expect(screen.getByTestId('scene-launch-status').textContent).toContain('DEMO');
    cleanup();
    unrealScene = {
      getState: () => Promise.resolve(hostState('future-enum')),
      open: vi.fn(),
    };
    render(<SceneLaunchButton />);
    await screen.findByText('Статус сцены неизвестен');
  });

  it('persona + connected + чужая персона → «Сделать активной в сцене» зовёт setActive verbatim', async () => {
    const setActive = vi.fn().mockResolvedValue({
      sent: true, state: hostState('connected', { activeAssistant: 'mech' }),
    });
    unrealScene = {
      getState: () => Promise.resolve(hostState('connected', { activeAssistant: 'alice' })),
      open: vi.fn(),
      setActive,
    };
    render(<SceneLaunchButton persona="mech" />);
    const btn = await screen.findByTestId('scene-set-active');
    fireEvent.click(btn);
    await waitFor(() => expect(setActive).toHaveBeenCalledWith('mech'));
    await screen.findByText(/активна/);
    // кнопка исчезает — активная персона теперь наша (по ответу хоста)
    expect(screen.queryByTestId('scene-set-active')).toBeNull();
  });

  it('persona совпадает с activeAssistant → кнопки нет, статус «· активна»', async () => {
    unrealScene = {
      getState: () => Promise.resolve(hostState('connected', { activeAssistant: 'forge' })),
      open: vi.fn(),
      setActive: vi.fn(),
    };
    render(<SceneLaunchButton persona="forge" />);
    await screen.findByText(/Сцена открыта · активна/);
    expect(screen.queryByTestId('scene-set-active')).toBeNull();
  });

  it('sent:false → честный «команда не дошла», переключение не показано', async () => {
    const setActive = vi.fn().mockResolvedValue({
      sent: false, state: hostState('connected', { activeAssistant: 'alice' }),
    });
    unrealScene = {
      getState: () => Promise.resolve(hostState('connected', { activeAssistant: 'alice' })),
      open: vi.fn(),
      setActive,
    };
    render(<SceneLaunchButton persona="codex" />);
    fireEvent.click(await screen.findByTestId('scene-set-active'));
    await screen.findByTestId('scene-set-active-fail');
    expect(screen.queryByText(/активна/)).toBeNull();
  });

  it('seam без setActive → кнопки переключения нет даже при connected', async () => {
    unrealScene = {
      getState: () => Promise.resolve(hostState('connected', { activeAssistant: 'alice' })),
      open: vi.fn(),
    };
    render(<SceneLaunchButton persona="mech" />);
    await screen.findByText('Сцена открыта');
    expect(screen.queryByTestId('scene-set-active')).toBeNull();
  });
});
