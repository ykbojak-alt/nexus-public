'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, GlassPanel, StatusBadge, type NexusStatus } from '@nexus/ui';
import type { SdkConfirmDecision, SdkConfirmResult } from '../../integrations/ai2/contracts/sdk';
import type { ToolConfirmationView } from './runtime-ops';
import { runWhileDocumentVisible } from '../visible-interval';
import styles from './screens.module.css';

/**
 * XIV W3 — карточка подтверждения инструмента SDK-канала
 * (sdk-confirm-contract.md draft 0.2) в ленте прогона.
 *
 * Честность:
 *  - решение уходит только через seam (POST …/confirmations/{callId});
 *    нет seam'а — карточка read-only, «ответ не объявлен на хосте»;
 *  - POST упал/хост молчит — «хост не ответил» + verbatim-ошибка,
 *    карточка остаётся открытой, повтор возможен;
 *  - defer → ответ хоста {resolved:false,state:'deferred'} — карточка
 *    помечается «отложено», позднее allow/deny тем же POST;
 *  - таймаут: обратный отсчёт от requestedAt + 300 с — документированный
 *    умолчательный AI2_SDK_CONFIRM_TIMEOUT_S (на проводе значения нет —
 *    см. отчёт). По нулю карточка НЕ объявляет deny сама: «время вышло —
 *    ждём автоотказ хоста», финал приходит событием tool_confirmation_resolved.
 *  - вход вызова маскирован maskSecrets уже в toolConfirmationOf.
 */

/** Документированный умолчательный таймаут хоста (AI2_SDK_CONFIRM_TIMEOUT_S). */
export const SDK_CONFIRM_TIMEOUT_S = 300;

const STATE_META: Record<string, { status: NexusStatus; label: string }> = {
  awaiting: { status: 'waiting', label: 'Ждёт решения' },
  deferred: { status: 'syncing', label: 'Отложено' },
};

function fmtCountdown(secLeft: number): string {
  const m = Math.floor(secLeft / 60);
  const s = secLeft % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface ToolConfirmCardProps {
  conf: ToolConfirmationView;
  /** Финал из трейса (tool_confirmation_resolved) — источник правды. */
  resolved?: { decision: 'approved' | 'denied'; message: string | null } | null;
  /** POST решения; undefined — seam отсутствует → read-only. */
  onDecide?: (decision: SdkConfirmDecision, reason?: string) => Promise<SdkConfirmResult>;
  /** Вложенный вызов (parentCallId) — отступ по глубине среди карточек ленты. */
  depth?: number;
}

export function ToolConfirmCard({ conf, resolved, onDecide, depth = 0 }: ToolConfirmCardProps) {
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState<SdkConfirmDecision | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const focusWasInside = rootRef.current?.contains(document.activeElement) ?? false;

  const open = resolved == null;
  const meta = STATE_META[conf.state] ?? { status: 'waiting' as NexusStatus, label: conf.state };

  // Тик раз в секунду, только пока карточка открыта и есть от чего считать.
  const deadline = conf.requestedAt != null ? (conf.requestedAt + SDK_CONFIRM_TIMEOUT_S) * 1000 : null;
  useEffect(() => {
    if (!open || deadline == null) return;
    return runWhileDocumentVisible(() => setNow(Date.now()), 1000);
  }, [open, deadline]);

  useEffect(() => {
    if (!open && focusWasInside) statusRef.current?.focus();
  }, [open, focusWasInside]);

  const decide = async (decision: SdkConfirmDecision) => {
    if (onDecide == null || sending != null) return;
    setSending(decision);
    setSendError(null);
    try {
      await onDecide(decision, reason.trim() === '' ? undefined : reason.trim());
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Хост не ответил.');
    } finally {
      setSending(null);
    }
  };

  const title = conf.title ?? conf.displayName ?? 'Запрос подтверждения инструмента';
  const secLeft = deadline != null ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  const timedOut = secLeft === 0;

  return (
    <div
      ref={rootRef}
      className={styles.confirmCard}
      data-testid="tool-confirmation"
      data-state={!open ? 'resolved' : onDecide == null ? 'unavailable' : 'open'}
      data-conf-state={conf.state}
      role={open ? 'alert' : 'status'}
      style={depth > 0 ? { marginLeft: `calc(var(--nexus-space-4, 16px) * ${Math.min(depth, 3)})` } : undefined}
    >
      <GlassPanel className={styles.confirmCardInner}>
        <div className={styles.confirmHead}>
          <span className={styles.confirmTool}>{conf.tool}</span>
          <span className={styles.confirmTitle}>{title}</span>
          {open
            ? <StatusBadge status={meta.status} label={meta.label} />
            : (
              <span ref={statusRef} tabIndex={-1}>
                <StatusBadge
                  status={resolved!.decision === 'approved' ? 'complete' : 'error'}
                  label={resolved!.decision === 'approved' ? 'Разрешено' : 'Отклонено'}
                />
              </span>
            )}
        </div>
        {conf.parentCallId != null && (
          <p className={styles.confirmMeta}>↳ вложенный вызов · родитель: {conf.parentCallId}</p>
        )}
        {conf.agentId != null && <p className={styles.confirmMeta}>субагент: {conf.agentId}</p>}
        {conf.description != null && <p className={styles.confirmText}>{conf.description}</p>}
        {conf.decisionReason != null && <p className={styles.confirmMeta}>правило: {conf.decisionReason}</p>}
        {conf.input !== '' && <pre className={styles.confirmInput} data-testid="confirm-input">{conf.input}</pre>}

        {open && (
          <>
            <p className={styles.confirmMeta} data-testid="confirm-timer">
              {deadline == null
                ? 'таймаут карточки не известен (requestedAt не пришёл)'
                : timedOut
                  ? 'время решения вышло — ждём автоотказ хоста'
                  : `автоотказ через ${fmtCountdown(secLeft!)} · таймаут хоста 300 с`}
            </p>
            {onDecide == null ? (
              <p className={styles.confirmMeta}>
                ожидает решения — ответ на хосте не объявлен; карточка только для чтения.
              </p>
            ) : (
              <>
                <label className={styles.visuallyHidden} htmlFor={`conf-reason-${conf.callId}`}>
                  Причина для агента (необязательно)
                </label>
                <input
                  id={`conf-reason-${conf.callId}`}
                  className={styles.confirmReason}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Причина для агента (необязательно)…"
                  disabled={sending != null}
                />
                <div className={styles.confirmActions}>
                  <Button variant="primary" size="sm" disabled={sending != null}
                    onClick={() => void decide('allow')}>
                    {sending === 'allow' ? 'Отправляю…' : 'Разрешить'}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={sending != null}
                    onClick={() => void decide('deny')}>
                    {sending === 'deny' ? 'Отправляю…' : 'Отклонить'}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={sending != null || conf.state === 'deferred'}
                    onClick={() => void decide('defer')}>
                    {sending === 'defer' ? 'Отправляю…' : 'Отложить'}
                  </Button>
                </div>
                {sendError != null && (
                  <p className={styles.error} role="alert" data-testid="confirm-error">
                    Хост не ответил: {sendError}
                  </p>
                )}
              </>
            )}
          </>
        )}
        {!open && resolved!.message != null && (
          <p className={styles.confirmMeta}>комментарий: {resolved!.message}</p>
        )}
      </GlassPanel>
    </div>
  );
}
