'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, GlassPanel, PanelHeader } from '@nexus/ui';
import {
  EventRow, FileDiffRow, PermissionMode, ReadinessItem, SessionStatus,
  WorkspacePicker,
} from '@nexus/ui';
import type {
  FileDiffState, RuntimeEventKind, WorkspaceRoot,
} from '@nexus/ui';
import { isAi2ApiError } from '../../integrations/ai2/api/errors';
import type {
  Ai2WorkerMode, Ai2WorkerStatus,
} from '../../integrations/ai2/contracts/worker';
import type { FsPolicy } from '../../integrations/ai2/contracts/fs';
import { getDesktopBridge } from '../../integrations/ai2/desktop-bridge/adapter';
import { getDataSource, useDataSource, getDataSourceKind } from '../data-source';
import { useProfile } from '../profile/profile-store';
import { useAsyncValue } from '../use-async-value';
import { runWhileDocumentVisible } from '../visible-interval';
import type { ReadinessState } from '@nexus/ui';
import styles from './screens.module.css';

/** Одна запись ленты — только наблюдаемые op-запросы/ответы этой сессии
 *  (W3-карточка §7): журнал хоста по HTTP не отдаётся, «что было до» не
 *  выдумываем. Содержимое файлов в ленту не пишем — только операцию и путь. */
interface FeedItem {
  id: number;
  kind: RuntimeEventKind;
  time: string;
  actor: string;
  source: string;
  body: string;
}

interface ListEntry { name: string; dir: boolean; size: number }
interface ListResult { path: string; entries: ListEntry[]; truncated?: boolean }
interface ReadResult { path: string; content: string; truncated?: boolean; size: number }
interface SearchResult { path: string; results: { path: string; line: number; text: string }[]; scanned_files: number; truncated?: boolean }
interface CheckpointRec { checkpoint_id: string; path_rel: string; root_index: number; sha256: string; size: number; existed: boolean; ts: number }
interface WriteResult { path: string; written: number; checkpoint_id: string; replaced: boolean }
interface RollbackResult { path: string; verified: boolean }

interface DiffRow {
  checkpointId: string;
  path: string;
  size: number;
  existed: boolean;
  ts: number;
  state: FileDiffState;
  diff?: string | null;
  diffOpen?: boolean;
}

const MODE_LABEL: Record<Ai2WorkerMode, string> = {
  observe: 'только чтение',
  approve_each: 'подтверждать каждое действие',
  autonomy: 'автономия',
};

function fmtClock(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Текст ошибки worker-операции — verbatim от хоста (kind:… — в message). */
function errText(e: unknown): string {
  if (isAi2ApiError(e)) return `${e.status} · ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

let feedSeq = 0;

export function LocalAgentScreen() {
  const ds = useDataSource();
  const dsKind = useMemo(getDataSourceKind, []);
  const router = useRouter();
  const { profile } = useProfile();
  const workerSeam = ds.worker ?? null;

  // --- lifecycle ------------------------------------------------------------
  const status = useAsyncValue(
    () => (ds.workerStatus == null ? Promise.resolve(null) : ds.workerStatus()),
    [ds],
  );
  const w: Ai2WorkerStatus | null = status.value;
  const grant = w?.grant ?? null;
  const grantLive = w?.state === 'ready' && grant != null && grant.revoked !== true;

  // polling пока worker стартует — честный переход starting→ready
  useEffect(() => {
    if (w?.state !== 'starting') return;
    return runWhileDocumentVisible(() => status.retry(), 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w?.state]);

  // --- запуск: кандидаты корней + режим + ttl ---------------------------------
  const [candidates, setCandidates] = useState<WorkspaceRoot[]>([]);
  const [pathInput, setPathInput] = useState('');
  const [mode, setMode] = useState<Ai2WorkerMode>('observe');
  const [ttlInput, setTtlInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // --- лента действий (§7) ----------------------------------------------------
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const pushFeed = useCallback((kind: RuntimeEventKind, body: string, actor = 'user') => {
    feedSeq += 1;
    setFeed((f) => [...f.slice(-99), { id: feedSeq, kind, time: fmtClock(Date.now()), actor, source: 'worker', body }]);
  }, []);

  // --- op-вызов с лентой и verbatim-ошибкой ------------------------------------
  const op = useCallback(async (opName: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    if (workerSeam == null) throw new Error('worker-seam недоступен');
    try {
      const res = await workerSeam.request({ op: opName, args });
      pushFeed('result', `${opName}${args.path != null ? ` · ${String(args.path)}` : args.pattern != null ? ` · ${String(args.pattern)}` : ''} — ок`, 'worker');
      return res;
    } catch (e) {
      pushFeed('error', `${opName}${args.path != null ? ` · ${String(args.path)}` : ''} — ${errText(e)}`, 'worker');
      throw e;
    }
  }, [workerSeam, pushFeed]);

  // --- lifecycle действия -----------------------------------------------------
  const doLaunch = useCallback(async () => {
    if (workerSeam == null || busy != null) return;
    setErr(null); setNotice(null); setBusy('launch');
    try {
      const ttl = ttlInput.trim() === '' ? undefined : Number(ttlInput);
      const res = await workerSeam.launch({
        roots: candidates.map((c) => c.path),
        mode,
        ...(ttl != null && Number.isFinite(ttl) && ttl > 0 ? { ttlS: Math.min(86400, ttl) } : {}),
      });
      status.set(res.worker);
      pushFeed('checkpoint', `launch — грант ${res.grant.grantId.slice(0, 8)} · ${res.grant.roots.length} корн(ей) · ${res.grant.mode}`);
    } catch (e) {
      if (isAi2ApiError(e) && e.status === 409) {
        // W3 §2: 409 = worker уже жив — перечитать статус, не молчать.
        setNotice('Worker уже запущен — показываю действующий грант.');
        try { status.set((await workerSeam.status())); } catch { /* статус перечитаем позже */ }
      } else {
        setErr(errText(e));
      }
    } finally {
      setBusy(null);
    }
  }, [workerSeam, busy, candidates, mode, ttlInput, status, pushFeed]);

  const doRevoke = useCallback(async () => {
    if (workerSeam == null || busy != null) return;
    setErr(null); setBusy('revoke');
    try { status.set(await workerSeam.revoke()); pushFeed('checkpoint', 'revoke — грант отозван'); }
    catch (e) { setErr(errText(e)); }
    finally { setBusy(null); }
  }, [workerSeam, busy, status, pushFeed]);

  const doShutdown = useCallback(async () => {
    if (workerSeam == null || busy != null) return;
    setErr(null); setBusy('shutdown');
    try { status.set(await workerSeam.shutdown()); pushFeed('info', 'shutdown — worker остановлен'); }
    catch (e) { setErr(errText(e)); }
    finally { setBusy(null); }
  }, [workerSeam, busy, status, pushFeed]);

  // --- браузер workspace ------------------------------------------------------
  const [dirPath, setDirPath] = useState<string | null>(null);
  const [dir, setDir] = useState<ListResult | null>(null);
  const [dirErr, setDirErr] = useState<string | null>(null);
  const [file, setFile] = useState<ReadResult | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [search, setSearch] = useState<SearchResult | null>(null);

  const openDir = useCallback(async (p: string) => {
    setDirErr(null); setFile(null); setFileErr(null); setSearch(null);
    try { const res = (await op('list', { path: p })) as ListResult; setDir(res); setDirPath(res.path); }
    catch (e) { setDirErr(errText(e)); setDir(null); setDirPath(p); }
  }, [op]);

  const openFile = useCallback(async (p: string) => {
    setFileErr(null);
    try { setFile((await op('read', { path: p, max_chars: 8000 })) as ReadResult); }
    catch (e) { setFileErr(errText(e)); setFile(null); }
  }, [op]);

  const doSearch = useCallback(async () => {
    if (dirPath == null || !searchQ.trim()) return;
    try { setSearch((await op('search', { path: dirPath, pattern: searchQ.trim() })) as SearchResult); }
    catch { setSearch(null); /* ошибка уже в ленте */ }
  }, [op, dirPath, searchQ]);

  // --- изменения: write (approve_each подтверждение), checkpoints, diff, rollback
  const [writePath, setWritePath] = useState('');
  const [writeContent, setWriteContent] = useState('');
  const [pendingWrite, setPendingWrite] = useState<null | { path: string; content: string }>(null);
  const [diffs, setDiffs] = useState<DiffRow[]>([]);

  const refreshCheckpoints = useCallback(async () => {
    try {
      const res = (await op('list_checkpoints')) as { checkpoints?: CheckpointRec[] };
      setDiffs((res.checkpoints ?? []).map((c) => ({
        checkpointId: c.checkpoint_id, path: c.path_rel, size: c.size,
        existed: c.existed, ts: c.ts, state: 'pending' as const,
      })));
    } catch { /* ошибка в ленте */ }
  }, [op]);

  const confirmWrite = useCallback(async () => {
    if (pendingWrite == null) return;
    const w2 = pendingWrite; setPendingWrite(null);
    try {
      const res = (await op('write', { path: w2.path, content: w2.content })) as WriteResult;
      pushFeed('file', `записано ${res.written} Б → ${res.path} · checkpoint ${res.checkpoint_id.slice(0, 8)}`, 'worker');
      await refreshCheckpoints();
    } catch { /* в ленте */ }
  }, [pendingWrite, op, pushFeed, refreshCheckpoints]);

  const openDiff = useCallback(async (checkpointId: string, idx: number) => {
    const row = diffs[idx];
    if (row?.diffOpen) { setDiffs((d) => d.map((x, j) => (j === idx ? { ...x, diffOpen: false } : x))); return; }
    try {
      const res = (await op('diff', { checkpoint_id: checkpointId })) as { diff: string; truncated?: boolean };
      setDiffs((d) => d.map((x, j) => (j === idx ? { ...x, diff: res.diff || '(diff пуст — файл совпадает со снапшотом)', diffOpen: true } : x)));
    } catch { /* в ленте */ }
  }, [diffs, op]);

  const doRollback = useCallback(async (checkpointId: string, idx: number) => {
    try {
      const res = (await op('rollback', { checkpoint_id: checkpointId })) as RollbackResult;
      pushFeed('checkpoint', `rollback ${checkpointId.slice(0, 8)} → ${res.path} · verified=${res.verified}`, 'worker');
      setDiffs((d) => d.map((x, j) => (j === idx ? { ...x, state: 'restored' as const } : x)));
    } catch { /* в ленте */ }
  }, [op, pushFeed]);

  // --- цель → исполнение через Runtime (§9: прогон с fs_policy на grant.roots) --
  const [goal, setGoal] = useState('');
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalErr, setGoalErr] = useState<string | null>(null);
  const runGoal = useCallback(async () => {
    if (!goal.trim() || grant == null || grant.roots.length === 0) return;
    setGoalErr(null); setGoalBusy(true);
    const fsMode = mode === 'autonomy' ? 'read_write' : 'read_only';
    const fsPolicy: FsPolicy = {
      mode: fsMode,
      requestWrites: mode === 'approve_each',
      roots: grant.roots.map((p, i) => ({ id: `root${i + 1}`, path: p, access: fsMode === 'read_write' ? 'rw' as const : 'ro' as const })),
    };
    try {
      await ds.startRun({
        task: goal.trim(),
        config: profile?.defaultPreset ?? 'baseline',
        model: profile?.defaultModelId ?? null,
        useMemory: profile?.useMemory === true,
        project: profile?.useMemory === true ? (profile.memoryProject?.trim() || 'ai2') : null,
        fsPolicy,
      });
      pushFeed('plan', `цель → Runtime-прогон (${fsMode}${fsPolicy.requestWrites ? ', заявки на запись' : ''})`);
      router.push('/runtime');
    } catch (e) { setGoalErr(errText(e)); }
    finally { setGoalBusy(false); }
  }, [goal, grant, mode, ds, profile, router, pushFeed]);

  // --- readiness: ОС через bridge.app_info, инструменты из grant.commands -----
  const os = useAsyncValue(async () => {
    const bridge = await getDesktopBridge({ timeoutMs: 1500 }).catch(() => null);
    return bridge == null ? null : bridge.appInfo();
  }, []);
  const grantCmds = useMemo(() => {
    const g = w?.grant as { commands?: string[][] } | undefined;
    return g?.commands ?? null;
  }, [w?.grant]);

  const workerStateReady: ReadinessState =
    ds.workerStatus == null ? 'unavailable'
      : status.failed ? 'unknown'
        : w == null ? 'checking'
          : w.state === 'ready' ? 'ready'
            : w.state === 'starting' ? 'checking'
              : 'unavailable';

  const canWrite = grantLive && grant.ops.includes('write');
  const canRollback = grantLive && grant.ops.includes('rollback');
  const sessionState =
    w?.state === 'ready' ? (grantLive ? 'idle' : 'stopped')
      : w?.state === 'starting' ? 'starting'
        : w?.state === 'crashed' ? 'error' : 'unavailable';

  return (
    <div className={styles.page} data-screen="local-agent" aria-labelledby="local-agent-title">
      <PanelHeader level="screen" divider={false} titleId="local-agent-title" title={<>Local Agent {dsKind === 'mock' && <span className={styles.selectSub}>· mock — worker-контура нет</span>}</>} />
      <p className={styles.disclaimer}>
        Локальный worker хоста: грант на папки → ограниченные операции (read/list/search/write/exec)
        → checkpoint и rollback. Всё, что видит экран, приходит от хоста — без имитации.
      </p>

      <div className={styles.twoCol}>
        {/* ── Жизненный цикл worker ── */}
        <GlassPanel className={styles.panel} data-state={w?.state === 'ready' ? 'ready' : w?.state ?? 'empty'} data-testid="la-worker">
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Worker</h2>
            <SessionStatus state={sessionState} />
          </div>
          {workerSeam == null ? (
            <p className={styles.emptyHint} data-testid="la-worker-unavailable">
              Worker-контур недоступен в этом источнике данных — mock не имитирует файловую власть.
            </p>
          ) : (
            <>
              <div className={styles.prefRow}>
                <span className={styles.prefLabel}>Состояние</span>
                <span className={styles.selectSub} data-testid="la-worker-state">
                  {status.failed ? 'статус не загрузился' : w == null ? 'запрос статуса…' : w.state}
                  {w?.pid != null && ` · pid ${w.pid}`}
                  {w?.restarts != null && w.restarts > 0 && ` · рестартов ${w.restarts}`}
                  {w?.uptimeS != null && ` · uptime ${Math.round(w.uptimeS)}с`}
                </span>
              </div>
              {status.failed && (
                <button type="button" className={styles.linkBtn} onClick={status.retry}>
                  Повторить запрос статуса
                </button>
              )}
              {w?.state === 'crashed' && (
                <p className={styles.error} role="alert">
                  Worker упал — операции недоступны{w.maxRestarts != null ? ` (лимит рестартов ${w.maxRestarts})` : ''}. Перезапустите.
                </p>
              )}
              {grant != null && (
                <div className={styles.grantView} data-testid="la-grant">
                  <div className={styles.prefRow}>
                    <span className={styles.prefLabel}>Грант</span>
                    <span className={styles.selectSub}>{grant.grantId.slice(0, 8)} · {grant.mode}{grant.revoked ? ' · отозван' : ''}</span>
                  </div>
                  <div className={styles.prefRow}>
                    <span className={styles.prefLabel}>ops</span>
                    <span className={styles.selectSub}>{grant.ops.join(' · ')}</span>
                  </div>
                  <div className={styles.prefRow}>
                    <span className={styles.prefLabel}>Истекает</span>
                    <span className={styles.selectSub}>{grant.expiresAt ?? 'без срока'}</span>
                  </div>
                </div>
              )}
              {notice && <p className={styles.emptyHint} role="status">{notice}</p>}
              {err && <p className={styles.error} role="alert">{err}</p>}
              <div className={styles.formRow}>
                {(w?.state === 'down' || w?.state === 'crashed' || w == null) && (
                  <Button variant="primary" size="sm"
                    disabled={busy != null || candidates.length === 0}
                    title={candidates.length === 0 ? 'Сначала добавьте рабочую папку ниже' : 'Запустить worker с грантом на выбранные папки'}
                    onClick={() => void doLaunch()}
                  >
                    {busy === 'launch' ? 'Запуск…' : 'Запустить worker'}
                  </Button>
                )}
                {grantLive && (
                  <Button variant="ghost" size="sm" disabled={busy != null} onClick={() => void doRevoke()}>
                    {busy === 'revoke' ? 'Отзыв…' : 'Отозвать грант'}
                  </Button>
                )}
                {w?.state === 'ready' && (
                  <Button variant="danger" size="sm" disabled={busy != null} onClick={() => void doShutdown()}>
                    {busy === 'shutdown' ? 'Остановка…' : 'Остановить'}
                  </Button>
                )}
              </div>
            </>
          )}
        </GlassPanel>

        {/* ── Рабочие папки ── */}
        <GlassPanel className={styles.panel} data-state={(grant?.roots.length ?? candidates.length) > 0 ? 'ready' : 'empty'} data-testid="la-workspace">
          <h2 className={styles.panelTitle}>Рабочие папки</h2>
          {grant != null ? (
            // После launch список = grant.roots verbatim от хоста (канонизирован);
            // грант не редактируется — удаления нет, только новый launch.
            <>
              <ul className={styles.fsRootList}>
                {grant.roots.map((p) => (
                  <li key={p} className={styles.fsRootLine} title={p}>{p}</li>
                ))}
              </ul>
              <p className={styles.emptyHint}>Корни зафиксированы грантом — изменить состав можно только новым запуском.</p>
            </>
          ) : (
            <>
              <WorkspacePicker
                roots={candidates}
                onRemove={(path) => setCandidates((r) => r.filter((x) => x.path !== path))}
              />
              <div className={styles.formRow}>
                <input
                  className={styles.input}
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  placeholder="D:/path/to/folder"
                  aria-label="Путь рабочей папки"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && pathInput.trim()) {
                      const p = pathInput.trim();
                      setCandidates((r) => (r.some((x) => x.path === p) ? r : [...r, { path: p, state: 'granted' as const }]));
                      setPathInput('');
                    }
                  }}
                />
                <Button variant="secondary" size="sm" disabled={!pathInput.trim()}
                  onClick={() => {
                    const p = pathInput.trim();
                    setCandidates((r) => (r.some((x) => x.path === p) ? r : [...r, { path: p, state: 'granted' as const }]));
                    setPathInput('');
                  }}>
                  + папка
                </Button>
              </div>
              <p className={styles.emptyHint}>
                Путь проверяет и канонизирует хост при запуске — ошибки показываются его словами.
              </p>
            </>
          )}
          <div className={styles.prefRow}>
            <span className={styles.prefLabel}>Разрешения</span>
            <span className={styles.prefChoices}>
              {(['observe', 'approve_each', 'autonomy'] as Ai2WorkerMode[]).map((m) => (
                <button key={m} type="button" className={styles.prefChoice}
                  data-selected={mode === m}
                  disabled={grant != null || (m === 'autonomy' && ttlInput.trim() === '')}
                  title={m === 'autonomy' && ttlInput.trim() === ''
                    ? 'Автономия включается только с границей — задайте TTL гранта'
                    : grant != null ? 'Режим зафиксирован грантом' : MODE_LABEL[m]}
                  onClick={() => setMode(m)}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </span>
          </div>
          <PermissionMode mode={mode === 'approve_each' ? 'approve-each' : 'observe'} showDescription />
          <div className={styles.prefRow}>
            <span className={styles.prefLabel}>TTL гранта</span>
            <input
              className={`${styles.input} ${styles.ttlInput}`}
              value={ttlInput}
              onChange={(e) => setTtlInput(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="сек (≤86400)"
              aria-label="TTL гранта в секундах"
              disabled={grant != null}
            />
            <span className={styles.selectSub}>{grant?.expiresAt ?? 'без срока'}</span>
          </div>
        </GlassPanel>
      </div>

      {/* ── Браузер workspace ── */}
      <GlassPanel className={styles.panel} data-state={grantLive ? 'ready' : 'unavailable'} data-testid="la-browser">
        <h2 className={styles.panelTitle}>Файлы workspace</h2>
        {!grantLive ? (
          <p className={styles.emptyHint}>
            {w?.state === 'ready' && grant?.revoked === true
              ? 'Грант отозван — файловые операции отвечают revoked. Перезапустите worker.'
              : 'Браузер заработает после запуска worker с живым грантом — до гранта ничего не сканируем.'}
          </p>
        ) : (
          <>
            <div className={styles.prefRow}>
              <span className={styles.prefLabel}>Корни</span>
              <span className={styles.prefChoices}>
                {grant.roots.map((p) => (
                  <button key={p} type="button" className={styles.prefChoice}
                    data-selected={dirPath != null && (p === dirPath || dirPath.startsWith(p))}
                    title={p} onClick={() => void openDir(p)}>
                    {p.split(/[\\/]/).pop() || p}
                  </button>
                ))}
              </span>
            </div>
            {dirErr && <p className={styles.error} role="alert">{dirErr}</p>}
            {dir != null && (
              <div className={styles.fileBrowser}>
                <div className={styles.fileCrumb} title={dir.path}>{dir.path}{dir.truncated ? ' · показана часть' : ''}</div>
                <ul className={styles.fileList}>
                  {dir.entries.map((en) => (
                    <li key={en.name}>
                      <button type="button" className={styles.fileRow}
                        onClick={() => void (en.dir ? openDir(`${dir.path}/${en.name}`) : openFile(`${dir.path}/${en.name}`))}>
                        {en.dir ? '📁' : '📄'} {en.name}
                        {!en.dir && <span className={styles.selectSub}> · {en.size} Б</span>}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className={styles.formRow}>
                  <input
                    className={styles.input}
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder="regex по файлам этой папки (рекурсивно)"
                    aria-label="Поиск по workspace"
                    onKeyDown={(e) => { if (e.key === 'Enter') void doSearch(); }}
                  />
                  <Button variant="secondary" size="sm" disabled={!searchQ.trim()} onClick={() => void doSearch()}>Искать</Button>
                </div>
                {search != null && (
                  <ul className={styles.fileList} data-testid="la-search-results">
                    {search.results.length === 0 && <li className={styles.emptyHint}>совпадений нет (проверено {search.scanned_files} файлов)</li>}
                    {search.results.map((r, i) => (
                      <li key={i} className={styles.fileRow}>
                        {r.path}:{r.line} <span className={styles.selectSub}>{r.text.slice(0, 120)}</span>
                      </li>
                    ))}
                    {search.truncated && <li className={styles.selectSub}>показана часть результатов</li>}
                  </ul>
                )}
              </div>
            )}
            {fileErr && <p className={styles.error} role="alert">{fileErr}</p>}
            {file != null && (
              <div className={styles.filePreview} data-testid="la-file-preview">
                <div className={styles.fileCrumb}>{file.path} · {file.size} Б{file.truncated ? ' · усечено' : ''}</div>
                <pre className={styles.fileText}>{file.content}</pre>
              </div>
            )}
          </>
        )}
      </GlassPanel>

      <div className={styles.twoCol}>
        {/* ── Изменения ── */}
        <GlassPanel className={styles.panel} data-state={diffs.length > 0 ? 'ready' : 'empty'} data-testid="la-diffs">
          <h2 className={styles.panelTitle}>Изменения</h2>
          {!canWrite ? (
            <p className={styles.emptyHint}>
              {grant == null
                ? 'Запись появится после запуска worker — в режиме observe её нет в гранте.'
                : `Запись недоступна — ops гранта: ${grant.ops.join(', ')}.`}
            </p>
          ) : (
            <div className={styles.formRow}>
              <input className={styles.input} value={writePath} onChange={(e) => setWritePath(e.target.value)}
                placeholder="относительный путь в workspace" aria-label="Путь файла для записи" />
              <input className={styles.input} value={writeContent} onChange={(e) => setWriteContent(e.target.value)}
                placeholder="содержимое" aria-label="Содержимое файла" />
              <Button variant="primary" size="sm" disabled={!writePath.trim() || !writeContent}
                onClick={() => setPendingWrite({ path: writePath.trim(), content: writeContent })}>
                Записать
              </Button>
            </div>
          )}
          {pendingWrite != null && (
            <div className={styles.approvalCard} role="group" aria-label="Подтверждение записи">
              <p className={styles.chatText}>
                Записать <b>{pendingWrite.path}</b> — {pendingWrite.content.length} символов?
                {mode === 'approve_each' ? ' (режим подтверждения каждого действия)' : ''}
              </p>
              <div className={styles.formRow}>
                <Button variant="primary" size="sm" onClick={() => void confirmWrite()}>Разрешить</Button>
                <Button variant="ghost" size="sm" onClick={() => { pushFeed('error', `write · ${pendingWrite.path} — отклонено пользователем`); setPendingWrite(null); }}>Отклонить</Button>
              </div>
            </div>
          )}
          {diffs.map((d, i) => (
            <div key={d.checkpointId}>
              <FileDiffRow
                path={d.path}
                additions={d.size}
                deletions={d.existed ? undefined : 0}
                state={d.state}
                onOpen={() => void openDiff(d.checkpointId, i)}
                onRestore={d.state !== 'restored' && canRollback ? () => void doRollback(d.checkpointId, i) : undefined}
              />
              {d.diffOpen && d.diff != null && (
                <pre className={styles.diffText} data-testid="la-diff-text">{d.diff}</pre>
              )}
            </div>
          ))}
          {grantLive && diffs.length === 0 && canWrite && (
            <p className={styles.emptyHint}>Записей ещё не было — перед каждой создаётся checkpoint, откат через rollback.</p>
          )}
        </GlassPanel>

        {/* ── Лента действий ── */}
        <GlassPanel className={styles.panel} data-state={feed.length > 0 ? 'ready' : 'empty'} data-testid="la-feed">
          <h2 className={styles.panelTitle}>Лента действий</h2>
          {feed.length === 0 ? (
            <p className={styles.emptyHint}>Действий не было — сюда попадут реальные ответы worker на операции этой сессии.</p>
          ) : (
            feed.map((e) => (
              <EventRow key={e.id} kind={e.kind} time={e.time} actor={e.actor} source={e.source}>
                {e.body}
              </EventRow>
            ))
          )}
          {/* wave-2 W3-4: журнал прошлых сессий — хостовый /v1/worker/audit
              ещё не отдан (W1-карточка волны). Честный unavailable-ряд;
              когда seam появится — сольём с пометкой «сессия» vs «журнал». */}
          <p className={styles.emptyHint} data-state="unavailable" data-testid="la-audit-unavailable">
            Журнал хоста недоступен: аудит прошлых сессий гранта ждёт хостовый /v1/worker/audit.
          </p>
        </GlassPanel>
      </div>

      <div className={styles.twoCol}>
        {/* ── Цель → исполнение ── */}
        <GlassPanel className={styles.panel} data-state={grantLive ? 'ready' : 'unavailable'} data-testid="la-goal">
          <h2 className={styles.panelTitle}>Цель</h2>
          <div className={styles.formRow}>
            <input
              className={styles.input}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Задача для AGENT-A в этих папках…"
              aria-label="Цель сессии"
            />
            <Button variant="primary" size="sm"
              disabled={!goal.trim() || !grantLive || goalBusy}
              title={!grantLive ? 'Исполнение идёт с fs_policy на корни живого гранта' : 'Прогон Runtime с fs_policy на корни гранта'}
              onClick={() => void runGoal()}
            >
              {goalBusy ? 'Запуск…' : 'Исполнить через Runtime'}
            </Button>
          </div>
          <p className={styles.emptyHint}>
            Исполнение — прогон AGENT-A с fs_policy на корни гранта ({mode === 'autonomy' ? 'read_write' : 'read_only'}{mode === 'approve_each' ? ', записи через заявки' : ''}). План и ход — на экране Runtime.
          </p>
          {goalErr && <p className={styles.error} role="alert">{goalErr}</p>}
        </GlassPanel>

        {/* ── Готовность среды ── */}
        <GlassPanel className={styles.panel} data-state="ready" data-testid="la-readiness">
          <h2 className={styles.panelTitle}>Готовность среды</h2>
          <ReadinessItem
            name="ОС"
            state={os.value == null ? (os.failed ? 'unknown' : 'checking') : os.value.desktop === true ? 'ready' : 'unavailable'}
            detail={os.value == null ? 'запрос bridge.app_info…' : `${os.value.platform ?? '—'} · ${os.value.app ?? ''} ${os.value.version ?? ''}`.trim()}
          />
          <ReadinessItem
            name="Local worker"
            state={workerStateReady}
            detail={
              ds.workerStatus == null ? 'адаптер не предоставляет статус worker'
                : status.failed ? 'статус не загрузился — см. повтор'
                  : w == null ? 'запрос статуса…'
                    : w.state === 'down' ? 'не запущен — исполнение недоступно'
                      : w.state === 'crashed' ? `упал${w.restarts != null ? ` — рестартов: ${w.restarts}` : ''}`
                        : w.state === 'starting' ? 'запускается'
                          : `запущен${w.pid != null ? ` · pid ${w.pid}` : ''}`
            }
          />
          <ReadinessItem
            name="Инструменты"
            state={grantCmds == null ? 'unknown' : grantCmds.length > 0 ? 'ready' : 'unavailable'}
            detail={grantCmds == null
              ? 'allowlist появится с грантом'
              : grantCmds.length > 0
                ? grantCmds.map((c) => c.join(' ')).join(' · ')
                : 'exec не выдан в гранте'}
          />
        </GlassPanel>
      </div>
    </div>
  );
}
