'use client';

/** Вкладка «Процесс» — лента диалога (пузыри, трейс, план, подтверждения,
 * экшены ответа). Выделено из runtime.tsx без смены поведения/testid. */
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { memo, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ApprovalRequest, Button, Chip, EmptyState, ErrorState, FileMention, GlassPanel, StatusBadge, TypingIndicator } from '@nexus/ui';
import type { RunEventView } from '@nexus/mock-data';
import { isAi2ApiError } from '../../../integrations/ai2/api/errors';
import { useApiToast } from '../../api-toast';
import type { SdkConfirmDecision } from '../../../integrations/ai2/contracts/sdk';
import { PluginInstallConfirmation, isPluginInstallConfirmation } from '../../plugins/plugin-install-confirmation';
import { useCollapsePhase } from '../../use-collapse-phase';
import type { PluginInstallNotice } from '../../plugins/plugin-install-notifications';
import {
  ChatCompactBlock,
  ChatCompactionUnavailable,
  LocalChatCompactionBlock,
  RunFeedExtras,
  compactThreadForChat,
  locallyCompactedMessageIds,
  mentionTokensOf,
} from '../agent-chat-feed';
import {
  captureChatScrollAnchor,
  isChatPinnedToBottom,
  restoreChatScrollAnchor,
} from './chat-scroll-anchor';
import type { ChatCompactSuccess } from '../../data-source';
import { EVENT_LABELS, STATUS_BADGE, childRunOf, confirmationDeferredOf, contourBlocks, diffOf, emitStepOf, eventTool, fmtEventTime, fmtPlayTime, fsRequestOf, fsResolutionOf, fsVerbOf, humanizeDraft, mergeConfirmationView, modelTextOf, modelViewOf, planDagOf, planGraphOf, provenanceOf, restoreOpOf, runLimitsOf, runUsageOf, summarize, toolConfirmationOf, toolConfirmationResolutionOf, waitAgentOf } from '../runtime-ops';
import type { FsRequestView, ToolConfirmationView } from '../runtime-ops';
import { ToolConfirmCard } from '../tool-confirm-card';
import type { ChatMsg } from './shared';
import type { ProcessTabCtx } from './use-process-tab';
import styles from '../screens.module.css';

/** Канвас плана — отдельный режим вкладки; по умолчанию открыт список,
 *  поэтому DAG-рендерер грузим только при переключении на «канвас». */
const PlanDag = dynamic(
  () => import('@nexus/patterns').then((mod) => mod.PlanDag),
  { ssr: false },
);

function DraggableBubble({
  id,
  side,
  children,
  testId,
  freshness,
  kind,
  summary,
  selected,
  onSelectClick,
}: {
  id: string;
  side: 'left' | 'right';
  children: ReactNode;
  testId?: string;
  freshness?: string;
  kind?: string;
  /** Короткий текст свёрнутой полосы плавающего пузыря. */
  summary?: string;
  /** W3-160: мультивыделение — только на li в ленте; плавающая
   *  статья выделения не несёт (её клики — оконные). */
  selected?: boolean;
  onSelectClick?: (e: ReactMouseEvent<HTMLElement>) => void;
}) {
  const nodeRef = useRef<HTMLElement | null>(null);
  const gripRef = useRef<HTMLButtonElement | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const collapsePhase = useCollapsePhase(collapsed);
  const wasFloatingRef = useRef(false);
  // W4-1018: один активный pointer на сессию; хранит pointerId захваченного.
  const dragSessionRef = useRef<number | null>(null);
  // NQ-110-класс: фокус на грип синхронно в layout-эффекте — DOM нового
  // состояния (портал-article или li в ленте) уже смонтирован к commit;
  // rAF-версия лендилась кадр спустя и замеры читали activeElement=body.
  const isoLayout = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
  isoLayout(() => {
    const wasFloating = wasFloatingRef.current;
    wasFloatingRef.current = position != null;
    if (!wasFloating && position == null) return;
    gripRef.current?.focus();
  }, [position]);

  const beginMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    // Второй pointerdown во время активного drag игнорируется — иначе два
    // набора window-listener'ов писали бы позицию наперегонки.
    if (dragSessionRef.current != null) return;
    const node = nodeRef.current;
    const shell = node?.closest<HTMLElement>('[data-app-shell]');
    const overlay = shell?.querySelector<HTMLElement>('[data-floating-overlay]');
    if (node == null || shell == null || overlay == null) return;
    e.preventDefault();
    e.stopPropagation();
    // jsdom MouseEvent не несёт pointerId — нормализуем в 0 (тесты).
    const activePointer = e.pointerId ?? 0;
    dragSessionRef.current = activePointer;
    const samePointer = (ev: { pointerId?: number }) =>
      ev.pointerId == null || ev.pointerId === activePointer;
    e.currentTarget.setPointerCapture?.(activePointer);
    const rect = node.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const origin = { x: rect.left, y: rect.top };
    const pointer = { x: e.clientX, y: e.clientY };
    const originalCss = node.style.cssText;
    const originalOverlayOverflow = overlay.style.overflow;
    const overflows: Array<[HTMLElement, string]> = [];
    let parent = node.parentElement;
    while (parent != null && parent !== shell) {
      overflows.push([parent, parent.style.overflow]);
      parent.style.overflow = 'visible';
      parent = parent.parentElement;
    }
    overlay.style.overflow = 'visible';
    let moved = false;
    let raf = 0;
    let next = origin;
    const width = Math.min(rect.width, Math.max(160, shellRect.width - 24));
    const clamp = () => {
      next.x = Math.max(shellRect.left, Math.min(shellRect.right - width, next.x));
      next.y = Math.max(shellRect.top, Math.min(shellRect.bottom - rect.height, next.y));
    };
    const paint = () => {
      raf = 0;
      node.style.left = `${next.x}px`;
      node.style.top = `${next.y}px`;
    };
    const cleanup = () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      dragSessionRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onBlur);
      gripRef.current?.removeEventListener('lostpointercapture', onLostCapture);
      document.body.removeAttribute('data-message-drag');
      node.removeAttribute('data-drag-lift');
      overlay.style.overflow = originalOverlayOverflow;
      for (const [el, overflow] of overflows) el.style.overflow = overflow;
      if (node.isConnected) node.style.cssText = originalCss;
    };
    const onMove = (ev: PointerEvent) => {
      // Чужой pointer в середине drag не двигает окно.
      if (!samePointer(ev)) return;
      next = { x: origin.x + ev.clientX - pointer.x, y: origin.y + ev.clientY - pointer.y };
      clamp();
      if (!moved && Math.hypot(ev.clientX - pointer.x, ev.clientY - pointer.y) < 4) return;
      if (!moved) {
        moved = true;
        node.style.position = 'fixed';
        node.style.left = `${origin.x}px`;
        node.style.top = `${origin.y}px`;
        node.style.width = `${width}px`;
        // Поднимаем над другими floating-поверхностями (базовый z 120) —
        // иначе drag поверх floating уходит под соседа; cleanup вернёт.
        node.style.zIndex = '130';
        // dragLift: scale+shadow affordance на время удержания.
        node.setAttribute('data-drag-lift', '');
      }
      if (raf === 0) raf = requestAnimationFrame(paint);
    };
    // Честный drop: commit последней известной точки (ev=null → текущая
    // `next`). Общий путь для pointerup, pointercancel, lostpointercapture
    // и window blur — потерянное управление фиксирует позицию, не телепортирует.
    const finish = (ev: { clientX: number; clientY: number } | null) => {
      if (dragSessionRef.current == null) return;
      if (moved) {
        if (ev != null) next = { x: origin.x + ev.clientX - pointer.x, y: origin.y + ev.clientY - pointer.y };
        clamp();
        if (raf !== 0) cancelAnimationFrame(raf);
        raf = 0;
        paint();
      }
      cleanup();
      if (moved) {
        // Re-drag уже-плавающего пузыря: держим точку сброса инлайном до
        // коммита setPosition — иначе кадр мелькнёт на старой позиции.
        if (position != null && node.isConnected) {
          node.style.left = `${next.x}px`;
          node.style.top = `${next.y}px`;
        }
        setPosition({
          x: Math.round(next.x - shellRect.left),
          y: Math.round(next.y - shellRect.top),
          width: Math.round(width),
          height: Math.round(rect.height),
        });
      }
    };
    const onUp = (ev: PointerEvent) => { if (samePointer(ev)) finish(ev); };
    const onCancel = (ev: PointerEvent) => { if (samePointer(ev)) finish(ev); };
    // Потеря pointer-capture и blur окна — фиксируем текущую позицию
    // (выбор W4-1018: commit, не возврат в исходную — без телепорта).
    const onLostCapture = () => finish(null);
    const onBlur = () => finish(null);
    document.body.setAttribute('data-message-drag', '');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onBlur);
    gripRef.current?.addEventListener('lostpointercapture', onLostCapture);
  };
  const moveByKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-16, 0],
      ArrowRight: [16, 0],
      ArrowUp: [0, -16],
      ArrowDown: [0, 16],
    };
    const step = steps[e.key];
    if (step == null) return;
    const node = nodeRef.current;
    const shell = node?.closest<HTMLElement>('[data-app-shell]');
    if (node == null || shell == null) return;
    e.preventDefault();
    const shellRect = shell.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    const current = position ?? {
      x: rect.left - shellRect.left,
      y: rect.top - shellRect.top,
      width: rect.width,
      height: rect.height,
    };
    setPosition({
      ...current,
      x: Math.max(0, Math.min(shellRect.width - current.width, current.x + step[0])),
      y: Math.max(0, Math.min(shellRect.height - current.height, current.y + step[1])),
    });
  };

  const bubbleContent = (
    <>
      <button
        ref={gripRef}
        type="button"
        className={styles.bubbleDragGrip}
        aria-label="Перетащить сообщение; стрелки перемещают на 16 px"
        title="Зажмите и перетащите; стрелки перемещают на 16 px"
        onPointerDown={beginMove}
        onKeyDown={moveByKey}
      >
        <span aria-hidden="true">⠿</span>
      </button>
      {position != null && (
        <button
          type="button"
          className={styles.bubbleCollapse}
          aria-label={collapsed ? 'Развернуть сообщение' : 'Свернуть сообщение в полосу'}
          title={collapsed ? 'Развернуть' : 'Свернуть в полосу'}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? '▢' : '–'}
        </button>
      )}
      {position != null && (
        <button
          type="button"
          className={styles.bubbleReturn}
          aria-label="Закрыть окно — вернуть сообщение в ленту"
          title="Закрыть — сообщение вернётся в ленту"
          onClick={() => { setCollapsed(false); setPosition(null); }}
        >
          ×
        </button>
      )}
      {(!collapsed || collapsePhase === 'collapsing') && (
        <div
          className={styles.collapseItem}
          inert={collapsePhase === 'collapsing'}
          aria-hidden={collapsePhase === 'collapsing' || undefined}
          data-collapse-anim={
            collapsePhase === 'collapsing' ? 'shrink' : collapsePhase === 'expanding' ? 'grow' : undefined
          }
        >
          <div className={styles.collapseInner}>{children}</div>
        </div>
      )}
      {((collapsed && position != null) || collapsePhase === 'expanding') && (
        <div
          className={styles.collapseItem}
          data-collapse-anim={
            collapsePhase === 'collapsing' ? 'grow' : collapsePhase === 'expanding' ? 'shrink' : undefined
          }
        >
          <div className={styles.collapseInner}>
            <div className={styles.bubbleStub} data-side={side}>
              <span className={styles.bubbleStubSide} aria-hidden="true">{side === 'right' ? '▸' : '◂'}</span>
              <span className={styles.bubbleStubLabel}>{side === 'right' ? 'вы' : 'AGENT-A'}</span>
              <span className={styles.bubbleStubText}>{summary ?? 'Сообщение'}</span>
              {freshness != null && <span className={styles.bubbleStubMeta}>{freshness}</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );

  const overlay = typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('[data-floating-overlay]');
  const style = position == null
    ? undefined
    : { left: position.x, top: position.y, width: position.width } satisfies CSSProperties;

  if (position != null && overlay != null) {
    return (
      <>
        <li
          className={styles.bubblePlaceholder}
          data-chat-message-id={id}
          aria-hidden="true"
          style={{ height: position.height }}
        />
        {createPortal(
          <article
            ref={(el) => { nodeRef.current = el; }}
            className={`${styles.chatMsg} ${styles.floatingMessage}`}
            data-side={side}
            data-floating-message={id}
            data-collapsed={collapsed || undefined}
            data-testid={testId}
            data-freshness={freshness}
            data-kind={kind}
            aria-label={`Отсоединённое сообщение ${id}`}
            style={style}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              e.stopPropagation();
              setCollapsed(false);
              setPosition(null);
            }}
          >
            {bubbleContent}
          </article>,
          overlay,
          id,
        )}
      </>
    );
  }

  return (
    <li
      ref={(el) => { nodeRef.current = el; }}
      className={styles.chatMsg}
      data-chat-message-id={id}
      data-side={side}
      data-freshness={freshness}
      data-kind={kind}
      data-testid={testId}
      data-selected={selected || undefined}
      onClick={onSelectClick}
    >
      {bubbleContent}
    </li>
  );
}

/** W3-151 · hover/focus-контролы сообщения — левый верхний угол пузыря.
 *  copy — реальный clipboard (execCommand-fallback внутри copyAnswer);
 *  retry — только свои сообщения, через send-seam; hide — честное
 *  локальное скрытие: delete-seam у хоста нет, лейбл говорит об этом. */
function MessageActions({
  copyText, copied, onCopy, onRetry, onHide, selected, onSelectToggle,
}: {
  copyText: string | null;
  copied: boolean;
  onCopy: () => void;
  onRetry?: (() => void) | undefined;
  onHide: () => void;
  /** W3-160: чек-режим — Shift+клик на этом контроле тоже строит диапазон. */
  selected?: boolean;
  onSelectToggle?: ((e: ReactMouseEvent<HTMLButtonElement>) => void) | undefined;
}) {
  return (
    <span className={styles.msgActions} data-testid="msg-actions">
      {onSelectToggle != null && (
        <button
          type="button"
          className={styles.msgAction}
          aria-label={selected ? 'Снять выбор сообщения' : 'Выбрать сообщение'}
          aria-pressed={selected === true}
          title="Выбрать (Shift — диапазон, Ctrl — точечно)"
          onClick={onSelectToggle}
        >
          {selected ? '☑' : '☐'}
        </button>
      )}
      {copyText != null && copyText !== '' && (
        <button
          type="button"
          className={styles.msgAction}
          aria-label="Скопировать текст сообщения"
          title="Скопировать"
          onClick={onCopy}
        >
          {copied ? '✓' : '⧉'}
        </button>
      )}
      {onRetry != null && (
        <button
          type="button"
          className={styles.msgAction}
          aria-label="Повторить запрос"
          title="Повторить запрос"
          onClick={onRetry}
        >
          ↻
        </button>
      )}
      <button
        type="button"
        className={styles.msgAction}
        aria-label="Скрыть сообщение локально"
        title="Скрыть в ленте — на хосте не удаляется"
        onClick={onHide}
      >
        ✕
      </button>
    </span>
  );
}

/** Строки трейса одного прогона. На каждое SSE-событие весь список чата
 *  ре-рендеривался, а завершённые трейсы неизменны по ссылке — memo
 *  пропускает их DOM-реконсиляцию полностью (десятки span на событие). */
const TraceLines = memo(function TraceLines({ trace }: { trace: RunEventView[] }) {
  return (
    <>
      {trace.map((ev) => {
        const child = childRunOf(ev.body);
        const waited = waitAgentOf(ev.body);
        const restored = restoreOpOf(ev.body);
        const diff = diffOf(ev.body);
        const emitStep = ev.type === 'emit_step' ? emitStepOf(ev.body) : null;
        const isErr = (ev.body as { is_error?: unknown } | null)?.is_error === true;
        return (
          <span key={ev.seq} className={styles.traceLine} data-err={isErr || undefined} title={summarize(ev.body)}>
            <span className={styles.traceTime}>{fmtEventTime(ev.ts)}</span>
            {ev.role ?? 'ядро'} · {EVENT_LABELS[ev.type] ?? ev.type}
            {fsVerbOf(eventTool(ev.body)) != null
              ? ` · ${fsVerbOf(eventTool(ev.body))}`
              : eventTool(ev.body) != null ? ` · ${eventTool(ev.body)}` : ''}
            {child != null && (
              <Link
                className={styles.traceChildLink}
                title={`Дочерний прогон ${child.runId}`}
                href={`/run?id=${child.runId}`}
              >
                ↗ {child.handle}
              </Link>
            )}
            {waited != null && (
              <span className={styles.traceModelText}>
                ответ {waited.handle}: {waited.answer !== '' ? waited.answer : '—'}
                {waited.metrics !== '' && ` · ${waited.metrics}`}
              </span>
            )}
            {restored != null && (
              <span className={styles.traceRestore} title="Файл восстановлен из снапшота записи (write-safety)">
                ↩ восстановлено · {restored.path}
              </span>
            )}
            {diff != null && (
              <span className={styles.traceModelText} title={diff.diff}>
                ⋯ diff{diff.before != null && diff.after != null ? ` · ${diff.before} Б → ${diff.after} Б` : ''}
              </span>
            )}
            {emitStep != null && (
              <span className={styles.traceModelText}>
                {emitStep.id != null ? `${emitStep.id} · ` : ''}{emitStep.text}
                {emitStep.dependsOn.length > 0 && ` (после ${emitStep.dependsOn.join(', ')})`}
              </span>
            )}
            {modelTextOf(ev.body) != null && (
              <span className={styles.traceModelText}>{humanizeDraft(modelTextOf(ev.body)!)}</span>
            )}
          </span>
        );
      })}
    </>
  );
});

export function ProcessChatFeed({ c }: { c: ProcessTabCtx }) {
  const apiToast = useApiToast();
  const {
    attachFailed, attachMissing, chat, run, stale, traces, answers, drafts, dsKind, router, reloadActive,
    chatListRef, pendingApprovals, sdkConfs, deferredMarks, decideToolConf, sdkSeamDown,
    pluginInstallNotices, fsDecisions, fsActionErr, decideFs, copiedId, copyAnswer,
    retryChatMessage, hideChatMessage,
    downloadReport, speaking, togglePlay, seekAudio, stopAudio, cancel, ds,
    plan, planView, setPlanView,
    chatCompactionStatus,
    historyLoading, historyDone, historyError, loadOlderHistory,
    setTask,
  } = c;
  const useExample = (text: string) => {
    setTask(text);
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Текст задачи"]')?.focus();
  };

  // W3-165: канонический текст каждого пузыря (verbatim, без шума
  // контролов) — id → текст; заполняется в render-цикле ниже.
  const copyTextById = new Map<string, string>();
  // Выделение, пересекающее ≥2 сообщений → структурированный plain-text
  // («Вы: …\n\nAGENT-A: …», compact-карточка — verbatim). Внутри
  // одного сообщения — дефолтный чистый текст, мы не вмешиваемся.
  const onFeedCopy = (e: ReactClipboardEvent<HTMLOListElement>) => {
    const sel = window.getSelection();
    if (sel == null || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const ol = e.currentTarget;
    const parts: string[] = [];
    // chatMsg — CSS-module-хэш, по классу не найти: якоримся на атрибутах
    // (data-chat-message-id у пузырей, data-kind=compact у compact-листа).
    for (const li of Array.from(ol.querySelectorAll<HTMLElement>('li[data-chat-message-id], li[data-kind=\"compact\"]'))) {
      if (!range.intersectsNode(li)) continue;
      const id = li.getAttribute('data-chat-message-id');
      const side = li.getAttribute('data-side');
      const canonical = id != null ? copyTextById.get(id) : undefined;
      const text = (canonical ?? li.textContent ?? '').trim();
      if (text === '') continue;
      // compact-карточка самоописательна («N сообщений сжато…») — без роли.
      parts.push(side === 'right' ? `Вы: ${text}` : side === 'left' ? `AGENT-A: ${text}` : text);
    }
    if (parts.length < 2) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', parts.join('\n\n'));
  };
  const [compactResult, setCompactResult] = useState<ChatCompactSuccess | null>(null);
  const [compactNoop, setCompactNoop] = useState<
    { reason: string; covered: number; kept: number } | null
  >(null);
  const [compactHostThread, setCompactHostThread] = useState<string | null>(null);
  const [localCompactApplied, setLocalCompactApplied] = useState(false);
  const [localCompactExpanded, setLocalCompactExpanded] = useState(false);
  const [compactionPending, setCompactionPending] = useState(false);
  const [compactionError, setCompactionError] = useState<
    { state: 'failed'; statusCode: number | null; reason?: string } | undefined
  >();
  const [checkingTimedOut, setCheckingTimedOut] = useState(false);
  useEffect(() => {
    if (chatCompactionStatus?.compaction !== 'checking') { setCheckingTimedOut(false); return; }
    const started = Date.now();
    const t = window.setInterval(() => {
      if (Date.now() - started > 10_000) setCheckingTimedOut(true);
    }, 1_000);
    return () => window.clearInterval(t);
  }, [chatCompactionStatus?.compaction]);
  // NQ-117: resize handling — when card images load and reflow height, re-restore
  // the scroll anchor so the visible row stays in view. Top-level hook (moved out
  // of the budgetBars.map callback, which violated the Rules of Hooks).
  useEffect(() => {
    if (!chatListRef.current) return;
    const element = chatListRef.current;
    // jsdom lacks ResizeObserver — guard like durak/screen.tsx (W9 u1 ~75 fails)
    if (typeof ResizeObserver !== 'function') return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { height } = entry.contentRect;
        const anchor = captureChatScrollAnchor(element, isChatPinnedToBottom(element));
        if (anchor.height !== entry.contentRect.height) {
          restoreChatScrollAnchor(element, anchor);
        }
      }
    });
    resizeObserver.observe(element);
    return () => resizeObserver.unobserve(element);
  }, [chatListRef, chat]);
  const runIds = [...new Set(chat
    .filter((message) => message.role === 'assistant' && message.runId != null)
    .map((message) => message.runId!))];
  const compactThreadId = compactThreadForChat(runIds, run);
  const hideAndFocus = (id: string) => {
    hideChatMessage(id);
    // Фокус не в body — на скроллящуюся ленту (tabindex=0, NQ-098).
    chatListRef.current?.focus();
  };
  const compactStatus = compactionPending
    ? { state: 'triggered' as const }
    : checkingTimedOut
      ? { state: 'failed' as const, statusCode: null, reason: 'Проверка статуса сжатия не завершилась за 10 с.' }
    : compactionError
    ?? (compactNoop != null
      ? { state: 'noop' as const, ...compactNoop }
      : chatCompactionStatus?.compaction === 'triggered'
        ? { state: 'triggered' as const }
        : chatCompactionStatus?.compaction === 'checking'
          ? { state: 'checking' as const }
          : chatCompactionStatus?.compaction === 'completed'
          ? {
            state: 'completed' as const,
            reason: `completed${chatCompactionStatus.compactId != null ? ` · ${chatCompactionStatus.compactId}` : ''}`,
          }
          : chatCompactionStatus?.compaction != null
            && ['failed', 'skipped', 'unavailable'].includes(chatCompactionStatus.compaction)
            ? {
              state: 'failed' as const,
              statusCode: null,
              reason: chatCompactionStatus.reason ?? `Состояние хоста: ${chatCompactionStatus.compaction}`,
            }
            : undefined);

  // W3-133: live POST /v1/chat/compact. Independent Runtime turns go as an
  // explicit run_ids set (W1-143 derives a deterministic thread); a single
  // terminal root prefers the thread path so the host walks its closure.
  // The host-returned threadId is reused on repeat clicks so new runs extend
  // the same persisted thread instead of forking a derived one.
  const compactHistory = async () => {
    if (ds.chatCompact == null || compactionPending) return;
    const input = compactHostThread != null
      ? { runIds, thread: compactHostThread }
      : compactThreadId != null
        ? { thread: compactThreadId }
        : runIds.length > 0
          ? { runIds }
          : null;
    if (input == null) return;
    setCompactionPending(true);
    setCompactionError(undefined);
    try {
      const result = await ds.chatCompact(input);
      setCompactHostThread(result.threadId);
      if (result.compacted) {
        setCompactResult(result);
        setCompactNoop(null);
      } else {
        setCompactNoop({
          reason: result.reason,
          covered: result.coversMessageIds.length,
          kept: result.keptMessageIds.length,
        });
      }
    } catch (error) {
      setCompactionError({
        state: 'failed',
        statusCode: isAi2ApiError(error) ? error.status : null,
        reason: error instanceof Error ? error.message : 'Не удалось сжать историю.',
      });
      apiToast?.notifyApiError(error, 'Не удалось сжать историю', {
        retry: () => void compactHistory(),
      });
    } finally {
      setCompactionPending(false);
    }
  };

  const coveredRefs = new Set(compactResult?.coversMessageIds ?? []);
  // W3-143: compact-ноды из history-страниц (effective=1) тоже скрывают
  // покрытые ими сообщения — иначе они дублируются рядом со сводкой.
  for (const m of chat) {
    if (m.kind === 'compact') {
      for (const ref of m.compact?.coversMessageIds ?? []) coveredRefs.add(ref);
    }
  }
  const visibleChat = compactResult == null && coveredRefs.size === 0 ? chat : chat.filter((message) => {
    if (message.kind === 'compact') return true;
    if (message.role === 'user' && message.id.startsWith('u-')) {
      return !coveredRefs.has(`${message.id.slice(2)}:task`);
    }
    if (message.role === 'assistant' && message.runId != null) {
      return !coveredRefs.has(`${message.runId}:answer`);
    }
    return true;
  });
  const locallyCollapsedIds = compactResult == null
    ? locallyCompactedMessageIds(chat, localCompactApplied)
    : new Set<string>();
  const renderedChat = visibleChat.filter((message) => !locallyCollapsedIds.has(message.id));
  // W3-160: мультивыделение — anchor ref для Shift-диапазона; выбор
  // привязан к реально видимым id (hide/prune режутся маппингом ниже).
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const selectAnchorRef = useRef<string | null>(null);
  const selectableIds = renderedChat.filter((m) => m.kind !== 'compact').map((m) => m.id);
  const effectiveSelected = selectableIds.filter((id) => selectedIds.has(id));
  const toggleSelect = (id: string, range: boolean) => {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      const anchor = selectAnchorRef.current;
      const ai = anchor != null ? selectableIds.indexOf(anchor) : -1;
      const bi = selectableIds.indexOf(id);
      if (range && ai >= 0 && bi >= 0) {
        for (const rid of selectableIds.slice(Math.min(ai, bi), Math.max(ai, bi) + 1)) next.add(rid);
        return next;
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      selectAnchorRef.current = id;
      return next;
    });
  };
  const clearSelection = () => {
    setSelectedIds(new Set());
    selectAnchorRef.current = null;
  };
  const onMsgSelectClick = (e: ReactMouseEvent<HTMLElement>, m: ChatMsg) => {
    // Модификатор обязателен — обычный клик/text-select не трогаем;
    // клики по контролам внутри пузыря выделением не считаются.
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) return;
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return;
    e.preventDefault();
    toggleSelect(m.id, e.shiftKey);
  };
  const selectedMessages = renderedChat.filter((m) => m.kind !== 'compact' && selectedIds.has(m.id));
  const selectedText = () => selectedMessages.map((m) => m.role === 'user'
    ? `Вы: ${m.text ?? ''}`.trimEnd()
    : `AGENT-A: ${m.runId != null ? answers[m.runId] ?? 'ответ не записан' : 'ответ не записан'}`
  ).join('\n\n');
  const copySelected = () => {
    const text = selectedText();
    if (text === '') return;
    void copyAnswer('bulk', text);
  };
  const exportSelectedMd = () => {
    if (selectedMessages.length === 0) return;
    const parts = selectedMessages.map((m) => {
      const role = m.role === 'user' ? 'Вы' : 'AGENT-A';
      const text = m.role === 'user'
        ? m.text ?? ''
        : (m.runId != null ? answers[m.runId] ?? 'ответ не записан' : 'ответ не записан');
      return `## ${role} · ${fmtEventTime(m.ts)}\n\n${text}`;
    });
    const md = `# Фрагмент диалога\n\nВыбрано сообщений: ${selectedMessages.length}\n\n${parts.join('\n\n')}`;
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chat-fragment.md';
    a.click();
    URL.revokeObjectURL(url);
  };
  const hideSelected = () => {
    for (const id of effectiveSelected) hideChatMessage(id);
    clearSelection();
    // Фокус — на ленту, как у одиночного hide (W3-151).
    chatListRef.current?.focus();
  };
  // W3-156: covered-текст из уже загруженных данных (chat + answers) —
  // показ без дубль-запроса; чего нет в клиенте, рендерится ссылкой на
  // прогон, а не выдуманным текстом.
  const coveredText: Record<string, string | null> = {};
  for (const m of chat) {
    if (m.role === 'user' && m.id.startsWith('u-') && m.text != null) {
      coveredText[`${m.id.slice(2)}:task`] = m.text;
    } else if (m.role === 'assistant' && m.runId != null && answers[m.runId] != null) {
      coveredText[`${m.runId}:answer`] = answers[m.runId];
    }
  }
  // Ленивая догрузка по expand через реальный run-detail seam; absent seam
  // → без запросов и без скрытых обещаний.
  const loadCoveredText = (() => {
    const getDetail = ds.getRunDetail;
    if (getDetail == null) return undefined;
    return async (refs: readonly string[]) => {
      const runIds = [...new Set(refs.map((ref) => {
        const separator = ref.lastIndexOf(':');
        return separator < 0 ? ref : ref.slice(0, separator);
      }))];
      const details = new Map(
        await Promise.all(runIds.map(async (id) => [id, await getDetail(id)] as const)),
      );
      const out: Record<string, string | null> = {};
      for (const ref of refs) {
        const separator = ref.lastIndexOf(':');
        const runId = separator < 0 ? ref : ref.slice(0, separator);
        const kind = separator < 0 ? null : ref.slice(separator + 1);
        const detail = details.get(runId);
        out[ref] = detail == null
          ? null
          : kind === 'task'
            ? detail.run.taskText ?? null
            : kind === 'answer'
              ? detail.result?.answer ?? null
              : null;
      }
      return out;
    };
  })();
  return (
    <GlassPanel
      className={`${styles.panel} ${styles.chatPanel}`}
      data-state={attachFailed ? 'error' : chat.length ? 'ready' : 'empty'}
      data-testid="runtime-chat"
    >
      {/* NQ-076(a): role="log" lives on a wrapper div — the same role on
            <ol> strips the implicit list semantics and orphans every <li>
            (axe listitem). Empty/error states are siblings, not list items —
            putting them inside the <ol> would trip only-listitems. */}
      <div role="log" aria-label="Диалог с AGENT-A" className={styles.chatLog}>
        <ChatCompactionUnavailable
          messageCount={chat.length}
          compactChat={ds.chatCompact}
          chatMessages={chat}
          threadId={compactThreadId}
          compactableRunIds={runIds}
          onCompact={() => void compactHistory()}
          status={compactStatus}
          compact={compactResult}
          coveredText={coveredText}
          loadCoveredText={loadCoveredText}
        />
        {/* W3-131 fallback уступает живому seam: когда хост умеет
            /v1/chat/compact, визуальное сворачивание без суммаризации
            не предлагается — реальный блок заменяет его. */}
        <LocalChatCompactionBlock
          messages={chat}
          enabled={compactResult == null && ds.chatCompact == null}
          applied={localCompactApplied}
          expanded={localCompactExpanded}
          busy={chatCompactionStatus?.compaction === 'triggered'}
          previewOf={(message) => message.text
            ?? (message.runId != null ? answers[message.runId] ?? null : null)}
          onApply={() => {
            setLocalCompactApplied(true);
            setLocalCompactExpanded(false);
          }}
          onToggleExpanded={() => setLocalCompactExpanded((expanded) => !expanded)}
        />
        {attachMissing != null ? (
          /* W3-163: ?run=<id> — seam верифицировал отсутствие (getRunDetail
             вернул null: live 404 → null в адаптере). Честная 404-панель
             + путь к списку прогонов — не вечный спиннер. */
          <EmptyState
            variant="panel"
            icon="status.question"
            title={`Прогон ${attachMissing} не найден`}
            body="хост не отдал такой прогон — ссылка устарела или id опечатан."
            action={(
              <Link href="/runs" className={styles.onboardHint}>
                К списку прогонов
              </Link>
            )}
          />
        ) : attachFailed ? (
          <ErrorState
            variant="inline"
            title="Не удалось проверить активный прогон."
            onRetry={reloadActive}
            retryLabel="Повторить"
          />
        ) : chat.length === 0 ? (
          /* W3-162: честный онбординг — только реальные возможности:
             свободная задача, шаблон делегирования (тот же, что в
             композиторе), память (memory_search — реальный tool_call).
             Чипсы вставляют текст в композитор через setTask. */
          <EmptyState
            variant="panel"
            icon="agent.alice"
            title="Диалог пуст — опишите задачу"
            body="Текст в поле ниже или кнопка «Голос»; файлы прикрепляются скрепкой — имена уйдут в задачу как #упоминания."
            action={(
              <div className={styles.onboardHints} role="group" aria-label="Примеры запросов">
                {[
                  'Расскажи, что ты умеешь',
                  'Найди в памяти заметки про мои прошлые задачи',
                  'Разбей задачу на подзадачи; каждую поручи субагенту через spawn_agent; собери ответы через wait_agent и сведи итог.',
                ].map((text) => (
                  <button
                    key={text}
                    type="button"
                    className={styles.onboardHint}
                    aria-label={`Вставить пример: ${text}`}
                    onClick={() => useExample(text)}
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
          />
        ) : (
          <>
          {effectiveSelected.length > 0 && (
            <div
              className={styles.bulkBar}
              role="toolbar"
              aria-label="Действия с выбранными сообщениями"
              data-testid="bulk-bar"
            >
              <span className={styles.bulkCount}>{effectiveSelected.length} выбрано</span>
              <button type="button" className={styles.bulkBtn} onClick={copySelected}>
                {copiedId === 'bulk' ? 'Скопировано' : 'Копировать всё'}
              </button>
              <button type="button" className={styles.bulkBtn} onClick={exportSelectedMd}>
                Экспорт .md
              </button>
              {/* Удаления на хосте нет (как у одиночного hide, W3-151) —
                  честная локальная формулировка. */}
              <button type="button" className={styles.bulkBtn} onClick={hideSelected}>
                Скрыть локально
              </button>
              <button type="button" className={styles.bulkBtn} onClick={clearSelection}>
                Снять выбор
              </button>
            </div>
          )}
          <ol
            className={styles.chatList}
            ref={chatListRef}
            tabIndex={0}
            onCopy={onFeedCopy}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && effectiveSelected.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                clearSelection();
              }
            }}
          >
            {/* W3-143: догрузка истории сверху — индикаторы в голове списка,
                compact-строки якорятся тем же data-chat-compact-anchor. */}
            {historyError != null && (
              <li className={styles.chatHistoryNote} role="alert" data-testid="chat-history-error">
                {historyError}{' '}
                <button type="button" className={styles.chatHistoryRetry} onClick={() => void loadOlderHistory()}>
                  Повторить
                </button>
              </li>
            )}
            {historyLoading && (
              <li className={styles.chatHistoryNote} role="status" data-testid="chat-history-loading">
                История загружается…
              </li>
            )}
            {historyDone && !historyLoading && (
              <li className={styles.chatHistoryNote} data-testid="chat-history-start">
                Начало треда
              </li>
            )}
            {renderedChat.map((m) => {
              if (m.kind === 'compact' && m.compact != null) {
                return (
                  <li key={m.id} className={styles.chatMsg} data-side="left" data-kind="compact">
                    <ChatCompactBlock
                      compact={m.compact}
                      chatMessages={chat}
                      coveredText={coveredText}
                      loadCoveredText={loadCoveredText}
                    />
                  </li>
                );
              }
              if (m.role === 'user') {
                copyTextById.set(m.id, m.text ?? '');
                const msgMentions = mentionTokensOf(m.text ?? '');
                return (
                  <DraggableBubble
                    key={m.id}
                    id={m.id}
                    side="right"
                    testId="chat-user"
                    summary={m.text ?? undefined}
                    selected={selectedIds.has(m.id)}
                    onSelectClick={(e) => onMsgSelectClick(e, m)}
                  >
                    <p className={styles.chatText}>{m.text}</p>
                    {msgMentions.length > 0 && (
                      <span className={styles.mentionRow} aria-label="Упомянутые файлы">
                        {msgMentions.map((p) => <FileMention key={p} path={p} />)}
                      </span>
                    )}
                    <span className={styles.chatMeta}>{fmtEventTime(m.ts)} · вы</span>
                    <MessageActions
                      copyText={m.text ?? null}
                      copied={copiedId === m.id}
                      onCopy={() => void copyAnswer(m.id, m.text ?? '')}
                      onRetry={m.text != null ? () => retryChatMessage(m.text ?? '') : undefined}
                      onHide={() => hideAndFocus(m.id)}
                      selected={selectedIds.has(m.id)}
                      onSelectToggle={(e) => toggleSelect(m.id, e.shiftKey)}
                    />
                  </DraggableBubble>
                );
              }
              const isCurrent = m.runId != null && m.runId === run?.runId;
              const live = isCurrent && run?.status === 'running';
              const trace = m.runId != null ? traces[m.runId] ?? [] : [];
              const answer = m.runId != null ? answers[m.runId] : undefined;
              const draft = m.runId != null ? drafts[m.runId]?.text : undefined;
              copyTextById.set(m.id, answer ?? draft ?? '');
              const status = (isCurrent ? run?.status : m.status) ?? m.status;
              const answered = answer != null;
              const prov = provenanceOf(trace, { mock: dsKind === 'mock', status, hasAnswer: answered });
              // Контур прогона: блоки зажигаются только по наблюдаемым
              // событиям трейса (роли model_call, tool_call, recovery…).
              // Пустой трейс → полосы нет, вместо выдуманной подсветки.
              const contour = trace.length > 0 ? contourBlocks(trace) : [];
              // M2: the «память» tag marks an observed memory_search call in
              // the trace — the request flag alone never earns it (a granted
              // tool may return empty; only the event proves retrieval ran).
              const memoryUsed = trace.some(
                (ev) => ev.type === 'tool_call' && eventTool(ev.body) === 'memory_search',
              );
              // fs-access: заявки на запись из трейса прогона → карточки
              // ApprovalRequest внутри пузыря. Финальная правда — событие
              // fs_request_resolved; локальные решения лишь мост до него.
              const fsReqs: FsRequestView[] = [];
              const fsResolutions = new Map<string, 'approved' | 'denied'>();
              // Волна XII/XIV: SDK-подтверждения — карточки из трейса.
              // Хост эмитит legacy `tool_confirmation` + каноническое
              // `confirmation_requested` на один вызов → дедуп по callId;
              // `confirmation_deferred` — поздний переход в deferred;
              // финал — `tool_confirmation_resolved`.
              const toolConfMap = new Map<string, ToolConfirmationView>();
              const toolConfs: ToolConfirmationView[] = [];
              const toolResolutions = new Map<string, { decision: 'approved' | 'denied'; message: string | null }>();
              for (const ev of trace) {
                if (ev.type === 'fs_request') {
                  const r = fsRequestOf(ev.body);
                  if (r) fsReqs.push(r);
                } else if (ev.type === 'fs_request_resolved') {
                  const r = fsResolutionOf(ev.body);
                  if (r) fsResolutions.set(r.id, r.decision);
                } else if (ev.type === 'tool_confirmation' || ev.type === 'confirmation_requested') {
                  const r = toolConfirmationOf(ev.body);
                  if (r) {
                    const prev = toolConfMap.get(r.callId);
                    if (prev == null) {
                      toolConfMap.set(r.callId, r.requestedAt == null && ev.ts ? { ...r, requestedAt: ev.ts } : r);
                      toolConfs.push(toolConfMap.get(r.callId)!);
                    } else {
                      const merged = mergeConfirmationView(prev, r, ev.ts);
                      toolConfMap.set(r.callId, merged);
                      const idx = toolConfs.indexOf(prev);
                      if (idx >= 0) toolConfs[idx] = merged;
                    }
                  }
                } else if (ev.type === 'confirmation_deferred') {
                  const r = confirmationDeferredOf(ev.body);
                  const prev = r != null ? toolConfMap.get(r.callId) : undefined;
                  if (r != null && prev != null) {
                    const merged = { ...prev, state: 'deferred' };
                    toolConfMap.set(r.callId, merged);
                    const idx = toolConfs.indexOf(prev);
                    if (idx >= 0) toolConfs[idx] = merged;
                  }
                } else if (ev.type === 'tool_confirmation_resolved') {
                  const r = toolConfirmationResolutionOf(ev.body);
                  if (r) toolResolutions.set(r.callId, r);
                }
              }
              // GET-восстановление: открытые карточки хоста важнее трейса —
              // state/requestedAt свежее, а карточку без события в трейсе
              // добавляем verbatim из списка (форма ответа = форма события).
              const hostConfs = m.runId != null ? sdkConfs[m.runId] : undefined;
              if (hostConfs != null) {
                for (const hc of hostConfs) {
                  const asView = toolConfirmationOf(hc);
                  if (asView == null) continue;
                  const prev = toolConfMap.get(hc.callId);
                  if (prev == null) {
                    toolConfMap.set(hc.callId, asView);
                    toolConfs.push(asView);
                  } else {
                    const merged: ToolConfirmationView = {
                      ...prev,
                      state: hc.state,
                      parentCallId: hc.parentCallId ?? prev.parentCallId,
                      requestedAt: hc.requestedAt ?? prev.requestedAt,
                      input: hc.input != null ? asView.input : prev.input,
                      inputData: hc.input != null ? asView.inputData : prev.inputData,
                      tool: hc.tool ?? prev.tool,
                    };
                    toolConfMap.set(hc.callId, merged);
                    const idx = toolConfs.indexOf(prev);
                    if (idx >= 0) toolConfs[idx] = merged;
                  }
                }
              }
              // Локальный defer-маркер (POST resolved:false), когда ни
              // трейс, ни GET ещё не показали deferred.
              const deferSet = m.runId != null ? deferredMarks[m.runId] : undefined;
              if (deferSet != null) {
                for (let i = 0; i < toolConfs.length; i++) {
                  if (deferSet.has(toolConfs[i].callId) && toolConfs[i].state !== 'deferred') {
                    toolConfs[i] = { ...toolConfs[i], state: 'deferred' };
                    toolConfMap.set(toolConfs[i].callId, toolConfs[i]);
                  }
                }
              }
              // Вложенность по parentCallId — глубина цепочки среди
              // карточек ленты (вне списка родитель не считается).
              const confDepth = (c: ToolConfirmationView): number => {
                let d = 0;
                let cur = c.parentCallId;
                while (cur != null && d < 6) {
                  const p = toolConfMap.get(cur);
                  if (p == null) break;
                  d += 1;
                  cur = p.parentCallId;
                }
                return d;
              };
              // Счётчик контура: фактическое потребление (final.usage либо
              // накопление по model_call/tool_call) + лимиты из config-события.
              const usage = runUsageOf(trace);
              const limits = runLimitsOf(trace);
              const usageParts: string[] = [];
              if (usage != null) {
                usageParts.push(`токены ${usage.tokens.toLocaleString('ru-RU')}${limits?.maxTokens != null ? ` / ${limits.maxTokens.toLocaleString('ru-RU')}` : ''}`);
                usageParts.push(`$${usage.costUsd.toFixed(4)}${limits?.maxCostUsd != null ? ` / ≤ $${limits.maxCostUsd}` : ''}`);
                usageParts.push(`модель ${usage.modelCalls}${limits?.maxModelCalls != null ? `/${limits.maxModelCalls}` : ''}`);
                usageParts.push(`инстр. ${usage.toolCalls}${limits?.maxToolCalls != null ? `/${limits.maxToolCalls}` : ''}`);
              } else if (limits != null) {
                if (limits.maxTokens != null) usageParts.push(`лимит токенов ${limits.maxTokens.toLocaleString('ru-RU')}`);
                if (limits.maxCostUsd != null) usageParts.push(`≤ $${limits.maxCostUsd}`);
              }
              // U-1: вертикальный DAG плана из emit_step (узлы verbatim).
              const planSteps = planDagOf(trace);
              // U-5: бюджет-метр — факт vs лимиты из config-события; без
              // лимита полоса не рисуется (нет «прогресса к ∞»).
              const budgetBars: { label: string; used: number; max: number }[] = [];
              if (usage != null && limits != null) {
                if (limits.maxTokens != null) budgetBars.push({ label: 'токены', used: usage.tokens, max: limits.maxTokens });
                if (limits.maxCostUsd != null) budgetBars.push({ label: 'cost', used: usage.costUsd, max: limits.maxCostUsd });
              }
              // U-4: инспектор «что видит модель» — поля config-события
              // и spawn-аудит verbatim, источник каждой строки виден.
              const modelView = modelViewOf(trace);
              return (
                <DraggableBubble
                  key={m.id}
                  id={m.id}
                  side="left"
                  freshness={live ? (stale ? 'stale' : 'live') : undefined}
                  testId={isCurrent ? 'live-run' : 'chat-assistant'}
                  summary={answer ?? (live ? 'прогон идёт…' : 'ответ не зафиксирован')}
                  selected={selectedIds.has(m.id)}
                  onSelectClick={(e) => onMsgSelectClick(e, m)}
                >
                  <div className={styles.chatMsgHead}>
                    <span className={styles.chatAuthor}>AGENT-A</span>
                    {memoryUsed && (
                      <Chip selected>память</Chip>
                    )}
                    {m.runId && <span className={styles.chatMeta}>{m.runId}</span>}
                  </div>
                  {live || (!answered && (trace.length > 0 || (draft != null && draft !== ''))) ? (
                    // Observable trace + live draft only — telemetry the host
                    // actually reports, never an invented chain-of-thought.
                    <div className={styles.chatTrace} aria-live="polite">
                      <span className={styles.traceLine} data-testid="live-provenance" data-kind={prov.kind}>
                        {prov.label}
                      </span>
                      {planSteps.length > 0 && (
                        <div className={styles.planWrap}>
                          <div className={styles.planViewToggle} role="group" aria-label="Вид плана">
                            <button type="button" aria-pressed={planView === 'list'}
                              onClick={() => setPlanView('list')}>список</button>
                            <button type="button" aria-pressed={planView === 'canvas'}
                              onClick={() => setPlanView('canvas')}>канвас</button>
                          </div>
                          {planView === 'canvas' ? (
                            <PlanDag
                              data={planGraphOf(trace)}
                              title="План прогона"
                              width={640}
                              height={360}
                              zoomable
                            />
                          ) : (
                            <ol className={styles.planSteps} data-testid="plan-dag" aria-label="План шагов прогона">
                              {planSteps.map((st) => (
                                <li key={st.seq} className={styles.planStep} data-status={st.status}>
                                  <span className={styles.planStepMark} aria-hidden>{
                                    st.status === 'done' ? '☑'
                                      : st.status === 'failed' ? '✕'
                                        : st.status === 'skipped' ? '⊘'
                                          : st.status === 'active' ? '▸'
                                            : '○'
                                  }</span>
                                  <span>
                                    {st.id != null ? `${st.id} · ` : ''}{st.text}
                                    {st.dependsOn.length > 0 && (
                                      <span className={styles.planStepDeps}> (после {st.dependsOn.join(', ')})</span>
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ol>
                          )}
                        </div>
                      )}
                      {trace.length === 0 ? (
                        <span className={styles.traceLine}>прогон принят — ждём события рантайма…</span>
                      ) : (
                        // Полный ход: пузырь растёт в высоту, старые строки
                        // не вытесняются новыми — follow-scroll держит низ.
                        // Сообщения LLM (body.text model_call) висят серым
                        // блоком под своей строкой — не удаляются.
                        <TraceLines trace={trace} />
                      )}
                      {draft != null && draft !== '' && (
                        <p className={styles.chatText} data-testid="live-draft">{humanizeDraft(draft)}</p>
                      )}
                      {live && <TypingIndicator label="AGENT-A печатает…" />}
                    </div>
                  ) : answered ? (
                    <>
                      {contour.length > 0 && (
                        <div className={styles.contour} data-testid="run-contour" aria-label="Задействованные блоки контура">
                          {contour.map((b) => (
                            <span
                              key={b.id}
                              className={styles.contourChip}
                              data-lit={b.lit || undefined}
                              title={b.hint ?? (b.lit ? 'блок задействован в прогоне' : 'блок контура не задействован')}
                            >
                              {b.label}{b.detail != null ? ` ${b.detail}` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className={styles.chatText}>{answer}</p>
                      <span className={styles.chatMeta} data-testid="answer-provenance" data-kind={prov.kind}>
                        {prov.percent != null && <b className={styles.provPct}>{prov.percent}%</b>}
                        {prov.label}
                      </span>
                    </>
                  ) : (
                    <p className={styles.chatText}>
                      {status === 'running' ? 'прогон идёт…' : 'Ответ не зафиксирован хостом.'}
                    </p>
                  )}
                  {trace.length > 0 && answered && (
                    <details className={styles.chatTraceDetail}>
                      <summary>ход прогона · {trace.length} событий</summary>
                      <div className={styles.chatTrace}>
                        <TraceLines trace={trace} />
                      </div>
                    </details>
                  )}
                  {modelView.length > 0 && (
                    <details className={styles.modelView} data-testid="model-view">
                      <summary>что видит модель</summary>
                      <table>
                        <tbody>
                          {modelView.map((row) => (
                            <tr key={`${row.label}:${row.source}`}>
                              <th scope="row">{row.label}</th>
                              <td>{row.value}</td>
                              <td className={styles.modelViewSrc}>{row.source}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                  {fsReqs.map((req) => (
                    <ApprovalRequest
                      key={req.id}
                      title="AGENT-A просит запись"
                      action={req.op}
                      target={req.root ? `${req.root}:${req.path}` : req.path}
                      detail={`${req.size} Б · sha256 ${req.sha256.slice(0, 12)}…${req.preview ? ` — ${req.preview.slice(0, 120)}` : ''}`}
                      state={fsResolutions.get(req.id) ?? fsDecisions[req.id] ?? 'pending'}
                      approveLabel="Разрешить"
                      rejectLabel="Отклонить"
                      onApprove={() => void decideFs(req.id, 'approve')}
                      onReject={() => void decideFs(req.id, 'deny')}
                    />
                  ))}
                  {/* Волна XIV: карточки SDK-подтверждений (ToolConfirmCard —
                          allow/deny/defer + reason, таймер, «хост не ответил»).
                          Без seam ответа — read-only; финал — resolved-событие. */}
                  {toolConfs.map((conf) => {
                    const installNotice = pluginInstallNotices.find(
                      (n) => n.runId === m.runId && n.confirmation.callId === conf.callId,
                    ) ?? {
                      runId: m.runId ?? '',
                      confirmation: conf,
                      decision: null,
                      message: null,
                      outcome: null,
                      pluginId: null,
                      enabledNow: false,
                    } satisfies PluginInstallNotice;
                    const decide = m.runId != null && ds.respondToolConfirmation != null
                      ? (d: SdkConfirmDecision) => decideToolConf(m.runId!, conf.callId, d)
                      : undefined;
                    return isPluginInstallConfirmation(conf.tool)
                      ? (
                        <PluginInstallConfirmation
                          key={conf.callId}
                          notice={installNotice}
                          onDecide={decide}
                        />
                      )
                      : (
                        <ToolConfirmCard
                          key={conf.callId}
                          conf={conf}
                          resolved={toolResolutions.get(conf.callId) ?? null}
                          depth={confDepth(conf)}
                          onDecide={m.runId != null && ds.respondToolConfirmation != null && !sdkSeamDown
                            ? (d, reason) => decideToolConf(m.runId!, conf.callId, d, reason)
                            : undefined}
                        />
                      );
                  })}
                  {/* Волна XIV W3 — богатая лента (NUE1): UsageMeter,
                          дифф-ревью изменённых файлов, #path-упоминания,
                          маркеры чекпоинтов. Откат — заявкой через seam
                          W1; карточка tool='rewind' приходит в ленту
                          подтверждений выше. Без seam'ов — честные
                          «нет данных»/«недоступно». */}
                  <RunFeedExtras runId={m.runId} trace={trace} live={live} ds={ds} />
                  {fsActionErr && <p className={styles.error} role="alert">{fsActionErr}</p>}
                  {(live || usageParts.length > 0 || (answered && !live)) && (
                    <div className={styles.chatActions}>
                      {usageParts.length > 0 && (
                        <span className={styles.chatUsage} data-testid="run-usage" title="Потребление и лимиты контура прогона — по событиям трейса">
                          {usageParts.join(' · ')}
                        </span>
                      )}
                      {budgetBars.length > 0 && (
                        <span className={styles.budgetRow} data-testid="budget-meter" role="group" aria-label="Расход бюджета прогона">
                          {budgetBars.map((bb) => {
                            const pct = Math.min(100, Math.round((bb.used / bb.max) * 100));
                            return (
                              <span key={bb.label} className={styles.budgetBar} title={`${bb.label}: ${bb.used.toLocaleString('ru-RU')} / ${bb.max.toLocaleString('ru-RU')} (${pct}%)`}>
                                <span className={styles.budgetBarLabel}>{bb.label}</span>
                                <span className={styles.budgetBarTrack}>
                                  <span className={styles.budgetBarFill} style={{ width: `${pct}%` }} data-hot={pct >= 80 || undefined} />
                                </span>
                                <span className={styles.budgetBarNums}>{bb.used.toLocaleString('ru-RU')} / {bb.max.toLocaleString('ru-RU')}</span>
                              </span>
                            );
                          })}
                        </span>
                      )}
                      {live && <Button variant="danger" size="sm" onClick={cancel}>Остановить</Button>}
                      {/* Manual listen lives above the contour gear (composer
                          area) — a real click is a user gesture, so WebView2
                          autoplay policy cannot silently block it. Copy stays
                          per-bubble: clipboard API + execCommand fallback. */}
                      {answered && !live && (
                        <button
                          type="button"
                          className={styles.prefChoice}
                          onClick={() => void copyAnswer(m.id, answer)}
                          aria-label="Скопировать текст ответа в буфер"
                        >
                          {copiedId === m.id ? 'Скопировано' : '⧉ Копировать'}
                        </button>
                      )}
                      {m.runId != null && trace.length > 0 && (
                        <button
                          type="button"
                          className={styles.prefChoice}
                          onClick={() => downloadReport(m)}
                          aria-label="Экспортировать прогон в markdown-файл"
                        >
                          ⤓ .md
                        </button>
                      )}
                    </div>
                  )}
                  <MessageActions
                    copyText={answer ?? null}
                    copied={copiedId === m.id}
                    onCopy={() => void copyAnswer(m.id, answer ?? '')}
                    onHide={() => hideAndFocus(m.id)}
                    selected={selectedIds.has(m.id)}
                    onSelectToggle={(e) => toggleSelect(m.id, e.shiftKey)}
                  />
                  {/* Полоска воспроизведения — живёт под озвучиваемым ответом:
                      пауза/продолжить, seek по дорожке, время, стоп. */}
                  {speaking?.id === m.id && (
                    <div className={styles.playbar} data-testid="playbar">
                      <button
                        type="button"
                        className={styles.playBtn}
                        onClick={togglePlay}
                        aria-label={speaking.paused ? 'Продолжить озвучку' : 'Пауза озвучки'}
                      >
                        {speaking.paused ? '▶' : '⏸'}
                      </button>
                      <input
                        type="range"
                        className={styles.playSeek}
                        min={0}
                        max={speaking.dur > 0 ? speaking.dur : 1}
                        step={0.1}
                        value={speaking.pos}
                        disabled={speaking.dur <= 0}
                        aria-label="Позиция воспроизведения"
                        onChange={(e) => seekAudio(Number(e.target.value))}
                      />
                      <span className={styles.playTime}>
                        {fmtPlayTime(speaking.pos)}{speaking.dur > 0 ? ` / ${fmtPlayTime(speaking.dur)}` : ''}
                      </span>
                      <button
                        type="button"
                        className={styles.playBtn}
                        onClick={stopAudio}
                        aria-label="Остановить озвучку"
                      >
                        ■
                      </button>
                    </div>
                  )}
                  {/* Итог прогона — внизу, после всех логов и сообщений:
                      завершение следует за ходом, не предшествует ему. */}
                  <div className={styles.chatStatusRow} data-testid="run-status-row">
                    <StatusBadge {...STATUS_BADGE[status]} />
                    {live && <StatusBadge status="thinking" label="ПЕЧАТАЕТ…" />}
                    {isCurrent && stale && status === 'running' && (
                      <StatusBadge status="syncing" label="СИНХРОНИЗАЦИЯ" />
                    )}
                  </div>
                  <span className={styles.chatMeta}>{fmtEventTime(m.ts)}</span>
                </DraggableBubble>
              );
            })}
            {pendingApprovals > 0 && (
              <DraggableBubble id="pending-approvals" side="left" kind="notice">
                <p className={styles.chatText}>
                  Ожидают подтверждений: {pendingApprovals} — решения принимаются в Настройках → Runtime.
                </p>
                <button
                  type="button"
                  className={styles.prefChoice}
                  onClick={() => router.push('/settings')}
                >
                  Открыть настройки
                </button>
              </DraggableBubble>
            )}
          </ol>
          </>
        )}
      </div>
    </GlassPanel>
  );
}
