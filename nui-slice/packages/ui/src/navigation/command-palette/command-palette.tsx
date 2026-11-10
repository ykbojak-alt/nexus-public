'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './command-palette.module.css';

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface CommandItem { id: string; label: string; hint?: string }
export interface CommandPaletteProps {
  className?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
  onSelect: (id: string) => void;
  placeholder?: string;
  /** Wave XII header-search: query выходит наружу — источники с серверным
   *  поиском (searchMemory) подмешивают результаты в items сами. */
  onQuery?: (query: string) => void;
  /** Результаты серверного поиска — показываются как есть, без
   *  клиентской фильтрации по подстроке (совпадение может быть не
   *  текстовым: FTS/семантика решает источник). */
  serverItems?: CommandItem[];
}

/**
 * Controlled command palette (spec §14): listbox + combobox semantics;
 * Arrow keys move the active option; Enter selects; Escape closes. The
 * application shell owns global shortcut registration.
 */
export function CommandPalette({ className, open, onOpenChange, items, onSelect, placeholder = 'Type a command…', onQuery, serverItems }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<Element | null>(null);

  useEffect(() => {
    // Input is mounted by the time this effect runs — focus synchronously
    // (rAF caused a focus-timing flake, NQ-023).
    if (!open) return;
    restoreRef.current = document.activeElement;
    setQuery('');
    setActive(0);
    inputRef.current?.focus();
    // aria-modal → trap Tab inside; restore focus to the invoker on close
    // (same contract as Modal/Drawer — focus must not die with the input).
    const root = dialogRef.current;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled'));
      if (items.length === 0) { e.preventDefault(); return; }
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
  }, [open]);

  const filtered = useMemo(
    () => items.filter((i) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      const label = i.label.toLowerCase();
      return q.split(/\s+/).every((word) => label.includes(word));
    }),
    [items, query],
  );
  // Серверные результаты — после локальных, фильтрацией не трогаем;
  // дубли по id исключаем (сервер мог вернуть то, что уже в items).
  const shown = useMemo(() => {
    if (serverItems == null || serverItems.length === 0) return filtered;
    const seen = new Set(filtered.map((i) => i.id));
    return [...filtered, ...serverItems.filter((i) => !seen.has(i.id))];
  }, [filtered, serverItems]);

  if (!open) return null;
  const listId = 'nexus-command-list';

  function pick(index: number) {
    const item = shown[index];
    if (!item) return;
    onSelect(item.id);
    onOpenChange(false);
  }

  return (
    <div className={[styles.backdrop, className].filter(Boolean).join(' ')} onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}>
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="Command palette" data-testid="command-palette">
        <input
          ref={inputRef}
          className={styles.input}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={shown[active] ? `${listId}-${shown[active].id}` : undefined}
          aria-autocomplete="list"
          aria-label={placeholder}
          placeholder={placeholder}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); onQuery?.(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onOpenChange(false);
            else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            // NQ-110: Enter обязан быть поглощён палитрой — pick() размонтирует
            // диалог и cleanup синхронно вернёт фокус на инвокер посреди
            // dispatch'а; без preventDefault отложенная активация Enter
            // достаётся инвокеру (кнопке) и кликает её (правый док открывался
            // и утаскивал фокус на resizer).
            else if (e.key === 'Enter') { e.preventDefault(); pick(active); }
          }}
        />
        <div className={styles.list} role="listbox" id={listId}>
          {shown.length === 0 && <div className={styles.empty}>No results</div>}
          {shown.map((item, i) => (
            <div
              key={item.id}
              id={`${listId}-${item.id}`}
              role="option"
              aria-selected={i === active}
              className={styles.option}
              data-active={i === active || undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(i); }}
            >
              <span>{item.label}</span>
              {item.hint != null && <span className={styles.hint}>{item.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
