// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, act, waitFor } from '@testing-library/react';
import { useWait } from './newf-wait';

afterEach(cleanup);

describe('useWait (W12)', () => {
  it('поллит и детектит изменения (changes увеличивается)', async () => {
    let value = 0;
    const poll = vi.fn(async () => value);
    const { result } = renderHook(() => useWait(poll, { intervalMs: 30 }));

    await waitFor(() => expect(result.current.value).toBe(0));
    expect(result.current.changes).toBe(1);

    act(() => { value = 1; });
    await waitFor(() => expect(result.current.value).toBe(1));
    expect(result.current.changes).toBe(2);
    expect(result.current.fresh).toBe(true);
  });

  it('ошибка poll → error, stale-значение сохраняется', async () => {
    const poll = vi.fn()
      .mockImplementationOnce(() => Promise.resolve('ok'))
      .mockImplementation(() => Promise.reject(new Error('boom')));
    const { result } = renderHook(() => useWait(poll, { intervalMs: 30 }));

    await waitFor(() => expect(result.current.value).toBe('ok'));
    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.value).toBe('ok'); // stale
    expect(result.current.fresh).toBe(false);
  });

  it('timeoutMs прекращает опрос (fresh=false), без ошибки', async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async () => 42);
    const { result } = renderHook(() => useWait(poll, { intervalMs: 20, timeoutMs: 50 }));

    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(result.current.value).toBe(42);
    expect(result.current.fresh).toBe(false);
    expect(result.current.error).toBeNull();
    vi.useRealTimers();
  });
});
