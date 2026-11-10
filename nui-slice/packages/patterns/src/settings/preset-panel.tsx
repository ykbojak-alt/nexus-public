import type { PresetInfo } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import { PRESET_FLAG_LABELS, PRESET_FLAG_ORDER } from '../models/model-map';
import styles from './settings.module.css';

export interface PresetPanelProps {
  presets: PresetInfo[];
  state?: PatternState;
  /** Client-side local pick (UserProfile.defaultPreset) — NOT a server write. */
  selectedName?: string | null;
  onPick?: (name: string) => void;
  title?: string;
}

/**
 * Goal & mode section (legacy S10) — preset flags stay read-only server
 * truth (`isDefault` = adapter's default). The pick writes a local profile
 * preference only; no `/v1/presets` write endpoint exists.
 */
export function PresetPanel({ presets, state = 'ready', selectedName, onPick, title = 'Цель и режим' }: PresetPanelProps) {
  const flagKeys = PRESET_FLAG_ORDER.filter((k) => presets.some((p) => k in p.flags));
  return (
    <section className={styles.root} data-state={state} data-testid="preset-panel" aria-label={title}>
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Загрузка пресетов…</p>}
      {state === 'error' && <p className={styles.muted}>Пресеты недоступны.</p>}
      {state === 'empty' && <p className={styles.muted}>Пресетов нет.</p>}
      {(state === 'ready' || state === 'stale') && (
        <ul className={styles.list}>
          {presets.map((p) => (
            <li key={p.name}>
              <button
                type="button"
                className={styles.pickRow}
                data-selected={selectedName === p.name}
                onClick={() => onPick?.(p.name)}
              >
                <span className={styles.rowMain}>
                  <span className={styles.rowName}>
                    {p.name}
                    {p.isDefault && <span className={styles.tag}>default</span>}
                  </span>
                  <span className={styles.rowSub} data-null={p.description == null}>
                    {p.description ?? '—'}
                  </span>
                </span>
                <span className={styles.capChips} aria-label="Флаги">
                  {flagKeys.map((k) => (
                    <span key={k} className={styles.capChip} data-on={p.flags[k] === true}>
                      {PRESET_FLAG_LABELS[k] ?? k} {p.flags[k] === true ? '✓' : '—'}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
