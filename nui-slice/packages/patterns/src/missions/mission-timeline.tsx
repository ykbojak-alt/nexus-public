import type { DataFreshness } from '@nexus/ui';
import { StatusBadge } from '@nexus/ui';
import type { NexusMission } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import { MISSION_STEP_LABELS, fmtDurationSec, missionStepBadge, stepDurationSec } from './mission-map';
import styles from './missions.module.css';

export interface MissionTimelineProps {
  mission: NexusMission | null;
  state?: PatternState;
  title?: string;
}

/**
 * Mission timeline — ordered steps with server state vocab and honest
 * durations. A step without both timestamps shows no time — never a guess.
 */
export function MissionTimeline({ mission, state = 'ready', title = 'Ход миссии' }: MissionTimelineProps) {
  const freshness: DataFreshness | undefined = mission?.freshness;
  return (
    <section
      className={styles.root}
      data-state={state}
      data-freshness={freshness}
      data-testid="mission-timeline"
      aria-label={title}
    >
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Загрузка шагов…</p>}
      {state === 'error' && <p className={styles.muted}>Шаги недоступны.</p>}
      {state === 'empty' && <p className={styles.muted}>Шагов нет.</p>}
      {(state === 'ready' || state === 'stale') && mission && (
        <ol className={styles.timeline}>
          {mission.steps.map((s) => {
            const dur = stepDurationSec(s);
            return (
              <li key={s.id} className={styles.step} data-step-state={s.state}>
                <StatusBadge status={missionStepBadge(s.state)} label={MISSION_STEP_LABELS[s.state].toUpperCase()} />
                <span className={styles.rowMain}>
                  <span className={styles.rowName}>{s.label}</span>
                  <span
                    className={styles.rowSub}
                    title={`${s.agentId ?? '—'}${dur != null ? ` · ${fmtDurationSec(dur)}` : ''}`}
                  >
                    {s.agentId ?? '—'}{dur != null ? ` · ${fmtDurationSec(dur)}` : ''}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
