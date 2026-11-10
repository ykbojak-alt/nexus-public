import type { PresetInfo } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import { PRESET_FLAG_LABELS, PRESET_FLAG_ORDER } from './model-map';
import styles from './models.module.css';

export interface ModelComparisonProps {
  presets: PresetInfo[];
  state?: PatternState;
  title?: string;
}

/**
 * Preset comparison — flags matrix from server truth. Unknown preset
 * description renders '—' (missing-api §2.3: never fabricated).
 */
export function ModelComparison({ presets, state = 'ready', title = 'Сравнение пресетов' }: ModelComparisonProps) {
  const flagKeys = PRESET_FLAG_ORDER.filter((k) => presets.some((p) => k in p.flags));
  return (
    <section className={styles.root} data-state={state} data-testid="model-comparison" aria-label={title}>
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Загрузка пресетов…</p>}
      {state === 'error' && <p className={styles.muted}>Пресеты недоступны.</p>}
      {state === 'empty' && <p className={styles.muted}>Пресетов нет.</p>}
      {(state === 'ready' || state === 'stale') && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Пресет</th>
              {flagKeys.map((k) => (
                <th key={k} className={styles.th}>{PRESET_FLAG_LABELS[k] ?? k}</th>
              ))}
              <th className={styles.th}>Описание</th>
            </tr>
          </thead>
          <tbody>
            {presets.map((p) => (
              <tr key={p.name} data-default={p.isDefault}>
                <td className={styles.td}>
                  <span className={styles.rowName}>{p.name}</span>
                  {p.isDefault && <span className={styles.tag}>default</span>}
                </td>
                {flagKeys.map((k) => (
                  <td key={k} className={styles.td} data-on={p.flags[k] === true}>
                    {p.flags[k] === true ? '✓' : '—'}
                  </td>
                ))}
                <td className={styles.td} data-null={p.description == null}>
                  {p.description ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
