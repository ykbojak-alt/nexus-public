'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader, StatusBadge } from '@nexus/ui';
import Link from 'next/link';
import { getDataSource, useDataSource } from '../data-source';
import { useAsyncValue } from '../use-async-value';
import { CraftSeamError } from '../../integrations/craft/seam';
import styles from './screens.module.css';

type RunState =
  | { state: 'idle' }
  | { state: 'submitting' }
  | { state: 'running'; operation: { id: number; method: string } }
  | { state: 'done'; result: unknown }
  | { state: 'failed'; error: string };

const POLL_MS = 2_000;
const POLL_LIMIT = 45; // ~90s — дальше честный «ещё выполняется»

function errText(e: unknown): string {
  return e instanceof CraftSeamError ? e.code : 'request_failed';
}

/** /tools/solidcraft — MVP-экран NEXUS CRAFT: статус моста, реестр команд,
 *  запуск с pending-poll (202 ≠ сбой — операция ещё идёт), inspect. Мост
 *  недоступен → честный unavailable; данные не имитируются. */
export function NexusCraftScreen() {
  const ds = useDataSource();
  const seam = ds.craft;

  const health = useAsyncValue(() => (seam ? seam.health() : Promise.resolve(null)), [seam]);
  const commands = useAsyncValue(() => (seam ? seam.listCommands() : Promise.resolve(null)), [seam]);
  const running = useAsyncValue(() => (seam ? seam.running() : Promise.resolve(null)), [seam]);
  const inspect = useAsyncValue(() => (seam ? seam.inspect() : Promise.resolve(null)), [seam]);

  const [command, setCommand] = useState('');
  const [paramsText, setParamsText] = useState('{}');
  const [run, setRun] = useState<RunState>({ state: 'idle' });
  const pollCancel = useRef(false);

  useEffect(() => () => { pollCancel.current = true; }, []);

  const submit = async () => {
    if (!seam || run.state === 'submitting' || run.state === 'running') return;
    let params: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(paramsText || '{}');
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('shape');
      params = parsed as Record<string, unknown>;
    } catch {
      setRun({ state: 'failed', error: 'invalid_params_json' });
      return;
    }
    setRun({ state: 'submitting' });
    pollCancel.current = false;
    try {
      const outcome = await seam.execute(command.trim(), params);
      if (outcome.kind === 'done') {
        setRun({ state: 'done', result: outcome.result });
      } else if (outcome.kind === 'busy') {
        setRun({ state: 'failed', error: 'adapter_busy — операция уже выполняется' });
      } else {
        setRun({ state: 'running', operation: outcome.operation });
        for (let i = 0; i < POLL_LIMIT && !pollCancel.current; i += 1) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          if (pollCancel.current) return;
          const p = await seam.pending();
          if ('done' in p && p.done === true) {
            setRun({ state: 'done', result: p.reply });
            return;
          }
        }
        if (!pollCancel.current) setRun({ state: 'failed', error: 'still_running — результат позже через /pending' });
      }
    } catch (e) {
      if (!pollCancel.current) setRun({ state: 'failed', error: errText(e) });
    }
  };

  const healthState = seam == null ? 'unavailable' : health.failed ? 'error' : health.value == null ? 'loading' : 'ready';
  const upstreamDown = health.value != null && health.value.upstream === 'down';

  return (
    <div className={styles.page} data-screen="craft" aria-labelledby="craft-title">
      <PanelHeader
        level="screen"
        divider={false}
        titleId="craft-title"
        title="NEXUS CRAFT"
        subtitle={<>SolidCraft через craft-bridge (same-origin /api/craft). Источник: {seam ? 'proxy настроен' : 'seam отсутствует'}.</>}
      />

      <GlassPanel className={styles.panel} data-state={healthState} data-testid="craft-status">
        <h2 className={styles.panelTitle}>Мост</h2>
        {!seam ? (
          <p className={styles.emptyHint}>Craft seam не подключён — proxy route /api/craft недоступен.</p>
        ) : health.failed ? (
          <ErrorState variant="inline" title="craft-bridge не ответил." onRetry={health.retry} retryLabel="Повторить" />
        ) : health.value == null ? (
          <LoadingState>Проверяю мост…</LoadingState>
        ) : (
          <div className={styles.ocKv}>
            <div className={styles.ocKvRow}>
              <span className={styles.ocKvKey}>HTTP-мост</span>
              <span className={styles.ocKvVal}><StatusBadge status="online" label="работает" /></span>
            </div>
            <div className={styles.ocKvRow}>
              <span className={styles.ocKvKey}>SolidCraft (control)</span>
              <span className={styles.ocKvVal}>
                {health.value.upstream == null ? 'не проверен' : (
                  <StatusBadge status={upstreamDown ? 'offline' : 'online'} label={upstreamDown ? 'недоступен' : 'подключён'} />
                )}
              </span>
            </div>
          </div>
        )}
      </GlassPanel>

      <GlassPanel className={styles.panel} data-testid="craft-run">
        <h2 className={styles.panelTitle}>Запуск команды</h2>
        {!seam ? (
          <p className={styles.emptyHint}>Источник не подключён.</p>
        ) : (
          <div className={styles.form}>
            <label className={styles.label}>
              Команда (engine.execute, allowlist моста)
              <input
                className={styles.input}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="parameters.get"
                data-testid="craft-run-command"
              />
            </label>
            <label className={styles.label}>
              Параметры (JSON-объект)
              <textarea
                className={styles.textarea}
                value={paramsText}
                onChange={(e) => setParamsText(e.target.value)}
                data-testid="craft-run-params"
              />
            </label>
            <div className={styles.formRow}>
              <Button
                variant="primary"
                onClick={() => void submit()}
                disabled={!command.trim() || run.state === 'submitting' || run.state === 'running'}
                loading={run.state === 'submitting'}
                data-testid="craft-run-submit"
              >
                Выполнить
              </Button>
            </div>
            {run.state === 'running' ? (
              <p className={styles.emptyHint} data-testid="craft-run-running">
                Операция выполняется на хосте{run.operation.id ? ` (id ${run.operation.id})` : ''} — опрашиваю /pending…
              </p>
            ) : run.state === 'done' ? (
              <pre className={styles.emptyHint} data-testid="craft-run-result">
                {JSON.stringify(run.result, null, 2)?.slice(0, 2000)}
              </pre>
            ) : run.state === 'failed' ? (
              <p className={styles.error} data-testid="craft-run-error">{run.error}</p>
            ) : null}
          </div>
        )}
      </GlassPanel>

      <GlassPanel className={styles.panel} data-state={seam == null ? 'unavailable' : commands.failed ? 'error' : commands.value == null ? 'loading' : commands.value.length === 0 ? 'empty' : 'ready'} data-testid="craft-commands">
        <h2 className={styles.panelTitle}>Реестр команд</h2>
        {!seam ? (
          <p className={styles.emptyHint}>Источник не подключён.</p>
        ) : commands.failed ? (
          <ErrorState variant="inline" title="Реестр не загрузился." onRetry={commands.retry} retryLabel="Повторить" />
        ) : commands.value == null ? (
          <LoadingState>Читаю реестр…</LoadingState>
        ) : commands.value.length === 0 ? (
          <EmptyState variant="inline" title="Команд нет" body="Хост не вернул реестр." />
        ) : (
          <ul className={styles.rows} aria-label="Команды SolidCraft">
            {commands.value.map((c) => (
              <li key={c.id} className={styles.row} data-testid={`craft-cmd-${c.id}`}>
                <button
                  type="button"
                  className={styles.selectRow}
                  disabled={c.enabled === false}
                  onClick={() => setCommand(c.id)}
                >
                  <span className={styles.selectMain}>
                    <span className={styles.rowLabel}>{c.label ?? c.id}</span>
                    <span className={styles.rowMeta}>{c.id}{c.enabled === false ? ' · disabled' : ''}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>

      <GlassPanel className={styles.panel} data-state={seam == null ? 'unavailable' : running.failed ? 'error' : running.value == null ? 'loading' : 'ready'} data-testid="craft-running">
        <h2 className={styles.panelTitle}>Операции хоста</h2>
        {!seam ? (
          <p className={styles.emptyHint}>Источник не подключён.</p>
        ) : running.failed ? (
          <ErrorState variant="inline" title="Статус не загрузился." onRetry={running.retry} retryLabel="Повторить" />
        ) : running.value == null ? (
          <LoadingState>Читаю статус…</LoadingState>
        ) : running.value.length === 0 ? (
          <EmptyState variant="inline" title="Выполняющихся операций нет" />
        ) : (
          <ul className={styles.rows} aria-label="Выполняющиеся операции">
            {running.value.map((op, i) => (
              <li key={i} className={styles.row}>
                <span className={styles.rowText}>{JSON.stringify(op)}</span>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>

      <GlassPanel className={styles.panel} data-state={seam == null ? 'unavailable' : inspect.failed ? 'error' : inspect.value == null ? 'loading' : 'ready'} data-testid="craft-inspect">
        <h2 className={styles.panelTitle}>ui.inspect</h2>
        {!seam ? (
          <p className={styles.emptyHint}>Источник не подключён.</p>
        ) : inspect.failed ? (
          <ErrorState variant="inline" title="inspect не ответил." onRetry={inspect.retry} retryLabel="Повторить" />
        ) : inspect.value == null ? (
          <LoadingState>Читаю состояние UI…</LoadingState>
        ) : (
          <pre className={styles.emptyHint} data-testid="craft-inspect-raw">
            {JSON.stringify(inspect.value, null, 2).slice(0, 2000)}
          </pre>
        )}
      </GlassPanel>

      <p className={styles.emptyHint}>
        <Link href="/settings">← Настройки</Link>
      </p>
    </div>
  );
}
