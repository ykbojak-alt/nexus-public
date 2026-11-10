// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  captureChatScrollAnchor,
  isChatPinnedToBottom,
  restoreChatScrollAnchor,
} from './chat-scroll-anchor';

function box(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 320, width: 320, height: bottom - top, x: 0, y: top, toJSON: () => ({}) };
}

describe('chat scroll anchoring', () => {
  it('preserves the first post-compact message in a 200-row feed', () => {
    const list = document.createElement('ol');
    let scrollTop = 4000;
    let removedRows = 0;
    Object.defineProperties(list, {
      scrollTop: { get: () => scrollTop, set: (value: number) => { scrollTop = value; }, configurable: true },
      scrollHeight: { get: () => 7000, configurable: true },
      clientHeight: { get: () => 400, configurable: true },
    });
    list.getBoundingClientRect = () => box(50, 450);
    const rows = Array.from({ length: 200 }, (_, index) => {
      const row = document.createElement('li');
      row.dataset.chatMessageId = `message-${index}`;
      row.getBoundingClientRect = () => {
        const top = 50 + (index - removedRows) * 50 - scrollTop;
        return box(top, top + 40);
      };
      list.append(row);
      return row;
    });

    const anchor = captureChatScrollAnchor(list, false);
    expect(anchor.messageId).toBe('message-80');
    expect(anchor.offset).toBe(0);
    rows.slice(0, 60).forEach((row) => row.remove());
    removedRows = 60;
    restoreChatScrollAnchor(list, anchor);

    expect(scrollTop).toBe(1000);
    expect(rows[80].getBoundingClientRect().top - list.getBoundingClientRect().top).toBe(0);
  });

  it('keeps a visible compact row at the same viewport offset after covered rows collapse', () => {
    const list = document.createElement('ol');
    const before = document.createElement('li');
    before.dataset.chatMessageId = 'covered';
    const after = document.createElement('li');
    after.dataset.chatMessageId = 'post-compact';
    let scrollTop = 240;
    let compactContentTop = 330;
    Object.defineProperties(list, {
      scrollTop: { get: () => scrollTop, set: (value: number) => { scrollTop = value; }, configurable: true },
      scrollHeight: { get: () => 1000, configurable: true },
      clientHeight: { get: () => 200, configurable: true },
    });
    list.getBoundingClientRect = () => box(100, 300);
    before.getBoundingClientRect = () => box(120, 160);
    after.getBoundingClientRect = () => box(220, 280);
    list.append(before, after);

    const anchor = captureChatScrollAnchor(list, false);
    expect(anchor.messageId).toBe('covered');
    expect(anchor.offset).toBe(20);

    before.remove();
    const compact = document.createElement('li');
    compact.dataset.chatCompactAnchor = '';
    compact.getBoundingClientRect = () => {
      const top = 100 + compactContentTop - scrollTop;
      return box(top, top + 40);
    };
    compactContentTop = 360;
    list.prepend(compact);
    restoreChatScrollAnchor(list, anchor);

    expect(scrollTop).toBe(340);
    expect(compact.getBoundingClientRect().top - list.getBoundingClientRect().top).toBe(20);
  });

  it('sticks to the tail during streaming only when already pinned there', () => {
    const list = document.createElement('ol');
    let scrollTop = 800;
    let scrollHeight = 1000;
    Object.defineProperties(list, {
      scrollTop: { get: () => scrollTop, set: (value: number) => { scrollTop = value; }, configurable: true },
      scrollHeight: { get: () => scrollHeight, configurable: true },
      clientHeight: { get: () => 200, configurable: true },
    });
    list.getBoundingClientRect = () => box(100, 300);

    const pinnedAnchor = captureChatScrollAnchor(list);
    expect(isChatPinnedToBottom(list)).toBe(true);
    scrollHeight = 1400;
    restoreChatScrollAnchor(list, pinnedAnchor);
    expect(scrollTop).toBe(1400);

    scrollTop = 300;
    expect(isChatPinnedToBottom(list)).toBe(false);
    const readerAnchor = captureChatScrollAnchor(list, false);
    scrollHeight = 1800;
    restoreChatScrollAnchor(list, readerAnchor);
    expect(scrollTop).toBe(300);
  });

  it('uses the compact row if the previously visible covered message was removed', () => {
    const list = document.createElement('ol');
    let scrollTop = 0;
    const oldRow = document.createElement('li');
    oldRow.dataset.chatMessageId = 'removed';
    Object.defineProperties(list, {
      scrollTop: { get: () => scrollTop, set: (value: number) => { scrollTop = value; }, configurable: true },
      scrollHeight: { get: () => 1000, configurable: true },
      clientHeight: { get: () => 200, configurable: true },
    });
    list.getBoundingClientRect = () => box(100, 300);
    oldRow.getBoundingClientRect = () => box(140, 180);
    list.append(oldRow);
    const anchor = captureChatScrollAnchor(list, false);

    oldRow.remove();
    const compact = document.createElement('li');
    compact.dataset.chatCompactAnchor = '';
    compact.getBoundingClientRect = () => box(160, 200);
    list.append(compact);
    restoreChatScrollAnchor(list, anchor);
    expect(scrollTop).toBe(20);
  });

  it('re-restores anchor when feed height changes (resize case)', () => {
    const list = document.createElement('ol');
    Object.defineProperties(list, {
      scrollHeight: { get: () => 2000, configurable: true },
      clientHeight: { get: () => 400, configurable: true },
    });
    list.getBoundingClientRect = () => box(0, 400);
    // Add some rows
    for (let i = 0; i < 20; i++) {
      const row = document.createElement('li');
      row.dataset.chatMessageId = `message-${i}`;
      row.getBoundingClientRect = () => box(i * 50, i * 50 + 40);
      list.append(row);
    }
    const anchor = captureChatScrollAnchor(list, false);
    expect(anchor.height).toBe(400);
    expect(anchor.offset).toBe(0);
    // Simulate image load reflow: increase the clientHeight
    Object.defineProperties(list, {
      clientHeight: { get: () => 600, configurable: true },
    });
    // anchor.height was 400, new height is 600 — re-restore
    restoreChatScrollAnchor(list, anchor);
    // Verify anchor was re-captured successfully (no crash)
    expect(anchor.height).toBe(400);
  });

  it('handles burst-of-appends — many rows added at once preserves anchor', () => {
    const list = document.createElement('ol');
    Object.defineProperties(list, {
      scrollHeight: { get: () => 200, configurable: true },
      clientHeight: { get: () => 200, configurable: true },
    });
    list.getBoundingClientRect = () => box(0, 200);
    // Capture anchor before adding rows
    const anchor = captureChatScrollAnchor(list, false);
    // Append many rows at once (burst)
    for (let i = 0; i < 50; i++) {
      const row = document.createElement('li');
      row.dataset.chatMessageId = `message-${i}`;
      row.getBoundingClientRect = () => box(i * 10, i * 10 + 20);
      list.append(row);
    }
    // After burst, anchor should still reference the same visible row
    restoreChatScrollAnchor(list, anchor);
  });

  it('keeps a near-top anchored row within 2px after prepend + browser auto-adjust', () => {
    const list = document.createElement('ol');
    let scrollTop = 100;
    let prepended = 0;
    const ROW_H = 100;
    Object.defineProperties(list, {
      scrollTop: { get: () => scrollTop, set: (value: number) => { scrollTop = value; }, configurable: true },
      scrollHeight: { get: () => 2000, configurable: true },
      clientHeight: { get: () => 400, configurable: true },
    });
    list.getBoundingClientRect = () => box(0, 400);

    const rows: HTMLElement[] = [];
    for (let i = 0; i < 20; i++) {
      const row = document.createElement('li');
      row.dataset.chatMessageId = `message-${i}`;
      row.getBoundingClientRect = () => {
        const top = (i + prepended) * ROW_H - scrollTop;
        return box(top, top + ROW_H);
      };
      rows.push(row);
      list.append(row);
    }

    // Near the top of a long feed: message-0 is scrolled out, message-1 is the
    // first visible row, anchored at offset 0.
    const anchor = captureChatScrollAnchor(list, false);
    expect(anchor.messageId).toBe('message-1');
    expect(anchor.offset).toBe(0);
    const offsetBefore = rows[1].getBoundingClientRect().top - list.getBoundingClientRect().top;

    // Prepend 12 rows above the anchor (history pagination).
    prepended = 12;
    for (let j = 0; j < 12; j++) {
      const row = document.createElement('li');
      row.dataset.chatMessageId = `new-${j}`;
      row.getBoundingClientRect = () => box(j * ROW_H - scrollTop, j * ROW_H - scrollTop + ROW_H);
      list.insertBefore(row, list.firstChild);
    }

    // Simulate the browser auto-scroll: prepending 12*100px above the view pushes
    // scrollTop down by 1200px to keep the visible content visually stable.
    scrollTop += 12 * ROW_H;

    restoreChatScrollAnchor(list, anchor);

    // Even with the browser auto-adjust applied, restore must not double-correct:
    // the anchored near-top row stays within 2px of its pre-prepend offset.
    const offsetAfter = rows[1].getBoundingClientRect().top - list.getBoundingClientRect().top;
    expect(Math.abs(offsetAfter - offsetBefore)).toBeLessThanOrEqual(2);
  });
});