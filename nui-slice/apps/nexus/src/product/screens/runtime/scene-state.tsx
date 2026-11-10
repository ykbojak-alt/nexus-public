'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { UnrealSceneHostState } from '@nexus/mock-data';
import { getDataSource, useDataSource } from '../../data-source';
import { peekWarm } from '../../runtime-warmup';
import { runWhileDocumentVisible } from '../../visible-interval';

interface RuntimeSceneState {
  seam: ReturnType<typeof getDataSource>['unrealScene'];
  state: UnrealSceneHostState | null;
  failed: boolean;
  opening: boolean;
  refresh(): Promise<void>;
  open(): Promise<void>;
}

const SceneStateContext = createContext<RuntimeSceneState | null>(null);
const POLL_MS = 10_000;

export function RuntimeSceneStateProvider({ children }: { children: ReactNode }) {
  const ds = useDataSource();
  const seam = ds.unrealScene;
  const [state, setState] = useState<UnrealSceneHostState | null>(() => peekWarm('scene') ?? null);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (seam == null) return;
    let live = true;
    const accept = (next: UnrealSceneHostState) => {
      if (!live) return;
      setState(next);
      setFailed(false);
    };
    const poll = () => {
      seam.getState().then(accept).catch(() => {
        if (live) setFailed(true);
      });
    };
    const unsubscribe = seam.subscribe?.(accept);
    poll();
    const stopPolling = unsubscribe == null ? runWhileDocumentVisible(poll, POLL_MS) : undefined;
    return () => {
      live = false;
      unsubscribe?.();
      stopPolling?.();
    };
  }, [seam]);

  const refresh = useCallback(async () => {
    if (seam == null) return;
    setFailed(false);
    try {
      const next = await seam.getState();
      if (mounted.current) {
        setState(next);
        setFailed(false);
      }
    } catch {
      if (mounted.current) setFailed(true);
    }
  }, [seam]);

  const open = useCallback(async () => {
    if (seam == null || opening) return;
    setOpening(true);
    try {
      const next = await seam.open();
      if (mounted.current) {
        setState(next);
        setFailed(false);
      }
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      if (mounted.current) setOpening(false);
    }
  }, [seam, opening]);

  const value = useMemo(
    () => ({ seam, state, failed, opening, refresh, open }),
    [seam, state, failed, opening, refresh, open],
  );

  return <SceneStateContext.Provider value={value}>{children}</SceneStateContext.Provider>;
}

export function useRuntimeSceneState(): RuntimeSceneState {
  const value = useContext(SceneStateContext);
  if (value == null) throw new Error('Runtime scene state must be used inside RuntimeSceneStateProvider');
  return value;
}
