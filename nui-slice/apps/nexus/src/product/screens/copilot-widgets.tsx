'use client';

/**
 * Волна XI W3 — компоненты Copilot-механик по спеке `docs/product/
 * copilot-patterns-spec.md` (W2) и контрактам W1 (`contracts/copilot.ts`,
 * `contracts/bus.ts`). Только наблюдаемые данные: статусы — через
 * StatusBadge/state.* (закрытый словарь), подписи — по таблице спеки,
 * пустые/недоступные состояния честные.
 */
import { useCallback, type KeyboardEvent, type ReactNode } from 'react';
import { StatusBadge, type NexusStatus } from '@nexus/ui';
import type { AgentHandoff, ComposerMode } from '@nexus/mock-data';
import type { BusDelegation, BusSession, BusSessionStatus, DelegationState } from '../../integrations/ai2/contracts/bus';
import styles from './copilot-widgets.module.css';

/* ModeSwitch — сегментированный контрол композитора (спека: подписи
 * «Агент»/«Спросить»/«План», radiogroup + стрелочная навигация). */

const MODE_ORDER: readonly ComposerMode[] = ['agent', 'ask', 'plan'];
const MODE_LABELS: Record<ComposerMode, string> = {
  agent: 'Агент',
  ask: 'Спросить',
  plan: 'План',
};

export interface ModeSwitchProps {
  value: ComposerMode;
  onChange: (mode: ComposerMode) => void;
  disabled?: boolean;
}

export function ModeSwitch({ value, onChange, disabled = false }: ModeSwitchProps) {
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const idx = MODE_ORDER.indexOf(value);
      const next = MODE_ORDER[(idx + (e.key === 'ArrowRight' ? 1 : MODE_ORDER.length - 1)) % MODE_ORDER.length];
      onChange(next);
    },
    [value, onChange],
  );
  return (
    <div
      className={styles.modeSwitch}
      role="radiogroup"
      aria-label="Режим композитора"
      onKeyDown={onKeyDown}
      data-testid="mode-switch"
    >
      {MODE_ORDER.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          disabled={disabled}
          className={styles.modeSeg}
          data-active={value === m || undefined}
          data-mode={m}
          onClick={() => onChange(m)}
        >
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

/* SessionList — сессии окон шины (спека: имя окна, kind mono-метка,
 * статус-точка по таблице, lastActivityAt «… назад»). */

const SESSION_VIEW: Record<BusSessionStatus, { status: NexusStatus; label: string }> = {
  idle: { status: 'online', label: 'Свободна' },
  busy: { status: 'executing', label: 'Занята' },
  locked: { status: 'paused', label: 'Занята другим' },
  unknown: { status: 'offline', label: 'Нет данных' },
};

const KIND_LABELS: Record<string, string> = {
  desktop: 'desktop',
  tui: 'tui',
  cloud: 'cloud',
};

/** epoch s → «N мин назад»; null → «—» (нет сигнала живости, не выдумываем). */
function agoLabel(ts: number | null): string {
  if (ts == null || !Number.isFinite(ts)) return '—';
  const sec = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (sec < 60) return 'только что';
  if (sec < 3600) return `${Math.floor(sec / 60)} мин назад`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ч назад`;
  return `${Math.floor(sec / 86400)} д назад`;
}

export interface SessionListProps {
  sessions: BusSession[];
  /** Кнопка «Отправить окну» на строке — только когда seam делегации есть. */
  onSend?: (session: BusSession) => void;
  /** Состояния делегаций по окну — чип рядом с кнопкой отправки. */
  delegations?: Readonly<Record<string, BusDelegation>>;
  onRetryDelegation?: (delegation: BusDelegation) => void;
  sendDisabled?: boolean;
}

export function SessionList({ sessions, onSend, delegations, onRetryDelegation, sendDisabled }: SessionListProps) {
  if (sessions.length === 0) {
    return <p className={styles.empty} data-testid="session-list" data-state="empty">Нет данных о сессиях.</p>;
  }
  return (
    <ul className={styles.sessionList} role="list" data-testid="session-list" data-state="ready">
      {sessions.map((s) => {
        const view = SESSION_VIEW[s.status] ?? SESSION_VIEW.unknown;
        const delegation = delegations?.[s.window];
        const cantSend = s.status === 'locked';
        return (
          <li key={s.id} className={styles.sessionRow} data-status={s.status}>
            <span className={styles.sessionMain}>
              <span className={styles.sessionName}>{s.window} · {s.title}</span>
              <span className={styles.sessionMeta}>
                <span className={styles.sessionKind}>{KIND_LABELS[s.kind] ?? '—'}</span>
                <span title={s.lastActivityAt != null ? new Date(s.lastActivityAt * 1000).toLocaleString() : 'меток активности нет'}>
                  {agoLabel(s.lastActivityAt)}
                </span>
              </span>
            </span>
            <StatusBadge status={view.status} label={view.label} />
            {onSend != null && (
              <span className={styles.sessionActions}>
                <button
                  type="button"
                  className={styles.sendBtn}
                  disabled={sendDisabled || cantSend}
                  aria-disabled={cantSend || undefined}
                  title={cantSend ? 'Окно занято — ответит session_locked' : `Отправить задачу окну ${s.window}`}
                  onClick={() => onSend(s)}
                >
                  Отправить окну
                </button>
                {delegation != null && (
                  <DelegationChip delegation={delegation} onRetry={onRetryDelegation} />
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* DelegationChip — пилюля состояния отправки (спека: точка state.* +
 * подпись; locked — paused-полоса, не красная рамка; failed → «Повторить»). */

const DELEGATION_VIEW: Record<DelegationState, { status: NexusStatus; label: string }> = {
  queued: { status: 'waiting', label: 'В очереди' },
  sent: { status: 'syncing', label: 'Отправлено' },
  answered: { status: 'complete', label: 'Ответ получен' },
  locked: { status: 'paused', label: 'Окно занято' },
  failed: { status: 'error', label: 'Не доставлено' },
};

export interface DelegationChipProps {
  delegation: BusDelegation;
  onRetry?: (delegation: BusDelegation) => void;
}

export function DelegationChip({ delegation, onRetry }: DelegationChipProps) {
  const view = DELEGATION_VIEW[delegation.state] ?? DELEGATION_VIEW.failed;
  return (
    <span className={styles.delegChip} data-state={delegation.state} data-testid="delegation-chip"
      title={delegation.error ?? delegation.taskPath}>
      <StatusBadge status={view.status} label={view.label} />
      {delegation.state === 'failed' && onRetry != null && (
        <button type="button" className={styles.chipRetry} onClick={() => onRetry(delegation)}>
          Повторить
        </button>
      )}
    </span>
  );
}

/* HandoffBar — кнопки продолжения под ответом агента (спека: ghost-кнопки,
 * отсутствие handoffs — не состояние, бар не рендерится). */

export interface HandoffBarProps {
  handoffs: AgentHandoff[] | undefined;
  onPick: (handoff: AgentHandoff) => void;
  busy?: boolean;
}

export function HandoffBar({ handoffs, onPick, busy = false }: HandoffBarProps): ReactNode {
  if (handoffs == null || handoffs.length === 0) return null;
  return (
    <div className={styles.handoffBar} role="group" aria-label="Действия по ответу" data-testid="handoff-bar">
      {handoffs.map((h, i) => (
        <button
          key={`${h.agent}-${i}`}
          type="button"
          className={styles.handoffBtn}
          disabled={busy}
          title={h.send ? `Отправить агенту ${h.agent}: ${h.prompt}` : `Вставить в композитор: ${h.prompt}`}
          onClick={() => onPick(h)}
        >
          {h.label}
        </button>
      ))}
    </div>
  );
}
