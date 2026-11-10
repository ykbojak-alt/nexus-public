'use client';

// Runtime operations panels — the operational surface moved out of the
// chat-first Process tab into Settings → Runtime (wave-7+). Everything here
// renders only what the data source reports: missing seams → honest
// unavailable states, never fabricated controls.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { Button, EmptyState, ErrorState, GlassPanel, LoadingState, StatusBadge, maskSecrets, type NexusStatus, type TrajectoryCall } from '@nexus/ui';
import type { NexusGraphData, NexusGraphEdge } from '@nexus/patterns';
import type {
  ApprovalDecision, ApprovalRequest, RunControlState, RunEventView, RunStatus, RunSummary,
} from '@nexus/mock-data';
import { useDataSource, type ProductDataSource } from '../data-source';
import { matchesShortcut } from '../keyboard-shortcuts';
import styles from './screens.module.css';

export const STATUS_BADGE: Record<RunStatus, { status: NexusStatus; label: string }> = {
  running: { status: 'executing', label: 'ИДЁТ' },
  done: { status: 'complete', label: 'ЗАВЕРШЁН' },
  error: { status: 'error', label: 'ОШИБКА' },
  cancelled: { status: 'paused', label: 'ОТМЕНЁН' },
  timeout: { status: 'warning', label: 'ПРОСРОЧЕН' },
};

export const EVENT_LABELS: Record<string, string> = {
  'run.start': 'старт',
  'plan.step': 'план',
  model_call: 'модель',
  tool_call: 'инструмент',
  tool_result: 'результат',
  spawn: 'суб-агент',
  final: 'финал',
  // fs-access: заявки на запись и их решения — события трейса прогона.
  fs_request: 'заявка на запись',
  fs_request_resolved: 'решение по записи',
  // arch-wave: emit_step (B1) — structured шаг планировщика, verbatim.
  emit_step: 'шаг планировщика',
  // W1-B1/B2 landed: plan event carries the authoritative DAG record,
  // task_step carries per-step outcomes, brief marks context compaction.
  plan: 'план',
  task_step: 'шаг плана',
  brief: 'сжатие контекста',
  // Волна XII: SDK-канал — запрос подтверждения инструмента и его решение.
  tool_confirmation: 'подтверждение инструмента',
  tool_confirmation_resolved: 'решение по инструменту',
  // XIV: канонические имена подтверждений + чекпоинты (критик у /v1/runs;
  // sdk-checkpoint — снапшоты файлов и исход отката у sdk-прогонов).
  confirmation_requested: 'подтверждение инструмента',
  confirmation_deferred: 'подтверждение отложено',
  checkpoint: 'чекпоинт',
  checkpoint_rewound: 'откат чекпоинта',
};

/** W3-03 feed filter groups — unknown types show only under «все». */
export const EVENT_GROUP: Record<string, 'plan' | 'tools' | 'models' | 'final'> = {
  'run.start': 'plan',
  'plan.step': 'plan',
  emit_step: 'plan',
  plan: 'plan',
  task_step: 'plan',
  brief: 'plan',
  tool_call: 'tools',
  tool_result: 'tools',
  tool_confirmation: 'tools',
  tool_confirmation_resolved: 'tools',
  spawn: 'tools',
  model_call: 'models',
  final: 'final',
  error: 'final',
  timeout: 'final',
};

const EVENT_FILTER_LABELS = {
  all: 'все',
  plan: 'план',
  tools: 'инструменты',
  models: 'модели',
  final: 'завершение',
} as const;

/** Bounded feed (W3-03) — older events stay in the log, not the DOM. */
const MAX_FEED_EVENTS = 200;

export function fmtEventTime(ts: number): string {
  const d = new Date(ts * 1000);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

/** Позиция/длительность озвучки в формате m:ss — для полоски воспроизведения. */
export function fmtPlayTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** tool name carried by tool_call/tool_result bodies — shown verbatim. */
export function eventTool(body: unknown): string | null {
  const t = (body as { tool?: unknown } | null)?.tool;
  return typeof t === 'string' ? t : null;
}

/** fs-инструменты прогона (ai2/tools/fs_roots.py): целевой путь в input —
 *  отображаемый лог «какие файлы читает/пишет» строится только по ним. */
const FS_PATH_TOOLS = new Set([
  'read_file', 'write_file', 'list_files',
  // arch-wave A1/A3: write-safety и пакетные инструменты — те же
  // path-конвенции (`input.path`/`root`; read_files — `paths[]`).
  'restore_file', 'apply_patch', 'tree', 'read_files',
]);

/** Целевой путь fs-вызова из тела tool_call (`input.root` + `input.path`,
 *  verbatim от хоста): 'nexus:docs/SPEC.md'. Для остальных инструментов — null,
 *  их аргументы в строку трейса не светим (контракт аудита: без содержимого). */
export function toolTargetOf(body: unknown): string | null {
  const b = body as { tool?: unknown; input?: unknown } | null;
  if (typeof b?.tool !== 'string' || !FS_PATH_TOOLS.has(b.tool)) return null;
  const input = b.input as { path?: unknown; paths?: unknown; root?: unknown } | null;
  const root = typeof input?.root === 'string' && input.root !== '' ? `${input.root}:` : '';
  if (Array.isArray(input?.paths)) {
    const paths = input.paths.filter((p): p is string => typeof p === 'string' && p !== '');
    if (paths.length === 0) return null;
    const shown = paths.slice(0, 3).map((p) => `${root}${p}`).join(' · ');
    return paths.length > 3 ? `${shown} · +${paths.length - 3}` : shown;
  }
  if (typeof input?.path !== 'string' || input.path === '') return null;
  return `${root}${input.path}`;
}

const FS_OP_VERBS: Record<string, string> = {
  read_file: 'читает',
  list_files: 'листает',
  write_file: 'пишет',
  // arch-wave A1/A3.
  restore_file: 'откатывает',
  apply_patch: 'патчит',
  tree: 'дерево',
  read_files: 'читает',
};

/** fs-инструмент → краткий глагол для строк чата ('читает'); иначе null. */
export function fsVerbOf(tool: string | null): string | null {
  return tool != null ? FS_OP_VERBS[tool] ?? null : null;
}

export interface FsOpView {
  seq: number;
  ts: number;
  verb: string;
  tool: string;
  /** `root:path` verbatim от хоста; '—' если инструмент не вернул path. */
  target: string;
  isError: boolean;
  /** Первая строка результата-ошибки (verbatim, без <tool_output>-обёртки) —
   *  «ошибка» без причины в панели не читается. Не-ошибки → null. */
  reason: string | null;
}

/** Окно fs-активности прогона: только файловые tool_call-события траектории —
 *  краткий лог «что читала/писала». Прочие инструменты и их аргументы сюда
 *  не попадают (контракт аудита: без содержимого). */
export function fsOpsOf(trace: RunEventView[]): FsOpView[] {
  const ops: FsOpView[] = [];
  for (const ev of trace) {
    if (ev.type !== 'tool_call') continue;
    const tool = eventTool(ev.body);
    if (tool == null) continue;
    const verb = FS_OP_VERBS[tool];
    if (verb == null) continue;
    const isError = (ev.body as { is_error?: unknown } | null)?.is_error === true;
    let reason: string | null = null;
    if (isError) {
      const res = (ev.body as { result?: unknown } | null)?.result;
      if (typeof res === 'string') {
        const first = res.replace(/<\/?tool_output>/g, '').split('\n').map((l) => l.trim()).find((l) => l !== '');
        reason = first != null ? (first.length > 140 ? `${first.slice(0, 137)}…` : first) : null;
      }
    }
    ops.push({
      seq: ev.seq,
      ts: ev.ts,
      verb,
      tool,
      target: toolTargetOf(ev.body) ?? '—',
      isError,
      reason,
    });
  }
  return ops;
}

/** wave-XI W4: трейс прогона → контрактные ToolCall-события для шкалы
 *  «Траектория прогона» (RunTrajectory). Только наблюдаемые поля:
 *  имя — body.tool, id — body.call_id или позиция seq; вложенность —
 *  body.parent_call_id, когда хост начнёт его отдавать (W1 seam);
 *  результат — инлайн body.result хоста ИЛИ спаренное tool_result-событие
 *  (ближайший открытый вызов с тем же tool → durationMs из меток времени).
 *  spawn — вызов-корень субагента (Copilot-модель): тело verbatim, туда же
 *  лягут дочерние call_id. Аргументы видны в раскрытой карточке после
 *  maskSecrets — однострочный трейс держит аудит-контракт «без содержимого». */
export function toolCallsOf(trace: RunEventView[]): TrajectoryCall[] {
  const out: TrajectoryCall[] = [];
  const open: { call: TrajectoryCall; ts: number }[] = [];
  for (const ev of trace) {
    const b = ev.body as Record<string, unknown> | null;
    if (ev.type === 'tool_call') {
      const tool = typeof b?.tool === 'string' ? b.tool : null;
      if (tool == null) continue; // без имени — не вызов инструмента
      const isErr = b?.is_error === true;
      const hasResult = b?.result !== undefined && b?.result !== null;
      const call: TrajectoryCall = {
        callId: typeof b?.call_id === 'string' ? b.call_id : `#${ev.seq}`,
        parentCallId: typeof b?.parent_call_id === 'string' ? b.parent_call_id : undefined,
        name: tool,
        input: b?.input !== undefined ? maskSecrets(b.input) : undefined,
        output: hasResult ? maskSecrets(b.result) : undefined,
        startedAt: ev.ts,
        durationMs: typeof b?.duration_ms === 'number' ? b.duration_ms : undefined,
        status: isErr ? 'error' : hasResult ? 'done' : 'open',
      };
      out.push(call);
      if (!hasResult && !isErr) open.push({ call, ts: ev.ts });
    } else if (ev.type === 'tool_result') {
      const tool = typeof b?.tool === 'string' ? b.tool : null;
      const idx = tool != null ? open.findIndex((o) => o.call.name === tool) : -1;
      if (idx < 0) continue; // результат без открытого вызова — не пара
      const { call, ts } = open.splice(idx, 1)[0];
      call.output = maskSecrets(b);
      call.status = b?.is_error === true ? 'error' : 'done';
      if (call.durationMs == null && ev.ts >= ts) call.durationMs = (ev.ts - ts) * 1000;
    } else if (ev.type === 'spawn') {
      out.push({
        callId: typeof b?.call_id === 'string' ? b.call_id : `#${ev.seq}`,
        name: 'spawn',
        output: maskSecrets(b),
        startedAt: ev.ts,
        status: 'done',
      });
    }
  }
  return out;
}

/** fs-access: `fs_request` trace event → ticket view for the approval card.
 *  Fields arrive verbatim from the host event — preview ≤400B, never content. */
export interface FsRequestView {
  id: string;
  root: string;
  path: string;
  op: string;
  size: number;
  sha256: string;
  preview: string;
}

export function fsRequestOf(body: unknown): FsRequestView | null {
  const b = body as Record<string, unknown> | null;
  const id = b?.request_id;
  if (b == null || typeof id !== 'string' || id === '') return null;
  return {
    id,
    root: typeof b.root === 'string' ? b.root : '',
    path: typeof b.path === 'string' ? b.path : '',
    op: typeof b.op === 'string' ? b.op : 'write',
    size: typeof b.size === 'number' ? b.size : 0,
    sha256: typeof b.sha256 === 'string' ? b.sha256 : '',
    preview: typeof b.preview === 'string' ? b.preview : '',
  };
}

/** `fs_request_resolved` event → the host's final verdict for a ticket.
 *  The trace is the truth source — local decision state only fills the gap
 *  until the resolved event lands. */
export function fsResolutionOf(body: unknown): { id: string; decision: 'approved' | 'denied' } | null {
  const b = body as Record<string, unknown> | null;
  const id = b?.request_id;
  const d = b?.decision;
  if (typeof id !== 'string' || (d !== 'approved' && d !== 'denied')) return null;
  return { id, decision: d };
}

/** Волна XII/XIV — `tool_confirmation` + каноническое `confirmation_requested`
 *  (SDK-канал, контракт docs/product/sdk-confirm-contract.md draft 0.2):
 *  событие `awaiting`/`deferred` → карточка запроса инструмента. Все поля
 *  verbatim от хоста; input — masked JSON ≤200 символов, содержимое не
 *  светится целиком. Хост эмитит оба события на один вызов — лента
 *  дедуплицирует по callId (mergeConfirmationViews). */
export interface ToolConfirmationView {
  callId: string;
  tool: string;
  input: string;
  /** Полный, уже замаскированный объект — только для специализированных
   *  карточек; общий UI-превью остаётся ограниченным по длине. */
  inputData: unknown;
  /** 'awaiting' | 'deferred' | verbatim-значение хоста вне словаря. */
  state: string;
  /** parent_tool_use_id контекста SDK — вложенный вызов субагента. */
  parentCallId: string | null;
  /** epoch-секунды запроса (requestedAt хоста либо ts события) — для таймера. */
  requestedAt: number | null;
  title: string | null;
  displayName: string | null;
  description: string | null;
  decisionReason: string | null;
  agentId: string | null;
}

export function toolConfirmationOf(body: unknown): ToolConfirmationView | null {
  const b = body as Record<string, unknown> | null;
  const callId = b?.callId ?? b?.call_id;
  if (b == null || typeof callId !== 'string' || callId === '') return null;
  let input = '';
  const inputData = b.input == null ? null : maskSecrets(b.input);
  if (b.input != null) {
    try {
      const s = JSON.stringify(inputData);
      input = s.length > 200 ? `${s.slice(0, 197)}…` : s;
    } catch { input = ''; }
  }
  const opt = (k: string) => (typeof b[k] === 'string' && b[k] !== '' ? (b[k] as string) : null);
  const parent = b.parentCallId ?? b.parent_call_id;
  const reqAt = b.requestedAt ?? b.requested_at;
  return {
    callId,
    tool: typeof b.tool === 'string' ? b.tool : 'инструмент',
    input,
    inputData,
    state: typeof b.state === 'string' ? b.state : 'awaiting',
    parentCallId: typeof parent === 'string' && parent !== '' ? parent : null,
    requestedAt: typeof reqAt === 'number' ? reqAt : null,
    title: opt('title'),
    displayName: opt('display_name'),
    description: opt('description'),
    decisionReason: opt('decision_reason'),
    agentId: opt('agent_id'),
  };
}

/** Слияние дублей `tool_confirmation`/`confirmation_requested` и поздних
 *  `confirmation_deferred` по callId: непустые поля нового события
 *  перекрывают старые, requestedAt берётся из события, если в view его нет. */
export function mergeConfirmationView(
  prev: ToolConfirmationView,
  next: ToolConfirmationView,
  eventTs?: number,
): ToolConfirmationView {
  return {
    callId: prev.callId,
    tool: next.tool !== 'инструмент' ? next.tool : prev.tool,
    input: next.input !== '' ? next.input : prev.input,
    inputData: next.inputData ?? prev.inputData,
    state: next.state,
    parentCallId: next.parentCallId ?? prev.parentCallId,
    requestedAt: next.requestedAt ?? prev.requestedAt ?? (typeof eventTs === 'number' ? eventTs : null),
    title: next.title ?? prev.title,
    displayName: next.displayName ?? prev.displayName,
    description: next.description ?? prev.description,
    decisionReason: next.decisionReason ?? prev.decisionReason,
    agentId: next.agentId ?? prev.agentId,
  };
}

/** `confirmation_deferred` → callId карточки, переведённой в deferred. */
export function confirmationDeferredOf(body: unknown): { callId: string } | null {
  const b = body as Record<string, unknown> | null;
  const callId = b?.callId ?? b?.call_id;
  return typeof callId === 'string' && callId !== '' ? { callId } : null;
}

/** `tool_confirmation_resolved` → финальное решение по карточке
 *  (allow → approved, deny → denied). Трейс — источник правды. */
export function toolConfirmationResolutionOf(body: unknown): { callId: string; decision: 'approved' | 'denied'; message: string | null } | null {
  const b = body as Record<string, unknown> | null;
  const callId = b?.call_id ?? b?.callId;
  const d = b?.decision;
  if (typeof callId !== 'string' || (d !== 'allow' && d !== 'deny')) return null;
  const message = b?.message;
  return {
    callId,
    decision: d === 'allow' ? 'approved' : 'denied',
    message: typeof message === 'string' && message !== '' ? message : null,
  };
}

/** Artifact ids the event declares — rendered as chips, not dead links,
 *  until an artifact-fetch contract exists (W3-06). */
function eventArtifacts(body: unknown): string[] {
  const b = body as { artifactId?: unknown; artifact?: unknown; artifacts?: unknown } | null;
  if (b == null) return [];
  const out = [b.artifactId, b.artifact]
    .filter((v): v is string => typeof v === 'string');
  if (Array.isArray(b.artifacts)) {
    for (const a of b.artifacts) if (typeof a === 'string') out.push(a);
  }
  return out;
}

export function summarize(body: unknown): string {
  if (body == null) return '';
  try {
    const s = JSON.stringify(maskSecrets(body));
    return s.length > 90 ? `${s.slice(0, 87)}…` : s;
  } catch {
    return String(body);
  }
}

/**
 * Подлинность ответа — выводится только из наблюдаемых событий прогона,
 * никогда не вычисляется «уверенность» модели. Градация:
 *  - mock: источник данных — фикстура, ответа модели не было;
 *  - awaiting: прогон идёт, ни одного model_call ещё нет;
 *  - live: есть model_call (ответ реально вернула модель — id, токены, $);
 *  - partial: ответ есть, но трейс содержит recovery/error-события;
 *  - failed: прогон завершился без ответа модели.
 *  Память: tool_call memory_search → retrieval_scores — факт вызова,
 *  не признак «правды».
 */
export type ProvenanceKind = 'mock' | 'awaiting' | 'live' | 'partial' | 'failed' | 'unknown';

export interface Provenance {
  kind: ProvenanceKind;
  label: string;
  /** Оценка прогона от хоста — `final.confidence.value` ×100 (Output Engine:
   *  детерминированная эвристика над MIND — конфликты убеждений, проваленные
   *  контрольные точки, незакрытые неизвестные, исчерпанные доработки, причина
   *  остановки). Это НЕ «вероятность правильности» и не близость к эталону —
   *  эталона у чат-прогона нет. null там, где хост не дал числа. */
  percent: number | null;
}

export function provenanceOf(
  trace: RunEventView[],
  opts: { mock?: boolean; status?: RunStatus | string; hasAnswer?: boolean },
): Provenance {
  if (opts.mock) {
    return { kind: 'mock', label: 'подлинность: mock-фикстура — ответа модели не было', percent: null };
  }
  const calls = trace.filter((e) => e.type === 'model_call');
  const retries = trace.filter((e) => e.type === 'recovery' || e.type === 'error').length;
  const finished = opts.status !== undefined && opts.status !== 'running';
  if (calls.length === 0) {
    if (opts.hasAnswer) {
      // Ответ есть, а трейс пуст (не загружен/обрезан) — нельзя заявлять
      // ни «нет ответа», ни «live»: фиксируем ровно то, что видим.
      return { kind: 'unknown', label: 'подлинность: сохранённый ответ — трейс прогона недоступен', percent: null };
    }
    return finished
      ? { kind: 'failed', label: 'подлинность: нет — прогон завершился без ответа модели', percent: 0 }
      : { kind: 'awaiting', label: 'подлинность: ответ модели ещё не получен', percent: null };
  }
  const parts: string[] = [];
  const model = (calls[calls.length - 1].body as { model?: unknown })?.model;
  if (typeof model === 'string' && model) parts.push(model);
  let tin = 0, tout = 0, cost = 0;
  for (const c of calls) {
    const b = c.body as { tokens_in?: unknown; tokens_out?: unknown; cost_usd?: unknown };
    if (typeof b.tokens_in === 'number') tin += b.tokens_in;
    if (typeof b.tokens_out === 'number') tout += b.tokens_out;
    if (typeof b.cost_usd === 'number') cost += b.cost_usd;
  }
  if (tin || tout) parts.push(`токены ${tin}→${tout}`);
  if (cost > 0) parts.push(`$${cost.toFixed(4)}`);
  const memCalls = trace.filter((e) => e.type === 'tool_call' && eventTool(e.body) === 'memory_search');
  if (memCalls.length > 0) {
    const last = memCalls[memCalls.length - 1].body as {
      is_error?: unknown; retrieval_scores?: unknown;
    };
    if (last.is_error) {
      parts.push('память: ошибка поиска');
    } else {
      const scores = Array.isArray(last.retrieval_scores)
        ? last.retrieval_scores.filter((s): s is number => typeof s === 'number')
        : [];
      parts.push(scores.length > 0
        ? `память: ${scores.length} док. (max ${Math.max(...scores).toFixed(2)})`
        : 'память: без совпадений');
    }
  }
  const kind: ProvenanceKind = retries > 0 ? 'partial' : 'live';
  const head = kind === 'partial' ? `живая · повторы/сбои: ${retries}` : 'живая';
  // Честный процент — оценка хоста из события final (0..1 → %), а не
  // механический calls/(calls+errors), который вечно 100. Факторы штрафов
  // выводим в label — видно, за что снижена оценка.
  const finalEv = [...trace].reverse().find((e) => e.type === 'final');
  const conf = (finalEv?.body as { confidence?: { value?: unknown; factors?: unknown } } | undefined)?.confidence;
  const confVal = typeof conf?.value === 'number' ? conf.value : null;
  const percent = confVal != null ? Math.round(confVal * 100) : null;
  if (Array.isArray(conf?.factors) && conf.factors.length > 0) {
    const f = conf.factors.filter((x): x is string => typeof x === 'string');
    if (f.length > 0) parts.push(`оценка: ${f.join('; ')}`);
  }
  return { kind, label: `подлинность: ${head}${parts.length ? ` · ${parts.join(' · ')}` : ''}`, percent };
}

/**
 * Полоса контур-блоков над ответом: какие узлы рантайма реально
 * задействованы в этом прогоне — только по наблюдаемым событиям трейса.
 * lit=false значит «блок контура не вызывался» — это тоже честная
 * информация (контур фиксирован, события показывают, кто сработал).
 */
export interface ContourBlock {
  id: string;
  label: string;
  lit: boolean;
  /** Наблюдаемая деталь: число вызовов/хитов; ничего предположительного. */
  detail?: string;
  hint?: string;
}

export function contourBlocks(trace: RunEventView[]): ContourBlock[] {
  const roles = new Set<string>();
  const tools = new Map<string, number>();
  let memoryCalls = 0;
  let memoryHits = 0;
  let recovery = 0;
  let spawn = 0;
  let planSteps = 0;
  let routerPicks = 0;
  let checkpoints = 0;
  for (const ev of trace) {
    if (typeof ev.role === 'string' && ev.role) roles.add(ev.role);
    // plan — план построен; plan.step/task_step — шаги исполняются
    // (tasks_*-контуры маркируют шаги именно task_step).
    if (ev.type === 'plan' || ev.type === 'plan.step' || ev.type === 'task_step') planSteps += 1;
    else if (ev.type === 'checkpoint') checkpoints += 1;
    else if (ev.type === 'recovery') recovery += 1;
    else if (ev.type === 'spawn') spawn += 1;
    else if (ev.type === 'router_choice') routerPicks += 1;
    else if (ev.type === 'tool_call') {
      const t = eventTool(ev.body);
      if (t == null) continue;
      if (t === 'memory_search') {
        memoryCalls += 1;
        const sc = (ev.body as { retrieval_scores?: unknown }).retrieval_scores;
        if (Array.isArray(sc)) {
          memoryHits = Math.max(memoryHits, sc.filter((s): s is number => typeof s === 'number').length);
        }
      } else {
        tools.set(t, (tools.get(t) ?? 0) + 1);
      }
    }
  }
  const execCalls = trace.filter((e) => e.type === 'model_call' && e.role === 'executor').length;
  const toolNames = [...tools.keys()].join(', ');
  // Конфигурационное событие фиксирует, был ли контур собран с памятью —
  // тогда незажёгшийся чип честно говорит «включена, но не вызывалась»,
  // а не маскируется под «памяти нет в контуре».
  const memoryArmed = trace.some(
    (ev) => ev.type === 'config' && (ev.body as { memory?: unknown }).memory === true);
  return [
    { id: 'plan', label: 'план', lit: roles.has('planner') || planSteps > 0, detail: planSteps > 0 ? String(planSteps) : undefined },
    {
      id: 'memory', label: 'память', lit: memoryCalls > 0,
      detail: memoryCalls > 0 ? (memoryHits > 0 ? `${memoryHits} док.` : 'без совпадений') : undefined,
      hint: memoryCalls === 0 && memoryArmed
        ? 'контур с памятью — модель не вызывала memory_search в этом прогоне'
        : undefined,
    },
    { id: 'exec', label: 'исполнитель', lit: roles.has('executor'), detail: execCalls > 1 ? `×${execCalls}` : undefined },
    { id: 'tools', label: 'инструменты', lit: tools.size > 0, detail: tools.size > 0 ? String(tools.size) : undefined, hint: tools.size > 0 ? `вызваны: ${toolNames}` : undefined },
    { id: 'critic', label: 'критик', lit: roles.has('critic') },
    { id: 'arbiter', label: 'арбитр', lit: roles.has('arbiter') },
    { id: 'verify', label: 'проверка', lit: roles.has('verifier') || checkpoints > 0, detail: checkpoints > 0 ? `×${checkpoints}` : undefined },
    { id: 'router', label: 'роутер', lit: routerPicks > 0 },
    { id: 'recovery', label: 'recovery', lit: recovery > 0, detail: recovery > 0 ? `×${recovery}` : undefined },
    { id: 'spawn', label: 'суб-агенты', lit: spawn > 0, detail: spawn > 0 ? `×${spawn}` : undefined },
  ];
}

/**
 * Интерпретация live-драфта: некоторые модели стримят JSON-обёртки
 * ({"answer": "…"} / промежуточные ключи). В чате показываем читаемый
 * текст — поля-кандидаты извлекаются из распарсенного объекта; для
 * недопарсенного фрагмента (стрим ещё идёт) — собираются уже пришедшие
 * строковые значения. Ничего не выдумываем: обычный текст возвращается
 * как есть, JSON без читаемых полей — честная пометка.
 */
const DRAFT_TEXT_KEYS = ['answer', 'text', 'response', 'content', 'message', 'result', 'reply'];

/** Метки известных JSON-ключей ответов/планов модели — интерпретатор
 *  показывает «критерии: …» вместо сырого имени ключа. */
const JSON_KEY_LABELS: Record<string, string> = {
  answer: 'ответ', text: 'текст', response: 'ответ', content: 'содержимое',
  message: 'сообщение', result: 'результат', reply: 'ответ',
  success_criteria: 'критерии', criteria: 'критерии',
  steps: 'шаги', plan: 'план', tasks: 'задачи', task: 'задача',
  notes: 'заметки', issues: 'проблемы', verdict: 'вердикт',
  confidence: 'уверенность', reasoning: 'ход мысли', summary: 'итог',
  files: 'файлы', status: 'статус', score: 'оценка',
};

function collectStrings(value: unknown, depth: number): string[] {
  if (depth > 3 || value == null) return [];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((v) => collectStrings(v, depth + 1));
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keyed = DRAFT_TEXT_KEYS.flatMap((k) => collectStrings(obj[k], depth + 1));
    if (keyed.length > 0) return keyed;
    return Object.values(obj).flatMap((v) => collectStrings(v, depth + 1));
  }
  return [];
}

/** Рекурсивный рендер распарсенного JSON: скаляры и списки — строки,
 *  объекты — помеченные «ключ: значение» линии. Глубина ограничена,
 *  длинные списки схлопываются в счётчик — интерпретация, не dump. */
function interpretParsed(value: unknown, depth: number): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (depth >= 2) return `[${value.length}]`;
    const parts = value.map((v) => interpretParsed(v, depth + 1)).filter((s) => s !== '');
    if (parts.length > 8) return `${parts.slice(0, 8).join(' · ')} · … +${parts.length - 8}`;
    return parts.join(' · ');
  }
  if (typeof value === 'object') {
    if (depth >= 2) {
      const s = collectStrings(value, depth).join(' · ');
      return s !== '' ? s : '{…}';
    }
    const lines: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const body = interpretParsed(v, depth + 1);
      if (body === '') continue;
      lines.push(`${JSON_KEY_LABELS[k] ?? k}: ${body}`);
    }
    return lines.join('\n');
  }
  return '';
}

function unescapeJson(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/** Текст ответа model_call-события (сообщение LLM) — verbatim-поле body.text.
 *  Пустой/не-строковый → null (tool_call-модель без текста). */
export function modelTextOf(body: unknown): string | null {
  const t = (body as { text?: unknown } | null | undefined)?.text;
  return typeof t === 'string' && t.trim() !== '' ? t : null;
}

/** Фактическое потребление прогона: final.usage — итог от хоста (приоритет);
 *  живой прогон — накопление по model_call/tool_call событиям трейса. */
export interface RunUsageView {
  modelCalls: number;
  toolCalls: number;
  tokens: number;
  costUsd: number;
}

export function runUsageOf(trace: RunEventView[]): RunUsageView | null {
  for (let i = trace.length - 1; i >= 0; i -= 1) {
    const ev = trace[i];
    if (ev.type !== 'final') continue;
    const u = (ev.body as { usage?: unknown } | null)?.usage as Record<string, unknown> | null | undefined;
    if (u != null) {
      return {
        modelCalls: typeof u.model_calls === 'number' ? u.model_calls : 0,
        toolCalls: typeof u.tool_calls === 'number' ? u.tool_calls : 0,
        tokens: typeof u.tokens === 'number' ? u.tokens : 0,
        costUsd: typeof u.cost_usd === 'number' ? u.cost_usd : 0,
      };
    }
  }
  let modelCalls = 0, toolCalls = 0, tokens = 0, costUsd = 0, seen = false;
  for (const ev of trace) {
    if (ev.type === 'model_call') {
      modelCalls += 1; seen = true;
      const b = ev.body as { tokens_in?: unknown; tokens_out?: unknown; cost_usd?: unknown } | null;
      if (typeof b?.tokens_in === 'number') tokens += b.tokens_in;
      if (typeof b?.tokens_out === 'number') tokens += b.tokens_out;
      if (typeof b?.cost_usd === 'number') costUsd += b.cost_usd;
    } else if (ev.type === 'tool_call') {
      toolCalls += 1; seen = true;
    }
  }
  return seen ? { modelCalls, toolCalls, tokens, costUsd } : null;
}

/** Лимиты контура прогона — поле `limits` config-события (asdict с хоста:
 *  max_model_calls/max_tool_calls/max_tokens/max_cost_usd). Нет события → null. */
export interface RunLimitsView {
  maxModelCalls?: number;
  maxToolCalls?: number;
  maxTokens?: number;
  maxCostUsd?: number;
}

export function runLimitsOf(trace: RunEventView[]): RunLimitsView | null {
  const cfg = trace.find((e) => e.type === 'config');
  const l = (cfg?.body as { limits?: unknown } | null | undefined)?.limits as Record<string, unknown> | null | undefined;
  if (l == null) return null;
  const r: RunLimitsView = {
    maxModelCalls: typeof l.max_model_calls === 'number' ? l.max_model_calls : undefined,
    maxToolCalls: typeof l.max_tool_calls === 'number' ? l.max_tool_calls : undefined,
    maxTokens: typeof l.max_tokens === 'number' ? l.max_tokens : undefined,
    maxCostUsd: typeof l.max_cost_usd === 'number' ? l.max_cost_usd : undefined,
  };
  return Object.values(r).some((v) => v != null) ? r : null;
}

/** spawn_agent-результат «запущен суб-агент sub-N (run_id <hex>)» →
 *  хэндл + run_id ребёнка для ссылки на дочерний прогон. Только наблюдаемый
 *  verbatim-формат хоста; нет совпадения → null. */
export function childRunOf(body: unknown): { handle: string; runId: string } | null {
  const res = (body as { result?: unknown } | null | undefined)?.result;
  if (typeof res !== 'string') return null;
  const m = res.match(/суб-агент\s+(sub-\d+)\s*\(run_id\s+([0-9a-f]{8,64})\)/i);
  return m != null ? { handle: m[1], runId: m[2] } : null;
}

/** spawn-событие дочернего прогона несёт `handle` («sub-N») verbatim —
 *  для пометок «субагент»/заголовков групп. Нет события/поля → null. */
export function spawnHandleOf(trace: RunEventView[]): string | null {
  const ev = trace.find((e) => e.type === 'spawn');
  const h = (ev?.body as { handle?: unknown } | null | undefined)?.handle;
  return typeof h === 'string' ? h : null;
}

/** wait_agent-результат: хост возвращает ответ ребёнка + сводку
 *  «[sub-N: шагов X, вызовов Y, $Z]» verbatim. Отдаём handle, ответ
 *  (текст до строки-сводки) и метрики для строки трейса; нет
 *  совпадения → null (не выдумываем формат). */
export function waitAgentOf(body: unknown): { handle: string; answer: string; metrics: string } | null {
  const b = body as { tool?: unknown; result?: unknown } | null | undefined;
  if (b?.tool !== 'wait_agent' || b.result == null) return null;
  // Dual-path (arch-wave U1 / W1 B3): структурированный результат —
  // объект с полями verbatim; строкового формата нет → текстовый парс.
  if (typeof b.result === 'object' && !Array.isArray(b.result)) {
    const r = b.result as Record<string, unknown>;
    const handle = [r.handle, r.sub, r.agent].find((v) => typeof v === 'string' && v !== '') as string | undefined;
    const answer = [r.answer, r.text, r.response].find((v) => typeof v === 'string') as string | undefined;
    if (handle == null && answer == null) return null;
    const metrics: string[] = [];
    const steps = [r.steps, r.n_steps].find((v) => typeof v === 'number') as number | undefined;
    if (steps != null) metrics.push(`шагов ${steps}`);
    // Landed B3 contract: model_calls/tool_calls/cost_usd — отдельные поля,
    // формат «моделей X · инструменты Y» совпадает со stat-строкой хоста.
    const modelCalls = [r.model_calls, r.calls].find((v) => typeof v === 'number') as number | undefined;
    const toolCalls = typeof r.tool_calls === 'number' ? r.tool_calls : undefined;
    if (modelCalls != null && toolCalls != null) {
      metrics.push(`моделей ${modelCalls} · инструментов ${toolCalls}`);
    } else if (modelCalls != null) {
      metrics.push(`вызовов ${modelCalls}`);
    } else if (toolCalls != null) {
      metrics.push(`инструментов ${toolCalls}`);
    }
    const cost = [r.cost_usd, r.cost].find((v) => typeof v === 'number') as number | undefined;
    if (cost != null) metrics.push(`$${cost}`);
    return { handle: handle ?? 'sub-?', answer: (answer ?? '').trim(), metrics: metrics.join(' · ') };
  }
  if (typeof b.result !== 'string') return null;
  const m = b.result.match(/\[(sub-\d+):\s*([^\]]+)\]/);
  if (m == null) return null;
  const answer = b.result
    .slice(0, m.index)
    .replace(/<\/?tool_output>/g, '')
    .trim();
  return { handle: m[1], answer, metrics: m[2].trim() };
}

/** emit_step (arch-wave B1) — structured шаг планировщика: id (`s2` от
 *  landed-хоста `step_id`, старый сид `id`), текст verbatim
 *  (`step`/`text`/`title`), depends_on verbatim если пришли в теле,
 *  status verbatim («started»/…). Ничего нет → null. */
export function emitStepOf(body: unknown): { id: string | null; text: string; dependsOn: string[]; status: string | null } | null {
  const b = body as { id?: unknown; step_id?: unknown; step?: unknown; text?: unknown; title?: unknown; depends_on?: unknown; status?: unknown } | null | undefined;
  const text = [b?.step, b?.text, b?.title].find((x) => typeof x === 'string' && x.trim() !== '');
  const id = ([b?.id, b?.step_id].find((x) => typeof x === 'string' && x !== '') as string | undefined) ?? null;
  const dependsOn = Array.isArray(b?.depends_on)
    ? b!.depends_on.filter((d): d is string => typeof d === 'string' && d !== '')
    : [];
  const status = typeof b?.status === 'string' && b.status !== '' ? b.status : null;
  if (text == null && id == null) return null;
  return { id, text: typeof text === 'string' ? text.trim() : '', dependsOn, status };
}

export interface PlanStepView {
  seq: number;
  id: string | null;
  text: string;
  dependsOn: string[];
  /** Verbatim check-условие шага из plan-записи ('' → нет). */
  check: string;
  /** Статус: verbatim из plan-записи (done/failed/skipped/pending) либо
   *  выводимый — emit_step «started» → active; для emit_step-only трейса
   *  последний шаг — active, предыдущие — done. */
  status: 'done' | 'active' | 'pending' | 'failed' | 'skipped';
}

const PLAN_STEP_STATUSES = new Set(['pending', 'done', 'failed', 'skipped', 'active', 'started']);

/** neu-ux U-1: DAG плана. Авторитет — последнее `plan`-событие: steps[]
 *  несут id/step/depends_on/status verbatim (landed W1-B1). Отдельные
 *  emit_step без plan-записи — fallback: узлы verbatim, статус по порядку.
 *  Нет событий → [] — план не синтезируем из других источников. */
export function planDagOf(trace: RunEventView[]): PlanStepView[] {
  const planEv = [...trace].reverse().find((e) => e.type === 'plan');
  const steps = (planEv?.body as { steps?: unknown } | null | undefined)?.steps;
  if (Array.isArray(steps) && steps.length > 0) {
    const started = new Set<string>();
    const outcomes = new Map<string, string>();
    for (const ev of trace) {
      if (ev.type === 'emit_step') {
        const s = emitStepOf(ev.body);
        if (s?.id != null && (s.status == null || s.status === 'started' || s.status === 'active')) started.add(s.id);
      } else if (ev.type === 'task_step') {
        const o = ev.body as { step_id?: unknown; id?: unknown; status?: unknown } | null;
        const sid = [o?.step_id, o?.id].find((x) => typeof x === 'string' && x !== '');
        if (typeof sid === 'string' && typeof o?.status === 'string' && PLAN_STEP_STATUSES.has(o.status)) {
          outcomes.set(sid, o.status);
        }
      }
    }
    const rows: PlanStepView[] = [];
    steps.forEach((raw, i) => {
      const o = raw as { id?: unknown; step?: unknown; text?: unknown; title?: unknown; depends_on?: unknown; status?: unknown; check?: unknown } | null;
      const text = [o?.step, o?.text, o?.title].find((x) => typeof x === 'string' && x.trim() !== '');
      const id = typeof o?.id === 'string' && o.id !== '' ? o.id : null;
      if (text == null && id == null) return;
      const dependsOn = Array.isArray(o?.depends_on)
        ? o!.depends_on.filter((d): d is string => typeof d === 'string' && d !== '')
        : [];
      // Приоритет статуса: исход task_step (финальная правда) → verbatim plan-
      // запись → emit_step «started» → pending. Завершённость не выдумываем.
      const rawStatus = (id != null ? outcomes.get(id) : undefined)
        ?? (typeof o?.status === 'string' && PLAN_STEP_STATUSES.has(o.status) ? o.status : '');
      const status: PlanStepView['status'] =
        rawStatus === 'done' ? 'done'
          : rawStatus === 'failed' ? 'failed'
            : rawStatus === 'skipped' ? 'skipped'
              : rawStatus === 'active' || rawStatus === 'started' ? 'active'
                : id != null && started.has(id) ? 'active'
                  : 'pending';
      const check = typeof o?.check === 'string' ? o.check : '';
      rows.push({ seq: (planEv?.seq ?? 0) * 1000 + i, id, text: typeof text === 'string' ? text.trim() : '', dependsOn, check, status });
    });
    if (rows.length > 0) return rows;
  }
  const rows: Omit<PlanStepView, 'status'>[] = [];
  for (const ev of trace) {
    if (ev.type !== 'emit_step') continue;
    const s = emitStepOf(ev.body);
    if (s == null) continue;
    rows.push({ seq: ev.seq, id: s.id, text: s.text, dependsOn: s.dependsOn, check: '' });
  }
  return rows.map((r, i) => ({ ...r, status: i === rows.length - 1 ? 'active' : 'done' }));
}

/** neu-ux V-1: plan DAG → graph view-model для PlanDag — узлы verbatim
 *  (id/текст/статус), рёбра из depends_on; шаг с check-условием → kind
 *  'check' (diamond-форма). Нет шагов → честный empty. */
export function planGraphOf(trace: RunEventView[]): NexusGraphData {
  const steps = planDagOf(trace);
  const nodes = steps.map((s) => ({
    id: s.id ?? `step-${s.seq}`,
    label: s.text !== '' ? s.text : (s.id ?? `шаг ${s.seq}`),
    kind: s.check !== '' ? 'check' : 'step',
    status: s.status,
  }));
  const ids = new Set(nodes.map((n) => n.id));
  const edges: NexusGraphEdge[] = steps.flatMap((s) => {
    const to = s.id ?? `step-${s.seq}`;
    return s.dependsOn
      .filter((d) => ids.has(d))
      .map((d) => ({ from: d, to, kind: 'depends' }));
  });
  return { nodes, edges, state: nodes.length === 0 ? 'empty' : 'ready' };
}

/** neu-ux V-2: семья прогонов → граф сообщений. Узлы — прогоны (root +
 *  суб-агенты), рёбра — только наблюдаемые send_message tool_call
 *  (направление verbatim из события, подпись = время + текст). agent
 *  'parent' резолвится в корень, sub-N — по handle. Нет семьи → empty. */
export interface MessageGraphSource {
  runId: string;
  handle?: string | null;
  status?: string;
  kind?: 'root' | 'sub';
  trace: RunEventView[];
}

export function messageGraphOf(family: MessageGraphSource[]): NexusGraphData {
  const byHandle = new Map<string, string>();
  const byId = new Set<string>();
  for (const m of family) {
    byId.add(m.runId);
    if (m.handle != null && m.handle !== '') byHandle.set(m.handle, m.runId);
  }
  const root = family.find((m) => m.kind === 'root') ?? family[0];
  const nodes = family.map((m) => ({
    id: m.runId,
    label: m.handle != null && m.handle !== '' ? `${m.handle} · ${m.runId.slice(0, 8)}` : m.runId.slice(0, 8),
    kind: m === root ? 'root' : 'sub',
    status: m.status,
  }));
  const edges: NexusGraphEdge[] = [];
  for (const m of family) {
    for (const ev of m.trace) {
      if (ev.type !== 'tool_call') continue;
      const b = ev.body as { tool?: unknown; input?: unknown } | null;
      if (b?.tool !== 'send_message') continue;
      const input = (b.input ?? null) as { agent?: unknown; text?: unknown } | null;
      const target = typeof input?.agent === 'string' && input.agent !== '' ? input.agent : null;
      if (target == null) continue;
      const to = target === 'parent' ? root?.runId : byHandle.get(target) ?? (byId.has(target) ? target : null);
      if (to == null || to === m.runId) continue; // цель вне семьи — ребро не рисуем
      const text = typeof input?.text === 'string' ? input.text : '';
      edges.push({
        from: m.runId,
        to,
        label: `${fmtEventTime(ev.ts)}${text !== '' ? ` · ${text}` : ''}`,
        kind: 'message',
      });
    }
  }
  return { nodes, edges, state: nodes.length === 0 ? 'empty' : 'ready' };
}

/** U-4: инспектор «что видит модель» — поля config-события verbatim
 *  (fs_policy/tools/capabilities/limits); spawn-аудит ребёнка — поле audit
 *  spawn-события. Отсутствующие поля не выдумываются — строки не рисуются. */
export interface ModelViewRow { label: string; value: string; source: string }
export function modelViewOf(trace: RunEventView[]): ModelViewRow[] {
  const rows: ModelViewRow[] = [];
  const cfg = trace.find((e) => e.type === 'config')?.body as Record<string, unknown> | null | undefined;
  if (cfg != null) {
    const fp = cfg.fs_policy as { mode?: unknown; roots?: unknown } | null | undefined;
    if (fp != null) {
      const roots = Array.isArray(fp.roots)
        ? fp.roots
          .map((r) => {
            const o = r as { path?: unknown; access?: unknown };
            return typeof o?.path === 'string' ? `${o.path}${typeof o.access === 'string' ? `:${o.access}` : ''}` : null;
          })
          .filter((x): x is string => x != null)
        : [];
      rows.push({
        label: 'fs_policy',
        value: `${typeof fp.mode === 'string' ? fp.mode : '?'}${roots.length > 0 ? ` · ${roots.join(', ')}` : ''}`,
        source: 'config.fs_policy',
      });
    }
    for (const key of ['tools', 'capabilities'] as const) {
      const v = cfg[key];
      if (Array.isArray(v) && v.length > 0) {
        rows.push({ label: key, value: v.filter((x) => typeof x === 'string').join(', '), source: `config.${key}` });
      }
    }
    const l = runLimitsOf(trace);
    if (l != null) {
      const parts: string[] = [];
      if (l.maxTokens != null) parts.push(`tokens ≤ ${l.maxTokens.toLocaleString('ru-RU')}`);
      if (l.maxCostUsd != null) parts.push(`cost ≤ $${l.maxCostUsd}`);
      if (l.maxModelCalls != null) parts.push(`model ≤ ${l.maxModelCalls}`);
      if (l.maxToolCalls != null) parts.push(`tools ≤ ${l.maxToolCalls}`);
      if (parts.length > 0) rows.push({ label: 'limits', value: parts.join(' · '), source: 'config.limits' });
    }
  }
  for (const ev of trace) {
    if (ev.type !== 'spawn') continue;
    const audit = (ev.body as { audit?: unknown } | null | undefined)?.audit;
    if (typeof audit === 'string' && audit !== '') {
      rows.push({ label: 'аудит субагента', value: audit, source: 'spawn.audit' });
    }
  }
  return rows;
}

/** U-6: экспорт прогона в .md — задача, шаги плана (emit_step), fs-операции,
 *  финальный ответ. Клиентская сборка из загруженных событий; нет данных →
 *  секция пропускается, ничего не выдумывается. */
export function runReportMd(taskText: string, trace: RunEventView[], answer: string | null): string {
  const out: string[] = [`# Прогон: ${taskText}`, ''];
  const steps = planDagOf(trace);
  if (steps.length > 0) {
    out.push('## План');
    for (const s of steps) {
      out.push(`- [${s.status === 'done' ? 'x' : ' '}] ${s.id != null ? `${s.id} ` : ''}${s.text}${s.dependsOn.length > 0 ? ` (после ${s.dependsOn.join(', ')})` : ''}`);
    }
    out.push('');
  }
  const ops = fsOpsOf(trace);
  if (ops.length > 0) {
    out.push('## Файловые операции');
    for (const op of ops) {
      out.push(`- ${op.verb} \`${op.target}\`${op.isError ? ` — ошибка${op.reason != null ? `: ${op.reason}` : ''}` : ''}`);
    }
    out.push('');
  }
  const usage = runUsageOf(trace);
  const limits = runLimitsOf(trace);
  if (usage != null) {
    out.push('## Потребление');
    out.push(`- токены: ${usage.tokens.toLocaleString('ru-RU')}${limits?.maxTokens != null ? ` / ${limits.maxTokens.toLocaleString('ru-RU')}` : ''}`);
    out.push(`- cost: $${usage.costUsd.toFixed(4)}${limits?.maxCostUsd != null ? ` / ≤ $${limits.maxCostUsd}` : ''}`);
    out.push(`- вызовы модели: ${usage.modelCalls} · инструментов: ${usage.toolCalls}`);
    out.push('');
  }
  if (answer != null && answer !== '') {
    out.push('## Ответ', '', answer, '');
  }
  return out.join('\n');
}

/** arch-wave A1: restore_file — аффорданс «файл восстановлен из снапшота»
 *  в трейсе. Цель — `input.path` (+`root`) verbatim; инструмента нет → null. */
export function restoreOpOf(body: unknown): { path: string } | null {
  const b = body as { tool?: unknown } | null | undefined;
  if (b?.tool !== 'restore_file') return null;
  const target = toolTargetOf(body);
  return target != null ? { path: target } : null;
}

/** Diff-аффорданс записи/патча: unified-diff текст из `result.diff`
 *  (A1 wire) либо строкового результата с @@-секциями + размеры до/после
 *  (verbatim-числа хоста). Ничего не наблюдалось → null. */
export function diffOf(body: unknown): { diff: string; before: number | null; after: number | null } | null {
  const b = body as { result?: unknown; input?: unknown } | null | undefined;
  const ro = (b?.result as Record<string, unknown> | null | undefined);
  const rd = ro?.diff ?? (b?.input as { diff?: unknown } | null | undefined)?.diff;
  const raw = typeof rd === 'string' && rd !== '' ? rd
    : typeof b?.result === 'string' && b.result.includes('@@') ? b.result : null;
  if (raw == null) return null;
  const t = raw.replace(/<\/?tool_output>/g, '').trim();
  if (t === '') return null;
  const before = [ro?.before_bytes, ro?.old_size, ro?.size_before].find((v) => typeof v === 'number') as number | undefined;
  const after = [ro?.after_bytes, ro?.new_size, ro?.size_after].find((v) => typeof v === 'number') as number | undefined;
  return {
    diff: t.length > 600 ? `${t.slice(0, 597)}…` : t,
    before: before ?? null,
    after: after ?? null,
  };
}

export function humanizeDraft(raw: string): string {
  const t = raw.trimStart();
  if (t === '' || (t[0] !== '{' && t[0] !== '[' && t[0] !== '"')) return raw;
  try {
    let parsed = JSON.parse(t) as unknown;
    // Однополевая обёртка — конверт: спускаемся к полезной нагрузке,
    // чтобы {plan:{response:"…"}} читался голым текстом.
    while (
      typeof parsed === 'object' && parsed != null && !Array.isArray(parsed)
      && Object.keys(parsed).length === 1
    ) {
      parsed = Object.values(parsed)[0];
    }
    if (typeof parsed === 'string' && parsed.trim() !== '') return parsed.trim();
    // Чистый текст-ответ (все ключи — текстовые поля) → голый текст.
    if (
      typeof parsed === 'object' && parsed != null && !Array.isArray(parsed)
      && Object.keys(parsed).length > 0
      && Object.keys(parsed).every((k) => DRAFT_TEXT_KEYS.includes(k))
    ) {
      const fields = collectStrings(parsed, 0);
      if (fields.length > 0) return fields.join('\n');
    }
    // Смешанный/плановый JSON → интерпретатор с метками ключей.
    const out = interpretParsed(parsed, 0);
    if (out !== '') return out.length > 2000 ? `${out.slice(0, 1997)}…` : out;
    const fields = collectStrings(parsed, 0);
    if (fields.length > 0) return fields.join('\n');
    return 'структурированный ответ модели (без текстового поля)';
  } catch {
    // Неполный JSON — стрим ещё идёт: вытаскиваем закрытые строковые
    // значения известных ключей, чтобы метки не мелькали сырыми.
    const parts: string[] = [];
    const re = /"(?:answer|text|response|content|message|result|reply)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    for (const m of raw.matchAll(re)) {
      const v = m[1]?.trim();
      if (v) parts.push(unescapeJson(v));
    }
    return parts.length > 0 ? parts.join('\n') : 'формирует структурированный ответ…';
  }
}

// Memoized feed row (NQ-059): stream ticks re-render the panel, but unchanged
// rows bail out — ev refs are stable inside the events array.
const FeedRow = memo(function FeedRow({ ev }: { ev: RunEventView }) {
  const body = summarize(ev.body);
  const tool = eventTool(ev.body);
  return (
    <li className={styles.event} data-type={ev.type}>
      <span className={styles.eventSeq}>{ev.seq}</span>
      <span className={styles.eventTime}>{fmtEventTime(ev.ts)}</span>
      <span className={styles.eventType}>{EVENT_LABELS[ev.type] ?? ev.type}</span>
      {ev.role && <span className={styles.eventRole}>{ev.role}</span>}
      {tool && <span className={styles.eventTool}>{tool}</span>}
      <span className={styles.eventBody} title={body}>{body}</span>
      {eventArtifacts(ev.body).map((a) => (
        <span key={a} className={styles.eventArtifact} title={`артефакт ${a}`}>{a}</span>
      ))}
    </li>
  );
});

function localMidnightS(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function EventFeed({
  ds,
  runId,
  active,
  epoch,
  hasRun,
  onEnd,
  onStale,
}: {
  ds: ProductDataSource;
  runId: string | null;
  active: boolean;
  epoch: number;
  hasRun: boolean;
  onEnd: (status: RunStatus) => void;
  onStale: (paused: boolean) => void;
}) {
  const [events, setEvents] = useState<RunEventView[]>([]);
  const [eventFilter, setEventFilter] = useState<'all' | 'plan' | 'tools' | 'models' | 'final'>('all');
  const [follow, setFollow] = useState(true);
  const feedRef = useRef<HTMLOListElement | null>(null);
  /** Счётчик «наших» программных прокруток ленты (см. эффект ниже). */
  const autoScrollRef = useRef(0);

  useEffect(() => {
    if (!active || runId == null) return;
    setEvents([]);
    onStale(false);
    return ds.streamRun(runId, {
      onEvent: (ev) =>
        setEvents((prev) => (prev.some((p) => p.seq === ev.seq) ? prev : [...prev, ev].sort((a, b) => a.seq - b.seq))),
      onGap: onStale,
      onEnd,
    });
  }, [ds, runId, active, epoch, onEnd, onStale]);

  // W3-03 feed: filter + bounded window; follow-scroll only at the bottom
  // so reading history is never yanked by new events.
  const filteredEvents = useMemo(
    () => (eventFilter === 'all' ? events : events.filter((ev) => EVENT_GROUP[ev.type] === eventFilter)),
    [events, eventFilter],
  );
  const shownEvents = useMemo(() => filteredEvents.slice(-MAX_FEED_EVENTS), [filteredEvents]);
  const hiddenEvents = filteredEvents.length - shownEvents.length;

  useEffect(() => {
    const el = feedRef.current;
    if (!follow || !el) return;
    // Автопрокрутка — на КАЖДЫЙ рендер, а не только на смену длины списка:
    // содержимое может вырасти (новое событие, подсказка «показаны
    // последние N»), и без перепрокрутки лента оставалась не внизу — флаг
    // follow сбивался, пила «↓ к новым событиям» мигала, высота панели
    // скакала (детерминированные скриншоты гейта расходились).
    if (el.scrollTop < el.scrollHeight - el.clientHeight - 1) {
      // Счётчик, а не флаг: событие scroll приходит на следующем кадре, и
      // один «наш» скролл должен съедать ровно одно событие (пользовательский
      // скролл после этого считается пользовательским).
      autoScrollRef.current += 1;
      el.scrollTop = el.scrollHeight;
    }
  });

  const onFeedScroll = (e: UIEvent<HTMLOListElement>) => {
    if (autoScrollRef.current > 0) { autoScrollRef.current -= 1; return; } // это наша прокрутка
    const el = e.currentTarget;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight <= 32);
  };

  return (
    <GlassPanel className={styles.panel} data-state={events.length ? 'ready' : hasRun ? 'loading' : 'empty'} data-testid="event-feed">
      <div className={styles.panelHead}>
        <h3 className={styles.panelTitle}>События</h3>
        {events.length > 0 && (
          <span className={styles.prefChoices} role="group" aria-label="Фильтр событий">
            {(Object.keys(EVENT_FILTER_LABELS) as (keyof typeof EVENT_FILTER_LABELS)[]).map((f) => (
              <button
                key={f}
                type="button"
                className={styles.prefChoice}
                data-selected={eventFilter === f ? 'true' : undefined}
                onClick={() => setEventFilter(f)}
              >
                {EVENT_FILTER_LABELS[f]}
              </button>
            ))}
          </span>
        )}
      </div>
      {events.length === 0 ? (
        !hasRun ? (
          <EmptyState variant="inline" title="Запустите прогон, чтобы увидеть поток." />
        ) : (
          <LoadingState>Ожидание событий…</LoadingState>
        )
      ) : shownEvents.length === 0 ? (
        <EmptyState variant="inline" title="В этой категории событий пока нет." />
      ) : (
        <>
          {hiddenEvents > 0 && (
            <p className={styles.emptyHint}>Показаны последние {MAX_FEED_EVENTS} из {filteredEvents.length} событий.</p>
          )}
          <ol className={styles.eventList} tabIndex={0} ref={feedRef} onScroll={onFeedScroll}>
            {shownEvents.map((ev) => (
              <FeedRow key={ev.seq} ev={ev} />
            ))}
          </ol>
          {!follow && (
            <button
              type="button"
              className={styles.newEventsPill}
              onClick={() => {
                setFollow(true);
                feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
              }}
            >
              ↓ к новым событиям
            </button>
          )}
        </>
      )}
    </GlassPanel>
  );
}

/** Live-run cockpit: attach, status, controls (pause/resume/checkpoint/
 *  replay/retry/cancel) and the full event feed. Moved from the process tab —
 *  the chat keeps only the conversational surface. */
export function RunOpsPanel() {
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const [run, setRun] = useState<RunSummary | null>(null);
  const [attachFailed, setAttachFailed] = useState(false);
  const [controls, setControls] = useState<RunControlState | null>(null);
  const [controlsBusy, setControlsBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [streamEpoch, setStreamEpoch] = useState(0);
  const [stale, setStale] = useState(false);

  const reloadActive = useCallback(() => {
    setAttachFailed(false);
    ds.listRuns({ limit: 20 })
      .then((v) => {
        setRun((prev) => {
          // Keep an in-flight run we already track; else attach the running
          // one, else fall back to the latest known run so terminal actions
          // (Повтор/Заново) stay reachable.
          if (prev != null && v.some((r) => r.runId === prev.runId)) return prev;
          return v.find((r) => r.status === 'running') ?? v[0] ?? prev;
        });
      })
      .catch(() => setAttachFailed(true));
  }, [ds]);

  useEffect(() => {
    reloadActive();
  }, [reloadActive]);

  // Run controls (W3-04/05): reload when the shown run or its status changes.
  useEffect(() => {
    if (ds.getRunControls == null || run == null) {
      setControls(null);
      return;
    }
    let live = true;
    Promise.resolve(ds.getRunControls(run.runId))
      .then((c) => { if (live) setControls(c); })
      .catch(() => { if (live) setControls(null); });
    return () => { live = false; };
  }, [ds, run?.runId, run?.status]);

  const onStreamEnd = useCallback((status: RunStatus) => {
    setReplaying(false);
    if (status === 'running') {
      // Поток оборвался (реконнекты исчерпаны), а прогон может ещё
      // выполняться. Финальный статус и время завершения ставить нельзя —
      // прогон не закончился; но «живые» данные перестали быть живыми, и
      // панель честно показывает stale вместо live.
      setStale(true);
      return;
    }
    setRun((prev) => (prev == null ? prev : { ...prev, status, stopReason: status, finishedAt: Math.floor(Date.now() / 1000) }));
  }, []);
  const onStreamStale = useCallback((paused: boolean) => setStale(paused), []);
  // Stream is open while the shown run runs or a replay re-arms it.
  const streamActive = run != null && (run.status === 'running' || replaying);

  const cancel = async () => {
    if (run == null || run.status !== 'running' || controlsBusy) return;
    setControlsBusy(true);
    setControlError(null);
    try {
      await ds.cancelRun(run.runId);
      // Помечаем отменённым только если прогон ещё считался выполняющимся:
      // иначе финальный статус из потока (done/error) был бы затёрт.
      setRun((prev) => (prev != null && prev.status === 'running'
        ? { ...prev, status: 'cancelled', stopReason: 'cancelled', finishedAt: Math.floor(Date.now() / 1000) }
        : prev));
    } catch {
      // Отмена не выполнена (хост отказал / прогона уже нет) — прогон
      // продолжает выполняться, показываем причину вместо тишины.
      setControlError('Отмена не выполнена рантаймом. Повторите.');
    } finally {
      setControlsBusy(false);
    }
  };

  const actControl = async (kind: 'pause' | 'resume' | 'replay' | 'checkpoint') => {
    if (run == null || controlsBusy) return;
    const fn =
      kind === 'pause' ? ds.pauseRun
        : kind === 'resume' ? ds.resumeRun
          : kind === 'replay' ? ds.replayRun
            : ds.checkpointRun;
    if (fn == null) return;
    setControlsBusy(true);
    setControlError(null);
    try {
      const next = await fn(run.runId);
      if (next != null) setControls(next);
      if (kind === 'replay' && next != null) {
        setReplaying(true);
        setStreamEpoch((n) => n + 1);
      }
    } catch {
      setControlError('Действие не выполнено рантаймом. Повторите.');
    } finally {
      setControlsBusy(false);
    }
  };

  const retryRun = async () => {
    if (run == null || ds.retryRun == null || controlsBusy) return;
    setControlsBusy(true);
    setControlError(null);
    try {
      const next = await ds.retryRun(run.runId);
      if (next != null) {
        // Retry = a brand new run — swap the panel to it and stream.
        setReplaying(false);
        setRun(next);
      }
    } catch {
      setControlError('Действие не выполнено рантаймом. Повторите.');
    } finally {
      setControlsBusy(false);
    }
  };

  return (
    <>
      <GlassPanel
        className={styles.panel}
        data-state={attachFailed ? 'error' : run == null ? 'empty' : 'ready'}
        data-freshness={run?.status === 'running' ? (stale ? 'stale' : 'live') : undefined}
        data-testid="live-run"
      >
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>Текущий прогон</h3>
          {run && (
            <div className={styles.runMeta}>
              {replaying && <StatusBadge status="syncing" label="ПОВТОР" />}
              {controls?.paused === true && run.status === 'running' && (
                <StatusBadge status="paused" label="ПАУЗА" />
              )}
              {stale && run.status === 'running' && <StatusBadge status="syncing" label="СИНХРОНИЗАЦИЯ" />}
              <StatusBadge {...STATUS_BADGE[run.status]} />
              {ds.getRunControls != null && controls != null && (
                <>
                  {run.status === 'running' && !controls.paused && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!controls.pause.available || ds.pauseRun == null || controlsBusy}
                      title={ds.pauseRun == null
                        ? 'пауза недоступна — оболочка не подключила эндпоинт паузы'
                        : controls.pause.reason ?? 'Приостановить прогон'}
                      onClick={() => actControl('pause')}
                    >
                      Пауза
                    </Button>
                  )}
                  {controls.paused && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!controls.resume.available || ds.resumeRun == null || controlsBusy}
                      title={ds.resumeRun == null
                        ? 'возобновление недоступно — оболочка не подключила эндпоинт резюма'
                        : controls.resume.reason ?? 'Продолжить прогон'}
                      onClick={() => actControl('resume')}
                    >
                      Продолжить
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!controls.checkpoint.available || ds.checkpointRun == null || controlsBusy}
                    title={ds.checkpointRun == null
                      ? 'чекпоинт недоступен — оболочка не подключила эндпоинт чекпоинта'
                      : controls.checkpoint.reason ?? 'Сохранить чекпоинт прогона'}
                    onClick={() => actControl('checkpoint')}
                  >
                    Чекпоинт
                  </Button>
                  {run.status !== 'running' && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!controls.replay.available || controlsBusy}
                        title={controls.replay.reason ?? 'Повторить поток событий с начала'}
                        onClick={() => actControl('replay')}
                      >
                        Повтор
                      </Button>
                      {ds.retryRun != null && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!controls.retry.available || controlsBusy}
                          title={controls.retry.reason ?? 'Запустить заново с теми же параметрами — новый прогон'}
                          onClick={retryRun}
                        >
                          Заново
                        </Button>
                      )}
                    </>
                  )}
                </>
              )}
              {run.status === 'running' && (
                <Button variant="danger" size="sm" disabled={controlsBusy} onClick={cancel}>Отменить</Button>
              )}
            </div>
          )}
        </div>
        {controlError && <p className={styles.error} role="alert">{controlError}</p>}
        {attachFailed ? (
          <ErrorState
            variant="inline"
            title="Не удалось проверить активный прогон."
            onRetry={reloadActive}
            retryLabel="Повторить"
          />
        ) : run == null ? (
          <EmptyState variant="inline" title="Активного прогона нет." />
        ) : (
          <>
            <p className={styles.runTask}>{run.taskText}</p>
            <p className={styles.runSub}>
              {run.runId} · {run.config}
              {run.model ? ` · модель ${run.model}` : ''}
              {run.agent ? ` · агент ${run.agent}` : ''}
              {run.stopReason && run.status !== 'running' ? ` · ${run.stopReason}` : ''}
            </p>
          </>
        )}
      </GlassPanel>
      <EventFeed
        ds={ds}
        runId={run?.runId ?? null}
        active={streamActive}
        epoch={streamEpoch}
        hasRun={run != null}
        onEnd={onStreamEnd}
        onStale={onStreamStale}
      />
    </>
  );
}

/** Approvals queue — pending decisions with honest refetch semantics.
 *  Lives in Settings → Runtime after the process tab became chat-only. */
export function ApprovalsPanel() {
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const [approvals, setApprovals] = useState<ApprovalRequest[] | null>(null);
  const [approvalsFailed, setApprovalsFailed] = useState(false);
  const [responding, setResponding] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const pendingListRef = useRef<HTMLUListElement | null>(null);
  const approvalsTitleRef = useRef<HTMLHeadingElement>(null);

  const reloadApprovals = useCallback(() => {
    if (ds.listApprovals == null) return;
    setApprovalsFailed(false);
    Promise.resolve(ds.listApprovals())
      .then(setApprovals)
      .catch(() => setApprovalsFailed(true));
  }, [ds]);

  useEffect(() => {
    reloadApprovals();
  }, [reloadApprovals]);

  // W3-04: a decided row leaves the pending list and its button unmounts —
  // without a restore, keyboard focus dies to <body>. Land it on the next
  // pending action, or on the panel title when the queue is drained.
  const restoreApprovalFocus = () => {
    const raf: (cb: () => void) => void =
      typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 0);
    raf(() => {
      const next = pendingListRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
      (next ?? approvalsTitleRef.current)?.focus();
    });
  };

  const respond = async (a: ApprovalRequest, decision: ApprovalDecision) => {
    if (ds.respondApproval == null || responding != null) return;
    setResponding(a.approvalId);
    setApprovalError(null);
    let decided = false;
    try {
      const next = await ds.respondApproval(a.approvalId, decision);
      if (next != null) {
        // Backend result defines the row — it moves to the review trail
        // verbatim (status/time from the server, not assumed).
        setApprovals((prev) => (prev ?? []).map((x) => (x.approvalId === next.approvalId ? next : x)));
        decided = true;
      } else if (ds.listApprovals != null) {
        // Server answered "not pending anymore" — refetch the truth instead
        // of keeping a stale row or silently removing it.
        const fresh = await ds.listApprovals();
        setApprovals(fresh);
        decided = true;
      }
    } catch {
      setApprovalError('Решение не отправлено — запрос остаётся в очереди. Повторите.');
    } finally {
      setResponding(null);
      if (decided) restoreApprovalFocus();
    }
  };

  return (
    <GlassPanel
      className={styles.panel}
      style={{ position: 'relative', zIndex: 1 }}
      data-state={
        ds.listApprovals == null
          ? 'unavailable'
          : approvalsFailed
            ? 'error'
            : approvals == null
              ? 'loading'
              : 'ready'
      }
      data-testid="approvals-panel"
    >
      <h3 className={styles.panelTitle} ref={approvalsTitleRef} tabIndex={-1}>Подтверждения</h3>
      {approvalError && <p className={styles.error} role="alert">{approvalError}</p>}
      {ds.listApprovals == null ? (
        <p className={styles.emptyHint}>
          Очередь подтверждений недоступна — адаптер согласований не подключён.
        </p>
      ) : approvalsFailed ? (
        <ErrorState variant="inline" title="Не удалось загрузить очередь подтверждений." onRetry={reloadApprovals} retryLabel="Повторить" />
      ) : approvals == null ? (
        <LoadingState>Загрузка…</LoadingState>
      ) : approvals.length === 0 ? (
        <EmptyState variant="inline" title="Ожидающих подтверждений нет." />
      ) : (
        <>
          <ul className={styles.selectList} ref={pendingListRef}>
            {approvals.filter((a) => a.status === 'pending').map((a) => (
              <li
                key={a.approvalId}
                className={styles.selectRow}
                data-testid={`approval-${a.approvalId}`}
                onKeyDown={(e) => {
                  // Esc unwinds one layer — same convention as game dialogs.
                  if (matchesShortcut(e, 'modal.dismiss')) {
                    e.preventDefault();
                    approvalsTitleRef.current?.focus();
                  }
                }}
              >
                <span className={styles.selectMain}>
                  <span>{a.action}</span>
                  <span className={styles.selectSub}>
                    {a.runId}
                    {a.scope != null ? ` · ${a.scope}` : ''}
                  </span>
                  <span className={styles.selectSub}>{a.detail}</span>
                </span>
                <span className={styles.prefChoices}>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={responding != null}
                    onClick={() => respond(a, 'approve')}
                  >
                    Разрешить
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={responding != null}
                    onClick={() => respond(a, 'deny')}
                  >
                    Отклонить
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          {approvals.filter((a) => a.status === 'pending').length === 0 && (
            <EmptyState variant="inline" title="Ожидающих подтверждений нет." />
          )}
          {approvals.filter((a) => a.status !== 'pending').length > 0 && (
            <>
              <p className={styles.selectSub}>Недавние решения</p>
              <ul className={styles.selectList}>
                {approvals
                  .filter((a) => a.status !== 'pending')
                  .slice(-5)
                  .map((a) => (
                    <li key={a.approvalId} className={styles.selectRow} data-testid={`decision-${a.approvalId}`}>
                      <span className={styles.selectMain}>
                        <span>{a.action}</span>
                        <span className={styles.selectSub}>
                          {a.runId}
                          {a.scope != null ? ` · ${a.scope}` : ''}
                        </span>
                      </span>
                      <span className={styles.eventRole}>{a.status}</span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </>
      )}
    </GlassPanel>
  );
}

/** Daily digest — counts/cost/attention for runs since local midnight.
 *  Unknown cost never collapses to $0 (NQ-053). */
export function DigestCard() {
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const [today, setToday] = useState<RunSummary[] | null>(null);
  const [todayFailed, setTodayFailed] = useState(false);

  const reloadToday = useCallback(() => {
    setTodayFailed(false);
    ds.listRuns({ since: localMidnightS() }).then(setToday).catch(() => setTodayFailed(true));
  }, [ds]);

  useEffect(() => {
    reloadToday();
  }, [reloadToday]);

  const attention = (today ?? []).filter((r) => r.status === 'error' || r.status === 'timeout');
  // Unknown cost must not collapse to $0 (NQ-053): sum only known values
  // and report the unknown count explicitly — "≥$X.XXX · n без данных".
  const knownCost = (today ?? []).reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const unknownCost = (today ?? []).filter((r) => r.costUsd == null).length;
  const todayCostLabel = today == null || today.length === 0
    ? null
    : unknownCost === 0
      ? `$${knownCost.toFixed(3)}`
      : knownCost === 0
        ? `н/д (${unknownCost})`
        : `≥$${knownCost.toFixed(3)} · ${unknownCost} без данных`;

  return (
    <GlassPanel className={styles.panel} data-state={todayFailed ? 'error' : today == null ? 'loading' : today.length ? 'ready' : 'empty'} data-testid="briefing-card">
      <h3 className={styles.panelTitle}>Дайджест дня</h3>
      {todayFailed ? (
        <ErrorState
          variant="inline"
          title="Дайджест не загрузился."
          onRetry={reloadToday}
          retryLabel="Повторить"
        />
      ) : today == null ? (
        <div className={styles.skeletonRows} aria-hidden="true"><span /><span /></div>
      ) : today.length === 0 ? (
        <EmptyState variant="inline" title="Сегодня прогонов нет — запустите первый." />
      ) : (
        <dl className={styles.statGrid}>
          <div><dt>Прогонов</dt><dd>{today.length}</dd></div>
          <div><dt>Расход</dt><dd title={unknownCost > 0 ? 'Часть прогонов не сообщила стоимость' : undefined}>{todayCostLabel}</dd></div>
          <div><dt>Внимание</dt><dd data-tone={attention.length ? 'warn' : 'ok'}>{attention.length}</dd></div>
          <div><dt>Пресеты</dt><dd>{new Set(today.map((r) => r.config)).size}</dd></div>
        </dl>
      )}
    </GlassPanel>
  );
}
