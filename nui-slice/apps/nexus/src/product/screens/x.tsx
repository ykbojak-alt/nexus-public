'use client';

import { useMemo, useState } from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  GlassPanel,
  LoadingState,
  PanelHeader,
  StatusBadge,
  type NexusStatus,
} from '@nexus/ui';
import type { SocialAccountState } from '@nexus/mock-data';
import { getDataSource, useDataSource, getDataSourceKind } from '../data-source';
import { useAsyncValue } from '../use-async-value';
import styles from './screens.module.css';

type SocialMode = 'stealth' | 'open';

const STATE_LABELS: Record<SocialAccountState, string> = {
  connected: 'Подключено',
  'not-connected': 'Не подключено',
  'needs-permission': 'Нужно разрешение',
  'needs-review': 'На рассмотрении',
  'rate-limited': 'Лимит запросов',
  error: 'Ошибка',
  unavailable: 'Недоступен',
};

const ACCOUNT_STATUS: Record<SocialAccountState, NexusStatus> = {
  connected: 'online',
  'not-connected': 'offline',
  'needs-permission': 'warning',
  'needs-review': 'warning',
  'rate-limited': 'waiting',
  error: 'error',
  unavailable: 'offline',
};

const MODE_LABELS: Record<SocialMode, string> = {
  stealth: 'stealth (cookie-сессия)',
  open: 'open API',
};

function formatFollowers(n: number | null): string {
  if (n == null) return 'нет данных';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function XScreen() {
  const ds = useDataSource();
  const kind = useMemo(getDataSourceKind, []);
  const social = ds.social;

  const hubRead = useAsyncValue(() => social?.getState() ?? Promise.resolve(null), [social]);
  const tweetsRead = useAsyncValue(() => social?.x?.listTweets() ?? Promise.resolve([]), [social]);
  const mentionsRead = useAsyncValue(() => social?.x?.listMentions() ?? Promise.resolve([]), [social]);

  const [draftText, setDraftText] = useState('');
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [draftSent, setDraftSent] = useState(false);

  const handleCreateDraft = async () => {
    if (!social || !draftText.trim() || creatingDraft) return;
    setCreatingDraft(true);
    try {
      await social.createDraft({
        network: 'x',
        text: draftText,
        media: 'text',
      });
      setDraftText('');
      setDraftSent(true);
    } finally {
      setCreatingDraft(false);
    }
  };

  const handleModeChange = async (newMode: SocialMode) => {
    if (newMode === mode) return;
    await social?.setMode(newMode);
    hubRead.retry();
  };

  if (!social) {
    return (
      <div className={styles.page} data-screen="x" aria-labelledby="x-title" data-state="unavailable">
        <PanelHeader level="screen" divider={false} titleId="x-title" title="X" />
        <GlassPanel className={styles.panel} data-state="unavailable">
          <p className={styles.emptyHint}>
            Адаптер соцсетей недоступен в текущем источнике данных.
          </p>
        </GlassPanel>
      </div>
    );
  }

  const hub = hubRead.value;
  const mode = hub?.mode ?? 'stealth';
  const xAccount = hub?.accounts.find((a) => a.network === 'x');

  return (
    <div className={styles.page} data-screen="x">
      <PanelHeader
        level="screen"
        divider={false}
        titleId="x-title"
        title={<>X {kind === 'mock' && <span className={styles.selectSub}>· mock</span>}</>}
      />

      <p className={styles.disclaimer}>
        <strong>X — зона AGENT-A</strong> Генерация твитов, тредов и ответов — её ответственность.
        Публикация только через approval-гейт. Режим: stealth (cookie-сессия, cookies user-supplied, локально) или open API.
      </p>

      <GlassPanel className={styles.panel} data-state={hubRead.failed ? 'error' : hub ? 'ready' : 'loading'} data-testid="x-status">
        <h2 className={styles.panelTitle}>Аккаунт X</h2>
        {hubRead.failed && (
          <ErrorState variant="inline" title="Статус не загрузился." onRetry={hubRead.retry} retryLabel="Повторить" />
        )}
        {xAccount ? (
          <>
            <div className={styles.networkHeader}>
              <span className={styles.networkName}>X</span>
              <StatusBadge status={ACCOUNT_STATUS[xAccount.state]} label={STATE_LABELS[xAccount.state]} />
            </div>
            <div className={styles.networkMeta}>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Handle:</span>
                <span className={styles.metaValue}>{xAccount.handle ?? '—'}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Подписчики:</span>
                <span className={styles.metaValue}>{formatFollowers(xAccount.followers)}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Режим:</span>
                <span className={styles.agentValue}>
                  {(['stealth', 'open'] as SocialMode[]).map((m) => (
                    <Button
                      key={m}
                      variant={mode === m ? 'primary' : 'ghost'}
                      size="sm"
                      onClick={() => handleModeChange(m)}
                    >
                      {MODE_LABELS[m]}
                    </Button>
                  ))}
                </span>
              </div>
              {xAccount.reason && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Причина:</span>
                  <span className={styles.metaReason}>{xAccount.reason}</span>
                </div>
              )}
            </div>
          </>
        ) : (
          !hubRead.failed && hub != null && <EmptyState variant="inline" title="Аккаунт не настроен." />
        )}
      </GlassPanel>

      <div className={styles.twoCol}>
        <GlassPanel className={styles.panel} data-state={tweetsRead.failed ? 'error' : tweetsRead.value == null ? 'loading' : 'ready'} data-testid="x-tweets">
          <h2 className={styles.panelTitle}>Твиты</h2>
          {tweetsRead.failed && (
            <ErrorState variant="inline" title="Твиты не загрузились." onRetry={tweetsRead.retry} retryLabel="Повторить" />
          )}
          {tweetsRead.value != null && tweetsRead.value.length === 0 && (
            <EmptyState variant="inline" title="Твитов нет." />
          )}
          {tweetsRead.value != null && tweetsRead.value.length > 0 && (
            <ul className={styles.selectList}>
              {tweetsRead.value.map((t) => (
                <li key={t.tweetId}>
                  <span className={styles.selectMain}>
                    <span>{t.text}</span>
                    <span className={styles.selectSub}>
                      {t.tweetId} · ❤ {t.likes?.toLocaleString() ?? '—'} · 🔁 {t.reposts?.toLocaleString() ?? '—'} · {new Date(t.ts * 1000).toLocaleString('ru-RU')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>

        <GlassPanel className={styles.panel} data-state={mentionsRead.failed ? 'error' : mentionsRead.value == null ? 'loading' : 'ready'} data-testid="x-mentions">
          <h2 className={styles.panelTitle}>Упоминания</h2>
          {mentionsRead.failed && (
            <ErrorState variant="inline" title="Упоминания не загрузились." onRetry={mentionsRead.retry} retryLabel="Повторить" />
          )}
          {mentionsRead.value != null && mentionsRead.value.length === 0 && (
            <EmptyState variant="inline" title="Упоминаний нет." />
          )}
          {mentionsRead.value != null && mentionsRead.value.length > 0 && (
            <ul className={styles.selectList}>
              {mentionsRead.value.map((m) => (
                <li key={m.mentionId}>
                  <span className={styles.selectMain}>
                    <strong>{m.author}</strong>: {m.text}
                    <span className={styles.selectSub}>{new Date(m.ts * 1000).toLocaleString('ru-RU')}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </div>

      <GlassPanel className={styles.panel} data-state="ready" data-testid="x-composer">
        <h2 className={styles.panelTitle}>Поручить AGENT-A черновик твита</h2>
        <textarea
          className={styles.textarea}
          value={draftText}
          onChange={(e) => { setDraftText(e.target.value); setDraftSent(false); }}
          placeholder="Текст твита/треда…"
          rows={4}
        />
        <div className={styles.formRow}>
          <Button variant="primary" size="sm" onClick={handleCreateDraft} disabled={creatingDraft || !draftText.trim()}>
            {creatingDraft ? 'Создание…' : 'Создать черновик → на утверждение AGENT-A'}
          </Button>
          <span className={styles.hint}>
            {draftSent
              ? 'Черновик отправлен на утверждение AGENT-A'
              : 'Черновик уйдёт в approval-гейт (pending-approval → approve/reject).'}
          </span>
        </div>
      </GlassPanel>

      <p className={styles.footerNote}>
        Cookies: только user-supplied, хранятся локально. Режим stealth = cookie-сессия (как у ClawdAgent); open = официальные API.
      </p>
    </div>
  );
}
