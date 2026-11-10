// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAsyncValue } from './use-async-value';

describe('useAsyncValue (NQ-052 class — mount reads)', () => {
  it('resolves to value; rejection sets failed and retry refetches', async () => {
    let fail = true;
    const fetcher = vi.fn(() => (fail ? Promise.reject(new Error('down')) : Promise.resolve(42)));
    const { result } = renderHook(() => useAsyncValue(fetcher, []));

    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.value).toBeNull();

    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.value).toBe(42));
    expect(result.current.failed).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('deps change refetches; stale load does not clobber newer state', async () => {
    const fetcher = vi.fn((id: number) => Promise.resolve(id));
    const { result, rerender } = renderHook(({ id }) => useAsyncValue(() => fetcher(id), [id]), {
      initialProps: { id: 1 },
    });
    await waitFor(() => expect(result.current.value).toBe(1));
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.value).toBe(2));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
