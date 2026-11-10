export interface ChatScrollAnchor {
  followBottom: boolean;
  compact: boolean;
  messageId: string | null;
  offset: number;
  height: number; // captured viewport height — used to detect reflow
}

const BOTTOM_THRESHOLD_PX = 24;

export function isChatPinnedToBottom(
  element: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>,
  threshold = BOTTOM_THRESHOLD_PX,
): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

/** Snapshot a visible stable row before React changes the transcript DOM. */
export function captureChatScrollAnchor(
  element: HTMLElement,
  followBottom = isChatPinnedToBottom(element),
): ChatScrollAnchor {
  if (followBottom) {
    return { followBottom: true, compact: false, messageId: null, offset: 0, height: element.getBoundingClientRect().height };
  }

  const viewport = element.getBoundingClientRect();
  const rows = element.querySelectorAll<HTMLElement>('[data-chat-compact-anchor], [data-chat-message-id]');
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) continue;
    const compact = row.hasAttribute('data-chat-compact-anchor');
    return {
      followBottom: false,
      compact,
      messageId: compact ? null : row.dataset.chatMessageId ?? null,
      offset: rect.top - viewport.top,
      height: viewport.height,
    };
  }
  return { followBottom: false, compact: false, messageId: null, offset: 0, height: viewport.height };
}

/** Restore the same visible-row offset, or follow the tail if it was pinned. */
export function restoreChatScrollAnchor(element: HTMLElement, anchor: ChatScrollAnchor): void {
  if (anchor.followBottom) {
    element.scrollTop = element.scrollHeight;
    return;
  }

  const viewport = element.getBoundingClientRect();
  const currentHeight = element.getBoundingClientRect().height;

  // If the element's height has changed since anchoring, adjust the scroll
  // proportionally so the visible row stays in the same relative position.
  if (currentHeight !== anchor.height) {
    const heightRatio = anchor.height / currentHeight;
    element.scrollTop = Math.round(element.scrollTop * heightRatio);
  }

  const rows = element.querySelectorAll<HTMLElement>('[data-chat-compact-anchor], [data-chat-message-id]');
  let target: HTMLElement | null = null;
  let firstRow: HTMLElement | null = null;
  for (const row of rows) {
    firstRow ??= row;
    if (anchor.compact && row.hasAttribute('data-chat-compact-anchor')) {
      target = row;
      break;
    }
    if (!anchor.compact && anchor.messageId != null && row.dataset.chatMessageId === anchor.messageId) {
      target = row;
      break;
    }
  }

  // If compaction removed the visible row, anchor to the compact summary.
  if (target == null) {
    target = Array.from(rows).find((row) => row.hasAttribute('data-chat-compact-anchor')) ?? firstRow;
  }
  if (target == null) return;

  const offset = target.getBoundingClientRect().top - viewport.top;
  element.scrollTop += offset - anchor.offset;
}
