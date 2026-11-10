'use client';

import type { CSSProperties } from 'react';
import { compactionMotion } from '@nexus/motion';
import styles from './context-usage-indicator.module.css';

export type ContextUsageUnit = 'messages' | 'tokens';

export interface ContextUsageIndicatorProps {
  /** Measured fill in `unit` — host-reported tokens when the session
   *  reports them, otherwise the observed message count. Null means the
   *  quantity is not measurable and the indicator must stay unavailable. */
  used: number | null;
  /** Real threshold in the same unit — from the host compaction
   *  config/status for tokens, or the local keep-tail for messages.
   *  Null means the host did not declare a limit: no fill is drawn. */
  total: number | null;
  unit?: ContextUsageUnit;
  /** Host `usage_method` verbatim — surfaced in the title so the estimate
   *  provenance stays visible. */
  usageMethod?: string;
  /** True only while a real host compaction request is in flight. */
  compacting?: boolean;
}

export type ContextUsageState = 'normal' | 'near' | 'compacting' | 'unavailable';

/** 'near' starts at 75% of the compaction threshold — enough room to react
 *  before auto-compaction actually triggers at 100%. */
export const CONTEXT_USAGE_NEAR_RATIO = 0.75;

export function contextUsageState(
  used: number | null,
  total: number | null,
  compacting = false,
): ContextUsageState {
  if (compacting) return 'compacting';
  if (
    used == null
    || !Number.isFinite(used)
    || total == null
    || !Number.isFinite(total)
    || total <= 0
  ) return 'unavailable';
  return used / total >= CONTEXT_USAGE_NEAR_RATIO ? 'near' : 'normal';
}

const UNIT_LABELS: Record<ContextUsageUnit, string> = {
  messages: 'сообщений',
  tokens: 'токенов',
};

/** Индикатор заполнения контекста до порога компактизации. Предпочитает
 *  реальные токены хоста (compaction-status/config); без них — фактическое
 *  число сообщений ленты относительно локального keep-tail, с честной
 *  подписью единицы. Без измеренной величины или объявленного порога —
 *  честный unavailable, никогда не 0%. */
export function ContextUsageIndicator({
  used,
  total,
  unit = 'messages',
  usageMethod,
  compacting = false,
}: ContextUsageIndicatorProps) {
  const state = contextUsageState(used, total, compacting);
  const measured = used == null || !Number.isFinite(used)
    ? null
    : Math.max(0, Math.floor(used));
  const frac = measured == null || total == null || !Number.isFinite(total) || total <= 0
    ? null
    : Math.min(1, measured / total);
  const pct = frac == null ? null : Math.round(frac * 100);
  const tone = state === 'near' ? 'warn' : state === 'compacting' ? 'busy' : undefined;
  const pulse = compactionMotion('contextPulse');
  const pulseStyle = {
    '--compaction-pulse-duration': `${pulse.durationMs}ms`,
    '--compaction-pulse-easing': pulse.easing,
  } as CSSProperties;
  const unitLabel = UNIT_LABELS[unit];

  const label = state === 'compacting'
    ? 'Сжимаю историю…'
    : state === 'near'
      ? `Контекст близок к порогу · ${measured} из ${total} ${unitLabel}`
      : measured != null
        ? `Контекст диалога · ${measured}${total != null ? ` из ${total}` : ''} ${unitLabel}`
        : 'Контекст диалога недоступен';

  return (
    <div
      className={styles.root}
      data-state={state}
      data-testid="context-usage-indicator"
      style={pulseStyle}
      title={usageMethod != null ? `Метод оценки хоста: ${usageMethod}` : undefined}
    >
      <div className={styles.labelRow}>
        <span className={styles.label}>{label}</span>
        {pct != null && <span className={styles.percent}>{pct}%</span>}
      </div>
      {frac == null ? (
        <p className={styles.unavailableReason}>
          {measured != null
            ? 'Порог компактизации не объявлен хостом — заполнение не рассчитывается.'
            : 'Нет измеренного объёма контекста — заполнение не рассчитывается.'}
        </p>
      ) : (
        <div
          className={styles.track}
          role="meter"
          aria-label="Заполнение до порога компактизации"
          aria-valuemin={0}
          aria-valuemax={total ?? undefined}
          aria-valuenow={measured == null || total == null ? undefined : Math.min(measured, total)}
          aria-valuetext={`${measured} из ${total} ${unitLabel}`}
        >
          <div className={styles.fill} data-tone={tone} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
