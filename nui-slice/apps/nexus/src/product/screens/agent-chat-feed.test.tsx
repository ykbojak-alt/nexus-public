// @vitest-environment jsdom
/**
 * Wave XIV W3 — богатая лента AGENT-A (NUE1): тесты на фикстурах.
 * Фикстуры помечены // FIXTURE; данные — реальные формы хоста verbatim.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunEventView } from '@nexus/mock-data';
import type { ProductDataSource } from '../data-source';
import {
  CHAT_COMPACTION_THRESHOLD_MESSAGES, ChatCompactBlock, ChatCompactionUnavailable,
  LocalChatCompactionBlock, RunFeedExtras, compactThreadForChat, feedDiffFiles, feedMentionPaths,
  isChatCompactionThresholdReached, locallyCompactedMessageIds,
  mentionTokensOf, rewoundStatesOf,
} from './agent-chat-feed';

afterEach(cleanup);

const ev = (seq: number, type: string, body: unknown): RunEventView => ({
  seq, type, role: 'executor', ts: 1729000000 + seq, body,
});

describe('feedDiffFiles — дифф-ревью по трейсу (фикстуры)', () => {
  it('считает +/− из unified-диффа хоста, заголовки не считаются', () => {
    // FIXTURE: tool_call write_file с diff в result.
    const trace = [ev(1, 'tool_call', {
      tool: 'write_file',
      input: { path: 'src/app.ts' },
      result: { diff: '@@ -1,2 +1,3 @@\n-line1\n+line1new\n+added\n ctx' },
    })];
    const files = feedDiffFiles(trace);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/app.ts');
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
  });

  it('write-операция без диффа — файл есть, счётчиков нет', () => {
    // FIXTURE: write_file без diff-поля.
    const trace = [ev(1, 'tool_call', { tool: 'write_file', input: { path: 'a.txt' }, result: 'ok' })];
    const files = feedDiffFiles(trace);
    expect(files).toEqual([{ path: 'a.txt' }]);
  });

  it('дифф без пути — честная метка «путь не сообщён»', () => {
    // FIXTURE: diff пришёл без input.path.
    const trace = [ev(1, 'tool_call', { tool: 'write_file', input: {}, result: { diff: '+x\n-y' } })];
    const files = feedDiffFiles(trace);
    expect(files[0].path).toBe('путь не сообщён');
  });
});

describe('feedMentionPaths / rewoundStatesOf (фикстуры)', () => {
  it('упоминания — только изменённые файлы (пути чтения — в fs-логе)', () => {
    const trace = [
      ev(1, 'tool_call', { tool: 'read_file', input: { path: 'r.ts' }, result: 'x' }),
      ev(2, 'tool_call', { tool: 'write_file', input: { path: 'w.ts' }, result: 'ok' }),
      ev(3, 'tool_call', { tool: 'read_file', input: { path: 'r.ts' }, result: 'x' }),
      ev(4, 'tool_call', { tool: 'some_tool', input: {}, result: 'x' }),
    ];
    expect(feedMentionPaths(trace)).toEqual(['w.ts']);
  });

  it('mentionTokensOf — #токены из текста пользователя verbatim', () => {
    expect(mentionTokensOf('посмотри #src/a.ts и #README.md')).toEqual(['src/a.ts', 'README.md']);
    expect(mentionTokensOf('без упоминаний')).toEqual([]);
    expect(mentionTokensOf('#a #a #b')).toEqual(['a', 'b']);
  });

  it('checkpoint_rewound → id→state verbatim', () => {
    const trace = [ev(5, 'checkpoint_rewound', { checkpointId: 'cp-9', state: 'done' })];
    expect(rewoundStatesOf(trace).get('cp-9')).toBe('done');
  });
});

describe('Chat compaction — honest threshold seam', () => {
  it('threshold uses the observed message count and emits one unavailable control', () => {
    expect(isChatCompactionThresholdReached(CHAT_COMPACTION_THRESHOLD_MESSAGES - 1)).toBe(false);
    expect(isChatCompactionThresholdReached(CHAT_COMPACTION_THRESHOLD_MESSAGES)).toBe(true);
    const { rerender } = render(
      <ChatCompactionUnavailable messageCount={CHAT_COMPACTION_THRESHOLD_MESSAGES - 1} compactChat={undefined} />,
    );
    expect(screen.queryByTestId('chat-compaction')).toBeNull();
    rerender(<ChatCompactionUnavailable messageCount={128} compactChat={undefined} />);
    expect(screen.getAllByTestId('chat-compaction')).toHaveLength(1);
    expect(screen.getByTestId('chat-compaction').getAttribute('data-state')).toBe('unavailable');
    expect((screen.getByRole('button', { name: 'Сжать историю' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/POST \/v1\/chat\/compact/)).toBeTruthy();
  });

  it('offers the live seam for a bag of independent run ids (W1-143 run_ids path)', async () => {
    const compactChat = vi.fn();
    const onCompact = vi.fn();
    render(
      <ChatCompactionUnavailable
        messageCount={32}
        compactChat={compactChat}
        compactableRunIds={['root-1', 'root-2']}
        onCompact={onCompact}
      />,
    );
    expect(screen.getByTestId('chat-compaction').getAttribute('data-state')).toBe('ready');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Сжать историю' }));
    expect(onCompact).toHaveBeenCalledOnce();
  });

  it('stays honest when the seam exists but the feed has no runs at all', () => {
    const compactChat = vi.fn();
    render(<ChatCompactionUnavailable messageCount={32} compactChat={compactChat} />);
    expect(screen.getByTestId('chat-compaction').textContent).toContain('нет прогонов');
    expect(compactChat).not.toHaveBeenCalled();
  });

  it('renders a host noop verdict verbatim — not an error, not a fake block', () => {
    render(
      <ChatCompactionUnavailable
        messageCount={32}
        compactChat={vi.fn()}
        status={{ state: 'noop', reason: 'already_compacted', covered: 4, kept: 6 }}
      />,
    );
    const block = screen.getByTestId('chat-compaction');
    expect(block.getAttribute('data-state')).toBe('noop');
    expect(screen.getByRole('status').textContent).toContain('already_compacted');
    expect(screen.getByRole('status').textContent).toContain('покрыто ранее 4, в хвосте 6');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('allows only one terminal root run; independent runs and children stay unavailable', () => {
    expect(compactThreadForChat(['root-1'], {
      runId: 'root-1', parent: null, status: 'done',
    })).toBe('root-1');
    expect(compactThreadForChat(['root-1', 'root-2'], {
      runId: 'root-2', parent: null, status: 'done',
    })).toBeNull();
    expect(compactThreadForChat(['child-1'], {
      runId: 'child-1', parent: 'root-1', status: 'done',
    })).toBeNull();
    expect(compactThreadForChat(['root-1'], {
      runId: 'root-1', parent: null, status: 'running',
    })).toBeNull();
  });

  it('offers a local visual fallback only when older messages exceed the keep-tail', async () => {
    const messages = Array.from({ length: 34 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      runId: index % 2 === 1 ? `run-${Math.floor(index / 2)}` : undefined,
      text: `Текст ${index}`,
      status: 'done' as const,
      ts: 1_729_000_000 + index * 60,
    }));
    const onApply = vi.fn();
    const { rerender } = render(
      <LocalChatCompactionBlock
        messages={messages.slice(0, 32)}
        enabled
        applied={false}
        expanded={false}
        onApply={onApply}
        onToggleExpanded={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('local-chat-compaction')).toBeNull();

    rerender(
      <LocalChatCompactionBlock
        messages={messages}
        enabled
        applied={false}
        expanded={false}
        onApply={onApply}
        onToggleExpanded={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: 'Свернуть старые прогоны в компакт-блок' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('2 сообщений будут скрыты только визуально; локально, без суммаризации.')).toBeTruthy();
    await userEvent.setup().click(button);
    expect(onApply).toHaveBeenCalledOnce();
  });

  it('collapses old rows, reports count/time, and expands to run headers without text', async () => {
    const messages = Array.from({ length: 34 }, (_, index) => ({
      id: index % 2 === 0 ? `u-run-${index / 2}` : `a-run-${Math.floor(index / 2)}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      runId: index % 2 === 1 ? `run-${Math.floor(index / 2)}` : undefined,
      text: `PRIVATE MESSAGE ${index}`,
      status: 'done' as const,
      ts: 1_729_000_000 + index * 60,
    }));
    const hiddenIds = locallyCompactedMessageIds(messages, true);
    expect(hiddenIds).toEqual(new Set(['u-run-0', 'a-run-0']));
    expect(locallyCompactedMessageIds(messages, false)).toEqual(new Set());

    const onToggleExpanded = vi.fn();
    const { rerender } = render(
      <LocalChatCompactionBlock
        messages={messages}
        enabled
        applied
        expanded={false}
        onApply={vi.fn()}
        onToggleExpanded={onToggleExpanded}
      />,
    );
    expect(screen.getByRole('button', { name: /2 сообщений свёрнуто · \d{2}:\d{2}–\d{2}:\d{2}/ }))
      .toBeTruthy();
    expect(screen.getByText('Локально, без суммаризации. Исходные сообщения сохранены.')).toBeTruthy();
    expect(screen.queryByText('PRIVATE MESSAGE 0')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: /2 сообщений свёрнуто/ }));
    expect(onToggleExpanded).toHaveBeenCalledOnce();

    rerender(
      <LocalChatCompactionBlock
        messages={messages}
        enabled
        applied
        expanded
        onApply={vi.fn()}
        onToggleExpanded={onToggleExpanded}
      />,
    );
    expect(screen.getByRole('link', { name: /Задача · run-0/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ответ · run-0/ })).toBeTruthy();
    expect(screen.queryByText('PRIVATE MESSAGE 0')).toBeNull();
  });

  it('expand rows show role, first-80-chars preview and time from real text', () => {
    const longText = `Длинный текст задачи ${'x'.repeat(120)}`;
    const messages = Array.from({ length: 34 }, (_, index) => ({
      id: index % 2 === 0 ? `u-run-${index / 2}` : `a-run-${Math.floor(index / 2)}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      runId: index % 2 === 1 ? `run-${Math.floor(index / 2)}` : undefined,
      text: index === 0 ? longText : `Текст ${index}`,
      status: 'done' as const,
      ts: 1_729_000_000 + index * 60,
    }));
    render(
      <LocalChatCompactionBlock
        messages={messages}
        enabled
        applied
        expanded
        previewOf={(message) => message.text ?? null}
        onApply={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    );
    const row = screen.getByRole('link', { name: /Задача · run-0/ });
    expect(row.textContent).toContain(`«${longText.slice(0, 80)}…»`);
    expect(row.textContent).not.toContain('x'.repeat(121));
  });

  it('busy disables the local apply control and reports compacting honestly', () => {
    const messages = Array.from({ length: 34 }, (_, index) => ({
      id: `m-${index}`,
      role: 'user' as const,
      text: `t${index}`,
      status: 'done' as const,
      ts: 1_729_000_000 + index,
    }));
    render(
      <LocalChatCompactionBlock
        messages={messages}
        enabled
        applied={false}
        expanded={false}
        busy
        onApply={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    );
    expect(screen.getByTestId('local-chat-compaction').getAttribute('aria-busy')).toBe('true');
    expect((screen.getByRole('button', { name: 'Свернуть старые прогоны в компакт-блок' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Сжимаю историю…')).toBeTruthy();
  });

  it('Escape inside the expanded local rows collapses and refocuses the toggle', async () => {
    const user = userEvent.setup();
    const messages = Array.from({ length: 34 }, (_, index) => ({
      id: `m-${index}`,
      role: 'user' as const,
      text: `t${index}`,
      status: 'done' as const,
      ts: 1_729_000_000 + index,
    }));
    function Harness() {
      const [expanded, setExpanded] = useState(true);
      return (
        <LocalChatCompactionBlock
          messages={messages}
          enabled
          applied
          expanded={expanded}
          onApply={vi.fn()}
          onToggleExpanded={() => setExpanded((v) => !v)}
        />
      );
    }
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Скрыть старые прогоны' });
    const list = screen.getByRole('list');
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(await screen.findByRole('button', { name: /сообщений свёрнуто/ })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /сообщений свёрнуто/ }));
    void toggle;
  });

  it('row click scrolls to the still-rendered message instead of navigating', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const messages = Array.from({ length: 34 }, (_, index) => ({
      id: index === 0 ? 'u-run-0' : `m-${index}`,
      role: 'user' as const,
      runId: index === 0 ? 'run-0' : undefined,
      text: `t${index}`,
      status: 'done' as const,
      ts: 1_729_000_000 + index,
    }));
    render(
      <>
        <div data-chat-message-id="u-run-0" tabIndex={-1}>живое сообщение</div>
        <LocalChatCompactionBlock
          messages={messages}
          enabled
          applied
          expanded
          onApply={vi.fn()}
          onToggleExpanded={vi.fn()}
        />
      </>,
    );
    const link = screen.getByRole('link', { name: /Задача · run-0/ });
    await userEvent.setup().click(link);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(document.activeElement?.textContent).toBe('живое сообщение');
  });

  it('enables explicit compaction only for a proven root thread', async () => {
    const onCompact = vi.fn();
    render(
      <ChatCompactionUnavailable
        messageCount={CHAT_COMPACTION_THRESHOLD_MESSAGES}
        compactChat={vi.fn()}
        threadId="root-1"
        onCompact={onCompact}
      />,
    );
    const button = screen.getByRole('button', { name: 'Сжать историю' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await userEvent.setup().click(button);
    expect(onCompact).toHaveBeenCalledOnce();
  });

  it('uses only a real triggered status for progress and renders 409/503 as inline failures', () => {
    const { rerender } = render(
      <ChatCompactionUnavailable
        messageCount={32}
        compactChat={undefined}
        status={{ state: 'triggered' }}
      />,
    );
    expect(screen.getByTestId('chat-compaction').getAttribute('data-state')).toBe('compacting');
    expect(screen.getByText('Сжимаю историю…')).toBeTruthy();

    rerender(
      <ChatCompactionUnavailable
        messageCount={32}
        compactChat={undefined}
        status={{ state: 'failed', statusCode: 503, reason: 'summary model unavailable' }}
      />,
    );
    expect(screen.getByTestId('chat-compaction').getAttribute('data-state')).toBe('failed');
    expect(screen.getByRole('alert').textContent).toContain('HTTP 503');
    expect(screen.getByRole('alert').textContent).toContain('summary model unavailable');

    rerender(
      <ChatCompactionUnavailable
        messageCount={32}
        compactChat={undefined}
        status={{ state: 'failed', statusCode: 409, reason: 'concurrent compact' }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('HTTP 409');
    expect(screen.getByRole('alert').textContent).toContain('concurrent compact');
    rerender(
      <ChatCompactionUnavailable
        messageCount={32}
        compactChat={undefined}
        status={{ state: 'failed', statusCode: 404, reason: 'unknown thread' }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('HTTP 404');
    expect(screen.getByRole('alert').textContent).toContain('unknown thread');
  });

  it('successful compact block animates to summary and retains links for covered refs', async () => {
    render(<ChatCompactBlock compact={{
      compacted: true,
      compactId: 'compact-1',
      threadId: 'run-a',
      summary: 'Сохранённая сводка контекста.',
      coversMessageIds: ['run-a:task', 'run-a:answer', 'run-b:task'],
      keptMessageIds: ['run-b:answer'],
      createdAt: '2026-10-19T12:00:00Z',
    }} />);
    expect(screen.getByText(/Сжатая история · покрыто 3 сообщений/)).toBeTruthy();
    expect(screen.getByText('Сохранённая сводка контекста.')).toBeTruthy();
    expect(screen.getByTestId('chat-compact-created-at').textContent).toContain('Время сжатия');
    expect(screen.getByTitle('Время сжатия').getAttribute('datetime')).toBe('2026-10-19T12:00:00Z');
    await userEvent.setup().click(screen.getByRole('button', { name: /Сжатая история · покрыто/ }));
    expect(screen.getByRole('link', { name: 'run-a:task' }).getAttribute('href')).toBe('/run?id=run-a');
    expect(screen.getByRole('link', { name: 'run-b:task' }).getAttribute('href')).toBe('/run?id=run-b');
  });

  it('collapses by click, expands with Enter/Space, and shows only covered row metadata', async () => {
    const user = userEvent.setup();
    render(<ChatCompactionUnavailable
      messageCount={32}
      compactChat={undefined}
      compact={{
        compacted: true,
        compactId: 'compact-meta',
        threadId: 'run-meta',
        summary: 'Сводка от хоста.',
        coversMessageIds: ['run-meta:task', 'run-meta:answer'],
        keptMessageIds: [],
        createdAt: '2026-10-19T12:00:00Z',
      }}
      chatMessages={[
        {
          id: 'u-run-meta',
          role: 'user',
          text: 'Полный приватный текст задачи не должен показываться в раскрытии.',
          status: 'done',
          ts: 1729000000,
        },
        {
          id: 'a-run-meta',
          role: 'assistant',
          runId: 'run-meta',
          status: 'done',
          ts: 1729000060,
        },
      ]}
    />);

    const toggle = await screen.findByRole('button', { name: /Сжатая история/ });
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('false'));
    expect(screen.getByTestId('chat-compacted-count').textContent).toBe('2 сообщений сжато');

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: /Задача · \d{2}:\d{2}:\d{2}/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ответ · \d{2}:\d{2}:\d{2}/ })).toBeTruthy();
    expect(screen.queryByText(/Полный приватный текст задачи/)).toBeNull();

    await user.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.focus();
    await user.keyboard(' ');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('W3-156: expand shows covered text from coveredText — no seam call, no fabrication', async () => {
    const user = userEvent.setup();
    const loadCoveredText = vi.fn(async () => ({}));
    render(<ChatCompactBlock
      compact={{
        compacted: true,
        compactId: 'compact-w156',
        threadId: 'run-a',
        summary: 'Сводка.',
        coversMessageIds: ['run-a:task', 'run-a:answer'],
        keptMessageIds: [],
        createdAt: '2026-10-19T12:00:00Z',
      }}
      coveredText={{ 'run-a:task': 'текст задачи дословно', 'run-a:answer': 'ответ агента дословно' }}
      loadCoveredText={loadCoveredText}
    />);
    const toggle = await screen.findByRole('button', { name: /Сжатая история/ });
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('false'));
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('текст задачи дословно')).toBeTruthy();
    expect(screen.getByText('ответ агента дословно')).toBeTruthy();
    // Все covered-refs уже в клиенте — seam не трогаем.
    expect(loadCoveredText).not.toHaveBeenCalled();
  });

  it('W3-156: expand lazy-loads only missing refs once; links remain as fallback', async () => {
    const user = userEvent.setup();
    const loadCoveredText = vi.fn(async (refs: readonly string[]) => {
      expect([...refs]).toEqual(['run-b:answer']);
      return { 'run-b:answer': 'подгруженный ответ' };
    });
    render(<ChatCompactBlock
      compact={{
        compacted: true,
        compactId: 'compact-lazy',
        threadId: 'run-a',
        summary: 'Сводка.',
        coversMessageIds: ['run-a:task', 'run-b:answer'],
        keptMessageIds: [],
        createdAt: '2026-10-19T12:00:00Z',
      }}
      coveredText={{ 'run-a:task': 'уже в клиенте' }}
      loadCoveredText={loadCoveredText}
    />);
    const toggle = await screen.findByRole('button', { name: /Сжатая история/ });
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('false'));
    expect(loadCoveredText).not.toHaveBeenCalled();
    await user.click(toggle);
    await waitFor(() => expect(screen.getByText('подгруженный ответ')).toBeTruthy());
    expect(loadCoveredText).toHaveBeenCalledTimes(1);
    // Сворачивание/разворачивание не дублирует запрос.
    await user.click(toggle);
    await user.click(toggle);
    expect(loadCoveredText).toHaveBeenCalledTimes(1);
  });

  it('W3-156: failed lazy load keeps run links and reports status honestly', async () => {
    const user = userEvent.setup();
    const loadCoveredText = vi.fn(async () => { throw new Error('offline'); });
    render(<ChatCompactBlock
      compact={{
        compacted: true,
        compactId: 'compact-err',
        threadId: 'run-a',
        summary: 'Сводка.',
        coversMessageIds: ['run-a:task'],
        keptMessageIds: [],
        createdAt: '2026-10-19T12:00:00Z',
      }}
      loadCoveredText={loadCoveredText}
    />);
    const toggle = await screen.findByRole('button', { name: /Сжатая история/ });
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('false'));
    await user.click(toggle);
    await waitFor(() => expect(screen.getByRole('status').textContent)
      .toContain('Текст части сообщений не загружен'));
    expect(screen.getByRole('link', { name: 'run-a:task' }).getAttribute('href'))
      .toBe('/run?id=run-a');
  });

  it('W3-156: provenance badge marks manual compact only — history cards show none', async () => {
    const compact = {
      compacted: true as const,
      compactId: 'compact-prov',
      threadId: 'run-a',
      summary: 'Сводка.',
      coversMessageIds: ['run-a:task'],
      keptMessageIds: [],
      createdAt: '2026-10-19T12:00:00Z',
    };
    const { unmount } = render(<ChatCompactBlock compact={compact} />);
    expect(screen.queryByTestId('compact-provenance')).toBeNull();
    unmount();
    render(<ChatCompactBlock compact={compact} manual />);
    const badge = screen.getByTestId('compact-provenance');
    expect(badge.textContent).toContain('ВРУЧНУЮ');
  });
});

const baseDs = {} as ProductDataSource;

describe('RunFeedExtras — честные состояния (фикстуры)', () => {
  it('обычный прогон: usage из трейса, без sdk-seam — без запросов', () => {
    // FIXTURE: final.usage с реальными полями.
    const trace = [ev(9, 'final', { usage: { tokens: 1234, cost_usd: 0.05 } })];
    render(<RunFeedExtras runId="run-1" trace={trace} live={false} ds={baseDs} />);
    // runUsageOf должен дать значения → метр рендерится.
    const meter = screen.queryByTestId('usage-meter');
    expect(meter).toBeTruthy();
    expect(screen.getByText('1 234')).toBeTruthy();
    expect(screen.getByText('$0.0500')).toBeTruthy();
  });

  it('sdk-прогон без seam: метр «нет данных», чекпоинты «недоступно»', async () => {
    render(<RunFeedExtras runId="sdk-77" trace={[]} live={false} ds={baseDs} />);
    await waitFor(() => expect(screen.getByText('Чекпоинты недоступны — seam хоста не подключён.')).toBeTruthy());
    expect(screen.getAllByText('нет данных').length).toBeGreaterThan(0);
  });

  it('sdk-прогон: usage и манифесты чекпоинтов из seam, откат — заявкой', async () => {
    // FIXTURE: ответы W1 verbatim-формы.
    const usage = vi.fn().mockResolvedValue({
      runId: 'sdk-1', sessionId: 's1', model: 'm',
      inputTokens: 100, outputTokens: 50, cacheReadTokens: null,
      cacheCreationTokens: null, totalCostUsd: 0.012,
      durationMs: 1000, durationApiMs: null, numTurns: 2,
      contextFill: 0.4, modelUsage: null,
    });
    const list = vi.fn().mockResolvedValue([{
      id: 'cp-1', runId: 'sdk-1', callId: 'c1', tool: 'Write',
      root: '/w', createdAt: '2026-10-16T10:00:00Z',
      files: [{ path: 'a.ts', sha256: 'x', size: 10, mtime: 1, existed: true }],
    }]);
    const rewind = vi.fn().mockResolvedValue({ callId: 'rewind-cp-1', tool: 'rewind', state: 'awaiting' });
    const ds = { ...baseDs, sdkRunUsage: usage, sdkCheckpoints: { list, rewind } } as ProductDataSource;
    render(<RunFeedExtras runId="sdk-1" trace={[]} live={false} ds={ds} />);
    // usage: 100+50=150 токенов; контекст 40/100.
    await waitFor(() => expect(screen.getByText('150')).toBeTruthy());
    expect(screen.getByText('$0.0120')).toBeTruthy();
    expect(screen.getByText('40 / 100')).toBeTruthy();
    // маркер чекпоинта + откат → POST заявки (не локальный откат).
    await waitFor(() => expect(screen.getByTestId('checkpoint-marker')).toBeTruthy());
    await userEvent.click(screen.getByLabelText('Откатить к чекпоинту cp-1'));
    await waitFor(() => expect(rewind).toHaveBeenCalledWith('sdk-1', 'cp-1'));
    await waitFor(() => expect(screen.getByText(/Заявка на откат cp-1 открыта/)).toBeTruthy());
  });

  it('checkpoint_rewound в трейсе → маркер «восстановлено»', async () => {
    const list = vi.fn().mockResolvedValue([{
      id: 'cp-2', runId: 'sdk-2', callId: null, tool: null,
      root: null, createdAt: null, files: [],
    }]);
    const ds = {
      ...baseDs,
      sdkRunUsage: vi.fn().mockResolvedValue({
        runId: 'sdk-2', sessionId: null, model: null, inputTokens: null,
        outputTokens: null, cacheReadTokens: null, cacheCreationTokens: null,
        totalCostUsd: null, durationMs: null, durationApiMs: null,
        numTurns: null, contextFill: null, modelUsage: null,
      }),
      sdkCheckpoints: { list, rewind: vi.fn() },
    } as ProductDataSource;
    const trace = [ev(3, 'checkpoint_rewound', { checkpointId: 'cp-2', state: 'done' })];
    render(<RunFeedExtras runId="sdk-2" trace={trace} live={false} ds={ds} />);
    await waitFor(() => {
      const m = screen.getByTestId('checkpoint-marker');
      expect(m.getAttribute('data-state')).toBe('restored');
    });
    // usage все null → «нет данных», не нули.
    expect(screen.getAllByText('нет данных').length).toBe(3);
  });

  it('сбой seam → честная ошибка verbatim, без фейковых строк', async () => {
    const ds = {
      ...baseDs,
      sdkRunUsage: vi.fn().mockRejectedValue(new Error('HTTP 503: SDK-канал выключен')),
      sdkCheckpoints: { list: vi.fn().mockRejectedValue(new Error('HTTP 503')), rewind: vi.fn() },
    } as ProductDataSource;
    render(<RunFeedExtras runId="sdk-3" trace={[]} live={false} ds={ds} />);
    await waitFor(() => expect(screen.getByText(/Чекпоинты недоступны: HTTP 503/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/Учёт SDK недоступен: HTTP 503/)).toBeTruthy());
  });

  it('критик-чекпоинт /v1/runs → маркер «откат недоступен»', () => {
    // FIXTURE: checkpoint-событие критика {name, passed}.
    const trace = [ev(4, 'checkpoint', { name: 'проверка ответа', passed: true })];
    render(<RunFeedExtras runId="run-9" trace={trace} live={false} ds={baseDs} />);
    const m = screen.getByTestId('checkpoint-marker');
    expect(m.getAttribute('data-state')).toBe('unavailable');
    expect(m.textContent).toContain('проверка «проверка ответа» — пройдена');
  });

  it('диффы рендерятся из трейса; пути чтения в пузырь не попадают', () => {
    const trace = [
      ev(1, 'tool_call', { tool: 'write_file', input: { path: 'src/x.ts' }, result: { diff: '+a\n+b\n-c' } }),
      ev(2, 'tool_call', { tool: 'read_file', input: { path: 'src/y.ts' }, result: 'ok' }),
    ];
    render(<RunFeedExtras runId="run-5" trace={trace} live={false} ds={baseDs} />);
    expect(screen.getByTestId('diff-review-card')).toBeTruthy();
    // +2/−1 встречаются в сводке и в строке файла.
    expect(screen.getAllByText('+2').length).toBe(2);
    expect(screen.getAllByText('−1').length).toBe(2);
    // Контракт аудита: путь read-операции в пузыре не показывается.
    expect(screen.getByTestId('run-feed-extras').textContent).not.toContain('src/y.ts');
  });
});
