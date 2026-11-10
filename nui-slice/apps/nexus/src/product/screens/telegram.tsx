'use client';

import { useMemo, useState } from 'react';
import { Button, Composer, ConnectionStatus, EmptyState, ErrorState, FlowSteps, GlassPanel, LoadingState, MessageRow, PanelHeader, ThreadRow } from '@nexus/ui';
import { telegramLifecycle } from '@nexus/patterns';
import type { TelegramStatus } from '@nexus/mock-data';
import { getDataSource, useDataSource, getDataSourceKind } from '../data-source';
import { useAsyncValue } from '../use-async-value';
import styles from './screens.module.css';

const STATUS_LABELS: Record<TelegramStatus, string> = {
  disconnected: 'Отключён',
  authorizing: 'Авторизация',
  connected: 'Подключён',
  reconnecting: 'Переподключение',
  locked: 'Заблокирован',
  unavailable: 'Недоступен',
  error: 'Ошибка',
};

const MOCK_STATUSES: TelegramStatus[] = ['disconnected', 'reconnecting', 'locked', 'error'];

export function TelegramScreen() {
  const ds = useDataSource();
  const kind = useMemo(getDataSourceKind, []);
  const tg = ds.telegram;

  const stateRead = useAsyncValue(() => (tg == null ? Promise.resolve(null) : tg.getState()), [tg]);
  const state = stateRead.value;
  const connected = state?.status === 'connected';
  const chats = useAsyncValue(
    () => (tg == null || !connected ? Promise.resolve([]) : tg.listChats()),
    [tg, connected],
  );
  const [chatId, setChatId] = useState<string | null>(null);
  const history = useAsyncValue(
    () => (tg == null || chatId == null || !connected ? Promise.resolve([]) : tg.getHistory(chatId)),
    [tg, chatId, connected],
  );
  const [authInput, setAuthInput] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const submitAuth = async () => {
    if (tg == null || state == null) return;
    const text = authInput.trim();
    if (!text) return;
    const input =
      state.authStep === 'password' ? { password: text }
        : state.authStep === 'code' ? { code: text }
          : { phone: text };
    setAuthInput('');
    stateRead.set(await tg.startAuth(input));
  };

  const send = async () => {
    const text = draft.trim();
    if (tg == null || chatId == null || !text || sending) return;
    setSending(true);
    const msg = await tg.sendText(chatId, text);
    history.set((h) => (h ?? []).concat(msg));
    setDraft('');
    setSending(false);
  };

  if (tg == null) {
    return (
      <div className={styles.page} data-screen="telegram" aria-labelledby="telegram-title" data-state="unavailable">
        <PanelHeader level="screen" divider={false} titleId="telegram-title" title="Telegram" />
        <GlassPanel className={styles.panel} data-state="empty">
          <ConnectionStatus state="unavailable" label={STATUS_LABELS.unavailable} />
          <p className={styles.emptyHint}>
            Telegram-адаптер не реализован источником данных — клиент появится,
            когда W1 подключит типизированный TDLib adapter.
          </p>
        </GlassPanel>
      </div>
    );
  }

  const authLabel =
    state?.authStep === 'phone' || (state?.status === 'disconnected')
      ? 'Номер телефона'
      : state?.authStep === 'code' ? 'Код из Telegram' : 'Пароль 2FA';

  return (
    <div className={styles.page} data-screen="telegram">
      <PanelHeader level="screen" divider={false} titleId="telegram-title" title={<>Telegram {kind === 'mock' && <span className={styles.selectSub}>· mock-клиент</span>}</>} />
      <p className={styles.disclaimer}>
        Переписка остаётся внутри клиента: сообщения не попадают в общие ленты,
        телеметрию и контекст агентов.
      </p>

      <GlassPanel className={styles.panel} data-state={stateRead.failed ? 'error' : state == null ? 'loading' : 'ready'} data-testid="tg-status">
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Подключение</h2>
          {state != null && <ConnectionStatus state={state.status} label={STATUS_LABELS[state.status]} />}
        </div>
        {stateRead.failed && (
          <ErrorState variant="inline" title="Состояние подключения не загрузилось." onRetry={stateRead.retry} retryLabel="Повторить" />
        )}
        {state != null && (
          <FlowSteps
            steps={telegramLifecycle(state.status)}
            a11y={{ title: 'Жизненный цикл подключения Telegram' }}
            responsive
          />
        )}
        {state?.error != null && <p className={styles.error}>{state.error}</p>}
        {state != null && !connected && (
          <div className={styles.formRow}>
            <input
              className={styles.input}
              value={authInput}
              onChange={(e) => setAuthInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitAuth(); }}
              placeholder={authLabel}
              aria-label={authLabel}
              type={state.authStep === 'password' ? 'password' : 'text'}
              autoComplete="off"
            />
            <Button variant="primary" size="sm" onClick={submitAuth} disabled={!authInput.trim()}>
              {state.status === 'disconnected' ? 'Подключить' : 'Продолжить'}
            </Button>
          </div>
        )}
        {connected && (
          <div className={styles.formRow}>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => { setChatId(null); stateRead.set(await tg.logout()); }}
            >
              Выйти
            </Button>
          </div>
        )}
        {kind === 'mock' && tg.setMockState != null && (
          <div className={styles.prefRow}>
            <span className={styles.prefLabel}>mock-состояние</span>
            <span className={styles.prefChoices}>
              {MOCK_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={styles.prefChoice}
                  data-selected={state?.status === s}
                  onClick={async () => stateRead.set(await tg.setMockState!(s))}
                >
                  {STATUS_LABELS[s].toLowerCase()}
                </button>
              ))}
            </span>
          </div>
        )}
      </GlassPanel>

      <div className={styles.twoCol}>
        <GlassPanel className={styles.panel} data-state={!connected ? 'empty' : chats.failed ? 'error' : chats.value == null ? 'loading' : 'ready'} data-testid="tg-chats">
          <h2 className={styles.panelTitle}>Чаты</h2>
          {!connected && <EmptyState variant="inline" title="Подключитесь, чтобы увидеть чаты." />}
          {connected && chats.failed && (
            <ErrorState variant="inline" title="Чаты не загрузились." onRetry={chats.retry} retryLabel="Повторить" />
          )}
          {connected && chats.value != null && (
            <ul className={styles.selectList}>
              {chats.value.map((c) => (
                <li key={c.chatId}>
                  <ThreadRow
                    title={c.title}
                    preview={c.lastText}
                    unread={c.unread || undefined}
                    selected={chatId === c.chatId}
                    onSelect={() => setChatId(c.chatId)}
                  />
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>

        <GlassPanel className={styles.panel} data-state={chatId == null ? 'empty' : history.failed ? 'error' : history.value == null ? 'loading' : 'ready'} data-testid="tg-history">
          <h2 className={styles.panelTitle}>
            {chats.value?.find((c) => c.chatId === chatId)?.title ?? 'Переписка'}
          </h2>
          {chatId == null ? (
            <EmptyState variant="inline" title="Выберите чат." />
          ) : history.failed ? (
            <ErrorState variant="inline" title="История не загрузилась." onRetry={history.retry} retryLabel="Повторить" />
          ) : history.value == null ? (
            <LoadingState>Загрузка истории…</LoadingState>
          ) : (
            <>
              <ul className={styles.selectList}>
                {history.value.map((m) => (
                  <li key={m.messageId}>
                    <MessageRow
                      text={m.text}
                      direction={m.fromMe ? 'outgoing' : 'incoming'}
                      meta={`${m.fromMe ? 'вы' : 'собеседник'} · ${new Date(m.ts * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`}
                    />
                  </li>
                ))}
              </ul>
              <Composer
                value={draft}
                onChange={setDraft}
                onSubmit={() => void send()}
                inputLabel="Текст сообщения"
                placeholder="Сообщение…"
                pending={sending}
              />
            </>
          )}
        </GlassPanel>
      </div>
    </div>
  );
}
