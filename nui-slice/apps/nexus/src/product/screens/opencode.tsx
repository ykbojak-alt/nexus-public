'use client';


import { EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader } from '@nexus/ui';
import Link from 'next/link';
import { getDataSource, useDataSource } from '../data-source';
import { useAsyncValue } from '../use-async-value';
import styles from './screens.module.css';

/** OpenCode integration (opencode-integration-spec.md, Фаза 2): экран статуса
 *  и данных сервиса OpenCode — сессии, модели, MCP-серверы, команды.
 *  При отсутствии seam'а (URL не задан / сервис недоступен) — честный
 *  unavailable, без выдуманных данных. */
export function OpenCodeScreen() {
  const ds = useDataSource();
  const seam = ds.opencode;

  const info = useAsyncValue(() => (seam ? seam.info() : Promise.resolve(null)), [seam]);
  const sessions = useAsyncValue(() => (seam ? seam.listSessions() : Promise.resolve(null)), [seam]);
  const models = useAsyncValue(() => (seam ? seam.listModels() : Promise.resolve(null)), [seam]);
  const mcp = useAsyncValue(() => (seam ? seam.listMcpServers() : Promise.resolve(null)), [seam]);
  const commands = useAsyncValue(() => (seam ? seam.listCommands() : Promise.resolve(null)), [seam]);

  const infoState = seam == null ? 'unavailable' : info.failed ? 'error' : info.value == null ? 'loading' : 'ready';

  return (
    <div className={styles.page} data-screen="opencode" aria-labelledby="opencode-title">
      <PanelHeader
        level="screen"
        divider={false}
        titleId="opencode-title"
        title="OpenCode"
        subtitle={<>Интеграция с сервисом OpenCode (агент-рантайм, сессии, модели, MCP, команды). Источник: {ds.opencode ? 'live (URL задан)' : 'mock — seam отсутствует'}.</>}
      />

      <GlassPanel className={styles.panel} data-state={infoState} data-testid="opencode-status">
        <h2 className={styles.panelTitle}>Статус сервиса</h2>
        {!seam ? (
          <p className={styles.emptyHint}>Источник не подключён к сервису OpenCode — seam отсутствует (URL не задан или сервис недоступен). Данные не имитируются.</p>
        ) : info.failed ? (
          <ErrorState variant="inline" title="Сервис OpenCode не ответил." onRetry={info.retry} retryLabel="Повторить" />
        ) : info.value == null ? (
          <LoadingState>Читаю статус сервиса…</LoadingState>
        ) : (
          <div className={styles.ocKv}>
            <div className={styles.ocKvRow}><span className={styles.ocKvKey}>Версия</span><span className={styles.ocKvVal}>{info.value.version}</span></div>
            <div className={styles.ocKvRow}><span className={styles.ocKvKey}>Состояние</span><span className={styles.ocKvVal}>{info.value.healthy ? 'работает' : 'недоступен'}</span></div>
          </div>
        )}
      </GlassPanel>

      <GlassPanel className={styles.panel} data-state={seam == null ? 'unavailable' : sessions.failed ? 'error' : sessions.value == null ? 'loading' : sessions.value.length === 0 ? 'empty' : 'ready'} data-testid="opencode-sessions">
        <h2 className={styles.panelTitle}>Сессии</h2>
        {!seam ? (
          <p className={styles.emptyHint}>Источник не подключён.</p>
        ) : sessions.failed ? (
          <ErrorState variant="inline" title="Сессии не загрузились." onRetry={sessions.retry} retryLabel="Повторить" />
        ) : sessions.value == null ? (
          <LoadingState>Читаю сессии…</LoadingState>
        ) : sessions.value.length === 0 ? (
          <EmptyState variant="inline" title="Сессий нет" body="OpenCode не вернул сессий." />
        ) : (
          <ul className={styles.runList} aria-label="Сессии OpenCode">
            {sessions.value.map((s) => (
              <li key={s.id} className={styles.runRow} data-testid={`oc-session-${s.id}`}>
                <span className={styles.runTask}>{s.title ?? s.id}</span>
                <span className={styles.runMeta}>{s.directory ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>

      <GlassPanel className={styles.panel} data-state={seam == null ? 'unavailable' : models.failed ? 'error' : models.value == null ? 'loading' : models.value.length === 0 ? 'empty' : 'ready'} data-testid="opencode-models">
        <h2 className={styles.panelTitle}>Модели</h2>
        {!seam ? (
          <p className={styles.emptyHint}>Источник не подключён.</p>
        ) : models.failed ? (
          <ErrorState variant="inline" title="Модели не загрузились." onRetry={models.retry} retryLabel="Повторить" />
        ) : models.value == null ? (
          <LoadingState>Читаю модели…</LoadingState>
        ) : models.value.length === 0 ? (
          <EmptyState variant="inline" title="Моделей нет" body="OpenCode не вернул моделей." />
        ) : (
          <ul className={styles.runList} aria-label="Модели OpenCode">
            {models.value.map((m) => (
              <li key={m.id} className={styles.runRow} data-testid={`oc-model-${m.id}`}>
                <span className={styles.runTask}>{m.name}</span>
                <span className={styles.runMeta}>{m.provider ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>

      <GlassPanel className={styles.panel} data-state={seam == null ? 'unavailable' : mcp.failed ? 'error' : mcp.value == null ? 'loading' : mcp.value.length === 0 ? 'empty' : 'ready'} data-testid="opencode-mcp">
        <h2 className={styles.panelTitle}>MCP-серверы</h2>
        {!seam ? (
          <p className={styles.emptyHint}>Источник не подключён.</p>
        ) : mcp.failed ? (
          <ErrorState variant="inline" title="MCP не загрузились." onRetry={mcp.retry} retryLabel="Повторить" />
        ) : mcp.value == null ? (
          <LoadingState>Читаю MCP…</LoadingState>
        ) : mcp.value.length === 0 ? (
          <EmptyState variant="inline" title="MCP нет" body="OpenCode не объявил MCP-серверов." />
        ) : (
          <ul className={styles.runList} aria-label="MCP-серверы OpenCode">
            {mcp.value.map((s) => (
              <li key={s.name} className={styles.runRow} data-testid={`oc-mcp-${s.name}`}>
                <span className={styles.runTask}>{s.name}</span>
                <span className={styles.runMeta}>{s.url ?? '—'}{s.connected != null ? ` · ${s.connected ? 'подключён' : 'отключён'}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>

      <GlassPanel className={styles.panel} data-state={seam == null ? 'unavailable' : commands.failed ? 'error' : commands.value == null ? 'loading' : commands.value.length === 0 ? 'empty' : 'ready'} data-testid="opencode-commands">
        <h2 className={styles.panelTitle}>Команды</h2>
        {!seam ? (
          <p className={styles.emptyHint}>Источник не подключён.</p>
        ) : commands.failed ? (
          <ErrorState variant="inline" title="Команды не загрузились." onRetry={commands.retry} retryLabel="Повторить" />
        ) : commands.value == null ? (
          <LoadingState>Читаю команды…</LoadingState>
        ) : commands.value.length === 0 ? (
          <EmptyState variant="inline" title="Команд нет" body="OpenCode не объявил команд." />
        ) : (
          <ul className={styles.runList} aria-label="Команды OpenCode">
            {commands.value.map((c) => (
              <li key={c.id} className={styles.runRow} data-testid={`oc-cmd-${c.id}`}>
                <span className={styles.runTask}>{c.label}</span>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>

      <p className={styles.emptyHint}>
        <Link href="/settings">← Настройки</Link>
      </p>
    </div>
  );
}