'use client';

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

export interface AsyncValue<T> {
  /** null = still loading (never resolved or refetch in flight). */
  value: T | null;
  /** Last fetch rejected — the panel must render error, not loading/empty. */
  failed: boolean;
  /** Re-runs the fetch; clears the error flag and returns to loading. */
  retry: () => void;
  /** Direct write for local mutations after a successful read (mock-mode edits). */
  set: Dispatch<SetStateAction<T | null>>;
}

/**
 * Mount-read primitive (W3-14 / NQ-052 class): a `.then()` without `.catch()`
 * leaves panels in loading forever and leaks unhandled rejections on live
 * transport failures. `failed` + `retry` make every initial read recoverable
 * and honestly surfaced. `deps` refetch — same semantics as useEffect deps;
 * a refetch resets `value` to null so a filter change never shows stale rows
 * under a new label.
 */
export function useAsyncValue<T>(fetcher: () => Promise<T>, deps: readonly unknown[]): AsyncValue<T> {
  const [value, setValue] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    setValue(null);
    let live = true;
    Promise.resolve()
      .then(fetcher)
      .then((v) => { if (live) setValue(v); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetcher identity is the caller's
  }, deps);

  useEffect(() => load(), [load]);

  return { value, failed, retry: load, set: setValue };
}
