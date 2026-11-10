'use client';

/**
 * Wave XIV W3 — богатая лента AGENT-A (эталон NUE1.png): поверх
 * трейса прогона — индикатор токенов/стоимости (UsageMeter), дифф-ревью
 * изменённых файлов (DiffReviewCard), упоминания #path (FileMention) и
 * маркеры чекпоинтов (CheckpointMarker).
 *
 * Для sdk-прогонов (runId 'sdk-*') учёт и манифесты чекпоинтов идут
 * через seam'ы ds.sdkRunUsage / ds.sdkCheckpoints (W1, sdk-usage-
 * checkpoints-contract.md). Откат — только заявкой: POST rewind открывает
 * карточку подтверждения tool='rewind', решение принимается в существующей
 * ленте подтверждений; факт восстановления приходит событием
 * checkpoint_rewound в трейсе. Локального/оптимистичного отката нет.
 * Без seam'ов — честные «нет данных»/«недоступно», строки не выдумываются.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  CheckpointMarker, CompactIndicator, DiffReviewCard, FileMention, StatusBadge, UsageMeter,
  type CheckpointState, type DiffReviewFile,
} from '@nexus/ui';
import type { RunEventView } from '@nexus/mock-data';
import type { ChatCompactSuccess, ProductDataSource } from '../data-source';
import type { ChatMsg } from './runtime/shared';
import type { SdkCheckpoint, SdkRunUsage } from '../../integrations/ai2/contracts/sdk';
import { diffOf, fmtEventTime, fsOpsOf, runUsageOf, toolTargetOf } from './runtime-ops';
import { ChatCompactionMotion, revealChatMessageAnchor } from './chat-compaction-motion';
import { runWhileDocumentVisible } from '../visible-interval';
import styles from './screens.module.css';
import compactStyles from './chat-compaction.module.css';

const NO_PATH = 'путь не сообщён';
export const CHAT_COMPACTION_THRESHOLD_MESSAGES = 32;

export function isChatCompactionThresholdReached(messageCount: number): boolean {
  return messageCount >= CHAT_COMPACTION_THRESHOLD_MESSAGES;
}

/** W1-143 accepts explicit run_ids; a single terminal root still prefers the
 *  thread path so the host walks the parent/retry closure itself. */
export function compactThreadForChat(
  runIds: readonly string[],
  activeRun: { runId: string; parent: string | null; status: string } | null,
): string | null {
  const unique = [...new Set(runIds)];
  if (
    unique.length !== 1
    || activeRun == null
    || activeRun.parent !== null
    || activeRun.status === 'running'
    || activeRun.runId !== unique[0]
  ) return null;
  return activeRun.runId;
}

/** A successful host response can be shown without inventing or discarding refs. */
export function ChatCompactBlock({
  compact,
  chatMessages,
  coveredText,
  loadCoveredText,
  manual = false,
  busy = false,
}: {
  compact: ChatCompactSuccess;
  /** Current transcript used to resolve covered refs to anchors and rows. */
  chatMessages?: readonly ChatMsg[];
  /** Ref → verbatim text already loaded in the client (chat + answers).
   *  Rows without text fall back to the run link — never fabricated. */
  coveredText?: Readonly<Record<string, string | null>>;
  /** Optional seam for refs missing from the client; called once per
   *  expansion, never re-requested for refs already covered by `coveredText`. */
  loadCoveredText?: (refs: readonly string[]) => Promise<Record<string, string | null>>;
  /** Provenance is only certain for a compact this session triggered
   *  manually — the wire record carries no trigger field, so history-loaded
   *  compacts honestly show no badge. */
  manual?: boolean;
  /** Host-reported in-flight compaction — the block stays non-interactive. */
  busy?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedByUser, setExpandedByUser] = useState(false);
  const [lazyText, setLazyText] = useState<Record<string, string | null>>({});
  const [lazyError, setLazyError] = useState(false);
  const requestedRef = useRef(false);
  useEffect(() => {
    setCollapsed(true);
    setExpandedByUser(false);
    setLazyText({});
    setLazyError(false);
    requestedRef.current = false;
  }, [compact.compactId]);
  const handleCollapsedChange = (next: boolean) => {
    setCollapsed(next);
    if (!next) setExpandedByUser(true);
  };
  useEffect(() => {
    // Лениво = по expand пользователя; первый кадр рендерится expanded
    // до эффекта сворачивания — этот транзиент не повод для запроса.
    if (!expandedByUser || loadCoveredText == null || requestedRef.current) return;
    const missing = compact.coversMessageIds.filter(
      (ref) => (coveredText?.[ref] ?? lazyText[ref]) == null,
    );
    if (missing.length === 0) return;
    requestedRef.current = true;
    loadCoveredText(missing).then(
      (map) => setLazyText(map),
      () => setLazyError(true),
    );
  }, [expandedByUser, compact.coversMessageIds, coveredText, lazyText, loadCoveredText]);
  const summary = typeof compact.summary === 'string' ? compact.summary.trim() : '';
  const renderedCompact = summary.length > 0
    ? compact
    : {
      ...compact,
      summary: `Сводка недоступна, ${compact.coversMessageIds.length} сообщений скрыто.`,
    };
  const refs = compact.coversMessageIds.map((ref) => {
    const separator = ref.lastIndexOf(':');
    const runId = separator < 0 ? ref : ref.slice(0, separator);
    const kind = separator < 0 ? null : ref.slice(separator + 1);
    const message = chatMessages?.find((item) => kind === 'task'
      ? item.role === 'user' && item.id === `u-${runId}`
      : kind === 'answer'
        ? item.role === 'assistant' && item.runId === runId
        : false);
    const heading = kind === 'task' ? 'Задача' : kind === 'answer' ? 'Ответ' : 'Прогон';
    // Пустая строка — это «текста нет»: иначе рендерится пустой span
    // (compact-блок должен показывать покрытый текст только когда он есть).
    const rawText = coveredText?.[ref] ?? lazyText[ref] ?? null;
    const text = rawText != null && rawText.trim() !== '' ? rawText : null;
    const link = message == null
      ? <Link href={`/run?id=${encodeURIComponent(runId)}`}>{ref}</Link>
      : (
        <Link
          href={`/run?id=${encodeURIComponent(runId)}`}
          onClick={(e) => {
            if (revealChatMessageAnchor(message.id)) e.preventDefault();
          }}
        >
          {heading} · {fmtEventTime(message.ts)}
        </Link>
      );
    return {
      id: ref,
      content: text == null
        ? link
        : (
          <span className={compactStyles.coveredRow}>
            <span className={compactStyles.coveredText}>{text}</span>
            {link}
          </span>
        ),
    };
  });
  return (
    <div className={compactStyles.compactBlock} data-testid="chat-compact-block">
      <ChatCompactionMotion
        compact={renderedCompact}
        coveredMessages={refs}
        collapsed={collapsed}
        onCollapsedChange={handleCollapsedChange}
        busy={busy}
        provenanceBadge={manual
          ? (
            <StatusBadge
              status="info"
              label="ВРУЧНУЮ"
              title="Сжатие запущено вручную в этой сессии"
              data-testid="compact-provenance"
            />
          )
          : undefined}
      />
      {lazyError && (
        <p className={compactStyles.coveredError} role="status">
          Текст части сообщений не загружен — ссылки на прогоны доступны.
        </p>
      )}
    </div>
  );
}

/** Threshold is measured from actual user/assistant entries in this feed. */
export function ChatCompactionUnavailable({
  messageCount,
  compactChat,
  status,
  compact,
  chatMessages,
  coveredText,
  loadCoveredText,
  threadId,
  compactableRunIds,
  onCompact,
}: {
  messageCount: number;
  compactChat: ProductDataSource['chatCompact'];
  /** Host-reported state plus a bounded status-check timeout. */
  status?:
  | { state: 'checking' }
  | { state: 'triggered' }
  | { state: 'completed'; reason?: string }
  | { state: 'failed'; statusCode: number | null; reason?: string }
  | { state: 'noop'; reason: string; covered?: number; kept?: number };
  /** A persisted host result is rendered as the interactive feed block. */
  compact?: ChatCompactSuccess | null;
  chatMessages?: readonly ChatMsg[];
  /** W3-156: covered-текст из клиента и ленивый seam — пробрасываются
   *  в ChatCompactBlock без изменений. */
  coveredText?: Readonly<Record<string, string | null>>;
  loadCoveredText?: (refs: readonly string[]) => Promise<Record<string, string | null>>;
  /** A proven root run ID — compacted as the host thread closure. */
  threadId?: string | null;
  /** All run IDs present in the feed — W1-143 lets the host compact an
   *  explicit set and derive the deterministic thread itself. */
  compactableRunIds?: readonly string[];
  onCompact?: () => void;
}) {
  const [checkingVisible, setCheckingVisible] = useState(false);
  useEffect(() => {
    if (status?.state !== 'checking') {
      setCheckingVisible(false);
      return;
    }
    setCheckingVisible(false);
    const timer = window.setTimeout(() => setCheckingVisible(true), 1_000);
    return () => window.clearTimeout(timer);
  }, [status?.state]);

  const retryEnabled = compactChat != null
    && onCompact != null
    && (threadId != null || (compactableRunIds?.length ?? 0) > 0);
  const statusLine = status?.state === 'failed' ? (
    <>
      <StatusBadge status="error" label="Сжатие не удалось" data-testid="chat-compaction-failed" />
      <p role="alert">
        {status.statusCode == null ? '' : `HTTP ${status.statusCode} · `}
        {status.reason ?? 'Неизвестная ошибка компактизации.'}
      </p>
      {retryEnabled && (
        <button type="button" data-testid="chat-compaction-retry" onClick={onCompact}>
          Повторить сжатие
        </button>
      )}
    </>
  ) : status?.state === 'completed' ? (
    <>
      <StatusBadge status="complete" label="Сжатие завершено" />
      {status.reason != null && <p role="status">{status.reason}</p>}
    </>
  ) : status?.state === 'noop' ? (
    <p role="status">
      {`Хост: ${status.reason}`}
      {status.covered != null || status.kept != null
        ? ` — покрыто ранее ${status.covered ?? 0}, в хвосте ${status.kept ?? 0}.`
        : '.'}
    </p>
  ) : null;
  if (status?.state === 'checking' && !checkingVisible && compact == null) return null;
  if (compact != null) {
    return (
      <>
        <ChatCompactBlock
          compact={compact}
          chatMessages={chatMessages}
          coveredText={coveredText}
          loadCoveredText={loadCoveredText}
          manual
          busy={status?.state === 'triggered'}
        />
        {statusLine != null && (
          <section className={compactStyles.unavailable} data-testid="chat-compaction" data-state={status!.state}>
            {statusLine}
          </section>
        )}
      </>
    );
  }
  if (
    !isChatCompactionThresholdReached(messageCount)
    && status?.state !== 'checking'
    && status?.state !== 'triggered'
    && status?.state !== 'completed'
    && status?.state !== 'failed'
    && status?.state !== 'noop'
  ) return null;
  if (status?.state === 'checking') {
    return (
      <section className={compactStyles.unavailable} data-testid="chat-compaction" data-state="checking" aria-busy="true">
        <h3>Проверка сжатия истории</h3>
        <p role="status"><CompactIndicator state="active" pattern="dots" /> Проверяю состояние сжатия…</p>
      </section>
    );
  }
  if (status?.state === 'triggered') {
    return (
      <section className={compactStyles.unavailable} data-testid="chat-compaction" data-state="compacting" aria-busy="true">
        <h3>Сжатие истории</h3>
        <p role="status"><CompactIndicator state="active" pattern="dots" /> Сжимаю историю…</p>
      </section>
    );
  }
  if (status?.state === 'failed') {
    return (
      <section className={compactStyles.unavailable} data-testid="chat-compaction" data-state="failed">
        <h3>Сжатие истории</h3>
        {statusLine}
      </section>
    );
  }
  if (status?.state === 'completed') {
    return (
      <section className={compactStyles.unavailable} data-testid="chat-compaction" data-state="completed">
        <h3>Сжатие истории</h3>
        {statusLine}
      </section>
    );
  }
  if (status?.state === 'noop') {
    return (
      <section className={compactStyles.unavailable} data-testid="chat-compaction" data-state="noop">
        <h3>Сжатие истории</h3>
        {statusLine}
      </section>
    );
  }
  const reason = compactChat == null
    ? 'POST /v1/chat/compact недоступен для этого data-source.'
    : threadId == null && (compactableRunIds?.length ?? 0) === 0
      ? 'В ленте нет прогонов — сжимать нечего.'
      : onCompact == null
        ? 'Действие компактизации недоступно.'
        : null;
  const canCompact = isChatCompactionThresholdReached(messageCount)
    && compactChat != null
    && onCompact != null
    && (threadId != null || (compactableRunIds?.length ?? 0) > 0);
  return (
    <section className={compactStyles.unavailable} data-testid="chat-compaction"
      data-state={canCompact ? 'ready' : 'unavailable'}>
      <h3>Сжатие истории</h3>
      <button
        type="button"
        disabled={!canCompact}
        title={reason ?? 'Сжать историю на хосте — вердикт возвращается verbatim'}
        aria-describedby={reason == null ? undefined : 'chat-compaction-reason'}
        onClick={onCompact}
      >
        Сжать историю
      </button>
      {reason != null && <p id="chat-compaction-reason" role="status">{reason}</p>}
    </section>
  );
}

function localChatTime(ts: number): string {
  const date = new Date(ts * 1000);
  return [date.getHours(), date.getMinutes()].map((part) => String(part).padStart(2, '0')).join(':');
}

export function locallyCompactedMessageIds(
  messages: readonly ChatMsg[],
  applied: boolean,
): Set<string> {
  return applied
    ? new Set(messages.slice(0, Math.max(0, messages.length - CHAT_COMPACTION_THRESHOLD_MESSAGES))
      .map((message) => message.id))
    : new Set();
}

const LOCAL_PREVIEW_CHARS = 80;

/** A presentation-only fallback. It never summarizes or mutates the transcript. */
export function LocalChatCompactionBlock({
  messages,
  enabled,
  applied,
  expanded,
  busy = false,
  previewOf,
  onApply,
  onToggleExpanded,
}: {
  messages: readonly ChatMsg[];
  enabled: boolean;
  applied: boolean;
  expanded: boolean;
  /** Host-reported in-flight compaction — apply stays disabled. */
  busy?: boolean;
  /** Real text for the expand preview; nothing is fabricated when absent. */
  previewOf?: (message: ChatMsg) => string | null;
  onApply: () => void;
  onToggleExpanded: () => void;
}) {
  const rowsToggleRef = useRef<HTMLButtonElement>(null);
  const oldMessages = messages.slice(0, Math.max(0, messages.length - CHAT_COMPACTION_THRESHOLD_MESSAGES));
  if (!enabled || messages.length <= CHAT_COMPACTION_THRESHOLD_MESSAGES) return null;
  const first = oldMessages[0];
  const last = oldMessages[oldMessages.length - 1];
  const timeRange = first != null && last != null
    ? `${localChatTime(first.ts)}–${localChatTime(last.ts)}`
    : '';

  return (
    <section
      className={compactStyles.localFallback}
      data-state={applied ? (expanded ? 'expanded' : 'collapsed') : 'offer'}
      data-testid="local-chat-compaction"
      aria-busy={busy || undefined}
    >
      {!applied ? (
        <>
          <h3>Локальный компакт</h3>
          <button
            type="button"
            className={compactStyles.localToggle}
            disabled={busy || oldMessages.length === 0}
            onClick={onApply}
          >
            Свернуть старые прогоны в компакт-блок
          </button>
          {busy
            ? <p className={compactStyles.localNote} role="status">Сжимаю историю…</p>
            : (
              <p className={compactStyles.localNote}>
                {oldMessages.length === 0
                  ? `Доступно после ${CHAT_COMPACTION_THRESHOLD_MESSAGES} сообщений сверх хвоста.`
                  : `${oldMessages.length} сообщений будут скрыты только визуально; локально, без суммаризации.`}
              </p>
            )}
        </>
      ) : (
        <>
          <button
            ref={rowsToggleRef}
            type="button"
            className={compactStyles.localToggle}
            aria-expanded={expanded}
            onClick={onToggleExpanded}
          >
            {expanded
              ? 'Скрыть старые прогоны'
              : `${oldMessages.length} сообщений свёрнуто · ${timeRange} · локально, без суммаризации`}
          </button>
          {expanded && (
            <ol
              className={compactStyles.localRows}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  onToggleExpanded();
                  rowsToggleRef.current?.focus();
                }
              }}
            >
              {oldMessages.map((message) => {
                const runId = message.role === 'assistant'
                  ? message.runId
                  : message.id.startsWith('u-') ? message.id.slice(2) : null;
                const label = message.role === 'user' ? 'Задача' : 'Ответ';
                const preview = previewOf?.(message) ?? message.text ?? null;
                const snippet = preview == null || preview === ''
                  ? null
                  : preview.length > LOCAL_PREVIEW_CHARS
                    ? `${preview.slice(0, LOCAL_PREVIEW_CHARS)}…`
                    : preview;
                const title = `${label}${runId == null ? '' : ` · ${runId}`} · ${localChatTime(message.ts)}`;
                const body = (
                  <>
                    {title}
                    {snippet != null && (
                      <span className={compactStyles.localPreview}> — «{snippet}»</span>
                    )}
                  </>
                );
                return (
                  <li key={message.id}>
                    {runId == null
                      ? <span>{body}</span>
                      : (
                        <Link
                          href={`/run?id=${encodeURIComponent(runId)}`}
                          onClick={(e) => {
                            if (revealChatMessageAnchor(message.id)) e.preventDefault();
                          }}
                        >
                          {body}
                        </Link>
                      )}
                  </li>
                );
              })}
            </ol>
          )}
          <p className={compactStyles.localNote}>Локально, без суммаризации. Исходные сообщения сохранены.</p>
        </>
      )}
    </section>
  );
}

/** Сводка изменённых файлов по трейсу прогона: unified-диффы → счётчики
 *  +/− (строки реального диффа хоста, заголовки +++/--- не считаются);
 *  write-операции без диффа → строка без счётчиков (не выдумываем). */
export function feedDiffFiles(trace: RunEventView[]): DiffReviewFile[] {
  const byPath = new Map<string, DiffReviewFile>();
  for (const ev of trace) {
    if (ev.type !== 'tool_call') continue;
    const d = diffOf(ev.body);
    const target = toolTargetOf(ev.body);
    if (d != null) {
      const path = target ?? NO_PATH;
      const prev = byPath.get(path) ?? { path };
      let add = 0;
      let del = 0;
      for (const line of d.diff.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++')) add += 1;
        else if (line.startsWith('-') && !line.startsWith('---')) del += 1;
      }
      prev.additions = (prev.additions ?? 0) + add;
      prev.deletions = (prev.deletions ?? 0) + del;
      byPath.set(path, prev);
    } else if (target != null && fsOpsOf([ev]).some((o) => o.verb === 'пишет' || o.verb === 'патчит' || o.verb === 'откатывает')) {
      // Изменяющий вызов без диффа — файл изменён, счётчиков хост не дал.
      if (!byPath.has(target)) byPath.set(target, { path: target });
    }
  }
  return [...byPath.values()];
}

/** Упоминания файлов в ленте — только изменённые (write/apply_patch/
 *  restore_file): читаемые пути держит боковой fs-лог (контракт аудита —
 *  в пузыре чата пути чтения не показываются). Пути verbatim от хоста.
 *  DiffReviewCard уже перечисляет изменённые — ряд чипов используем в
 *  сообщении пользователя по #упоминаниям из его текста. */
export function feedMentionPaths(trace: RunEventView[], cap = 8): string[] {
  const seen = new Set<string>();
  for (const op of fsOpsOf(trace)) {
    if (op.verb !== 'пишет' && op.verb !== 'патчит' && op.verb !== 'откатывает') continue;
    if (op.target === '—' || seen.has(op.target)) continue;
    seen.add(op.target);
    if (seen.size >= cap) break;
  }
  return [...seen];
}

/** #path-упоминания из текста пользователя — токены verbatim,
 *  без проверки существования (хост решает, что с ними делать). */
export function mentionTokensOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/#([^\s#]+)/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
    if (out.length >= 8) break;
  }
  return out;
}

/** checkpoint_rewound-события трейса → checkpointId → state хоста
 *  ('done'|'denied'|… verbatim). */
export function rewoundStatesOf(trace: RunEventView[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const ev of trace) {
    if (ev.type !== 'checkpoint_rewound') continue;
    const b = ev.body as { checkpointId?: unknown; state?: unknown } | null;
    if (typeof b?.checkpointId === 'string') {
      m.set(b.checkpointId, typeof b.state === 'string' ? b.state : 'done');
    }
  }
  return m;
}

interface SdkSlice<T> {
  state: 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable';
  value: T | null;
  error: string | null;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Учёт + чекпоинты + дифф-ревью для одного сообщения-прогона. Монтируется
 *  внутрь пузыря ассистента после трейса. Для sdk-прогона дотягивает
 *  usage/манифесты по seam'ам W1; для обычного — считает из трейса. */
export function RunFeedExtras({
  runId,
  trace,
  live,
  ds,
}: {
  runId: string | null | undefined;
  trace: RunEventView[];
  /** Прогон ещё идёт — usage опрашивается периодически (15 с). */
  live: boolean;
  ds: ProductDataSource;
}) {
  const isSdk = typeof runId === 'string' && runId.startsWith('sdk-');

  const [usage, setUsage] = useState<SdkSlice<SdkRunUsage>>({ state: 'idle', value: null, error: null });
  const [cps, setCps] = useState<SdkSlice<SdkCheckpoint[]>>({ state: 'idle', value: null, error: null });
  const [rewinding, setRewinding] = useState<string | null>(null);
  const [rewindError, setRewindError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSdk || runId == null) return;
    let alive = true;
    const load = async () => {
      if (ds.sdkRunUsage != null) {
        try {
          const u = await ds.sdkRunUsage(runId);
          if (alive) setUsage({ state: 'ready', value: u, error: null });
        } catch (e) {
          if (alive) setUsage({ state: 'failed', value: null, error: errText(e) });
        }
      } else if (alive) setUsage({ state: 'unavailable', value: null, error: null });
      if (ds.sdkCheckpoints != null) {
        try {
          const r = await ds.sdkCheckpoints.list(runId);
          if (alive) setCps({ state: 'ready', value: r, error: null });
        } catch (e) {
          if (alive) setCps({ state: 'failed', value: null, error: errText(e) });
        }
      } else if (alive) setCps({ state: 'unavailable', value: null, error: null });
    };
    void load();
    const stopPolling = live ? runWhileDocumentVisible(() => void load(), 15000) : undefined;
    return () => { alive = false; stopPolling?.(); };
  }, [ds, runId, isSdk, live]);

  // Учёт: sdk-прогон → seam W1; обычный → фактическое потребление из
  // трейса (final.usage либо накопление). null остаётся null.
  const meter = useMemo(() => {
    if (isSdk) {
      const u = usage.value;
      const parts = [u?.inputTokens, u?.outputTokens, u?.cacheReadTokens, u?.cacheCreationTokens];
      const anyTok = parts.some((v) => v != null);
      return {
        tokens: anyTok ? parts.reduce<number>((n, v) => n + (v ?? 0), 0) : null,
        costUsd: u?.totalCostUsd ?? null,
        contextUsed: u?.contextFill != null ? Math.round(u.contextFill * 100) : null,
        contextTotal: u?.contextFill != null ? 100 : null,
      };
    }
    const u = runUsageOf(trace);
    return {
      tokens: u?.tokens ?? null,
      costUsd: u?.costUsd ?? null,
      contextUsed: null,
      contextTotal: null,
    };
  }, [isSdk, usage.value, trace]);

  const diffFiles = useMemo(() => feedDiffFiles(trace), [trace]);
  const rewound = useMemo(() => rewoundStatesOf(trace), [trace]);
  // Чекпоинты критика /v1/runs — верификация ответа, не снапшот файлов:
  // отката у них нет, маркер честно 'unavailable'.
  const criticCps = useMemo(
    () => trace.filter((ev) => ev.type === 'checkpoint').map((ev) => {
      const b = ev.body as { name?: unknown; passed?: unknown } | null;
      return {
        seq: ev.seq,
        name: typeof b?.name === 'string' && b.name !== '' ? b.name : null,
        passed: b?.passed === true ? true : b?.passed === false ? false : null,
      };
    }),
    [trace],
  );

  const rewind = async (cpId: string) => {
    if (runId == null || ds.sdkCheckpoints == null || rewinding != null) return;
    setRewinding(cpId);
    setRewindError(null);
    try {
      // Заявка: 202 + карточка tool='rewind' — решение принимается в ленте
      // подтверждений (GET-опрос уже идёт). Откат выполнит хост после allow.
      await ds.sdkCheckpoints.rewind(runId, cpId);
    } catch (e) {
      setRewindError(errText(e));
      setRewinding(null);
    }
  };

  // Блок есть у каждого пузыря-прогона: метр честно «нет данных» при
  // отсутствии полей, карточки появляются только на реальных данных.
  if (runId == null) return null;

  return (
    <div className={styles.feedExtras} data-testid="run-feed-extras">
      <UsageMeter
        tokens={meter.tokens}
        costUsd={meter.costUsd}
        contextUsed={meter.contextUsed}
        contextTotal={meter.contextTotal}
      />
      {isSdk && usage.state === 'failed' && (
        <p className={styles.feedNote} role="status">Учёт SDK недоступен: {usage.error}</p>
      )}
      {diffFiles.length > 0 && <DiffReviewCard files={diffFiles} />}
      {(cps.state === 'ready' && (cps.value?.length ?? 0) > 0) && (
        <div className={styles.checkpointList} aria-label="Чекпоинты прогона">
          {cps.value!.map((cp) => {
            const host = rewound.get(cp.id);
            const state: CheckpointState = host === 'done' ? 'restored'
              : rewinding === cp.id ? 'restoring' : 'ready';
            const marked = cp.files.filter((f) => f.excluded != null || f.skipped != null);
            return (
              <div key={cp.id}>
                <CheckpointMarker
                  checkpointId={cp.id}
                  label={cp.tool != null ? `снапшот перед ${cp.tool}` : 'снапшот файлов'}
                  at={cp.createdAt != null ? fmtEventTime(Date.parse(cp.createdAt) / 1000 || 0) || cp.createdAt : undefined}
                  state={state}
                  onRewind={state === 'ready' ? () => void rewind(cp.id) : undefined}
                  rewindLabel="Откатить"
                />
                <span className={styles.feedNote}>
                  файлов в снапшоте: {cp.files.length}
                  {host != null && host !== 'done' ? ` · откат: ${host}` : ''}
                  {marked.length > 0 && ` · не вошло: ${marked.length} (секреты/вне корня/oversized)`}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {isSdk && (cps.state === 'unavailable' || cps.state === 'failed') && (
        <p className={styles.feedNote} role="status">
          {cps.state === 'unavailable' ? 'Чекпоинты недоступны — seam хоста не подключён.' : `Чекпоинты недоступны: ${cps.error}`}
        </p>
      )}
      {rewinding != null && (
        <p className={styles.feedNote} role="status">
          Заявка на откат {rewinding} открыта — решение в карточке подтверждения.
        </p>
      )}
      {rewindError != null && (
        <p className={styles.feedNote} role="alert">Откат не запрошен: {rewindError}</p>
      )}
      {criticCps.map((c) => (
        <CheckpointMarker
          key={`critic-${c.seq}`}
          checkpointId={`шаг ${c.seq}`}
          label={c.name != null ? `проверка «${c.name}»${c.passed != null ? (c.passed ? ' — пройдена' : ' — провалена') : ''}` : 'проверка результата'}
          state="unavailable"
        />
      ))}
    </div>
  );
}
