'use client';

/**
 * W23: Notifications tray.
 * Лоток уведомлений: поступление (входные), история (последние N).
 */

import { useEffect, useRef, useState } from 'react';
import styles from './newf-agents-panel.module.css';

export interface Notice {
  id: string;
  text: string;
  ts: number;
  kind?: 'attention' | 'info' | 'error';
}

export interface NotificationsTrayProps {
  notices: Notice[];
  onDismiss?: (id: string) => void;
  onClear?: () => void;
  max?: number;
}

export function NotificationsTray({ notices, onDismiss, onClear, max = 50 }: NotificationsTrayProps) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [notices.length, open]);

  return (
    <div className={styles.tray} data-testid="notifications-tray">
      <button
        type="button"
        className={styles.trayToggle}
        data-testid="tray-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >🔔 {notices.length > 0 ? notices.length : ''}</button>
      {open && (
        <div className={styles.trayPanel} data-testid="tray-panel">
          <div className={styles.trayHeader}>
            <span>Notifications</span>
            {onClear && <button type="button" className={styles.filterChip} data-testid="tray-clear" onClick={onClear}>clear</button>}
          </div>
          <ul className={styles.trayList} ref={listRef}>
            {notices.slice(-max).map((n) => (
              <li key={n.id} className={styles.trayItem} data-testid={`notice-${n.id}`} data-kind={n.kind ?? 'info'}>
                <span className={styles.trayText}>{n.text}</span>
                {onDismiss && (
                  <button type="button" className={styles.floatingBtn} data-testid={`notice-dismiss-${n.id}`} onClick={() => onDismiss(n.id)}>×</button>
                )}
              </li>
            ))}
            {notices.length === 0 && <li className={styles.empty}>нет уведомлений</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
