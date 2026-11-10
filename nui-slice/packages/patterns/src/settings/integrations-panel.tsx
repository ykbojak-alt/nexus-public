import { useState } from 'react';
import { StatusBadge } from '@nexus/ui';
import type { WebhookDelivery, WebhookRow } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import styles from './settings.module.css';

/**
 * Server-validated event vocabulary (W1 live evidence 2026-10-19):
 * anything outside this list is a 422 — never invent event names.
 */
const WEBHOOK_EVENTS = ['run.completed', 'run.failed', 'run.cancelled', 'run.timeout', 'budget.exceeded'] as const;

export interface IntegrationsPanelProps {
  webhooks: WebhookRow[];
  deliveries: WebhookDelivery[];
  state?: PatternState;
  /** webhookIds with an in-flight write — rendered pending, NOT saved. */
  pending?: ReadonlySet<string>;
  errors?: Readonly<Record<string, string>>;
  /** Toggle request — the screen owns optimistic update + rollback. */
  onToggle?: (webhookId: string, active: boolean) => void;
  /**
   * POST /v1/webhooks — callback; screen owns the write. Rejects surface as
   * field-level errors and the form keeps its input (SC-SET-3).
   */
  onCreate?: (input: { url: string; events: string[] }) => Promise<void>;
  /** Field-level create errors (e.g. adapter 4xx) keyed by field. */
  createErrors?: Readonly<Record<string, string>>;
  creating?: boolean;
  /** Secret from the latest create — shown once, then cleared by the screen. */
  createdSecret?: { webhookId: string; secret: string } | null;
  /** DELETE /v1/webhooks/{id} — callback, screen owns confirm + write. */
  onDelete?: (webhookId: string) => void;
  title?: string;
}

const DELIVERY_STATUS: Record<WebhookDelivery['status'], 'waiting' | 'complete' | 'error'> = {
  pending: 'waiting',
  delivered: 'complete',
  failed: 'error',
};
const DELIVERY_LABELS: Record<WebhookDelivery['status'], string> = {
  pending: 'в очереди',
  delivered: 'доставлен',
  failed: 'упал',
};

/**
 * Integrations panel — webhook registry (toggle = write) plus recent
 * deliveries. Failed deliveries show `lastError` verbatim — a webhook that
 * keeps failing stays visibly failed.
 */
export function IntegrationsPanel({
  webhooks, deliveries, state = 'ready', pending, errors, onToggle,
  onCreate, createErrors, creating = false, createdSecret, onDelete,
  title = 'Интеграции',
}: IntegrationsPanelProps) {
  const [url, setUrl] = useState('');
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [localError, setLocalError] = useState<string | null>(null);

  const canCreate = url.trim().length > 0 && checked.size > 0 && !creating;

  function toggleEvent(name: string) {
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || !onCreate) return;
    setLocalError(null);
    try {
      const parsed = new URL(url.trim());
      // SSRF policy (W1 live evidence): server accepts https only.
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        setLocalError('URL должен быть https:// и не содержать учётных данных.');
        return;
      }
    } catch {
      setLocalError('URL должен быть https:// и не содержать учётных данных.');
      return;
    }
    try {
      await onCreate({ url: url.trim(), events: [...checked] });
      setUrl('');
      setChecked(new Set());
    } catch {
      // adapter rejected — keep inputs, show the field error (SC-SET-3)
      setLocalError('Создание отклонено — исправьте поле и повторите.');
    }
  }

  return (
    <section className={styles.root} data-state={state} data-testid="integrations-panel" aria-label={title}>
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Загрузка вебхуков…</p>}
      {state === 'error' && <p className={styles.muted}>Вебхуки недоступны.</p>}
      {state === 'empty' && <p className={styles.muted}>Вебхуков нет.</p>}
      {(state === 'ready' || state === 'stale') && (
        <>
          {createdSecret && (
            <p className={styles.secret} data-testid="webhook-secret" role="status">
              Вебхук «{createdSecret.webhookId}» создан — секрет показан один раз: <code>{createdSecret.secret}</code>
            </p>
          )}
          <ul className={styles.list}>
            {webhooks.map((w) => {
              const busy = pending?.has(w.webhookId) === true;
              const err = errors?.[w.webhookId];
              return (
                <li key={w.webhookId} className={styles.toolRow} data-busy={busy || undefined}>
                  <span className={styles.rowMain}>
                    <span className={styles.rowName}>{w.webhookId}</span>
                    <span className={styles.rowSub}>{w.url} · {w.events.join(', ')}</span>
                    {err && <span className={styles.error} role="alert">{err}</span>}
                  </span>
                  <StatusBadge
                    status={busy ? 'syncing' : w.active ? 'active' : 'paused'}
                    label={busy ? '…' : w.active ? 'ON' : 'OFF'}
                  />
                  <button
                    type="button"
                    className={styles.toggle}
                    disabled={busy || !onToggle}
                    onClick={() => onToggle?.(w.webhookId, !w.active)}
                    aria-label={`${w.active ? 'Отключить' : 'Включить'} ${w.webhookId}`}
                  >
                    {w.active ? 'Отключить' : 'Включить'}
                  </button>
                  {onDelete && (
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={busy}
                      onClick={() => onDelete(w.webhookId)}
                      aria-label={`Удалить ${w.webhookId}`}
                    >
                      Удалить
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {deliveries.length > 0 && (
            <>
              <h4 className={styles.sectionLabel}>Последние доставки</h4>
              <ul className={styles.list}>
                {deliveries.map((d) => (
                  <li key={d.deliveryId} className={styles.deliveryRow}>
                    <StatusBadge status={DELIVERY_STATUS[d.status]} label={DELIVERY_LABELS[d.status].toUpperCase()} />
                    <span className={styles.rowSub}>
                      {d.event} · попыток {d.attempts}
                      {d.lastCode != null ? ` · HTTP ${d.lastCode}` : ''}
                      {d.lastError ? ` · ${d.lastError}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {onCreate && state !== 'loading' && state !== 'error' && (
        <form className={styles.createForm} onSubmit={(e) => void submitCreate(e)}>
          <input
            className={styles.input}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/hook"
            aria-label="URL вебхука"
            aria-invalid={localError != null || createErrors?.url != null}
          />
          <fieldset className={styles.checklist}>
            <legend className={styles.rowSub}>События</legend>
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev} className={styles.checkItem}>
                <input
                  type="checkbox"
                  checked={checked.has(ev)}
                  onChange={() => toggleEvent(ev)}
                />
                {ev}
              </label>
            ))}
          </fieldset>
          {(localError ?? createErrors?.url) && (
            <span className={styles.error} role="alert">{localError ?? createErrors?.url}</span>
          )}
          <button type="submit" className={styles.toggle} disabled={!canCreate}>
            {creating ? 'Создаю…' : 'Создать вебхук'}
          </button>
        </form>
      )}
    </section>
  );
}
