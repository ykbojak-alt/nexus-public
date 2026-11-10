'use client';

import { useRef, type KeyboardEvent } from 'react';
import styles from './tabs.module.css';

export interface TabItem {
  id: string;
  label: string;
  disabled?: boolean;
  /** Id of the controlled tabpanel element — emits aria-controls on the tab
   *  and a deterministic `id` (`<controls>-tab`) for panel aria-labelledby. */
  controls?: string;
}
export interface TabsProps {
  className?: string;
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  'aria-label'?: string;
}

/** Roving tabindex + Arrow/Home/End navigation (spec §14 keyboard model). */
export function Tabs({ className, tabs, value, onChange, 'aria-label': ariaLabel }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  function move(from: number, dir: 1 | -1 | 'home' | 'end') {
    const enabled = tabs.filter((t) => !t.disabled);
    const current = enabled.indexOf(tabs[from]);
    const next = dir === 'home' ? 0
      : dir === 'end' ? enabled.length - 1
        : (current + dir + enabled.length) % enabled.length;
    const target = enabled[next];
    if (!target) return;
    listRef.current?.querySelector<HTMLElement>(`[data-tab="${target.id}"]`)?.focus();
    onChange(target.id);
  }

  function onKeyDown(e: KeyboardEvent, index: number) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(index, 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(index, -1); }
    else if (e.key === 'Home') { e.preventDefault(); move(index, 'home'); }
    else if (e.key === 'End') { e.preventDefault(); move(index, 'end'); }
  }

  return (
    <div ref={listRef} className={[styles.root, className].filter(Boolean).join(' ')} role="tablist" aria-label={ariaLabel} data-testid="tabs">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          data-tab={t.id}
          className={styles.tab}
          id={t.controls != null ? `${t.controls}-tab` : undefined}
          aria-controls={t.controls}
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          disabled={t.disabled}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
