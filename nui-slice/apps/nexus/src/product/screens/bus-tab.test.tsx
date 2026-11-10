// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/runtime',
  useSearchParams: () => new URLSearchParams('tab=bus'),
}));

const overview = vi.fn();
const delegateTask = vi.fn();
const listSessions = vi.fn();
const getDelegation = vi.fn();
let withBus = true;
vi.mock('../data-source', () => {
  // Recompute from current `withBus` on every call; the component captures
  // `bus` by property reference, so sub-object stability within a render
  // cycle is what matters — not the outer object identity.
  const compute = () => ({
    bus: withBus ? { overview, delegateTask, listSessions, getDelegation } : undefined,
  });
  return {
    getDataSourceKind: () => 'live',
    getDataSource: compute,
    useDataSource: compute,
  };
});

import { BusTab } from './bus-tab';

const WINDOW_ROW = {
  window: 'W3', state: 'working', queue: 2, sent: 7, outbox: 20,
  currentTask: '07-bus-overview.md', sendAgeMin: 7, lastAnswerAt: 1792173912.232,
};

const OVERVIEW_OK = {
  status: 'ok' as const,
  generatedAt: 1792174271.587,
  windows: [
    WINDOW_ROW,
    { ...WINDOW_ROW, window: 'W4', state: 'idle', queue: 0, sent: 0, outbox: 3, currentTask: null, sendAgeMin: null, lastAnswerAt: null },
    { ...WINDOW_ROW, window: 'W5', state: 'long', queue: 1, sent: 4, outbox: 9, sendAgeMin: 75, lastAnswerAt: 1792173912.232 },
  ],
  watch: [
    { time: '2026-10-16 21:05:36', window: 'W1', file: '07-bus-overview.md', event: 'dispatched' },
    { time: null, window: null, file: null, event: 'watch started' },
  ],
};

const SESSIONS = [
  { id: 's-w3', window: 'W3', title: 'BUILD', kind: 'desktop', status: 'idle', lastActivityAt: 1792174200 },
  { id: 's-w4', window: 'W4', title: 'QA', kind: 'desktop', status: 'locked', lastActivityAt: null },
];

beforeEach(() => {
  withBus = true;
  overview.mockResolvedValue(OVERVIEW_OK);
  delegateTask.mockResolvedValue({
    id: 'del-9', to: 'W3', taskPath: 'queue/W3/x.md', state: 'sent',
    answerPath: null, createdAt: 1792174300,
  });
  listSessions.mockResolvedValue(SESSIONS);
  getDelegation.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  for (const fn of [overview, delegateTask, listSessions, getDelegation]) fn.mockReset();
});

describe('BusTab — «Окна и шина» (XIV W3)', () => {
  it('seam отсутствует → честный unavailable', async () => {
    withBus = false;
    render(<BusTab />);
    const tab = await screen.findByTestId('tab-bus');
    expect(tab.getAttribute('data-state')).toBe('unavailable');
    expect(tab.textContent).toContain('недоступна');
  });

  it('таблица W1–W5: состояние/очередь/задача/возраст — verbatim из overview', async () => {
    render(<BusTab />);
    const row = await screen.findByTestId('bus-window-W3');
    expect(row.textContent).toContain('РАБОТАЕТ');
    expect(row.textContent).toContain('07-bus-overview.md');
    expect(row.textContent).toContain('7 мин');
    expect(row.textContent).toContain('20');
    expect(screen.getByTestId('bus-window-W5').textContent).toContain('ДОЛГО');
    expect(screen.getByTestId('bus-window-W4').textContent).toContain('СВОБОДНА');
  });

  it('status unknown → честное «нет данных у хоста», форма остаётся', async () => {
    // У хоста нет данных → обзор 'unknown' и сессий нет: вся вкладка пустая.
    overview.mockResolvedValue({ status: 'unknown', generatedAt: 1, windows: [], watch: [] });
    listSessions.mockResolvedValue([]);
    render(<BusTab />);
    const tab = await screen.findByTestId('tab-bus');
    expect(await screen.findByText(/Нет данных у хоста/)).toBeTruthy();
    expect(tab.getAttribute('data-state')).toBe('empty');
    expect(screen.getByTestId('bus-send')).toBeTruthy();
  });

  it('overview пуст/unknown, но сессии есть → вкладка ready (часть работает)', async () => {
    overview.mockResolvedValue({ status: 'unknown', generatedAt: 1, windows: [], watch: [] });
    render(<BusTab />);
    const tab = await screen.findByTestId('tab-bus');
    await waitFor(() => expect(tab.getAttribute('data-state')).toBe('ready'));
    expect(screen.getByTestId('bus-sessions').getAttribute('data-state')).toBe('ready');
  });

  it('overview падает → error + повтор', async () => {
    overview.mockRejectedValue(new Error('boom'));
    render(<BusTab />);
    expect(await screen.findByText(/Не удалось загрузить обзор шины/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('лента дозора — verbatim event/window/file; «последние ответы» по времени', async () => {
    render(<BusTab />);
    const watch = await screen.findByTestId('bus-watch');
    expect(watch.textContent).toContain('dispatched');
    expect(watch.textContent).toContain('watch started');
    const answers = screen.getByTestId('bus-answers');
    expect(answers.textContent).toContain('W3');
    expect(answers.textContent).toContain('20 ответов');
  });

  it('форма «Отправить окну»: режим идёт в текст задачи, ответ verbatim', async () => {
    const user = userEvent.setup();
    render(<BusTab />);
    await screen.findByTestId('bus-window-W3');
    await user.selectOptions(screen.getByLabelText('Окно'), 'W3');
    await user.selectOptions(screen.getByLabelText('Режим'), 'plan');
    await user.type(screen.getByLabelText('Текст задачи для окна'), 'собери отчёт');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(delegateTask).toHaveBeenCalledWith({
      window: 'W3',
      task: '[режим: План]\n\nсобери отчёт',
    }));
    const res = await screen.findByTestId('bus-send-result');
    expect(res.textContent).toContain('del-9');
    expect(res.textContent).toContain('отправлено окну');
  });

  it('clears the bounded delegation follow-up when the tab unmounts', async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    const timerId = 424 as unknown as number;
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 4000) return timerId;
      return originalSetTimeout(handler, delay, ...args);
    }) as typeof window.setTimeout);
    const clearTimeout = vi.spyOn(window, 'clearTimeout');
    const user = userEvent.setup();
    const view = render(<BusTab />);
    const panel = await screen.findByTestId('bus-sessions');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('ready'));
    await user.type(screen.getByLabelText('Текст задачи для окна'), 'проверь ответ');
    await user.click(within(panel).getAllByRole('button', { name: 'Отправить окну' })[0]);
    await waitFor(() => expect(delegateTask).toHaveBeenCalledWith({
      window: 'W3', task: '[режим: Агент]\n\nпроверь ответ',
    }));
    expect(setTimeout.mock.calls.map(([, delay]) => delay)).toContain(4000);

    view.unmount();
    expect(clearTimeout).toHaveBeenCalledWith(timerId);
  });

  it('делегация падает → ошибка verbatim, без скрытия', async () => {
    const user = userEvent.setup();
    delegateTask.mockRejectedValue(new Error('503 шина не настроена'));
    render(<BusTab />);
    await screen.findByTestId('bus-window-W3');
    await user.type(screen.getByLabelText('Текст задачи для окна'), 'x');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText('503 шина не настроена')).toBeTruthy();
  });

  it('сессии внутри вкладки: строки + «Отправить окну» делит поле задачи с формой', async () => {
    const user = userEvent.setup();
    render(<BusTab />);
    const panel = await screen.findByTestId('bus-sessions');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('ready'));
    expect(within(panel).getByText(/W3 · BUILD/)).toBeTruthy();
    expect(within(panel).getByText(/W4 · QA/)).toBeTruthy();
    // Кнопка строки отправляет тот же текст задачи с префиксом режима.
    await user.selectOptions(screen.getByLabelText('Режим'), 'plan');
    await user.type(screen.getByLabelText('Текст задачи для окна'), 'сверь очередь');
    await user.click(within(panel).getAllByRole('button', { name: 'Отправить окну' })[0]);
    await waitFor(() => expect(delegateTask).toHaveBeenCalledWith({
      window: 'W3', task: '[режим: План]\n\nсверь очередь',
    }));
  });
});
