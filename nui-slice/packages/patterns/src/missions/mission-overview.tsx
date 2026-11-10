import type { DataFreshness } from '@nexus/ui';
import { StatusBadge } from '@nexus/ui';
import type { NexusMission } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import { MISSION_STATE_LABELS, missionStateBadge } from './mission-map';
import styles from './missions.module.css';

export interface MissionOverviewProps {
  mission: NexusMission | null;
  state?: PatternState;
  title?: string;
}

/**
 * Mission overview — header card: id, state (server vocab), agents involved.
 * `agentId` values render verbatim — runtime identity, never persona.
 */
export function MissionOverview({ mission, state = 'ready', title = 'Миссия' }: MissionOverviewProps) {
  const freshness: DataFreshness | undefined = mission?.freshness;
  return (
    <section
      className={styles.root}
      data-state={state}
      data-freshness={freshness}
      data-testid="mission-overview"
      aria-label={title}
    >
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Загрузка миссии…</p>}
      {state === 'error' && <p className={styles.muted}>Миссия недоступна.</p>}
      {state === 'empty' && <p className={styles.muted}>Нет активной миссии.</p>}
      {(state === 'ready' || state === 'stale') && mission && (
        <>
          <div className={styles.head}>
            <span className={styles.missionTitle}>{mission.title}</span>
            <StatusBadge
              status={missionStateBadge(mission.state)}
              label={MISSION_STATE_LABELS[mission.state].toUpperCase()}
            />
          </div>
          <dl className={styles.facts}>
            <dt>ID</dt>
            <dd>{mission.id}</dd>
            <dt>Агенты</dt>
            <dd>
              <span className={styles.capabilities}>
                {mission.agents.map((a) => (
                  <span key={a} className={styles.cap}>{a}</span>
                ))}
              </span>
            </dd>
          </dl>
        </>
      )}
    </section>
  );
}
