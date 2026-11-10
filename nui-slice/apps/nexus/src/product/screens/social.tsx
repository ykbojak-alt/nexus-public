'use client';

import { useMemo, useState, useEffect } from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  GlassPanel,
  PanelHeader,
  StatusBadge,
  type NexusStatus,
} from '@nexus/ui';
import type {
  SocialAccountState,
  SocialAgentState,
  SocialMediaKind,
  SocialNetworkId,
  SocialPostStatus,
} from '@nexus/mock-data';
import { getDataSource, useDataSource, getDataSourceKind } from '../data-source';
import { getApprovalError, syncOpTokenFromProfile } from '../social/live-source';
import { useAsyncValue } from '../use-async-value';
import { useProfile } from '../profile/profile-store';
import { HonestEmpty } from './honest-empty';
import styles from './screens.module.css';

type SocialMode = 'stealth' | 'open';

const ACCOUNT_STATE_LABELS: Record<SocialAccountState, string> = {
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

const AGENT_STATUS: Record<SocialAgentState['state'], NexusStatus> = {
  idle: 'paused',
  drafting: 'thinking',
  scheduling: 'syncing',
  'awaiting-approval': 'waiting',
  offline: 'offline',
};

/** RAE-UI-GAPS: обрезка текста поста до ~280 символов + ellipsis. */
const POST_TEXT_MAX = 280;
function postText(text: string): string {
  if (text.length <= POST_TEXT_MAX) return text;
  return `${text.slice(0, POST_TEXT_MAX).trimEnd()}…`;
}

const POST_STATUS: Record<SocialPostStatus, NexusStatus> = {
  draft: 'info',
  scheduled: 'syncing',
  'pending-approval': 'waiting',
  published: 'complete',
  rejected: 'error',
};

const POST_STATUS_LABELS: Record<SocialPostStatus, string> = {
  draft: 'Черновик',
  scheduled: 'Запланирован',
  'pending-approval': 'На утверждении',
  published: 'Опубликовано',
  rejected: 'Отклонено',
};

const MEDIA_KIND_LABELS: Record<SocialMediaKind, string> = {
  text: 'Текст',
  image: 'Картинка',
  video: 'Видео',
};

const MODE_LABELS: Record<SocialMode, string> = {
  stealth: 'stealth (cookie-сессия)',
  open: 'open API',
};

const NETWORK_NAMES: Record<SocialNetworkId, string> = {
  telegram: 'Telegram',
  instagram: 'Instagram',
  youtube: 'YouTube',
  x: 'X',
};

function formatScheduled(at: string | null): string {
  if (!at) return '—';
  return new Date(at).toLocaleString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });
}

function formatFollowers(n: number | null): string {
  if (n == null) return 'нет данных';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function SocialScreen() {
  const ds = useDataSource();
  const kind = useMemo(getDataSourceKind, []);
  const social = ds.social;
  const { profile } = useProfile();

  // Sync operator token from profile to localStorage on mount/profile change
  useEffect(() => {
    if (profile?.raeOpToken) {
      syncOpTokenFromProfile(profile.raeOpToken);
    }
  }, [profile?.raeOpToken]);

  const hubRead = useAsyncValue(() => social?.getState() ?? Promise.resolve(null), [social]);
  const queueRead = useAsyncValue(() => social?.listQueue() ?? Promise.resolve([]), [social]);
  const approvalsRead = useAsyncValue(() => social?.listApprovals() ?? Promise.resolve([]), [social]);

  const [selectedNetwork, setSelectedNetwork] = useState<SocialNetworkId>('x');
  const [draftText, setDraftText] = useState('');
  const [draftMedia, setDraftMedia] = useState<SocialMediaKind>('text');
  const [draftScheduled, setDraftScheduled] = useState('');
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [draftSent, setDraftSent] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  // RAE-UI-GAPS: необязательная причина отклонения (пост, у которого открыт input).
  const [rejectOpenId, setRejectOpenId] = useState<string | null>(null);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  const handleApprove = async (postId: string) => {
    setApprovalError(null);
    const updated = await social?.respondApproval(postId, 'approve');
    if (updated) {
      approvalsRead.retry();
      queueRead.retry();
    } else {
      const reason = getApprovalError();
      setApprovalError(
        reason ?? 'Аппрув не прошёл — RAE endpoint недоступен',
      );
    }
  };

  const handleReject = async (postId: string, reason?: string) => {
    setApprovalError(null);
    const updated = await social?.respondApproval(postId, 'reject', reason);
    if (updated) {
      approvalsRead.retry();
    } else {
      const err = getApprovalError();
      setApprovalError(
        err ?? 'Риджект не прошёл — RAE endpoint недоступен',
      );
    }
  };

  const handleCreateDraft = async () => {
    if (!social || !draftText.trim() || creatingDraft) return;
    setCreatingDraft(true);
    setDraftError(null);
    setDraftSent(false);
    try {
      await social.createDraft({
        network: selectedNetwork,
        text: draftText,
        media: draftMedia,
        scheduledAt: draftScheduled || undefined,
      });
      setDraftText('');
      setDraftScheduled('');
      setDraftSent(true);
      approvalsRead.retry();
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'Не удалось создать черновик');
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
      <div className={styles.page} data-screen="social" aria-labelledby="social-title" data-state="unavailable" data-testid="social-unavailable">
        <PanelHeader level="screen" divider={false} titleId="social-title" title="Соц. Сети" />
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
  const accounts = hub?.accounts ?? [];
  const agent = hub?.agent;
  const connectedCount = accounts.filter((a) => a.state === 'connected').length;
  const hubSource = hub?.source ?? (kind === 'mock' ? 'mock' as const : undefined);
  const noData = hubSource != null && hubSource !== 'live';

  return (
    <div className={styles.page} data-screen="social" data-source={noData ? hubSource : undefined}>
      <PanelHeader
        level="screen"
        divider={false}
        titleId="social-title"
        title={
          <>
            Соц. Сети
            {kind === 'mock' && <span className={styles.selectSub}> · mock</span>}
          </>
        }
      />
      {noData && (
        <div className={styles.socialSourceNote} role="note" data-testid="social-source-note" data-source={hubSource}>
          <strong>{hubSource === 'mock-offline' ? 'RAE демон недоступен' : 'Источник данных: mock'}</strong>
          {' — '}
          {hubSource === 'mock-offline'
            ? 'реальные данные отсутствуют: экран показывает пустые значения (0/0), а не выдуманные аккаунты или посты.'
            : 'честный пустой контур: без живого RAE-демона данных нет, ничего не имитируется.'}
        </div>
      )}
      <p className={styles.disclaimer}>
        <strong>Соц. Сети — зона AGENT-A</strong> Генерация текста, картинок и видео по тематике страниц — её ответственность.
        Публикация только через approval-гейт (pending-approval → approve/reject).
        Режим подключения выбирает пользователь: stealth (cookie-сессия, только user-supplied, хранятся локально)
        или open API (официальные API).
      </p>

      <div className={styles.kpiRow}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiValue}>{connectedCount} / {accounts.length}</span>
          <span className={styles.kpiLabel}>Подключено сетей</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiValue}>{queueRead.value?.length ?? '—'}</span>
          <span className={styles.kpiLabel}>В очереди</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiValue}>{approvalsRead.value?.length ?? '—'}</span>
          <span className={styles.kpiLabel}>На утверждении</span>
        </div>
      </div>

      <GlassPanel className={styles.panel} data-state={hubRead.failed ? 'error' : agent ? 'ready' : 'loading'} data-testid="social-agent">
        <h2 className={styles.panelTitle}>AGENT-A — оператор соцсетей</h2>
        {hubRead.failed && (
          <ErrorState variant="inline" title="Состояние оператора не загрузилось." onRetry={hubRead.retry} retryLabel="Повторить" />
        )}
        {agent && (
          <>
            <div className={styles.agentInfo}>
              <div className={styles.agentRow}>
                <span className={styles.agentLabel}>Оператор:</span>
                <span className={styles.agentValue}>{agent.operator}</span>
              </div>
              <div className={styles.agentRow}>
                <span className={styles.agentLabel}>Состояние:</span>
                <StatusBadge status={AGENT_STATUS[agent.state]} label={agent.state} />
              </div>
              <div className={styles.agentRow}>
                <span className={styles.agentLabel}>Текущая задача:</span>
                <span className={styles.agentValue}>{agent.currentTask ?? '—'}</span>
              </div>
              <div className={styles.agentRow}>
                <span className={styles.agentLabel}>Режим:</span>
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
            </div>
            <h3 className={styles.subTitle}>Суб-агенты</h3>
            <table className={styles.subAgentTable}>
              <thead>
                <tr>
                  <th>Суб-агент</th>
                  <th>Текущая задача</th>
                </tr>
              </thead>
              <tbody>
                {agent.subAgents.map((sa) => (
                  <tr key={sa.key}>
                    <td className={styles.agentCell}>
                      <span className={styles.agentBadge}>{sa.key}</span>
                    </td>
                    <td>{sa.task ?? <span className={styles.muted}>свободен</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {!agent && hub != null && !hubRead.failed && (
          <EmptyState variant="inline" title="Оператор не загружен." />
        )}
      </GlassPanel>

      <div className={styles.grid}>
        {accounts.length === 0 ? (
          <GlassPanel className={styles.panel} data-state={hubRead.failed ? 'error' : 'empty'} data-testid="social-accounts-empty">
            <h2 className={styles.panelTitle}>Подключённые сети</h2>
            {hubRead.failed ? (
              <ErrorState variant="inline" title="Состояние сетей не загрузилось." onRetry={hubRead.retry} retryLabel="Повторить" />
            ) : (
              <EmptyState variant="inline" title={noData ? 'Нет данных — источник недоступен' : 'Нет подключённых сетей'} body={noData ? 'RAE демон не отвечает или данные отсутствуют — ничего не имитируется.' : 'Подключите сеть через RAE, и она появится здесь.'} />
            )}
          </GlassPanel>
        ) : accounts.map((acc) => (
          <GlassPanel key={acc.network} className={styles.networkCard} data-testid={`network-${acc.network}`}>
            <div className={styles.networkHeader}>
              <span className={styles.networkName}>{NETWORK_NAMES[acc.network]}</span>
              <StatusBadge status={ACCOUNT_STATUS[acc.state]} label={ACCOUNT_STATE_LABELS[acc.state]} />
            </div>
            <div className={styles.networkMeta}>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Handle:</span>
                <span className={styles.metaValue}>{acc.handle ?? '—'}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Подписчики:</span>
                <span className={styles.metaValue}>{formatFollowers(acc.followers)}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Режим:</span>
                <span className={styles.metaValue}>{MODE_LABELS[mode]}</span>
              </div>
              {acc.reason && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Причина:</span>
                  <span className={styles.metaReason}>{acc.reason}</span>
                </div>
              )}
            </div>
          </GlassPanel>
        ))}
      </div>

      <GlassPanel className={styles.panel} data-state={queueRead.failed ? 'error' : queueRead.value == null ? 'loading' : 'ready'} data-testid="social-queue">
        <h2 className={styles.panelTitle}>Очередь публикаций</h2>
        {queueRead.failed && (
          <ErrorState variant="inline" title="Очередь не загрузилась." onRetry={queueRead.retry} retryLabel="Повторить" />
        )}
        {queueRead.value != null && queueRead.value.length === 0 && !noData && (
          <HonestEmpty label="Очередь пуста." />
        )}
        {queueRead.value != null && queueRead.value.length === 0 && noData && (
          <HonestEmpty label="Очередь недоступна." subtitle="Источник данных недоступен — реальных постов нет, ничего не имитируется." />
        )}
        {queueRead.value != null && queueRead.value.length > 0 && (
          <ul className={styles.queueList}>
            {queueRead.value.map((post) => (
              <li key={post.id} className={styles.queueItem}>
                <div className={styles.queueRow}>
                  <StatusBadge status={POST_STATUS[post.status]} label={POST_STATUS_LABELS[post.status]} />
                  <span className={styles.queueNetwork}>{post.network}</span>
                  <span className={styles.queueMedia}>{MEDIA_KIND_LABELS[post.media]}</span>
                  {post.verified != null && (
                    <StatusBadge
                      status={post.verified ? 'complete' : 'warning'}
                      label={post.verified ? 'VERIFIED' : 'NOT VERIFIED'}
                      title={post.verifyReason ?? undefined}
                    />
                  )}
                </div>
                <p className={styles.queueText}>{postText(post.text)}</p>
                <div className={styles.queueMeta}>
                  <span>{formatScheduled(post.scheduledAt)}</span>
                  {post.authorAgent && <span className={styles.queueAuthor}>✍ {post.authorAgent}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>

      <GlassPanel className={styles.panel} data-state={approvalsRead.failed ? 'error' : approvalsRead.value == null ? 'loading' : 'ready'} data-testid="social-approvals">
        <h2 className={styles.panelTitle}>Утверждения</h2>
        {approvalsRead.failed && (
          <ErrorState variant="inline" title="Утверждения не загрузились." onRetry={approvalsRead.retry} retryLabel="Повторить" />
        )}
        {approvalsRead.value != null && approvalsRead.value.length === 0 && !noData && (
          <HonestEmpty label="Нет постов на утверждении." />
        )}
        {approvalsRead.value != null && approvalsRead.value.length === 0 && noData && (
          <HonestEmpty label="Утверждения недоступны." subtitle="Источник данных недоступен — реальных постов нет, ничего не имитируется." />
        )}
        {approvalsRead.value != null && approvalsRead.value.length > 0 && (
          <>
            {approvalError && (
              <p className={styles.approvalError} data-testid="approval-error" role="alert">
                {approvalError}
              </p>
            )}
            <ul className={styles.approvalList}>
              {approvalsRead.value.map((post) => (
                <li key={post.id} className={styles.approvalItem}>
                  <div className={styles.approvalHeader}>
                    <StatusBadge status={POST_STATUS[post.status]} label={POST_STATUS_LABELS[post.status]} />
                    <span className={styles.approvalNetwork}>{post.network}</span>
                    <span className={styles.approvalMedia}>{MEDIA_KIND_LABELS[post.media]}</span>
                    {post.verified != null && (
                      <StatusBadge
                        status={post.verified ? 'complete' : 'warning'}
                        label={post.verified ? 'VERIFIED' : 'NOT VERIFIED'}
                        title={post.verifyReason ?? undefined}
                      />
                    )}
                  </div>
                  <p className={styles.approvalText}>{postText(post.text)}</p>
                  {post.authorAgent && <span className={styles.approvalAuthor}>✍ {post.authorAgent}</span>}
                  <div className={styles.approvalActions}>
                    <Button variant="primary" size="sm" onClick={() => handleApprove(post.id)}>Подтвердить</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleReject(post.id, rejectReasons[post.id]?.trim() || undefined)}>Отклонить</Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={rejectOpenId === post.id}
                      onClick={() => setRejectOpenId((prev) => (prev === post.id ? null : post.id))}
                    >
                      {rejectOpenId === post.id ? 'Скрыть причину' : 'Причина'}
                    </Button>
                  </div>
                  {rejectOpenId === post.id && (
                    <div className={styles.approvalReasonRow}>
                      <input
                        aria-label="Причина отклонения"
                        className={styles.rejectReasonInput}
                        type="text"
                        value={rejectReasons[post.id] ?? ''}
                        placeholder="Причина отклонения (необязательно)"
                        onChange={(e) =>
                          setRejectReasons((prev) => ({ ...prev, [post.id]: e.target.value }))
                        }
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          handleReject(post.id, rejectReasons[post.id]?.trim() || undefined);
                          setRejectOpenId(null);
                        }}
                      >
                        Отправить
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </GlassPanel>

      <GlassPanel className={styles.panel} data-state="ready" data-testid="social-composer">
        <h2 className={styles.panelTitle}>Поручить AGENT-A черновик</h2>
        <div className={styles.composerForm}>
          <div className={styles.formRow}>
            <label className={styles.selectLabel}>
              Сеть
              <select className={styles.select} value={selectedNetwork} onChange={(e) => setSelectedNetwork(e.target.value as SocialNetworkId)}>
                {(['telegram', 'instagram', 'youtube', 'x'] as SocialNetworkId[]).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className={styles.selectLabel}>
              Медиа
              <select className={styles.select} value={draftMedia} onChange={(e) => setDraftMedia(e.target.value as SocialMediaKind)}>
                <option value="text">Текст</option>
                <option value="image">Картинка</option>
                <option value="video">Видео</option>
              </select>
            </label>
          </div>
          <textarea
            className={styles.textarea}
            value={draftText}
            onChange={(e) => { setDraftText(e.target.value); setDraftSent(false); }}
            placeholder="Текст поста…"
            rows={4}
          />
          <div className={styles.formRow}>
            <label className={styles.selectLabel}>
              Запланировать на
              <input
                className={styles.input}
                type="datetime-local"
                value={draftScheduled}
                onChange={(e) => setDraftScheduled(e.target.value)}
              />
            </label>
            <Button variant="primary" size="sm" onClick={handleCreateDraft} disabled={creatingDraft || !draftText.trim()}>
              {creatingDraft ? 'Создание…' : 'Создать черновик'}
            </Button>
            {draftError && (
              <span className={styles.draftError} data-testid="draft-error" role="alert">
                {draftError}
              </span>
            )}
            {draftSent && <span className={styles.hint}>Черновик отправлен на утверждение AGENT-A</span>}
            {!draftSent && !draftError && (
              <span className={styles.hint}>
                Черновик создастся со статусом pending-approval — публикация только после подтверждения.
              </span>
            )}
          </div>
        </div>
      </GlassPanel>

      <p className={styles.footerNote}>
        Cookies: только user-supplied, хранятся локально. Режим stealth = cookie-сессия (как у ClawdAgent); open = официальные API.
      </p>
    </div>
  );
}
