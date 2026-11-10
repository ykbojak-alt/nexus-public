'use client';

import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { CompactIndicator } from '@nexus/ui';
import { compactionMotion } from '@nexus/motion';
import type { ChatCompactSuccess } from '../data-source';
import styles from './chat-compaction-motion.module.css';

/** Scrolls to a feed message that is still rendered (kept tail / not
 *  filtered). Returns false when the row is absent from the DOM — covered
 *  messages are removed, so callers fall back to the run link. */
export function revealChatMessageAnchor(messageId: string): boolean {
  if (typeof document === 'undefined') return false;
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(messageId)
    : messageId.replace(/[^\w-]/g, '\\$&');
  const node = document.querySelector<HTMLElement>(
    `[data-chat-message-id="${escaped}"]`,
  );
  if (node == null) return false;
  node.scrollIntoView({ block: 'nearest' });
  if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
  node.focus();
  return true;
}

export interface ChatCompactionMotionMessage {
  id: string;
  content: ReactNode;
}

export interface ChatCompactionMotionProps {
  compact: ChatCompactSuccess;
  /** Only messages the host explicitly reports as covered belong here. */
  coveredMessages: readonly ChatCompactionMotionMessage[];
  /** Controlled mode lets the host start/finish the visual transition. */
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Deterministic override for stories/tests; user preference is CSS-driven. */
  reducedMotion?: boolean;
  /** Host-reported in-flight compaction — non-interactive, aria-busy. */
  busy?: boolean;
  /** Provenance known only from a real source (manual trigger this session);
   *  history-loaded compacts carry no provenance field — slot stays empty. */
  provenanceBadge?: ReactNode;
}

/** Motion-only renderer. It never invokes compaction or invents covered refs. */
export function ChatCompactionMotion({
  compact,
  coveredMessages,
  collapsed,
  defaultCollapsed = false,
  onCollapsedChange,
  reducedMotion = false,
  busy = false,
  provenanceBadge,
}: ChatCompactionMotionProps) {
  const generatedId = useId();
  const [localCollapsed, setLocalCollapsed] = useState(defaultCollapsed);
  const isCollapsed = collapsed ?? localCollapsed;
  const count = compact.coversMessageIds.length;
  const compactOut = compactionMotion('compactOut', { reducedMotion });
  const compactIn = compactionMotion('compactIn', { reducedMotion });
  const badgePop = compactionMotion('badgePop', { reducedMotion });
  const motionStyle = {
    '--compaction-out-duration': `${compactOut.durationMs}ms`,
    '--compaction-out-easing': compactOut.easing,
    '--compaction-in-duration': `${compactIn.durationMs}ms`,
    '--compaction-in-easing': compactIn.easing,
    '--compaction-badge-duration': `${badgePop.durationMs}ms`,
    '--compaction-badge-easing': badgePop.easing,
  } as CSSProperties;
  const createdAt = new Date(compact.createdAt);
  const createdLabel = Number.isNaN(createdAt.getTime())
    ? compact.createdAt
    : new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'short',
      timeStyle: 'medium',
      timeZone: 'UTC',
    }).format(createdAt);

  const toggleRef = useRef<HTMLButtonElement>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const toggle = () => {
    const next = !isCollapsed;
    if (collapsed == null) setLocalCollapsed(next);
    onCollapsedChange?.(next);
  };
  const collapseToToggle = () => {
    if (!isCollapsed) {
      if (collapsed == null) setLocalCollapsed(true);
      onCollapsedChange?.(true);
    }
    toggleRef.current?.focus();
  };

  return (
    <section
      className={styles.root}
      data-state={isCollapsed ? 'collapsed' : 'expanded'}
      data-chat-compact-anchor=""
      data-reduced-motion={reducedMotion || undefined}
      data-testid="chat-compaction-motion"
      style={motionStyle}
      aria-busy={busy || undefined}
    >
      <button
        ref={toggleRef}
        className={styles.toggle}
        type="button"
        aria-controls={`${generatedId}-content`}
        aria-expanded={!isCollapsed}
        disabled={busy}
        onClick={toggle}
      >
        <span>
          {isCollapsed
            ? `Сжатая история · покрыто ${count} сообщений · развернуть`
            : `Свернуть ${count} сообщений`}
        </span>
        <time className={styles.toggleTime} dateTime={compact.createdAt} title="Время сжатия">
          {createdLabel}
        </time>
      </button>
      <div
        className={styles.content}
        id={`${generatedId}-content`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            collapseToToggle();
          }
        }}
      >
        <div
          className={styles.historyTrack}
          aria-hidden={isCollapsed}
          inert={isCollapsed || undefined}
        >
          <ol className={styles.history}>
            {coveredMessages.map(({ id, content }, index) => {
              const stagger = compactionMotion('rowStagger', {
                index,
                batch: !isCollapsed && coveredMessages.length > 1,
                reducedMotion,
              });
              return (
              <li
                className={styles.message}
                key={id}
                style={{ '--compaction-row-delay': `${stagger.delayMs}ms` } as CSSProperties}
              >
                <div className={styles.messageBody}>{content}</div>
              </li>
              );
            })}
          </ol>
        </div>
        <div
          className={styles.compactTrack}
          aria-hidden={!isCollapsed}
          inert={!isCollapsed || undefined}
        >
          <div className={styles.compact}>
            <span className={styles.countBadge} data-testid="chat-compacted-count">
              {count} сообщений сжато
            </span>
            {provenanceBadge}
            <p className={styles.createdAt} data-testid="chat-compact-created-at">
              Время сжатия: {createdLabel}
            </p>
            <p className={styles.summary}>{compact.summary}</p>
            {busy && (
              <p className={styles.busyNote} role="status">
                <CompactIndicator state="active" pattern="dots" /> Сжимаю историю…
              </p>
            )}
            {count > 0 && (
              <div className={styles.references}>
                <button
                  type="button"
                  className={styles.referencesToggle}
                  aria-expanded={sourcesOpen}
                  onClick={() => setSourcesOpen((open) => !open)}
                >
                  {sourcesOpen ? 'Скрыть исходные' : `Показать исходные · ${count}`}
                </button>
                {sourcesOpen && (
                  <ul>
                    {compact.coversMessageIds.map((ref) => {
                      const separator = ref.lastIndexOf(':');
                      const runId = separator < 0 ? ref : ref.slice(0, separator);
                      return (
                        <li key={ref}>
                          <Link href={`/run?id=${encodeURIComponent(runId)}`}>{ref}</Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
