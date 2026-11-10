'use client';

/**
 * W37: Alert-rules панель — компактный список правил алертов.
 *
 * Поллинг GET /api/core/alert-rules + GET /api/core/alerts (по умолчанию
 * каждые 2с). На правило: enabled-чип, condition (pattern), action,
 * источник (file/runtime), счётчик сработавших (по rule_idx из history,
 * честно: история ограничена) и toggle-кнопка (POST …/{idx}/toggle).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlertHistoryEntry, AlertRuleEntry, NewfBridge } from './newf-live';
import styles from './newf-agents-panel.module.css';

export const ALERT_POLL_MS = 2000;

export interface AlertRulesPanelProps {
  bridge: NewfBridge;
  pollMs?: number;
}

type LoadState = 'loading' | 'ok' | 'offline';

/** Число срабатываний правила по истории (rule_idx). */
export function countFirings(history: AlertHistoryEntry[], idx: number): number {
  return history.filter((h) => h.ruleIdx === idx).length;
}

export function AlertRulesPanel({ bridge, pollMs = ALERT_POLL_MS }: AlertRulesPanelProps) {
  const [rules, setRules] = useState<AlertRuleEntry[]>([]);
  const [history, setHistory] = useState<AlertHistoryEntry[]>([]);
  const [load, setLoad] = useState<LoadState>('loading');
  const [toggleError, setToggleError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => { cancelled.current = true; };
  }, []);

  const refresh = useCallback(async () => {
    if (!bridge.alertRules) { setLoad('offline'); return; }
    try {
      const [r, h] = await Promise.all([
        bridge.alertRules(),
        bridge.alerts ? bridge.alerts({ limit: 200 }) : Promise.resolve({ alerts: [], count: 0, rules_loaded: 0 }),
      ]);
      if (cancelled.current) return;
      setRules(r.rules);
      setHistory(h.alerts);
      setLoad('ok');
    } catch {
      if (!cancelled.current) setLoad('offline');
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  if (!bridge.alertRules) {
    return (
      <section className={styles.group} role="region" aria-label="Alert rules" data-testid="alert-rules-panel">
        <h3 className={styles.groupTitle}>ALERT RULES</h3>
        <p className={styles.empty}>alertRules отсутствует</p>
      </section>
    );
  }

  const toggle = (rule: AlertRuleEntry) => {
    setToggleError(null);
    void bridge.alertToggle?.(rule.idx, rule.disabled)
      .then((res) => {
        setRules((prev) => prev.map((x) => x.idx === res.idx ? { ...x, disabled: res.disabled } : x));
      })
      .catch((e: unknown) => setToggleError(e instanceof Error ? e.message : 'toggle failed'));
  };

  return (
    <section className={styles.group} role="region" aria-label="Alert rules" data-testid="alert-rules-panel">
      <h3 className={styles.groupTitle}>
        ALERT RULES
        <span className={styles.groupCount} data-testid="alert-rules-count">{rules.length}</span>
        <span className={`${styles.conn} ${load === 'ok' ? styles.connOk : load === 'offline' ? styles.connBad : styles.connDim}`} role="status">
          {load === 'ok' ? 'live' : load === 'offline' ? 'offline' : 'loading…'}
        </span>
      </h3>
      {load === 'offline' ? (
        <p className={styles.offline} role="alert">alert rules unavailable</p>
      ) : null}
      {toggleError && <p className={styles.offline} role="alert" data-testid="alert-toggle-error">{toggleError}</p>}
      {rules.length === 0 ? (
        <p className={styles.empty}>no rules</p>
      ) : (
        <ul className={styles.list}>
          {rules.map((r) => {
            const firings = countFirings(history, r.idx);
            return (
              <li key={r.idx} className={styles.badge} data-testid={`alert-rule-${r.idx}`} data-disabled={r.disabled ? 'true' : undefined}>
                <span className={`${styles.alertChip} ${r.disabled ? styles.alertOff : styles.alertOn}`} data-testid={`alert-enabled-${r.idx}`}>
                  {r.disabled ? 'off' : 'on'}
                </span>
                <span className={styles.badgeMain}>
                  <span className={styles.badgeName} data-testid={`alert-pattern-${r.idx}`}>
                    {r.pattern || '—'}
                  </span>
                  <span className={styles.badgeMeta}>
                    {r.action} · {r.runtime ? 'runtime' : 'file'} · {firings} сработало
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.filterChip}
                  data-testid={`alert-toggle-${r.idx}`}
                  aria-pressed={!r.disabled}
                  title={r.disabled ? 'Включить правило' : 'Выключить правило'}
                  onClick={() => toggle(r)}
                >
                  {r.disabled ? 'enable' : 'disable'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default AlertRulesPanel;
