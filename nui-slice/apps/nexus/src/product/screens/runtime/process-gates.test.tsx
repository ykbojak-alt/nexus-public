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
import { resetProfileStore, updateProfile } from '../../profile/profile-store';
import { Ai2ApiError } from '../../../integrations/ai2/api/errors';

// Регуляторы «Процесса»: fs-доступ, шина окон, SDK-подтверждения
// (XII/XIV) — выделено из runtime.test.tsx.

describe('RuntimeScreen fs-access regulator (fs-dispatch W3)', () => {
  // Профильные поля fsMode/fsRoots персистятся — сброс между тестами,
  // иначе корни одного кейса протекают в payload следующего.
  afterEach(() => {
    resetProfileStore();
    globalThis.localStorage?.clear();
  });

  const run = {
    runId: 'run-fs1', taskText: 'прочитай файл', config: 'baseline',
    status: 'running' as const, stopReason: null, agent: null, parent: null,
    project: 'nexus', model: null, costUsd: null, createdAt: 100, finishedAt: null,
  };
  const fsReqEvent = {
    seq: 5, type: 'fs_request', role: null, ts: 1700000000,
    body: { request_id: 'fsr-1', root: 'nexus', path: 'docs/NOTE.md', op: 'write', size: 128, sha256: 'ab12cd34ef56', preview: 'line 1' },
  };
  const attach = () => {
    let cb: { onEvent: (e: unknown) => void } | undefined;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [run] : []));
    streamRun.mockImplementation((_id?: string, c?: typeof cb) => { cb = c; return () => { }; });
    return { get cb() { return cb; } };
  };

  // Регулятор — кнопка-дропдаун в мета-ряду: меню открывается кликом.
  const openFsMenu = async (user: ReturnType<typeof userEvent.setup>, reg: HTMLElement) => {
    await user.click(within(reg).getByRole('button', { name: /Доступ A\.L\.I\.C\.E\. к файлам/ }));
  };

  it('renders the regulator — radiogroup persists the mode to the profile', async () => {
    seams.fs = true;
    const user = userEvent.setup();
    render(<RuntimeScreen />);

    const reg = await screen.findByTestId('fs-regulator');
    expect(reg.getAttribute('data-state')).toBe('ready');
    await openFsMenu(user, reg);
    const group = within(reg).getByRole('radiogroup', { name: /Доступ/ });
    const ro = within(group).getByRole('radio', { name: 'только чтение' });
    const rw = within(group).getByRole('radio', { name: 'чтение+запись' });
    expect(ro.getAttribute('aria-checked')).toBe('true'); // дефолт read_only
    expect(reg.textContent).toContain('корней: 0');

    await user.click(rw);
    expect(rw.getAttribute('aria-checked')).toBe('true');
    expect(ro.getAttribute('aria-checked')).toBe('false');
  });

  it('without the fs seam the regulator is honestly unavailable — + папка disabled', async () => {
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    const reg = await screen.findByTestId('fs-regulator');
    expect(reg.getAttribute('data-state')).toBe('unavailable');
    await openFsMenu(user, reg);
    expect((within(reg).getByRole('button', { name: '+ папка' }) as HTMLButtonElement).disabled).toBe(true);
    expect(reg.textContent).toContain('fs-контур недоступен');
  });

  it('+ папка: ok → корень в профиле и фишка; ok:false → причина verbatim', { timeout: 15000 }, async () => {
    seams.fs = true;
    fsValidate.mockResolvedValue({ ok: true, path: 'D:/<repo>/docs' });
    const user = userEvent.setup();
    render(<RuntimeScreen />);

    const reg = await screen.findByTestId('fs-regulator');
    // Форма добавления живёт внутри выпадающего меню регулятора.
    await openFsMenu(user, reg);
    await user.click(within(reg).getByRole('button', { name: '+ папка' }));
    await user.type(screen.getByLabelText('Путь корня доступа'), 'D:/<repo>/docs');
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(fsValidate).toHaveBeenCalledWith('D:/<repo>/docs'));
    await waitFor(() => expect(reg.textContent).toContain('корней: 1'));
    expect(within(reg).getByRole('button', { name: /Убрать корень docs/ })).toBeTruthy();

    // ok:false — причина хоста verbatim, корень не добавляется.
    fsValidate.mockResolvedValue({ ok: false, reason: 'path is not a directory' });
    await user.click(within(reg).getByRole('button', { name: '+ папка' }));
    await user.type(screen.getByLabelText('Путь корня доступа'), 'D:/nope.txt');
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('path is not a directory');
    expect(reg.textContent).toContain('корней: 1');
  });

  it('startRun несёт fs_policy только с корнями; пустой список — без поля', async () => {
    seams.fs = true;
    // Два прогона подряд: первый завершаем через onEnd, иначе второй submit
    // заблокирован живым прогоном (one-active-run дизайн чата).
    let cb: { onEvent: (e: unknown) => void; onEnd: (s: string) => void } | undefined;
    streamRun.mockImplementation((_id?: string, c?: typeof cb) => { cb = c; return () => { }; });
    startRun.mockResolvedValue(run);
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    await user.type(await screen.findByLabelText('Текст задачи'), 'без корней');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));
    await waitFor(() => expect(startRun).toHaveBeenCalled());
    expect(startRun.mock.calls[0][0].fsPolicy).toBeUndefined();

    await waitFor(() => expect(cb).toBeTruthy());
    act(() => cb!.onEnd('done'));
    startRun.mockClear();
    startRun.mockResolvedValue({ ...run, runId: 'run-fs2', status: 'done' });
    updateProfile({ fsMode: 'read_write', fsRoots: [{ id: 'nexus', path: 'D:/<repo>' }] });
    await user.type(await screen.findByLabelText('Текст задачи'), 'с корнем');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));
    await waitFor(() => expect(startRun).toHaveBeenCalled());
    const sent = startRun.mock.calls[0][0].fsPolicy;
    expect(sent).toEqual({
      mode: 'read_write',
      roots: [{ id: 'nexus', path: 'D:/<repo>', access: 'rw' }],
      requestWrites: false,
    });
  });

  it('fs_request → карточка ApprovalRequest; approve дёргает seam с id', async () => {
    seams.fs = true;
    fsApprove.mockResolvedValue({ id: 'fsr-1', status: 'approved' });
    const attached = attach();
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());

    act(() => attached.cb!.onEvent(fsReqEvent));
    const card = await screen.findByTestId('approval-request');
    expect(card.textContent).toContain('просит запись');
    expect(card.textContent).toContain('nexus:docs/NOTE.md');
    expect(card.getAttribute('data-state')).toBe('pending');

    await user.click(within(card).getByRole('button', { name: 'Разрешить' }));
    await waitFor(() => expect(fsApprove).toHaveBeenCalledWith('fsr-1'));
    await waitFor(() => expect(card.getAttribute('data-state')).toBe('approved'));
  });

  it('fs_request_resolved в трейсе — финальная правда для карточки', async () => {
    seams.fs = true;
    const attached = attach();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());

    act(() => {
      attached.cb!.onEvent(fsReqEvent);
      attached.cb!.onEvent({
        seq: 6, type: 'fs_request_resolved', role: null, ts: 1700000010,
        body: { request_id: 'fsr-1', decision: 'denied' },
      });
    });
    const card = await screen.findByTestId('approval-request');
    expect(card.getAttribute('data-state')).toBe('denied');
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('410 → expired, 409 → статус перечитывается через requests-seam', async () => {
    seams.fs = true;
    const { Ai2ApiError } = await import('../../../integrations/ai2/api/errors');
    fsDeny
      .mockRejectedValueOnce(new Ai2ApiError(410, { error: 'gone', message: 'expired' }))
      .mockRejectedValueOnce(new Ai2ApiError(409, { error: 'conflict', message: 'already resolved' }));
    fsRequests.mockResolvedValue([{ id: 'fsr-2', status: 'approved' }]);
    const attached = attach();
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());
    act(() => attached.cb!.onEvent(fsReqEvent));
    const card = await screen.findByTestId('approval-request');

    await user.click(within(card).getByRole('button', { name: 'Отклонить' }));
    await waitFor(() => expect(card.getAttribute('data-state')).toBe('expired'));

    // Отменяем первую разрешенность — карточка снова pending? Нет: решения
    // sticky. Второй emit той же заявки невозможен; проверяем 409 на свежей.
    act(() => attached.cb!.onEvent({ ...fsReqEvent, seq: 7, body: { ...fsReqEvent.body, request_id: 'fsr-2' } }));
    const card2 = await screen.findAllByTestId('approval-request');
    const second = card2.find((c) => c.getAttribute('data-state') === 'pending')!;
    await user.click(within(second).getByRole('button', { name: 'Отклонить' }));
    await waitFor(() => expect(fsRequests).toHaveBeenCalled());
    await waitFor(() => expect(second.getAttribute('data-state')).toBe('approved'));
  });
});


describe('волна XI W3 — «Окна и сессии» (bus seam, вкладка bus)', () => {
  const sessionsFixture = [
    { id: 's-w0', window: 'W0', title: 'ДИСПЕТЧЕР', kind: 'desktop', status: 'idle', lastActivityAt: 100 },
    { id: 's-w5', window: 'W5', title: 'QA', kind: 'desktop', status: 'locked', lastActivityAt: null },
  ];
  // Панель переехала во вкладку bus (XIV): поле задачи — общее с формой
  // «Отправить окну», режим уходит первой строкой файла задачи.

  it('seam отсутствует → вкладка недоступна, без фантазий', async () => {
    navSearch.raw = 'tab=bus';
    render(<RuntimeScreen />);
    const tab = await screen.findByTestId('tab-bus');
    expect(tab.getAttribute('data-state')).toBe('unavailable');
    expect(within(tab).getByText(/не предоставляет seam \/v1\/bus/)).toBeTruthy();
  });

  it('сессии из seam: строки verbatim, locked-окно — «Занята другим», кнопка disabled', async () => {
    navSearch.raw = 'tab=bus';
    seams.bus = true;
    busListSessions.mockResolvedValue(sessionsFixture);
    render(<RuntimeScreen />);
    const panel = await screen.findByTestId('bus-sessions');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('ready'));
    expect(within(panel).getByText(/W0 · ДИСПЕТЧЕР/)).toBeTruthy();
    expect(within(panel).getByText(/W5 · QA/)).toBeTruthy();
    expect(within(panel).getByText('Занята другим')).toBeTruthy();
    const sends = within(panel).getAllByRole('button', { name: 'Отправить окну' });
    expect((sends[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('«Отправить окну» → delegateTask реальным вызовом, DelegationChip из ответа', async () => {
    navSearch.raw = 'tab=bus';
    seams.bus = true;
    busListSessions.mockResolvedValue(sessionsFixture);
    busDelegateTask.mockResolvedValue({
      id: 'd-7', to: 'W0', taskPath: 'inbox/w0-task.md',
      state: 'queued', answerPath: null, createdAt: 200,
    });
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    const panel = await screen.findByTestId('bus-sessions');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('ready'));
    await user.type(screen.getByLabelText('Текст задачи для окна'), 'проверь список задач');
    await user.click(within(panel).getAllByRole('button', { name: 'Отправить окну' })[0]);
    await waitFor(() => expect(busDelegateTask).toHaveBeenCalledWith({
      window: 'W0', task: '[режим: Агент]\n\nпроверь список задач',
    }));
    expect(await within(panel).findByText('В очереди')).toBeTruthy();
  });

  it('ошибка отправки → сообщение verbatim, без авто-ретрая', async () => {
    navSearch.raw = 'tab=bus';
    seams.bus = true;
    busListSessions.mockResolvedValue(sessionsFixture);
    busDelegateTask.mockRejectedValue(new Error('bus offline'));
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    const panel = await screen.findByTestId('bus-sessions');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('ready'));
    await user.type(screen.getByLabelText('Текст задачи для окна'), 'x');
    await user.click(within(panel).getAllByRole('button', { name: 'Отправить окну' })[0]);
    expect(await screen.findByText('Не удалось отправить задачу окну.')).toBeTruthy();
    expect(busDelegateTask).toHaveBeenCalledTimes(1);
  });

  it('пустой список от шины → «Нет данных о сессиях»', async () => {
    navSearch.raw = 'tab=bus';
    seams.bus = true;
    busListSessions.mockResolvedValue([]);
    render(<RuntimeScreen />);
    const panel = await screen.findByTestId('bus-sessions');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('empty'));
    expect(within(panel).getByText(/Нет данных о сессиях/)).toBeTruthy();
  });
});


describe('волна XII — карточка tool_confirmation (SDK-канал)', () => {
  const runningSdk = {
    runId: 'run-sdk1', taskText: 'sdk задача', config: 'baseline',
    status: 'running' as const, stopReason: null, agent: 'coder', parent: null,
    project: 'nexus', model: null, costUsd: null, createdAt: 100, finishedAt: null,
  };
  const confEvent = {
    seq: 5, type: 'tool_confirmation', role: 'ядро', ts: 105,
    body: {
      call_id: 'tu-42', tool: 'Bash', input: { command: 'rm -rf build' },
      state: 'awaiting', title: 'Bash хочет выполнить команду',
      display_name: 'Bash', description: 'Выполнить shell-команду',
      decision_reason: 'правило ask', agent_id: null,
    },
  };
  const setupStream = () => {
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [runningSdk] : []),
    );
    let emit: ((e: unknown) => void) | null = null;
    streamRun.mockImplementation((_id?: string, cb?: { onEvent: (e: unknown) => void }) => {
      emit = cb!.onEvent;
      return () => { };
    });
    return () => emit!;
  };

  it('awaiting без seam ответа → read-only карточка verbatim, кнопок нет', async () => {
    const emit = setupStream();
    render(<RuntimeScreen />);
    const bubble = await screen.findByTestId('live-run');
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    await act(async () => { emit()(confEvent); });
    const card = await within(bubble).findByTestId('tool-confirmation');
    expect(card.getAttribute('data-state')).toBe('unavailable');
    expect(card.textContent).toContain('Bash хочет выполнить команду');
    expect(card.textContent).toContain('Bash');
    expect(card.textContent).toContain('ожидает решения');
    expect(card.textContent).toContain('rm -rf build');
    expect(within(card).queryByRole('button', { name: 'Разрешить' })).toBeNull();
  });

  it('seam есть → кнопки allow/deny вызывают respondToolConfirmation', async () => {
    seams.confirm = true;
    respondToolConfirmation.mockResolvedValue(undefined);
    const emit = setupStream();
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    const bubble = await screen.findByTestId('live-run');
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    await act(async () => { emit()(confEvent); });
    const card = await within(bubble).findByTestId('tool-confirmation');
    await user.click(within(card).getByRole('button', { name: 'Разрешить' }));
    await waitFor(() => expect(respondToolConfirmation).toHaveBeenCalledWith('run-sdk1', 'tu-42', 'allow', undefined));
  });

  it('tool_confirmation_resolved → карточка показывает решение verbatim', async () => {
    const emit = setupStream();
    render(<RuntimeScreen />);
    const bubble = await screen.findByTestId('live-run');
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    await act(async () => {
      emit()(confEvent);
      emit()({
        seq: 6, type: 'tool_confirmation_resolved', role: 'ядро', ts: 106,
        body: { call_id: 'tu-42', tool: 'Bash', decision: 'deny', message: 'таймаут подтверждения' },
      });
    });
    const card = await within(bubble).findByTestId('tool-confirmation');
    await waitFor(() => expect(card.textContent).toContain('Отклонено'));
    expect(card.textContent).toContain('таймаут подтверждения');
    expect(within(card).queryByRole('button', { name: 'Разрешить' })).toBeNull();
  });
});


describe('волна XIV — SDK-подтверждения (sdk-confirm-contract)', () => {
  // ФИКСТУРЫ: события собраны вручную по форме контракта draft 0.2
  // (эмиссия — ai2/sdk_sessions.py _can_use_tool / defer_confirmation).
  const runningSdk = {
    runId: 'run-sdk2', taskText: 'sdk прогон', config: 'baseline',
    status: 'running' as const, stopReason: null, agent: 'coder', parent: null,
    project: 'nexus', model: null, costUsd: null, createdAt: 200, finishedAt: null,
  };
  const reqEvent = {
    seq: 10, type: 'confirmation_requested', role: 'ядро', ts: 1_800_000_000,
    body: {
      callId: 'tu-7', call_id: 'tu-7', tool: 'Write',
      input: { file_path: 'src/a.ts', content: 'x=1', api_key: 'SECRET-KEY-9' },
      parentCallId: 'tu-parent', state: 'awaiting',
    },
  };
  const legacyDup = {
    seq: 9, type: 'tool_confirmation', role: 'ядро', ts: 1_800_000_000,
    body: {
      call_id: 'tu-7', tool: 'Write',
      input: { file_path: 'src/a.ts', content: 'x=1', api_key: 'SECRET-KEY-9' },
      state: 'awaiting', title: 'Write хочет записать файл',
      parent_call_id: 'tu-parent',
    },
  };
  const setupStream = () => {
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [runningSdk] : []),
    );
    let emit: ((e: unknown) => void) | null = null;
    streamRun.mockImplementation((_id?: string, cb?: { onEvent: (e: unknown) => void }) => {
      emit = cb!.onEvent;
      return () => { };
    });
    return () => emit!;
  };

  it('дедуп: tool_confirmation + confirmation_requested → одна карточка, поля слиты', async () => {
    const emit = setupStream();
    render(<RuntimeScreen />);
    const bubble = await screen.findByTestId('live-run');
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    await act(async () => {
      emit()(legacyDup);   // legacy идёт первым (seq меньше, title/display_name)
      emit()(reqEvent);    // каноническое — parentCallId
    });
    const cards = await within(bubble).findAllByTestId('tool-confirmation');
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain('Write хочет записать файл');
    expect(cards[0].textContent).toContain('родитель: tu-parent');
    // секрет в input замаскирован
    expect(cards[0].textContent).not.toContain('SECRET-KEY-9');
  });

  it('defer → POST decision=defer; карточка → «Отложено», кнопки allow/deny живы', async () => {
    seams.confirm = true;
    respondToolConfirmation.mockResolvedValue({ resolved: false, state: 'deferred' });
    const emit = setupStream();
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    const bubble = await screen.findByTestId('live-run');
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    await act(async () => { emit()(reqEvent); });
    const card = await within(bubble).findByTestId('tool-confirmation');
    await user.click(within(card).getByRole('button', { name: 'Отложить' }));
    await waitFor(() => expect(respondToolConfirmation).toHaveBeenCalledWith('run-sdk2', 'tu-7', 'defer', undefined));
    await waitFor(() => expect(card.getAttribute('data-conf-state')).toBe('deferred'));
    expect(card.textContent).toContain('Отложено');
    // позднее решение остаётся доступным
    expect(within(card).getByRole('button', { name: 'Разрешить' })).toBeTruthy();
  });

  it('confirmation_deferred из трейса → состояние «Отложено» verbatim', async () => {
    const emit = setupStream();
    render(<RuntimeScreen />);
    const bubble = await screen.findByTestId('live-run');
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    await act(async () => {
      emit()(reqEvent);
      emit()({
        seq: 11, type: 'confirmation_deferred', role: 'ядро', ts: 1_800_000_100,
        body: { callId: 'tu-7', call_id: 'tu-7', tool: 'Write', state: 'deferred' },
      });
    });
    const card = await within(bubble).findByTestId('tool-confirmation');
    expect(card.getAttribute('data-conf-state')).toBe('deferred');
    expect(card.textContent).toContain('Отложено');
  });

  it('GET-восстановление: открытая карточка без события в трейсе — verbatim из списка', async () => {
    seams.confirm = true;
    listToolConfirmations.mockResolvedValue([{
      callId: 'tu-99', tool: 'Bash', input: { command: 'ls -la' },
      parentCallId: null, state: 'awaiting', requestedAt: 1_800_000_500,
    }]);
    setupStream();
    render(<RuntimeScreen />);
    const bubble = await screen.findByTestId('live-run');
    await waitFor(() => expect(listToolConfirmations).toHaveBeenCalledWith('run-sdk2'));
    const card = await within(bubble).findByTestId('tool-confirmation');
    expect(card.textContent).toContain('Bash');
    expect(card.textContent).toContain('ls -la');
  });

  it('HTTP 503 SDK service_unavailable from ApiError disables tool decisions', async () => {
    seams.confirm = true;
    listToolConfirmations.mockRejectedValue(new Ai2ApiError(503, {
      error: 'service_unavailable', message: 'SDK-канал выключен на хосте',
    }));
    const emit = setupStream();
    render(<RuntimeScreen />);
    const bubble = await screen.findByTestId('live-run');
    await waitFor(() => expect(listToolConfirmations).toHaveBeenCalledWith('run-sdk2'));
    await act(async () => { emit()(reqEvent); });
    const card = await within(bubble).findByTestId('tool-confirmation');
    await waitFor(() => expect(card.getAttribute('data-state')).toBe('unavailable'));
    expect(within(card).queryByRole('button', { name: 'Разрешить' })).toBeNull();
  });

  it('причина уходит в POST verbatim', async () => {
    seams.confirm = true;
    respondToolConfirmation.mockResolvedValue({ resolved: true });
    const emit = setupStream();
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    const bubble = await screen.findByTestId('live-run');
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    await act(async () => { emit()(reqEvent); });
    const card = await within(bubble).findByTestId('tool-confirmation');
    await user.type(within(card).getByPlaceholderText(/Причина для агента/), 'не сейчас');
    await user.click(within(card).getByRole('button', { name: 'Отклонить' }));
    await waitFor(() => expect(respondToolConfirmation).toHaveBeenCalledWith('run-sdk2', 'tu-7', 'deny', 'не сейчас'));
  });

  it('POST упал → «хост не ответил» + verbatim-ошибка, карточка остаётся открытой', async () => {
    seams.confirm = true;
    respondToolConfirmation.mockRejectedValue(new Error('service_unavailable: SDK-канал выключен'));
    const emit = setupStream();
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    const bubble = await screen.findByTestId('live-run');
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    await act(async () => { emit()(reqEvent); });
    const card = await within(bubble).findByTestId('tool-confirmation');
    await user.click(within(card).getByRole('button', { name: 'Разрешить' }));
    const err = await within(card).findByTestId('confirm-error');
    expect(err.textContent).toContain('Хост не ответил');
    expect(err.textContent).toContain('SDK-канал выключен');
    expect(card.getAttribute('data-state')).toBe('open');
  });

  it('таймер считает от requestedAt до автоотказа хоста (300 с умолч.)', async () => {
    seams.confirm = true;
    const emit = setupStream();
    render(<RuntimeScreen />);
    const bubble = await screen.findByTestId('live-run');
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    await act(async () => { emit()(reqEvent); });
    const card = await within(bubble).findByTestId('tool-confirmation');
    const timer = within(card).getByTestId('confirm-timer');
    // requestedAt = ts события (1_800_000_000 — далёкое будущее) → отсчёт активен
    expect(timer.textContent).toMatch(/автоотказ через \d+:\d{2}/);
  });
});
