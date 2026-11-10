'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Button, EmptyState, ErrorState, GlassPanel, LoadingState, StatusBadge,
  type NexusStatus,
} from '@nexus/ui';
import type { BusDelegation, BusOverview, BusSession, BusWindowState } from '../../integrations/ai2/contracts/bus';
import { isAi2ApiError } from '../../integrations/ai2/api/errors';
import { getDataSource, useDataSource } from '../data-source';
import { runWhileDocumentVisible } from '../visible-interval';
import { SessionList } from './copilot-widgets';
import styles from './screens.module.css';

/**
 * XIV W3 — «Окна и шина» (вкладка Runtime): вся визуальная и функциональная
 * часть шины окон в одном месте — таблица окон W1–W5, сессии с делегациями,
 * последние ответы, живая лента дозора и форма отправки.
 * Источники — только /v1/bus/* seams (overview + sessions + delegations);
 * каждая панель деградирует по своему seam'у: status 'unknown' от хоста —
 * честный «нет данных у хоста», отсутствие seam'а — «недоступно», не ошибка.
 * Поле задачи и режим — общие для формы и кнопок «Отправить окну» в строках
 * сессий: один текст, одна делегация на отправку.
 */

const POLL_MS = 15_000;
const FALLBACK_WINDOWS = ['W1', 'W2', 'W3', 'W4', 'W5'];

const STATE_BADGE: Record<BusWindowState, { status: NexusStatus; label: string }> = {
  working: { status: 'executing', label: 'РАБОТАЕТ' },
  long: { status: 'warning', label: 'ДОЛГО' },
  waiting: { status: 'waiting', label: 'ЖДЁТ' },
  idle: { status: 'offline', label: 'СВОБОДНА' },
};

const DELEGATION_LABEL: Record<BusDelegation['state'], string> = {
  queued: 'в очереди на отправку',
  sent: 'отправлено окну',
  answered: 'окно ответило',
  locked: 'окно занято (session_locked)',
  failed: 'отправка не удалась',
};

const MODES = [
  { id: 'agent', label: 'Агент' },
  { id: 'ask', label: 'Спросить' },
  { id: 'plan', label: 'План' },
] as const;

type SessionSlice =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; value: BusSession[] };

function fmtEpoch(epochS: number | null): string {
  return epochS == null
    ? '—'
    : new Date(epochS * 1000).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });
}

function ageLabel(min: number | null): string {
  if (min == null) return '—';
  if (min >= 60) return `${Math.floor(min / 60)} ч ${min % 60} мин`;
  return `${min} мин`;
}

export function BusTab() {
  const ds = useDataSource();
  const bus = ds.bus;
  const [overview, setOverview] = useState<BusOverview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [sessions, setSessions] = useState<SessionSlice>({ state: 'loading' });
  const [delegations, setDelegations] = useState<Record<string, BusDelegation>>({});

  // Живая лента: опрос каждые POLL_MS; seam'ы, которых нет, не опрашиваются.
  // Сессии читаются тем же тиком — «Обновить ↻» и делегация обновляют всё.
  useEffect(() => {
    let live = true;
    const load = () => {
      if (bus?.overview != null) {
        bus.overview()
          .then((o) => { if (live) { setOverview(o); setLoadFailed(false); } })
          .catch(() => { if (live) setLoadFailed(true); });
      }
      if (bus?.listSessions != null) {
        bus.listSessions()
          .then((rows) => { if (live) setSessions({ state: 'ready', value: rows }); })
          .catch(() => { if (live) setSessions({ state: 'failed' }); });
      }
    };
    load();
    const stopPolling = runWhileDocumentVisible(load, POLL_MS);
    return () => { live = false; stopPolling(); };
  }, [bus, refreshTick]);

  const [to, setTo] = useState(FALLBACK_WINDOWS[0]);
  const [task, setTask] = useState('');
  const [mode, setMode] = useState<(typeof MODES)[number]['id']>('agent');
  const [sending, setSending] = useState(false);
  const [sentResult, setSentResult] = useState<BusDelegation | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const delegationTimers = useRef(new Set<number>());

  useEffect(() => () => {
    for (const timer of delegationTimers.current) window.clearTimeout(timer);
    delegationTimers.current.clear();
  }, []);

  // На проводе только {window, task} — режим доставляется первой строкой
  // файла задачи (контракт делегации не имеет поля mode).
  const modePrefix = useCallback(
    (text: string) => `[режим: ${MODES.find((m) => m.id === mode)?.label ?? mode}]\n\n${text}`,
    [mode],
  );

  const submit = useCallback(async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = task.trim();
    if (!text || bus?.delegateTask == null || sending) return;
    setSending(true);
    setSendError(null);
    setSentResult(null);
    try {
      const d = await bus.delegateTask({ window: to, task: modePrefix(text) });
      setSentResult(d);
      setTask('');
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Отправка не удалась.');
    } finally {
      setSending(false);
    }
  }, [bus, modePrefix, sending, task, to]);

  /** «Отправить окну» на строке сессии — то же поле задачи и режим, что у
   *  формы; делегация ложится DelegationChip на строку + одно обновление
   *  через 4 с (хост успевает переложить inbox→sent). */
  const sendTo = useCallback(async (s: BusSession) => {
    const text = task.trim();
    if (text === '') { setSendError('Введите текст задачи для окна — пустую делегацию не отправляем.'); return; }
    if (bus?.delegateTask == null || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const d = await bus.delegateTask({ window: s.window, task: modePrefix(text) });
      setDelegations((m) => ({ ...m, [s.window]: d }));
      const timer = window.setTimeout(() => {
        delegationTimers.current.delete(timer);
        Promise.resolve(bus.getDelegation?.(d.id))
          .then((next) => { if (next != null) setDelegations((m) => ({ ...m, [s.window]: next })); })
          .catch(() => { /* остаётся последнее известное состояние */ });
      }, 4000);
      delegationTimers.current.add(timer);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setSendError(isAi2ApiError(err) ? err.message : 'Не удалось отправить задачу окну.');
    } finally {
      setSending(false);
    }
  }, [bus, modePrefix, sending, task]);

  const windowOptions = useMemo(() => {
    const ids = overview?.windows.map((w) => w.window) ?? [];
    return ids.length > 0 ? ids : FALLBACK_WINDOWS;
  }, [overview?.windows]);

  const lastAnswers = useMemo(
    () => (overview?.windows ?? [])
      .filter((w) => w.lastAnswerAt != null)
      .sort((a, b) => (b.lastAnswerAt ?? 0) - (a.lastAnswerAt ?? 0)),
    [overview?.windows],
  );

  if (bus == null) {
    return (
      <GlassPanel className={styles.panel} data-state="unavailable" data-testid="tab-bus">
        <h3 className={styles.panelTitle}>Окна и шина</h3>
        <EmptyState
          variant="inline"
          title="Шина окон недоступна — источник данных не предоставляет seam /v1/bus."
        />
      </GlassPanel>
    );
  }

  // Обзорная часть (таблица/ответы/дозор) живёт на seam overview; сессии и
  // отправка — на своих seam'ах: панели деградируют независимо.
  const overviewState = bus.overview == null ? 'unavailable'
    : loadFailed ? 'error'
    : overview == null ? 'loading'
    : overview.status !== 'ok' ? 'empty' : 'ready';
  const sessionsState = bus.listSessions == null ? 'unavailable'
    : sessions.state === 'ready' ? (sessions.value.length > 0 ? 'ready' : 'empty')
    : sessions.state === 'failed' ? 'error' : 'loading';
  const state = overviewState === 'ready' || sessionsState === 'ready' ? 'ready' : overviewState;

  return (
    <div className={styles.panelStack} data-state={state} data-testid="tab-bus">
      {overviewState === 'unavailable' && (
        <GlassPanel className={styles.panel} data-state="unavailable" data-testid="bus-overview-missing">
          <h3 className={styles.panelTitle}>Окна W1–W5</h3>
          <EmptyState
            variant="inline"
            title="Обзор шины недоступен — seam /v1/bus/overview у источника отсутствует."
          />
        </GlassPanel>
      )}
      {overviewState === 'loading' && <LoadingState>Загружаю обзор шины…</LoadingState>}
      {overviewState === 'error' && (
        <ErrorState
          variant="inline"
          title="Не удалось загрузить обзор шины."
          onRetry={() => setRefreshTick((t) => t + 1)}
          retryLabel="Повторить"
        />
      )}
      {overviewState === 'empty' && (
        <EmptyState
          variant="inline"
          title="Нет данных у хоста — каталог шины не настроен (AI2_NEXUS_BUS)."
        />
      )}

      {overviewState === 'ready' && (
        <>
          <GlassPanel className={styles.panel} data-testid="bus-windows">
            <div className={styles.panelHead}>
              <h3 className={styles.panelTitle}>Окна W1–W5</h3>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => setRefreshTick((t) => t + 1)}
                aria-label="Обновить обзор шины"
              >
                Обновить ↻
              </button>
            </div>
            <table className={styles.busTable}>
              <thead>
                <tr>
                  <th>Окно</th><th>Состояние</th><th>Очередь</th><th>Отправлено</th>
                  <th>Ответов</th><th>Текущая задача</th><th>Возраст отправки</th><th>Последний ответ</th>
                </tr>
              </thead>
              <tbody>
                {overview!.windows.map((w) => {
                  const badge = STATE_BADGE[w.state as BusWindowState];
                  return (
                    <tr key={w.window} data-testid={`bus-window-${w.window}`}>
                      <td>{w.window}</td>
                      <td>
                        {badge != null
                          ? <StatusBadge {...badge} />
                          : <span>{w.state}</span>}
                      </td>
                      <td>{w.queue}</td>
                      <td>{w.sent}</td>
                      <td>{w.outbox}</td>
                      <td>{w.currentTask ?? '—'}</td>
                      <td>{ageLabel(w.sendAgeMin)}</td>
                      <td>{fmtEpoch(w.lastAnswerAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </GlassPanel>

          <GlassPanel className={styles.panel} data-testid="bus-answers">
            <h3 className={styles.panelTitle}>Последние ответы</h3>
            {lastAnswers.length === 0 ? (
              <EmptyState variant="inline" title="Ответов пока нет — outbox окон пуст." />
            ) : (
              <ul className={styles.rows}>
                {lastAnswers.map((w) => (
                  <li key={w.window} className={styles.row}>
                    <span className={styles.rowLabel}>{w.window}</span>
                    <span className={styles.rowMeta}>{fmtEpoch(w.lastAnswerAt)}</span>
                    <span className={styles.rowMeta}>{w.outbox} ответов</span>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>

          <GlassPanel className={styles.panel} data-testid="bus-watch">
            <h3 className={styles.panelTitle}>Дозор — события шины</h3>
            {/* Дозор — локальный процесс на машине хоста (watch.ps1); веб не
                запускает процессы — показываем прямую команду честно. */}
            <p className={styles.feedNote}>
              Запуск на машине хоста: <code>bus</code> в PowerShell · обзор без диспетча — <code>bus mon</code> · стоп — <code>bus stop</code>
            </p>
            {overview!.watch.length === 0 ? (
              <EmptyState variant="inline" title="Журнал дозора пуст или не читается." />
            ) : (
              <ul className={styles.rows}>
                {overview!.watch.map((e, i) => (
                  <li key={`${e.time ?? 'x'}-${i}`} className={styles.row}>
                    <span className={styles.rowMeta}>{e.time ?? '—'}</span>
                    <span className={styles.rowLabel}>{e.window ?? '·'}</span>
                    <span className={styles.rowText}>{e.event}{e.file != null ? ` · ${e.file}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>
        </>
      )}

      {/* XI W3 — «Окна и сессии»: SessionList из /v1/bus/sessions +
          делегации с DelegationChip по состоянию (queued→sent→answered).
          Задача и режим — общие с формой «Отправить окну» ниже. */}
      <GlassPanel className={styles.panel} data-state={sessionsState} data-testid="bus-sessions">
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>Окна и сессии</h3>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => setRefreshTick((t) => t + 1)}
            aria-label="Обновить список сессий"
          >
            Обновить ↻
          </button>
        </div>
        {sessionsState === 'unavailable' && (
          <EmptyState variant="inline" title="Сессии недоступны — seam /v1/bus/sessions у источника отсутствует." />
        )}
        {sessionsState === 'loading' && <p className={styles.emptyHint}>Читаю сессии шины…</p>}
        {sessionsState === 'error' && (
          <p className={styles.emptyHint}>
            Нет данных — шина не ответила.{' '}
            <button type="button" className={styles.linkBtn} onClick={() => setRefreshTick((t) => t + 1)}>Повторить</button>
          </p>
        )}
        {sessions.state === 'ready' && (
          <SessionList
            sessions={sessions.value}
            onSend={bus.delegateTask != null ? sendTo : undefined}
            delegations={delegations}
            onRetryDelegation={(d) => {
              const target = sessions.value.find((s) => s.window === d.to);
              if (target != null) void sendTo(target);
            }}
            sendDisabled={sending || bus.delegateTask == null}
          />
        )}
      </GlassPanel>

      <GlassPanel className={styles.panel} data-testid="bus-send">
        <h3 className={styles.panelTitle}>Отправить окну</h3>
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.formRow}>
            <label className={styles.formLabel} htmlFor="bus-to">Окно</label>
            <select
              id="bus-to"
              className={styles.select}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={sending || bus.delegateTask == null}
            >
              {windowOptions.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
            <label className={styles.formLabel} htmlFor="bus-mode">Режим</label>
            <select
              id="bus-mode"
              className={styles.select}
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              disabled={sending || bus.delegateTask == null}
            >
              {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <label className={styles.visuallyHidden} htmlFor="bus-task">Текст задачи для окна</label>
          <textarea
            id="bus-task"
            className={styles.textarea}
            rows={3}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Текст задачи для окна — общий для формы и кнопок «Отправить окну» в сессиях выше…"
            disabled={sending || bus.delegateTask == null}
          />
          <div className={styles.formRow}>
            <Button type="submit" disabled={!task.trim() || sending || bus.delegateTask == null}>
              {sending ? 'Отправляю…' : 'Отправить'}
            </Button>
            <span className={styles.emptyHint}>Режим уходит первой строкой файла задачи — поля mode у делегации нет.</span>
          </div>
        </form>
        {sentResult != null && (
          <p className={styles.emptyHint} role="status" data-testid="bus-send-result">
            {sentResult.id} → {sentResult.to}: {DELEGATION_LABEL[sentResult.state] ?? sentResult.state}
            {sentResult.error != null ? ` · ${sentResult.error}` : ''}
          </p>
        )}
        {sendError != null && (
          <ErrorState variant="inline" title={sendError} />
        )}
      </GlassPanel>
    </div>
  );
}
