// @vitest-environment jsdom
import {
  busDelegateTask, busGetDelegation, busListSessions, cancelRun, checkpointRun, fsApprove,
  fsDeny, fsRequests, fsValidate, getMetrics, getRunControls, getRunDetail,
  getUsage, listAgents, listApprovals, listModels, listPresence, listRuns,
  listToolConfirmations, navSearch, pauseRun, previewRunPlan, replayRun,
  respondApproval, respondToolConfirmation, resumeRun, retryRun,
  sceneGetState, seams, startRun, streamRun, voiceSpeak, voiceStt,
  voiceTranscribe,
} from './runtime/test-harness';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalsPanel, DigestCard, RunOpsPanel, contourBlocks, humanizeDraft } from './runtime-ops';

// Панели runtime-ops (Approvals/RunOps/Digest) и чистые хелперы трейса —
// выделено из runtime.test.tsx (сплит wave-XVI).

describe('RuntimeScreen approvals (O7)', () => {
  const pending = {
    approvalId: 'ap-01',
    runId: 'run-1042',
    action: 'tool_call: file.write',
    scope: 'fs:write D:\\nexus\\reports',
    detail: 'Запись отчёта прогона в рабочую папку',
    status: 'pending' as const,
    requestedAt: 1,
    decidedAt: null,
  };

  it('renders a pending approval; approve moves it to the decisions trail verbatim', async () => {
    listApprovals.mockResolvedValue([pending]);
    respondApproval.mockResolvedValue({ ...pending, status: 'approved', decidedAt: 2 });
    const user = userEvent.setup();
    render(<ApprovalsPanel />);

    const panel = await screen.findByTestId('approvals-panel');
    await waitFor(() => expect(panel.textContent).toContain('tool_call: file.write'));
    expect(panel.textContent).toContain('fs:write D:\\nexus\\reports');

    await user.click(screen.getByRole('button', { name: 'Разрешить' }));
    await waitFor(() => expect(respondApproval).toHaveBeenCalledWith('ap-01', 'approve'));
    // Backend response becomes a read-only trail row — buttons gone, status verbatim.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Разрешить' })).toBeNull());
    const row = await screen.findByTestId('decision-ap-01');
    expect(row.textContent).toContain('approved');
    expect(panel.textContent).toContain('Недавние решения');
  });

  it('focus restore (W3-04): decided row unmounts — focus lands on next pending action, else panel title', async () => {
    const second = { ...pending, approvalId: 'ap-02', action: 'tool_call: shell.exec' };
    listApprovals.mockResolvedValue([pending, second]);
    respondApproval.mockImplementation(async (id: string) =>
      id === 'ap-01' ? { ...pending, status: 'approved', decidedAt: 2 } : { ...second, status: 'approved', decidedAt: 3 },
    );
    const user = userEvent.setup();
    render(<ApprovalsPanel />);

    await screen.findByTestId('approval-ap-01');
    const firstApprove = screen.getAllByRole('button', { name: 'Разрешить' })[0] as HTMLButtonElement;
    firstApprove.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(respondApproval).toHaveBeenCalledWith('ap-01', 'approve'));

    // Row ap-01 left the queue — focus must not die to <body>.
    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.tagName).toBe('BUTTON');
      expect(screen.getByTestId('approval-ap-02').contains(active)).toBe(true);
    });

    // Draining the queue lands focus on the panel title (tabIndex=-1).
    await user.keyboard('{Enter}');
    await waitFor(() => expect(respondApproval).toHaveBeenCalledWith('ap-02', 'approve'));
    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.textContent).toBe('Подтверждения');
    });
  });

  it('Esc on a pending row moves focus to the panel title (escape hatch)', async () => {
    listApprovals.mockResolvedValue([pending]);
    const user = userEvent.setup();
    render(<ApprovalsPanel />);

    await screen.findByTestId('approval-ap-01');
    (screen.getByRole('button', { name: 'Разрешить' }) as HTMLButtonElement).focus();
    await user.keyboard('{Escape}');
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Подтверждения');
  });

  it('deny routes the deny decision', async () => {
    listApprovals.mockResolvedValue([pending]);
    respondApproval.mockResolvedValue({ ...pending, status: 'denied', decidedAt: 2 });
    const user = userEvent.setup();
    render(<ApprovalsPanel />);

    await screen.findByTestId('approval-ap-01');
    await user.click(screen.getByRole('button', { name: 'Отклонить' }));
    await waitFor(() => expect(respondApproval).toHaveBeenCalledWith('ap-01', 'deny'));
  });

  it('empty queue renders an honest empty state, not fabricated rows', async () => {
    listApprovals.mockResolvedValue([]);
    render(<ApprovalsPanel />);

    const panel = await screen.findByTestId('approvals-panel');
    await waitFor(() => expect(panel.textContent).toContain('Ожидающих подтверждений нет.'));
    expect(panel.getAttribute('data-state')).toBe('ready');
  });

  it('fetch failure renders error-state hook; retry refetches honestly', async () => {
    listApprovals.mockRejectedValueOnce(new Error('backend down')).mockResolvedValue([pending]);
    const user = userEvent.setup();
    render(<ApprovalsPanel />);

    const panel = await screen.findByTestId('approvals-panel');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('error'));
    const err = await screen.findByTestId('error-state');
    expect(err.getAttribute('role')).toBe('alert');

    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(listApprovals).toHaveBeenCalledTimes(2));
    await screen.findByTestId('approval-ap-01');
    expect(panel.getAttribute('data-state')).toBe('ready');
  });

  it('respondApproval rejection keeps the pending row, shows alert, restores buttons', async () => {
    listApprovals.mockResolvedValue([pending]);
    respondApproval.mockRejectedValue(new Error('backend down'));
    const user = userEvent.setup();
    render(<ApprovalsPanel />);

    await screen.findByTestId('approval-ap-01');
    await user.click(screen.getByRole('button', { name: 'Разрешить' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/не отправлено/);
    expect(screen.getByTestId('approval-ap-01')).toBeTruthy();
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Разрешить' }) as HTMLButtonElement).disabled).toBe(false);
    });
  });
});


describe('RuntimeScreen run controls (W3-04/05)', () => {
  const running = {
    runId: 'run-1042',
    taskText: 'Живой прогон',
    config: 'baseline',
    status: 'running' as const,
    stopReason: null,
    agent: 'coder',
    parent: null,
    project: 'nexus',
    model: null,
    costUsd: null,
    createdAt: 1,
    finishedAt: null,
  };

  it('hides controls entirely when the source has no control seam', async () => {
    listRuns.mockResolvedValue([running]);
    render(<RunOpsPanel />);
    await screen.findByTestId('live-run');
    expect(screen.queryByRole('button', { name: 'Пауза' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Повтор' })).toBeNull();
  });

  it('pause calls pauseRun and swaps to ПАУЗА badge + Продолжить', async () => {
    seams.controls = true;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    getRunControls.mockResolvedValue({
      paused: false,
      pause: { available: true, reason: null },
      resume: { available: false, reason: 'Прогон не на паузе' },
      replay: { available: true, reason: null },
      checkpoint: { available: false, reason: null },
      retry: { available: true, reason: null },
    });
    pauseRun.mockResolvedValue({
      paused: true,
      pause: { available: false, reason: 'Прогон уже на паузе' },
      resume: { available: true, reason: null },
      replay: { available: true, reason: null },
      checkpoint: { available: false, reason: null },
      retry: { available: true, reason: null },
    });
    const user = userEvent.setup();
    render(<RunOpsPanel />);

    const pauseBtn = await screen.findByRole('button', { name: 'Пауза' });
    await user.click(pauseBtn);

    await waitFor(() => expect(pauseRun).toHaveBeenCalledWith('run-1042'));
    expect((await screen.findByText('ПАУЗА'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeTruthy();
  });

  it('terminal run shows Повтор which calls replayRun', async () => {
    seams.controls = true;
    // Mount hydrates the running run; the stream ends → status flips terminal.
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    streamRun.mockImplementation((_id?: string, cb?: { onEnd: (s: string) => void }) => {
      cb?.onEnd('done');
      return () => { };
    });
    getRunControls.mockResolvedValue({
      paused: false,
      pause: { available: false, reason: 'Прогон не выполняется' },
      resume: { available: false, reason: 'Прогон не выполняется' },
      replay: { available: true, reason: null },
      checkpoint: { available: false, reason: null },
      retry: { available: true, reason: null },
    });
    replayRun.mockResolvedValue({
      paused: false,
      pause: { available: false, reason: 'Прогон не выполняется' },
      resume: { available: false, reason: 'Прогон не выполняется' },
      replay: { available: true, reason: null },
      checkpoint: { available: false, reason: null },
      retry: { available: true, reason: null },
    });
    const user = userEvent.setup();
    render(<RunOpsPanel />);

    const replayBtn = await screen.findByRole('button', { name: 'Повтор' });
    await user.click(replayBtn);
    await waitFor(() => expect(replayRun).toHaveBeenCalledWith('run-1042'));
  });

  it('оборванный поток не завершает прогон, а данные помечаются stale', async () => {
    seams.controls = true;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    // Живой хост так сообщает, когда реконнекты исчерпаны: прогон может ещё
    // выполняться — UI не должен ставить финальный статус, но «живые» данные
    // больше не живые.
    streamRun.mockImplementation((_id?: string, cb?: { onEnd: (s: string) => void }) => {
      cb?.onEnd('running');
      return () => { };
    });
    getRunControls.mockResolvedValue({
      paused: false,
      pause: { available: true, reason: null },
      resume: { available: false, reason: 'Прогон не на паузе' },
      replay: { available: true, reason: null },
      checkpoint: { available: false, reason: null },
      retry: { available: true, reason: null },
    });
    render(<RunOpsPanel />);

    const panel = await screen.findByTestId('live-run');
    await waitFor(() => expect(panel.getAttribute('data-freshness')).toBe('stale'));
    // Прогон остаётся выполняющимся — «Отменить» на месте, финала нет.
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeTruthy();
  });

  it('retry is only on terminal runs; checkpoint stays disabled with an honest reason', async () => {
    seams.controls = true;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    getRunControls.mockResolvedValue({
      paused: false,
      pause: { available: true, reason: null },
      resume: { available: false, reason: 'Прогон не на паузе' },
      replay: { available: true, reason: null },
      checkpoint: { available: false, reason: 'Мок-рантайм не сохраняет чекпоинты' },
      retry: { available: false, reason: 'Прогон ещё выполняется' },
    });
    render(<RunOpsPanel />);

    const cp = (await screen.findByRole('button', { name: 'Чекпоинт' })) as HTMLButtonElement;
    expect(cp.disabled).toBe(true);
    expect(cp.title).toContain('не сохраняет чекпоинты');
    // Running run → no Заново button at all.
    expect(screen.queryByRole('button', { name: 'Заново' })).toBeNull();
  });

  it('Заново on a terminal run calls retryRun and swaps the panel to the new run', async () => {
    seams.controls = true;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    streamRun.mockImplementation((_id?: string, cb?: { onEnd: (s: string) => void }) => {
      cb?.onEnd('error');
      return () => { };
    });
    getRunControls.mockResolvedValue({
      paused: false,
      pause: { available: false, reason: 'Прогон не выполняется' },
      resume: { available: false, reason: 'Прогон не выполняется' },
      replay: { available: true, reason: null },
      checkpoint: { available: false, reason: 'Мок-рантайм не сохраняет чекпоинты' },
      retry: { available: true, reason: null },
    });
    retryRun.mockResolvedValue({ ...running, runId: 'run-9010', createdAt: 2 });
    const user = userEvent.setup();
    render(<RunOpsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Заново' }));
    await waitFor(() => expect(retryRun).toHaveBeenCalledWith('run-1042'));
    await waitFor(() => expect(screen.getByTestId('live-run').textContent).toContain('run-9010'));
  });

  it('control failure shows alert and keeps controls usable', async () => {
    seams.controls = true;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    getRunControls.mockResolvedValue({
      paused: false,
      pause: { available: true, reason: null },
      resume: { available: false, reason: 'Прогон не на паузе' },
      replay: { available: true, reason: null },
      checkpoint: { available: false, reason: null },
      retry: { available: true, reason: null },
    });
    pauseRun.mockRejectedValue(new Error('lost connection'));
    const user = userEvent.setup();
    render(<RunOpsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Пауза' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Действие не выполнено/);
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeTruthy();
  });

  it('отмена, отклонённая рантаймом, показывает причину и оставляет прогон выполняющимся', async () => {
    seams.controls = true;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    getRunControls.mockResolvedValue({
      paused: false,
      pause: { available: true, reason: null },
      resume: { available: false, reason: 'Прогон не на паузе' },
      replay: { available: true, reason: null },
      checkpoint: { available: false, reason: null },
      retry: { available: true, reason: null },
    });
    cancelRun.mockRejectedValue(new Error('host refused'));
    const user = userEvent.setup();
    render(<RunOpsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Отменить' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Отмена не выполнена/);
    // Прогон не помечен отменённым — хост его не отменил.
    expect(screen.queryByText('ОТМЕНЕН')).toBeNull();
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeTruthy();
  });
});

describe('RuntimeScreen event feed (W3-03)', () => {
  const running = {
    runId: 'run-1042', taskText: 'Живой прогон', config: 'baseline',
    status: 'running' as const, stopReason: null, agent: 'coder', parent: null,
    project: 'nexus', model: null, costUsd: null, createdAt: 1, finishedAt: null,
  };

  const emit = (cb: { onEvent: (e: unknown) => void }, evs: unknown[]) => {
    act(() => evs.forEach((e) => cb.onEvent(e)));
  };

  it('renders time, tool name and masks body summaries', async () => {
    let cb: { onEvent: (e: unknown) => void } | undefined;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    streamRun.mockImplementation((_id?: string, c?: typeof cb) => { cb = c; return () => { }; });
    render(<RunOpsPanel />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(cb).toBeTruthy());

    emit(cb!, [
      { seq: 1, type: 'tool_call', role: 'executor', ts: 1700000000, body: { tool: 'fs.write', args: { path: 'reports/a.md' } } },
      { seq: 2, type: 'model_call', role: 'exec', ts: 1700000005, body: { model: 'exec-1' } },
    ]);

    const feed = screen.getByTestId('event-feed');
    await waitFor(() => expect(feed.textContent).toContain('fs.write'));
    expect(feed.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(feed.textContent).toContain('exec-1');
  });

  it('filter chips narrow the feed by event group without dropping data', async () => {
    let cb: { onEvent: (e: unknown) => void } | undefined;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    streamRun.mockImplementation((_id?: string, c?: typeof cb) => { cb = c; return () => { }; });
    const user = userEvent.setup();
    render(<RunOpsPanel />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(cb).toBeTruthy());

    emit(cb!, [
      { seq: 1, type: 'tool_call', role: 'executor', ts: 1, body: { tool: 'fs.write' } },
      { seq: 2, type: 'model_call', role: 'exec', ts: 2, body: { model: 'exec-1' } },
      { seq: 3, type: 'final', role: 'arbiter', ts: 3, body: { stop_reason: 'done' } },
    ]);
    const feed = screen.getByTestId('event-feed');
    await waitFor(() => expect(feed.textContent).toContain('fs.write'));

    await user.click(screen.getByRole('button', { name: 'модели' }));
    expect(feed.textContent).not.toContain('fs.write');
    expect(feed.textContent).toContain('exec-1');

    await user.click(screen.getByRole('button', { name: 'все' }));
    expect(feed.textContent).toContain('fs.write');
    expect(feed.textContent).toContain('exec-1');
  });

  it('scroll от программной автопрокрутки не отписывает ленту (пила не мигает)', async () => {
    let cb: { onEvent: (e: unknown) => void } | undefined;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    streamRun.mockImplementation((_id?: string, c?: typeof cb) => { cb = c; return () => { }; });
    render(<RunOpsPanel />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(cb).toBeTruthy());

    // Метрики ленты как в браузере: jsdom не скроллит и не шлёт scroll.
    const stubFeedMetrics = (list: HTMLOListElement) => {
      Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 });
      Object.defineProperty(list, 'clientHeight', { configurable: true, value: 200 });
      Object.defineProperty(list, 'scrollTop', { configurable: true, get: () => 0, set: () => { } });
    };

    // Событие приходит → автопрокрутка отрабатывает → её scroll не должен
    // считаться прокруткой пользователя (иначе пила «↓ к новым событиям»
    // мигает, а высота панели скачет — детерминированные скриншоты расходятся).
    let list!: HTMLOListElement;
    act(() => {
      emit(cb!, [{ seq: 1, type: 'tool_call', role: 'executor', ts: 1, body: { tool: 'fs.write' } }]);
    });
    list = screen.getByTestId('event-feed').querySelector('ol') as HTMLOListElement;
    stubFeedMetrics(list);
    // Рендер после подмены метрик: автопрокрутка видит «содержимое выросло»
    // и уходит вниз (в браузере это и даёт scroll-событие).
    act(() => {
      emit(cb!, [{ seq: 2, type: 'model_call', role: 'exec', ts: 2, body: { model: 'exec-1' } }]);
    });
    // Браузер досылает scroll от программной прокрутки — его оболочка ест.
    act(() => { fireEvent.scroll(list); });
    expect(screen.queryByText('↓ к новым событиям')).toBeNull();
  });

  it('прокрутка пользователя вверх показывает пилку «к новым событиям»', async () => {
    let cb: { onEvent: (e: unknown) => void } | undefined;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    streamRun.mockImplementation((_id?: string, c?: typeof cb) => { cb = c; return () => { }; });
    render(<RunOpsPanel />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(cb).toBeTruthy());

    emit(cb!, [{ seq: 1, type: 'tool_call', role: 'executor', ts: 1, body: { tool: 'fs.write' } }]);
    const list = screen.getByTestId('event-feed').querySelector('ol') as HTMLOListElement;
    // Метрики ленты как в браузере: пользователь прокрутил вверх.
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 0 });

    act(() => { fireEvent.scroll(list); });

    await waitFor(() => expect(screen.getByText('↓ к новым событиям')).toBeTruthy());
  });
});


describe('RuntimeScreen unknown cost (NQ-053)', () => {
  it('digest never collapses unknown cost to $0 — marks н/д explicitly', async () => {
    listRuns.mockImplementation((opts?: { since?: number }) =>
      Promise.resolve(
        opts?.since != null
          ? [
            { runId: 'run-1', taskText: 'a', config: 'b', status: 'done' as const, stopReason: 'done', agent: null, parent: null, project: 'nexus', model: null, costUsd: 0.21, createdAt: 2, finishedAt: 3 },
            { runId: 'run-2', taskText: 'b', config: 'b', status: 'done' as const, stopReason: 'done', agent: null, parent: null, project: 'nexus', model: null, costUsd: null, createdAt: 4, finishedAt: 5 },
          ]
          : [],
      ),
    );
    render(<DigestCard />);
    const card = await screen.findByTestId('briefing-card');
    await waitFor(() => expect(card.textContent).toContain('≥$0.210'));
    expect(card.textContent).toContain('без данных');
    expect(card.textContent).not.toContain('$0.000');
  });
});

describe('RuntimeScreen initial reads (NQ-052)', () => {
  it('mount-read rejection → honest error state + working retry, no unhandled rejection', async () => {
    listRuns.mockRejectedValueOnce(new Error('runs backend down'));
    const user = userEvent.setup();
    render(<DigestCard />);

    // Wave-7: the preset strip moved to Settings → Runtime — the process tab
    // keeps the briefing-card as the mount-read error/retry surface.
    const briefing = await screen.findByTestId('briefing-card');
    await waitFor(() => expect(briefing.getAttribute('data-state')).toBe('error'));

    // Retry refetches honestly — success flips back to a real state.
    const retries = briefing.querySelectorAll('button');
    expect(retries.length).toBe(1);
    await user.click(retries[0]);
    await waitFor(() => expect(briefing.getAttribute('data-state')).toBe('empty'));
    expect(listRuns.mock.calls.filter((c) => (c[0] as { since?: number })?.since != null).length).toBe(2);
  });
});


describe('humanizeDraft — live-драфт без сырых JSON-меток', () => {
  it('plain text passes through untouched', () => {
    const t = 'Обычный ответ модели, без всяких обёрток.';
    expect(humanizeDraft(t)).toBe(t);
  });

  it('complete JSON envelope → readable text fields', () => {
    expect(humanizeDraft('{"answer": "Ответ готов."}')).toBe('Ответ готов.');
    expect(humanizeDraft('{"plan": {"response": "Шаги расписаны"}}')).toBe('Шаги расписаны');
  });

  it('partial JSON mid-stream → уже пришедшие значения, без скобок', () => {
    const out = humanizeDraft('{"answer": "Часть ответа", "steps": [{"x": 1}');
    expect(out).toBe('Часть ответа');
    expect(out).not.toContain('{');
    expect(out).not.toContain('"answer"');
  });

  it('bare JSON scaffold without fields → честная пометка, не выдумка', () => {
    const out = humanizeDraft('{"a":');
    expect(out).toContain('структурированный ответ');
  });
});


describe('contourBlocks — снапшот-гейт контуров (contour-dispatch W3)', () => {
  // Фикстуры — ожидания из таблицы диспетча (spec-уровень), НЕ live-трейсы.
  // lit по наблюдаемым событиям: незажёгшийся блок = «не вызывался».
  const ev = (type: string, role: string | null = null, body: unknown = {}) => ({ seq: 0, type, role, ts: 0, body });
  const litIds = (events: ReturnType<typeof ev>[]) =>
    new Set(contourBlocks(events.map((e, i) => ({ ...e, seq: i }))).filter((b) => b.lit).map((b) => b.id));
  const executor = () => ev('model_call', 'executor');

  const cases: [string, ReturnType<typeof ev>[], string[]][] = [
    ['baseline', [executor()], ['exec']],
    ['plan', [ev('plan', 'planner'), executor()], ['plan', 'exec']],
    ['critic', [executor(), ev('decision', 'critic')], ['exec', 'critic']],
    ['triad', [executor(), ev('decision', 'critic'), ev('decision', 'arbiter')], ['exec', 'critic', 'arbiter']],
    ['checkpoints', [executor(), ev('checkpoint'), ev('checkpoint')], ['exec', 'verify']],
    ['full', [ev('plan', 'planner'), executor(), ev('decision', 'critic'), ev('decision', 'arbiter'), ev('checkpoint')],
      ['plan', 'exec', 'critic', 'arbiter', 'verify']],
    ['memory', [ev('config', null, { memory: true }), ev('tool_call', null, { tool: 'memory_search' }), executor()], ['exec', 'memory']],
    ['recovery', [executor(), ev('recovery')], ['exec', 'recovery']],
    ['router', [executor(), ev('router_choice')], ['exec', 'router']],
    ['tasks', [ev('plan', 'planner'), ev('task_step'), ev('task_step'), executor()], ['plan', 'exec']],
    ['critic_tools', [ev('model_call', 'critic'), ev('tool_call', null, { tool: 'fs.read' })], ['critic', 'tools']],
    ['cross', [ev('tool_call', null, { tool: 'memory_search', retrieval_scores: [0.91, 0.73] }), executor()], ['exec', 'memory']],
    ['screen', [ev('tool_call', null, { tool: 'screen.capture' }), executor()], ['exec', 'tools']],
    ['perceive', [ev('perception'), executor()], ['exec']],
    ['hashing', [ev('tool_call', null, { tool: 'memory_search' }), executor()], ['exec', 'memory']],
    ['sentence', [ev('tool_call', null, { tool: 'memory_search' }), executor()], ['exec', 'memory']],
    ['hybrid', [ev('tool_call', null, { tool: 'memory_search' }), executor()], ['exec', 'memory']],
  ];

  for (const [preset, events, expected] of cases) {
    it(`${preset}: зажигает ровно ${expected.join('+')}`, () => {
      expect(litIds(events)).toEqual(new Set(expected));
    });
  }

  it('memory armed but unused — честный hint, блок не зажжён', () => {
    const blocks = contourBlocks([{ ...ev('config', null, { memory: true }), seq: 0 }, { ...executor(), seq: 1 }]);
    const mem = blocks.find((b) => b.id === 'memory')!;
    expect(mem.lit).toBe(false);
    expect(mem.hint).toContain('не вызывала memory_search');
  });

  it('memory called — detail показывает число документов по retrieval_scores', () => {
    const blocks = contourBlocks([{ ...ev('tool_call', null, { tool: 'memory_search', retrieval_scores: [0.9, 0.7, 0.5] }), seq: 0 }]);
    const mem = blocks.find((b) => b.id === 'memory')!;
    expect(mem.lit).toBe(true);
    expect(mem.detail).toBe('3 док.');
  });
});

