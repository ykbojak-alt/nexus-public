'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { ProcessState } from '@nexus/mock-data/types';
import { usePersonas } from './personas';
import type { PresenceEntry } from '@nexus/patterns';
import { getDataSource, useDataSource } from './data-source';
import { PROC_STATE_LABEL } from './proc-state-label';
import { GlassSurface } from '@nexus/ui';
import { runWhileDocumentVisible } from './visible-interval';
import styles from './app-shell.module.css';

/** Состояния процесса — серверный словарь /v1/processes verbatim,
 *  подпись для известных, остальное сырьём. Общая карта — proc-state-label. */
const STATE_LABEL: Partial<Record<ProcessState, string>> = PROC_STATE_LABEL;

const LINKED_IDS = ['alice', 'mech', 'forge', 'codex', 'arch'] as const;

const ATTENTION: ProcessState[] = ['failed', 'blocked'];
const LIVE: ProcessState[] = ['new', 'ready', 'running'];

type AgentsState =
  | { kind: 'loading' }
  | { kind: 'absent' }
  | { kind: 'error' }
  | { kind: 'ready'; rows: PresenceEntry[] };

type LinkedAgent = {
  id: string;
  name: string;
  state: ProcessState | null;
  label: string;
  task: string | null;
};

/** Тон маркера триггера — только из реальных состояний: «внимание» горит,
 *  когда что-то упало или встало, «в работе» — когда есть живой процесс. */
function toneOf(rows: LinkedAgent[]): 'none' | 'attention' | 'live' | 'idle' {
  if (rows.some((r) => r.state != null && ATTENTION.includes(r.state))) return 'attention';
  if (rows.some((r) => r.state != null && LIVE.includes(r.state))) return 'live';
  return rows.some((r) => r.state != null) ? 'idle' : 'none';
}

/** «Linked Agents» рельса (листы ALICE): список ассистентов с точкой
 *  реального состояния процесса. Данные — только listPresence seam;
 *  без него честная строка «нет данных», выдуманного «Онлайн» нет.
 *  Список убран под выпадающий триггер (решение владельца 2026-10-29):
 *  пять строк в подвале рельса спорили с навигацией за место, а нужен
 *  был только сводный сигнал — он живёт в шапке меню. */
export function RailLinkedAgents() {
  const ds = useDataSource();
  // perf XVI W1: каталог персон ленивый — до ответа строк просто нет кадр,
  // дальше находка по id та же, что у eager-PERSONAS.
  const personas = usePersonas();
  const [state, setState] = useState<AgentsState>({ kind: 'loading' });
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let alive = true;
    if (ds.listPresence == null) {
      setState({ kind: 'absent' });
      return;
    }
    const poll = () => {
      ds.listPresence().then(
        (rows) => { if (alive) setState({ kind: 'ready', rows }); },
        () => { if (alive) setState({ kind: 'error' }); },
      );
    };
    poll();
    const stopPolling = runWhileDocumentVisible(poll, 60_000);
    return () => { alive = false; stopPolling(); };
  }, [ds]);

  const linked = useMemo<LinkedAgent[] | null>(() => {
    if (state.kind !== 'ready' || personas == null) return null;
    const rows: LinkedAgent[] = [];
    for (const id of LINKED_IDS) {
      const persona = personas.find((p) => p.id === id);
      if (persona == null) continue;
      const proc = state.rows.find((r) => r.agent === id || r.agent === persona.name);
      rows.push({
        id,
        name: persona.name,
        state: proc?.state ?? null,
        label: proc == null ? 'нет данных' : (STATE_LABEL[proc.state] ?? proc.state),
        task: proc?.task ?? null,
      });
    }
    return rows;
  }, [state, personas]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const tone = linked == null ? 'none' : toneOf(linked);

  return (
    <section ref={rootRef} className={styles.linkedAgents} aria-label="Связанные агенты">
      <button
        type="button"
        className={styles.agentsTrigger}
        aria-expanded={open}
        aria-controls="rail-agents-list"
        onClick={() => setOpen((v) => !v)}
      >
        <i className={styles.agentsTone} data-tone={tone} aria-hidden="true" />
        <span className={styles.linkedTitle}>Агенты</span>
        <span className={styles.agentsCount}>
          {linked == null ? 'читаю…' : `${linked.length}`}
        </span>
        <svg className={styles.agentsChevron} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 7.5 6 4.5 9 7.5" />
        </svg>
      </button>

      {open && (
        <GlassSurface
          variant="card"
          className={styles.agentsPopover}
          id="rail-agents-list"
          role="group"
          aria-label="Состояние связанных агентов"
        >
          {state.kind === 'absent' && (
            <p className={styles.linkedNote}>нет данных — источник не отдаёт процессы.</p>
          )}
          {state.kind === 'error' && (
            <p className={styles.linkedNote}>нет данных — хост не ответил.</p>
          )}
          {state.kind === 'loading' && (
            <p className={styles.linkedNote}>Читаю состояние…</p>
          )}
          {linked != null && (
            <ul className={styles.linkedList}>
              {linked.map((row) => (
                <li key={row.id}>
                  <Link href="/agents" className={styles.linkedRow} title={row.task ?? 'Процесса нет в выдаче хоста'}>
                    <i data-state={row.state ?? 'none'} aria-hidden="true" />
                    <span className={styles.linkedName}>{row.name}</span>
                    <span className={styles.linkedState}>{row.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/agents" className={styles.agentsAll} onClick={() => setOpen(false)}>
            Все агенты и сессии
          </Link>
        </GlassSurface>
      )}
    </section>
  );
}

/** Карточка «NEXUS CORE» внизу рельса (листы ALICE). Версии у клиента
 *  нет — показываем состояние ядра из getMetrics.health (реальный seam):
 *  все компоненты ok → «в норме», иначе verbatim худшего статуса. */
export function RailCoreCard() {
  const ds = useDataSource();
  const [status, setStatus] = useState<string | null>(null);
  const [tone, setTone] = useState<'ok' | 'warn' | 'error' | 'none'>('none');
  useEffect(() => {
    let alive = true;
    ds.getMetrics().then(
      (m) => {
        if (!alive) return;
        const worst = m.health.find((h) => h.status === 'error')
          ?? m.health.find((h) => h.status === 'warn');
        if (worst != null) {
          setStatus(`${worst.component}: ${worst.status}`);
          setTone(worst.status);
        } else if (m.health.length > 0) {
          setStatus('в норме');
          setTone('ok');
        } else {
          setStatus('нет данных');
          setTone('none');
        }
      },
      () => { if (alive) { setStatus('хост не ответил'); setTone('error'); } },
    );
    return () => { alive = false; };
  }, [ds]);

  return (
    <GlassSurface variant="card" tone="nexus" className={styles.coreCard} data-testid="rail-core-card">
      <Link href="/mission-control" prefetch={false} className={styles.coreCardRow}>
        <span className={styles.coreCardName}>NEXUS CORE</span>
        <i className={styles.coreDot} data-tone={tone} aria-hidden="true" />
      </Link>
      <span className={styles.coreCardStatus}>{status ?? 'читаю состояние…'}</span>
    </GlassSurface>
  );
}
