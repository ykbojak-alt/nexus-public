'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, EmptyState, ErrorState, GlassPanel, LoadingState, StatusBadge, UnavailableState } from '@nexus/ui';
import type { SdkDelegation, SdkHandoff } from '../../integrations/ai2/contracts/sdk';
import { useDataSource } from '../data-source';
import styles from './screens.module.css';

/**
 * XIV W3 — панели экрана «Агенты» по sdk-delegations-contract.md (draft):
 * дерево делегаций (параллельные фоновые прогоны) + хэндофы между
 * ассистентами. Все маршруты за AI2_SDK_ENABLED — без флага хост честно
 * отвечает 503 verbatim; seam отсутствует → «нет данных». Дочерние
 * прогоны не выдумываются: список — только от GET /v1/sdk/delegations.
 */

const DELEGATION_STATE: Record<string, { status: 'active' | 'complete' | 'error' | 'offline' | 'info'; label: string }> = {
  sent: { status: 'active', label: 'отправлен' },
  answered: { status: 'complete', label: 'отвечен' },
  failed: { status: 'error', label: 'ошибка' },
  cancelled: { status: 'offline', label: 'отменён' },
};

const HANDOFF_STATUS: Record<string, { status: 'waiting' | 'complete' | 'error' | 'info'; label: string }> = {
  pending: { status: 'waiting', label: 'ожидает' },
  accepted: { status: 'complete', label: 'принята' },
  declined: { status: 'error', label: 'отклонена' },
};

function fmtMs(ms: number | null): string {
  if (ms == null) return '—';
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)} мс`;
  return `${(ms / 1000).toFixed(1)} с`;
}

type LoadState<T> =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; value: T };

/** «Дерево делегаций» — дочерние фоновые прогоны SDK verbatim + форма
 *  делегации (права потомка ≤ родителя — контракт) + кооперативная
 *  отмена. parentRunId — ручной ввод: списка SDK-прогонов на хосте нет,
 *  подсказки (datalist) — только известные id из загруженного дерева. */
export function SdkDelegationsPanel({ agentNames }: { agentNames: string[] }) {
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const seam = ds.sdkDelegations;
  const [rows, setRows] = useState<LoadState<SdkDelegation[]>>({ state: 'loading' });
  const [tick, setTick] = useState(0);
  const [parent, setParent] = useState('');
  const [task, setTask] = useState('');
  const [agent, setAgent] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (seam == null) return;
    let alive = true;
    seam.list()
      .then((v) => { if (alive) setRows({ state: 'ready', value: v }); })
      .catch((e) => {
        if (alive) setRows({ state: 'error', message: e instanceof Error ? e.message : 'Хост не ответил.' });
      });
    return () => { alive = false; };
  }, [seam, tick]);

  // Известные родительские id — только из загруженного дерева (реальные).
  const knownParents = useMemo(() => {
    const set = new Set<string>();
    for (const d of rows.state === 'ready' ? rows.value : []) {
      if (d.parentRunId != null) set.add(d.parentRunId);
      set.add(d.id);
    }
    return [...set];
  }, [rows]);

  const submit = useCallback(async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (seam == null || busy || parent.trim() === '' || task.trim() === '') return;
    setBusy(true);
    setFormErr(null);
    setNote(null);
    try {
      const handle = await seam.delegate(parent.trim(), {
        task: task.trim(),
        agent: agent === '' ? undefined : agent,
        label: label.trim() === '' ? undefined : label.trim(),
      });
      setNote(`Делегация ${handle.id}: ${handle.state}`);
      setTask('');
      setTick((t) => t + 1);
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Хост не ответил.');
    } finally {
      setBusy(false);
    }
  }, [seam, busy, parent, task, agent, label]);

  const cancel = useCallback(async (id: string) => {
    if (seam == null || busy) return;
    setBusy(true);
    setFormErr(null);
    try {
      await seam.cancel(id);
      setTick((t) => t + 1);
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Хост не ответил.');
    } finally {
      setBusy(false);
    }
  }, [seam, busy]);

  if (seam == null) {
    return (
      <GlassPanel className={styles.panel} data-state="unavailable" data-testid="sdk-delegations">
        <h3 className={styles.panelTitle}>Дерево делегаций</h3>
        <UnavailableState variant="inline" title="Нет данных" reason="источник не реализует делегации SDK." />
      </GlassPanel>
    );
  }

  const state = rows.state === 'ready' && rows.value.length === 0 ? 'empty' : rows.state;

  return (
    <GlassPanel className={styles.panel} data-state={state} data-testid="sdk-delegations">
      <h3 className={styles.panelTitle}>Дерево делегаций</h3>
      {rows.state === 'loading' && <LoadingState>Читаю делегации…</LoadingState>}
      {rows.state === 'error' && (
        <ErrorState variant="inline" title="Хост не ответил" body={rows.message} onRetry={() => setTick((t) => t + 1)} />
      )}
      {state === 'empty' && (
        <EmptyState variant="inline" title="Делегаций нет" body="SDK не запускал дочерних прогонов." />
      )}
      {rows.state === 'ready' && rows.value.length > 0 && (
        <ul className={styles.rows} aria-label="Делегации SDK">
          {rows.value.map((d) => {
            const st = DELEGATION_STATE[d.state ?? ''] ?? { status: 'info' as const, label: d.state ?? '—' };
            return (
              <li key={d.id} className={styles.row} data-testid={`sdk-delegation-${d.id}`}>
                <span className={styles.rowText}>
                  ↳ <b>{d.label ?? d.id}</b>
                  {d.agent != null && <span className={styles.rowMeta}> · {d.agent}</span>}
                  <span className={styles.rowMeta}>
                    {' '}· родитель {d.parentRunId ?? '—'} · {fmtMs(d.createdAt)} · {fmtDuration(d.durationMs)}
                    {d.summary != null ? ` · ${d.summary}` : ''}
                  </span>
                </span>
                <StatusBadge status={st.status} label={st.label} />
                {d.state === 'sent' && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void cancel(d.id)}>
                    Отменить
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form className={styles.form} onSubmit={submit} data-testid="sdk-delegate-form">
        <p className={styles.emptyHint}>
          Параллельный фоновый прогон: потомок наследует права и каталог родителя.
          id родителя — из прогона SDK (подсказка — известные из дерева).
        </p>
        <div className={styles.formRow} role="group" aria-label="Новая делегация SDK">
          <input className={styles.input} list="sdk-parent-ids" value={parent}
            onChange={(e) => setParent(e.target.value)}
            placeholder="id родительского прогона" aria-label="id родительского прогона" disabled={busy} />
          <datalist id="sdk-parent-ids">
            {knownParents.map((id) => <option key={id} value={id} />)}
          </datalist>
          <select className={styles.input} value={agent} onChange={(e) => setAgent(e.target.value)}
            aria-label="Субагент" disabled={busy}>
            <option value="">агент родителя</option>
            {agentNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className={styles.formRow}>
          <input className={styles.input} value={task} onChange={(e) => setTask(e.target.value)}
            placeholder="задача делегата" aria-label="Задача делегата" disabled={busy} />
          <input className={`${styles.input} ${styles.ttlInput}`} value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="метка" aria-label="Метка делегации" disabled={busy} />
          <Button type="submit" variant="primary" size="sm"
            disabled={busy || parent.trim() === '' || task.trim() === ''}>
            {busy ? 'Отправляю…' : 'Делегировать'}
          </Button>
        </div>
        {formErr && <ErrorState variant="inline" title="Хост не ответил" body={formErr} />}
        {note && <p className={styles.emptyHint} role="status">{note}</p>}
      </form>
    </GlassPanel>
  );
}

/** «Передачи» — хэндофы между ассистентами SDK: история персистентна,
 *  решения accept/decline идемпотентны (повтор → 409 verbatim). */
export function SdkHandoffsPanel({ agentNames }: { agentNames: string[] }) {
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const seam = ds.sdkHandoffs;
  const [rows, setRows] = useState<LoadState<SdkHandoff[]>>({ state: 'loading' });
  const [tick, setTick] = useState(0);
  const [to, setTo] = useState('');
  const [prompt, setPrompt] = useState('');
  const [runId, setRunId] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (seam == null) return;
    let alive = true;
    seam.list()
      .then((v) => { if (alive) setRows({ state: 'ready', value: v }); })
      .catch((e) => {
        if (alive) setRows({ state: 'error', message: e instanceof Error ? e.message : 'Хост не ответил.' });
      });
    return () => { alive = false; };
  }, [seam, tick]);

  const submit = useCallback(async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (seam == null || busy || to.trim() === '' || prompt.trim() === '') return;
    setBusy(true);
    setFormErr(null);
    setNote(null);
    try {
      const h = await seam.create({
        to: to.trim(),
        prompt: prompt.trim(),
        runId: runId.trim() === '' ? undefined : runId.trim(),
      });
      setNote(`Передача ${h.id}: ${HANDOFF_STATUS[h.status]?.label ?? h.status}`);
      setPrompt('');
      setTick((t) => t + 1);
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Хост не ответил.');
    } finally {
      setBusy(false);
    }
  }, [seam, busy, to, prompt, runId]);

  const resolve = useCallback(async (id: string, accept: boolean) => {
    if (seam == null || busy) return;
    setBusy(true);
    setFormErr(null);
    try {
      await seam.resolve(id, accept);
      setTick((t) => t + 1);
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Хост не ответил.');
    } finally {
      setBusy(false);
    }
  }, [seam, busy]);

  if (seam == null) {
    return (
      <GlassPanel className={styles.panel} data-state="unavailable" data-testid="sdk-handoffs">
        <h3 className={styles.panelTitle}>Передачи SDK</h3>
        <UnavailableState variant="inline" title="Нет данных" reason="источник не реализует хэндофы SDK." />
      </GlassPanel>
    );
  }

  const state = rows.state === 'ready' && rows.value.length === 0 ? 'empty' : rows.state;

  return (
    <GlassPanel className={styles.panel} data-state={state} data-testid="sdk-handoffs">
      <h3 className={styles.panelTitle}>Передачи SDK</h3>
      {rows.state === 'loading' && <LoadingState>Читаю передачи…</LoadingState>}
      {rows.state === 'error' && (
        <ErrorState variant="inline" title="Хост не ответил" body={rows.message} onRetry={() => setTick((t) => t + 1)} />
      )}
      {state === 'empty' && <EmptyState variant="inline" title="Передач пока не было." />}
      {rows.state === 'ready' && rows.value.length > 0 && (
        <ul className={styles.rows} aria-label="Передачи SDK">
          {rows.value.map((h) => {
            const st = HANDOFF_STATUS[h.status] ?? { status: 'info' as const, label: h.status };
            return (
              <li key={h.id} className={styles.row} data-testid={`sdk-handoff-${h.id}`}>
                <span className={styles.rowText}>
                  <b>{h.from ?? '—'} → {h.to}</b>: {h.prompt}
                  <span className={styles.rowMeta}>
                    {' '}· {fmtMs(h.createdAt)}
                    {h.resolvedAt != null ? ` · решена ${fmtMs(h.resolvedAt)}` : ''}
                    {h.reason != null ? ` · причина: ${h.reason}` : ''}
                    {h.runId != null ? ` · прогон ${h.runId}` : ''}
                  </span>
                </span>
                <StatusBadge status={st.status} label={st.label} />
                {h.status === 'pending' && (
                  <>
                    <Button variant="ghost" size="sm" disabled={busy}
                      onClick={() => void resolve(h.id, true)}>Принять</Button>
                    <Button variant="ghost" size="sm" disabled={busy}
                      onClick={() => void resolve(h.id, false)}>Отклонить</Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form className={styles.form} onSubmit={submit} data-testid="sdk-handoff-form">
        <p className={styles.emptyHint}>Передача задачи другому ассистенту — карточка ожидает решения на хосте.</p>
        <div className={styles.formRow} role="group" aria-label="Новая передача SDK">
          <input className={styles.input} list="sdk-handoff-to" value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="кому (ассистент)" aria-label="Кому передать" disabled={busy} />
          <datalist id="sdk-handoff-to">
            {agentNames.map((n) => <option key={n} value={n} />)}
          </datalist>
          <input className={styles.input} value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="текст передачи" aria-label="Текст передачи" disabled={busy} />
          <input className={`${styles.input} ${styles.ttlInput}`} value={runId}
            onChange={(e) => setRunId(e.target.value)}
            placeholder="run id (необяз.)" aria-label="id прогона" disabled={busy} />
          <Button type="submit" variant="primary" size="sm"
            disabled={busy || to.trim() === '' || prompt.trim() === ''}>
            {busy ? 'Отправляю…' : 'Передать'}
          </Button>
        </div>
        {formErr && <ErrorState variant="inline" title="Хост не ответил" body={formErr} />}
        {note && <p className={styles.emptyHint} role="status">{note}</p>}
      </form>
    </GlassPanel>
  );
}
