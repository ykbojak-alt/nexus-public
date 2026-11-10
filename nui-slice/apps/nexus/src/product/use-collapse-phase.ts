'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { DURATION_MS } from '@nexus/motion';
import { useReducedMotion } from './use-reduced-motion';

export type CollapsePhase = 'collapsing' | 'expanding' | null;

/**
 * W4-1015 · collapse/expand keep-alive — зеркало useDockExit.
 *
 * При флипе `collapsed` возвращает фазу на окно `durationMs` (шкала
 * `duration.fast`, 140ms): в `'collapsing'` исходящий контент остаётся
 * смонтированным и играет shrink-кадры (grid-rows 1fr→0fr + fade),
 * в `'expanding'` — входящий играет grow. По таймеру фаза схлопывается
 * в стабильное состояние и лишний DOM уходит.
 *
 * Reduced-motion → фаза не выставляется (или сразу сбрасывается при
 * смене preference), swap мгновенный — промежуточных кадров нет.
 */
export function useCollapsePhase(
  collapsed: boolean,
  durationMs: number = DURATION_MS.fast,
): CollapsePhase {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<CollapsePhase>(null);
  const prev = useRef(collapsed);
  useLayoutEffect(() => {
    const changed = prev.current !== collapsed;
    if (changed) prev.current = collapsed;
    if (!changed) {
      if (reduced || durationMs <= 0) setPhase(null);
      return;
    }
    if (reduced || durationMs <= 0) {
      setPhase(null);
      return;
    }
    setPhase(collapsed ? 'collapsing' : 'expanding');
    const timer = window.setTimeout(() => setPhase(null), durationMs);
    return () => window.clearTimeout(timer);
  }, [collapsed, reduced, durationMs]);
  return phase;
}
