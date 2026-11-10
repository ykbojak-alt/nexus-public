// @vitest-environment jsdom
import {
  busDelegateTask, busGetDelegation, busListSessions, checkpointRun, fsApprove,
  fsDeny, fsRequests, fsValidate, getMetrics, getRunControls, getRunDetail,
  getUsage, listAgents, listApprovals, listModels, listPresence, listRuns,
  listToolConfirmations, navSearch, pauseRun, previewRunPlan, replayRun,
  respondApproval, respondToolConfirmation, resumeRun, retryRun,
  sceneGetState, seams, startRun, streamRun, voiceSpeak, voiceStt,
  voiceTranscribe,
} from './test-harness';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeScreen } from '../runtime';
import { ApiToastProvider } from '../../api-toast';
import { resetProfileStore, updateProfile } from '../../profile/profile-store';

// Композитор и ввод «Процесса»: отправка, plan preview, freeze, память,
// семантика списка, ?run= прицеп — выделено из runtime.test.tsx.

describe('RuntimeScreen composer (NQ-051)', () => {
  it('startRun rejection restores the button and shows an alert', { timeout: 15000 }, async () => {
    startRun.mockRejectedValue(new Error('runtime offline'));
    const user = userEvent.setup();
    render(<RuntimeScreen />);

    await user.type(screen.getByRole('textbox', { name: 'Текст задачи' }), 'Задача упадёт');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Не удалось запустить прогон/);
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Запустить' }) as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('successful startRun wires the created run into the live panel', async () => {
    startRun.mockResolvedValue({
      runId: 'run-9001',
      taskText: 'Живая задача',
      config: 'baseline',
      status: 'running',
      stopReason: null,
      agent: null,
      parent: null,
      project: 'nexus',
      model: null,
      costUsd: null,
      createdAt: 1,
      finishedAt: null,
    });
    const user = userEvent.setup();
    render(<RuntimeScreen />);

    await user.type(screen.getByRole('textbox', { name: 'Текст задачи' }), 'Живая задача');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));

    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));
    expect((await screen.findByTestId('live-run')).textContent).toContain('run-9001');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});


describe('RuntimeScreen plan preview (W3-02)', () => {
  it('renders unavailable when the source has no plan seam — nothing fabricated', async () => {
    render(<RuntimeScreen />);
    const card = await screen.findByTestId('plan-card');
    expect(card.getAttribute('data-state')).toBe('unavailable');
    expect(card.textContent).toContain('не предоставляет планировщик');
  });

  it('renders stages/tools/limits derived by the source', async () => {
    seams.plan = true;
    previewRunPlan.mockResolvedValue({
      goal: 'Собрать отчёт',
      stages: [
        { id: 'plan', label: 'План', agent: null },
        { id: 'exec', label: 'Исполнение', agent: 'coder' },
      ],
      workspace: 'nexus',
      tools: ['files', 'shell'],
      limits: { maxCostUsd: 2.5, maxDurationS: null },
      approvalsPlanned: true,
    });
    const user = userEvent.setup();
    render(<RuntimeScreen />);

    await user.type(screen.getByRole('textbox', { name: 'Текст задачи' }), 'Собрать отчёт');
    const card = await screen.findByTestId('plan-card');
    await waitFor(() => expect(card.getAttribute('data-state')).toBe('ready'));
    expect(card.textContent).toContain('Исполнение · coder');
    expect(card.textContent).toContain('files · shell');
    expect(card.textContent).toContain('≤ $2.50');
    expect(card.textContent).toContain('потребуют подтверждений');
    expect(previewRunPlan).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'Собрать отчёт' }),
    );
  });
});


describe('RuntimeScreen freeze flag (NQ-073)', () => {
  const running = {
    runId: 'run-1042', taskText: 'Живой прогон', config: 'baseline',
    status: 'running' as const, stopReason: null, agent: 'coder', parent: null,
    project: 'nexus', model: null, costUsd: null, createdAt: 1, finishedAt: null,
  };

  it('?freeze=1 attaches the run but never opens the event stream', async () => {
    navSearch.raw = 'tab=process&freeze=1';
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    render(<RuntimeScreen />);
    // Run panel still shows the attached running run — only the simulator halts.
    await screen.findByText('Живой прогон');
    await waitFor(() => expect(listRuns).toHaveBeenCalledWith({ limit: 20 }));
    await act(async () => { });
    expect(streamRun).not.toHaveBeenCalled();
  });

  it('without the flag the running run opens the event stream', async () => {
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    render(<RuntimeScreen />);
    await screen.findByText('Живой прогон');
    await waitFor(() =>
      expect(streamRun).toHaveBeenCalledWith('run-1042', expect.objectContaining({ onEvent: expect.any(Function) })),
    );
  });
});


describe('RuntimeScreen project memory (M2)', () => {
  const running = {
    runId: 'run-9', taskText: 'сделай отчёт', config: 'baseline',
    status: 'running' as const, stopReason: null, agent: 'coder', parent: null,
    project: 'nexus', model: null, costUsd: null, createdAt: 100, finishedAt: null,
  };

  afterEach(() => {
    resetProfileStore();
    globalThis.localStorage?.clear();
  });

  const submit = async (text: string) => {
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    await user.type(await screen.findByLabelText('Текст задачи'), text);
    await user.click(screen.getByRole('button', { name: 'Запустить' }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));
    return startRun.mock.calls[0][0] as Record<string, unknown>;
  };

  it('profile memory ON (default post-M1) sends useMemory+project together (host validator pair)', async () => {
    updateProfile({ useMemory: true });
    startRun.mockResolvedValue(running);
    const sent = await submit('что в AGENTS.md?');
    expect(sent.useMemory).toBe(true);
    expect(sent.project).toBe('ai2'); // profile default — never sent alone
  });

  it('memory OFF sends neither field — project never travels alone', async () => {
    // Default flipped to true after M1 (corpus seeded + live retrieval
    // verified) — OFF must be set explicitly, never relied on by absence.
    updateProfile({ useMemory: false });
    startRun.mockResolvedValue(running);
    const sent = await submit('обычная задача');
    expect(sent.useMemory).toBeUndefined();
    expect(sent.project).toBeUndefined();
  });

  it('custom memoryProject from the profile wins over the default', async () => {
    updateProfile({ useMemory: true, memoryProject: 'corp-docs' });
    startRun.mockResolvedValue(running);
    const sent = await submit('вопрос про корпус');
    expect(sent.useMemory).toBe(true);
    expect(sent.project).toBe('corp-docs');
  });

  it('does not send an unregistered profile agent to the host', async () => {
    updateProfile({ defaultRunAgent: 'alice' });
    listAgents.mockResolvedValue([{ name: 'analyst-wave2' }] as never);
    startRun.mockResolvedValue(running);
    const sent = await submit('задача без зарегистрированного исполнителя');
    expect(sent.agent).toBeNull();
  });

  it('«память» tag appears only when memory_search actually ran in the trace', async () => {
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    let emit: ((e: unknown) => void) | null = null;
    streamRun.mockImplementation((_id?: string, cb?: { onEvent: (e: unknown) => void }) => {
      emit = cb!.onEvent;
      return () => { };
    });
    render(<RuntimeScreen />);
    const bubble = await screen.findByTestId('live-run');
    // The stream subscription lands an effect pass after the bubble mounts —
    // wait for it explicitly, never emit into a null socket.
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    // No retrieval yet — the request flag alone never earns the tag.
    expect(within(bubble).queryByText('память', { selector: 'span' })).toBeNull();
    await act(async () => {
      emit!({ seq: 1, type: 'run.start', role: 'ядро', ts: 101, body: {} });
    });
    expect(within(bubble).queryByText('память', { selector: 'span' })).toBeNull();
    await act(async () => {
      emit!({
        seq: 2, type: 'tool_call', role: 'executor', ts: 102,
        body: { tool: 'memory_search', retrieval_scores: [0.71, 0.55] },
      });
    });
    expect(within(bubble).getByText('память', { selector: 'span' }).getAttribute('data-static')).toBe('true');
  });
});


describe('RuntimeScreen chat list semantics (NQ-076a)', () => {
  it('role=log lives on the wrapper — <ol> keeps implicit list, <li> are listitems', async () => {
    startRun.mockResolvedValue({
      runId: 'run-9', taskText: 'привет', config: 'baseline',
      status: 'running' as const, stopReason: null, agent: null, parent: null,
      project: 'nexus', model: null, costUsd: null, createdAt: 100, finishedAt: null,
    });
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    await user.type(await screen.findByLabelText('Текст задачи'), 'привет');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));

    const log = await screen.findByRole('log', { name: 'Диалог с AGENT-A' });
    const list = within(log).getByRole('list');
    // The <ol> must carry NO explicit role — role=log on the list itself
    // strips listitem semantics from every <li> (the axe failure this fixes).
    expect(list.tagName).toBe('OL');
    expect(list.getAttribute('role')).toBeNull();
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
  });

  it('empty chat renders the honest empty state inside the log region — no bare <ol>', async () => {
    render(<RuntimeScreen />);
    const log = await screen.findByRole('log', { name: 'Диалог с AGENT-A' });
    expect(log.textContent).toContain('Диалог пуст');
    expect(within(log).queryByRole('list')).toBeNull();
  });
});


describe('RuntimeScreen ?run= attach (ref-parity P-1)', () => {
  it('прицеп запрошенного прогона вне top-20: detail.run + ответ verbatim', async () => {
    seams.detail = true;
    navSearch.raw = 'tab=process&run=req0001';
    const requested = {
      runId: 'req0001', taskText: 'задача с главной', config: 'deliberate',
      status: 'done' as const, stopReason: null, agent: null, parent: null,
      project: 'nexus', model: null, costUsd: null, createdAt: 100, finishedAt: 200,
    };
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [] : []));
    getRunDetail.mockResolvedValue({
      run: requested,
      result: { ...requested, answer: 'Готово по запрошенному прогону.', score: null, verified: null, durationS: null, usage: null },
      events: [],
    });
    render(<RuntimeScreen />);
    await waitFor(() => expect(getRunDetail).toHaveBeenCalledWith('req0001'));
    expect(await screen.findByText('задача с главной')).toBeTruthy();
    expect(await screen.findByText('Готово по запрошенному прогону.')).toBeTruthy();
    navSearch.raw = 'tab=process';
  });

  it('W3-163: живой прогон по ?run= открывает SSE-подписку', async () => {
    seams.detail = true;
    navSearch.raw = 'tab=process&run=run-live';
    const live = {
      runId: 'run-live', taskText: 'живой запрос', config: 'baseline',
      status: 'running' as const, stopReason: null, agent: null, parent: null,
      project: 'nexus', model: null, costUsd: null, createdAt: 100, finishedAt: null,
    };
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [live] : []));
    render(<RuntimeScreen />);
    await screen.findByText('живой запрос');
    // Подписка на живой прогон открыта — не только история.
    await waitFor(() => expect(streamRun).toHaveBeenCalledWith('run-live', expect.anything()));
    navSearch.raw = 'tab=process';
  });

  it('W3-163: несуществующий прогон → честная 404-панель + ссылка на список', async () => {
    seams.detail = true;
    navSearch.raw = 'tab=process&run=run-nope';
    listRuns.mockResolvedValue([]);
    getRunDetail.mockResolvedValue(null); // seam верифицировал отсутствие
    render(<RuntimeScreen />);
    await waitFor(() => expect(getRunDetail).toHaveBeenCalledWith('run-nope'));
    const empty = await screen.findByTestId('empty-state');
    expect(empty.textContent).toContain('Прогон run-nope не найден');
    const link = within(empty).getByRole('link');
    expect(link.getAttribute('href')).toBe('/runs');
    navSearch.raw = 'tab=process';
  });
});


/**
 * Ключ идемпотентности живёт ровно столько, сколько живёт ТЕЛО запроса:
 * хост хеширует тело и отвечает 409, если ключ повторён с другим телом.
 * Ретрай из тоста после правки тела (модель/контур/контекст) обязан получить
 * НОВЫЙ ключ; ретрай с неприкосновенным телом — тот же ключ (это ретрай,
 * а не новый прогон).
 */
describe('RuntimeScreen idempotency key (409-контракт хоста)', () => {
  afterEach(() => {
    resetProfileStore();
    globalThis.localStorage?.clear();
  });

  const keyOf = (call: number): string | undefined =>
    (startRun.mock.calls[call]?.[0] as { idempotencyKey?: string } | undefined)?.idempotencyKey;

  /** Первый клик падает — оболочка показывает тост с действием «Повторить». */
  const failedStart = async (): Promise<ReturnType<typeof userEvent.setup>> => {
    startRun.mockRejectedValue(new Error('runtime offline'));
    const user = userEvent.setup();
    render(
      <ApiToastProvider>
        <RuntimeScreen />
      </ApiToastProvider>,
    );
    await user.type(await screen.findByLabelText('Текст задачи'), 'задача для ретрая');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));
    return user;
  };

  it('повтор из тоста после смены модели → новый ключ (иначе 409 у хоста)', async () => {
    const user = await failedStart();
    const first = keyOf(0);
    expect(first, 'первый клик без ключа — хост не отличит ретрай').toBeTruthy();

    // Модель сменилась после ошибки — тело прогона изменилось.
    act(() => { updateProfile({ defaultModelId: 'model-b' }); });
    await user.click(await screen.findByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(2));

    const second = keyOf(1);
    expect(second).toBeTruthy();
    expect(second, 'ключ переиспользован при изменённом теле — хост ответит 409').not.toBe(first);
    // Тело действительно изменилось — новая модель уехала на провод.
    expect((startRun.mock.calls[1][0] as { model?: string | null }).model).toBe('model-b');
  });

  it('повтор из тоста после смены контура → новый ключ', async () => {
    const user = await failedStart();
    const first = keyOf(0);

    act(() => { updateProfile({ defaultPreset: 'deep' }); });
    await user.click(await screen.findByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(2));

    expect(keyOf(1)).not.toBe(first);
    expect((startRun.mock.calls[1][0] as { config?: string }).config).toBe('deep');
  });

  it('повтор с абсолютно неизменным телом → тот же ключ (ретрай, а не новый прогон)', async () => {
    const user = await failedStart();
    const first = keyOf(0);
    expect(first).toBeTruthy();

    await user.click(await screen.findByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(2));

    expect(keyOf(1), 'ретрай без правок обязан сохранить ключ').toBe(first);
  });

  it('после успешного старта следующий клик получает новый ключ', async () => {
    startRun.mockResolvedValue({
      runId: 'run-key-1', taskText: 'задача', config: 'baseline',
      status: 'done' as const, stopReason: null, agent: null, parent: null,
      project: 'nexus', model: null, costUsd: null, createdAt: 1, finishedAt: 2,
    });
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    await user.type(await screen.findByLabelText('Текст задачи'), 'задача');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));
    const first = keyOf(0);
    expect(first).toBeTruthy();

    // Тот же текст, но прошлый прогон уже создан — ключ отработал, а тело
    // проговаря выросло контекстом диалога.
    await user.type(await screen.findByLabelText('Текст задачи'), 'задача');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(2));
    expect(keyOf(1)).not.toBe(first);
  });
});
