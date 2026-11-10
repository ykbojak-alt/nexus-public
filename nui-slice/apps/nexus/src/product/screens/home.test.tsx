// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/home',
  useSearchParams: () => new URLSearchParams(''),
}));

const startRun = vi.fn();
const streamRun = vi.fn();
const listRuns = vi.fn();
const getMetrics = vi.fn();
const listProjects = vi.fn();
const getCapabilities = vi.fn();
const voiceStt = vi.fn();
const voiceTranscribe = vi.fn();
let voiceSeam: unknown = { stt: voiceStt, transcribe: voiceTranscribe };
// XV W3 — KPI учёта: замыкания включаются точечно в тестах.
let sdkSeams: { assistantUsage?: unknown; sessions?: unknown } = {};
const HOME_DS = () => ({
  startRun, listRuns, getMetrics, streamRun,
  // VII V1.2: KPI-полоса зовёт ещё четыре seam'а — честные пустые ответы.
  listPresence: () => Promise.resolve([]),
  listAgents: () => Promise.resolve([]),
  listMemory: () => Promise.resolve([]),
  listProjects,
  getCapabilities,
  get voice() { return voiceSeam; },
  get sdkAssistantUsage() { return sdkSeams.assistantUsage; },
  get sdkSessions() { return sdkSeams.sessions; },
});
vi.mock('../data-source', () => ({
  getDataSourceKind: () => 'mock',
  getDataSource: () => HOME_DS(),
  // #418 (wave #418-2): stable reference so useAsyncValue deps don't refetch-loop.
  useDataSource: () => useMemo(HOME_DS, []),
}));

import { HomeScreen } from './home';
import { loadProfile, resetProfileStore, saveProfile } from '../profile/profile-store';
import { createEmptyProfile } from '../profile/profile-types';
import { Ai2ApiError } from '../../integrations/ai2/api/errors';

const run = (over: Partial<Record<string, unknown>> = {}) => ({
  runId: 'home1111run', taskText: 'собери отчёт по витрине', config: 'deliberate',
  status: 'running' as const, stopReason: null, agent: null, parent: null,
  project: 'nexus', model: null, costUsd: null, createdAt: 1700000000, finishedAt: null,
  ...over,
});
const metrics = {
  cpuPct: 37, ramPct: 52, diskPct: 61, gpuPct: null, uptimeS: 3600,
  counters: { modelCalls: 0, toolCalls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 },
  health: [], freshness: 'live',
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetProfileStore();
  // jsdom не даёт микрофон — стабы как в runtime.test.tsx, иначе listen-карта
  // честно unavailable по micAvailable до проверки stt на хосте.
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn() }, configurable: true,
  });
  (globalThis as Record<string, unknown>).MediaRecorder = class { };
  listRuns.mockResolvedValue([run()]);
  getMetrics.mockResolvedValue(metrics);
  listProjects.mockResolvedValue(['ai2', 'nexus-lab']);
  getCapabilities.mockResolvedValue({
    version: '1', tenant: 'local',
    features: {
      runPlanPreview: { supported: true, reason: null, via: 'GET /v1/runs/:id/plan' },
      runCheckpoints: { supported: true, reason: null },
      runPauseResume: { supported: false, reason: 'pause gate выключен на хосте' },
      runCancel: { supported: true, reason: null },
      sseStream: { supported: true, reason: null },
      webhooks: { supported: false, reason: 'webhook store не настроен' },
      memory: { supported: true, reason: null },
      worker: { supported: true, reason: null },
      approvals: { supported: true, reason: null },
      imageGen: { supported: false, reason: 'провайдер не сконфигурирован' },
      idempotentRunCreate: { supported: true, reason: null },
      runReplay: { supported: false, reason: null },
    },
    capabilityVocabulary: [], agentCapabilities: [], scopes: [], components: {}, ts: '2026-10-16T00:00:00Z',
  });
  voiceStt.mockResolvedValue({ supported: true, reason: null, model: 'whisper:base' });
  voiceTranscribe.mockResolvedValue({ text: 'голосовая задача', language: 'ru', languageProbability: 1, durationS: 1, model: 'whisper' });
  voiceSeam = { stt: voiceStt, transcribe: voiceTranscribe };
  startRun.mockResolvedValue(run({ status: 'running' }));
  // Эхо рантайма: по умолчанию поток пустой, отписка — no-op.
  streamRun.mockImplementation(() => () => { });
});

afterEach(() => {
  cleanup();
  delete (navigator as unknown as Record<string, unknown>).mediaDevices;
  delete (globalThis as Record<string, unknown>).MediaRecorder;
  sdkSeams = {};
  for (const fn of [push, startRun, streamRun, listRuns, getMetrics, listProjects, getCapabilities, voiceStt, voiceTranscribe]) fn.mockReset();
});

describe('HomeScreen — ref-parity P-1 (главная)', () => {
  it('композитор создаёт прогон и раскрывает диалог на главной', async () => {
    const user = userEvent.setup();
    render(<HomeScreen />);
    await user.type(screen.getByLabelText('Опишите задачу для ЭЛИС'), 'проверь гипотезу');
    await user.click(screen.getByRole('button', { name: /Запустить задачу/ }));
    await waitFor(() => expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      task: 'проверь гипотезу',
      config: 'baseline',
    })));
    expect(startRun.mock.calls[0][0]).not.toHaveProperty('mode');
    expect(startRun.mock.calls[0][0]).not.toHaveProperty('agent');
    expect(push).not.toHaveBeenCalled();
    expect(document.querySelector('[data-screen="home"]')?.getAttribute('data-chat-active')).toBe('true');
    const echo = await screen.findByTestId('home-runtime-echo');
    expect(echo.getAttribute('data-state')).toBeTruthy();
    expect(within(echo).getByRole('link', { name: /Открыть прогон/ }).getAttribute('href'))
      .toBe('/runtime?run=home1111run');
    // Полный сьют гоняет файлы параллельно — userEvent+waitFor под дисковой
    // нагрузкой упирались в дефолтные 5 с; изолированно тест ~3 с.
  }, 15000);

  it('диалог: размышления слева, вопрос справа, ответ на всю ширину', async () => {
    streamRun.mockImplementation((_runId: string, handlers: {
      onEvent: (e: unknown) => void;
      onDelta?: (text: string) => void;
      onEnd: (status: string) => void;
    }) => {
      handlers.onEvent({ seq: 1, type: 'run_start', role: null, ts: 1700000000, body: { runId: 'home1111run' } });
      handlers.onEvent({ seq: 2, type: 'tool_call', role: null, ts: 1700000001, body: { tool: 'memory_search', query: 'витрина' } });
      handlers.onEvent({ seq: 3, type: 'model_call', role: 'planner', ts: 1700000002, body: { text: 'план готов' } });
      handlers.onDelta?.('ОТВЕТ: готово\nУВЕРЕННОСТЬ: 0.8');
      handlers.onEnd('done');
      return () => { };
    });
    const user = userEvent.setup();
    render(<HomeScreen />);
    await user.type(screen.getByLabelText('Опишите задачу для ЭЛИС'), 'проверь');
    await user.click(screen.getByRole('button', { name: /Запустить задачу/ }));
    const echo = await screen.findByTestId('home-runtime-echo');
    const question = within(echo).getByTestId('echo-question');
    const thoughts = echo.querySelector('[data-side="left"]');
    const answer = within(echo).getByTestId('echo-answer');
    expect(question).toHaveTextContent('проверь');
    expect(question.getAttribute('data-side')).toBe('right');
    expect(thoughts).toBeTruthy();
    expect(echo.contains(answer)).toBe(true);
    // Технические имена событий и JSON в эхе не показываются — только фразы.
    expect(await within(echo).findByText('Открываю прогон')).toBeTruthy();
    expect(within(echo).getByText('Заглядываю в память')).toBeTruthy();
    expect(within(echo).getByText('Продумываю, с чего начать')).toBeTruthy();
    expect(within(echo).getByText('план готов')).toBeTruthy();
    expect(within(echo).queryByText(/run_start|tool_call|MODEL_CALL/)).toBeNull();
    // Ответ: «ОТВЕТ:» уходит в заголовок, уверенность — в пилюлю.
    expect(within(echo).getByText('готово')).toBeTruthy();
    expect(within(echo).getByText('уверенность 0.8')).toBeTruthy();
    expect(within(echo).getByText('завершён')).toBeTruthy();
    // «Закрыть» отписывает поток и возвращает приветствие.
    await user.click(within(echo).getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByTestId('home-runtime-echo')).toBeNull());
  }, 15000);

  it('эхо-вопрос и ответ отрываются целиком и возвращаются в hero', async () => {
    const user = userEvent.setup();
    render(
      <div data-app-shell>
        <div data-floating-overlay />
        <HomeScreen />
      </div>,
    );
    await user.type(screen.getByLabelText('Опишите задачу для ЭЛИС'), 'проверь перенос');
    await user.click(screen.getByRole('button', { name: /Запустить задачу/ }));
    const echo = await screen.findByTestId('home-runtime-echo');
    const shell = echo.closest<HTMLElement>('[data-app-shell]')!;
    const overlay = shell.querySelector<HTMLElement>('[data-floating-overlay]')!;
    const asRect = (left: number, top: number, width: number, height: number) => ({
      x: left, y: top, left, top, width, height, right: left + width, bottom: top + height,
      toJSON: () => ({}),
    }) as DOMRect;
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(asRect(0, 0, 1000, 700));
    vi.spyOn(echo, 'getBoundingClientRect').mockReturnValue(asRect(180, 120, 560, 240));

    fireEvent(echo.querySelector('button[aria-label^="Перетащить диалог"]')!,
      new MouseEvent('pointerdown', { button: 0, clientX: 200, clientY: 130, bubbles: true }));
    fireEvent(window, new MouseEvent('pointermove', { clientX: 300, clientY: 230 }));
    fireEvent(window, new MouseEvent('pointerup', { clientX: 300, clientY: 230 }));

    const detached = overlay.querySelector<HTMLElement>('[data-testid="home-runtime-echo"]');
    expect(detached).toBeTruthy();
    expect(within(detached!).getByTestId('echo-question').textContent).toContain('проверь перенос');
    // Оконный набор: свернуть прячет ленту, развернуть возвращает.
    fireEvent.click(within(detached!).getByRole('button', { name: 'Свернуть диалог в полосу' }));
    expect(detached!.getAttribute('data-collapsed')).toBe('true');
    // W4-1015: shrink-фаза держит тело 140ms, потом честный unmount.
    expect(detached!.querySelector('[data-collapse-anim="shrink"]')).not.toBeNull();
    await waitFor(() => expect(within(detached!).queryByTestId('echo-question')).toBeNull());
    fireEvent.click(within(detached!).getByRole('button', { name: 'Развернуть диалог' }));
    expect(detached!.getAttribute('data-collapsed')).toBeNull();
    expect(within(detached!).getByTestId('echo-question')).toBeTruthy();
    fireEvent.click(within(detached!).getByRole('button', { name: 'Вернуть диалог в AGENT-A' }));
    expect(await screen.findByTestId('home-runtime-echo')).toBeTruthy();
    expect(overlay.querySelector('[data-testid="home-runtime-echo"]')).toBeNull();
  }, 15000);

  it('W4-1015: reduced-motion — сворачивание мгновенное, без фазных кадров', async () => {
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as MediaQueryList);
    try {
      const user = userEvent.setup();
      render(
        <div data-app-shell>
          <div data-floating-overlay />
          <HomeScreen />
        </div>,
      );
      await user.type(screen.getByLabelText('Опишите задачу для ЭЛИС'), 'проверь сворачивание');
      await user.click(screen.getByRole('button', { name: /Запустить задачу/ }));
      const echo = await screen.findByTestId('home-runtime-echo');
      const shell = echo.closest<HTMLElement>('[data-app-shell]')!;
      const overlay = shell.querySelector<HTMLElement>('[data-floating-overlay]')!;
      const asRect = (left: number, top: number, width: number, height: number) => ({
        x: left, y: top, left, top, width, height, right: left + width, bottom: top + height,
        toJSON: () => ({}),
      }) as DOMRect;
      vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(asRect(0, 0, 1000, 700));
      vi.spyOn(echo, 'getBoundingClientRect').mockReturnValue(asRect(180, 120, 560, 240));

      fireEvent(echo.querySelector('button[aria-label^="Перетащить диалог"]')!,
        new MouseEvent('pointerdown', { button: 0, clientX: 200, clientY: 130, bubbles: true }));
      fireEvent(window, new MouseEvent('pointermove', { clientX: 300, clientY: 230 }));
      fireEvent(window, new MouseEvent('pointerup', { clientX: 300, clientY: 230 }));

      const detached = overlay.querySelector<HTMLElement>('[data-testid="home-runtime-echo"]');
      fireEvent.click(within(detached!).getByRole('button', { name: 'Свернуть диалог в полосу' }));
      expect(detached!.getAttribute('data-collapsed')).toBe('true');
      // Ни одного промежуточного кадра — тело уходит сразу.
      expect(detached!.querySelector('[data-collapse-anim]')).toBeNull();
      expect(within(detached!).queryByTestId('echo-question')).toBeNull();
    } finally {
      mm.mockRestore();
    }
  }, 15000);

  it('W4-1018: pointercancel у эхо-панели — честный drop, панель остаётся floating', async () => {
    const user = userEvent.setup();
    render(
      <div data-app-shell>
        <div data-floating-overlay />
        <HomeScreen />
      </div>,
    );
    await user.type(screen.getByLabelText('Опишите задачу для ЭЛИС'), 'проверь края');
    await user.click(screen.getByRole('button', { name: /Запустить задачу/ }));
    const echo = await screen.findByTestId('home-runtime-echo');
    const shell = echo.closest<HTMLElement>('[data-app-shell]')!;
    const overlay = shell.querySelector<HTMLElement>('[data-floating-overlay]')!;
    const asRect = (left: number, top: number, width: number, height: number) => ({
      x: left, y: top, left, top, width, height, right: left + width, bottom: top + height,
      toJSON: () => ({}),
    }) as DOMRect;
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(asRect(0, 0, 1000, 700));
    vi.spyOn(echo, 'getBoundingClientRect').mockReturnValue(asRect(180, 120, 560, 240));

    fireEvent(echo.querySelector('button[aria-label^="Перетащить диалог"]')!,
      new MouseEvent('pointerdown', { button: 0, clientX: 200, clientY: 130, bubbles: true }));
    fireEvent(window, new MouseEvent('pointermove', { clientX: 300, clientY: 230 }));
    // Потерянное управление (cancel) — тот же finish-путь, что и pointerup:
    // панель фиксируется floating, не телепортирует обратно в hero.
    fireEvent(window, new MouseEvent('pointercancel', { clientX: 300, clientY: 230 }));
    const detached = overlay.querySelector<HTMLElement>('[data-testid="home-runtime-echo"]');
    expect(detached).toBeTruthy();
    expect(document.body.hasAttribute('data-message-drag')).toBe(false);
    expect(detached!.hasAttribute('data-drag-lift')).toBe(false);
  }, 15000);

  it('ModeSwitch сохраняет выбор профиля, но не отправляет неподдерживаемый mode', async () => {
    const user = userEvent.setup();
    render(<HomeScreen />);
    // Три сегмента по спеке W2; переключение пишет composerMode в профиль.
    const group = screen.getByRole('radiogroup', { name: 'Режим композитора' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    await user.click(screen.getByRole('radio', { name: 'План' }));
    await waitFor(() => expect(loadProfile()?.composerMode).toBe('plan'));
    const taskInput = screen.getByLabelText('Опишите задачу для ЭЛИС');
    await user.clear(taskInput);
    await user.type(taskInput, 'спланируй сцену');
    await user.click(screen.getByRole('button', { name: /Запустить задачу/ }));
    await waitFor(() => expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'спланируй сцену', }),
    ));
    expect(startRun.mock.calls[0][0]).not.toHaveProperty('mode');
  }, 15000);

  it('показывает сообщение 422 от хоста, а не маскирует его под сбой соединения', async () => {
    startRun.mockRejectedValue(new Ai2ApiError(422, {
      error: 'validation_error',
      message: "агент 'alice' не зарегистрирован у tenant",
    }));
    const user = userEvent.setup();
    render(<HomeScreen />);
    await user.type(screen.getByLabelText('Опишите задачу для ЭЛИС'), 'проверь запуск');
    await user.click(screen.getByRole('button', { name: /Запустить задачу/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Не удалось запустить задачу: агент 'alice' не зарегистрирован у tenant",
    );
  }, 15000);

  it('рейл «Сейчас»: активный прогон verbatim → ссылка на /runtime?run=', async () => {
    render(<HomeScreen />);
    // Задача видна и в рейле «Сейчас», и в списке последних прогонов —
    // ассерт привязан к рейлу.
    const nowRail = screen.getByRole('heading', { name: 'Сейчас' }).closest('section,div')! as HTMLElement;
    const task = await within(nowRail).findByText('собери отчёт по витрине');
    expect(task).toBeTruthy();
    const link = screen.getByRole('link', { name: /Открыть прогон/ });
    expect(link.getAttribute('href')).toBe('/runtime?run=home1111run');
  });

  it('рейл «Сейчас»: без активного прогона — честный empty; ошибка seam → недоступно', async () => {
    listRuns.mockResolvedValue([run({ status: 'done' })]);
    const { unmount } = render(<HomeScreen />);
    expect(await screen.findByText(/Активных прогонов нет/)).toBeTruthy();
    unmount();
    listRuns.mockRejectedValue(new Error('down'));
    render(<HomeScreen />);
    expect(await screen.findByText(/Состояние рантайма недоступно/)).toBeTruthy();
  });

  it('рейл «Ресурсы»: метрики verbatim; ошибка → недоступно', async () => {
    render(<HomeScreen />);
    await screen.findByText('37%');
    expect(screen.getByText('52%')).toBeTruthy();
    expect(screen.getByText('61%')).toBeTruthy();
    cleanup();
    getMetrics.mockRejectedValue(new Error('down'));
    render(<HomeScreen />);
    expect(await screen.findByText('Метрики недоступны')).toBeTruthy();
  });

  const stubMicEnv = () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    (globalThis as Record<string, unknown>).MediaRecorder = class { };
  };
  const restoreMicEnv = () => {
    delete (navigator as unknown as Record<string, unknown>).mediaDevices;
    delete (globalThis as Record<string, unknown>).MediaRecorder;
  };

  it('listen-карта: seam + mic-env есть, stt supported → кнопка живая', async () => {
    stubMicEnv();
    try {
      render(<HomeScreen />);
      const card = await screen.findByTestId('listen-card');
      await waitFor(() => expect(card.getAttribute('data-state')).toBe('ready'));
      const btn = screen.getByRole('button', { name: 'Слушать голосом' });
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    } finally {
      restoreMicEnv();
    }
  });

  it('stops an active microphone recorder and stream when Home unmounts', async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });
    const recorders: Recorder[] = [];
    class Recorder {
      state: RecordingState = 'inactive';
      onstop: ((this: MediaRecorder, ev: Event) => unknown) | null = null;
      ondataavailable: ((this: MediaRecorder, ev: BlobEvent) => unknown) | null = null;
      start = vi.fn(() => { this.state = 'recording'; });
      stop = vi.fn(() => { this.state = 'inactive'; });
      constructor() { recorders.push(this); }
    }
    (globalThis as Record<string, unknown>).MediaRecorder = Recorder;

    const view = render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('listen-card').getAttribute('data-state')).toBe('ready'));
    fireEvent.click(screen.getByText('Инструменты, шаблоны и возможности'));
    await userEvent.click(screen.getByRole('button', { name: /^Голос/ }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('home-voice').textContent).toContain('Идёт запись'));

    view.unmount();
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(recorders[0].stop).toHaveBeenCalledTimes(1);
  });

  it('listen-карта: seam отсутствует / stt unsupported → честный unavailable', async () => {
    voiceSeam = undefined;
    render(<HomeScreen />);
    const card = await screen.findByTestId('listen-card');
    await waitFor(() => expect(card.getAttribute('data-state')).toBe('unavailable'));
    expect(screen.getByText(/голосовой seam не подключён/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Слушать голосом' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    voiceSeam = { stt: voiceStt, transcribe: voiceTranscribe };
    voiceStt.mockResolvedValue({ supported: false, reason: 'whisper не установлен' });
    stubMicEnv();
    try {
      render(<HomeScreen />);
      expect(await screen.findByText(/whisper не установлен/)).toBeTruthy();
    } finally {
      restoreMicEnv();
    }
  });

  it('main-delta A.5: приветствие со временем суток + «N прогонов активно»', async () => {
    render(<HomeScreen />);
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1.textContent).toMatch(/^Добр(ое утро|ый день|ый вечер|ой ночи),/);
    expect(await screen.findByText(/1 прогон активен/)).toBeTruthy();
  });

  it('main-delta A.2: чип-стартер вставляет текст в композитор без отправки', async () => {
    const user = userEvent.setup();
    render(<HomeScreen />);
    await user.click(screen.getByText('Инструменты, шаблоны и возможности'));
    await user.click(screen.getByRole('button', { name: 'Составь план миграции и оцени риски по шагам' }));
    const area = screen.getByLabelText('Опишите задачу для ЭЛИС') as HTMLTextAreaElement;
    expect(area.value).toBe('Составь план миграции и оцени риски по шагам');
    expect(startRun).not.toHaveBeenCalled();
  });

  it('main-delta A.6: sparkline CPU честно пуст на первой точке', async () => {
    render(<HomeScreen />);
    await screen.findByText('37%');
    expect(screen.getByText(/История CPU накапливается/)).toBeTruthy();
    expect(screen.queryByRole('img', { name: /Нагрузка CPU/ })).toBeNull();
  });

  it('X V3-3a: чипы возможностей verbatim — supported ссылка, unsupported disabled + reason хоста', async () => {
    const user = userEvent.setup();
    render(<HomeScreen />);
    await user.click(screen.getByText('Инструменты, шаблоны и возможности'));
    const group = await screen.findByRole('group', { name: 'Возможности рантайма' });
    // supported → ссылка на экран
    const plan = within(group).getByRole('link', { name: 'План прогона' });
    expect(plan.getAttribute('href')).toBe('/runtime');
    // unsupported → disabled-чип с причиной хоста verbatim
    const paused = within(group).getByText('Пауза/возобновление · нет данных');
    expect(paused.getAttribute('aria-disabled')).toBe('true');
    expect(paused.getAttribute('title')).toBe('pause gate выключен на хосте');
    // seam упал → блока нет вообще
    cleanup();
    getCapabilities.mockRejectedValue(new Error('down'));
    render(<HomeScreen />);
    await screen.findByText('37%');
    await waitFor(() => expect(screen.queryByTestId('capability-chips')).toBeNull());
  });

  it('X V3-3b: «Контекст» — выбор проекта памяти сохраняется в профиль', async () => {
    saveProfile({ ...createEmptyProfile(), name: 'Yury' });
    const user = userEvent.setup();
    render(<HomeScreen />);
    const contextPanel = (await screen.findByRole('heading', { name: 'Контекст' })).closest('[class]')!;
    const pick = await within(contextPanel as HTMLElement).findByRole('button', { name: /nexus-lab/ });
    expect(pick.getAttribute('aria-pressed')).toBe('false');
    await user.click(pick);
    await waitFor(() => expect(loadProfile()?.memoryProject).toBe('nexus-lab'));
    // ai2 остаётся выбранным до клика по нему; после выбора nexus-lab — он активный
    expect(loadProfile()?.name).toBe('Yury');
  });

  // XV W3 — KPI учёта: токены/стоимость из /v1/sdk/usage/assistants,
  // сессии — из /v1/sdk/sessions. Только реальные числа, иначе «нет данных».
  it('KPI учёта: токены/стоимость суммируются по ассистентам, сессии — из списка', async () => {
    sdkSeams = {
      assistantUsage: () => Promise.resolve({
        assistants: [
          {
            assistant: 'alice', runs: 2, inputTokens: 12, outputTokens: 7,
            cacheReadTokens: null, cacheCreationTokens: null, totalCostUsd: 0.5,
            durationMs: null, durationApiMs: null, numTurns: null,
            model: 'claude-x', contextFill: null, modelUsage: null,
          },
          {
            assistant: 'forge', runs: 1, inputTokens: 3, outputTokens: 1,
            cacheReadTokens: null, cacheCreationTokens: null, totalCostUsd: 0.25,
            durationMs: null, durationApiMs: null, numTurns: null,
            model: 'claude-x', contextFill: null, modelUsage: null,
          },
        ],
      }),
      sessions: { list: () => Promise.resolve([{ id: 's1' }, { id: 's2' }]) },
    };
    render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('kpi-tokens').textContent).toContain('23'));
    expect(screen.getByTestId('kpi-cost').textContent).toContain('0,75');
    expect(screen.getByTestId('kpi-sessions').textContent).toContain('2');
  });

  it('KPI учёта: 503 SDK → «нет данных» с причиной verbatim в title', async () => {
    sdkSeams = {
      assistantUsage: () => Promise.reject(new Error('SDK-канал выключен: задайте AI2_SDK_ENABLED=1')),
      sessions: { list: () => Promise.reject(new Error('SDK-канал выключен')) },
    };
    render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('kpi-tokens').textContent).toContain('нет данных'));
    expect(screen.getByTestId('kpi-tokens').getAttribute('title')).toContain('AI2_SDK_ENABLED');
    expect(screen.getByTestId('kpi-cost').getAttribute('title')).toContain('AI2_SDK_ENABLED');
    expect(screen.getByTestId('kpi-sessions').textContent).toContain('нет данных');
  });

  it('KPI учёта: seam отсутствует → «нет данных», цифры не выдуманы', async () => {
    render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('kpi-tokens').textContent).toContain('нет данных'));
    expect(screen.getByTestId('kpi-tokens').getAttribute('title')).toBe('Источник учёта не подключён');
    expect(screen.getByTestId('kpi-sessions').textContent).toContain('нет данных');
  });

  it('KPI учёта: пустая сводка ассистентов → «нет данных», не 0', async () => {
    sdkSeams = {
      assistantUsage: () => Promise.resolve({ assistants: [] }),
      sessions: { list: () => Promise.resolve([]) },
    };
    render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('kpi-tokens').textContent).toContain('нет данных'));
    expect(screen.getByTestId('kpi-cost').textContent).toContain('нет данных');
    expect(screen.getByTestId('kpi-tokens').getAttribute('title')).toContain('суммы учёта');
    expect(screen.getByTestId('kpi-cost').getAttribute('title')).toContain('суммы учёта');
  });

  it('main7: чипы-действия и карточки «Предложено для вас» заполняют композитор без отправки', async () => {
    const user = userEvent.setup();
    render(<HomeScreen />);
    const area = screen.getByLabelText('Опишите задачу для ЭЛИС') as HTMLTextAreaElement;
    await user.click(screen.getByRole('button', { name: 'Исследование' }));
    expect(area.value).toBe('Проведи исследование: ');
    expect(push).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Глубокое исследование/ }));
    expect(area.value).toBe('Проведи глубокое исследование темы: ');
    expect(push).not.toHaveBeenCalled();
  });

  it('main7: «Недавние диалоги» — реальные прогоны; «Сегодня» — честный empty без источника', async () => {
    render(<HomeScreen />);
    const conv = await screen.findByTestId('home-conversations');
    expect((await within(conv).findByText('собери отчёт по витрине'))).toBeTruthy();
    expect(within(conv).getByRole('link', { name: 'Все ↗' }).getAttribute('href')).toBe('/runtime?tab=history');
    expect(screen.getByTestId('home-today').textContent)
      .toContain('расписания и планировщика у хоста нет');
  });

  it('main7: «Граф знаний» — счётчик записей реален, связи честно «нет данных»', async () => {
    render(<HomeScreen />);
    const kg = await screen.findByTestId('home-knowledge');
    expect(await within(kg).findByText(/Записей памяти в окне: 0/)).toBeTruthy();
    expect(kg.textContent).toContain('эндпоинт графа у хоста не подключён');
  });
});
