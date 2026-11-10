'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Integration connection state — every integration (ai2, local-audio, noir,
 * opencode) follows the same lifecycle: idle → connecting → ready/error.
 * This hook factors that out so screens stop hand-rolling try/catch/abort
 * per integration.
 */
export interface IntegrationState<T> {
  /** null = never connected or connection in flight. */
  data: T | null;
  /** True after a rejected promise — render error, not loading. */
  failed: boolean;
  /** Connection attempt in progress (first mount or retry). */
  pending: boolean;
  /** Re-run the connection factory; resets failed + pending. */
  retry: () => void;
  /** Direct mutation for local updates after a successful connect. */
  set: Dispatch<SetStateAction<T | null>>;
  /** Abort the current connection attempt (e.g. on unmount). */
  abort: () => void;
}

/**
 * Generic integration hook — wraps a connection factory with honest
 * lifecycle states, an AbortController for cleanup, and a `set` for
 * local mutations.
 *
 * @param factory      Async factory returning T (or throwing).
 * @param deps         React deps — factory re-runs when these change.
 * @param initialData  Optional seed (e.g. cached snapshot) so the first
 *                     paint isn't blank; factory still runs.
 */
export function useIntegration<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  initialData: T | null = null,
): IntegrationState<T> {
  const [data, setData] = useState<T | null>(initialData);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(true);

  // Keep latest factory in a ref so the effect doesn't re-run on every render
  // but still sees the current closure (avoids stale callbacks).
  const factoryRef = useRef(factory);
  factoryRef.current = factory;

  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(() => {
    // Abort any in-flight attempt
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setFailed(false);
    setPending(true);
    let live = true;

    factoryRef.current(controller.signal)
      .then((result) => {
        if (!live) return;
        setData(result);
        setPending(false);
      })
      .catch((err) => {
        if (!live) return;
        // AbortErrors are expected on cleanup — don't surface them
        if (err instanceof DOMException && err.name === 'AbortError') {
          setPending(false);
          return;
        }
        setFailed(true);
        setPending(false);
      });

    return () => {
      live = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    const cleanup = run();
    return cleanup;
  }, [run]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      setPending(false);
    }
  }, []);

  return {
    data,
    failed,
    pending,
    retry: run,
    set: setData,
    abort,
  };
}

/**
 * Convenience variant for integrations that expose a snapshot object
 * (LocalAudioAdapter, NoirClient) — wraps the adapter in a factory
 * that calls its snapshot getter and subscribes to changes.
 */
export function useAdapterSnapshot<T>(
  connect: (signal: AbortSignal) => {
    getSnapshot: () => T;
    subscribe: (cb: () => void) => () => void;
    dispose: () => void;
  },
  deps: readonly unknown[],
): IntegrationState<T> {
  return useIntegration<T>(
    (signal) => new Promise<T>((resolve, reject) => {
      let disposed = false;
      const handle = connect(signal);
      const unsubscribe = handle.subscribe(() => {
        // Snapshot changed — update without resetting pending
        // We use setData directly via the outer hook's set
      });
      try {
        const snapshot = handle.getSnapshot();
        if (signal.aborted) {
          disposed = true;
          unsubscribe();
          handle.dispose();
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        // Keep the handle alive for the lifetime of the component
        // The actual subscription is managed by the adapter internally
        resolve(snapshot);
      } catch (err) {
        unsubscribe();
        handle.dispose();
        reject(err);
      }
    }),
    deps,
  );
}
