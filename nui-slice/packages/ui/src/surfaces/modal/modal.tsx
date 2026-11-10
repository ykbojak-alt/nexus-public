'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import styles from './modal.module.css';

export interface ModalProps {
  className?: string;
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
  footer?: ReactNode;
}

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog: role=dialog + aria-modal, Escape closes, focus is trapped
 * inside while open and restored to the invoker on close (spec §14).
 */
export function Modal({ className, open, onClose, title, children, footer }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    const root = ref.current;
    const first = root?.querySelector<HTMLElement>(FOCUSABLE);
    // No focusable child → the dialog itself takes focus; focus must never
    // stay behind the backdrop.
    (first ?? root)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled'));
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { lastEl.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { firstEl.focus(); e.preventDefault(); }
    }
    document.addEventListener('keydown', onKey);
    const restore = restoreRef.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      if (restore instanceof HTMLElement) restore.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className={[styles.backdrop, className].filter(Boolean).join(' ')} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={styles.dialog} role="dialog" aria-modal="true" aria-label={title} data-testid="modal" tabIndex={-1}>
        {title != null && <div className={styles.title}>{title}</div>}
        <div className={styles.body}>{children}</div>
        {footer != null && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}
