'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, CommentRow, Composer, EmptyState, ErrorState, FlowSteps, GlassPanel, LoadingState, PanelHeader, StatusBadge, ThreadRow } from '@nexus/ui';
import {
  RuntimeLauncher, ServiceCard, type ServiceConnectionState,
} from '@nexus/ui';
import { instagramApiLifecycle, instagramWebLifecycle } from '@nexus/patterns';
import type {
  InstagramAccountType, InstagramApiState, InstagramApiStatus, InstagramWebState,
} from '@nexus/mock-data';
import { IG_SCOPE_COMMENTS, IG_SCOPE_MESSAGES } from '@nexus/mock-data';
import { getDataSource, useDataSource, getDataSourceKind } from '../data-source';
import { useAsyncValue } from '../use-async-value';
import styles from './screens.module.css';

const API_TO_CARD: Record<InstagramApiStatus, ServiceConnectionState> = {
  'not-connected': 'not-connected',
  connecting: 'opening',
  'needs-permission': 'needs-permission',
  connected: 'connected',
  'limited-account-type': 'needs-review',
  'permission-revoked': 'revoked',
  'rate-limited': 'rate-limited',
  offline: 'error',
  unavailable: 'error',
  error: 'error',
};

const API_LABELS: Record<InstagramApiStatus, string> = {
  'not-connected': 'не подключён',
  connecting: 'подключение',
  'needs-permission': 'нужно разрешение',
  connected: 'подключён',
  'limited-account-type': 'неподдерживаемый тип аккаунта',
  'permission-revoked': 'доступ отозван',
  'rate-limited': 'лимит запросов',
  offline: 'оффлайн',
  unavailable: 'недоступен',
  error: 'ошибка',
};

const WEB_MOCK_STATES: InstagramWebState[] = ['closed', 'unavailable', 'error'];
const API_MOCK_STATES: InstagramApiStatus[] = ['rate-limited', 'permission-revoked', 'offline', 'error'];
const ACCOUNT_TYPES: InstagramAccountType[] = ['business', 'creator', 'consumer'];

export function InstagramScreen() {
  const ds = useDataSource();
  const kind = useMemo(getDataSourceKind, []);
  const web = ds.instagram?.web;
  const api = ds.instagram?.api;

  const webRead = useAsyncValue(() => (web == null ? Promise.resolve(null) : web.getState().then((v) => v.state)), [web]);
  const apiRead = useAsyncValue(() => (api == null ? Promise.resolve(null) : api.getState()), [api]);
  const [accountType, setAccountType] = useState<InstagramAccountType>('business');
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pendingPost, setPendingPost] = useState<string | null>(null);

  const webState = webRead.value;
  const apiState = apiRead.value;
  const connected = apiState?.status === 'connected' && apiState.account != null;
  const scopes = apiState?.account?.grantedScopes ?? [];

  const media = useAsyncValue(
    () => (api == null || !connected ? Promise.resolve([]) : api.listMedia()),
    [api, connected],
  );
  const dm = useAsyncValue(
    () => (api == null || !connected ? Promise.resolve([]) : api.listDmThreads()),
    [api, connected],
  );
  const comments = useAsyncValue(
    () => (api == null || mediaId == null || !connected ? Promise.resolve([]) : api.listComments(mediaId)),
    [api, mediaId, connected],
  );

  const setWebState = (v: InstagramWebState) => webRead.set(v);
  const setApiState = (v: InstagramApiState) => apiRead.set(v);

  // A disconnect invalidates the selected media — comments/DM must not keep
  // pointing at the previous session's ids.
  useEffect(() => {
    if (!connected) setMediaId(null);
  }, [connected]);

  const confirmPost = async () => {
    if (api == null || mediaId == null || pendingPost == null) return;
    const c = await api.postComment(mediaId, pendingPost);
    comments.set((prev) => (prev ?? []).concat(c));
    setPendingPost(null);
    setDraft('');
  };

  return (
    <div className={styles.page} data-screen="instagram" aria-labelledby="instagram-title">
      <PanelHeader level="screen" divider={false} titleId="instagram-title" title={<>Instagram {kind === 'mock' && <span className={styles.selectSub}>· mock</span>}</>} />
      <p className={styles.disclaimer}>
        Web-окно и API-клиент — независимые интеграции: отдельная сессия, токены
        и состояние. Ни одна не передаёт данные другой или агентам.
      </p>

      <GlassPanel className={styles.panel}
        data-state={webRead.failed ? 'error' : webState == null ? 'loading' : webState === 'unavailable' || webState === 'error' ? 'error' : 'ready'}
        data-testid="ig-web">
        <h2 className={styles.panelTitle}>Instagram Web</h2>
        {web == null ? (
          <p className={styles.emptyHint}>Управляемое Web-окно не реализовано источником данных.</p>
        ) : webRead.failed ? (
          <ErrorState variant="inline" title="Состояние окна не загрузилось." onRetry={webRead.retry} retryLabel="Повторить" />
        ) : (
          <>
            {webState != null && (
              <FlowSteps
                steps={instagramWebLifecycle(webState)}
                a11y={{ title: 'Жизненный цикл окна Instagram Web' }}
                responsive
              />
            )}
            <RuntimeLauncher
              name="Instagram"
              state={webState ?? 'closed'}
              onOpen={webState !== 'open' ? async () => setWebState((await web.open()).state) : undefined}
              onOpenExternal={
                webState === 'unavailable' || webState === 'error'
                  ? () => window.open('https://www.instagram.com/', '_blank', 'noopener')
                  : undefined
              }
            />
            {webState === 'open' && (
              <div className={styles.formRow}>
                <Button variant="ghost" size="sm" onClick={async () => setWebState((await web.close()).state)}>
                  Закрыть окно
                </Button>
              </div>
            )}
            {kind === 'mock' && web.setMockState != null && (
              <div className={styles.prefRow}>
                <span className={styles.prefLabel}>mock-состояние</span>
                <span className={styles.prefChoices}>
                  {WEB_MOCK_STATES.map((s) => (
                    <button key={s} type="button" className={styles.prefChoice}
                      data-selected={webState === s}
                      onClick={async () => setWebState((await web.setMockState!(s)).state)}>
                      {s}
                    </button>
                  ))}
                </span>
              </div>
            )}
          </>
        )}
        <p className={styles.emptyHint}>
          Отдельный профиль без DesktopBridge/js_api; повторный запуск фокусирует то же окно.
        </p>
      </GlassPanel>

      <GlassPanel className={styles.panel}
        data-state={apiRead.failed ? 'error' : apiState == null ? 'loading' : apiState.status === 'error' || apiState.status === 'unavailable' ? 'error' : 'ready'}
        data-testid="ig-api">
        <h2 className={styles.panelTitle}>Instagram API</h2>
        {api == null ? (
          <p className={styles.emptyHint}>API-адаптер не реализован источником данных.</p>
        ) : apiRead.failed ? (
          <ErrorState variant="inline" title="Состояние API не загрузилось." onRetry={apiRead.retry} retryLabel="Повторить" />
        ) : (
          <>
            {apiState != null && (
              <FlowSteps
                steps={instagramApiLifecycle(apiState.status)}
                a11y={{ title: 'Жизненный цикл подключения Instagram API' }}
                responsive
              />
            )}
            <ServiceCard
              name="Instagram"
              mode="api"
              state={API_TO_CARD[apiState?.status ?? 'not-connected']}
              reason={apiState?.error ?? (apiState?.status === 'limited-account-type'
                ? 'Consumer/личные аккаунты не поддерживаются Instagram API — используйте Web-окно'
                : undefined)}
              scopes={connected ? scopes : undefined}
              summary={connected
                ? `${apiState!.account!.handle} · ${apiState!.account!.accountType} · ${API_LABELS[apiState!.status]}`
                : API_LABELS[apiState?.status ?? 'not-connected']}
              onDisconnect={connected ? async () => setApiState(await api.disconnect()) : undefined}
            />
            {!connected && apiState?.status !== 'limited-account-type' && (
              <div className={styles.formRow}>
                <label className={styles.selectLabel}>
                  Тип аккаунта
                  <select className={styles.select} value={accountType}
                    onChange={(e) => setAccountType(e.target.value as InstagramAccountType)}>
                    {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <Button variant="primary" size="sm"
                  onClick={async () => setApiState(await api.connect({ accountType }))}>
                  Подключить через Meta OAuth
                </Button>
              </div>
            )}
            {apiState?.status === 'limited-account-type' && (
              <div className={styles.formRow}>
                <Button variant="ghost" size="sm"
                  onClick={async () => setApiState(await api.disconnect())}>
                  Сбросить
                </Button>
              </div>
            )}
            {kind === 'mock' && api.setMockState != null && (
              <div className={styles.prefRow}>
                <span className={styles.prefLabel}>mock-состояние</span>
                <span className={styles.prefChoices}>
                  {API_MOCK_STATES.map((s) => (
                    <button key={s} type="button" className={styles.prefChoice}
                      data-selected={apiState?.status === s}
                      onClick={async () => setApiState(await api.setMockState!(s))}>
                      {s}
                    </button>
                  ))}
                </span>
              </div>
            )}
          </>
        )}
      </GlassPanel>

      {connected && (
        <div className={styles.twoCol}>
          <GlassPanel className={styles.panel} data-state={media.failed ? 'error' : media.value == null ? 'loading' : 'ready'} data-testid="ig-media">
            <h2 className={styles.panelTitle}>Публикации <span className={styles.selectSub}>· Instagram Graph API · mock</span></h2>
            {media.failed && (
              <ErrorState variant="inline" title="Публикации не загрузились." onRetry={media.retry} retryLabel="Повторить" />
            )}
            {media.value != null && (
              <ul className={styles.selectList}>
                {media.value.map((m) => (
                  <li key={m.mediaId}>
                    <button type="button" className={styles.selectRow}
                      data-selected={mediaId === m.mediaId}
                      onClick={() => { setMediaId(m.mediaId); setPendingPost(null); }}>
                      <span className={styles.selectMain}>
                        <span>{m.caption}</span>
                        <span className={styles.selectSub}>{m.mediaId} · {m.mediaType}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {media.value != null && media.value.length === 0 && (
              <EmptyState variant="inline" title="Публикаций нет." />
            )}
          </GlassPanel>

          <GlassPanel className={styles.panel} data-state={comments.failed ? 'error' : comments.value == null ? 'empty' : 'ready'} data-testid="ig-comments">
            <h2 className={styles.panelTitle}>Комментарии</h2>
            {!scopes.includes(IG_SCOPE_COMMENTS) ? (
              <p className={styles.emptyHint}>
                needs-permission: scope {IG_SCOPE_COMMENTS} не выдан — комментарии недоступны.
              </p>
            ) : mediaId == null ? (
              <EmptyState variant="inline" title="Выберите публикацию." />
            ) : comments.failed ? (
              <ErrorState variant="inline" title="Комментарии не загрузились." onRetry={comments.retry} retryLabel="Повторить" />
            ) : comments.value == null ? (
              <LoadingState>Загрузка…</LoadingState>
            ) : (
              <>
                <ul className={styles.selectList}>
                  {comments.value.map((c) => (
                    <li key={c.commentId}>
                      <CommentRow
                        text={c.text}
                        author={c.from}
                        meta={new Date(c.ts * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      />
                    </li>
                  ))}
                </ul>
                {pendingPost == null ? (
                  <Composer
                    value={draft}
                    onChange={setDraft}
                    onSubmit={() => setPendingPost(draft.trim())}
                    inputLabel="Текст комментария"
                    placeholder="Комментарий…"
                    submitLabel="Проверить"
                  />
                ) : (
                  <div className={styles.card} data-testid="ig-post-confirm">
                    <p className={styles.selectSub}>
                      Подтверждение записи · аккаунт {apiState!.account!.handle} ·
                      операция «Опубликовать комментарий» · цель {mediaId}
                    </p>
                    <p>{pendingPost}</p>
                    <div className={styles.formRow}>
                      <Button variant="primary" size="sm" onClick={confirmPost}>Опубликовать</Button>
                      <Button variant="ghost" size="sm" onClick={() => setPendingPost(null)}>Отмена</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </GlassPanel>

          <GlassPanel className={styles.panel} data-state={dm.failed ? 'error' : dm.value == null ? 'empty' : 'ready'} data-testid="ig-dm">
            <h2 className={styles.panelTitle}>Direct-сообщения</h2>
            {!scopes.includes(IG_SCOPE_MESSAGES) ? (
              <p className={styles.emptyHint}>
                needs-permission: scope {IG_SCOPE_MESSAGES} не выдан — DM недоступны.
              </p>
            ) : dm.failed ? (
              <ErrorState variant="inline" title="Диалоги не загрузились." onRetry={dm.retry} retryLabel="Повторить" />
            ) : dm.value == null ? (
              <LoadingState>Загрузка…</LoadingState>
            ) : dm.value.length === 0 ? (
              <EmptyState variant="inline" title="Диалогов нет." />
            ) : (
              <ul className={styles.selectList}>
                {dm.value.map((t) => (
                  <li key={t.threadId}>
                    <ThreadRow title={t.withHandle} preview={t.lastText} note="read-only" />
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>
        </div>
      )
      }
    </div >
  );
}
