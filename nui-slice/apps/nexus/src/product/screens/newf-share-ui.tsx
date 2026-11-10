'use client';

/**
 * W38: Share UI — диалог создания публичной view-ссылки + список активных шаров.
 *
 * POST /api/core/share {term, scopes, ttl_s} → {token, view_url};
 * GET /api/core/shares (префиксы + hits); DELETE /api/core/share/{token}
 * (полный токен — поэтому revoke доступен только для шаров, созданных
 * в этой сессии; полный токен держим в sessionStorage).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NewfBridge, ShareEntry } from './newf-live';
import styles from './newf-agents-panel.module.css';

export const SHARE_TTL_MIN = 60;
export const SHARE_TTL_MAX = 86400;

export interface ShareDialogProps {
  bridge: NewfBridge;
  term: string;
  base?: string;
  onClose: () => void;
}

export function ShareDialog({ bridge, term, base = '', onClose }: ShareDialogProps) {
  const [scope, setScope] = useState<'screen' | 'dump'>('screen');
  const [ttlMin, setTtlMin] = useState(60);
  const [created, setCreated] = useState<{ token: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = () => {
    setBusy(true);
    setError(null);
    void bridge.shareCreate!(term, {
      scopes: [scope],
      ttlS: Math.min(Math.max(ttlMin * 60, SHARE_TTL_MIN), SHARE_TTL_MAX),
    })
      .then((s) => {
        // полный токен — только здесь (список отдаёт префикс)
        try { sessionStorage.setItem(`nexus.share.${s.token}`, JSON.stringify({ term: s.term, scopes: s.scopes, expiresAt: s.expiresAt })); } catch { /* noop */ }
        setCreated({ token: s.token, url: `${base.replace(/\/$/, '')}${s.viewUrl || `/view/${s.token}/${scope}`}` });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'share failed'))
      .finally(() => setBusy(false));
  };

  return (
    <div className={styles.shareDialog} role="dialog" aria-label="Share terminal" data-testid="share-dialog">
      <header className={styles.diagHeader}>
        <h3 className={styles.groupTitle}>SHARE · {term}</h3>
        <button type="button" className={styles.filterChip} data-testid="share-close" aria-label="Закрыть" onClick={onClose}>×</button>
      </header>

      {created ? (
        <div className={styles.shareResult}>
          <p className={styles.shareLabel}>Публичная ссылка (scope: {scope}):</p>
          <code className={styles.shareUrl} data-testid="share-url">{created.url}</code>
          <button
            type="button"
            className={styles.filterChip}
            data-testid="share-copy"
            onClick={() => { void navigator.clipboard?.writeText(created.url).catch(() => {}); }}
          >Копировать</button>
          <button type="button" className={styles.filterChip} data-testid="share-done" onClick={onClose}>Готово</button>
        </div>
      ) : (
        <>
          <div className={styles.shareRow}>
            <label className={styles.shareLabel}>Scope</label>
            <select
              className={styles.shareSelect}
              data-testid="share-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'screen' | 'dump')}
            >
              <option value="screen">screen</option>
              <option value="dump">dump</option>
            </select>
          </div>
          <div className={styles.shareRow}>
            <label className={styles.shareLabel}>TTL, минут</label>
            <input
              type="number"
              min={1}
              max={SHARE_TTL_MAX / 60}
              className={styles.shareSelect}
              data-testid="share-ttl"
              value={ttlMin}
              onChange={(e) => setTtlMin(Number(e.target.value) || 60)}
            />
          </div>
          {error && <p className={styles.offline} role="alert" data-testid="share-error">{error}</p>}
          <div className={styles.shareRow}>
            <button type="button" className={styles.filterChip} data-testid="share-create" disabled={busy} onClick={create}>
              {busy ? 'создаю…' : 'Создать'}
            </button>
            <button type="button" className={styles.filterChip} data-testid="share-cancel" onClick={onClose}>Отмена</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Список активных шаров (GET /api/core/shares) + revoke (полный токен из sessionStorage). */
export function SharesList({ bridge }: { bridge: NewfBridge }) {
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [load, setLoad] = useState<'loading' | 'ok' | 'offline'>('loading');
  const cancelled = useRef(false);

  const refresh = useCallback(() => {
    bridge.shares?.()
      .then((list) => { if (!cancelled.current) { setShares(list); setLoad('ok'); } })
      .catch(() => { if (!cancelled.current) setLoad('offline'); });
  }, [bridge]);

  useEffect(() => {
    cancelled.current = false;
    refresh();
    const id = setInterval(refresh, 5000);
    return () => { cancelled.current = true; clearInterval(id); };
  }, [refresh]);

  if (!bridge.shares) return null;

  const fullToken = (prefix: string): string | null => {
    // сессионные шары хранятся по полному токену; список отдаёт префикс
    // «tok-1234…» — сравниваем без эллипсиса.
    const base = prefix.replace(/…$/, '');
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith('nexus.share.')) {
          const token = key.slice('nexus.share.'.length);
          if (token.startsWith(base)) return token;
        }
      }
    } catch { /* noop */ }
    return null;
  };

  const [revokeErr, setRevokeErr] = useState<string | null>(null);

  const revoke = (entry: ShareEntry) => {
    const token = fullToken(entry.token);
    if (!token) { setRevokeErr(`no full token for ${entry.term} (created elsewhere)`); return; }
    setRevokeErr(null);
    void bridge.shareRevoke!(token)
      .then(() => setShares((prev) => prev.filter((s) => s.token !== entry.token)))
      .catch((e: unknown) => setRevokeErr(e instanceof Error ? e.message : 'revoke failed'));
  };

  return (
    <section className={styles.group} role="region" aria-label="Shares" data-testid="shares-section">
      <h3 className={styles.groupTitle}>
        SHARES <span className={styles.groupCount} data-testid="shares-count">{shares.length}</span>
      </h3>
      {load === 'offline' && <p className={styles.offline} role="alert">shares unavailable</p>}
      {revokeErr && <p className={styles.offline} role="alert" data-testid="share-revoke-error">{revokeErr}</p>}
      {shares.length === 0 ? (
        <p className={styles.empty}>no active shares</p>
      ) : (
        <ul className={styles.list}>
          {shares.map((s) => (
            <li key={s.token} className={styles.badge} data-testid={`share-${s.token}`}>
              <span className={styles.badgeName} title={s.token}>{s.token}</span>
              <span className={styles.badgeMeta}>
                {s.term} · {s.scopes.join(',')} · {s.hits} hits · {s.expired ? 'expired' : new Date(s.expiresAt * 1000).toTimeString().slice(0, 5)}
              </span>
              {!s.expired && fullToken(s.token) && (
                <button
                  type="button"
                  className={styles.filterChip}
                  data-testid={`share-revoke-${s.token}`}
                  onClick={() => revoke(s)}
                >revoke</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
