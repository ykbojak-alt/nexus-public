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

export function YouTubeScreen() {
  const ds = useDataSource();
  const kind = useMemo(getDataSourceKind, []);
  const social = ds.social;

  const hubRead = useAsyncValue(() => social?.getState() ?? Promise.resolve(null), [social]);
  const videosRead = useAsyncValue(() => social?.youtube?.listVideos() ?? Promise.resolve([]), [social]);
  const [videoId, setVideoId] = useState<string | null>(null);
  const commentsRead = useAsyncValue(
    () => (videoId ? social?.youtube?.listComments(videoId) : undefined) ?? Promise.resolve([]),
    [social, videoId]
  );

  const [draftText, setDraftText] = useState('');
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [draftSent, setDraftSent] = useState(false);

  const handleCreateDraft = async () => {
    if (!social || !draftText.trim() || creatingDraft) return;
    setCreatingDraft(true);
    try {
      await social.createDraft({
        network: 'youtube',
        text: draftText,
        media: 'video',
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
      <div className={styles.page} data-screen="youtube" aria-labelledby="youtube-title" data-state="unavailable">
        <PanelHeader level="screen" divider={false} titleId="youtube-title" title="YouTube" />
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
  const ytAccount = hub?.accounts.find((a) => a.network === 'youtube');

  return (
    <div className={styles.page} data-screen="youtube">
      <PanelHeader
        level="screen"
        divider={false}
        titleId="youtube-title"
        title={<>YouTube {kind === 'mock' && <span className={styles.selectSub}>· mock</span>}</>}
      />

      <p className={styles.disclaimer}>
        <strong>YouTube — зона AGENT-A</strong> Генерация видео, описаний и таймкодов — её ответственность.
        Публикация только через approval-гейт. Режим: stealth (cookie-сессия, cookies user-supplied, локально) или open API.
      </p>

      <GlassPanel className={styles.panel} data-state={hubRead.failed ? 'error' : hub ? 'ready' : 'loading'} data-testid="youtube-status">
        <h2 className={styles.panelTitle}>Канал YouTube</h2>
        {hubRead.failed && (
          <ErrorState variant="inline" title="Статус не загрузился." onRetry={hubRead.retry} retryLabel="Повторить" />
        )}
        {ytAccount ? (
          <>
            <div className={styles.networkHeader}>
              <span className={styles.networkName}>YouTube</span>
              <StatusBadge status={ACCOUNT_STATUS[ytAccount.state]} label={STATE_LABELS[ytAccount.state]} />
            </div>
            <div className={styles.networkMeta}>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Handle:</span>
                <span className={styles.metaValue}>{ytAccount.handle ?? '—'}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Подписчики:</span>
                <span className={styles.metaValue}>{formatFollowers(ytAccount.followers)}</span>
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
              {ytAccount.reason && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Причина:</span>
                  <span className={styles.metaReason}>{ytAccount.reason}</span>
                </div>
              )}
            </div>
          </>
        ) : (
          !hubRead.failed && hub != null && <EmptyState variant="inline" title="Канал не настроен." />
        )}
      </GlassPanel>

      <div className={styles.twoCol}>
        <GlassPanel className={styles.panel} data-state={videosRead.failed ? 'error' : videosRead.value == null ? 'loading' : 'ready'} data-testid="youtube-videos">
          <h2 className={styles.panelTitle}>Публикации</h2>
          {videosRead.failed && (
            <ErrorState variant="inline" title="Видео не загрузились." onRetry={videosRead.retry} retryLabel="Повторить" />
          )}
          {videosRead.value != null && videosRead.value.length === 0 && (
            <EmptyState variant="inline" title="Видео нет." />
          )}
          {videosRead.value != null && videosRead.value.length > 0 && (
            <ul className={styles.selectList}>
              {videosRead.value.map((v) => (
                <li key={v.videoId}>
                  <button
                    type="button"
                    className={styles.selectRow}
                    data-selected={videoId === v.videoId}
                    onClick={() => setVideoId(v.videoId)}
                  >
                    <span className={styles.selectMain}>
                      <span>{v.title}</span>
                      <span className={styles.selectSub}>
                        {v.videoId} · {v.views?.toLocaleString() ?? '—'} просмотров · {v.comments?.toLocaleString() ?? '—'} комм.
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>

        <GlassPanel className={styles.panel} data-state={commentsRead.failed ? 'error' : !videoId ? 'empty' : commentsRead.value == null ? 'loading' : 'ready'} data-testid="youtube-comments">
          <h2 className={styles.panelTitle}>Комментарии</h2>
          {videoId == null ? (
            <EmptyState variant="inline" title="Выберите видео." />
          ) : commentsRead.failed ? (
            <ErrorState variant="inline" title="Комментарии не загрузились." onRetry={commentsRead.retry} retryLabel="Повторить" />
          ) : commentsRead.value == null ? (
            <LoadingState>Загрузка комментариев…</LoadingState>
          ) : commentsRead.value.length === 0 ? (
            <EmptyState variant="inline" title="Комментариев нет." />
          ) : (
            <ul className={styles.selectList}>
              {commentsRead.value.map((c) => (
                <li key={c.commentId}>
                  <span className={styles.selectMain}>
                    <strong>{c.author}</strong>: {c.text}
                    <span className={styles.selectSub}>{new Date(c.ts * 1000).toLocaleTimeString('ru-RU')}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </div>

      <GlassPanel className={styles.panel} data-state="ready" data-testid="youtube-composer">
        <h2 className={styles.panelTitle}>Поручить AGENT-A черновик видео</h2>
        <textarea
          className={styles.textarea}
          value={draftText}
          onChange={(e) => { setDraftText(e.target.value); setDraftSent(false); }}
          placeholder="Описание видео, таймкоды, теги…"
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
