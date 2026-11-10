import type { NexusMission, NexusMissionStep } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import { MISSION_STEP_LABELS, missionStepBadge } from './mission-map';
import styles from './missions.module.css';

export interface MissionProgressProps {
  mission: NexusMission | null;
  state?: PatternState;
  title?: string;
}

const ORDER: NexusMissionStep['state'][] = ['done', 'active', 'pending', 'failed', 'skipped'];

function countSteps(mission: NexusMission): Record<NexusMissionStep['state'], number> {
  const acc: Record<NexusMissionStep['state'], number> = { pending: 0, active: 0, done: 0, failed: 0, skipped: 0 };
  for (const s of mission.steps) acc[s.state] += 1;
  return acc;
}

/**
 * Mission progress — honest step counts and a segmented bar derived from
 * real counts. No fabricated percentages: "2/3 готово" is the source of truth.
 */
export function MissionProgress({ mission, state = 'ready', title = 'Прогресс' }: MissionProgressProps) {
  const counts = mission ? countSteps(mission) : null;
  const total = mission?.steps.length ?? 0;
  return (
    <section className={styles.root} data-state={state} data-testid="mission-progress" aria-label={title}>
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Подсчёт шагов…</p>}
      {state === 'error' && <p className={styles.muted}>Прогресс недоступен.</p>}
      {state === 'empty' && <p className={styles.muted}>Нет шагов для подсчёта.</p>}
      {(state === 'ready' || state === 'stale') && mission && counts && (
        <>
          <p className={styles.progressLine}>
            <strong>{counts.done}</strong> из <strong>{total}</strong> готово
          </p>
          {total > 0 && (
            <div className={styles.bar} role="img" aria-label={`${counts.done} из ${total} шагов завершено`}>
              {ORDER.map((st) =>
                counts[st] > 0 ? (
                  <span
                    key={st}
                    className={styles.seg}
                    data-step-state={st}
                    style={{ width: `${(counts[st] / total) * 100}%` }}
                    title={`${MISSION_STEP_LABELS[st]}: ${counts[st]}`}
                  />
                ) : null,
              )}
            </div>
          )}
          <p className={styles.muted}>
            {ORDER.filter((st) => counts[st] > 0)
              .map((st) => `${MISSION_STEP_LABELS[st]} ${counts[st]}`)
              .join(' · ')}
          </p>
        </>
      )}
    </section>
  );
}
