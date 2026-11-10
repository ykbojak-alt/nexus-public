/**
 * NEWF E1/E2 — рендер-хук живого экрана терминала.
 *
 * Потребляет NewfBridge (newf-live.ts) и renderAnsiScreen (newf-screen.ts) —
 * НЕ переписывая существующие рендереры. Опрашивает bridge.screen(term)
 * с интервалом (по умолчанию 2000 мс), рендерит ANSI-срез в фиксированную
 * сетку строк (grid) и отдаёт состояние для UI.
 *
 * Честная недоступность: BridgeUnavailable → offline=true + error=сообщение,
 * БЕЗ подмены моком. Сетка при этом сохраняет последний живой кадр (stale),
 * а newf не подставляется.
 */

import { useEffect, useState } from 'react';
import { BridgeUnavailable, type NewfBridge } from './newf-live';
import { renderAnsiScreen } from './newf-screen';

export const DEFAULT_SCREEN_COLS = 120;
export const DEFAULT_SCREEN_ROWS = 24;
export const DEFAULT_SCREEN_POLL_MS = 200;

export interface LiveTerminalScreenOptions {
  /** Ширина сетки (по умолчанию 120). */
  cols?: number;
  /** Высота сетки (по умолчанию 24). */
  rows?: number;
  /** Интервал опроса мс (по умолчанию 2000). */
  pollMs?: number;
}

export interface LiveTerminalScreenState {
  /** Отрендеренная сетка: height строк (без хвостовых пробелов). */
  grid: string[];
  /** Сетка одним текстом (join '\n'), без хвостовой пустоты. */
  screen: string;
  /** Сообщение ошибки (последний отказ), иначе null. */
  error: string | null;
  /** true — мост недоступен (BridgeUnavailable), живой кадр мог устареть. */
  offline: boolean;
  /** ts последнего УСПЕШНОГО обновления экрана (мс), иначе null. */
  lastUpdated: number | null;
}

/** Обёртка renderAnsiScreen с дефолтами (raw → grid). */
export function renderAnsiScreenSafe(raw: string, cols?: number, rows?: number): string[] {
  const width = cols ?? DEFAULT_SCREEN_COLS;
  const height = rows ?? DEFAULT_SCREEN_ROWS;
  return renderAnsiScreen(raw, width, height);
}

const INITIAL_STATE: LiveTerminalScreenState = {
  grid: [],
  screen: '',
  error: null,
  offline: false,
  lastUpdated: null,
};

/**
 * Хук живого экрана терминала. Возвращает { grid, screen, error, offline, lastUpdated }.
 * Каждый тик опроса спрашивает bridge.screen(term) и рендерит через
 * renderAnsiScreen; сбой (BridgeUnavailable) помечает offline без мок-подмены.
 */
export function useLiveTerminalScreen(
  bridge: NewfBridge,
  term: string,
  opts: LiveTerminalScreenOptions = {},
): LiveTerminalScreenState {
  const cols = Math.max(1, Math.floor(opts.cols ?? DEFAULT_SCREEN_COLS));
  const rows = Math.max(1, Math.floor(opts.rows ?? DEFAULT_SCREEN_ROWS));
  const pollMs = Math.max(50, opts.pollMs ?? DEFAULT_SCREEN_POLL_MS);

  const [state, setState] = useState<LiveTerminalScreenState>(INITIAL_STATE);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      let text: string;
      try {
        text = await bridge.screen(term);
      } catch (error) {
        if (!alive) return;
        if (error instanceof BridgeUnavailable) {
          // Честная недоступность: offline-пометка, никакой мок не подменяет данные.
          setState((prev) => ({ ...prev, offline: true, error: error.message }));
        } else {
          setState((prev) => ({
            ...prev,
            offline: false,
            error: error instanceof Error ? error.message : 'screen error',
          }));
        }
        return;
      }

      let grid: string[];
      try {
        grid = renderAnsiScreenSafe(text, cols, rows);
      } catch (error) {
        if (!alive) return;
        setState((prev) => ({
          ...prev,
          offline: false,
          error: error instanceof Error ? error.message : 'screen render error',
        }));
        return;
      }

      if (!alive) return;
      setState({
        grid,
        screen: grid.join('\n').trimEnd(),
        error: null,
        offline: false,
        lastUpdated: Date.now(),
      });
    };

    void load();
    const timer = setInterval(() => void load(), pollMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [bridge, term, cols, rows, pollMs]);

  return state;
}
