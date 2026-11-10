import type { DataFreshness } from '@nexus/ui';
import { StatusBadge } from '@nexus/ui';
import type { AgentSpec, PluginInfo, SystemMetrics } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import styles from './settings.module.css';

export interface CapabilitiesPanelProps {
  /** GET /v1/health components — null while loading. */
  health: SystemMetrics['health'] | null;
  /** Agent registry specs — capabilities[] verbatim. */
  agents: AgentSpec[] | null;
  /** Plugin registry — active flags verbatim. */
  plugins: PluginInfo[] | null;
  state?: PatternState;
  freshness?: DataFreshness;
  title?: string;
}

const HEALTH_STATUS: Record<string, 'complete' | 'warning' | 'error'> = {
  ok: 'complete',
  warn: 'warning',
  error: 'error',
};

function SourceLabel({ children }: { children: string }) {
  return <span className={styles.sourceLabel}>{children}</span>;
}

/**
 * Capabilities — composed view (missing-api §2.6): union of health
 * components, agent registry capabilities and plugin active flags.
 * No /v1/capabilities exists — every section names its own source so the
 * derivation stays honest. Each list renders its own state; a null list
 * means "still loading", never a guessed capability.
 */
export function CapabilitiesPanel({
  health,
  agents,
  plugins,
  state = 'ready',
  freshness,
  title = 'Возможности',
}: CapabilitiesPanelProps) {
  return (
    <section
      className={styles.root}
      data-state={state}
      data-freshness={freshness}
      data-testid="capabilities-panel"
      aria-label={title}
    >
      <h3 className={styles.title}>{title}</h3>
      {state === 'error' && <p className={styles.muted}>Возможности недоступны.</p>}
      {state !== 'error' && (
        <div className={styles.capGrid}>
          <div>
            <p className={styles.sectionLabel}>Компоненты <SourceLabel>/v1/health</SourceLabel></p>
            {health == null ? (
              <p className={styles.muted}>Загрузка…</p>
            ) : health.length === 0 ? (
              <p className={styles.muted}>Компоненты не сообщаются.</p>
            ) : (
              <ul className={styles.list}>
                {health.map((h) => (
                  <li key={h.component} className={styles.healthRow}>
                    <StatusBadge status={HEALTH_STATUS[h.status] ?? 'info'} label={h.status.toUpperCase()} />
                    <span className={styles.rowName}>{h.component}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className={styles.sectionLabel}>Агенты <SourceLabel>реестр</SourceLabel></p>
            {agents == null ? (
              <p className={styles.muted}>Загрузка…</p>
            ) : agents.length === 0 ? (
              <p className={styles.muted}>Агентов нет.</p>
            ) : (
              <ul className={styles.list}>
                {agents.map((a) => (
                  <li key={a.name} className={styles.capRow}>
                    <span className={styles.rowName}>{a.name}</span>
                    {a.capabilities.length === 0 ? (
                      <span className={styles.muted}>без заявленных возможностей</span>
                    ) : (
                      <span className={styles.capChips}>
                        {a.capabilities.map((c) => <span key={c} className={styles.capChip}>{c}</span>)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className={styles.sectionLabel}>Плагины <SourceLabel>/v1/plugins</SourceLabel></p>
            {plugins == null ? (
              <p className={styles.muted}>Загрузка…</p>
            ) : plugins.length === 0 ? (
              <p className={styles.muted}>Плагинов нет.</p>
            ) : (
              <ul className={styles.list}>
                {plugins.map((p) => (
                  <li key={p.name} className={styles.healthRow}>
                    <StatusBadge status={p.active ? 'complete' : 'offline'} label={p.active ? 'АКТИВЕН' : 'ВЫКЛ'} />
                    <span className={styles.rowName}>{p.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
