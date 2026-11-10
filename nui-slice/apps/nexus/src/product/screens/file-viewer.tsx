'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button, EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader, StatusBadge, maskSecrets } from '@nexus/ui';
import type { RunStatus, RunSummary } from '@nexus/mock-data';
import type { McpServer } from '../../integrations/ai2/contracts/mcp';
import { getDesktopBridge, hasDesktopBridge } from '../../integrations/ai2/desktop-bridge/adapter';
import { useDataSource } from '../data-source';
import { useAsyncValue } from '../use-async-value';
import { STATUS_BADGE } from './runtime-ops';
import styles from './file-viewer.module.css';

type Preview =
  | { kind: 'image' | 'pdf' | 'video'; name: string; url: string; size: number }
  | { kind: 'text'; name: string; text: string; size: number };

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg']);
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'json', 'csv', 'log', 'yaml', 'yml', 'xml']);

function classify(file: File): Preview['kind'] | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_TYPES.has(file.type) || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  if (file.type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (VIDEO_TYPES.has(file.type) || ['mp4', 'webm', 'ogv'].includes(ext)) return 'video';
  if (file.type.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) return 'text';
  return null;
}

function allowedUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sizeLabel(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

const STATUS_FILTERS: { value: '' | RunStatus; label: string }[] = [
  { value: '', label: 'все статусы' },
  { value: 'running', label: 'идёт' },
  { value: 'done', label: 'завершён' },
  { value: 'error', label: 'ошибка' },
  { value: 'cancelled', label: 'отменён' },
  { value: 'timeout', label: 'просрочен' },
];

/** Библиотека прогонов (subagents-wave W3-1): listRuns — единственный seam;
 *  agent уходит параметром в seam, config/status — фильтр поверх выборки
 *  (listRuns их не принимает — сужаем наблюдаемые строки, не выдумываем).
 *  Дочерние прогоны видны по полю parent из записей выборки; полная
 *  иерархия по запросу ждёт хостовый фильтр ?parent= (W1-задача волны). */
function RunsLibrary() {
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const [agent, setAgent] = useState('');
  const [config, setConfig] = useState('');
  const [status, setStatus] = useState<'' | RunStatus>('');
  const runs = useAsyncValue(() => ds.listRuns({ limit: 50, ...(agent ? { agent } : {}) }), [ds, agent]);
  const agents = useAsyncValue(() => ds.listAgents(), [ds]);
  const presets = useAsyncValue(() => ds.listPresets(), [ds]);

  const rows = useMemo(() => (runs.value ?? []).filter(
    (r) => (status === '' || r.status === status) && (config === '' || r.config === config),
  ), [runs.value, status, config]);
  const children = useMemo(() => rows.filter((r) => r.parent != null), [rows]);

  return (
    <GlassPanel className={styles.controlPanel} data-testid="runs-library"
      data-state={runs.failed ? 'error' : runs.value == null ? 'loading' : rows.length === 0 ? 'empty' : 'ready'}>
      <h2 className={styles.sectionTitle}>Прогоны</h2>
      <div className={styles.filters} role="group" aria-label="Фильтры библиотеки прогонов">
        <select className={styles.urlInput} value={agent} onChange={(e) => setAgent(e.target.value)}
          aria-label="Фильтр по агенту">
          <option value="">все агенты</option>
          {(agents.value ?? []).map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
        </select>
        <select className={styles.urlInput} value={config} onChange={(e) => setConfig(e.target.value)}
          aria-label="Фильтр по пресету">
          <option value="">все пресеты</option>
          {(presets.value ?? []).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
        <select className={styles.urlInput} value={status} onChange={(e) => setStatus(e.target.value as '' | RunStatus)}
          aria-label="Фильтр по статусу">
          {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      {runs.failed ? (
        <ErrorState variant="inline" title="Не удалось загрузить прогоны" onRetry={runs.retry} retryLabel="Повторить" />
      ) : runs.value == null ? (
        <LoadingState>Загружаю прогоны…</LoadingState>
      ) : rows.length === 0 ? (
        <EmptyState variant="inline" title="Прогонов не было" body="Список пуст — ни один прогон не подошёл под выбранные фильтры." />
      ) : (
        <>
          <ul className={styles.runList} aria-label="Список прогонов" tabIndex={0}>
            {rows.map((r: RunSummary) => (
              <li key={r.runId} className={styles.runRow} data-parent={r.parent != null || undefined}>
                <Link className={styles.runLink} href={`/run?id=${r.runId}`}
                  title={`${r.runId}${r.parent != null ? ` · дочерний ← ${r.parent}` : ''}`}>
                  <span className={styles.runId}>{r.parent != null ? '↳ ' : ''}{r.runId.slice(0, 8)}</span>
                  <span className={styles.runTask}>{r.taskText}</span>
                  <span className={styles.runMeta}>{r.config}{r.agent != null ? ` · ${r.agent}` : ''}</span>
                </Link>
                <StatusBadge {...STATUS_BADGE[r.status]} />
              </li>
            ))}
          </ul>
          <p className={styles.hint}>
            {children.length > 0
              ? `дочерних прогонов в выборке: ${children.length} (помечены ↳). Полная иерархия субагентов появится после хостового фильтра ?parent=.`
              : 'иерархия субагентов появится после хостового parent-фильтра — дочерние прогоны помечаются ↳ по полю parent.'}
          </p>
        </>
      )}
    </GlassPanel>
  );
}

/** XIV W3 — «Промпты и сценарии»: GET /v1/prompts — файлы каталога
 *  (source:'file') + сохранённые сценарии SDK (source:'saved'). CRUD
 *  сохранённых — за AI2_SDK_ENABLED; хост отклоняет секретоподобный
 *  текст (422 verbatim). Seam отсутствует → честное «нет данных». */
function PromptsLibrary() {
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const seam = ds.prompts;
  const prompts = useAsyncValue(
    () => (seam != null ? seam.list() : Promise.resolve(null)),
    [seam],
  );
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (seam == null || busy || !title.trim() || !body.trim()) return;
    setBusy(true);
    setFormErr(null);
    setNote(null);
    try {
      const p = await seam.create({ title: title.trim(), body: body.trim() });
      setNote(`Сценарий «${p.title}» сохранён (${p.id}).`);
      setTitle('');
      setBody('');
      prompts.retry();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Хост не ответил.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (seam == null || busy) return;
    setBusy(true);
    setFormErr(null);
    try {
      await seam.remove(id);
      prompts.retry();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Хост не ответил.');
    } finally {
      setBusy(false);
    }
  };

  const state = seam == null ? 'unavailable'
    : prompts.failed ? 'error'
      : prompts.value == null ? 'loading'
        : prompts.value.length === 0 ? 'empty' : 'ready';

  return (
    <GlassPanel className={styles.controlPanel} data-testid="prompts-library" data-state={state}>
      <h2 className={styles.sectionTitle}>Промпты и сценарии</h2>
      {seam == null ? (
        <EmptyState variant="inline" title="Нет данных" reason="источник не реализует чтение каталога промптов" />
      ) : prompts.failed ? (
        <ErrorState variant="inline" title="Каталог промптов не загрузился" onRetry={prompts.retry} retryLabel="Повторить" />
      ) : prompts.value == null ? (
        <LoadingState>Читаю каталог промптов…</LoadingState>
      ) : (
        <>
          {prompts.value.length === 0 && (
            <EmptyState variant="inline" title="Нет данных"
              body="Каталог промптов пуст и сохранённых сценариев нет — создайте первый ниже." />
          )}
          {prompts.value.length > 0 && (
            <ul className={styles.runList} aria-label="Промпты и сценарии">
              {prompts.value.map((p) => (
                <li key={p.path ?? p.id ?? p.name} className={styles.runRow}>
                  <span className={styles.runTask}>
                    {p.name}
                    {p.source === 'saved' && <span className={styles.runMeta}> · сценарий</span>}
                  </span>
                  <span className={styles.runMeta}>
                    {p.path ?? (p.updatedAt != null
                      ? new Date(p.updatedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                      : '—')}
                  </span>
                  {p.source === 'saved' && p.id != null && (
                    <Button variant="ghost" size="sm" disabled={busy}
                      onClick={() => void remove(p.id ?? '')}>Удалить</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form className={styles.formStack} onSubmit={create} data-testid="prompt-create-form">
            <p className={styles.hint}>
              Сохранённый сценарий — на хосте в хранилище SDK; секретоподобный
              текст хост отклоняет.
            </p>
            <div className={styles.urlRow}>
              <input className={styles.urlInput} value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="название сценария" aria-label="Название сценария" disabled={busy} maxLength={200} />
            </div>
            <div className={styles.urlRow}>
              <textarea className={styles.urlInput} value={body} onChange={(e) => setBody(e.target.value)}
                placeholder="текст сценария/промпта" aria-label="Текст сценария" disabled={busy} rows={3} />
              <Button type="submit" size="sm" disabled={busy || !title.trim() || !body.trim()}>
                {busy ? 'Сохраняю…' : 'Сохранить'}
              </Button>
            </div>
            {formErr && <p className={styles.error} role="alert">Хост не ответил: {formErr}</p>}
            {note && <p className={styles.hint} role="status">{note}</p>}
          </form>
        </>
      )}
    </GlassPanel>
  );
}

/** XIV W3 — «MCP-серверы»: GET /v1/mcp/servers (mcp-servers-contract).
 *  tools/envKeys/status verbatim; значений env нет по построению.
 *  Вызов — только через канал подтверждений fs_requests: первый POST
 *  создаёт заявку (awaiting_confirmation), исполнение — после approve. */
function McpServersPanel() {
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const seam = ds.mcpServers;
  const catalog = useAsyncValue(
    () => (seam != null ? seam.list() : Promise.resolve(null)),
    [seam],
  );
  const [sel, setSel] = useState<McpServer | null>(null);
  const [tool, setTool] = useState('');
  const [argsJson, setArgsJson] = useState('{}');
  const [busy, setBusy] = useState(false);
  const [callErr, setCallErr] = useState<string | null>(null);
  const [callRes, setCallRes] = useState<string | null>(null);

  const call = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (seam == null || sel == null || busy || !tool.trim()) return;
    setBusy(true);
    setCallErr(null);
    setCallRes(null);
    try {
      let args: Record<string, unknown> | undefined;
      const raw = argsJson.trim();
      if (raw !== '' && raw !== '{}') {
        const parsed: unknown = JSON.parse(raw);
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('arguments должен быть JSON-объектом');
        }
        args = parsed as Record<string, unknown>;
      }
      const res = await seam.call(sel.name, { tool: tool.trim(), arguments: args });
      if (res.status === 'awaiting_confirmation') {
        setCallRes(`Заявка ${res.requestId} создана — ждёт подтверждения на хосте (fs_requests).`);
      } else if (res.ok) {
        // Результат исполнения — verbatim, но через маску секретов.
        setCallRes(`Выполнено: ${JSON.stringify(maskSecrets(res.result) ?? null)}`);
      } else {
        setCallRes(`Ошибка исполнения: ${res.error ?? '—'}`);
      }
    } catch (err) {
      setCallErr(err instanceof Error ? err.message : 'Хост не ответил.');
    } finally {
      setBusy(false);
    }
  };

  const state = seam == null ? 'unavailable'
    : catalog.failed ? 'error'
      : catalog.value == null ? 'loading'
        : catalog.value.servers.length === 0 ? 'empty' : 'ready';

  return (
    <GlassPanel className={styles.controlPanel} data-testid="mcp-servers" data-state={state}>
      <h2 className={styles.sectionTitle}>MCP-серверы</h2>
      {seam == null ? (
        <EmptyState variant="inline" title="Нет данных" reason="источник не реализует каталог MCP" />
      ) : catalog.failed ? (
        <ErrorState variant="inline" title="Каталог MCP не загрузился" onRetry={catalog.retry} retryLabel="Повторить" />
      ) : catalog.value == null ? (
        <LoadingState>Читаю каталог MCP…</LoadingState>
      ) : (
        <>
          {catalog.value.error != null && (
            <p className={styles.error} role="alert">Каталог: {catalog.value.error}</p>
          )}
          {!catalog.value.configured && catalog.value.servers.length === 0 && (
            <EmptyState variant="inline" title="Нет данных"
              body="Файл конфигурации MCP не задан (AI2_MCP_CONFIG) — серверов нет." />
          )}
          {catalog.value.servers.length > 0 && (
            <ul className={styles.runList} aria-label="MCP-серверы">
              {catalog.value.servers.map((s) => (
                <li key={s.name} className={styles.runRow} data-testid={`mcp-${s.name}`}>
                  <span className={styles.runTask}>
                    {s.name}
                    <span className={styles.runMeta}>
                      {' '}· {s.transport ?? '—'}
                      {s.command != null ? ` · ${s.command}${s.args.length > 0 ? ' ' + s.args.join(' ') : ''}` : ''}
                    </span>
                  </span>
                  <span className={styles.runMeta}>
                    {s.tools == null ? 'инструменты не объявлены' : `инструментов: ${s.tools.length}`}
                    {s.envKeys.length > 0 ? ` · env: ${s.envKeys.join(', ')}` : ''}
                  </span>
                  <StatusBadge
                    status={s.status === 'configured' ? 'complete' : s.status === 'error' ? 'error' : 'info'}
                    label={s.status === 'configured' ? 'настроен' : s.status === 'error' ? 'ошибка' : s.status}
                  />
                  {s.error != null && <span className={styles.error}>{s.error}</span>}
                  {s.tools != null && s.tools.length > 0 && (
                    <Button variant="ghost" size="sm"
                      onClick={() => { setSel(s); setTool(s.tools?.[0]?.name ?? ''); setCallRes(null); setCallErr(null); }}>
                      Вызвать
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {sel != null && (
            <form className={styles.formStack} onSubmit={call} data-testid="mcp-call-form">
              <p className={styles.hint}>
                Вызов {sel.name}.{tool || '…'} — только через подтверждение на хосте (fs_requests).
              </p>
              <div className={styles.urlRow}>
                <input className={styles.urlInput} value={tool} onChange={(e) => setTool(e.target.value)}
                  placeholder="инструмент" aria-label="Инструмент MCP" disabled={busy}
                  list={`mcp-tools-${sel.name}`} />
                <datalist id={`mcp-tools-${sel.name}`}>
                  {(sel.tools ?? []).map((t) => <option key={t.name} value={t.name} />)}
                </datalist>
                <Button type="submit" size="sm" disabled={busy || !tool.trim()}>
                  {busy ? 'Отправляю…' : 'Отправить заявку'}
                </Button>
              </div>
              <div className={styles.urlRow}>
                <textarea className={styles.urlInput} value={argsJson}
                  onChange={(e) => setArgsJson(e.target.value)}
                  placeholder='{"аргументы": "JSON"}' aria-label="Аргументы JSON" disabled={busy} rows={2} />
              </div>
              {callErr && <p className={styles.error} role="alert">Хост не ответил: {callErr}</p>}
              {callRes && <p className={styles.hint} role="status">{callRes}</p>}
            </form>
          )}
        </>
      )}
    </GlassPanel>
  );
}

/** OpenCode integration (opencode-integration-spec.md): MCP-серверы из конфига OpenCode — read-only. */
function OpenCodeMcpPanel() {
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const seam = ds.opencode;
  const catalog = useAsyncValue(
    () => (seam != null ? seam.listMcpServers() : Promise.resolve(null)),
    [seam],
  );
  const state = seam == null ? 'unavailable'
    : catalog.failed ? 'error'
      : catalog.value == null ? 'loading'
        : catalog.value.length === 0 ? 'empty' : 'ready';

  return (
    <GlassPanel className={styles.controlPanel} data-testid="opencode-mcp-servers" data-state={state}>
      <h2 className={styles.sectionTitle}>OpenCode MCP-серверы</h2>
      {seam == null ? (
        <EmptyState variant="inline" title="Нет данных" reason="сервис OpenCode не подключён (URL не задан или недоступен)" />
      ) : catalog.failed ? (
        <ErrorState variant="inline" title="Каталог MCP OpenCode не загрузился" onRetry={catalog.retry} retryLabel="Повторить" />
      ) : catalog.value == null ? (
        <LoadingState>Читаю каталог MCP OpenCode…</LoadingState>
      ) : catalog.value.length === 0 ? (
        <EmptyState variant="inline" title="Нет данных" body="OpenCode не объявил MCP-серверов." />
      ) : (
        <ul className={styles.runList} aria-label="MCP-серверы OpenCode">
          {catalog.value.map((s) => (
            <li key={s.name} className={styles.runRow} data-testid={`oc-mcp-${s.name}`}>
              <span className={styles.runTask}>{s.name}</span>
              <span className={styles.runMeta}>
                {s.url ?? '—'}{s.connected != null ? ` · ${s.connected ? 'подключён' : 'отключён'}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}

/** XIV W3 — «Правила проекта»: GET /v1/sdk/rules (sdk-rules-contract).
 *  Только метаданные файлов (путь/размер/источник) — содержимое хост не
 *  отдаёт и не исполняет. За AI2_SDK_ENABLED → 503 verbatim без флага. */
function RulesPanel() {
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const seam = ds.sdkRules;
  const rules = useAsyncValue(
    () => (seam != null ? seam.list() : Promise.resolve(null)),
    [seam],
  );

  const state = seam == null ? 'unavailable'
    : rules.failed ? 'error'
      : rules.value == null ? 'loading'
        : rules.value.rules.length === 0 ? 'empty' : 'ready';

  return (
    <GlassPanel className={styles.controlPanel} data-testid="sdk-rules" data-state={state}>
      <h2 className={styles.sectionTitle}>Правила проекта</h2>
      {seam == null ? (
        <EmptyState variant="inline" title="Нет данных" reason="источник не реализует чтение правил проекта" />
      ) : rules.failed ? (
        <ErrorState variant="inline" title="Правила проекта не загрузились" onRetry={rules.retry} retryLabel="Повторить" />
      ) : rules.value == null ? (
        <LoadingState>Читаю правила…</LoadingState>
      ) : (
        <>
          {rules.value.root != null && <p className={styles.hint}>Каталог: {rules.value.root}</p>}
          {rules.value.rules.length === 0 ? (
            <EmptyState variant="inline" title="Нет данных"
              body="Правил нет — AGENTS.md, CLAUDE.md, .clinerules, .continue/rules и .cursor/rules не найдены." />
          ) : (
            <ul className={styles.runList} aria-label="Правила проекта">
              {rules.value.rules.map((r) => (
                <li key={`${r.source}:${r.path}`} className={styles.runRow}>
                  <span className={styles.runTask}>{r.path}</span>
                  <span className={styles.runMeta}>
                    {r.source}{r.sizeBytes != null ? ` · ${r.sizeBytes} Б` : ''}
                    {r.mtimeMs != null
                      ? ` · ${new Date(r.mtimeMs).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.hint}>Отдаются только метаданные — содержимое файлов не читается и не исполняется.</p>
        </>
      )}
    </GlassPanel>
  );
}

export function FileViewerScreen() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [urlInput, setUrlInput] = useState('https://');
  const [message, setMessage] = useState('Выберите локальный файл или откройте веб-адрес. Файлы остаются на устройстве.');
  const [busy, setBusy] = useState(false);

  useEffect(() => () => {
    if (preview && preview.kind !== 'text') URL.revokeObjectURL(preview.url);
  }, [preview]);

  async function selectFile(file?: File) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setPreview(null);
      setMessage('Файл больше лимита 100 МБ.');
      return;
    }
    const kind = classify(file);
    if (!kind) {
      setPreview(null);
      setMessage('Формат не поддерживается. Доступны изображения, текст, PDF и видео.');
      return;
    }
    if (kind === 'text') {
      if (file.size > MAX_TEXT_BYTES) {
        setPreview(null);
        setMessage('Текстовый файл больше лимита 5 МБ.');
        return;
      }
      try {
        const text = await file.text();
        setPreview({ kind, name: file.name, text, size: file.size });
        setMessage('Текст открыт локально; содержимое не загружалось в сеть.');
      } catch {
        setPreview(null);
        setMessage('Не удалось прочитать выбранный текстовый файл.');
      }
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreview({ kind, name: file.name, url: objectUrl, size: file.size });
    setMessage('Файл открыт локально; доступ к остальной файловой системе не предоставлялся.');
  }

  async function openBrowser() {
    const url = allowedUrl(urlInput);
    if (!url) {
      setMessage('Введите полный URL с протоколом http:// или https://.');
      return;
    }
    if (!hasDesktopBridge()) {
      window.open(url, '_blank', 'noopener,noreferrer');
      setMessage('Запрос на открытие отправлен браузеру. Если вкладка не появилась, разрешите всплывающие окна и повторите.');
      return;
    }

    setBusy(true);
    try {
      const bridge = await getDesktopBridge({ timeoutMs: 0 });
      if (bridge.available && await bridge.openBrowser(url)) {
        setMessage('Веб-адрес открыт в отдельном Chromium-окне без доступа к мосту приложения.');
        return;
      }
      setMessage('Не удалось открыть отдельное окно Chromium. Повторите попытку из окна NEXUS.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.page} data-screen="media-viewer" aria-labelledby="media-viewer-title">
      <p className={styles.eyebrow}>NEXUS · WORKSPACE</p>
      <PanelHeader
        level="screen"
        divider={false}
        titleId="media-viewer-title"
        title="Библиотека"
        subtitle="Прогоны рантайма, локальные файлы и веб-страницы в Chromium."
        actions={<StatusBadge status="info" label="ЛОКАЛЬНЫЙ ПРОСМОТР" />}
      />

      <RunsLibrary />

      {/* XIV W3: каталоги библиотеки — MCP-серверы, правила проекта,
          промпты и сохранённые сценарии. */}
      <McpServersPanel />

      <OpenCodeMcpPanel />

      <RulesPanel />

      <PromptsLibrary />

      <div className={styles.body}>
        <div className={styles.sourcesRail}>
          <h2 className={styles.sectionTitle}>Источники</h2>
          <GlassPanel className={styles.controlPanel}>
            <h2 className={styles.sectionTitle}>Открыть файл</h2>
            <label className={styles.filePicker}>
              <span>Выбрать изображение, текст, PDF или видео</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml,.txt,.md,.json,.csv,.log,.yaml,.yml,.xml,.pdf,video/mp4,video/webm,video/ogg"
                onChange={(event) => { void selectFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }}
              />
            </label>
            <p className={styles.hint}>Лимит файла — 100 МБ; для текстовых документов — 5 МБ. Файл читается браузером после вашего выбора.</p>
          </GlassPanel>

          <GlassPanel className={styles.controlPanel}>
            <h2 className={styles.sectionTitle}>Открыть веб-адрес</h2>
            <label className={styles.urlLabel} htmlFor="browser-url">URL</label>
            <div className={styles.urlRow}>
              <input id="browser-url" className={styles.urlInput} type="url" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://example.com" />
              <Button size="sm" onClick={() => void openBrowser()} disabled={busy}>{busy ? 'Открываю…' : 'Открыть'}</Button>
            </div>
            <p className={styles.hint}>Поддерживаются только http:// и https://. В отдельном окне внешний сайт не получает мост NEXUS.</p>
          </GlassPanel>
        </div>

        <GlassPanel className={styles.previewPanel} data-state={busy ? 'loading' : preview ? 'ready' : 'empty'} data-testid="media-viewer-preview">
          {preview ? (
            <>
              <div className={styles.previewHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>{preview.name}</h2>
                  <p className={styles.hint}>{preview.kind} · {sizeLabel(preview.size)}</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => { setPreview(null); setMessage('Предпросмотр закрыт.'); }}>Закрыть</Button>
              </div>
              <div className={styles.preview} data-kind={preview.kind}>
                {preview.kind === 'image' && <img loading="lazy" decoding="async" className={styles.image} src={preview.url} alt={preview.name} />}
                {preview.kind === 'text' && <pre className={styles.text}>{preview.text}</pre>}
                {preview.kind === 'pdf' && <iframe className={styles.document} src={preview.url} title={`PDF: ${preview.name}`} referrerPolicy="no-referrer" />}
                {preview.kind === 'video' && <video className={styles.video} src={preview.url} controls preload="metadata">Браузер не поддерживает этот видеоформат.</video>}
              </div>
            </>
          ) : (
            <div className={styles.empty}>
              <span className={styles.emptyMark} aria-hidden="true">◈</span>
              <h2 className={styles.sectionTitle}>Предпросмотр</h2>
              <p className={styles.hint}>После выбора файла его содержимое появится здесь.</p>
            </div>
          )}
        </GlassPanel>
      </div>

      <p className={styles.message} role="status" aria-live="polite">{message}</p>
    </section>
  );
}
