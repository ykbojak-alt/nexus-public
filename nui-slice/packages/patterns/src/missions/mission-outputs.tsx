import type { NexusMission } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import { OUTPUT_KIND_LABELS } from './mission-map';
import styles from './missions.module.css';

export interface MissionOutputsProps {
  mission: NexusMission | null;
  state?: PatternState;
  /** Opening an output's run is a callback — the pattern never navigates. */
  onOpenRun?: (runId: string) => void;
  title?: string;
}

/**
 * Mission outputs — produced answers/artifacts/reports. `runId` links are
 * delegated to the caller via `onOpenRun`; absent runId renders inert.
 */
export function MissionOutputs({ mission, state = 'ready', onOpenRun, title = 'Выходы' }: MissionOutputsProps) {
  return (
    <section className={styles.root} data-state={state} data-testid="mission-outputs" aria-label={title}>
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Загрузка выходов…</p>}
      {state === 'error' && <p className={styles.muted}>Выходы недоступны.</p>}
      {state === 'empty' && <p className={styles.muted}>Выходов пока нет.</p>}
      {(state === 'ready' || state === 'stale') && mission && (
        <ul className={styles.list}>
          {mission.outputs.map((o) => (
            <li key={o.id} className={styles.output}>
              <span className={styles.cap}>{OUTPUT_KIND_LABELS[o.kind]}</span>
              {o.runId ? (
                <button type="button" className={styles.outputLink} onClick={() => onOpenRun?.(o.runId!)}>
                  {o.label}
                </button>
              ) : (
                <span className={styles.rowName}>{o.label}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
