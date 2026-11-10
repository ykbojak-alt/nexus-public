import { useState } from 'react';
import { StatusBadge } from '@nexus/ui';
import type { ApiKeyInfo } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import styles from './settings.module.css';

export interface SecurityPanelProps {
  keys: ApiKeyInfo[];
  state?: PatternState;
  /** keyIds with an in-flight write — rendered pending, NOT revoked. */
  pending?: ReadonlySet<string>;
  errors?: Readonly<Record<string, string>>;
  /** DELETE /v1/keys/{id} — callback, screen owns confirm + write. */
  onRevoke?: (keyId: string) => void;
  /**
   * POST /v1/keys — callback; screen owns the write and shows secret once.
   * Rejects surface as an inline error and the form keeps its input.
   */
  onCreate?: (input: { name: string; scopes: string[] }) => void | Promise<void>;
  /** Screen-owned pending flag — disables repeated submit. */
  creating?: boolean;
  /** Field-level create error (adapter 4xx/403) — shown under the form. */
  createError?: string | null;
  /** Secret from the latest create — shown once, then cleared by the screen. */
  createdSecret?: { name: string; secret: string } | null;
  title?: string;
}

const KEY_STATUS: Record<ApiKeyInfo['status'], 'active' | 'paused' | 'warning'> = {
  active: 'active',
  revoked: 'paused',
  expired: 'warning',
};
const KEY_LABELS: Record<ApiKeyInfo['status'], string> = {
  active: 'активен',
  revoked: 'отозван',
  expired: 'истёк',
};

/**
 * Security panel — API keys. Server truth: prefix only (full key never
 * listed), status derived (active|revoked|expired), secret visible exactly
 * once after create. Revoke is a write — pending/errors via props.
 */
export function SecurityPanel({
  keys, state = 'ready', pending, errors, onRevoke, onCreate,
  creating = false, createError, createdSecret, title = 'Безопасность',
}: SecurityPanelProps) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const canCreate = name.trim().length > 0 && scopes.trim().length > 0 && !creating;

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || !onCreate) return;
    setLocalError(null);
    try {
      await onCreate({ name: name.trim(), scopes: scopes.split(',').map((s) => s.trim()).filter(Boolean) });
      setName('');
      setScopes('');
    } catch {
      // adapter rejected (4xx/403) — keep inputs so the user fixes, not retypes
      setLocalError('Создание ключа отклонено — исправьте поля и повторите.');
    }
  }
  return (
    <section className={styles.root} data-state={state} data-testid="security-panel" aria-label={title}>
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Загрузка ключей…</p>}
      {state === 'error' && <p className={styles.muted}>Ключи недоступны.</p>}
      {state === 'empty' && <p className={styles.muted}>Ключей нет.</p>}
      {(state === 'ready' || state === 'stale') && (
        <>
          {createdSecret && (
            <p className={styles.secret} data-testid="created-secret" role="status">
              Ключ «{createdSecret.name}» создан — секрет показан один раз: <code>{createdSecret.secret}</code>
            </p>
          )}
          <ul className={styles.list}>
            {keys.map((k) => {
              const busy = pending?.has(k.keyId) === true;
              const err = errors?.[k.keyId];
              return (
                <li key={k.keyId} className={styles.toolRow} data-busy={busy || undefined}>
                  <span className={styles.rowMain}>
                    <span className={styles.rowName}>
                      {k.name} <span className={styles.tag}>{k.prefix}…</span>
                    </span>
                    <span className={styles.rowSub}>
                      {k.scopes.join(', ')}
                      {k.expiresAt != null ? ` · до ${new Date(k.expiresAt * 1000).toLocaleDateString('ru-RU')}` : ' · без срока'}
                    </span>
                    {err && <span className={styles.error} role="alert">{err}</span>}
                  </span>
                  <StatusBadge status={KEY_STATUS[k.status]} label={KEY_LABELS[k.status].toUpperCase()} />
                  {k.status === 'active' && onRevoke && (
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={busy}
                      onClick={() => onRevoke(k.keyId)}
                      aria-label={`Отозвать ${k.name}`}
                    >
                      Отозвать
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {onCreate && (
            <form
              className={styles.createForm}
              onSubmit={(e) => void submitCreate(e)}
            >
              <input
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="имя ключа"
                aria-label="Имя ключа"
              />
              <input
                className={styles.input}
                value={scopes}
                onChange={(e) => setScopes(e.target.value)}
                placeholder="области, через запятую"
                aria-label="Области ключа"
              />
              {(localError ?? createError) && (
                <span className={styles.error} role="alert">{localError ?? createError}</span>
              )}
              <button type="submit" className={styles.toggle} disabled={!canCreate}>
                {creating ? 'Создаю…' : 'Создать ключ'}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
