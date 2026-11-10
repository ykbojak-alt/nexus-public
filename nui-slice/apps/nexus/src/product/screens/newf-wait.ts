'use client';

/**
 * W12: useWait — хук «долгого ожидания изменений» (HTTP long-poll/интервал)
 * для мест, где SSE не покрывает (worktree-status, audit, и т.п.).
 *
 * Периодически вызывает poll(); хранит последнее значение и счётчик изменений.
 * Опции:
 *  - intervalMs — интервал опроса (по умолчанию 2000);
 *  - timeoutMs — максимум ожидания до сдачи (0 = бесконечно);
 *  - equals — компаратор для детекта изменения (по умолчанию JSON-сравнение).
 * Честная недоступность: ошибка poll → error, значение сохраняется (stale).
 */

import { useEffect, useRef, useState } from 'react';

export interface UseWaitOptions<T> {
  intervalMs?: number;
  timeoutMs?: number;
  equals?: (a: T, b: T) => boolean;
}

export interface UseWaitResult<T> {
  value: T | null;
  error: string | null;
  /** сколько раз значение изменилось (0 — ещё не было изменений) */
  changes: number;
  /** последнее изменение как «свежее» (true, пока опрос идёт без ошибок) */
  fresh: boolean;
}

function defaultEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useWait<T>(
  poll: () => Promise<T>,
  opts: UseWaitOptions<T> = {},
): UseWaitResult<T> {
  const { intervalMs = 2000, timeoutMs = 0, equals = defaultEquals } = opts;
  const [state, setState] = useState<UseWaitResult<T>>({ value: null, error: null, changes: 0, fresh: false });
  const prevRef = useRef<{ value: T | null; has: boolean }>({ value: null, has: false });
  const startedRef = useRef<number>(Date.now());
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    startedRef.current = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (!aliveRef.current) return;
      if (timeoutMs > 0 && Date.now() - startedRef.current > timeoutMs) {
        // Таймаут — это не ошибка; просто перестаём опрашивать.
        setState((prev) => ({ ...prev, fresh: false }));
        return;
      }
      try {
        const value = await poll();
        if (!aliveRef.current) return;
        const prev = prevRef.current;
        const changed = !prev.has || !equals(prev.value as T, value);
        prevRef.current = { value, has: true };
        setState((s) => ({
          value,
          error: null,
          changes: s.changes + (changed ? 1 : 0),
          fresh: true,
        }));
      } catch (error) {
        if (!aliveRef.current) return;
        setState((s) => ({
          ...s,
          error: error instanceof Error ? error.message : String(error),
          fresh: false,
        }));
      }
    };

    void tick();
    timer = setInterval(() => void tick(), intervalMs);
    return () => {
      aliveRef.current = false;
      if (timer !== undefined) clearInterval(timer);
    };
  }, [poll, intervalMs, timeoutMs, equals]);

  return state;
}
