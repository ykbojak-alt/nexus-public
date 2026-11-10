'use client';

/**
 * W24: useFocusTrap — зацикливает Tab внутри активного контейнера.
 * Возвращает ref; когда active и контейнер смонтирован — первый focusable
 * получает фокус, Tab/Shift+Tab ходят по кругу.
 */

import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function setInitialFocus(container: HTMLElement): void {
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  const first = items[0];
  if (first) first.focus();
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;

    // можно фокусировать только когда активна (избегаем пересечения с другими)
    const els = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = els();
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (current === first || current === null || !container.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else if (current === last || current === null || !container.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    };

    setInitialFocus(container);
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [ref, active]);
}
