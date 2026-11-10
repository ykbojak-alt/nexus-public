'use client';

/** Вкладка «Процесс» — оркестратор состояния: выбор прогона, трейс, чат,
 * план, контур. Голос/ФС/SDK вынесены в use-process-voice/-fs/-sdk.
 * Выделено из runtime.tsx без смены поведения. */
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { AttachmentItem } from '@nexus/ui';
import type { ModelInfo, PresetInfo, RunEventView, RunPlan, RunStatus, RunSummary } from '@nexus/mock-data';
import type { FsPolicy } from '../../../integrations/ai2/contracts/fs';
import { isAi2ApiError } from '../../../integrations/ai2/api/errors';
import { getDataSource, useDataSource, getDataSourceKind } from '../../data-source';
import type { ChatCompactionConfig, ChatCompactionStatus } from '../../data-source';
import { matchesShortcut } from '../../keyboard-shortcuts';
import { useApiToast } from '../../api-toast';
import { useProfile } from '../../profile/profile-store';
import { fsOpsOf, fsRequestOf, fsResolutionOf, runReportMd, spawnHandleOf } from '../runtime-ops';
import type { FsRequestView } from '../runtime-ops';
import { CHAT_RESTORE_LIMIT, buildChatTask, chatHistoryRef, chatHistoryRunId, historyEntryToChatMsg, readChatSnapshot, stripChatTaskWrapper, writeChatSnapshot } from './shared';
import type { ChatMsg, ChatSnapshot } from './shared';
import { useProcessFs } from './use-process-fs';
import { useProcessSdk } from './use-process-sdk';
import { useProcessVoice } from './use-process-voice';
import {
  captureChatScrollAnchor,
  isChatPinnedToBottom,
  restoreChatScrollAnchor,
} from './chat-scroll-anchor';

/** W3-143: размер страницы истории и порог «верха» в px для догрузки. */
const CHAT_HISTORY_PAGE = 50;
const CHAT_HISTORY_TOP_PX = 64;
const CHAT_COMPACTION_STATUS_POLL_MS = 500;
const CHAT_COMPACTION_STATUS_TIMEOUT_MS = 30_000;

/** Compact deterministic 64-bit hash for comparing request snapshots in memory. */
function hashFingerprint(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ (code + i), 0x5bd1e995);
    right ^= right >>> 13;
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Отпечаток тела прогона для ключа идемпотентности.
 *
 * Хост считает хеш ТЕЛА запроса: повтор того же ключа с другим телом — это
 * 409 (idempotency conflict), а не «новый прогон». Поэтому отпечаток
 * покрывает ровно те поля, что уходят на провод: task (в него свёрнуты
 * контекст диалога и ответы), контур, агент, модель, память с проектом и
 * fs-политика. Отдельным элементом — отпечаток контекста: компрессия
 * контекста (buildChatTask) способна скрыть правку диалога от текста задачи.
 */
function runBodyFingerprint(body: {
  task: string;
  config: string;
  agent: string | null;
  model: string | null;
  useMemory?: boolean;
  project?: string;
  fsPolicy?: FsPolicy;
  context: string;
}): string {
  return hashFingerprint(JSON.stringify([
    ['task', body.task],
    ['config', body.config],
    ['agent', body.agent],
    ['model', body.model],
    ['useMemory', body.useMemory ?? null],
    ['project', body.project ?? null],
    ['fsPolicy', body.fsPolicy ?? null],
    ['context', body.context],
  ]));
}

/** Отпечаток контекста диалога: роли и тексты реплик + ответы прогонов. */
function chatContextDigest(chat: ChatMsg[], answers: Record<string, string | null>): string {
  const context = chat
    .map((m) => [m.role, (m.text ?? (m.runId != null ? answers[m.runId] : null) ?? '').trim()])
    .filter(([, text]) => text !== '');
  return hashFingerprint(JSON.stringify(context));
}

export function useProcessTab({ freeze = false }: { freeze?: boolean }) {
  const apiToast = useApiToast();
  const { profile } = useProfile();
  const params = useSearchParams();
  const router = useRouter();
  const ds = useDataSource();
  const dsKind = useMemo(getDataSourceKind, []);
  const [attachFailed, setAttachFailed] = useState(false);
  const [attachMissing, setAttachMissing] = useState<string | null>(null);

  // Wave-7: run settings live in Settings → Runtime — the composer reads the
  // profile defaults and shows them read-only. No per-run pickers here.
  const config = profile?.defaultPreset ?? 'baseline';
  const agent = profile?.defaultRunAgent ?? '';

  const [run, setRun] = useState<RunSummary | null>(null);
  const [chatCompactionStatus, setChatCompactionStatus] = useState<ChatCompactionStatus | null>(null);
  const [chatCompactionConfig, setChatCompactionConfig] = useState<ChatCompactionConfig | null>(null);
  const [stale, setStale] = useState(false);
  const [task, setTask] = useState('');
  // Вложения композитора (XIV, NUE1): локальный выбор файлов; имён
  // verbatim уходят в текст задачи как #path-упоминания — бинарной
  // загрузки у RunIn нет (разрыв W1 отмечен в отчёте).
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Ключ идемпотентности текущего процесса: генерируется при первичном клике,
  // переиспользуется при ретрае (тост / повторный клик) — но ТОЛЬКО пока тело
  // запроса не менялось (см. runBodyFingerprint): хост считает хеш ТЕЛА и
  // отвечает 409, если ключ повторён с другим телом. Сбрасывается после
  // успешного старта — следующий клик получит новый ключ.
  const idempotencyKeyRef = useRef<string | null>(null);
  const lastAttemptFingerprintRef = useRef<string | null>(null);
  // Snapshot restores the transcript verbatim across tab/route remounts;
  // the listRuns seeding below still runs but never clobbers a live chat.
  // Гидратация (NQ #418): sessionStorage на SSR пуст → lazy-init дал бы
  // разный первый кадр. Снапшот читается в mount-эффекте — лента
  // появляется со второго кадра, разметка совпадает с SSR.
  const [restoredChat, setRestoredChat] = useState<ChatSnapshot>({ chat: [], traces: {}, answers: {} });
  const [chat, setChat] = useState<ChatMsg[]>([]);
  // Per-run surfaces: the observable trace from the stream, and the stored
  // answer fetched once the run turns terminal (undefined = not fetched,
  // null = host reported no answer).
  const [traces, setTraces] = useState<Record<string, RunEventView[]>>({});
  // Live draft — accumulated model_delta chunks of the in-flight call;
  // a persisted model_call event replaces it with the canonical text.
  const [drafts, setDrafts] = useState<Record<string, { text: string; streaming: boolean }>>({});
  const [answers, setAnswers] = useState<Record<string, string | null>>({});

  useEffect(() => {
    const snap = readChatSnapshot();
    if (snap.chat.length === 0) return;
    setRestoredChat(snap);
    setChat(snap.chat);
    setTraces(snap.traces);
    setAnswers(snap.answers);
  }, []);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [planFailed, setPlanFailed] = useState(false);
  // R-W3.1: вид плана в пузыре — список (U-1) либо канвас PlanDag.
  const [planView, setPlanView] = useState<'list' | 'canvas'>('list');
  const chatListRef = useRef<HTMLOListElement | null>(null);
  const chatPinnedToBottomRef = useRef(true);
  const pendingChatAnchorRef = useRef<ReturnType<typeof captureChatScrollAnchor> | null>(null);
  const chatScrollInitializedRef = useRef(false);

  // W3-143: догрузка старой истории треда при скролле к верху ленты.
  // Snapshot/listRuns остаются instant-restore; страницы лягут поверх.
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyDone, setHistoryDone] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historySessionRef = useRef<string | null>(null);
  /** Следующий `before_id` — host next_cursor; undefined = ещё не запрошено. */
  const historyCursorRef = useRef<string | null | undefined>(undefined);
  const historyInFlightRef = useRef(false);


  // fs-access (диспетч 2026-10-20): регулятор под композитором. Режим и
  // корни живут в профиле и уезжают в fs_policy прогона; решения по заявкам
  // — локальный кэш поверх fs_request_resolved событий трейса (финальная
  // правда — у хоста). seam ds.fs отсутствует → unavailable, не мок.
  const {
    fsMode, fsRoots, fsAddOpen, setFsAddOpen, fsPath, setFsPath,
    fsAddErr, setFsAddErr, fsAddBusy, fsDecisions, fsActionErr,
    addFsRoot, decideFs, fsOpen, setFsOpen, fsRef,
  } = useProcessFs({ ds, profile, run });

  // Входы тела прогона. Ретрай из тоста — замыкание на том рендере, где
  // прогон упал: без ref'а он отправил бы СТАРОЕ тело (старая модель/контур/
  // контекст), и правка тела осталась бы невидимой — хост получил бы прежний
  // ключ с другим телом и ответил 409 (idempotency conflict). Ref хранит
  // актуальные значения, поэтому ретрай всегда отправляет то, что на экране.
  const runInputsRef = useRef({
    task,
    chat,
    answers,
    config,
    agent,
    model: profile?.defaultModelId ?? null,
    useMemory: profile?.useMemory === true,
    memoryProject: profile?.memoryProject?.trim() || 'ai2',
    fsMode,
    fsRoots,
    attachments,
  });
  useEffect(() => {
    runInputsRef.current = {
      task,
      chat,
      answers,
      config,
      agent,
      model: profile?.defaultModelId ?? null,
      useMemory: profile?.useMemory === true,
      memoryProject: profile?.memoryProject?.trim() || 'ai2',
      fsMode,
      fsRoots,
      attachments,
    };
  });

  // Быстрый выбор контура: шестерёнка открывает список пресетов с хоста.
  const [contourOpen, setContourOpen] = useState(false);
  const [presets, setPresets] = useState<PresetInfo[] | null>(null);
  const [presetsFailed, setPresetsFailed] = useState(false);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelsFailed, setModelsFailed] = useState(false);
  const contourRef = useRef<HTMLDivElement | null>(null);

  const loadPresets = useCallback(() => {
    ds.listPresets().then(
      (p) => { setPresets(p); setPresetsFailed(false); },
      () => setPresetsFailed(true));
  }, [ds]);
  const loadModels = useCallback(() => {
    ds.listModels().then(
      (m) => { setModels(m); setModelsFailed(false); },
      () => setModelsFailed(true));
  }, [ds]);
  useEffect(() => {
    if (!contourOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (contourRef.current && !contourRef.current.contains(e.target as Node)) setContourOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (matchesShortcut(e, 'modal.dismiss')) setContourOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [contourOpen]);

  useEffect(() => {
    // Снапшот — отложенно и коалесцированно: полный JSON.stringify всех
    // трейсов на каждое SSE-событие давал периодические long tasks на
    // /runtime. 800мс-тейл покрывает серию событий одной записью;
    // pagehide фиксирует финальное состояние при закрытии/уходе.
    const t = setTimeout(() => writeChatSnapshot({ chat, traces, answers }), 800);
    const flush = () => writeChatSnapshot({ chat, traces, answers });
    window.addEventListener('pagehide', flush);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pagehide', flush);
    };
  }, [chat, traces, answers]);

  const onStreamEnd = useCallback((status: RunStatus) => {
    setRun((prev) => (prev ? { ...prev, status, stopReason: status, finishedAt: Math.floor(Date.now() / 1000) } : prev));
    setChat((prev) => prev.map((m) => (m.role === 'assistant' && m.status === 'running' ? { ...m, status } : m)));
  }, []);

  // W1-139 auto-compaction runs after a completed root run. Poll only that
  // host-reported session while it is checking/triggered; child runs and
  // independent chat turns do not share a compaction session.
  useEffect(() => {
    if (
      ds.getChatCompactionStatus == null
      || run == null
      || run.parent !== null
      || run.status === 'running'
    ) {
      setChatCompactionStatus(null);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const poll = async () => {
      try {
        const status = await ds.getChatCompactionStatus!(run.runId);
        if (!alive) return;
        if (
          (status?.compaction === 'checking' || status?.compaction === 'triggered')
          && Date.now() - startedAt >= CHAT_COMPACTION_STATUS_TIMEOUT_MS
        ) {
          setChatCompactionStatus({
            ...status,
            compaction: 'failed',
            reason: status.reason ?? 'compaction_status_timeout: хост не подтвердил результат за 30 секунд; итог неизвестен.',
          });
          return;
        }
        setChatCompactionStatus(status);
        if (status?.compaction === 'checking' || status?.compaction === 'triggered') {
          timer = setTimeout(() => void poll(), CHAT_COMPACTION_STATUS_POLL_MS);
        }
      } catch {
        if (alive) setChatCompactionStatus(null);
      }
    };
    void poll();
    return () => {
      alive = false;
      if (timer != null) clearTimeout(timer);
    };
  }, [ds, run?.runId, run?.parent, run?.status]);

  // W1-140: real compaction thresholds live on the host config — a model
  // without a declared window reports null and the UI must not invent one.
  useEffect(() => {
    if (ds.getChatCompactionConfig == null) {
      setChatCompactionConfig(null);
      return;
    }
    let alive = true;
    Promise.resolve()
      .then(() => ds.getChatCompactionConfig!())
      .then(
        (config) => { if (alive) setChatCompactionConfig(config ?? null); },
        () => { if (alive) setChatCompactionConfig(null); },
      );
    return () => { alive = false; };
  }, [ds]);
  const onStreamStale = useCallback((paused: boolean) => setStale(paused), []);
  // Stream is open while the tracked run runs.
  // ?freeze=1 (NQ-073 visual gate) keeps the subscription closed entirely.
  const streamActive = run != null && !freeze && run.status === 'running';

  // U-6: экспорт прогона в .md — клиентская сборка из загруженных событий
  // (задача, план emit_step, fs-операции, потребление, финал). Скачивание
  // через Blob+anchor; clipboard-fallback не нужен — файл первичен.
  const downloadReport = useCallback((m: ChatMsg) => {
    if (m.runId == null) return;
    const trace = traces[m.runId] ?? [];
    const task = chat.find((c) => c.id === `u-${m.runId}`)?.text ?? m.runId;
    const md = runReportMd(task, trace, answers[m.runId] ?? null);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `run-${m.runId.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [traces, chat, answers]);

  const runParam = params.get('run');
  const reloadActive = useCallback(() => {
    setAttachFailed(false);
    ds.listRuns({ limit: 20 })
      .then(async (v) => {
        // ref-parity P-1: /runtime?run=<id> — прицеп к конкретному прогону
        // (композитор /home ведёт сюда). Вне top-20 — честный добор через
        // getRunDetail; seam нет → тихий фолбэк на активный (проверить нельзя).
        // W3-163: seam ответил null — прогон заведомо отсутствует (live 404 →
        // null в адаптере, mock — null): честное «не найден», без вечного
        // спиннера. Отказ seam (сеть/5xx) — не «missing»: фолбэк как раньше.
        setAttachMissing(null);
        let requested = runParam != null ? v.find((r) => r.runId === runParam) : undefined;
        if (runParam != null && requested == null && ds.getRunDetail != null) {
          let detail: Awaited<ReturnType<NonNullable<typeof ds.getRunDetail>>> | undefined;
          try {
            detail = await ds.getRunDetail(runParam);
          } catch {
            detail = undefined;
          }
          if (detail === null) setAttachMissing(runParam);
          requested = detail?.run;
        }
        const active = requested ?? v.find((r) => r.status === 'running');
        // Reconcile session-restored bubbles still marked running against
        // host truth: a finished run gets its real status, a run the host
        // forgot is honestly 'error'. The still-active run is left alone.
        setChat((prev) =>
          prev.map((m) => {
            if (m.role !== 'assistant' || m.status !== 'running' || m.runId == null || m.runId === active?.runId)
              return m;
            const found = v.find((r) => r.runId === m.runId);
            return { ...m, status: found?.status ?? 'error' };
          }),
        );
        // Fill answers for restored terminal bubbles the session cache
        // did not carry (bounded by however many runs the chat holds).
        if (ds.getRunDetail != null) {
          for (const m of restoredChat.chat) {
            if (m.role !== 'assistant' || m.runId == null || m.runId === active?.runId) continue;
            const found = v.find((r) => r.runId === m.runId);
            if (found == null || found.status === 'running') continue;
            const rid = m.runId;
            ds.getRunDetail(rid).then(
              (d) =>
                setAnswers((prev) =>
                  prev[rid] !== undefined ? prev : { ...prev, [rid]: d?.result?.answer?.trim() || null },
                ),
              () => setAnswers((prev) => ({ ...prev, [rid]: null })),
            );
          }
        }
        if (active != null) {
          setRun(active);
          // Attaching seeds the pair: the user's task bubble verbatim
          // from the run record, the assistant bubble with the run's real
          // status ('running' → stream attaches; terminal → answer below).
          setChat((prev) =>
            prev.some((m) => m.runId === active.runId)
              ? prev
              : [
                ...prev,
                { id: `u-${active.runId}`, role: 'user', text: stripChatTaskWrapper(active.taskText), status: 'done', ts: active.createdAt },
                { id: `a-${active.runId}`, role: 'assistant', runId: active.runId, status: active.status, ts: active.createdAt },
              ],
          );
          if (active.status !== 'running' && ds.getRunDetail != null) {
            const rid = active.runId;
            ds.getRunDetail(rid).then(
              (d) =>
                setAnswers((prev) =>
                  prev[rid] !== undefined ? prev : { ...prev, [rid]: d?.result?.answer?.trim() || null },
                ),
              () => setAnswers((prev) => ({ ...prev, [rid]: null })),
            );
          }
          return;
        }
        // Chat history (wave-8 W3-2): nothing live — restore the last few
        // completed pairs verbatim: task from the run record, answer lazily
        // via getRunDetail. Live trace is never fabricated for old runs;
        // without the detail seam the transcript stays empty (restoring
        // answer-less bubbles would read as failed runs).
        if (ds.getRunDetail == null) return;
        const recent = v.filter((r) => r.status !== 'running').slice(0, CHAT_RESTORE_LIMIT);
        if (recent.length === 0) return;
        setChat((prev) => {
          if (prev.length > 0) return prev; // user already chatting — never clobber
          const msgs: ChatMsg[] = [];
          for (const r of [...recent].reverse()) {
            msgs.push(
              { id: `u-${r.runId}`, role: 'user', text: stripChatTaskWrapper(r.taskText), status: 'done', ts: r.createdAt },
              { id: `a-${r.runId}`, role: 'assistant', runId: r.runId, status: r.status, ts: r.createdAt },
            );
          }
          return msgs;
        });
        for (const r of recent) {
          ds.getRunDetail(r.runId).then(
            (d) =>
              setAnswers((prev) =>
                prev[r.runId] !== undefined ? prev : { ...prev, [r.runId]: d?.result?.answer?.trim() || null },
              ),
            () => setAnswers((prev) => ({ ...prev, [r.runId]: null })),
          );
        }
      })
      .catch(() => setAttachFailed(true));
    // restoredChat в deps: снапшот применяется эффектом после монтирования —
    // повторный заход добирает ответы для восстановленных пузырей (все
    // сеттеры prev-guarded, повтор идемпотентен).
  }, [ds, runParam, restoredChat]);

  // Live trace — the observable event stream feeds the running bubble.
  // Deduped by seq, sorted, keyed per runId so each bubble keeps its own log.
  useEffect(() => {
    if (!streamActive || run == null) return;
    const runId = run.runId;
    setStale(false);
    // Дельты приходят по токену: каждая тянула полный ре-рендер ленты.
    // Копим в буфер и флашим по кадру (макс 60 обновлений/с вместо N/с);
    // события, разрывы и конец флашат буфер синхронно — порядок семантики
    // «дельта → граница вызова» сохраняется в точности.
    let deltaBuf = '';
    let deltaRaf = 0;
    const flushDeltas = () => {
      if (deltaRaf !== 0) { cancelAnimationFrame(deltaRaf); deltaRaf = 0; }
      if (deltaBuf === '') return;
      const text = deltaBuf;
      deltaBuf = '';
      setDrafts((prev) => {
        const cur = prev[runId];
        return {
          ...prev,
          [runId]: { text: (cur?.streaming ? cur.text : '') + text, streaming: true },
        };
      });
    };
    const onEvent = (ev: RunEventView) => {
      flushDeltas();
      setTraces((prev) => {
        const cur = prev[runId] ?? [];
        // Подавляющий случай — in-order доставка: O(1) append без скана и
        // сортировки. Дуп и out-of-order уходят в медленный путь.
        const last = cur[cur.length - 1];
        if (last != null && ev.seq > last.seq) return { ...prev, [runId]: [...cur, ev] };
        if (cur.some((p) => p.seq === ev.seq)) return prev;
        return { ...prev, [runId]: [...cur, ev].sort((a, b) => a.seq - b.seq) };
      });
      setDrafts((prev) => {
        if (ev.type === 'model_call') {
          const t = (ev.body as { text?: unknown } | null)?.text;
          const text = typeof t === 'string' && t ? t : prev[runId]?.text ?? '';
          return { ...prev, [runId]: { text, streaming: false } };
        }
        // Любое сохранённое событие — граница вызова: следующие дельты
        // принадлежат уже новому model_call, накопление начинается заново.
        const cur = prev[runId];
        return cur?.streaming ? { ...prev, [runId]: { ...cur, streaming: false } } : prev;
      });
    };
    const unsub = ds.streamRun(runId, {
      onEvent,
      onDelta: (text) => {
        deltaBuf += text;
        if (deltaRaf === 0) {
          deltaRaf = requestAnimationFrame(flushDeltas);
        }
      },
      onGap: (paused) => { flushDeltas(); onStreamStale(paused); },
      onEnd: (status) => { flushDeltas(); onStreamEnd(status); },
    });
    return () => {
      unsub();
      // Хвост буфера не теряем: флаш при переподписке/смене прогона честен —
      // ключ drafts — runId, принадлежность дельт сохраняется.
      flushDeltas();
    };
  }, [ds, run?.runId, streamActive, onStreamEnd, onStreamStale]);

  // Approvals moved to Settings → Runtime — the chat keeps a count hint so a
  // stalled run never blocks invisibly.
  useEffect(() => {
    if (ds.listApprovals == null) return;
    Promise.resolve(ds.listApprovals())
      .then((l) => setPendingApprovals(l.filter((a) => a.status === 'pending').length))
      .catch(() => setPendingApprovals(0));
  }, [ds, run?.status]);

  const { sdkConfs, deferredMarks, pluginInstallNotices, decideToolConf, sdkSeamDown } =
    useProcessSdk({ ds, run, traces });

  useEffect(() => {
    reloadActive();
  }, [reloadActive]);

  // Follow the tail only when the reader was already there; otherwise keep a
  // visible message at the same viewport offset when rows grow or compact.
  // W3-143: догрузка старых сообщений с хоста при достижении верха ленты.
  // Сессия — root-прогон треда (хост ходит closure по parent/retry_of);
  // восходим по parent-цепочке через getRunDetail, без seam берём верхний
  // runId как есть. Курсор — host next_cursor; первый запрос — host-id
  // самого старого показанного сообщения.
  const loadOlderHistory = useCallback(async () => {
    const seam = ds.getChatHistory;
    if (seam == null || historyInFlightRef.current || historyDone) return;
    const first = chat.find((m) => chatHistoryRef(m) != null);
    const beforeId = historyCursorRef.current ?? (first != null ? chatHistoryRef(first) : null);
    if (beforeId == null) return;

    const initialRoot = first != null ? chatHistoryRunId(first) : null;
    if (historySessionRef.current == null && initialRoot == null) return;
    historyInFlightRef.current = true;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      let sessionId: string | null = historySessionRef.current;
      if (sessionId == null) {
        let root = initialRoot!;
        if (ds.getRunDetail != null) {
          const seen = new Set<string>([root]);
          for (let hop = 0; hop < 8; hop += 1) {
            const detail = await ds.getRunDetail(root).catch(() => null);
            // Тред хоста собирается по parent И retry_of — ретрай-цепочка
            // идёт к корню через retryOf, дочерние прогоны — через parent.
            const parent: string | null = detail?.run.parent ?? detail?.run.retryOf ?? null;
            if (parent == null || seen.has(parent)) break;
            seen.add(parent);
            root = parent;
          }
        }
        sessionId = root;
        historySessionRef.current = sessionId;
      }

      let cursor: string | null = beforeId;
      let done = false;
      const prepend: ChatMsg[] = [];
      const newAnswers: Record<string, string> = {};
      const existingIds = new Set(chat.map((m) => m.id));
      // Страница целиком из уже видимых id — прозрачно идём глубже,
      // не заставляя читателя повторять жест ради «пустого» витка.
      for (let hop = 0; hop < 4; hop += 1) {
        const page = await seam(sessionId, { beforeId: cursor ?? undefined, limit: CHAT_HISTORY_PAGE, effective: true });
        cursor = page.nextCursor;
        done = !page.hasMore;
        let fresh = 0;
        for (const entry of page.entries) {
          const msg = historyEntryToChatMsg(entry, sessionId);
          if (existingIds.has(msg.id) || prepend.some((m) => m.id === msg.id)) continue;
          prepend.push(msg);
          fresh += 1;
          if (entry.kind === 'message' && entry.part === 'answer' && entry.text != null) {
            newAnswers[entry.runId] = entry.text;
          }
        }
        if (fresh > 0 || done || page.entries.length === 0) break;
        if (cursor == null) { done = true; break; }
      }
      if (prepend.length > 0) {
        // Якорь фиксируем ДО setChat — cleanup эффекта видит уже новый DOM.
        const el = chatListRef.current;
        if (el != null && pendingChatAnchorRef.current == null) {
          pendingChatAnchorRef.current = captureChatScrollAnchor(el, false);
        }
        setChat((prev) => [
          ...prepend.filter((m) => !prev.some((x) => x.id === m.id)),
          ...prev,
        ]);
        if (Object.keys(newAnswers).length > 0) {
          setAnswers((prev) => ({ ...newAnswers, ...prev }));
        }
      }
      historyCursorRef.current = cursor;
      if (done) setHistoryDone(true);
    } catch (err) {
      if (isAi2ApiError(err) && err.status === 404) {
        // thread_not_found/message_not_found — старше текущей границы хост
        // ничего не знает; честный конец, а не вечный retry.
        setHistoryDone(true);
      } else {
        setHistoryError(isAi2ApiError(err)
          ? `Не удалось загрузить историю (HTTP ${err.status})`
          : 'Не удалось загрузить историю. Проверьте подключение к рантайму.');
        apiToast?.notifyApiError(err, 'Не удалось загрузить историю', {
          retry: () => void loadOlderHistory(),
        });
      }
    } finally {
      historyInFlightRef.current = false;
      setHistoryLoading(false);
    }
  }, [ds, chat, historyDone]);

  const traceCount = run != null ? traces[run.runId]?.length ?? 0 : 0;
  const streamedText = run != null ? drafts[run.runId]?.text ?? '' : '';
  useLayoutEffect(() => {
    const el = chatListRef.current;
    if (el == null) return;
    const onScroll = () => {
      chatPinnedToBottomRef.current = isChatPinnedToBottom(el);
      if (el.scrollTop <= CHAT_HISTORY_TOP_PX) void loadOlderHistory();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [chat.length, attachFailed, loadOlderHistory]);
  useLayoutEffect(() => {
    const el = chatListRef.current;
    if (el == null) {
      pendingChatAnchorRef.current = null;
      chatScrollInitializedRef.current = false;
      return;
    }

    const pending = pendingChatAnchorRef.current;
    pendingChatAnchorRef.current = null;
    if (pending != null) {
      restoreChatScrollAnchor(el, pending);
      chatPinnedToBottomRef.current = pending.followBottom;
    } else if (!chatScrollInitializedRef.current) {
      el.scrollTop = el.scrollHeight;
      chatPinnedToBottomRef.current = true;
      chatScrollInitializedRef.current = true;
    }

    return () => {
      // W3-143: prepend ставит якорь до commit — не затираем его
      // снимком уже изменённого DOM.
      pendingChatAnchorRef.current ??= captureChatScrollAnchor(el, chatPinnedToBottomRef.current);
    };
  }, [chat, traceCount, streamedText]);

  // Лента короче вьюпорта — скролл-события не будет, но мы уже у «верха»:
  // дотягиваем первую страницу истории (дальше — только реальным скроллом).
  useLayoutEffect(() => {
    const el = chatListRef.current;
    if (el == null || historyCursorRef.current !== undefined) return;
    if (el.clientHeight > 0 && el.scrollHeight <= el.clientHeight) void loadOlderHistory();
  }, [chat.length, loadOlderHistory]);

  // Боковое окно файловой активности (fs-лог вне чата): ops последнего
  // прогона в транскрипте — живого, иначе крайнего завершённого. Пустой
  // список → честное empty-состояние, а не выдуманные записи.
  const fsPaneRunId = run?.runId ?? [...chat].reverse().find((m) => m.runId != null)?.runId ?? null;
  // Скан трейса — по ссылке, не на каждый рендер: во время стрима дельт
  // рендеров десятки в секунду, а список событий меняется редко.
  const fsPaneOps = useMemo(
    () => (fsPaneRunId != null ? fsOpsOf(traces[fsPaneRunId] ?? []) : []),
    [traces, fsPaneRunId],
  );

  // wave-2 W3-2: fs-pane дерева — ops дочерних прогонов под родительскими.
  // Дети через проверенный ?parent= wire; их события — через getRunDetail
  // (seam может отсутствовать у источника → тогда честно только корневой).
  const [fsChildGroups, setFsChildGroups] = useState<{ id: string; handle: string | null; ops: ReturnType<typeof fsOpsOf> }[]>([]);
  useEffect(() => {
    if (fsPaneRunId == null || ds.getRunDetail == null) {
      setFsChildGroups([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const kids = await ds.listRuns({ parent: fsPaneRunId, limit: 20 });
        const groups: { id: string; handle: string | null; ops: ReturnType<typeof fsOpsOf> }[] = [];
        for (const k of kids) {
          const d = await ds.getRunDetail!(k.runId);
          if (d == null) continue;
          const ops = fsOpsOf(d.events);
          if (ops.length > 0) groups.push({ id: k.runId, handle: spawnHandleOf(d.events), ops });
        }
        if (alive) setFsChildGroups(groups);
      } catch {
        // Семейство не загрузилось — панель остаётся честно корневой.
        if (alive) setFsChildGroups([]);
      }
    })();
    return () => { alive = false; };
  }, [ds, fsPaneRunId]);

  // U-3 approval-inbox: все наблюдаемые fs_requests по загруженным трейсам,
  // минус решённые (fs_request_resolved в трейсе или локальное решение).
  // Полный скан всех трейсов — useMemo: на каждый кадр стрима не пересчитываем.
  const pendingFsReqs = useMemo(() => {
    const resolved = new Map<string, 'approved' | 'denied'>();
    const pending: (FsRequestView & { runId: string })[] = [];
    for (const [runId, evs] of Object.entries(traces)) {
      for (const ev of evs) {
        const req = fsRequestOf(ev.body);
        if (req) pending.push({ ...req, runId });
        const res = fsResolutionOf(ev.body);
        if (res) resolved.set(res.id, res.decision);
      }
    }
    return pending.filter((r) => !resolved.has(r.id) && fsDecisions[r.id] !== 'approved' && fsDecisions[r.id] !== 'denied');
  }, [traces, fsDecisions]);

  // Озвучка последнего ответа — кнопка живёт над шестерёнкой контура
  // (composer-ряд), озвучивает крайний ответ чата; playbar остаётся
  // привязанным к своему пузырю по id сообщения.
  const latestAnswer = useMemo(() => {
    for (let i = chat.length - 1; i >= 0; i -= 1) {
      const mm = chat[i];
      if (mm.runId == null) continue;
      const a = answers[mm.runId];
      if (a != null && a.trim() !== '') return { id: mm.id, text: a };
    }
    return null;
  }, [chat, answers]);

  const fetchPlan = useCallback(
    (text: string) => {
      if (ds.previewRunPlan == null || !text) return;
      Promise.resolve(ds.previewRunPlan({ task: text, config, agent: agent || null }))
        .then((p) => { setPlan(p); setPlanFailed(false); })
        .catch(() => setPlanFailed(true));
    },
    [ds, config, agent],
  );

  // Plan preview (W3-02): follows the composer input — never blocks submit.
  useEffect(() => {
    if (ds.previewRunPlan == null) return;
    const text = task.trim();
    if (!text) {
      setPlan(null);
      setPlanFailed(false);
      return;
    }
    const t = setTimeout(() => fetchPlan(text), 250);
    return () => clearTimeout(t);
  }, [ds, task, fetchPlan]);

  const start = async (e?: FormEvent, override?: string) => {
    e?.preventDefault();
    // Актуальные входы тела — из ref (см. runInputsRef): ретрай из тоста
    // приходит из старого рендера и обязан отправить текущее тело.
    const inputs = runInputsRef.current;
    const text = (override ?? inputs.task).trim();
    if (!text || submitting || (run != null && run.status === 'running')) return;
    // Вложения: бинарной загрузки у RunIn нет — имена файлов уходят
    // verbatim как #path-упоминания в тексте задачи (честно, не выдумка).
    const withMentions = inputs.attachments.length > 0
      ? `${text}\n${inputs.attachments.map((a) => `#${a.name}`).join(' ')}`
      : text;
    setSubmitting(true);
    setStartError(null);
    let created: RunSummary;
    try {
      // M2: memory pair — the host validator requires `project` whenever
      // `use_memory` is set, so the fields always travel together or not
      // at all. Profile-gated (Settings → «Память проекта»); the host
      // corpus is seeded via tools/seed_memory.py (task M1).
      const memoryOn = inputs.useMemory;
      // fs-access: политика уезжает только с корнями — пустой список +
      // режим не шлём, у хоста остаётся workdir-only дефолт. request_writes
      // включает заявки на запись именно в read_only; в read_write хост
      // исполняет напрямую. Per-root access зеркалит режим — per-root UI
      // в карточке не предусмотрен.
      const fsPolicy: FsPolicy | undefined = inputs.fsRoots.length > 0
        ? {
          mode: inputs.fsMode,
          roots: inputs.fsRoots.slice(0, 16).map((r) => ({ id: r.id, path: r.path, access: (inputs.fsMode === 'read_write' ? 'rw' : 'ro') as 'rw' | 'ro' })),
          requestWrites: inputs.fsMode === 'read_only',
        }
        : undefined;
      // agent уходит только именем из реестра: имя ассистента/свободный
      // ввод ('alice' и т.п.) хост отклоняет 422 «агент не зарегистрирован».
      // Незарегистрированное или непроверяемое значение опускаем — сервер
      // сам подставляет исполнителя.
      let runAgent: string | null = null;
      if (inputs.agent) {
        const registered = await ds.listAgents().catch(() => null);
        if (registered?.some((a) => a.name === inputs.agent)) runAgent = inputs.agent;
      }
      const body = {
        task: buildChatTask(inputs.chat, inputs.answers, withMentions),
        config: inputs.config,
        agent: runAgent,
        model: inputs.model,
        ...(memoryOn
          ? { useMemory: true, project: inputs.memoryProject }
          : {}),
        ...(fsPolicy ? { fsPolicy } : {}),
      };
      // Ключ идемпотентности живёт ровно столько, сколько живёт ТЕЛО:
      // хост хеширует тело запроса и отвечает 409, если ключ повторён с
      // другим телом. Поэтому ключ перевыпускается при ЛЮБОЙ правке тела
      // (контекст диалога/ответы, контур, агент, модель, память+проект,
      // fs-политика), а не только при смене текста. Ретрай с неприкосновенным
      // телом — тот же ключ: это ретрай, а не новый прогон.
      const fingerprint = runBodyFingerprint({
        ...body,
        context: chatContextDigest(inputs.chat, inputs.answers),
      });
      if (idempotencyKeyRef.current == null || fingerprint !== lastAttemptFingerprintRef.current) {
        idempotencyKeyRef.current = crypto.randomUUID();
        lastAttemptFingerprintRef.current = fingerprint;
      }
      const idempotencyKey = idempotencyKeyRef.current;
      created = await ds.startRun({ ...body, idempotencyKey });
    } catch (startErr) {
      setStartError(isAi2ApiError(startErr) ? `Не удалось запустить прогон: ${startErr.message}` : 'Не удалось запустить прогон. Проверьте подключение к рантайму и повторите.');
      // W3-158: единый стек — retry шлёт тот же текст, черновик не терялся.
      apiToast?.notifyApiError(startErr, 'Не удалось запустить прогон', {
        retry: () => void start(undefined, text),
      });
      setSubmitting(false);
      return;
    }
    setRun(created);
    const ts = Math.floor(Date.now() / 1000);
    setChat((prev) =>
      prev.some((m) => m.runId === created.runId)
        ? prev
        : [
          ...prev,
          { id: `u-${created.runId}`, role: 'user', text: withMentions, status: 'done', ts },
          { id: `a-${created.runId}`, role: 'assistant', runId: created.runId, status: 'running', ts },
        ],
    );
    setTask('');
    setAttachments([]);
    setPlan(null);
    // Успешный старт — ключ отработал, следующий клик получит новый ключ.
    idempotencyKeyRef.current = null;
    lastAttemptFingerprintRef.current = null;
    setSubmitting(false);
  };

  const cancel = async () => {
    if (run == null || run.status !== 'running') return;
    await ds.cancelRun(run.runId);
    setRun({ ...run, status: 'cancelled', stopReason: 'cancelled', finishedAt: Math.floor(Date.now() / 1000) });
  };

  // W3-151 · действия сообщений. retry — тот же send-seam; пока прогон
  // идёт, текст честно уходит черновиком в композитор (как voice-submit),
  // скрытой очереди нет. hide — только локально: delete-seam у хоста
  // отсутствует, на сервере сообщение остаётся; snapshot перепишется без
  // него — не врём про «удалено на сервере».
  const retryChatMessage = (text: string) => {
    if (!text.trim()) return;
    if (submitting || (run != null && run.status === 'running')) {
      setTask(text);
      return;
    }
    setTask('');
    void start(undefined, text);
  };
  const hideChatMessage = (id: string) => {
    setChat((prev) => prev.filter((m) => m.id !== id));
  };

  const onFormKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      // Enter — запуск прогона; Ctrl+Enter (и Shift+Enter нативно) — перевод
      // строки. У Ctrl+Enter нет нативного перевода — вставляем вручную:
      // setRangeText + синк state, так каретка остаётся после новой строки.
      if (matchesShortcut(e, 'composer.newline')) {
        e.preventDefault();
        const el = e.target as HTMLTextAreaElement;
        if (typeof el.setRangeText === 'function') {
          el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end');
          setTask(el.value);
        }
        return;
      }
      if (e.shiftKey) return;
      e.preventDefault();
      void start();
      return;
    }
    if (matchesShortcut(e, 'modal.dismiss')) cancel();
  };

  const {
    micState, voiceError, speaking, copiedId, waveCanvasRef, micReason,
    toggleMic, stopAudio, speakText, togglePlay, seekAudio, copyAnswer,
  } = useProcessVoice({
    ds,
    speakerId: profile?.voiceSpeakerId,
    autoSpeak: profile?.voiceAutoSpeak === true,
    task,
    setTask,
    submitting,
    run,
    answers,
    setAnswers,
    onSubmit: (merged) => {
      if (submitting || (run != null && run.status === 'running')) {
        // Пока идёт прогон, стартовать нельзя — распознанное не теряем,
        // остаётся черновиком в композиторе.
        setTask(merged);
        return;
      }
      setTask('');
      void start(undefined, merged);
    },
  });

  return {
    profile, params, router, ds, dsKind, attachFailed, attachMissing, run, stale, task, setTask,
    chatCompactionStatus, chatCompactionConfig,
    attachments, setAttachments, attachInputRef, submitting, startError,
    restoredChat, chat, traces, drafts, answers, pendingApprovals,
    plan, planFailed, planView, setPlanView, chatListRef,
    historyLoading, historyDone, historyError, loadOlderHistory,
    fsMode, fsRoots, fsAddOpen, setFsAddOpen, fsPath, setFsPath,
    fsAddErr, setFsAddErr, fsAddBusy, fsDecisions, fsActionErr,
    addFsRoot, decideFs, fsOpen, setFsOpen, fsRef,
    contourOpen, setContourOpen, presets, presetsFailed, models, modelsFailed,
    contourRef, loadPresets, loadModels,
    onStreamEnd, onStreamStale, streamActive, downloadReport, reloadActive,
    runParam, fsPaneRunId, fsPaneOps, fsChildGroups, pendingFsReqs,
    latestAnswer, fetchPlan, start, cancel, onFormKey,
    retryChatMessage, hideChatMessage,
    sdkConfs, deferredMarks, pluginInstallNotices, decideToolConf, sdkSeamDown,
    micState, voiceError, speaking, copiedId, waveCanvasRef, micReason,
    toggleMic, stopAudio, speakText, togglePlay, seekAudio, copyAnswer,
    config, agent,
  };
}

export type ProcessTabCtx = ReturnType<typeof useProcessTab>;
