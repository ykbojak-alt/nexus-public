'use client';

/**
 * W26: useVirtualList — виртуализация вертикального списка.
 * Рендерит только видимый диапазон (start..end) при фиксированной высоте строки.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

export interface VirtualListResult<T, E extends HTMLElement = HTMLDivElement> {
  start: number;
  end: number;
  visible: T[];
  containerRef: React.RefObject<E | null>;
  totalHeight: number;
}

export function useVirtualList<T, E extends HTMLElement = HTMLDivElement>(
  items: T[],
  rowHeight: number,
  overscan = 5,
): VirtualListResult<T, E> {
  const containerRef = useRef<E | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(300);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setViewport(el.clientHeight || 300);
    update();
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll);
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', update);
    };
  }, []);

  return useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(items.length, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
    return {
      start,
      end,
      visible: items.slice(start, end),
      containerRef,
      totalHeight: items.length * rowHeight,
    };
  }, [items, scrollTop, viewport, rowHeight, overscan]);
}
