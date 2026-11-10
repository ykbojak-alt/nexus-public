'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  GlassPanel,
  LoadingState,
  Modal,
  StatusBadge,
  type NexusStatus,
} from '@nexus/ui';
import {
  getBusBridge,
  type BusActionResult,
  type BusBridge,
  type BusCard,
  type BusCardText,
  type BusCleanReport,
  type BusCrashEntry,
  type BusExport,
  type BusHealth,
  type BusHealthState,
  type BusHostSession,
  type BusHostState,
  type BusLogTail,
  type BusModelEntry,
  type BusOutboxReply,
  type BusPolicy,
  type BusQueueAge,
  type BusRequeueLost,
  type BusReplyText,
  type BusSentHealth,
  type BusStatusPayload,
  type BusWindowSummary,
} from '../../integrations/ai2/desktop-bridge/bus-bridge';
import styles from './bus-desktop.module.css';

/**
 * W7 — десктоп-приложение шины NEXUS.
 *
 * Одно окно: живой дашборд окон W0–W6 (обновление раз в 5 секунд) и
 * панели управления очередями, дозором, политикой, моделями, здоровьем
 * леджера, ответами и хостом AI-2.
 *
 * Две честности, заложенные в задание и в разметку:
 *  - «сессия открыта в интерфейсе» — LOCKED это штатное состояние, а не
 *    зависшая очередь; плашка показывается только по свежему событию
 *    (журнал дозора, ��оследние 30 минут);
 *  - «пусто» и «счётчик сломан» — разные состояния леджера: после суточной
 *    ротации sent\ пуст, и это не потеря карточек.
 *
 * Все числа — из моста (service.py читает status.json и файлы шины),
 * ничего не выдумывается: нет данных — честная надпись, а не «0».
 */

const POLL_MS = 5_000;

const WINDOW_IDS = ['W0', 'W1', 'W2', 'W3', 'W4', 'W5', 'W6'] as const;

const STATE_BADGE: Record<string, { status: NexusStatus; label: string }> = {
  WORK: { status: 'executing', label: 'РАБОТАЕТ' },
  LONG: { status: 'validating', label: 'ДОЛГО' },
  WAIT: { status: 'waiting', label: 'ЖДЁТ' },
  IDLE: { status: 'offline', label: 'СВОБОДНА' },
  ERROR: { status: 'error', label: 'ОШИБКА' },
  UNKNOWN: { status: 'info', label: 'НЕТ ДАННЫХ' },
  // Окно есть только в наблюдаемом слое (bus-observe), файловых счётчиков нет.
  OBSERVED: { status: 'info', label: 'НАБЛЮДАЕМОЕ' },
};

// Наблюдаемое состояние окна (bus-observe.py) — независимо от файлового state.
const OBSERVED_BADGE: Record<string, { status: NexusStatus; label: string }> = {
  busy: { status: 'executing', label: 'РАБОТАЕТ' },
  idle: { status: 'offline', label: 'СВОБОДНО' },
  dead: { status: 'error', label: 'НЕТ ОКНА' },
  unknown: { status: 'info', label: '—' },
};

/** Файловое состояние vs наблюдаемое: расхождение = тревога, не схлопываем. */
function stateDivergence(state: string, observed: string | null | undefined): string | null {
  if (!observed || observed === 'unknown') return null;
  const fileBusy = state === 'WORK' || state === 'LONG';
  if (fileBusy && observed === 'idle') return 'файлы: работа · экран: свободно';
  if (fileBusy && observed === 'dead') return 'файлы: работа · окно мертво';
  if (state === 'IDLE' && observed === 'busy') return 'файлы: свободна · экран: занято';
  if (state === 'OBSERVED') return null;
  return null;
}

const HEALTH_BADGE: Record<BusHealthState, { status: NexusStatus; label: string }> = {
  ok: { status: 'complete', label: 'в порядке' },
  empty: { status: 'info', label: 'пусто' },
  empty_after_rotation: { status: 'warning', label: 'пусто после ротации' },
  counter_mismatch: { status: 'error', label: 'счётчик сломан' },
};

const TABS = [
  { id: 'queue', label: 'Очередь' },
  { id: 'watchdog', label: 'Дозор' },
  { id: 'policy', label: 'Политика и модели' },
  { id: 'health', label: 'Здоровье' },
  { id: 'outbox', label: 'Ответы' },
  { id: 'host', label: 'Хост AI-2' },
] as const;

type TabId = (typeof TABS)[number]['id'];

type ConfirmSpec =
  | { kind: 'remove'; window: string; name: string }
  | { kind: 'dispatch'; window: string; name: string }
  | { kind: 'requeue' }
  | { kind: 'clean' }
  | { kind: 'block'; message: string }
  | { kind: 'watchdogStop' }
  | null;

function ageLabel(min: number | null | undefined): string {
  if (min == null) return '—';
  if (min >= 60) return `${Math.floor(min / 60)} ч ${min % 60} мин`;
  return `${min} мин`;
}

function stateBadge(state: string) {
  return STATE_BADGE[state] ?? STATE_BADGE.UNKNOWN;
}

/** Текст ошибки из ответа моста: наружу приходит значением, не исключением. */
function errOf(result: { error?: string } | null | undefined): string {
  return result?.error ?? '';
}

function bytesLabel(size: number): string {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
}

// ── заголовок окна ─────────────────────────────────────────────────────────

function TitleBar({
  bridge,
  busDir,
  version,
  onError,
}: {
  bridge: BusBridge | null;
  busDir: string;
  version: string;
  onError: (message: string) => void;
}) {
  const run = async (fn: () => Promise<boolean>) => {
    const ok = await fn();
    if (!ok) onError('Окно не отвечает — действие не выполнено');
  };
  return (
    <header className={styles.titlebar}>
      <div className={`${styles.titlebarTitle} pywebview-drag-region`}>
        NEXUS Bus Desktop
        <span className={styles.titlebarMeta}>
          {version} · {busDir}
        </span>
      </div>
      <div className={styles.titlebarActions}>
        <button
          type="button"
          className={styles.iconBtn}
          title="Свернуть"
          onClick={() => void run(() => bridge?.minimize() ?? Promise.resolve(false))}
        >
          —
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          title="Закрыть"
          onClick={() => void run(() => bridge?.closeWindow() ?? Promise.resolve(false))}
        >
          ✕
        </button>
      </div>
    </header>
  );
}

// ── таблица окон ──────────────────────────────────────────────────────────

function WindowTable({
  windows,
  onPick,
}: {
  windows: BusWindowSummary[];
  onPick: (window: string) => void;
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Окно</th>
            <th>Состояние</th>
            <th>Наблюдение</th>
            <th>Очередь</th>
            <th>На паузе</th>
            <th>sent</th>
            <th>outbox</th>
            <th>Старшая карточка</th>
            <th>send PID</th>
            <th>Задача</th>
          </tr>
        </thead>
        <tbody>
          {windows.map((win) => {
            const badge = stateBadge(win.state);
            return (
              <tr key={win.id} data-testid={`bus-window-${win.id}`}>
                <td>
                  <div className={styles.windowCell}>
                    <button
                      type="button"
                      className={styles.windowId}
                      onClick={() => onPick(win.id)}
                      title="Открыть очередь окна"
                    >
                      {win.id}
                    </button>
                    <span className={styles.windowSession}>
                      {win.session}
                      {win.title ? ` · ${win.title}` : ''}
                    </span>
                    {win.locked ? (
                      <span className={styles.locked} data-testid={`bus-locked-${win.id}`}>
                        сессия открыта в интерфейсе
                        {win.locked.task ? ` · ${win.locked.task}` : ''}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td>
                  <div className={styles.stateCell}>
                    <span className={styles.stateDot} data-state={win.state} />
                    <StatusBadge status={badge.status} label={badge.label} />
                  </div>
                </td>
                <td data-testid={`bus-observed-${win.id}`}>
                  {(() => {
                    const obs = OBSERVED_BADGE[win.observed ?? ''] ?? OBSERVED_BADGE.unknown;
                    const divergence = stateDivergence(win.state, win.observed);
                    return (
                      <div className={styles.stateCell} title={win.observedSince ? `с ${win.observedSince}` : undefined}>
                        <StatusBadge status={obs.status} label={obs.label} />
                        {divergence ? (
                          <span className={styles.divergence} title="Расхождение файлового и наблюдаемого состояния">
                            ⚠ {divergence}
                          </span>
                        ) : null}
                      </div>
                    );
                  })()}
                </td>
                <td className={styles.num}>{win.queueCount}</td>
                <td className={styles.num}>{win.heldCount}</td>
                <td className={styles.num}>
                  {win.sent}
                  {win.sentArchive > 0 ? (
                    <span className={styles.muted}> +{win.sentArchive} в архиве</span>
                  ) : null}
                </td>
                <td className={styles.num}>{win.outbox}</td>
                <td className={styles.num}>{ageLabel(win.oldestAgeMin)}</td>
                <td className={styles.num}>{win.sendPid ?? '—'}</td>
                <td className={styles.muted}>{win.task || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── карточка очереди ──────────────────────────────────────────────────────

function CardRow({
  card,
  windowId,
  held,
  busy,
  onView,
  onHold,
  onUnhold,
  onDispatch,
  onRemove,
}: {
  card: BusCard;
  windowId: string;
  held: boolean;
  busy: string | null;
  onView: () => void;
  onHold: () => void;
  onUnhold: () => void;
  onDispatch: () => void;
  onRemove: () => void;
}) {
  const key = `${windowId}/${card.name}`;
  return (
    <div className={styles.listRow} data-testid={`bus-card-${key}`}>
      <div className={styles.listMain}>
        <span className={styles.listName}>{card.name}</span>
        <span className={styles.listMeta}>
          {ageLabel(card.ageMin)} · {bytesLabel(card.size)}
          {held ? ' · на паузе' : ''}
        </span>
      </div>
      <div className={styles.rowActions}>
        <button type="button" className={styles.miniBtn} onClick={onView}>
          Текст
        </button>
        {held ? (
          <button
            type="button"
            className={styles.miniBtn}
            disabled={busy === key}
            onClick={onUnhold}
          >
            Вернуть
          </button>
        ) : (
          <button
            type="button"
            className={styles.miniBtn}
            disabled={busy === key}
            onClick={onHold}
          >
            На паузу
          </button>
        )}
        <button
          type="button"
          className={styles.miniBtn}
          disabled={busy === key || held}
          onClick={onDispatch}
          title="Отправить карточку в окно"
        >
          Отправить
        </button>
        <button
          type="button"
          className={styles.miniBtn}
          data-variant="danger"
          disabled={busy === key}
          onClick={onRemove}
        >
          Удалить
        </button>
      </div>
    </div>
  );
}

// ── основной экран ────────────────────────────────────────────────────────

export function BusDesktopScreen() {
  const [bridge, setBridge] = useState<BusBridge | null>(null);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [appInfo, setAppInfo] = useState<{ version: string; busDir: string } | null>(null);

  const [status, setStatus] = useState<BusStatusPayload | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('queue');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec>(null);

  // очередь
  const [queueWindow, setQueueWindow] = useState<string>('W0');
  const [queueCards, setQueueCards] = useState<BusCard[]>([]);
  const [heldCards, setHeldCards] = useState<BusCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [taskText, setTaskText] = useState('');
  const [taskFile, setTaskFile] = useState<string | null>(null);
  const [cardView, setCardView] = useState<BusCardText | null>(null);
  const [dispatchText, setDispatchText] = useState('');
  const [dispatchVerdict, setDispatchVerdict] = useState<{ delivery: string; detail: string } | null>(null);

  // дозор
  const [watchState, setWatchState] = useState<{
    running: boolean; pid: number | null; startedAt: string; uptimeSec: number | null;
    autostart: boolean; generatedAt: string; error: string;
  } | null>(null);
  const [logName, setLogName] = useState('watch.log');
  const [logFilter, setLogFilter] = useState('');
  const [log, setLog] = useState<BusLogTail | null>(null);
  const [crashes, setCrashes] = useState<BusCrashEntry[]>([]);
  const [crashView, setCrashView] = useState<{ name: string; text: string } | null>(null);
  const [audit, setAudit] = useState<
    { ts: string; event: string; file: string; detail: string }[] | null
  >(null);

  // политика и модели
  const [models, setModels] = useState<Record<string, BusModelEntry>>({});
  const [modelDraft, setModelDraft] = useState<Record<string, string>>({});
  const [policyMessage, setPolicyMessage] = useState('');

  // здоровье
  const [sentHealth, setSentHealth] = useState<BusSentHealth | null>(null);
  const [queueAge, setQueueAge] = useState<BusQueueAge | null>(null);
  const [requeue, setRequeue] = useState<BusRequeueLost | null>(null);
  const [clean, setClean] = useState<BusCleanReport | null>(null);

  // ответы
  const [replies, setReplies] = useState<BusOutboxReply[] | null>(null);
  const [replyView, setReplyView] = useState<BusReplyText | null>(null);
  const [exportText, setExportText] = useState<BusExport | null>(null);

  // хост AI-2
  const [hostState, setHostState] = useState<BusHostState | null>(null);
  const [hostSessions, setHostSessions] = useState<BusHostSession[] | null>(null);
  const [hostOverview, setHostOverview] = useState<Record<string, unknown> | null>(null);
  const [delegationId, setDelegationId] = useState('');
  const [delegation, setDelegation] = useState<Record<string, unknown> | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── мост ────────────────────────────────────────────────────────────────

  useEffect(() => {
    let live = true;
    void getBusBridge().then(async (found) => {
      if (!live) return;
      setBridge(found);
      setBridgeReady(true);
      if (!found.available) return;
      const info = await found.appInfo();
      if (!live || !info) return;
      setAppInfo({ version: info.version, busDir: info.busDir });
      void found.setTitle('NEXUS Bus Desktop');
    });
    return () => {
      live = false;
    };
  }, []);

  const reportError = useCallback((message: string) => {
    setActionError(message);
    setNotice(null);
  }, []);

  /** Единая точка действия: помечает занятость, ловит ошибку значениями. */
  const act = useCallback(
    async <T,>(key: string, fn: () => Promise<T>): Promise<T | null> => {
      setBusy(key);
      setActionError(null);
      try {
        return await fn();
      } catch (error) {
        reportError(error instanceof Error ? error.message : String(error));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [reportError],
  );

  // ── дашборд: обновление раз в 5 секунд ─────────────────────────────────

  const refreshStatus = useCallback(async () => {
    if (!bridge?.available) return;
    const data = await bridge.busStatus();
    if (!data) {
      setStatusError('Мост не вернул состояние шины');
      return;
    }
    setStatus(data);
    setStatusError(null);
  }, [bridge]);

  useEffect(() => {
    if (!bridge?.available) return;
    void refreshStatus();
    const timer = setInterval(() => {
      void refreshStatus();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [bridge, refreshStatus]);

  // очередь выбранного окна
  const refreshQueue = useCallback(async () => {
    if (!bridge?.available) return;
    const data = await bridge.busQueue(queueWindow);
    if (!data) {
      reportError('Не удалось прочитать очередь окна');
      return;
    }
    setQueueCards(Array.isArray(data.queue) ? data.queue : []);
    setHeldCards(Array.isArray(data.held) ? data.held : []);
  }, [bridge, queueWindow, reportError]);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  // модели — при смене окна/состояния
  useEffect(() => {
    if (!bridge?.available) return;
    void bridge.busModels().then((data) => {
      if (!data?.models) return;
      setModels(data.models);
      setModelDraft((prev) => {
        const next = { ...prev };
        for (const [win, entry] of Object.entries(data.models)) {
          if (next[win] == null) next[win] = entry.model;
        }
        return next;
      });
    });
  }, [bridge, status]);

  // ── действия над карточками ────────────────────────────────────────────

  const afterQueueChange = useCallback(async () => {
    await refreshQueue();
    await refreshStatus();
  }, [refreshQueue, refreshStatus]);

  const doHold = useCallback(
    async (windowId: string, name: string) => {
      if (!bridge) return;
      const result = await act(`hold:${windowId}/${name}`, () =>
        bridge.busHold(windowId, name),
      );
      if (!result) return;
      if (errOf(result)) {
        reportError(errOf(result));
        return;
      }
      setNotice(`Карточка ${name} отложена на паузу`);
      await afterQueueChange();
    },
    [act, afterQueueChange, bridge, reportError],
  );

  const doUnhold = useCallback(
    async (windowId: string, name: string) => {
      if (!bridge) return;
      const result = await act(`unhold:${windowId}/${name}`, () =>
        bridge.busUnhold(windowId, name),
      );
      if (!result) return;
      if (errOf(result)) {
        reportError(errOf(result));
        return;
      }
      setNotice(`Карточка ${name} вернулась в очередь`);
      await afterQueueChange();
    },
    [act, afterQueueChange, bridge, reportError],
  );

  const doRemove = useCallback(
    async (windowId: string, name: string) => {
      if (!bridge) return;
      const result = await act(`remove:${windowId}/${name}`, () =>
        bridge.busRemove(windowId, name),
      );
      if (!result) return;
      if (errOf(result)) {
        reportError(errOf(result));
        return;
      }
      setNotice(`Карточка ${name} удалена`);
      setSelectedCard(null);
      await afterQueueChange();
    },
    [act, afterQueueChange, bridge, reportError],
  );

  const doDispatch = useCallback(
    async (windowId: string, name: string) => {
      if (!bridge) return;
      const result = await act(`dispatch:${windowId}/${name}`, () =>
        bridge.busDispatch(windowId, name, 'dangerous'),
      );
      if (!result) return;
      const error = errOf(result);
      if (error) {
        reportError(error);
        return;
      }
      const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
      setNotice(stdout ? stdout.split('\n').slice(-3).join(' · ') : 'Карточка отправлена');
      await afterQueueChange();
    },
    [act, afterQueueChange, bridge, reportError],
  );

  const doViewCard = useCallback(
    async (windowId: string, name: string) => {
      if (!bridge) return;
      const card = await act(`view:${windowId}/${name}`, () =>
        bridge.busCard(windowId, name),
      );
      if (!card) return;
      if (errOf(card)) {
        reportError(errOf(card));
        return;
      }
      setCardView(card);
    },
    [act, bridge, reportError],
  );

  const doAddTask = useCallback(async () => {
    if (!bridge) return;
    const text = taskText.trim();
    if (!text) {
      reportError('Текст задачи пуст');
      return;
    }
    const result = await act('add', () => bridge.busAddTask(queueWindow, text));
    if (!result) return;
    if (errOf(result)) {
      reportError(errOf(result));
      return;
    }
    const name = typeof result.card === 'string' ? result.card : '';
    setTaskText('');
    setTaskFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setNotice(`Карточка ${name} добавлена в очередь ${queueWindow}`);
    await afterQueueChange();
  }, [act, afterQueueChange, bridge, queueWindow, reportError, taskText]);

  const doDispatchText = useCallback(async () => {
    if (!bridge) return;
    const text = dispatchText.trim();
    if (!text) {
      reportError('Текст пуст');
      return;
    }
    const result = await act(`dispatch-text:${queueWindow}`, () =>
      bridge.busDispatchText(queueWindow, text),
    );
    if (!result) return;
    setDispatchVerdict({ delivery: result.delivery, detail: result.detail });
    setDispatchText('');
  }, [act, bridge, dispatchText, queueWindow, reportError]);

  // ── дозор ───────────────────────────────────────────────────────────────

  const refreshWatchdog = useCallback(async () => {
    if (!bridge?.available) return;
    const state = await bridge.busWatchdogState();
    if (state) setWatchState(state);
  }, [bridge]);

  const refreshLog = useCallback(async () => {
    if (!bridge?.available) return;
    const data = await bridge.busLog(logName, 200, logFilter);
    if (data) setLog(data);
  }, [bridge, logFilter, logName]);

  const refreshCrashes = useCallback(async () => {
    if (!bridge?.available) return;
    const data = await bridge.busCrashes();
    if (data?.crashes) setCrashes(data.crashes);
  }, [bridge]);

  const refreshAudit = useCallback(async () => {
    if (!bridge?.available) return;
    const data = await bridge.busAudit(60);
    if (data?.entries) setAudit(data.entries);
  }, [bridge]);

  useEffect(() => {
    if (tab !== 'watchdog') return;
    void refreshWatchdog();
    void refreshLog();
    void refreshCrashes();
    void refreshAudit();
  }, [tab, refreshAudit, refreshCrashes, refreshLog, refreshWatchdog]);

  // ── здоровье ────────────────────────────────────────────────────────────

  const refreshHealth = useCallback(async () => {
    if (!bridge?.available) return;
    const [sent, age] = await Promise.all([bridge.busSentHealth(), bridge.busQueueAge()]);
    if (sent) setSentHealth(sent);
    if (age) setQueueAge(age);
  }, [bridge]);

  useEffect(() => {
    if (tab !== 'health') return;
    void refreshHealth();
  }, [tab, refreshHealth]);

  // ── ответы ──────────────────────────────────────────────────────────────

  const refreshReplies = useCallback(async () => {
    if (!bridge?.available) return;
    const data = await bridge.busOutbox();
    if (data?.replies) setReplies(data.replies);
  }, [bridge]);

  useEffect(() => {
    if (tab !== 'outbox') return;
    void refreshReplies();
  }, [tab, refreshReplies]);

  // ── хост ────────────────────────────────────────────────────────────────

  const refreshHost = useCallback(async () => {
    if (!bridge?.available) return;
    const [state, sessions] = await Promise.all([
      bridge.busHostState(),
      bridge.busSessions(),
    ]);
    if (state) setHostState(state);
    if (sessions?.sessions) setHostSessions(sessions.sessions);
  }, [bridge]);

  useEffect(() => {
    if (tab !== 'host') return;
    void refreshHost();
  }, [tab, refreshHost]);

  // ── подтверждения ───────────────────────────────────────────────────────

  const confirmText = useMemo(() => {
    if (!confirm) return null;
    switch (confirm.kind) {
      case 'remove':
        return {
          title: 'Удалить карточку?',
          body: `Карточка ${confirm.window}/${confirm.name} будет удалена из очереди безвозвратно.`,
          confirm: 'Удалить',
        };
      case 'dispatch':
        return {
          title: 'Отправить карточку в окно?',
          body: `Карточка ${confirm.window}/${confirm.name} уйдёт в окно. Если окно занято, шина вернёт её с LOCKED.`,
          confirm: 'Отправить',
        };
      case 'requeue':
        return {
          title: 'Вернуть потерянные карточки в очередь?',
          body: 'requeue-lost -Do вернёт карточки, потерянные при отправке. Очередь изменится.',
          confirm: 'Вернуть',
        };
      case 'clean':
        return {
          title: 'Завершить мёртвые отправки?',
          body: 'bus-clean -Execute завершит зависшие процессы отправки. Проверьте список до выполнения.',
          confirm: 'Выполнить',
        };
      case 'block':
        return {
          title: 'Заблокировать диспатч?',
          body: `Дозор перестанет отправлять карточки. Причина: ${confirm.message || 'не указана'}`,
          confirm: 'Заблокировать',
        };
      case 'watchdogStop':
        return {
          title: 'Остановить дозор?',
          body: 'Дозор перестанет обслуживать очередь и слать карточки в окна.',
          confirm: 'Остановить',
        };
      default:
        return null;
    }
  }, [confirm]);

  const runConfirmed = useCallback(async () => {
    if (!confirm || !bridge) return;
    const spec = confirm;
    setConfirm(null);
    if (spec.kind === 'remove') {
      await doRemove(spec.window, spec.name);
      return;
    }
    if (spec.kind === 'dispatch') {
      await doDispatch(spec.window, spec.name);
      return;
    }
    if (spec.kind === 'requeue') {
      const result = await act('requeue', () => bridge.busRequeueLost(true));
      if (!result) return;
      if (errOf(result)) {
        reportError(errOf(result));
        return;
      }
      setRequeue(result);
      setNotice('Потерянные карточки возвращены в очередь');
      await afterQueueChange();
      return;
    }
    if (spec.kind === 'clean') {
      const result = await act('clean', () => bridge.busClean(true));
      if (!result) return;
      if (errOf(result)) {
        reportError(errOf(result));
        return;
      }
      setClean(result);
      setNotice('Уборка выполнена');
      await afterQueueChange();
      return;
    }
    if (spec.kind === 'block') {
      const result = await act('policy', () => bridge.busSetPolicy(true, spec.message));
      if (!result) return;
      if (errOf(result)) {
        reportError(errOf(result));
        return;
      }
      setNotice('Диспатч заблокирован');
      await refreshStatus();
      return;
    }
    if (spec.kind === 'watchdogStop') {
      const result = await act('watchdog-stop', () => bridge.busWatchdogStop());
      if (!result) return;
      if (errOf(result)) {
        reportError(errOf(result));
        return;
      }
      setNotice('Дозор остановлен');
      await refreshWatchdog();
    }
  }, [act, afterQueueChange, bridge, confirm, doDispatch, doRemove, refreshStatus, refreshWatchdog, reportError]);

  // ── рендер ──────────────────────────────────────────────────────────────

  if (!bridgeReady) {
    return (
      <div className={styles.app}>
        <LoadingState>Подключение к десктоп-мосту…</LoadingState>
      </div>
    );
  }

  if (bridge && !bridge.available) {
    return (
      <div className={styles.app}>
        <TitleBar
          bridge={bridge}
          busDir={appInfo?.busDir ?? '—'}
          version={appInfo?.version ?? '—'}
          onError={reportError}
        />
        <div className={styles.body}>
          <GlassPanel className={styles.panel}>
            <ErrorState
              variant="full"
              title="Десктоп-мост недоступен"
              body="Страница открыта вне приложения: шина читается только через мост pywebview. Откройте приложение командой python -m tools.bus_desktop."
            />
          </GlassPanel>
        </div>
      </div>
    );
  }

  const windows = status?.windows ?? [];
  const policy: BusPolicy | undefined = status?.policy;
  const health: BusHealth | undefined = status?.health;

  return (
    <div className={styles.app}>
      <TitleBar
        bridge={bridge}
        busDir={appInfo?.busDir ?? '—'}
        version={appInfo?.version ?? '—'}
        onError={reportError}
      />
      <div className={styles.body}>
        {actionError ? (
          <p className={styles.errorText} role="alert" data-testid="bus-action-error">
            {actionError}
          </p>
        ) : null}
        {notice ? (
          <p className={styles.notice} role="status" data-testid="bus-notice">
            {notice}
          </p>
        ) : null}
        {statusError ? (
          <ErrorState
            variant="inline"
            title="Состояние шины недоступно"
            body={statusError}
            onRetry={() => void refreshStatus()}
          />
        ) : null}

        {/* ── дашборд окон ── */}
        <GlassPanel className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Окна шины</h2>
            <div className={styles.toolbar}>
              <span className={styles.pill}>обновление раз в 5 с</span>
              <button
                type="button"
                className={styles.miniBtn}
                onClick={() => void refreshStatus()}
              >
                Обновить
              </button>
            </div>
          </div>
          {windows.length > 0 ? (
            <WindowTable windows={windows} onPick={(win) => {
              setQueueWindow(win);
              setTab('queue');
            }} />
          ) : (
            <EmptyState
              variant="inline"
              title="Состояние окон не получено"
              body="status.json отсутствует или дозор ещё ни разу не отработал."
            />
          )}
        </GlassPanel>

        {/* ── вкладки ── */}
        <div className={styles.tabs} role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={styles.tab}
              data-active={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'queue' ? (
          <div className={styles.grid2}>
            <GlassPanel className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Очередь окна</h2>
                <div className={styles.toolbar}>
                  {WINDOW_IDS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={styles.miniBtn}
                      data-variant={queueWindow === id ? 'primary' : undefined}
                      onClick={() => setQueueWindow(id)}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              </div>

              {queueCards.length === 0 && heldCards.length === 0 ? (
                <EmptyState
                  variant="inline"
                  title="Очередь пуста"
                  body={`В окне ${queueWindow} нет карточек.`}
                />
              ) : (
                <div className={styles.list}>
                  {queueCards.map((card) => (
                    <CardRow
                      key={card.name}
                      card={card}
                      windowId={queueWindow}
                      held={false}
                      busy={busy}
                      onView={() => void doViewCard(queueWindow, card.name)}
                      onHold={() => void doHold(queueWindow, card.name)}
                      onUnhold={() => void doUnhold(queueWindow, card.name)}
                      onDispatch={() => setConfirm({ kind: 'dispatch', window: queueWindow, name: card.name })}
                      onRemove={() => setConfirm({ kind: 'remove', window: queueWindow, name: card.name })}
                    />
                  ))}
                  {heldCards.map((card) => (
                    <CardRow
                      key={`hold/${card.name}`}
                      card={card}
                      windowId={queueWindow}
                      held
                      busy={busy}
                      onView={() => void doViewCard(queueWindow, card.name)}
                      onHold={() => void doHold(queueWindow, card.name)}
                      onUnhold={() => void doUnhold(queueWindow, card.name)}
                      onDispatch={() => setConfirm({ kind: 'dispatch', window: queueWindow, name: card.name })}
                      onRemove={() => setConfirm({ kind: 'remove', window: queueWindow, name: card.name })}
                    />
                  ))}
                </div>
              )}
            </GlassPanel>

            <GlassPanel className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Новая задача</h2>
                <span className={styles.pill}>окно {queueWindow}</span>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="bus-task-text">
                  Текст карточки
                </label>
                <textarea
                  id="bus-task-text"
                  className={styles.textarea}
                  value={taskText}
                  placeholder="Что сделать окну…"
                  onChange={(event) => setTaskText(event.target.value)}
                />
              </div>
              <div className={styles.toolbar}>
                <input
                  ref={fileInputRef}
                  type="file"
                  className={styles.input}
                  accept=".md,.txt,.log,.json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) {
                      setTaskFile(null);
                      return;
                    }
                    void file.text().then((content) => {
                      setTaskText(content);
                      setTaskFile(file.name);
                    });
                  }}
                />
                {taskFile ? <span className={styles.pill}>{taskFile}</span> : null}
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy === 'add'}
                  onClick={() => void doAddTask()}
                >
                  Добавить в очередь
                </Button>
              </div>
              <p className={styles.hint}>
                Файл читается в окне и кладётся в очередь как обычная карточка. Пустая
                очередь и «карточка на паузе» — разные состояния: пауза видна отдельным
                списком.
              </p>
            </GlassPanel>
          </div>
        ) : null}

        {tab === 'watchdog' ? (
          <div className={styles.grid2}>
            <GlassPanel className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Дозор</h2>
                <div className={styles.toolbar}>
                  <button
                    type="button"
                    className={styles.miniBtn}
                    onClick={() => void refreshWatchdog()}
                  >
                    Обновить
                  </button>
                </div>
              </div>
              {watchState ? (
                <dl className={styles.kv}>
                  <dt>Состояние</dt>
                  <dd>
                    <span
                      className={styles.pill}
                      data-tone={watchState.running ? 'ok' : 'error'}
                    >
                      {watchState.running ? 'работает' : 'не работает'}
                    </span>
                  </dd>
                  <dt>PID</dt>
                  <dd className={styles.num}>{watchState.pid ?? '—'}</dd>
                  <dt>Начал работу</dt>
                  <dd>{watchState.startedAt || '—'}</dd>
                  <dt>Время работы</dt>
                  <dd>{ageLabel(watchState.uptimeSec != null ? Math.round(watchState.uptimeSec / 60) : null)}</dd>
                  <dt>Автозапуск</dt>
                  <dd>{watchState.autostart ? 'включён' : 'выключен'}</dd>
                  <dt>Снимок дозора</dt>
                  <dd>{watchState.generatedAt || '—'}</dd>
                </dl>
              ) : (
                <LoadingState>Опрос дозора…</LoadingState>
              )}
              <div className={styles.toolbar}>
                <Button
                  size="sm"
                  loading={busy === 'watchdog-start'}
                  onClick={() => {
                    void (async () => {
                      if (!bridge) return;
                      const result = await act('watchdog-start', () => bridge.busWatchdogStart());
                      if (!result) return;
                      if (errOf(result)) {
                        reportError(errOf(result));
                        return;
                      }
                      setNotice('Дозор запущен');
                      await refreshWatchdog();
                    })();
                  }}
                >
                  Запустить
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={!watchState?.running}
                  onClick={() => setConfirm({ kind: 'watchdogStop' })}
                >
                  Остановить
                </Button>
                <Button
                  size="sm"
                  loading={busy === 'watchdog-pass'}
                  onClick={() => {
                    void (async () => {
                      if (!bridge) return;
                      const result = await act('watchdog-pass', () => bridge.busWatchdogPassOnce());
                      if (!result) return;
                      if (errOf(result)) {
                        reportError(errOf(result));
                        return;
                      }
                      setNotice('Проход дозора выполнен');
                      await refreshStatus();
                    })();
                  }}
                >
                  Один проход
                </Button>
              </div>
            </GlassPanel>

            <GlassPanel className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Журнал</h2>
                <div className={styles.toolbar}>
                  <select
                    className={styles.select}
                    value={logName}
                    onChange={(event) => setLogName(event.target.value)}
                  >
                    <option value="watch.log">watch.log</option>
                    <option value="events.jsonl">events.jsonl (переходы)</option>
                    <option value="config-audit.jsonl">config-audit.jsonl</option>
                    <option value="model-guard.log">model-guard.log</option>
                    <option value="clean-bus.log">clean-bus.log</option>
                    <option value="watch-host.log">watch-host.log</option>
                  </select>
                  <input
                    className={styles.input}
                    placeholder="фильтр по подстроке"
                    value={logFilter}
                    onChange={(event) => setLogFilter(event.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.miniBtn}
                    onClick={() => void refreshLog()}
                  >
                    Обновить
                  </button>
                </div>
              </div>
              {log?.error ? (
                <ErrorState variant="inline" title="Журнал недоступен" body={log.error} />
              ) : log && log.lines.length > 0 ? (
                <pre className={styles.log} data-testid="bus-log">
                  {log.lines.join('\n')}
                </pre>
              ) : (
                <EmptyState
                  variant="inline"
                  title="Журнал пуст"
                  body="Под фильтром строк нет — либо журнал ещё не писался."
                />
              )}
            </GlassPanel>

            <GlassPanel className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Журналы аварийных парковок</h2>
                <button
                  type="button"
                  className={styles.miniBtn}
                  onClick={() => void refreshCrashes()}
                >
                  Обновить
                </button>
              </div>
              {crashes.length === 0 ? (
                <EmptyState
                  variant="inline"
                  title="Аварийных парковок нет"
                  body="Каталог logs\crash пуст."
                />
              ) : (
                <div className={styles.list}>
                  {crashes.map((crash) => (
                    <div key={crash.name} className={styles.listRow}>
                      <div className={styles.listMain}>
                        <span className={styles.listName}>{crash.name}</span>
                        <span className={styles.listMeta}>
                          {ageLabel(crash.ageMin)} · {bytesLabel(crash.size)}
                        </span>
                      </div>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.miniBtn}
                          onClick={() => {
                            void (async () => {
                              if (!bridge) return;
                              const data = await bridge.busCrash(crash.name);
                              if (!data) return;
                              if (errOf(data)) {
                                reportError(errOf(data));
                                return;
                              }
                              setCrashView({ name: data.name, text: data.text });
                            })();
                          }}
                        >
                          Текст
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </GlassPanel>

            <GlassPanel className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Правки конфигурации</h2>
                <button
                  type="button"
                  className={styles.miniBtn}
                  onClick={() => void refreshAudit()}
                >
                  Обновить
                </button>
              </div>
              {!audit || audit.length === 0 ? (
                <EmptyState
                  variant="inline"
                  title="Правок не зафиксировано"
                  body="Журнал config-audit.jsonl пуст."
                />
              ) : (
                <div className={styles.list}>
                  {audit.map((entry, index) => (
                    <div key={`${entry.ts}-${index}`} className={styles.listRow}>
                      <div className={styles.listMain}>
                        <span className={styles.listName}>{entry.event}</span>
                        <span className={styles.listMeta}>
                          {entry.ts} · {entry.file} {entry.detail}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </GlassPanel>
          </div>
        ) : null}

        {tab === 'policy' ? (
          <div className={styles.grid2}>
            <GlassPanel className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Стоп-кран диспатча</h2>
                <span
                  className={styles.pill}
                  data-tone={policy?.blocking ? 'error' : 'ok'}
                >
                  {policy?.blocking ? 'заблокировано' : 'отправка разрешена'}
                </span>
              </div>
              <dl className={styles.kv}>
                <dt>Источник</dt>
                <dd>{policy?.source ?? '—'}</dd>
                <dt>Причина</dt>
                <dd>{policy?.message || '—'}</dd>
                {policy?.error ? (
                  <>
                    <dt>Ошибка чтения</dt>
                    <dd className={styles.errorText}>{policy.error}</dd>
                  </>
                ) : null}
              </dl>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="bus-policy-message">
                  Причина блокировки
                </label>
                <input
                  id="bus-policy-message"
                  className={styles.input}
                  value={policyMessage}
                  placeholder="например: правка конфигурации шины"
                  onChange={(event) => setPolicyMessage(event.target.value)}
                />
              </div>
              <div className={styles.toolbar}>
                <Button
                  variant="danger"
                  size="sm"
                  loading={busy === 'policy'}
                  onClick={() =>
                    setConfirm({ kind: 'block', message: policyMessage.trim() })
                  }
                >
                  Заблокировать
                </Button>
                <Button
                  size="sm"
                  loading={busy === 'policy'}
                  onClick={() => {
                    void (async () => {
                      if (!bridge) return;
                      const result = await act('policy', () =>
                        bridge.busSetPolicy(false, ''),
                      );
                      if (!result) return;
                      if (errOf(result)) {
                        reportError(errOf(result));
                        return;
                      }
                      setPolicyMessage('');
                      setNotice('Блокировка снята');
                      await refreshStatus();
                    })();
                  }}
                >
                  Разблокировать
                </Button>
              </div>
            </GlassPanel>

            <GlassPanel className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Модели окон</h2>
                <div className={styles.toolbar}>
                  <Button
                    size="sm"
                    loading={busy === 'guard'}
                    onClick={() => {
                      void (async () => {
                        if (!bridge) return;
                        const result = await act('guard', () => bridge.busModelGuard());
                        if (!result) return;
                        if (errOf(result)) {
                          reportError(errOf(result));
                          return;
                        }
                        setNotice('model-guard отработал');
                      })();
                    }}
                  >
                    Запустить model-guard
                  </Button>
                </div>
              </div>
              <div className={styles.list}>
                {WINDOW_IDS.map((id) => {
                  const entry = models[id];
                  return (
                    <div key={id} className={styles.listRow}>
                      <div className={styles.listMain}>
                        <span className={styles.listName}>
                          {id} · {entry?.model ?? '—'}
                        </span>
                        <span className={styles.listMeta}>
                          {entry?.source === 'override' ? 'override' : 'по умолчанию'}
                          {entry?.error ? ` · ${entry.error}` : ''}
                        </span>
                      </div>
                      <div className={styles.rowActions}>
                        <input
                          className={styles.input}
                          value={modelDraft[id] ?? ''}
                          placeholder="CLI ID модели"
                          onChange={(event) =>
                            setModelDraft((prev) => ({ ...prev, [id]: event.target.value }))
                          }
                        />
                        <button
                          type="button"
                          className={styles.miniBtn}
                          disabled={busy === `model:${id}`}
                          onClick={() => {
                            void (async () => {
                              if (!bridge) return;
                              const result = await act(`model:${id}`, () =>
                                bridge.busSetModel(id, (modelDraft[id] ?? '').trim()),
                              );
                              if (!result) return;
                              if (errOf(result)) {
                                reportError(errOf(result));
                                return;
                              }
                              setNotice(`Модель окна ${id} сохранена`);
                              await refreshStatus();
                            })();
                          }}
                        >
                          Сохранить
                        </button>
                        <button
                          type="button"
                          className={styles.miniBtn}
                          disabled={busy === `model:${id}`}
                          onClick={() => {
                            void (async () => {
                              if (!bridge) return;
                              const result = await act(`model:${id}`, () =>
                                bridge.busSetModel(id, ''),
                              );
                              if (!result) return;
                              if (errOf(result)) {
                                reportError(errOf(result));
                                return;
                              }
                              setModelDraft((prev) => ({ ...prev, [id]: '' }));
                              setNotice(`Модель окна ${id} сброшена к умолчанию`);
                              await refreshStatus();
                            })();
                          }}
                        >
                          Сбросить
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassPanel>
          </div>
        ) : null}

        {tab === 'health' ? (
          <div className={styles.grid2}>
            <GlassPanel className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Леджер отправок</h2>
                <div className={styles.toolbar}>
                  <button
                    type="button"
                    className={styles.miniBtn}
                    onClick={() => void refreshHealth()}
                  >
                    Обновить
                  </button>
                </div>
              </div>
              {!health ? (
                <LoadingState>Чтение состояния леджера…</LoadingState>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Окно</th>
                        <th>sent\</th>
                        <th>архив</th>
                        <th>в status.json</th>
                        <th>Состояние</th>
                      </tr>
                    </thead>
                    <tbody>
                      {health.windows.map((row) => {
                        const badge = HEALTH_BADGE[row.state] ?? HEALTH_BADGE.ok;
                        return (
                          <tr key={row.window}>
                            <td>{row.window}</td>
                            <td className={styles.num}>{row.sent}</td>
                            <td className={styles.num}>{row.archive}</td>
                            <td className={styles.num}>{row.reported ?? '—'}</td>
                            <td>
                              <StatusBadge status={badge.status} label={badge.label} />
                              {row.detail ? (
                                <div className={styles.listMeta}>{row.detail}</div>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className={styles.hint}>
                Пустой sent\ после суточной ротации — это «пусто», а не потеря
                карточек: архив рядом показывает, куда они ушли. «Счётчик сломан»
                означает расхождение с status.json.
              </p>
            </GlassPanel>

            <GlassPanel className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Аудит отправок (sent-health)</h2>
                <button
                  type="button"
                  className={styles.miniBtn}
                  onClick={() => void refreshHealth()}
                >
                  Обновить
                </button>
              </div>
              {sentHealth?.error ? (
                <ErrorState variant="inline" title="Аудит не выполнен" body={sentHealth.error} />
              ) : sentHealth && sentHealth.windows.length > 0 ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Окно</th>
                        <th>sent</th>
                        <th>run</th>
                        <th>done</th>
                        <th>wait</th>
                        <th>lost</th>
                        <th>nolog</th>
                        <th>архив</th>
                        <th>старшая</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sentHealth.windows.map((row) => (
                        <tr key={row.window}>
                          <td>{row.window}</td>
                          <td className={styles.num}>{row.sent}</td>
                          <td className={styles.num}>{row.run}</td>
                          <td className={styles.num}>{row.done}</td>
                          <td className={styles.num}>{row.wait}</td>
                          <td className={styles.num}>{row.lost}</td>
                          <td className={styles.num}>{row.nolog}</td>
                          <td className={styles.num}>{row.archive}</td>
                          <td className={styles.muted}>{row.oldest}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  variant="inline"
                  title="Аудит не дал данных"
                  body="Скрипт отработал, но сводку по окнам не распознал."
                />
              )}
            </GlassPanel>

            <GlassPanel className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Возраст очередей (queue-age)</h2>
                <span className={styles.pill}>{queueAge?.rows.length ?? 0} строк</span>
              </div>
              {!queueAge ? (
                <LoadingState>Аудит очередей…</LoadingState>
              ) : queueAge.rows.length === 0 ? (
                <EmptyState
                  variant="inline"
                  title="Очереди пусты"
                  body="Ни одной карточки в очередях, отправках и ответах."
                />
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Где</th>
                        <th>Карточка</th>
                        <th>Возраст</th>
                        <th>Вердикт</th>
                        <th>Детали</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queueAge.rows.slice(0, 200).map((row, index) => (
                        <tr key={`${row.loc}/${row.name}/${index}`}>
                          <td>{row.loc}</td>
                          <td className={styles.listName}>{row.name}</td>
                          <td className={styles.num}>{row.age}</td>
                          <td>{row.verdict}</td>
                          <td className={styles.muted}>{row.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassPanel>

            <GlassPanel className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Потерянные карточки и уборка</h2>
                <div className={styles.toolbar}>
                  <Button
                    size="sm"
                    onClick={() => {
                      void (async () => {
                        if (!bridge) return;
                        const result = await act('requeue', () => bridge.busRequeueLost(false));
                        if (result) setRequeue(result);
                      })();
                    }}
                  >
                    Триаж потерянных
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setConfirm({ kind: 'requeue' })}
                  >
                    Вернуть в очередь
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      void (async () => {
                        if (!bridge) return;
                        const result = await act('clean', () => bridge.busClean(false));
                        if (result) setClean(result);
                      })();
                    }}
                  >
                    Уборка (проба)
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setConfirm({ kind: 'clean' })}
                  >
                    Уборка (выполнить)
                  </Button>
                </div>
              </div>
              {requeue ? (
                <dl className={styles.kv}>
                  <dt>Сводка</dt>
                  <dd>{requeue.summary || '—'}</dd>
                  {Object.entries(requeue.counts).map(([key, count]) => (
                    <>
                      <dt key={`${key}-k`}>{key}</dt>
                      <dd key={`${key}-v`} className={styles.num}>
                        {count}
                      </dd>
                    </>
                  ))}
                  {requeue.error ? (
                    <>
                      <dt>Ошибка</dt>
                      <dd className={styles.errorText}>{requeue.error}</dd>
                    </>
                  ) : null}
                </dl>
              ) : (
                <p className={styles.hint}>Триаж не запускался.</p>
              )}
              {clean ? (
                <>
                  <p className={styles.hint}>
                    {clean.applied ? 'Уборка выполнена.' : 'Проба уборки: ничего не менялось.'}{' '}
                    Мёртвых процессов: {clean.dead.length}.
                  </p>
                  {clean.dead.length > 0 ? (
                    <pre className={styles.log}>{clean.dead.join('\n')}</pre>
                  ) : null}
                  {clean.error ? <p className={styles.errorText}>{clean.error}</p> : null}
                </>
              ) : null}
            </GlassPanel>
          </div>
        ) : null}

        {tab === 'outbox' ? (
          <GlassPanel className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Ответы окон</h2>
              <div className={styles.toolbar}>
                <button
                  type="button"
                  className={styles.miniBtn}
                  onClick={() => void refreshReplies()}
                >
                  Обновить
                </button>
                <Button
                  size="sm"
                  onClick={() => {
                    void (async () => {
                      if (!bridge) return;
                      const result = await act('export', () => bridge.busExportOutbox());
                      if (!result) return;
                      setExportText(result);
                      if (!result.ok) {
                        reportError(errOf(result) || 'Экспорт не удался');
                      }
                    })();
                  }}
                >
                  Собрать всё
                </Button>
                {exportText?.ok ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      void (async () => {
                        if (!bridge || !exportText) return;
                        const path = await bridge.saveText('bus-outbox.md', exportText.text);
                        if (!path) {
                          reportError('Диалог сохранения недоступен или отменён');
                          return;
                        }
                        setNotice(`Ответы сохранены: ${path}`);
                      })();
                    }}
                  >
                    Сохранить в файл
                  </Button>
                ) : null}
              </div>
            </div>
            {!replies ? (
              <LoadingState>Чтение ответов…</LoadingState>
            ) : replies.length === 0 ? (
              <EmptyState
                variant="inline"
                title="Ответов нет"
                body="Каталоги outbox\W* пусты."
              />
            ) : (
              <div className={styles.list}>
                {replies.map((reply) => (
                  <div
                    key={`${reply.window}/${reply.name}`}
                    className={styles.listRow}
                  >
                    <div className={styles.listMain}>
                      <span className={styles.listName}>
                        {reply.window} · {reply.name}
                      </span>
                      <span className={styles.listMeta}>
                        {reply.kind} · {ageLabel(reply.ageMin)} · {bytesLabel(reply.size)}
                        {reply.task ? ` · задача ${reply.task}` : ''}
                      </span>
                    </div>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.miniBtn}
                        onClick={() => {
                          void (async () => {
                            if (!bridge) return;
                            const data = await bridge.busReply(reply.window, reply.name);
                            if (!data) return;
                            if (errOf(data)) {
                              reportError(errOf(data));
                              return;
                            }
                            setReplyView(data);
                          })();
                        }}
                      >
                        Текст
                      </button>
                    </div>
                  </div>
                ))}
                </div>
              )}

              <div className={styles.listRow}>
                <input
                  className={styles.dispatchInput}
                  aria-label={`Dispatch brief for ${queueWindow}`}
                  value={dispatchText}
                  placeholder="Текст для окна…"
                  onChange={(event) => setDispatchText(event.target.value)}
                />
                <button
                  type="button"
                  className={styles.dispatchBtn}
                  disabled={busy !== null}
                  onClick={() => void doDispatchText()}
                >
                  Dispatch to {queueWindow}
                </button>
                {dispatchVerdict ? (
                  <>
                    <span
                      className={`${styles.dispatchVerdict} ${dispatchVerdict.delivery === 'verified' ? styles.verified : styles.failed}`}
                    >
                      {dispatchVerdict.delivery}
                    </span>
                    <span className={styles.listMeta}>{dispatchVerdict.detail}</span>
                  </>
                ) : null}
              </div>
            </GlassPanel>
        ) : null}

        {tab === 'host' ? (
          <div className={styles.grid2}>
            <GlassPanel className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Хост AI-2</h2>
                <div className={styles.toolbar}>
                  <button
                    type="button"
                    className={styles.miniBtn}
                    onClick={() => void refreshHost()}
                  >
                    Обновить
                  </button>
                  <Button
                    size="sm"
                    onClick={() => {
                      void (async () => {
                        if (!bridge || !hostState) return;
                        const ok = await bridge.openBrowser(`${hostState.url}/home`);
                        if (!ok) reportError('Не удалось открыть браузер');
                      })();
                    }}
                  >
                    Открыть /home в браузере
                  </Button>
                </div>
              </div>
              {!hostState ? (
                <LoadingState>Проверка хоста…</LoadingState>
              ) : (
                <dl className={styles.kv}>
                  <dt>Адрес</dt>
                  <dd>{hostState.url}</dd>
                  <dt>/healthz</dt>
                  <dd>
                    <span
                      className={styles.pill}
                      data-tone={hostState.available ? 'ok' : 'error'}
                    >
                      {hostState.available ? 'отвечает' : 'недоступен'}
                    </span>
                  </dd>
                  <dt>/home</dt>
                  <dd>
                    <span
                      className={styles.pill}
                      data-tone={hostState.home.reachable ? 'ok' : 'error'}
                    >
                      {hostState.home.reachable
                        ? `отвечает (${hostState.home.status ?? '—'})`
                        : hostState.home.error || 'недоступен'}
                    </span>
                  </dd>
                </dl>
              )}
            </GlassPanel>

            <GlassPanel className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Сессии шины на хосте</h2>
                <span className={styles.pill}>{hostSessions?.length ?? 0}</span>
              </div>
              {!hostSessions ? (
                <LoadingState>Чтение сессий…</LoadingState>
              ) : hostSessions.length === 0 ? (
                <EmptyState
                  variant="inline"
                  title="Сессий нет"
                  body="Хост не вернул ни одной сессии шины."
                />
              ) : (
                <pre className={styles.log}>{JSON.stringify(hostSessions, null, 2)}</pre>
              )}
            </GlassPanel>

            <GlassPanel className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Обзор шины на хосте</h2>
                <button
                  type="button"
                  className={styles.miniBtn}
                  onClick={() => {
                    void (async () => {
                      if (!bridge) return;
                      const data = await bridge.busOverview(20);
                      if (!data) return;
                      if (errOf(data)) {
                        reportError(errOf(data));
                        return;
                      }
                      setHostOverview(data.overview);
                    })();
                  }}
                >
                  Обновить
                </button>
              </div>
              {!hostOverview ? (
                <EmptyState
                  variant="inline"
                  title="Обзор не загружен"
                  body="Нажмите «Обновить», чтобы взять overview с хоста."
                />
              ) : (
                <pre className={styles.log}>{JSON.stringify(hostOverview, null, 2)}</pre>
              )}
            </GlassPanel>

            <GlassPanel className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Делегация</h2>
                <div className={styles.toolbar}>
                  <input
                    className={styles.input}
                    placeholder="идентификатор делегации"
                    value={delegationId}
                    onChange={(event) => setDelegationId(event.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.miniBtn}
                    onClick={() => {
                      void (async () => {
                        if (!bridge || !delegationId.trim()) return;
                        const data = await bridge.busDelegation(delegationId.trim());
                        if (!data) return;
                        if (errOf(data)) {
                          reportError(errOf(data));
                          setDelegation(null);
                          return;
                        }
                        setDelegation(data.delegation);
                      })();
                    }}
                  >
                    Найти
                  </button>
                </div>
              </div>
              {!delegation ? (
                <p className={styles.hint}>
                  Делегация ищется по идентификатору, который вернул хост.
                </p>
              ) : (
                <pre className={styles.log}>{JSON.stringify(delegation, null, 2)}</pre>
              )}
            </GlassPanel>
          </div>
        ) : null}
      </div>

      {/* ── модальные окна ── */}
      <Modal
        open={cardView != null}
        onClose={() => setCardView(null)}
        title={cardView ? `${cardView.window} · ${cardView.name}` : ''}
        footer={
          <Button size="sm" onClick={() => setCardView(null)}>
            Закрыть
          </Button>
        }
      >
        <pre className={styles.textBox}>{cardView?.text ?? ''}</pre>
      </Modal>

      <Modal
        open={replyView != null}
        onClose={() => setReplyView(null)}
        title={replyView ? `${replyView.window} · ${replyView.name}` : ''}
        footer={
          <Button size="sm" onClick={() => setReplyView(null)}>
            Закрыть
          </Button>
        }
      >
        <pre className={styles.textBox}>{replyView?.text ?? ''}</pre>
      </Modal>

      <Modal
        open={crashView != null}
        onClose={() => setCrashView(null)}
        title={crashView?.name ?? ''}
        footer={
          <Button size="sm" onClick={() => setCrashView(null)}>
            Закрыть
          </Button>
        }
      >
        <pre className={styles.textBox}>{crashView?.text ?? ''}</pre>
      </Modal>

      <Modal
        open={exportText?.ok === true}
        onClose={() => setExportText(null)}
        title={`Экспорт ответов (${exportText?.count ?? 0})`}
        footer={
          <Button size="sm" onClick={() => setExportText(null)}>
            Закрыть
          </Button>
        }
      >
        <pre className={styles.textBox}>{exportText?.text ?? ''}</pre>
      </Modal>

      <Modal
        open={confirmText != null}
        onClose={() => setConfirm(null)}
        title={confirmText?.title ?? ''}
        footer={
          <>
            <Button size="sm" onClick={() => setConfirm(null)}>
              Отмена
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={busy !== null}
              onClick={() => void runConfirmed()}
            >
              {confirmText?.confirm ?? 'Подтвердить'}
            </Button>
          </>
        }
      >
        <p className={styles.hint}>{confirmText?.body}</p>
      </Modal>
    </div>
  );
}

export default BusDesktopScreen;
