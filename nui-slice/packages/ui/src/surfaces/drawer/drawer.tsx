'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from '../surfaces.module.css';

export interface DrawerProps {
  className?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: 'left' | 'right';
  label?: string;
  children?: ReactNode;
}

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Side drawer: aria-modal dialog — Escape closes, Tab is trapped, focus restored. */
export function Drawer({ className, open, onOpenChange, side = 'right', label, children }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const root = panelRef.current;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onOpenChange(false); return; }
      if (e.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled'));
      if (items.length === 0) { e.preventDefault(); return; }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { lastEl.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { firstEl.focus(); e.preventDefault(); }
    }
    document.addEventListener('keydown', onKey);
    root?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [open, onOpenChange]);

  if (!open) return null;
  return createPortal(
    <div className={[styles.drawerWrap, className].filter(Boolean).join(' ')}>
      <div className={styles.drawerBackdrop} onClick={() => onOpenChange(false)} aria-hidden="true" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label}
        className={styles.drawer} data-side={side} tabIndex={-1}>
        <div className={styles.drawerBody} tabIndex={0}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
