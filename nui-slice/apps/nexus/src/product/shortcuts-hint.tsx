'use client';

import { useEffect, useState } from 'react';
import { KEYBOARD_SHORTCUTS } from './keyboard-shortcuts';
import styles from './shortcuts-hint.module.css';

/**
 * UI-2: справка по шорткатам — оверлей со списком канонических
 * привязок (KEYBOARD_SHORTCUTS). Открытие: «?» или Ctrl/Cmd+/.
 * Тот же визуальный паттерн, что у командной палитры: backdrop +
 * dialog, Esc/клик по фону закрывает.
 */
export function ShortcutsHint() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target != null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (e.key === '?') {
        if (typing) return;
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === '/') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Горячие клавиши">
        <h2 className={styles.title}>Горячие клавиши</h2>
        <ul className={styles.list}>
          {KEYBOARD_SHORTCUTS.map((s) => (
            <li key={s.id} className={styles.row}>
              <kbd className={styles.kbd}>{s.hint}</kbd>
              <span className={styles.desc}>{s.description}</span>
            </li>
          ))}
        </ul>
        <p className={styles.note}>«?» или Ctrl/Cmd+/ — показать или скрыть справку.</p>
      </div>
    </div>
  );
}
