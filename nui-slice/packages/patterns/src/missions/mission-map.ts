import type { NexusStatus } from '@nexus/ui';
import type { NexusMission, NexusMissionStep } from '@nexus/mock-data';

/** Mission state → StatusBadge vocab. Server/product truth only. */
export function missionStateBadge(state: NexusMission['state']): NexusStatus {
  switch (state) {
    case 'queued': return 'waiting';
    case 'active': return 'executing';
    case 'done': return 'complete';
    case 'failed': return 'error';
    case 'cancelled': return 'paused';
  }
}

export function missionStepBadge(state: NexusMissionStep['state']): NexusStatus {
  switch (state) {
    case 'pending': return 'waiting';
    case 'active': return 'executing';
    case 'done': return 'complete';
    case 'failed': return 'error';
    case 'skipped': return 'paused';
  }
}

export const MISSION_STATE_LABELS: Record<NexusMission['state'], string> = {
  queued: 'в очереди',
  active: 'идёт',
  done: 'завершена',
  failed: 'упала',
  cancelled: 'отменена',
};

export const MISSION_STEP_LABELS: Record<NexusMissionStep['state'], string> = {
  pending: 'в очереди',
  active: 'идёт',
  done: 'готово',
  failed: 'упал',
  skipped: 'пропущен',
};

export const OUTPUT_KIND_LABELS: Record<NexusMission['outputs'][number]['kind'], string> = {
  answer: 'ответ',
  artifact: 'артефакт',
  report: 'отчёт',
};

/**
 * Step duration in whole seconds — only when both timestamps exist.
 * Returns null otherwise; callers must render nothing, not a guess.
 */
export function stepDurationSec(step: NexusMissionStep): number | null {
  if (step.startedAt == null || step.endedAt == null) return null;
  return Math.max(0, step.endedAt - step.startedAt);
}

export function fmtDurationSec(sec: number): string {
  if (sec < 60) return `${sec} с`;
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
}
