import { StatusBadge } from '@nexus/ui';
import type { PluginInfo } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import styles from './settings.module.css';

export interface ToolsPanelProps {
  plugins: PluginInfo[];
  state?: PatternState;
  /** Names with an in-flight write — rendered pending, NOT saved. */
  pending?: ReadonlySet<string>;
  /** Last write error per name — shown explicitly until next attempt. */
  errors?: Readonly<Record<string, string>>;
  /** Toggle request — the screen owns optimistic update + rollback. */
  onToggle?: (name: string, active: boolean) => void;
  title?: string;
}

/**
 * Tools panel — plugin registry with write-capable toggles. A pending row
 * shows "…" and is disabled; a failed write surfaces its error inline
 * (owner decision: optimistic UI must roll back — the screen implements it).
 */
export function ToolsPanel({ plugins, state = 'ready', pending, errors, onToggle, title = 'Инструменты' }: ToolsPanelProps) {
  return (
    <section className={styles.root} data-state={state} data-testid="tools-panel" aria-label={title}>
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Загрузка плагинов…</p>}
      {state === 'error' && <p className={styles.muted}>Плагины недоступны.</p>}
      {state === 'empty' && <p className={styles.muted}>Плагины не зарегистрированы.</p>}
      {(state === 'ready' || state === 'stale') && (
        <ul className={styles.list}>
          {plugins.map((p) => {
            const busy = pending?.has(p.name) === true;
            const err = errors?.[p.name];
            return (
              <li key={p.name} className={styles.toolRow} data-busy={busy || undefined}>
                <span className={styles.rowMain}>
                  <span className={styles.rowName}>
                    {p.name}
                    {' '}<span className={styles.tag} data-ok={p.signed}>{p.signed ? 'signed' : 'unsigned'}</span>
                    {p.hasSecret && <span className={styles.tag}>secret</span>}
                  </span>
                  <span className={styles.rowSub}>{p.url}</span>
                  {err && <span className={styles.error} role="alert">{err}</span>}
                </span>
                <StatusBadge
                  status={busy ? 'syncing' : p.active ? 'active' : 'paused'}
                  label={busy ? '…' : p.active ? 'ON' : 'OFF'}
                />
                <button
                  type="button"
                  className={styles.toggle}
                  disabled={busy || !onToggle}
                  onClick={() => onToggle?.(p.name, !p.active)}
                  aria-label={`${p.active ? 'Выключить' : 'Включить'} ${p.name}`}
                >
                  {p.active ? 'Выключить' : 'Включить'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
