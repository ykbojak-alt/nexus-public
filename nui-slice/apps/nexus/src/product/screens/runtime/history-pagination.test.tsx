// @vitest-environment jsdom
// W3-143: догрузка истории треда при скролле к верху ленты —
// cursor-пагинация, prepend без скачка, дедуп, честный конец.
import {
  getChatHistory, getRunDetail, seams,
} from './test-harness';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RuntimeScreen } from '../runtime';
import { CHAT_SESSION_KEY } from './shared';
import type { ChatHistoryEntry, ChatHistoryPage } from '../../data-source';

const historyPage = (entries: ChatHistoryEntry[], hasMore: boolean, nextCursor: string | null = null): ChatHistoryPage => ({
  sessionId: 'run-new',
  entries,
  hasMore,
  nextCursor,
});

const msgEntry = (runId: string, part: 'task' | 'answer', text: string, createdAt: number): ChatHistoryEntry => ({
  kind: 'message',
  id: `${runId}:${part}`,
  runId,
  part,
  role: part === 'task' ? 'user' : 'assistant',
  text,
  createdAt,
});

/** Instant-restore: снапшот ленты — та же механика, что на живом экране. */
const seedSnapshot = (msgs: Array<Record<string, unknown>>) => {
  sessionStorage.setItem(CHAT_SESSION_KEY, JSON.stringify({ chat: msgs, traces: {}, answers: {} }));
};

const pair = (runId: string, task: string, ts: number) => ([
  { id: `u-${runId}`, role: 'user', text: task, status: 'done', ts },
  { id: `a-${runId}`, role: 'assistant', runId, status: 'done', ts },
]);

function stubListGeometry(list: HTMLElement) {
  const state = { scrollTop: 60 };
  Object.defineProperties(list, {
    scrollTop: {
      configurable: true,
      get: () => state.scrollTop,
      set: (value: number) => { state.scrollTop = value; },
    },
    scrollHeight: { configurable: true, get: () => 1000 },
    clientHeight: { configurable: true, get: () => 300 },
  });
  list.getBoundingClientRect = () =>
    ({ top: 100, bottom: 400, left: 0, right: 320, width: 320, height: 300, x: 0, y: 100, toJSON: () => ({}) });
  return state;
}

/** Рядам — высота 50px и позиция по текущему порядку в DOM: после
 *  prepend старый ряд смещается вниз, restore обязан вернуть его. */
function trackRows(list: HTMLElement) {
  for (const row of Array.from(list.querySelectorAll<HTMLElement>('[data-chat-message-id]'))) {
    row.getBoundingClientRect = () => {
      const idx = Array.from(list.querySelectorAll('[data-chat-message-id]')).indexOf(row);
      const top = 100 + idx * 50 - list.scrollTop;
      return { top, bottom: top + 40, left: 0, right: 320, width: 320, height: 40, x: 0, y: top, toJSON: () => ({}) };
    };
  }
}

const messageIds = (list: HTMLElement) =>
  Array.from(list.querySelectorAll('[data-chat-message-id]'))
    .map((row) => row.getAttribute('data-chat-message-id'));

describe('W3-143: runtime feed paginates host history on scroll-to-top', () => {
  it('scroll near the top requests the page before the oldest loaded message', async () => {
    seams.history = true;
    seedSnapshot(pair('run-new', 'новый вопрос', 200));
    getChatHistory.mockResolvedValue(historyPage([], false));

    render(<RuntimeScreen />);
    await screen.findByText('новый вопрос');
    const list = screen.getByTestId('runtime-chat').querySelector('ol')!;
    stubListGeometry(list);

    fireEvent.scroll(list);
    await waitFor(() => expect(getChatHistory).toHaveBeenCalledTimes(1));
    expect(getChatHistory).toHaveBeenCalledWith('run-new', {
      beforeId: 'run-new:task', limit: 50, effective: true,
    });
    // Пустая страница без has_more — честный конец истории.
    await screen.findByTestId('chat-history-start');
    expect(screen.getByTestId('chat-history-start').textContent).toBe('Начало треда');
  });

  it('prepends older entries in chronological order and keeps the reader position', async () => {
    seams.history = true;
    seedSnapshot(pair('run-new', 'новый вопрос', 200));
    getChatHistory.mockResolvedValue(historyPage([
      msgEntry('run-old', 'task', 'старый вопрос', 100),
      msgEntry('run-old', 'answer', 'старый ответ', 105),
      msgEntry('run-mid', 'task', 'средний вопрос', 150),
    ], false));

    render(<RuntimeScreen />);
    await screen.findByText('новый вопрос');
    const list = screen.getByTestId('runtime-chat').querySelector('ol')!;
    const geom = stubListGeometry(list);
    trackRows(list);
    geom.scrollTop = 20; // у верха, не внизу → anchor-mode

    await act(async () => { fireEvent.scroll(list); });
    await waitFor(() => expect(getChatHistory).toHaveBeenCalledTimes(1));
    trackRows(list); // фиксируем rect-функции на новых рядах
    await screen.findByText('старый вопрос');
    await screen.findByText('средний вопрос');

    expect(messageIds(list).slice(0, 4)).toEqual(['u-run-old', 'a-run-old', 'u-run-mid', 'u-run-new']);
    // Якорь: видимый ряд до prepend сохранил viewport-offset — scrollTop
    // сдвинут на высоту вставки (3 ряда × 50px).
    expect(geom.scrollTop).toBe(20 + 150);
    await screen.findByTestId('chat-history-start');
  });

  it('dedupes page entries already present in the feed', async () => {
    seams.history = true;
    seedSnapshot(pair('run-new', 'новый вопрос', 200));
    getChatHistory.mockResolvedValue(historyPage([
      msgEntry('run-new', 'task', 'новый вопрос', 200),   // дубль — пропуск
      msgEntry('run-new', 'answer', 'новый ответ', 205),  // дубль — пропуск
      msgEntry('run-old', 'task', 'старый вопрос', 100),
    ], true, 'run-old:task'));

    render(<RuntimeScreen />);
    await screen.findByText('новый вопрос');
    const list = screen.getByTestId('runtime-chat').querySelector('ol')!;
    stubListGeometry(list);
    fireEvent.scroll(list);

    await screen.findByText('старый вопрос');
    const ids = messageIds(list);
    expect(ids.filter((id) => id === 'u-run-new')).toHaveLength(1);
    expect(ids.filter((id) => id === 'a-run-new')).toHaveLength(1);
    expect(ids[0]).toBe('u-run-old');
    // has_more → ни «Начало треда», ни повторного запроса без скролла.
    expect(screen.queryByTestId('chat-history-start')).toBeNull();
    expect(getChatHistory).toHaveBeenCalledTimes(1);
  });

  it('next page goes strictly older via host next_cursor', async () => {
    seams.history = true;
    seedSnapshot(pair('run-new', 'новый вопрос', 200));
    getChatHistory
      .mockResolvedValueOnce(historyPage([msgEntry('run-mid', 'task', 'средний', 150)], true, 'run-mid:task'))
      .mockResolvedValueOnce(historyPage([msgEntry('run-old', 'task', 'старый', 100)], false));

    render(<RuntimeScreen />);
    await screen.findByText('новый вопрос');
    const list = screen.getByTestId('runtime-chat').querySelector('ol')!;
    const geom = stubListGeometry(list);

    fireEvent.scroll(list);
    await screen.findByText('средний');
    geom.scrollTop = 10;
    fireEvent.scroll(list);
    await screen.findByText('старый');
    await waitFor(() => expect(getChatHistory).toHaveBeenCalledTimes(2));
    expect(getChatHistory.mock.calls[1][1]).toEqual({
      beforeId: 'run-mid:task', limit: 50, effective: true,
    });
    await screen.findByTestId('chat-history-start');
  });

  it('history error shows an honest alert row with retry', async () => {
    seams.history = true;
    seedSnapshot(pair('run-new', 'новый вопрос', 200));
    getChatHistory.mockRejectedValueOnce(new Error('offline'));

    render(<RuntimeScreen />);
    await screen.findByText('новый вопрос');
    const list = screen.getByTestId('runtime-chat').querySelector('ol')!;
    stubListGeometry(list);
    fireEvent.scroll(list);

    const alert = await screen.findByTestId('chat-history-error');
    expect(alert.textContent).toContain('Не удалось загрузить историю');
    expect(screen.queryByTestId('chat-history-start')).toBeNull();

    getChatHistory.mockResolvedValueOnce(historyPage([msgEntry('run-old', 'task', 'старый', 100)], false));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByText('старый');
    await screen.findByTestId('chat-history-start');
  });

  it('effective compact entries render as the existing compact block', async () => {
    seams.history = true;
    seedSnapshot(pair('run-new', 'новый вопрос', 200));
    getChatHistory.mockResolvedValue(historyPage([
      {
        kind: 'compact',
        id: 'compact-1',
        summary: 'Два ранних сообщения свёрнуты.',
        coversMessageIds: ['run-old:task', 'run-old:answer'],
        createdAt: '2026-10-19T10:00:00Z',
      },
      msgEntry('run-old', 'task', 'покрытый вопрос', 100),
      msgEntry('run-old', 'answer', 'покрытый ответ', 105),
      msgEntry('run-mid', 'task', 'средний', 150),
    ], false));

    render(<RuntimeScreen />);
    await screen.findByText('новый вопрос');
    const list = screen.getByTestId('runtime-chat').querySelector('ol')!;
    stubListGeometry(list);
    fireEvent.scroll(list);

    await screen.findByText('средний');
    // Compact-нода в ленте; покрытые ею сообщения не дублируются отдельными
    // рядами (text живёт внутри compact-блока, в свёрнутом inert-слое).
    expect(list.querySelector('[data-chat-compact-anchor]')).toBeTruthy();
    expect(list.querySelector('[data-chat-message-id="u-run-old"]')).toBeNull();
    expect(list.querySelector('[data-chat-message-id="a-run-old"]')).toBeNull();
    expect(screen.getByTestId('chat-compact-block')).toBeTruthy();
    await screen.findByTestId('chat-history-start');
  });

  it('resolves the thread root through the parent chain for the session id', async () => {
    seams.history = true;
    seams.detail = true;
    seedSnapshot(pair('run-new', 'новый вопрос', 200));
    getRunDetail.mockImplementation((id: string) => Promise.resolve({
      run: {
        runId: id, taskText: 'x', config: 'baseline', status: 'done',
        stopReason: 'done', agent: null, parent: id === 'run-new' ? 'run-root' : null,
        project: 'nexus', model: null, costUsd: null, createdAt: 1, finishedAt: 2,
      },
      result: null,
      events: [],
    }));
    getChatHistory.mockResolvedValue(historyPage([], false));

    render(<RuntimeScreen />);
    await screen.findByText('новый вопрос');
    const list = screen.getByTestId('runtime-chat').querySelector('ol')!;
    stubListGeometry(list);
    fireEvent.scroll(list);

    await waitFor(() => expect(getChatHistory).toHaveBeenCalledTimes(1));
    expect(getChatHistory.mock.calls[0][0]).toBe('run-root');
  });

  it('uses a restored compact node as both the root and the first history cursor', async () => {
    seams.history = true;
    seedSnapshot([{
      id: 'c-compact-0',
      kind: 'compact',
      role: 'assistant',
      status: 'done',
      ts: 100,
      compact: {
        compacted: true,
        compactId: 'compact-0',
        threadId: 'run-root',
        summary: 'Сжатый контекст',
        coversMessageIds: ['run-root:task', 'run-root:answer'],
        keptMessageIds: [],
        createdAt: '',
      },
    }]);
    getChatHistory.mockResolvedValue(historyPage([], false));

    render(<RuntimeScreen />);
    await screen.findByText('Сжатый контекст');
    const list = screen.getByTestId('runtime-chat').querySelector('ol')!;
    stubListGeometry(list);
    fireEvent.scroll(list);

    await waitFor(() => expect(getChatHistory).toHaveBeenCalledTimes(1));
    expect(getChatHistory).toHaveBeenCalledWith('run-root', {
      beforeId: 'compact-0', limit: 50, effective: true,
    });
  });

  it('without the seam the feed stays a snapshot-only honest list', async () => {
    // seams.history = false — ds.getChatHistory отсутствует.
    seedSnapshot(pair('run-new', 'новый вопрос', 200));
    render(<RuntimeScreen />);
    await screen.findByText('новый вопрос');
    const list = screen.getByTestId('runtime-chat').querySelector('ol')!;
    stubListGeometry(list);
    fireEvent.scroll(list);
    // Никаких маркеров — ни ложного «начала», ни фейковой истории.
    expect(screen.queryByTestId('chat-history-loading')).toBeNull();
    expect(screen.queryByTestId('chat-history-start')).toBeNull();
    expect(screen.queryByTestId('chat-history-error')).toBeNull();
    expect(getChatHistory).not.toHaveBeenCalled();
  });
});
