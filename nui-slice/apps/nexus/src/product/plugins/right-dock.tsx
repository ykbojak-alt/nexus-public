/**
 * Правая докинг-панель NEU — кнопка топбара и публичные хуки состояния.
 * Разметка панели вынесена в `right-dock-panel.tsx` и грузится лениво:
 * по умолчанию док скрыт, поэтому его разметка не нужна в первом бандле.
 */
'use client';

import { Tooltip } from '@nexus/ui';
import { shortcutHint } from '../keyboard-shortcuts';
import { useSlot, type RightbarTabDef } from './plugin-host';
import './builtin';
import styles from './right-dock.module.css';
import type { RightDockApi } from './right-dock-state';

export * from './right-dock-state';

/** Кнопка топбара — вход в панель (режим push ↔ hidden). */
export function RightDockToggle({ dock }: { dock: RightDockApi }) {
  const entries = useSlot<RightbarTabDef>('rightbar.tabs');
  const open = dock.state.mode !== 'hidden';
  return (
    <Tooltip content="Правая панель — вкладки плагинов" kbd={[shortcutHint('dock.toggle'), shortcutHint('dock.toggle.alt')]}>
      <button
      ref={dock.triggerRef}
      type="button"
      className={styles.dockToggle}
      data-testid="right-dock-toggle"
      aria-pressed={open}
      aria-label={open ? 'Скрыть правую панель' : 'Показать правую панель'}
      onClick={(event) => {
        if (open) {
          dock.setMode('hidden');
        } else {
          dock.setInvoker(event.currentTarget);
          const first = dock.state.active ?? dock.state.open[0] ?? entries[0]?.key ?? null;
          if (first != null && !dock.state.open.includes(first)) dock.openTab(first);
          dock.setMode('push');
          if (dock.state.active == null && first != null) dock.activate(first);
        }
      }}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M2 2h12v12H2z" opacity=".25" />
        <path fill="currentColor" d="M9.5 2H14v12H9.5z" />
      </svg>
    </button>
    </Tooltip>
  );
}
