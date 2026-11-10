'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorState, GlassPanel } from '@nexus/ui';
import type { SdkForkResult, SdkRunHandle, SdkSession, SdkSessionUsage } from '../../integrations/ai2/contracts/sdk';
import { useDataSource } from '../data-source';
import styles from './home.module.css';

/**
 * XV W3 — «Агенты и сессии»: список сессий агента с фильтрами хоста
 * (assistant/status/limit), возобновление (POST /v1/sdk/runs {task,resume}),
 * ветвление от сообщения (POST …/fork), переименование и архив (PATCH),
 * учёт сессии — токены/стоимость (GET …/sessions/{id}/usage, задача W1 23)
 * и связанные данные прогона: открытые подтверждения + делегации.
 *
 * Все данные — только от хоста:
 *  - seam отсутствует → «нет данных у источника»;
 *  - 503 без AI2_SDK_ENABLED / сбой → «хост не ответил» + verbatim-причина;
 *  - пустой список → «сессий нет», заглушек не рисуем;
 *  - messageCount/lastActivityAt/суммы === null → «—» (SDK их не отдал);
 *  - фильтры уходят в хост (Query), а не отсекаются на клиенте.
 *
 * NQ-092 (fixed): исход действия (run/fork) привязан к id сессии и
 * рендерится только в её строке — раньше бейдж дублировался во всех.
 */

const STATUS_LABEL: Record<string, string> = {
  busy: 'занята',
  idle: 'свободна',
};

const FORK_STATE_LABEL: Record<string, string> = {
  pending: 'ожидает связи',
  linked: 'связана',
  failed: 'не удалась',
};

const LIMITS = [20, 50, 100] as const;

function fmtMs(ms: number | null): string {
  if (ms == null) return '—';
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function fmtInt(n: number | null): string {
  return n == null ? '—' : n.toLocaleString('ru-RU');
}

function fmtUsd(n: number | null): string {
  if (n == null) return '—';
  return `${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;
}

type LoadState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; value: SdkSession[] };

type UsageState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; value: SdkSessionUsage };

type ActionKind = 'resume' | 'fork' | 'rename';

/** Исход действия — всегда с id сессии-владельца (NQ-092). */
interface ActionOutcome {
  sessionId: string;
  run?: SdkRunHandle;
  fork?: SdkForkResult;
}

/**
 * Связанные данные прогона: открытые подтверждения (GET
 * /v1/sdk/runs/{id}/confirmations) и делегации (GET /v1/sdk/delegations
 * ?parent_run_id=). Оба seam'а nullable: нет обоих — строки нет.
 */
function RunLinks({ runId }: { runId: string }) {
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const [st, setSt] = useState<
    | { state: 'loading' }
    | { state: 'ready'; confirmations: number | null; delegations: number | null }
    | { state: 'error'; message: string }
  >({ state: 'loading' });

  useEffect(() => {
    const conf = ds.listToolConfirmations;
    const del = ds.sdkDelegations?.list;
    if (conf == null && del == null) {
      setSt({ state: 'ready', confirmations: null, delegations: null });
      return;
    }
    let alive = true;
    Promise.all([
      conf != null ? conf(runId).then((rows) => rows.length) : Promise.resolve(null),
      del != null ? del(runId).then((rows) => rows.length) : Promise.resolve(null),
    ])
      .then(([confirmations, delegations]) => {
        if (alive) setSt({ state: 'ready', confirmations, delegations });
      })
      .catch((e) => {
        if (alive) setSt({ state: 'error', message: e instanceof Error ? e.message : 'Хост не ответил.' });
      });
    return () => { alive = false; };
  }, [ds, runId]);

  if (st.state === 'loading') {
    return <small className={styles.sessionResult}>Читаю связанные данные…</small>;
  }
  if (st.state === 'error') {
    return (
      <ErrorState variant="inline" title="Подтверждения и делегации недоступны" body={st.message} />
    );
  }
  if (st.confirmations == null && st.delegations == null) return null;
  return (
    <small className={styles.sessionResult} data-testid="run-links">
      открытых подтверждений: {fmtInt(st.confirmations)} · делегаций: {fmtInt(st.delegations)}
    </small>
  );
}

export function AgentSessionsPanel() {
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const seam = ds.sdkSessions;
  const [showArchived, setShowArchived] = useState(false);
  const [assistantFilter, setAssistantFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [limit, setLimit] = useState<number>(50);
  const [sessions, setSessions] = useState<LoadState>({ state: 'loading' });
  const [reloadTick, setReloadTick] = useState(0);
  // Одна раскрытая форма за раз: {id, kind}. Поля ввода — verbatim.
  const [open, setOpen] = useState<{ id: string; kind: ActionKind } | null>(null);
  const [draft, setDraft] = useState('');
  const [atMessage, setAtMessage] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  // Раскрытый учёт сессии (одна строка) и его состояние — по id.
  const [usageOpen, setUsageOpen] = useState<string | null>(null);
  const [usage, setUsage] = useState<Record<string, UsageState>>({});
  // Ключ идемпотентности ветки — генерируется при открытии формы, повторный
  // POST с тем же key вернёт существующую ветку (контракт).
  const [forkKey, setForkKey] = useState('');

  const load = useCallback(() => {
    if (seam == null) return;
    // Не мигаем: сохранённый список остаётся, пока идёт перезапрос (task 93).
    setSessions((s) => (s.state === 'ready' ? s : { state: 'loading' }));
    const assistant = assistantFilter.trim();
    seam.list({
      archived: showArchived,
      assistant: assistant === '' ? undefined : assistant,
      status: statusFilter === '' ? undefined : statusFilter,
      limit,
    })
      .then((rows) => setSessions({ state: 'ready', value: rows }))
      .catch((e) => setSessions({
        state: 'error',
        message: e instanceof Error ? e.message : 'Хост не ответил.',
      }));
  }, [seam, showArchived, assistantFilter, statusFilter, limit]);

  useEffect(() => { load(); }, [load, reloadTick]);

  const toggleForm = (id: string, kind: ActionKind, currentTitle: string | null) => {
    if (open?.id === id && open.kind === kind) { setOpen(null); return; }
    setOpen({ id, kind });
    setActionError(null);
    setOutcome(null);
    setAtMessage('');
    setDraft(kind === 'rename' ? (currentTitle ?? '') : '');
    if (kind === 'fork') setForkKey(`fork-${Date.now().toString(36)}`);
  };

  const toggleUsage = (id: string) => {
    if (usageOpen === id) { setUsageOpen(null); return; }
    setUsageOpen(id);
    if (seam == null || usage[id]?.state === 'ready') return;
    setUsage((u) => ({ ...u, [id]: { state: 'loading' } }));
    seam.usage(id)
      .then((value) => setUsage((u) => ({ ...u, [id]: { state: 'ready', value } })))
      .catch((e) => setUsage((u) => ({
        ...u,
        [id]: { state: 'error', message: e instanceof Error ? e.message : 'Хост не ответил.' },
      })));
  };

  const doPatch = async (id: string, input: { title?: string; archived?: boolean }) => {
    if (seam == null || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await seam.patch(id, input);
      setOpen(null);
      setReloadTick((t) => t + 1);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Хост не ответил.');
    } finally {
      setActionBusy(false);
    }
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (seam == null || open == null || actionBusy) return;
    const text = draft.trim();
    const sessionId = open.id;
    setActionBusy(true);
    setActionError(null);
    setOutcome(null);
    try {
      if (open.kind === 'resume') {
        if (text === '') return;
        const run = await seam.run({ task: text, resume: sessionId });
        setOutcome({ sessionId, run });
      } else if (open.kind === 'fork') {
        if (text === '') return;
        const fork = await seam.fork(sessionId, {
          task: text,
          atMessage: atMessage.trim() === '' ? undefined : atMessage.trim(),
          key: forkKey,
        });
        setOutcome({ sessionId, fork });
      } else {
        if (text === '') return;
        await seam.patch(sessionId, { title: text });
        setOpen(null);
        setReloadTick((t) => t + 1);
      }
      if (open.kind !== 'rename') setReloadTick((t) => t + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Хост не ответил.');
    } finally {
      setActionBusy(false);
    }
  };

  if (seam == null) {
    return (
      <GlassPanel className={styles.railPanel} data-state="unavailable" data-testid="agent-sessions">
        <h2>Сессии агента</h2>
        <p className={styles.railStatus}>Нет данных — сессии агента у источника не подключены.</p>
      </GlassPanel>
    );
  }

  const state = sessions.state === 'ready' && sessions.value.length === 0 ? 'empty' : sessions.state;

  return (
    <GlassPanel className={styles.railPanel} data-state={state} data-testid="agent-sessions">
      <div className={styles.panelHead}>
        <h2>Сессии агента</h2>
        <button
          type="button"
          className={styles.projectPick}
          aria-pressed={showArchived}
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? 'Скрыть архивные' : 'Показать архивные'}
        </button>
      </div>
      {/* Фильтры уходят в хост (GET /v1/sdk/sessions?assistant&status&limit) —
          отсечение на клиенте выдавало бы часть окна за полный список. */}
      <div className={styles.sessionFilters} data-testid="sessions-filters">
        <label className={styles.visuallyHidden} htmlFor="sess-filter-assistant">Ассистент</label>
        <input
          id="sess-filter-assistant"
          className={styles.sessionInput}
          value={assistantFilter}
          onChange={(e) => setAssistantFilter(e.target.value)}
          placeholder="Ассистент — все"
          disabled={actionBusy}
        />
        <label className={styles.visuallyHidden} htmlFor="sess-filter-status">Статус</label>
        <select
          id="sess-filter-status"
          className={styles.sessionInput}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          disabled={actionBusy}
        >
          <option value="">Все статусы</option>
          <option value="busy">занята</option>
          <option value="idle">свободна</option>
        </select>
        <label className={styles.visuallyHidden} htmlFor="sess-filter-limit">Сколько строк</label>
        <select
          id="sess-filter-limit"
          className={styles.sessionInput}
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          disabled={actionBusy}
        >
          {LIMITS.map((n) => <option key={n} value={n}>до {n}</option>)}
        </select>
      </div>
      {sessions.state === 'loading' && <p className={styles.railStatus}>Читаю сессии…</p>}
      {sessions.state === 'error' && (
        <>
          <p className={styles.railStatus} role="alert">Хост не ответил: {sessions.message}</p>
          <button type="button" className={styles.projectPick} onClick={() => setReloadTick((t) => t + 1)}>
            Повторить
          </button>
        </>
      )}
      {state === 'empty' && (
        <p className={styles.railStatus}>
          {showArchived ? 'Сессий агента нет — архив тоже пуст.' : 'Сессий агента нет.'}
        </p>
      )}
      {sessions.state === 'ready' && sessions.value.length > 0 && (
        <ul className={styles.activity}>
          {sessions.value.map((s) => (
            <li key={s.id} className={styles.sessionRow} data-testid={`session-${s.id}`}>
              <i />
              <span className={styles.sessionMain}>
                <span className={styles.sessionTitle}>
                  {s.title ?? s.id}
                  {s.parent != null && (
                    <small title={`Ветка от ${s.parent.sessionId} · сообщение ${s.parent.atMessage}`}>
                      {' '}· ветка
                    </small>
                  )}
                  {s.archived && <small>{' '}· архив</small>}
                </span>
                <small>
                  {STATUS_LABEL[s.status] ?? s.status}
                  {' · '}{fmtMs(s.lastActivityAt)}
                  {' · сообщений: '}{s.messageCount ?? '—'}
                </small>
                <span className={styles.sessionActions}>
                  <button type="button" className={styles.projectPick}
                    onClick={() => toggleForm(s.id, 'resume', s.title)}>
                    Продолжить
                  </button>
                  <button type="button" className={styles.projectPick}
                    onClick={() => toggleForm(s.id, 'fork', s.title)}>
                    Ветка
                  </button>
                  <button type="button" className={styles.projectPick}
                    onClick={() => toggleForm(s.id, 'rename', s.title)}>
                    Переименовать
                  </button>
                  <button type="button" className={styles.projectPick}
                    onClick={() => void doPatch(s.id, { archived: !s.archived })}>
                    {s.archived ? 'Из архива' : 'В архив'}
                  </button>
                  <button type="button" className={styles.projectPick}
                    aria-expanded={usageOpen === s.id}
                    onClick={() => toggleUsage(s.id)}>
                    {usageOpen === s.id ? 'Скрыть токены' : 'Токены'}
                  </button>
                </span>
                {usageOpen === s.id && <SessionUsageBlock state={usage[s.id]} />}
                {open?.id === s.id && (
                  <form className={styles.sessionForm} onSubmit={submit}>
                    <label className={styles.visuallyHidden} htmlFor={`sess-draft-${s.id}`}>
                      {open.kind === 'rename' ? 'Новое название сессии' : 'Текст задачи'}
                    </label>
                    <input
                      id={`sess-draft-${s.id}`}
                      className={styles.sessionInput}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={open.kind === 'rename' ? 'Новое название…' : 'Текст следующего сообщения…'}
                      disabled={actionBusy}
                    />
                    {open.kind === 'fork' && (
                      <>
                        <label className={styles.visuallyHidden} htmlFor={`sess-at-${s.id}`}>
                          Точка ветвления — uuid сообщения
                        </label>
                        <input
                          id={`sess-at-${s.id}`}
                          className={styles.sessionInput}
                          value={atMessage}
                          onChange={(e) => setAtMessage(e.target.value)}
                          placeholder="atMessage — uuid сообщения (необязательно)"
                          disabled={actionBusy}
                        />
                      </>
                    )}
                    <Button type="submit" size="sm" disabled={actionBusy || draft.trim() === ''}>
                      {actionBusy
                        ? 'Отправляю…'
                        : open.kind === 'resume' ? 'Продолжить'
                          : open.kind === 'fork' ? 'Создать ветку' : 'Сохранить'}
                    </Button>
                  </form>
                )}
                {actionError != null && open?.id === s.id && (
                  <ErrorState variant="inline" title="Хост не ответил" body={actionError} />
                )}
                {/* NQ-092: исход рендерится только в строке своей сессии. */}
                {outcome?.sessionId === s.id && outcome.run != null && (
                  <>
                    <small className={styles.sessionResult} role="status" data-testid="session-run">
                      Прогон {outcome.run.id} → {outcome.run.to}: {outcome.run.state}
                    </small>
                    <RunLinks runId={outcome.run.id} />
                  </>
                )}
                {outcome?.sessionId === s.id && outcome.fork != null && (
                  <small className={styles.sessionResult} role="status" data-testid="session-fork">
                    Ветка {outcome.fork.id}: {FORK_STATE_LABEL[outcome.fork.state] ?? outcome.fork.state}
                    {outcome.fork.childSessionId != null ? ` · дочерняя ${outcome.fork.childSessionId}` : ''}
                  </small>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}

/**
 * Учёт сессии: токены/стоимость из GET /v1/sdk/sessions/{id}/usage.
 * Все суммы null → «нет данных у хоста» (не нули и не прочерки-заглушки).
 */
function SessionUsageBlock({ state }: { state: UsageState | undefined }) {
  if (state == null || state.state === 'loading') {
    return <small className={styles.sessionResult}>Читаю учёт сессии…</small>;
  }
  if (state.state === 'error') {
    return <ErrorState variant="inline" title="Учёт недоступен" body={state.message} />;
  }
  const u = state.value;
  const empty = u.inputTokens == null && u.outputTokens == null
    && u.totalCostUsd == null && u.runs == null;
  if (empty) {
    return <small className={styles.sessionResult} data-testid="session-usage-empty">Учёт сессии — нет данных у хоста.</small>;
  }
  return (
    <small className={styles.sessionResult} data-testid="session-usage">
      токены: {fmtInt(u.inputTokens)} → {fmtInt(u.outputTokens)}
      {' · кэш: '}{fmtInt(u.cacheReadTokens)}/{fmtInt(u.cacheCreationTokens)}
      {' · стоимость: '}{fmtUsd(u.totalCostUsd)}
      {' · прогонов: '}{fmtInt(u.runs)}
      {u.model != null ? ` · ${u.model}` : ''}
    </small>
  );
}
