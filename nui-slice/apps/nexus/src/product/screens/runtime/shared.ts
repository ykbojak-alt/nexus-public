/* Runtime screen — общие типы/константы/хелперы вкладок и чата.
 * Выделено из runtime.tsx (split wave-XVI) без смены поведения. */

import type { NexusStatus } from '@nexus/ui';
import type { RunEventView, RunStatus, UnrealSceneStatus } from '@nexus/mock-data';
import type { ChatCompactSuccess, ChatHistoryEntry } from '../../data-source';

export const TABS = ['overview', 'process', 'results', 'agents', 'resources', 'history', 'scene', 'bus', 'scenario'] as const;
export type RuntimeTab = (typeof TABS)[number] | 'team';

export const TEAM_TAB = 'team' as const;

export const TAB_LABELS: Record<RuntimeTab, string> = {
  overview: 'Обзор',
  process: 'Процесс',
  results: 'Результаты',
  agents: 'Агенты',
  resources: 'Ресурсы',
  history: 'История',
  scene: '3D-сцена',
  bus: 'Окна и шина',
  scenario: 'Сценарий',
  team: 'Команда',
};

export function parseTab(raw: string | null, visible: readonly RuntimeTab[], hasRun: boolean): RuntimeTab {
  if (visible.includes(raw as RuntimeTab)) return raw as RuntimeTab;
  // Прямая ссылка на прогон (?run=) без явной вкладки — «Процесс», там
  // живёт трейс и attach; «Обзор» — дефолт только для пустого входа.
  if (hasRun && visible.includes('process')) return 'process';
  // runtime-wave2 A2: дефолт — первая видимая вкладка («Обзор» на полных
  // уровнях, «Процесс» на simple), не хардкод под один уровень.
  // Рабочее окно рантайма — «Процесс» (запуск задач, AGENT-A, трейс);
  // «Обзор» остаётся вкладкой-сводкой, но не входом по умолчанию.
  if (visible.includes('process')) return 'process';
  return visible[0] ?? 'overview';
}

/**
 * 3D-сцена — entry point to the Unreal companion window
 * (unreal-runtime-scene-integration). The scene opens as a SEPARATE window;
 * it never replaces this 2D Runtime, which stays authoritative for state
 * and actions. Status vocabulary comes from the host only — `connected` is
 * shown solely after a host handshake report, and `source: 'mock'` always
 * carries a DEMO badge.
 */
export const SCENE_STATUS_BADGE: Record<UnrealSceneStatus, { status: NexusStatus; label: string }> = {
  'not-installed': { status: 'offline', label: 'НЕ УСТАНОВЛЕНА' },
  starting: { status: 'syncing', label: 'ЗАПУСК' },
  connected: { status: 'online', label: 'LIVE' },
  stale: { status: 'paused', label: 'STALE' },
  disconnected: { status: 'offline', label: 'ОТКЛЮЧЕНА' },
  error: { status: 'error', label: 'ОШИБКА' },
  unknown: { status: 'waiting', label: 'НЕИЗВЕСТНО' },
};

export function sceneUpdatedLabel(ts: number | null): string {
  if (ts == null) return 'нет данных';
  return new Date(ts * 1000).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Measured snapshot age in seconds; null when the host never reported. */
export function sceneAgeSeconds(ts: number | null, nowMs: number): number | null {
  return ts == null ? null : Math.max(0, Math.floor((nowMs - ts * 1000) / 1000));
}

export function sceneAgeLabel(age: number | null): string {
  if (age == null) return 'возраст данных неизвестен';
  if (age < 5) return 'обновлено только что';
  if (age < 60) return `обновлено ${age} с назад`;
  return `обновлено ${Math.floor(age / 60)} мин назад`;
}

/** Host-vocabulary freshness: `stale`/`live`/`syncing` come from the host's
 *  own status — the UI never assigns a freshness threshold locally. */
export const SCENE_FRESHNESS: Partial<Record<UnrealSceneStatus, string>> = {
  connected: 'live',
  starting: 'syncing',
  stale: 'stale',
};

/** runtime-wave2 B5: чип состояния UE-сцены в шапке Runtime. Статус —
 *  verbatim от моста nexus-scene (ds.unrealScene.getState); источник
 *  `mock` → DEMO, seam отсутствует/ошибка → UNKNOWN, никаких «здоровых»
 *  значений без хоста. subscribe у seam опционален — иначе опрос 30 с. */

/** One chat entry. Assistant entries carry `runId` — their live state is
 *  resolved against the currently tracked run + the per-run trace/answer
 *  maps, so an old bubble never mutates after its run ends. */
export type ChatMsg = {
  id: string;
  role: 'user' | 'assistant';
  text?: string;
  runId?: string;
  status: RunStatus;
  ts: number;
  /** W3-143: compact-нода из host history (effective=1) — строка ленты
   *  рендерится ChatCompactBlock, не пузырём. */
  kind?: 'compact';
  compact?: ChatCompactSuccess;
};

/** Host message-id строки ленты — курсор history-пагинации и дедуп.
 *  `u-<run>`→`<run>:task`, `a-<run>`→`<run>:answer`, compact → compact_id. */
export function chatHistoryRef(m: ChatMsg): string | null {
  if (m.kind === 'compact') return m.compact?.compactId ?? null;
  if (m.id.startsWith('u-')) return `${m.id.slice(2)}:task`;
  if (m.runId != null) return `${m.runId}:answer`;
  return null;
}

/** Run id, открывающий тред сообщения — для session_id history-запроса. */
export function chatHistoryRunId(m: ChatMsg): string | null {
  if (m.kind === 'compact') return m.compact?.threadId ?? null;
  if (m.id.startsWith('u-')) return m.id.slice(2);
  return m.runId ?? null;
}

/** Строка ленты из записи страницы GET /v1/chat/history. Текст задачи
 *  разворачивается из chat-обёртки — хост хранит то, что реально ушло. */
export function historyEntryToChatMsg(e: ChatHistoryEntry, threadId: string): ChatMsg {
  if (e.kind === 'compact') {
    const parsed = e.createdAt != null ? Date.parse(e.createdAt) : NaN;
    return {
      id: `c-${e.id}`,
      kind: 'compact',
      role: 'assistant',
      status: 'done',
      ts: Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0,
      compact: {
        compacted: true,
        compactId: e.id,
        threadId,
        summary: e.summary,
        coversMessageIds: e.coversMessageIds,
        keptMessageIds: [],
        createdAt: e.createdAt ?? '',
      },
    };
  }
  const ts = e.createdAt ?? 0;
  if (e.part === 'task') {
    return {
      id: `u-${e.runId}`,
      role: 'user',
      text: e.text == null ? undefined : stripChatTaskWrapper(e.text),
      status: 'done',
      ts,
    };
  }
  return {
    id: `a-${e.runId}`,
    role: 'assistant',
    runId: e.runId,
    text: e.text ?? undefined,
    status: 'done',
    ts,
  };
}

/** How many finished pairs the history restore re-seeds (wave-8 W3-2). */
export const CHAT_RESTORE_LIMIT = 10;

/** Chat persistence: route navigation unmounts ProcessTab (tab switches
 *  keep panels mounted) — mirror the transcript to sessionStorage so
 *  returning restores it verbatim.
 *  sessionStorage scope = app session: cleared when the window closes,
 *  never written to disk profile. Bounded: last N messages, trace tails
 *  only for runs still present in the transcript. */
export const CHAT_SESSION_KEY = 'nexus.runtime.chat.v1';
export const CHAT_SESSION_MSG_LIMIT = 120;
export const CHAT_SESSION_TRACE_LIMIT = 50;

/** The model never sees the window: every run is a standalone task and
 *  POST /v1/runs has exactly one text channel. The recent transcript is
 *  folded into the task under a stable delimiter — restored user bubbles
 *  strip the wrapper back to the user's own words, so history display
 *  stays verbatim while the model gets real context. */
export const CHAT_TASK_DELIM = '\n\nТекущее сообщение: ';
export const CHAT_CONTEXT_MSGS = 400;
export const CHAT_CONTEXT_CHARS = 50_000;
/** Хост принимает task до 1 000 000 символов (ai2 MAX_TASK_CHARS, раньше
 *  20 000 — длинный чат давал 422). Контекст набирается по общему бюджету. */
export const TASK_MAX_CHARS = 1_000_000;
/** Сжатие: когда контекст перерастает порог, старые реплики (кроме
 *  последних CHAT_KEEP_FULL) сворачиваются до головы и хвоста. */
export const CHAT_COMPRESS_TRIGGER = 600_000;
export const CHAT_KEEP_FULL = 20;
export const CHAT_COMPRESSED_CHARS = 400;

export function compressChatLine(line: string): string {
  if (line.length <= CHAT_COMPRESSED_CHARS) return line;
  const headLen = Math.floor(CHAT_COMPRESSED_CHARS * 0.7);
  const tailLen = CHAT_COMPRESSED_CHARS - headLen;
  return `${line.slice(0, headLen)} […сжато: ${line.length - CHAT_COMPRESSED_CHARS} симв.…] ${line.slice(-tailLen)}`;
}

export function buildChatTask(chat: ChatMsg[], answers: Record<string, string | null>, text: string): string {
  const msgText = (m: ChatMsg): string =>
    (m.text ?? (m.runId != null ? answers[m.runId] : null) ?? '').trim().slice(0, CHAT_CONTEXT_CHARS);
  const recent = chat.filter((m) => msgText(m)).slice(-CHAT_CONTEXT_MSGS);
  if (recent.length === 0) return text;
  let lines = recent.map(
    (m) => `${m.role === 'user' ? 'Пользователь' : 'AGENT-A'}: ${msgText(m)}`,
  );
  if (lines.reduce((n, l) => n + l.length + 1, 0) > CHAT_COMPRESS_TRIGGER) {
    const cut = Math.max(0, lines.length - CHAT_KEEP_FULL);
    lines = lines.map((l, i) => (i < cut ? compressChatLine(l) : l));
  }
  const head = 'Контекст диалога:\n';
  const tail = `${CHAT_TASK_DELIM}${text}`;
  let budget = TASK_MAX_CHARS - head.length - tail.length;
  if (budget <= 0) return text;
  // новые реплики важнее: набираем с конца, пока помещается в бюджет
  const kept: string[] = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const cost = lines[i]!.length + 1;
    if (cost > budget) break;
    kept.unshift(lines[i]!);
    budget -= cost;
  }
  if (kept.length === 0) return text;
  return `${head}${kept.join('\n')}${tail}`;
}

export function stripChatTaskWrapper(taskText: string | null | undefined): string {
  const t = taskText ?? '';
  const i = t.lastIndexOf(CHAT_TASK_DELIM);
  return i === -1 ? t : t.slice(i + CHAT_TASK_DELIM.length);
}

export type ChatSnapshot = {
  chat: ChatMsg[];
  traces: Record<string, RunEventView[]>;
  answers: Record<string, string | null>;
};

export function readChatSnapshot(): ChatSnapshot {
  try {
    const raw = globalThis.sessionStorage?.getItem(CHAT_SESSION_KEY);
    if (!raw) return { chat: [], traces: {}, answers: {} };
    const p = JSON.parse(raw) as Partial<ChatSnapshot>;
    return {
      chat: Array.isArray(p.chat) ? (p.chat as ChatMsg[]) : [],
      traces: p.traces != null && typeof p.traces === 'object' ? p.traces : {},
      answers: p.answers != null && typeof p.answers === 'object' ? p.answers : {},
    };
  } catch {
    return { chat: [], traces: {}, answers: {} };
  }
}

export function writeChatSnapshot(s: ChatSnapshot): void {
  try {
    const chat = s.chat.slice(-CHAT_SESSION_MSG_LIMIT);
    const ids = new Set(chat.map((m) => m.runId).filter((x): x is string => x != null));
    const traces: Record<string, RunEventView[]> = {};
    const answers: Record<string, string | null> = {};
    for (const id of ids) {
      const t = s.traces[id];
      if (t != null) traces[id] = t.slice(-CHAT_SESSION_TRACE_LIMIT);
      if (s.answers[id] !== undefined) answers[id] = s.answers[id];
    }
    globalThis.sessionStorage?.setItem(CHAT_SESSION_KEY, JSON.stringify({ chat, traces, answers }));
  } catch {
    /* storage denied/full — the chat still works in memory */
  }
}
