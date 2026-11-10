// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeUnavailable, type NewfBridge } from './newf-live';
import {
  renderAnsiScreenSafe,
  useLiveTerminalScreen,
} from './newf-render-hook';

function makeBridge(screen: () => Promise<string>): NewfBridge {
  return {
    spaces: async () => [],
    terminals: async () => [],
    agents: async () => [],
    screen,
    send: async () => {},
    keys: async () => {},
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('renderAnsiScreenSafe — обёртка рендерера с дефолтами', () => {
  it('возвращает сетку строк для простого текста (LL справа усекается)', () => {
    // Рендерер НЕ делает \r на \n (x сохраняется) и усекает хвостовые
    // пробелы строк — ожидания соответствуют фактическому поведению.
    expect(renderAnsiScreenSafe('ab\ncd', 2, 2)).toEqual([' c', 'd']);
  });

  it('применяет дефолты, если cols/rows не переданы', () => {
    const grid = renderAnsiScreenSafe('hello');
    expect(grid).toHaveLength(24);
    expect(grid[0]).toBe('hello');
    expect(grid.slice(1).every((line) => line === '')).toBe(true);
  });

  it('не бросает на пустом экране', () => {
    expect(renderAnsiScreenSafe('', 80, 24)).toEqual(Array(24).fill(''));
  });
});

describe('useLiveTerminalScreen — живой экран терминала', () => {
  it('загружает экран сразу и рендерит сетку (offline=false)', async () => {
    const screen = vi.fn().mockResolvedValue('pt> ls\r\nbin');
    const { result } = renderHook(() =>
      useLiveTerminalScreen(makeBridge(screen), 't1', {
        cols: 6,
        rows: 3,
        pollMs: 10,
      }),
    );

    // Рендерер обрабатывает CRLF штатно (\r сбрасывает колонку), хвостовые
    // пробелы строк усекаются — ожидания соответствуют фактическому поведению.
    await waitFor(() =>
      expect(result.current.grid).toEqual(['pt> ls', 'bin', '']),
    );
    expect(result.current.screen).toBe('pt> ls\nbin');
    expect(result.current.error).toBeNull();
    expect(typeof result.current.lastUpdated).toBe('number');
    expect(screen).toHaveBeenCalledWith('t1');
  });

  it('опрашивает с интервалом', async () => {
    const screen = vi.fn().mockResolvedValue('data');
    const { result } = renderHook(() =>
      useLiveTerminalScreen(makeBridge(screen), 't1', {
        cols: 8,
        rows: 2,
        pollMs: 10,
      }),
    );

    await waitFor(() => expect(result.current.grid[0]).toBe('data'));
    const callsAtFirstPaint = screen.mock.calls.length;
    expect(callsAtFirstPaint).toBeGreaterThanOrEqual(1);

    await waitFor(() =>
      expect(screen.mock.calls.length).toBeGreaterThan(callsAtFirstPaint),
    );
  });

  it('BridgeUnavailable → offline=true + error, без подмены моком', async () => {
    const screen = vi.fn().mockRejectedValue(new BridgeUnavailable('bridge unreachable: conn refused'));
    const { result } = renderHook(() =>
      useLiveTerminalScreen(makeBridge(screen), 't1', {
        cols: 4,
        rows: 2,
        pollMs: 5,
      }),
    );

    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(result.current.error).toContain('bridge unreachable');
    // Никакого мок-текста экрана — сетка остаётся пустой (честно).
    expect(result.current.grid).toEqual([]);
    expect(result.current.screen).toBe('');
  });

  it('восстанавливается после сбоя (offline → live)', async () => {
    let fail = true;
    const screen = vi.fn().mockImplementation(async () => {
      if (fail) throw new BridgeUnavailable('bridge unreachable: conn refused');
      return 'back online';
    });
    const { result } = renderHook(() =>
      useLiveTerminalScreen(makeBridge(screen), 't1', {
        cols: 12,
        rows: 2,
        pollMs: 5,
      }),
    );

    await waitFor(() => expect(result.current.offline).toBe(true));

    fail = false;
    await waitFor(() => expect(result.current.offline).toBe(false));
    expect(result.current.grid[0]).toBe('back online');
    expect(result.current.error).toBeNull();
  });
});
