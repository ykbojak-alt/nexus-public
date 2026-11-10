'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from '../surfaces.module.css';

export interface PopoverProps {
  className?: string;
  trigger: ReactNode;          // rendered as a button's content wrapper
  children: ReactNode;
  label?: string;
  align?: 'start' | 'end';
}

/** Minimal anchored popover: click toggles, Escape/outside closes, trigger refocused. */
export function Popover({ className, trigger, children, label, align = 'start' }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        (prev ?? btnRef.current)?.focus();
      }
    }
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }} className={className}>
      <button
        type="button"
        ref={btnRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={styles.unstyledTrigger}
      >
        {trigger}
      </button>
      {open && (
        <div id={id} role="dialog" aria-label={label} className={styles.popover}
          style={align === 'end' ? { left: 'auto', right: 0 } : undefined}>
          {children}
        </div>
      )}
    </span>
  );
}
