// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
  usePathname: () => '/run',
  useSearchParams: () => new URLSearchParams('id=run-1039'),
}));

const getRunDetail = vi.fn();
const listRuns = vi.fn();
const listAgents = vi.fn();
const startRun = vi.fn();
const _ds = { getRunDetail, listRuns, listAgents, startRun };
vi.mock('../data-source', () => ({
  getDataSource: () => _ds,
  useDataSource: () => _ds,
}));

import { RunScreen } from './run';

const detail = {
  run: {
    runId: 'run-1039', taskText: 'Собрать отчёт', config: 'baseline',
    status: 'done' as const, stopReason: 'done', agent: 'coder', parent: null,
    project: 'nexus', model: null, costUsd: 0.214, createdAt: 1, finishedAt: 188,
  },
  result: null,
  events: [],
};

describe('RunScreen — context sources (W3-07)', () => {
  beforeEach(() => {
    getRunDetail.mockReset();
    listRuns.mockReset();
    listAgents.mockReset();
    startRun.mockReset();
    push.mockReset();
    getRunDetail.mockResolvedValue(detail);
    listRuns.mockResolvedValue([]);
  });

  it('renders agent/project context links and honest-unavailable files row', async () => {
    render(<RunScreen />);
    const ctx = await screen.findByTestId('run-context');
    await waitFor(() => expect(ctx.getAttribute('data-state')).toBe('ready'));
    expect(ctx.textContent).toContain('coder');
    expect(ctx.textContent).toContain('nexus');
    // No file seam → unavailable, never a fabricated link
    const filesRow = ctx.querySelector('[data-state="unavailable"]');
    expect(filesRow?.textContent).toContain('источник файлов не подключён');
  });

  it('history links to sibling runs of the same agent', async () => {
    listRuns.mockResolvedValue([
      detail.run,
      { ...detail.run, runId: 'run-1040', taskText: 'Другой прогон' },
    ]);
    const user = userEvent.setup();
    render(<RunScreen />);

    const ctx = await screen.findByTestId('run-context');
    await waitFor(() => expect(ctx.textContent).toContain('run-1040'));
    expect(ctx.textContent).not.toContain('run-1039 ·');
    expect(listRuns).toHaveBeenCalledWith(expect.objectContaining({ agent: 'coder' }));

    await user.click(screen.getByRole('button', { name: 'run-1040' }));
    expect(push).toHaveBeenCalledWith('/run?id=run-1040');
  });

  it('history failure → error state + working retry', async () => {
    listRuns.mockRejectedValueOnce(new Error('down')).mockResolvedValue([]);
    const user = userEvent.setup();
    render(<RunScreen />);

    const ctx = await screen.findByTestId('run-context');
    await waitFor(() => expect(ctx.getAttribute('data-state')).toBe('error'));
    await user.click(screen.getByRole('button', { name: /повторить/i }));
    // wave-2: семейство прогона добавляет второй listRuns-вызов (parent-запрос)
    // — считаем только выборку истории (agent-фильтр).
    await waitFor(() => expect(
      listRuns.mock.calls.filter(([o]) => (o as { agent?: unknown })?.agent === 'coder').length,
    ).toBe(2));
    await waitFor(() => expect(ctx.getAttribute('data-state')).toBe('ready'));
  });

  it('does not send an unregistered handoff target as run agent', async () => {
    getRunDetail.mockResolvedValue({
      ...detail,
      run: { ...detail.run, agent: 'analyst-wave2' },
      result: {
        ...detail.run,
        answer: 'готово',
        score: null,
        verified: null,
        durationS: null,
        usage: { modelCalls: 0, toolCalls: 0, tokens: 0, costUsd: 0 },
      },
    });
    listAgents.mockResolvedValue([{
      name: 'analyst-wave2',
      handoffs: [{ label: 'Передать AGENT-A', agent: 'alice', prompt: 'Продолжи задачу', send: true }],
    }]);
    startRun.mockResolvedValue({ runId: 'run-handoff' });
    const user = userEvent.setup();
    render(<RunScreen />);
    await user.click(await screen.findByRole('button', { name: 'Передать AGENT-A' }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      task: 'Продолжи задачу',
      config: 'baseline',
    }));
    expect(startRun.mock.calls[0][0]).not.toHaveProperty('agent');
    expect(startRun.mock.calls[0][0]).not.toHaveProperty('mode');
  });
});

describe('RunScreen — семейство прогона (wave-2 W3-1)', () => {
  beforeEach(() => {
    getRunDetail.mockReset();
    listRuns.mockReset();
    getRunDetail.mockResolvedValue(detail);
    // history (agent-фильтр) и children (parent-фильтр) — раздельные выборки
    listRuns.mockImplementation((opts?: { parent?: string }) =>
      Promise.resolve(opts?.parent != null ? [] : []));
  });

  it('parent-линк + children через listRuns({parent})', async () => {
    getRunDetail.mockResolvedValue({
      ...detail,
      run: { ...detail.run, parent: 'parent9999aaaa' },
    });
    listRuns.mockImplementation((opts?: { parent?: string }) =>
      Promise.resolve(opts?.parent === 'run-1039'
        ? [{ ...detail.run, runId: 'child1111bbbb', status: 'done' as const, parent: 'run-1039' }]
        : []));

    render(<RunScreen />);
    const fam = await screen.findByTestId('run-family');
    await waitFor(() => expect(fam.getAttribute('data-state')).toBe('ready'));

    const parentLink = within(fam).getByRole('link', { name: /parent9999/ });
    expect(parentLink.getAttribute('href')).toBe('/run?id=parent9999aaaa');
    const childLink = within(fam).getByRole('link', { name: /child1111/ });
    expect(childLink.getAttribute('href')).toBe('/run?id=child1111bbbb');
    expect(listRuns).toHaveBeenCalledWith(expect.objectContaining({ parent: 'run-1039' }));
  });

  it('spawn-событие → пометка «субагент sub-N»', async () => {
    getRunDetail.mockResolvedValue({
      ...detail,
      events: [{ seq: 0, type: 'spawn', role: null, ts: 1, body: { parent_run_id: 'p1', handle: 'sub-2' } }],
    });
    render(<RunScreen />);
    const fam = await screen.findByTestId('run-family');
    await waitFor(() => expect(fam.textContent).toContain('этот прогон — субагент sub-2'));
  });

  it('без родителя и детей панель не показывается', async () => {
    render(<RunScreen />);
    await screen.findByTestId('run-context');
    await waitFor(() => expect(listRuns).toHaveBeenCalledWith(expect.objectContaining({ parent: 'run-1039' })));
    await waitFor(() => expect(screen.queryByTestId('run-family')).toBeNull());
  });

  it('children seam упал → error + retry', async () => {
    getRunDetail.mockResolvedValue({
      ...detail,
      run: { ...detail.run, parent: 'parent9999aaaa' },
    });
    let calls = 0;
    listRuns.mockImplementation((opts?: { parent?: string }) => {
      if (opts?.parent === 'run-1039') {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('down')) : Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    render(<RunScreen />);

    const fam = await screen.findByTestId('run-family');
    await waitFor(() => expect(fam.getAttribute('data-state')).toBe('error'));
    await user.click(within(fam).getByRole('button', { name: /повторить/i }));
    await waitFor(() => expect(calls).toBe(2));
  });
});

describe('RunScreen — R-W3.2 граф сообщений семьи', () => {
  const child = { ...detail.run, runId: 'child1111bbbb', status: 'done' as const, parent: 'run-1039' };

  beforeEach(() => {
    getRunDetail.mockReset();
    listRuns.mockReset();
    listRuns.mockImplementation((opts?: { parent?: string }) =>
      Promise.resolve(opts?.parent === 'run-1039' ? [child] : []));
  });

  it('send_message дочернего → ребро к корню в MessageGraph', async () => {
    getRunDetail.mockImplementation((id: string) => Promise.resolve(
      id === 'child1111bbbb'
        ? {
            ...detail, run: child,
            events: [
              { seq: 0, type: 'spawn', role: null, ts: 1, body: { parent_run_id: 'run-1039', handle: 'sub-1' } },
              { seq: 2, type: 'tool_call', role: null, ts: 1700000005, body: { tool: 'send_message', input: { agent: 'parent', text: 'готово' } } },
            ],
          }
        : detail));
    render(<RunScreen />);
    const graph = await screen.findByTestId('run-message-graph');
    expect(graph.querySelector('[data-node="run-1039"]')).toBeTruthy();
    expect(graph.querySelector('[data-node="child1111bbbb"]')).toBeTruthy();
    expect(graph.querySelector('[data-edge="child1111bbbb->run-1039"]')).toBeTruthy();
  });

  it('дети есть, send_message нет → честная строка «не наблюдалось»', async () => {
    getRunDetail.mockResolvedValue({ ...detail, run: { ...detail.run, parent: null } });
    render(<RunScreen />);
    await waitFor(() => expect(screen.findByTestId('run-message-empty')).toBeTruthy());
    expect(await screen.findByTestId('run-message-empty')).toBeTruthy();
    expect(screen.queryByTestId('run-message-graph')).toBeNull();
  });
});

describe('RunScreen — wave-XI W4 «Траектория прогона»', () => {
  beforeEach(() => {
    getRunDetail.mockReset();
    listRuns.mockReset();
    listRuns.mockResolvedValue([]);
  });

  it('tool_call+tool_result трейса → карточки шкалы с длительностью', async () => {
    getRunDetail.mockResolvedValue({
      ...detail,
      events: [
        { seq: 1, type: 'run.start', role: null, ts: 1700000000, body: { task: 'x' } },
        { seq: 2, type: 'tool_call', role: 'executor', ts: 1700000005, body: { tool: 'memory_search', input: { k: 5 } } },
        { seq: 3, type: 'tool_result', role: 'executor', ts: 1700000007, body: { tool: 'memory_search', hits: 4 } },
        { seq: 4, type: 'tool_call', role: 'executor', ts: 1700000010, body: { tool: 'read_file', input: { path: 'a.md' }, result: 'ok', is_error: false } },
      ],
    });
    render(<RunScreen />);
    const panel = await screen.findByTestId('run-trajectory-panel');
    const calls = await within(panel).findAllByTestId('trajectory-call');
    expect(calls).toHaveLength(2);
    expect(within(calls[0]).getByText('memory_search')).toBeTruthy();
    expect(within(calls[0]).getByText('2,0 с')).toBeTruthy(); // ts-разница 5→7
    expect(within(calls[0]).getByText('ГОТОВО')).toBeTruthy();
    expect(within(calls[1]).getByText('read_file')).toBeTruthy();
  });

  it('вызов без результата → честный «НЕТ РЕЗУЛЬТАТА», сирота поднимается в корень', async () => {
    getRunDetail.mockResolvedValue({
      ...detail,
      events: [
        { seq: 1, type: 'tool_call', role: 'executor', ts: 1700000000, body: { tool: 'wait_agent', input: { handle: 'sub-1' }, parent_call_id: 'gone' } },
      ],
    });
    render(<RunScreen />);
    const panel = await screen.findByTestId('run-trajectory-panel');
    expect(await within(panel).findByText('НЕТ РЕЗУЛЬТАТА')).toBeTruthy();
    expect(await within(panel).findByText(/родительский вызов gone вне этого трейса/)).toBeTruthy();
  });

  it('пустой трейс → честное «нет данных», без выдуманной шкалы', async () => {
    getRunDetail.mockResolvedValue({ ...detail, events: [] });
    render(<RunScreen />);
    const panel = await screen.findByTestId('run-trajectory-panel');
    expect(await within(panel).findByText(/Трейс прогона не сохранён/)).toBeTruthy();
    expect(within(panel).queryByTestId('trajectory-call')).toBeNull();
  });
});
