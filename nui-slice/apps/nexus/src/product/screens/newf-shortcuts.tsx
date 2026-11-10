'use client';

/**
 * W21: Keyboard-shortcuts — карта + help-overlay.
 */

import { useRef } from 'react';
import { useFocusTrap } from './newf-focus-trap';

export interface ShortcutDef {
  combo: string;
  description: string;
}

export const SHORTCUTS: ShortcutDef[] = [
  { combo: 'Ctrl+Shift+L', description: 'Переключить layout (next)' },
  { combo: '?', description: 'Показать/скрыть справку по шорткатам' },
  { combo: 'Escape', description: 'Закрыть справку / меню' },
  { combo: 'Tab', description: 'Фокус следующей панели' },
  { combo: 'Enter', description: 'Ввод в панели терминала (send)' },
  { combo: '↑/↓/←/→', description: 'Навигация по содержимому терминала' },
  { combo: 'Ctrl+C', description: 'Interrupt (keys ctrl+c)' },
  { combo: 'Ctrl+D', description: 'EOF (keys ctrl+d)' },
];

export interface ShortcutHelpProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutHelp({ open, onClose }: ShortcutHelpProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(panelRef, open);
  if (!open) return null;
  return (
    <div
      className="shortcutOverlay"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      data-testid="shortcut-help"
      onClick={onClose}
    >
      <div ref={panelRef} className="shortcutPanel" onClick={(e) => e.stopPropagation()}>
        <h3>Keyboard shortcuts</h3>
        <ul>
          {SHORTCUTS.map((s) => (
            <li key={s.combo}>
              <code data-testid={`shortcut-${s.combo}`}>{s.combo}</code>
              <span>{s.description}</span>
            </li>
          ))}
        </ul>
        <button type="button" data-testid="shortcut-close" onClick={onClose}>закрыть (Escape)</button>
      </div>
    </div>
  );
}
