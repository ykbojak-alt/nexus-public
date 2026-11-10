// @vitest-environment jsdom
import {
  busDelegateTask, busGetDelegation, busListSessions, cancelRun, checkpointRun, fsApprove,
  fsDeny, fsRequests, fsValidate, getMetrics, getRunControls, getRunDetail,
  getUsage, listAgents, listApprovals, listModels, listPresence, listRuns,
  listToolConfirmations, navSearch, pauseRun, previewRunPlan, replayRun,
  respondApproval, respondToolConfirmation, resumeRun, retryRun,
  chatCompact, getChatCompactionStatus, sceneGetState, seams, startRun, streamRun, voiceSpeak, voiceStt,
  voiceTranscribe,
} from './test-harness';
import { Ai2ApiError } from '../../../integrations/ai2/api/errors';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeScreen } from '../runtime';
import { resetProfileStore } from '../../profile/profile-store';
import { diffOf, emitStepOf, modelViewOf, planDagOf, restoreOpOf, waitAgentOf } from '../runtime-ops';

// Лента «Процесса»: чат, микрофон, субагенты, arch-поток, plan-DAG,
// инспектор и экспорт .md — выделено из runtime.test.tsx.

describe('RuntimeScreen chat surface (wave-8 W3-1)', () => {
  const running = {
    runId: 'run-9', taskText: 'сделай отчёт', config: 'baseline',
    status: 'running' as const, stopReason: null, agent: 'coder', parent: null,
    project: 'nexus', model: null, costUsd: null, createdAt: 100, finishedAt: null,
  };
  const doneRun = {
    runId: 'run-7', taskText: 'старый вопрос', config: 'baseline',
    status: 'done' as const, stopReason: 'done', agent: 'coder', parent: null,
    project: 'nexus', model: null, costUsd: null, createdAt: 50, finishedAt: 60,
  };

  it('submit puts the user bubble right and a live assistant bubble left', async () => {
    startRun.mockResolvedValue(running);
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    const input = await screen.findByLabelText('Текст задачи');
    await user.type(input, 'сделай отчёт');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));
    const userBubble = await screen.findByTestId('chat-user');
    expect(userBubble.getAttribute('data-side')).toBe('right');
    expect(userBubble.textContent).toContain('сделай отчёт');
    const bubble = screen.getByTestId('live-run');
    expect(bubble.getAttribute('data-side')).toBe('left');
    expect(bubble.textContent).toContain('прогон принят');
    expect(within(bubble).getByRole('status', { name: 'AGENT-A печатает…' }))
      .toHaveAttribute('data-typing-indicator', 'dots-cascade');
    expect(within(bubble).getByTestId('run-status-row').querySelector("[data-status='thinking'] [data-typing-indicator]"))
      .toHaveAttribute('data-typing-indicator', 'dots-cascade');
    // NQ-098: скроллящийся список диалога достижим с клавиатуры.
    expect(userBubble.closest('ol')!.getAttribute('tabindex')).toBe('0');
  });

  it('W3-162: empty chat shows honest onboarding; example chip fills the composer', async () => {
    startRun.mockResolvedValue(running);
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    const input = await screen.findByLabelText('Текст задачи');

    const empty = await screen.findByTestId('empty-state');
    expect(empty.textContent).toContain('Диалог пуст');
    const hints = within(empty).getAllByRole('button', { name: /Вставить пример:/ });
    expect(hints).toHaveLength(3);
    // Только реальные возможности: те же формулировки, что в продукте.
    expect(hints[2].textContent).toContain('spawn_agent');

    await user.click(hints[0]);
    expect((input as HTMLTextAreaElement).value).toBe('Расскажи, что ты умеешь');
    expect(document.activeElement).toBe(input);

    // После первого сообщения онбординг уходит.
    await user.click(screen.getByRole('button', { name: 'Запустить' }));
    await screen.findByTestId('chat-user');
    expect(screen.queryByTestId('empty-state')).toBeNull();
  });

  it('message grip detaches a bubble into the shell overlay and return restores it', async () => {
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    render(
      <div data-app-shell>
        <div data-floating-overlay />
        <RuntimeScreen />
      </div>,
    );
    const bubble = await screen.findByTestId('chat-user');
    const shell = bubble.closest<HTMLElement>('[data-app-shell]')!;
    const overlay = shell.querySelector<HTMLElement>('[data-floating-overlay]')!;
    const asRect = (left: number, top: number, width: number, height: number) => ({
      x: left, y: top, left, top, width, height, right: left + width, bottom: top + height,
      toJSON: () => ({}),
    }) as DOMRect;
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(asRect(0, 0, 1000, 700));
    vi.spyOn(bubble, 'getBoundingClientRect').mockReturnValue(asRect(200, 100, 420, 90));
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(asRect(0, 0, 1000, 700));

    const grip = within(bubble).getByRole('button', { name: /Перетащить сообщение/ });
    fireEvent(grip, new MouseEvent('pointerdown', { button: 0, clientX: 220, clientY: 110, bubbles: true }));
    fireEvent(window, new MouseEvent('pointermove', { clientX: 320, clientY: 210 }));
    fireEvent(window, new MouseEvent('pointerup', { clientX: 320, clientY: 210 }));

    const detached = overlay.querySelector<HTMLElement>('[data-floating-message]');
    expect(detached).toBeTruthy();
    expect(detached?.getAttribute('data-testid')).toBe('chat-user');
    // Оконный набор пузыря: свернуть в полосу → развернуть → закрыть в ленту.
    fireEvent.click(within(detached!).getByRole('button', { name: 'Свернуть сообщение в полосу' }));
    expect(detached?.getAttribute('data-collapsed')).toBe('true');
    expect(detached?.textContent).toContain('сделай отчёт');
    fireEvent.click(within(detached!).getByRole('button', { name: 'Развернуть сообщение' }));
    expect(detached?.getAttribute('data-collapsed')).toBeNull();
    fireEvent.click(within(detached!).getByRole('button', { name: 'Закрыть окно — вернуть сообщение в ленту' }));
    expect(await screen.findByTestId('chat-user')).toBeTruthy();
    expect(overlay.querySelector('[data-floating-message]')).toBeNull();
  });

  it('W3-146: свёрнутый stub показывает summary, Escape возвращает окно в ленту и фокус на li', async () => {
    const { overlay, grip, pev } = await dragScene();
    pev('pointerdown', { button: 0, clientX: 220, clientY: 110 }, grip);
    pev('pointermove', { clientX: 320, clientY: 210 });
    pev('pointerup', { clientX: 320, clientY: 210 });
    const detached = overlay.querySelector<HTMLElement>('[data-floating-message]')!;
    expect(detached).toBeTruthy();
    fireEvent.click(within(detached).getByRole('button', { name: 'Свернуть сообщение в полосу' }));
    await waitFor(() => expect(detached.getAttribute('data-collapsed')).toBe('true'));
    expect(detached.textContent).toContain('сделай отчёт');
    expect(detached.querySelector('[class*="bubbleStubLabel"]')!.textContent).toBe('вы');
    fireEvent.keyDown(detached, { key: 'Escape' });
    await waitFor(() => expect(overlay.querySelector('[data-floating-message]')).toBeNull());
    const restored = await screen.findByTestId('chat-user');
    expect(restored.tagName).toBe('LI');
    // Фокус возвращается на grip исходного li (isoLayout синхронно).
    expect(document.activeElement).toBe(within(restored).getByRole('button', { name: /Перетащить сообщение/ }));
  });

  it('W3-146: Tab-порядок оконных контролов — grip → collapse → close', async () => {
    const { overlay, grip, pev } = await dragScene();
    pev('pointerdown', { button: 0, clientX: 220, clientY: 110 }, grip);
    pev('pointermove', { clientX: 320, clientY: 210 });
    pev('pointerup', { clientX: 320, clientY: 210 });
    const detached = overlay.querySelector<HTMLElement>('[data-floating-message]')!;
    // W3-151 добавил действия сообщения — фильтруем только оконный набор.
    const labels = within(detached).getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'))
      .filter((l) => l != null && /Перетащить|полосу|ленту/.test(l));
    expect(labels).toEqual([
      'Перетащить сообщение; стрелки перемещают на 16 px',
      'Свернуть сообщение в полосу',
      'Закрыть окно — вернуть сообщение в ленту',
    ]);
  });

  it('W3-151: copy кладёт текст в буфер, retry шлёт повторный прогон, hide убирает локально и фокусирует ленту', async () => {
    // Повтор получает свой runId — иначе mock-одинаковость даст два
    // u-run-9 (реальный хост на retry отвечает новым прогоном).
    startRun
      .mockResolvedValueOnce({ ...running, status: 'done' })
      .mockResolvedValue({ ...running, runId: 'run-10', status: 'done' });
    // fireEvent вместо userEvent — под нагрузкой userEvent не укладывается
    // в 15-сек лимит; свой clipboard-stub держим сами (setup его перезаписал бы).
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<RuntimeScreen />);
    const input = await screen.findByLabelText('Текст задачи');
    fireEvent.change(input, { target: { value: 'сделай отчёт' } });
    fireEvent.click(screen.getByRole('button', { name: 'Запустить' }));
    const userBubble = await screen.findByTestId('chat-user');
    const actions = within(userBubble).getByTestId('msg-actions');
    // copy → clipboard API с текстом сообщения
    fireEvent.click(within(actions).getByRole('button', { name: 'Скопировать текст сообщения' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('сделай отчёт'));
    // retry → тот же send-seam, startRun зовётся повторно с текстом
    fireEvent.click(within(actions).getByRole('button', { name: 'Повторить запрос' }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(2));
    expect(startRun.mock.calls[1][0].task as string).toContain('сделай отчёт');
    // hide → сообщение пропадает локально (delete-seam у хоста нет),
    // фокус — на ленте; retry-пузырь (u-run-10) остаётся.
    fireEvent.click(within(actions).getByRole('button', { name: 'Скрыть сообщение локально' }));
    await waitFor(() =>
      expect(document.querySelector('[data-chat-message-id="u-run-9"]')).toBeNull());
    expect(document.querySelector('[data-chat-message-id="u-run-10"]')).not.toBeNull();
    expect(document.activeElement?.tagName).toBe('OL');
  });

  it('W3-151: retry при активном прогоне не пускает скрытую очередь — текст уходит черновиком', async () => {
    startRun.mockResolvedValue(running);
    render(<RuntimeScreen />);
    const input = await screen.findByLabelText('Текст задачи');
    fireEvent.change(input, { target: { value: 'сделай отчёт' } });
    fireEvent.click(screen.getByRole('button', { name: 'Запустить' }));
    const userBubble = await screen.findByTestId('chat-user');
    fireEvent.click(within(userBubble).getByRole('button', { name: 'Повторить запрос' }));
    await waitFor(() => expect((screen.getByLabelText('Текст задачи') as HTMLTextAreaElement).value).toBe('сделай отчёт'));
    expect(startRun).toHaveBeenCalledTimes(1);
  });

  const seedSelectChat = () => {
    const chat = Array.from({ length: 4 }, (_, i) => ([
      { id: `u-run-${i}`, role: 'user' as const, text: `вопрос ${i}`, status: 'done' as const, ts: 1000 + i * 60 },
      { id: `a-run-${i}`, role: 'assistant' as const, runId: `run-${i}`, status: 'done' as const, ts: 1000 + i * 60 + 30 },
    ])).flat();
    const answers = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`run-${i}`, `ответ ${i}`]));
    sessionStorage.setItem('nexus.runtime.chat.v1', JSON.stringify({ chat, traces: {}, answers }));
  };

  it('W3-160: Shift+клик выделяет диапазон; Ctrl — точечно; Esc снимает выбор', async () => {
    seedSelectChat();
    render(<RuntimeScreen />);
    await waitFor(() => expect(document.querySelector('[data-chat-message-id="u-run-0"]')).not.toBeNull());
    const first = document.querySelector('[data-chat-message-id="u-run-0"]')!;
    // Обычный клик — выделения нет: text-select не тронут.
    fireEvent.click(first);
    expect(screen.queryByTestId('bulk-bar')).toBeNull();
    // Shift+клик по первому → якорь+выбор; Shift по третьему — диапазон.
    const items = document.querySelectorAll('[data-chat-message-id]');
    const u0 = document.querySelector('[data-chat-message-id="u-run-0"]')!;
    const a1 = document.querySelector('[data-chat-message-id="a-run-1"]')!;
    const u2 = document.querySelector('[data-chat-message-id="u-run-2"]')!;
    fireEvent.click(u0, { shiftKey: true });
    fireEvent.click(u2, { shiftKey: true });
    const bar = await screen.findByTestId('bulk-bar');
    // u-run-0..u-run-2 + a-run-0..a-run-1 между ними = 5 сообщений.
    expect(bar.textContent).toContain('5 выбрано');
    expect(u0.getAttribute('data-selected')).toBe('true');
    expect(a1.getAttribute('data-selected')).toBe('true');
    expect(u2.getAttribute('data-selected')).toBe('true');
    // Ctrl+клик снимает одно из диапазона.
    fireEvent.click(a1, { ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId('bulk-bar').textContent).toContain('4 выбрано'));
    expect(a1.getAttribute('data-selected')).toBeNull();
    // Esc на ленте снимает всё.
    fireEvent.keyDown(screen.getByRole('list') ?? document.querySelector('ol.chatList')!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('bulk-bar')).toBeNull());
    expect(items.length).toBeGreaterThan(0);
  });

  it('W3-165: выделение через сообщения → текст с ролями; внутри одного — чистый', async () => {
    seedSelectChat();
    render(<RuntimeScreen />);
    await waitFor(() => expect(document.querySelector('[data-chat-message-id="u-run-0"]')).not.toBeNull());
    const clip = { setData: vi.fn() };
    const selectRange = (from: Element, to: Element) => {
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      const r = document.createRange();
      r.setStart(from, 0);
      r.setEnd(to, to.childNodes.length);
      sel.addRange(r);
    };
    const fireCopy = () => {
      const ev = new Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'clipboardData', { value: clip });
      fireEvent(ol, ev);
    };
    const u0 = document.querySelector('[data-chat-message-id="u-run-0"]')!;
    const a1 = document.querySelector('[data-chat-message-id="a-run-1"]')!;
    const ol = u0.closest('ol')!;

    // Диапазон через 4 пузыря → канонический текст с ролями, без шума
    // контролов (время/кнопки не попадают в буфер).
    selectRange(u0, a1);
    fireCopy();
    expect(clip.setData).toHaveBeenCalledTimes(1);
    const [mime, out] = clip.setData.mock.calls[0] as [string, string];
    expect(mime).toBe('text/plain');
    expect(out).toBe('Вы: вопрос 0\n\nAGENT-A: ответ 0\n\nВы: вопрос 1\n\nAGENT-A: ответ 1');

    // Внутри одного сообщения — чистый текст: handler не вмешивается.
    clip.setData.mockClear();
    selectRange(u0, u0);
    fireCopy();
    expect(clip.setData).not.toHaveBeenCalled();
  });

  it('W3-160: чекбокс действия выделяет; copy-all кладёт текст с ролями verbatim', async () => {
    seedSelectChat();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<RuntimeScreen />);
    await waitFor(() => expect(document.querySelector('[data-chat-message-id="u-run-0"]')).not.toBeNull());
    const u0 = document.querySelector('[data-chat-message-id="u-run-0"]')!;
    fireEvent.click(within(u0 as HTMLElement).getByRole('button', { name: 'Выбрать сообщение' }));
    const a0 = document.querySelector('[data-chat-message-id="a-run-0"]')!;
    fireEvent.click(within(a0 as HTMLElement).getByRole('button', { name: 'Выбрать сообщение' }));
    const bar = await screen.findByTestId('bulk-bar');
    expect(bar.textContent).toContain('2 выбрано');
    fireEvent.click(within(bar).getByRole('button', { name: 'Копировать всё' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toBe('Вы: вопрос 0\n\nAGENT-A: ответ 0');
    // aria-pressed отражает выбор
    expect(within(u0 as HTMLElement).getByRole('button', { name: 'Снять выбор сообщения' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('W3-160: hide выбранных — локально, фокус на ленте; export .md собирает фрагмент', async () => {
    seedSelectChat();
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob://x') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
    render(<RuntimeScreen />);
    await waitFor(() => expect(document.querySelector('[data-chat-message-id="u-run-0"]')).not.toBeNull());
    const u0 = document.querySelector('[data-chat-message-id="u-run-0"]')!;
    fireEvent.click(within(u0 as HTMLElement).getByRole('button', { name: 'Выбрать сообщение' }));
    const bar = await screen.findByTestId('bulk-bar');
    // export → blob-скачивание md
    const clicks: string[] = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicks.push(this.download); };
    fireEvent.click(within(bar).getByRole('button', { name: 'Экспорт .md' }));
    expect(clicks).toContain('chat-fragment.md');
    HTMLAnchorElement.prototype.click = origClick;
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    // hide → сообщение уходит, выбор снимается, фокус на OL
    fireEvent.click(within(bar).getByRole('button', { name: 'Скрыть локально' }));
    await waitFor(() => expect(document.querySelector('[data-chat-message-id="u-run-0"]')).toBeNull());
    expect(screen.queryByTestId('bulk-bar')).toBeNull();
    expect(document.activeElement?.tagName).toBe('OL');
  });

  // W4-1018 · drag края — единый харнесс: пузырь + shell/overlay + прямоугольники.
  const dragScene = async () => {
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    render(
      <div data-app-shell>
        <div data-floating-overlay />
        <RuntimeScreen />
      </div>,
    );
    const bubble = await screen.findByTestId('chat-user');
    const shell = bubble.closest<HTMLElement>('[data-app-shell]')!;
    const overlay = shell.querySelector<HTMLElement>('[data-floating-overlay]')!;
    const asRect = (left: number, top: number, width: number, height: number) => ({
      x: left, y: top, left, top, width, height, right: left + width, bottom: top + height,
      toJSON: () => ({}),
    }) as DOMRect;
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(asRect(0, 0, 1000, 700));
    vi.spyOn(bubble, 'getBoundingClientRect').mockReturnValue(asRect(200, 100, 420, 90));
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(asRect(0, 0, 1000, 700));
    const grip = within(bubble).getByRole('button', { name: /Перетащить сообщение/ });
    // `grip`/`grip2` — элементы, по умолчанию события уходят в window:
    // fireEvent принимает Document | Element | Window | Node, а не голый EventTarget.
    const pev = (type: string, opts: MouseEventInit & { pointerId?: number }, target: Element | Window = window) => {
      const ev = new MouseEvent(type, { bubbles: true, ...opts });
      if (opts.pointerId != null) Object.defineProperty(ev, 'pointerId', { value: opts.pointerId });
      fireEvent(target, ev);
    };
    return { bubble, shell, overlay, grip, pev };
  };

  it('W4-1018: pointercancel завершает drag честным drop — позиция фиксируется, без телепорта в ленту', async () => {
    const { overlay, grip, pev } = await dragScene();
    pev('pointerdown', { button: 0, clientX: 220, clientY: 110 }, grip);
    pev('pointermove', { clientX: 320, clientY: 210 });
    pev('pointercancel', { clientX: 340, clientY: 230 });
    const detached = overlay.querySelector<HTMLElement>('[data-floating-message]');
    expect(detached).toBeTruthy();
    // Коммит точки cancel: x = 200 + (340-220) = 320 → '320px' от shell-края.
    expect(detached?.style.left).toBe('320px');
    expect(document.body.hasAttribute('data-message-drag')).toBe(false);
  });

  it('W4-1018: blur окна в середине drag фиксирует текущую позицию (commit, не возврат)', async () => {
    const { overlay, grip, pev } = await dragScene();
    pev('pointerdown', { button: 0, clientX: 220, clientY: 110 }, grip);
    pev('pointermove', { clientX: 320, clientY: 210 });
    fireEvent(window, new Event('blur'));
    const detached = overlay.querySelector<HTMLElement>('[data-floating-message]');
    expect(detached).toBeTruthy();
    // Фиксируется последняя известная точка (320,210): x=200+100=300.
    expect(detached?.style.left).toBe('300px');
    expect(detached?.style.top).toBe('200px');
    expect(document.body.hasAttribute('data-message-drag')).toBe(false);
  });

  it('W4-1018: второй pointerdown во время drag игнорируется — только первый pointer ведёт окно', async () => {
    const { overlay, grip, pev } = await dragScene();
    pev('pointerdown', { button: 0, clientX: 220, clientY: 110, pointerId: 1 }, grip);
    pev('pointermove', { clientX: 300, clientY: 190, pointerId: 1 });
    // Второй палец: down на том же grip + резкий move в дальний угол — не должен увести окно.
    pev('pointerdown', { button: 0, clientX: 600, clientY: 500, pointerId: 2 }, grip);
    pev('pointermove', { clientX: 800, clientY: 640, pointerId: 2 });
    pev('pointermove', { clientX: 320, clientY: 210, pointerId: 1 });
    pev('pointerup', { clientX: 320, clientY: 210, pointerId: 1 });
    const detached = overlay.querySelector<HTMLElement>('[data-floating-message]');
    expect(detached).toBeTruthy();
    // Позиция по траектории pointerId=1 (x=300), а не pointerId=2.
    expect(detached?.style.left).toBe('300px');
    // Хвост второго пальца не оставил слушателей.
    pev('pointermove', { clientX: 900, clientY: 680, pointerId: 2 });
    expect(detached?.style.left).toBe('300px');
  });

  it('W4-1018: z-index поднимается над floating на время drag и опускается после drop', async () => {
    const { overlay, grip, pev } = await dragScene();
    // Первая сессия: detach в overlay.
    pev('pointerdown', { button: 0, clientX: 220, clientY: 110 }, grip);
    pev('pointermove', { clientX: 320, clientY: 210 });
    pev('pointerup', { clientX: 320, clientY: 210 });
    const detached = overlay.querySelector<HTMLElement>('[data-floating-message]')!;
    const asRect = (left: number, top: number, width: number, height: number) => ({
      x: left, y: top, left, top, width, height, right: left + width, bottom: top + height,
      toJSON: () => ({}),
    }) as DOMRect;
    vi.spyOn(detached, 'getBoundingClientRect').mockReturnValue(asRect(300, 200, 420, 90));
    const grip2 = within(detached).getByRole('button', { name: /Перетащить сообщение/ });
    // Вторая сессия: во время удержания z=130 над базой 120, после drop — сброшен.
    pev('pointerdown', { button: 0, clientX: 320, clientY: 210 }, grip2);
    pev('pointermove', { clientX: 420, clientY: 300 });
    expect(detached.style.zIndex).toBe('130');
    expect(detached.hasAttribute('data-drag-lift')).toBe(true);
    pev('pointerup', { clientX: 420, clientY: 300 });
    const detached2 = overlay.querySelector<HTMLElement>('[data-floating-message]')!;
    expect(detached2.style.zIndex).toBe('');
    expect(detached2.hasAttribute('data-drag-lift')).toBe(false);
  });

  it('stop action calls the host cancel seam for the attached run', async () => {
    startRun.mockResolvedValue(running);
    cancelRun.mockResolvedValue({ ...running, status: 'cancelled', stopReason: 'cancelled' });
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    await user.type(await screen.findByLabelText('Текст задачи'), 'сделай отчёт');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));
    const live = await screen.findByTestId('live-run');
    await user.click(within(live).getByRole('button', { name: 'Остановить' }));
    await waitFor(() => expect(cancelRun).toHaveBeenCalledWith('run-9'));
    await waitFor(() => expect(within(live).queryByRole('button', { name: 'Остановить' })).toBeNull());
  });

  it('stream events grow the live trace inside the assistant bubble', async () => {
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
    await waitFor(() => expect(emit).toBeTypeOf('function'));
    expect(bubble.textContent).toContain('прогон принят');
    await act(async () => {
      emit!({ seq: 1, type: 'run.start', role: 'ядро', ts: 101, body: {} });
      emit!({ seq: 2, type: 'plan.step', role: 'ядро', ts: 102, body: {} });
    });
    expect(within(bubble).getByText(/старт/)).toBeTruthy();
    expect(within(bubble).getByText(/план/)).toBeTruthy();
    // «Думает» в текущем UI — статус с индикатором печати (как выше в файле),
    // а не прежняя фраза «думает…» из старого runtime-echo.
    expect(within(bubble).getByRole('status', { name: 'AGENT-A печатает…' }))
      .toHaveAttribute('data-typing-indicator', 'dots-cascade');
  });

  it('streaming follows the tail, but preserves the reader position after scrolling up', async () => {
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    let stream: {
      onEvent: (e: unknown) => void;
      onDelta?: (text: string) => void;
      onEnd: (status: string) => void;
      onGap?: (paused: boolean) => void;
    } | null = null;
    streamRun.mockImplementation((_id?: string, cb?: {
      onEvent: (e: unknown) => void;
      onDelta?: (text: string) => void;
      onEnd: (status: string) => void;
      onGap?: (paused: boolean) => void;
    }) => {
      stream = cb!;
      return () => { };
    });
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(stream).toBeTruthy());

    const list = screen.getByTestId('runtime-chat').querySelector('ol')!;
    let top = 800;
    let height = 1000;
    Object.defineProperties(list, {
      scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = value; } },
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, get: () => 200 },
    });
    fireEvent.scroll(list);
    height = 1200;
    await act(async () => {
      stream!.onDelta?.('tail token');
      stream!.onEvent({ seq: 1, type: 'run.start', role: 'ядро', ts: 101, body: {} });
    });
    expect(top).toBe(1200);

    top = 300;
    fireEvent.scroll(list);
    height = 1600;
    await act(async () => {
      stream!.onDelta?.('more text');
      stream!.onEvent({ seq: 2, type: 'plan.step', role: 'ядро', ts: 102, body: {} });
    });
    expect(top).toBe(300);
  });

  it('shows the compacting indicator only for the host-reported triggered status', async () => {
    listRuns.mockResolvedValue([running]);
    seams.compaction = true;
    getChatCompactionStatus.mockResolvedValue({
      sessionId: running.runId,
      compaction: 'triggered',
      triggered: true,
    });
    let onEnd: ((status: string) => void) | undefined;
    streamRun.mockImplementation((_id, handlers) => {
      onEnd = handlers?.onEnd;
      return () => { };
    });
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(onEnd).toBeTypeOf('function'));

    await act(async () => { onEnd?.('done'); });
    const indicator = await screen.findByTestId('context-usage-indicator');
    await waitFor(() => expect(indicator.getAttribute('data-state')).toBe('compacting'));
    expect(indicator.textContent).toContain('Сжимаю историю…');
    expect(getChatCompactionStatus).toHaveBeenCalledWith(running.runId);
  });

  it('fs tool_call shows the verbatim root:path target — the read log the user asked for', async () => {
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
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    await act(async () => {
      emit!({
        seq: 1, type: 'tool_call', role: 'executor', ts: 101,
        body: { tool: 'read_file', input: { root: 'nexus', path: 'docs/SPEC.md' }, is_error: false },
      });
      emit!({
        seq: 2, type: 'tool_call', role: 'executor', ts: 102,
        body: { tool: 'python', input: { code: 'open("/etc/passwd")' }, is_error: false },
      });
      emit!({
        seq: 3, type: 'tool_call', role: 'executor', ts: 103,
        body: { tool: 'write_file', input: { path: 'CONTRIBUTING.md' }, is_error: true },
      });
    });
    // В чате fs-вызовы сокращены до глаголов — пути уехали в боковое окно.
    expect(bubble.textContent).toContain('читает');
    expect(bubble.textContent).toContain('пишет');
    expect(bubble.textContent).not.toContain('nexus:docs/SPEC.md');
    expect(bubble.textContent).not.toContain('/etc/passwd');
    // Боковое окно fs-активности: краткий лог с глаголами, путями verbatim
    // и меткой ошибки — только файловые вызовы, python-вызов не попадает.
    const log = screen.getByTestId('fs-log');
    expect(log.textContent).toContain('читает · nexus:docs/SPEC.md');
    expect(log.textContent).toContain('пишет · CONTRIBUTING.md · ошибка');
    expect(log.textContent).not.toContain('python');
  });

  it('terminal end swaps the trace for the stored answer, trace moves under details', async () => {
    seams.detail = true;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    getRunDetail.mockResolvedValue({
      run: { ...running, status: 'done' },
      result: { ...running, status: 'done', answer: 'Отчёт готов — 3 источника.', score: null, verified: null, durationS: null, usage: null },
      events: [],
    });
    let emit: ((e: unknown) => void) | null = null;
    let end: ((s: string) => void) | null = null;
    streamRun.mockImplementation((_id?: string, cb?: { onEvent: (e: unknown) => void; onEnd: (s: string) => void }) => {
      emit = cb!.onEvent;
      end = cb!.onEnd;
      return () => { };
    });
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    // Подписка на стрим приходит эффектом после маунта пузыря — ждём её
    // явно, иначе emit стреляет в ещё не заполненный сокет.
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    await act(async () => {
      emit!({ seq: 1, type: 'run.start', role: 'ядро', ts: 101, body: {} });
      end!('done');
    });
    expect(await screen.findByText('Отчёт готов — 3 источника.')).toBeTruthy();
    expect(getRunDetail).toHaveBeenCalledWith('run-9');
    // The trace is preserved under a collapsed details row, not erased.
    expect(screen.getByText(/ход прогона · 1 событ/)).toBeTruthy();
  });

  it('empty stored answer renders the honest not-recorded line, never a fabricated one', async () => {
    seams.detail = true;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    getRunDetail.mockResolvedValue({
      run: { ...running, status: 'done' },
      result: { ...running, status: 'done', answer: null, score: null, verified: null, durationS: null, usage: null },
      events: [],
    });
    let end: ((s: string) => void) | null = null;
    streamRun.mockImplementation((_id?: string, cb?: { onEnd: (s: string) => void }) => {
      end = cb!.onEnd;
      return () => { };
    });
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await act(async () => end!('done'));
    expect(await screen.findByText('Ответ не зафиксирован хостом.')).toBeTruthy();
  });

  it('second message carries the transcript in task — the model sees the window', async () => {
    seams.detail = true;
    const done = {
      runId: 'run-3', taskText: 'первый вопрос', config: 'baseline',
      status: 'done' as const, stopReason: 'done', agent: null, parent: null,
      project: 'nexus', model: null, costUsd: null, createdAt: 10, finishedAt: 20,
    };
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [done] : []),
    );
    getRunDetail.mockResolvedValue({
      run: done,
      result: { ...done, answer: 'первый ответ', score: null, verified: null, durationS: null, usage: null },
      events: [],
    });
    startRun.mockResolvedValue(running);
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    expect(await screen.findByText('первый вопрос')).toBeTruthy();
    expect(await screen.findByText('первый ответ')).toBeTruthy();
    await user.type(await screen.findByLabelText('Текст задачи'), 'а второй?');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));
    const sent = startRun.mock.calls[0][0].task as string;
    expect(sent).toContain('Контекст диалога:');
    expect(sent).toContain('Пользователь: первый вопрос');
    expect(sent).toContain('AGENT-A: первый ответ');
    expect(sent.endsWith('а второй?')).toBe(true);
  });

  it('restores the last completed pairs verbatim when nothing is running (W3-2)', async () => {
    seams.detail = true;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [doneRun] : []),
    );
    getRunDetail.mockResolvedValue({
      run: doneRun,
      result: { ...doneRun, answer: 'старый ответ', score: null, verified: null, durationS: null, usage: null },
      events: [],
    });
    render(<RuntimeScreen />);
    expect(await screen.findByText('старый вопрос')).toBeTruthy();
    expect(await screen.findByText('старый ответ')).toBeTruthy();
    // Restored bubble is static — no live-run marker, no stream subscription,
    // no fabricated trace for a finished run.
    const restored = screen.getByTestId('chat-assistant');
    expect(restored.getAttribute('data-side')).toBe('left');
    expect(screen.queryByTestId('live-run')).toBeNull();
    expect(streamRun).not.toHaveBeenCalled();
  });

  it('stream gap marks the live bubble stale and shows the syncing badge; resume clears both', async () => {
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [running] : []),
    );
    let stream: { onEvent: (e: unknown) => void; onEnd: (s: string) => void; onGap?: (p: boolean) => void } | null = null;
    streamRun.mockImplementation((_id?: string, cb?: typeof stream) => {
      stream = cb!;
      return () => { };
    });
    render(<RuntimeScreen />);
    const bubble = await screen.findByTestId('live-run');
    await waitFor(() => expect(stream).not.toBeNull());
    expect(bubble.getAttribute('data-freshness')).toBe('live');
    expect(within(bubble).queryByText('СИНХРОНИЗАЦИЯ')).toBeNull();

    await act(async () => { stream!.onGap?.(true); });
    expect(bubble.getAttribute('data-freshness')).toBe('stale');
    expect(within(bubble).getByText('СИНХРОНИЗАЦИЯ')).toBeTruthy();

    await act(async () => { stream!.onGap?.(false); });
    expect(bubble.getAttribute('data-freshness')).toBe('live');
    expect(within(bubble).queryByText('СИНХРОНИЗАЦИЯ')).toBeNull();
  });

  it('attach failure renders the error state with retry; retry re-attaches', async () => {
    // listRuns is shared by sibling tabs — the rejection must persist until
    // the attach path itself fails, not just whoever mounts first.
    listRuns.mockRejectedValue(new Error('host down'));
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    const panel = await screen.findByTestId('runtime-chat');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('error'));
    expect(await screen.findByText('Не удалось проверить активный прогон.')).toBeTruthy();

    listRuns.mockResolvedValue([running]);
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByTestId('live-run');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('ready'));
  });
});


describe('RuntimeScreen mic input (wave-8 W5)', () => {
  const stubMicEnv = () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    (globalThis as Record<string, unknown>).MediaRecorder = class { };
    return getUserMedia;
  };
  const restoreMicEnv = () => {
    delete (navigator as unknown as Record<string, unknown>).mediaDevices;
    delete (globalThis as Record<string, unknown>).MediaRecorder;
  };

  it('getUserMedia denial surfaces an honest error and returns to idle', async () => {
    seams.voice = true;
    stubMicEnv();
    try {
      const user = userEvent.setup();
      render(<RuntimeScreen />);
      // STT probe must resolve before the button arms — wait for the enabled state.
      const mic = await screen.findByRole('button', { name: 'Голос' });
      await waitFor(() => expect((mic as HTMLButtonElement).disabled).toBe(false));
      await user.click(mic);
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('микрофон');
      // Button back to idle — never stuck in "recording" after a denial.
      expect(mic.getAttribute('aria-pressed')).toBe('false');
      expect(mic.getAttribute('data-recording')).toBeNull();
      expect(voiceTranscribe).not.toHaveBeenCalled();
    } finally {
      restoreMicEnv();
    }
  });

  it('without getUserMedia the button stays disabled with the honest reason', async () => {
    seams.voice = true;
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    const mic = await screen.findByRole('button', { name: 'Голос' });
    await waitFor(() => expect(mic.getAttribute('title')).toContain('микрофон'));
    expect((mic as HTMLButtonElement).disabled).toBe(true);
    await user.click(mic);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});


describe('subagents-wave W3 — дочерние ссылки, шаблон, a11y новых поверхностей', () => {
  const liveRun = {
    runId: 'run-sub1', taskText: 'разбей на подзадачи', config: 'deliberate',
    status: 'running' as const, stopReason: null, agent: null, parent: null,
    project: 'nexus', model: null, costUsd: null, createdAt: 100, finishedAt: null,
  };
  const attachRun = () => {
    let cb: { onEvent: (e: unknown) => void } | undefined;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [liveRun] : []));
    streamRun.mockImplementation((_id?: string, c?: typeof cb) => { cb = c; return () => { }; });
    return { get cb() { return cb; } };
  };

  it('spawn_agent-результат → якорь «sub-N» на /run?id= дочернего прогона', async () => {
    const attached = attachRun();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());

    act(() => attached.cb!.onEvent({
      seq: 7, type: 'tool_call', role: 'executor', ts: 1700000000,
      body: { tool: 'spawn_agent', result: 'запущен суб-агент sub-1 (run_id b4c9135f0dfd480ee6a2f)' },
    }));

    const link = await screen.findByRole('link', { name: /sub-1/ });
    expect(link.getAttribute('href')).toBe('/run?id=b4c9135f0dfd480ee6a2f');
  });

  it('wait_agent-результат → ответ ребёнка + метрики в строке трейса', async () => {
    const attached = attachRun();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());

    act(() => attached.cb!.onEvent({
      seq: 8, type: 'tool_call', role: 'executor', ts: 1700000000,
      body: { tool: 'wait_agent', result: '<tool_output>готово, отчёт собран</tool_output> [sub-1: шагов 3, вызовов 7, $0.0123]' },
    }));

    const line = await screen.findByText(/ответ sub-1/);
    expect(line.textContent).toContain('готово, отчёт собран');
    expect(line.textContent).toContain('шагов 3, вызовов 7, $0.0123');
  });

  it('шаблон «⧉ субагентам» вставляет текст в композитор без отправки', async () => {
    attachRun();
    const user = userEvent.setup();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');

    await user.click(screen.getByRole('button', { name: 'Вставить шаблон делегирования субагентам' }));
    const input = screen.getByLabelText('Текст задачи') as HTMLTextAreaElement;
    expect(input.value).toContain('spawn_agent');
    expect(input.value).toContain('wait_agent');
    expect(startRun).not.toHaveBeenCalled();
  });

  it('fs-pane: список операций — list/listitem семантика', async () => {
    const attached = attachRun();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());

    act(() => attached.cb!.onEvent({
      seq: 9, type: 'tool_call', role: 'executor', ts: 1700000000,
      body: { tool: 'read_file', input: { path: 'docs/SPEC.md' }, result: { path: 'docs/SPEC.md' } },
    }));

    const log = await screen.findByTestId('fs-log');
    expect(log.getAttribute('role')).toBe('list');
    const items = within(log).getAllByRole('listitem');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain('читает');
    expect(items[0].textContent).toContain('docs/SPEC.md');
  });
});

describe('subagents-wave-2 W3 — fs-pane дерева прогона', () => {
  afterEach(() => {
    resetProfileStore();
    globalThis.localStorage?.clear();
  });

  it('ops дочернего прогона — группа sub-N под родительскими (?parent= wire)', async () => {
    seams.detail = true;
    const liveRun = {
      runId: 'run-parent1', taskText: 'оркестр', config: 'deliberate',
      status: 'running' as const, stopReason: null, agent: null, parent: null,
      project: 'nexus', model: null, costUsd: null, createdAt: 100, finishedAt: null,
    };
    let cb: { onEvent: (e: unknown) => void } | undefined;
    listRuns.mockImplementation((opts?: { limit?: number; parent?: string }) => {
      if (opts?.parent === 'run-parent1') {
        return Promise.resolve([{ ...liveRun, runId: 'child9a9b9c9d', status: 'done' as const, parent: 'run-parent1' }]);
      }
      return Promise.resolve(opts?.limit === 20 ? [liveRun] : []);
    });
    streamRun.mockImplementation((_id?: string, c?: typeof cb) => { cb = c; return () => { }; });
    getRunDetail.mockResolvedValue({
      run: { ...liveRun, runId: 'child9a9b9c9d', parent: 'run-parent1' },
      result: null,
      events: [
        { seq: 0, type: 'spawn', role: null, ts: 1, body: { parent_run_id: 'run-parent1', handle: 'sub-1' } },
        { seq: 2, type: 'tool_call', role: 'executor', ts: 2, body: { tool: 'write_file', input: { path: 'out/report.md' } } },
      ],
    });

    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(cb).toBeTruthy());

    act(() => cb!.onEvent({
      seq: 3, type: 'tool_call', role: 'executor', ts: 3,
      body: { tool: 'read_file', input: { path: 'docs/SPEC.md' } },
    }));

    const pane = await screen.findByTestId('fs-pane');
    await waitFor(() => expect(pane.getAttribute('data-state')).toBe('ready'));
    await waitFor(() => expect(listRuns).toHaveBeenCalledWith(expect.objectContaining({ parent: 'run-parent1' })));
    await waitFor(() => expect(getRunDetail).toHaveBeenCalledWith('child9a9b9c9d'));
    await waitFor(() => expect(pane.textContent).toContain('sub-1 · child9a9'));
    expect(pane.textContent).toContain('пишет · out/report.md');
    expect(pane.textContent).toContain('читает · docs/SPEC.md');
  });
});


describe('arch-wave U1 — dual-path wait_agent, restore/diff, emit_step', () => {
  const liveRun = {
    runId: 'run-arch1', taskText: 'оркестр', config: 'deliberate',
    status: 'running' as const, stopReason: null, agent: null, parent: null,
    project: 'nexus', model: null, costUsd: null, createdAt: 100, finishedAt: null,
  };
  const attachRun = () => {
    let cb: { onEvent: (e: unknown) => void } | undefined;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [liveRun] : []));
    streamRun.mockImplementation((_id?: string, c?: typeof cb) => { cb = c; return () => { }; });
    return { get cb() { return cb; } };
  };

  it('waitAgentOf — структурированный result (B3): поля verbatim, метрики собраны', () => {
    const w = waitAgentOf({
      tool: 'wait_agent',
      result: { handle: 'sub-2', answer: 'Сводка готова', steps: 4, model_calls: 9, cost_usd: 0.02 },
    });
    expect(w).not.toBeNull();
    expect(w!.handle).toBe('sub-2');
    expect(w!.answer).toBe('Сводка готова');
    expect(w!.metrics).toContain('шагов 4');
    expect(w!.metrics).toContain('вызовов 9');
    expect(w!.metrics).toContain('$0.02');
  });

  it('waitAgentOf — текстовый result (fallback) и мусор → null без выдумок', () => {
    const w = waitAgentOf({ tool: 'wait_agent', result: 'ответ [sub-3: шагов 1, $0.01]' });
    expect(w?.handle).toBe('sub-3');
    expect(w?.answer).toBe('ответ');
    expect(waitAgentOf({ tool: 'wait_agent', result: { nope: true } })).toBeNull();
    expect(waitAgentOf({ tool: 'wait_agent', result: 'нет сводки' })).toBeNull();
  });

  it('emit_step событие → метка планировщика + verbatim-текст шага в трейсе', async () => {
    const attached = attachRun();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());

    act(() => attached.cb!.onEvent({
      seq: 9, type: 'emit_step', role: 'planner', ts: 1700000000,
      body: { id: 's2', step: 'проверить контур памяти', depends_on: ['s1'] },
    }));

    const line = await screen.findByText(/шаг планировщика/);
    expect(line.textContent).toContain('s2 · проверить контур памяти');
    expect(line.textContent).toContain('(после s1)');
    expect(emitStepOf({})).toBeNull();
  });

  it('restore_file → аффорданс «↩ восстановлено · path»; apply_patch diff → чип ⋯ diff', async () => {
    const attached = attachRun();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());

    act(() => attached.cb!.onEvent({
      seq: 10, type: 'tool_call', role: 'executor', ts: 1700000001,
      body: { tool: 'restore_file', input: { root: 'work', path: 'ai2/runtime/perception.py' } },
    }));
    act(() => attached.cb!.onEvent({
      seq: 11, type: 'tool_call', role: 'executor', ts: 1700000002,
      body: { tool: 'apply_patch', input: { path: 'src/a.ts' }, result: { diff: '@@ -1 +1 @@\n-old\n+new', before_bytes: 1200, after_bytes: 4 } },
    }));

    const line = await screen.findByText(/↩ восстановлено/);
    expect(line.textContent).toContain('work:ai2/runtime/perception.py');
    const chip = await screen.findByText(/⋯ diff/);
    expect(chip.textContent).toContain('1200 Б → 4 Б');
    expect(restoreOpOf({ tool: 'write_file', input: { path: 'x' } })).toBeNull();
    expect(diffOf({ tool: 'write_file', result: 'plain ok' })).toBeNull();
  });

  it('read_files → пакетный target из paths[]; fs-pane ведёт новые глаголы', async () => {
    const attached = attachRun();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());

    act(() => attached.cb!.onEvent({
      seq: 12, type: 'tool_call', role: 'executor', ts: 1700000003,
      body: { tool: 'read_files', input: { root: 'nexus', paths: ['a.md', 'b.md', 'c.md', 'd.md'] } },
    }));

    const pane = await screen.findByTestId('fs-pane');
    await waitFor(() => expect(pane.textContent).toContain('читает · nexus:a.md'));
    expect(pane.textContent).toContain('+1');
  });
});


describe('neu-ux-wave W5 — U-1 plan-DAG, U-4 инспектор, U-5 бюджет-метр', () => {
  const liveRun = {
    runId: 'run-neu1', taskText: 'планируй', config: 'deliberate',
    status: 'running' as const, stopReason: null, agent: null, parent: null,
    project: 'nexus', model: null, costUsd: null, createdAt: 100, finishedAt: null,
  };
  const attachRun = () => {
    let cb: { onEvent: (e: unknown) => void } | undefined;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [liveRun] : []));
    streamRun.mockImplementation((_id?: string, c?: typeof cb) => { cb = c; return () => { }; });
    return { get cb() { return cb; } };
  };

  it('U-1: plan-событие → plan-dag с узлами verbatim, depends_on и статусами', async () => {
    const attached = attachRun();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());

    act(() => attached.cb!.onEvent({
      seq: 3, type: 'plan', role: 'planner', ts: 1700000000,
      body: {
        steps: [
          { id: 's1', step: 'собрать факты', depends_on: [] },
          { id: 's2', step: 'свести ответ', depends_on: ['s1'] },
        ],
      },
    }));
    act(() => attached.cb!.onEvent({
      seq: 4, type: 'emit_step', role: 'planner', ts: 1700000001,
      body: { id: 's1', step: 'собрать факты', status: 'started' },
    }));
    act(() => attached.cb!.onEvent({
      seq: 5, type: 'task_step', role: 'executor', ts: 1700000002,
      body: { step_id: 's1', status: 'done' },
    }));

    const dag = await screen.findByTestId('plan-dag');
    expect(dag.textContent).toContain('собрать факты');
    expect(dag.textContent).toContain('свести ответ');
    expect(dag.textContent).toContain('s1');
    // task_step(done) — финальная правда статуса; второй шаг ждёт
    const items = dag.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute('data-status')).toBe('done');
    expect(items[1].getAttribute('data-status')).toBe('pending');
  });

  it('U-1: emit_step без plan-записи — fallback-узлы verbatim; пусто → без plan-dag', async () => {
    const attached = attachRun();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());

    expect(screen.queryByTestId('plan-dag')).toBeNull();
    act(() => attached.cb!.onEvent({
      seq: 6, type: 'emit_step', role: 'planner', ts: 1700000003,
      body: { id: 'e1', step: 'шаг из emit_step' },
    }));
    const dag = await screen.findByTestId('plan-dag');
    expect(dag.textContent).toContain('шаг из emit_step');
    // emit_step-only трейс: единственный шаг — active (последний), не «done»
    expect(dag.querySelector('li')!.getAttribute('data-status')).toBe('active');
    // unit-уровень: нет событий → [], мусорные шаги не синтезируются
    expect(planDagOf([])).toEqual([]);
    expect(planDagOf([{ seq: 1, type: 'plan', role: 'planner', ts: 1, body: { steps: 'oops' } } as never])).toEqual([]);
  });

  it('U-4: инспектор «что видит модель» — fs_policy/tools/limits verbatim с источником', async () => {
    const attached = attachRun();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());

    expect(screen.queryByTestId('model-view')).toBeNull();
    act(() => attached.cb!.onEvent({
      seq: 2, type: 'config', role: 'system', ts: 1699999999,
      body: {
        fs_policy: { mode: 'read_only', roots: [{ path: 'D:/<repo>', access: 'ro' }] },
        tools: ['read_file', 'list_files'],
        capabilities: ['files'],
        limits: { max_tokens: 8000, max_cost_usd: 0.5 },
      },
    }));

    const view = await screen.findByTestId('model-view');
    expect(view.textContent).toContain('read_only');
    expect(view.textContent).toContain('D:/<repo>:ro');
    expect(view.textContent).toContain('read_file');
    expect(view.textContent).toContain('config.fs_policy');
    expect(view.textContent).toContain('tokens ≤ 8');
    // отсутствующие поля не выдумываются
    expect(modelViewOf([{ seq: 1, type: 'model_call', role: 'executor', ts: 1, body: {} } as never])).toEqual([]);
  });

  it('U-5: budget-meter — факт vs лимиты; без лимитов метр не рисуется', async () => {
    const attached = attachRun();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());

    expect(screen.queryByTestId('budget-meter')).toBeNull();
    act(() => attached.cb!.onEvent({
      seq: 2, type: 'config', role: 'system', ts: 1699999999,
      body: { limits: { max_tokens: 1000, max_cost_usd: 0.05 } },
    }));
    act(() => attached.cb!.onEvent({
      seq: 7, type: 'model_call', role: 'executor', ts: 1700000005,
      body: { tokens_in: 300, tokens_out: 100, cost_usd: 0.01 },
    }));

    const meter = await screen.findByTestId('budget-meter');
    expect(meter.textContent).toContain('токены');
    expect(meter.textContent).toContain('400 / 1');
    expect(meter.textContent).toContain('cost');
  });
});


describe('neu-ux-wave — U-1 DAG плана, U-5 бюджет-метр, U-3 approval-inbox', () => {
  const liveRun = {
    runId: 'run-ux1', taskText: 'ux-задача', config: 'deliberate',
    status: 'running' as const, stopReason: null, agent: null, parent: null,
    project: 'nexus', model: null, costUsd: null, createdAt: 100, finishedAt: null,
  };
  const attachRun = () => {
    let cb: { onEvent: (e: unknown) => void } | undefined;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [liveRun] : []));
    streamRun.mockImplementation((_id?: string, c?: typeof cb) => { cb = c; return () => { }; });
    return { get cb() { return cb; } };
  };

  it('U-1: emit_step → вертикальный план — последний «в работе», предыдущие завершены', async () => {
    const attached = attachRun();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());

    act(() => {
      attached.cb!.onEvent({
        seq: 2, type: 'emit_step', role: 'planner', ts: 1700000000,
        body: { id: 's1', step: 'собрать контекст' },
      });
      attached.cb!.onEvent({
        seq: 3, type: 'emit_step', role: 'planner', ts: 1700000001,
        body: { id: 's2', step: 'применить патч', depends_on: ['s1'] },
      });
    });

    const dag = await screen.findByTestId('plan-dag');
    const items = within(dag).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('s1 · собрать контекст');
    expect(items[0].getAttribute('data-status')).toBe('done');
    expect(items[1].textContent).toContain('s2 · применить патч');
    expect(items[1].textContent).toContain('(после s1)');
    expect(items[1].getAttribute('data-status')).toBe('active');
  });

  it('U-5: usage + лимиты config → бюджет-метр «факт / лимит»; без лимитов — нет метра', async () => {
    const attached = attachRun();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());

    // Без лимитов метра нет — нет «прогресса к бесконечности».
    act(() => attached.cb!.onEvent({
      seq: 2, type: 'model_call', role: 'executor', ts: 1700000000,
      body: { tokens_in: 100, tokens_out: 50, cost_usd: 0.001 },
    }));
    await waitFor(() => expect(screen.getByTestId('run-usage')).toBeTruthy());
    expect(screen.queryByTestId('budget-meter')).toBeNull();

    act(() => attached.cb!.onEvent({
      seq: 3, type: 'config', role: null, ts: 1700000001,
      body: { limits: { max_tokens: 1000, max_cost_usd: 0.01 } },
    }));
    const meter = await screen.findByTestId('budget-meter');
    // ru-RU: разделитель тысяч — пробел, десятичный — запятая.
    expect(meter.textContent).toMatch(/150 \/ 1.000/);
    expect(meter.textContent).toContain('0,001 / 0,01');
  });

  it('U-3: fs_request → заявка в инбоксе; resolved → «нет ожидающих заявок»', async () => {
    seams.fs = true;
    const attached = attachRun();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());

    const inbox = await screen.findByTestId('approval-inbox');
    expect(inbox.textContent).toContain('нет ожидающих заявок');

    act(() => attached.cb!.onEvent({
      seq: 5, type: 'fs_request', role: null, ts: 1700000000,
      body: { request_id: 'fsr-ux', root: 'nexus', path: 'docs/X.md', op: 'write', size: 64, sha256: 'ff00aa11bb22', preview: 'chunk' },
    }));
    await waitFor(() => expect(inbox.textContent).toContain('docs/X.md'));
    expect(inbox.textContent).toContain('write');
    expect(inbox.textContent).toContain('chunk');
    expect(within(inbox).getByRole('button', { name: 'Разрешить' })).toBeTruthy();

    act(() => attached.cb!.onEvent({
      seq: 6, type: 'fs_request_resolved', role: null, ts: 1700000010,
      body: { request_id: 'fsr-ux', decision: 'approved' },
    }));
    await waitFor(() => expect(inbox.textContent).toContain('нет ожидающих заявок'));
  });
});


describe('neu-ux-wave — U-4 инспектор, U-6 экспорт .md', () => {
  const liveRun = {
    runId: 'run-ux2', taskText: 'инспекция', config: 'deliberate',
    status: 'running' as const, stopReason: null, agent: null, parent: null,
    project: 'nexus', model: null, costUsd: null, createdAt: 100, finishedAt: null,
  };
  const attachRun = () => {
    let cb: { onEvent: (e: unknown) => void } | undefined;
    listRuns.mockImplementation((opts?: { limit?: number }) =>
      Promise.resolve(opts?.limit === 20 ? [liveRun] : []));
    streamRun.mockImplementation((_id?: string, c?: typeof cb) => { cb = c; return () => { }; });
    return { get cb() { return cb; } };
  };

  it('U-4: config → таблица «что видит модель» (fs_policy/limits verbatim + источник)', async () => {
    const attached = attachRun();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());

    // Без config-события — инспектор не рисуется (нет данных → нет панели).
    expect(screen.queryByTestId('model-view')).toBeNull();

    act(() => attached.cb!.onEvent({
      seq: 2, type: 'config', role: null, ts: 1700000000,
      body: {
        tools: ['fs_read', 'fs_write'],
        limits: { max_tokens: 5000, max_cost_usd: 0.5 },
        fs_policy: { mode: 'read_write', roots: [{ path: 'D:/work', access: 'rw' }] },
      },
    }));

    const view = await screen.findByTestId('model-view');
    expect(view.textContent).toContain('fs_policy');
    expect(view.textContent).toContain('read_write');
    expect(view.textContent).toContain('D:/work:rw');
    expect(view.textContent).toContain('fs_read, fs_write');
    expect(view.textContent).toContain('config.tools');
    expect(view.textContent).toContain('config.limits');
    expect(view.textContent).toContain('tokens ≤ 5');
  });

  it('U-6: кнопка .md собирает отчёт — задача, шаги, fs-операции, ответ', async () => {
    const attached = attachRun();
    const created = vi.fn(() => 'blob:fake');
    const revoked = vi.fn(() => { });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }));
    let md = '';
    const origBlob = globalThis.Blob;
    vi.stubGlobal('Blob', class extends origBlob {
      constructor(parts?: BlobPart[], o?: BlobPropertyBag) {
        super(parts, o);
        md = (parts ?? []).map((p) => String(p)).join('');
      }
    });
    const clicked: string[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') el.click = () => clicked.push((el as HTMLAnchorElement).download);
      return el;
    }) as typeof document.createElement);

    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());
    act(() => {
      attached.cb!.onEvent({ seq: 2, type: 'emit_step', role: 'planner', ts: 1, body: { id: 's1', step: 'шаг раз' } });
      attached.cb!.onEvent({
        seq: 3, type: 'tool_call', role: 'executor', ts: 2,
        body: { tool: 'write_file', input: { path: 'D:/work/out.txt' } },
      });
      attached.cb!.onEvent({ seq: 4, type: 'final', role: null, ts: 3, body: { usage: { tokens: 42, cost_usd: 0.002, model_calls: 1, tool_calls: 1 } } });
    });

    const btn = await screen.findByRole('button', { name: /Экспортировать прогон/ });
    act(() => btn.click());
    expect(clicked).toEqual(['run-run-ux2.md']);
    expect(md).toContain('# Прогон:');
    expect(md).toContain('шаг раз');
    expect(md).toContain('D:/work/out.txt');
    expect(md).toContain('токены: 42');
    expect(created).toHaveBeenCalled();
    expect(revoked).toHaveBeenCalledWith('blob:fake');
    vi.unstubAllGlobals();
  });
});


describe('neu-refs3 R-W3.1 — workflow-canvas вкладка плана', () => {
  it('переключатель «канвас» монтирует PlanDag с узлами verbatim', async () => {
    const attached = (() => {
      let cb: { onEvent: (e: unknown) => void } | undefined;
      const r = {
        runId: 'run-dag', taskText: 'план', config: 'baseline', status: 'running' as const,
        stopReason: null, agent: null, parent: null, project: 'nexus',
        model: null, costUsd: null, createdAt: 100, finishedAt: null,
      };
      listRuns.mockImplementation((opts?: { limit?: number }) =>
        Promise.resolve(opts?.limit === 20 ? [r] : []));
      streamRun.mockImplementation((_id?: string, c?: typeof cb) => { cb = c; return () => { }; });
      return { get cb() { return cb; } };
    })();
    render(<RuntimeScreen />);
    await screen.findByTestId('live-run');
    await waitFor(() => expect(attached.cb).toBeTruthy());
    act(() => {
      attached.cb!.onEvent({ seq: 1, type: 'emit_step', role: 'planner', ts: 1, body: { id: 's1', step: 'собрать данные' } });
      attached.cb!.onEvent({ seq: 2, type: 'emit_step', role: 'planner', ts: 2, body: { id: 's2', step: 'свести отчёт', depends_on: ['s1'] } });
    });
    await screen.findByTestId('plan-dag');
    const canvasBtn = screen.getByRole('button', { name: 'канвас' });
    act(() => canvasBtn.click());
    // PlanDag рисует узлы как <g data-node> + рёбра depends_on.
    await waitFor(() => {
      expect(document.querySelector('[data-node="s1"]')).toBeTruthy();
      expect(document.querySelector('[data-node="s2"]')).toBeTruthy();
      expect(document.querySelector('[data-edge="s1->s2"]')).toBeTruthy();
    });
    expect(document.querySelector('[data-node="s2"] [aria-label], [data-node="s2"] title')).toBeTruthy();
  });
});


describe('W3-133 — live chat compaction over the host seam', () => {
  /** 17 независимых пар user/assistant = 34 сообщения поверх порога;
   *  восстановление идёт через sessionStorage-снапшот без живых прогонов. */
  const seedChat = () => {
    const chat = Array.from({ length: 17 }, (_, i) => ([
      { id: `u-run-${i}`, role: 'user' as const, text: `вопрос ${i}`, status: 'done' as const, ts: 1000 + i * 60 },
      { id: `a-run-${i}`, role: 'assistant' as const, runId: `run-${i}`, status: 'done' as const, ts: 1000 + i * 60 + 30 },
    ])).flat();
    sessionStorage.setItem('nexus.runtime.chat.v1', JSON.stringify({ chat, traces: {}, answers: {} }));
  };

  it('«Сжать историю» вызывает живой seam со всеми run_ids и сворачивает покрытые', async () => {
    seams.compaction = true;
    seedChat();
    chatCompact.mockResolvedValue({
      compacted: true,
      compactId: 'cmp-live',
      threadId: 'thread_deadbeef',
      summary: 'Сводка от живого хоста.',
      coversMessageIds: ['run-0:task', 'run-0:answer'],
      keptMessageIds: [],
      createdAt: '2026-10-20T12:00:00Z',
    });
    const user = userEvent.setup();
    render(<RuntimeScreen />);

    const button = await screen.findByRole('button', { name: 'Сжать историю' });
    // Локальный визуальный fallback уступает живому seam.
    expect(screen.queryByTestId('local-chat-compaction')).toBeNull();
    await user.click(button);

    await waitFor(() => expect(chatCompact).toHaveBeenCalledTimes(1));
    expect(chatCompact).toHaveBeenCalledWith({
      runIds: Array.from({ length: 17 }, (_, i) => `run-${i}`),
    });
    expect(await screen.findByTestId('chat-compact-block')).toBeTruthy();
    expect(screen.getByText('Сводка от живого хоста.')).toBeTruthy();
    expect(screen.getByTestId('chat-compacted-count').textContent).toBe('2 сообщений сжато');
    // Покрытое сообщение убрано из ленты — его текст остаётся только в
    // свёрнутом covered-списке компакт-ноды (W3-156: expand покажет его).
    await waitFor(() => {
      const covered = screen.queryByText('вопрос 0');
      expect(covered?.closest('[aria-hidden="true"]')).toBeTruthy();
    });
    expect(screen.getByText('вопрос 1')).toBeTruthy();
  });

  it('honest noop verdict («history_fits») renders verbatim, no fake block', async () => {
    seams.compaction = true;
    seedChat();
    chatCompact.mockResolvedValue({
      compacted: false,
      reason: 'history_fits',
      threadId: 'thread_fits',
      coversMessageIds: [],
      keptMessageIds: ['run-16:task', 'run-16:answer'],
    });
    const user = userEvent.setup();
    render(<RuntimeScreen />);

    const button = await screen.findByRole('button', { name: 'Сжать историю' });
    await user.click(button);
    await waitFor(() => expect(chatCompact).toHaveBeenCalledTimes(1));
    const block = await screen.findByTestId('chat-compaction');
    expect(block.getAttribute('data-state')).toBe('noop');
    expect(block.textContent).toContain('history_fits');
    expect(screen.queryByTestId('chat-compact-block')).toBeNull();
    expect(screen.getByText('вопрос 0')).toBeTruthy();
  });

  it('HTTP 503/409 surface as inline errors — the feed does not break', async () => {
    seams.compaction = true;
    seedChat();
    chatCompact.mockRejectedValue(new Ai2ApiError(503, { error: 'unavailable', message: 'summary_model_unavailable' }));
    const user = userEvent.setup();
    render(<RuntimeScreen />);

    const button = await screen.findByRole('button', { name: 'Сжать историю' });
    await user.click(button);
    await waitFor(() => expect(chatCompact).toHaveBeenCalledTimes(1));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('HTTP 503');
    expect(alert.textContent).toContain('summary_model_unavailable');
    expect(screen.getByTestId('chat-compaction').getAttribute('data-state')).toBe('failed');
    expect(screen.getByText('вопрос 0')).toBeTruthy();
  });
});
