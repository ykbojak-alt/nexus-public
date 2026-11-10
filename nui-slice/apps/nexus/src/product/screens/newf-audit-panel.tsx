'use client';

/**
 * W15: Audit-viewer — панель /audit ленты.
 * Фильтры: action (кнопки), decision/outcome-бейдж + verify-бейдж (outcome ok).
 * Честная недоступность: 404/офлайн → пустой список + подпись.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { type AuditEntry, type AuditResult, type AuditVerifyResult, type NewfBridge } from './newf-live';
import { useVirtualList } from './newf-virtual';
import styles from './newf-agents-panel.module.css';

export interface AuditPanelProps {
  bridge: NewfBridge;
  limit?: number;
}

const ACTION_ACCENT: Record<string, string> = {
  allow: 'var(--nx-done)',
  deny: 'var(--nx-blocked)',
  vote: 'var(--nx-warn)',
  error: 'var(--nx-blocked)',
};

/** W54: нормализация decision-значения к enum бэкенда (allow/deny/vote). */
export function decisionTone(decision?: string): string {
  const d = decision ?? 'unknown';
  if (d === 'allow' || d === 'deny' || d === 'vote' || d === 'error') return d;
  if (d === 'allowed') return 'allow';
  if (d === 'denied') return 'deny';
  return 'unknown';
}

function fmtTime(ts?: number): string {
  if (ts === undefined || !Number.isFinite(ts)) return '--:--:--';
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function AuditPanel({ bridge, limit = 50 }: AuditPanelProps) {
  const [data, setData] = useState<AuditResult>({ entries: [], total: 0 });
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // W54: реальная проверка цепи /audit/verify.
  const [verify, setVerify] = useState<AuditVerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!bridge.audit) { setError('audit: capability отсутствует'); return; }
    try {
      const res = await bridge.audit({ action: action ?? undefined, limit });
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'audit unavailable');
      // W54: не подменяем «записей нет» при сбое — сохраняем старые данные,
      // но показываем offline-плашку.
      setData((prev) => prev);
    }
  }, [bridge, action, limit]);

  useEffect(() => { void load(); }, [load]);

  const runVerify = useCallback(async () => {
    if (!bridge.auditVerify) { setVerifyError('auditVerify: capability отсутствует'); return; }
    setVerifyError(null);
    try {
      const res = await bridge.auditVerify();
      setVerify(res);
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : 'verify unavailable');
    }
  }, [bridge]);

  // W26: виртуализация ленты (28px/строка).
  const virtual = useVirtualList<AuditEntry, HTMLUListElement>(data.entries, 28);

  const actions = useMemo(() => Array.from(new Set(data.entries.map((e) => e.action).filter(Boolean))) as string[], [data.entries]);
  const decisionCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data.entries) {
      const d = e.decision ?? e.outcome ?? 'unknown';
      m.set(d, (m.get(d) ?? 0) + 1);
    }
    return m;
  }, [data.entries]);

  return (
    <section className={styles.group} role="region" aria-label="Audit" data-testid="audit-panel">
      <h3 className={styles.groupTitle}>
        AUDIT <span className={styles.groupCount}>{data.total}</span>
        <button
          type="button"
          className={`${styles.filterChip} ${verify?.ok === true ? styles.filterActive : ''}`}
          data-testid="audit-verify"
          onClick={() => void runVerify()}
          title="Проверить цепь (/audit/verify)"
        >
          {verify === null ? 'verify' : verify.ok ? '✓ verified' : '✗ broken'}
        </button>
      </h3>
      {error && <p className={styles.offline} role="alert" data-testid="audit-offline">{error}</p>}
      {verifyError && <p className={styles.offline} role="alert">{verifyError}</p>}
      {verify && !verify.ok && verify.detail && (
        <p className={styles.offline} role="alert" data-testid="audit-verify-detail">chain: {verify.detail}</p>
      )}
      {actions.length > 0 && (
        <div className={styles.filterRow} role="group" aria-label="Action filter">
          <button type="button" className={action === null ? styles.filterActive : styles.filterChip} onClick={() => setAction(null)}>all</button>
          {actions.map((a) => (
            <button key={a} type="button" className={action === a ? styles.filterActive : styles.filterChip} onClick={() => setAction(action === a ? null : a)}>{a}</button>
          ))}
        </div>
      )}
      <ul className={styles.list} ref={virtual.containerRef} data-testid="audit-list">
        <li style={{ height: virtual.totalHeight, position: 'relative' }} aria-hidden="true" />
        {virtual.visible.map((e) => {
          const idx = e.seq ?? data.entries.indexOf(e);
          const d = decisionTone(e.decision ?? e.outcome);
          return (
            <li key={idx} className={styles.badge} data-testid={`audit-row-${idx}`} style={{ position: 'absolute', top: virtual.start * 28, width: '100%' }}>
              <span className={styles.badgeTime}>{fmtTime(e.ts)}</span>
              <span className={styles.badgeMain}>
                <span className={styles.badgeName}>
                  <span style={{ color: ACTION_ACCENT[d] ?? 'var(--nx-muted)' }}>{d}</span>
                  {' · '}{e.action ?? '—'}
                  {e.subject ? ` · ${e.subject}` : ''}
                  {e.term ? ` · ${e.term}` : ''}
                </span>
                {e.detail && (
                  <span className={styles.badgeMeta} title={e.detail}>{e.detail}</span>
                )}
              </span>
            </li>
          );
        })}
        {data.entries.length === 0 && !error && <li className={styles.empty}>audit: записей нет</li>}
      </ul>
    </section>
  );
}
