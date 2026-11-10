// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sdkList = vi.fn();
const sdkPatch = vi.fn();
const sdkFork = vi.fn();
const sdkRun = vi.fn();
const sdkUsage = vi.fn();
let sdkSeam: unknown;

const AGENT_SES_DS = () => ({ sdkSessions: sdkSeam });
vi.mock('../data-source', () => ({
  getDataSourceKind: () => 'live',
  getDataSource: () => AGENT_SES_DS(),
  // #418 (wave #418-2): stable for useAsyncValue deps
  useDataSource: () => AGENT_SES_DS(),
}));

import { AgentSessionsPanel } from './agent-sessions';

afterEach(() => {
  cleanup();
  sdkSeam = undefined;
  sdkList.mockReset();
  sdkPatch.mockReset();
  sdkFork.mockReset();
  sdkRun.mockReset();
  sdkUsage.mockReset();
});

const seamOn = () => {
  sdkSeam = { list: sdkList, patch: sdkPatch, fork: sdkFork, run: sdkRun, usage: sdkUsage };
};

// ФИКСТУРЫ: строки сессий собраны вручную по контракту draft
// (GET /v1/sdk/sessions → ai2/sdk_sessions.py list_sessions).
const SESSION_FIXTURE = {
  id: 'sess-42', window: 'sdk', kind: 'sdk',
  title: 'почини тесты', status: 'busy',
  lastActivityAt: 1_792_160_000_000, messageCount: null,
  parent: { sessionId: 'sess-1', atMessage: 'msg-7' }, archived: false,
};

describe('AgentSessionsPanel — «Сессии агента» (XIV W3)', () => {
  it('seam отсутствует → честный unavailable без списка', () => {
    render(<AgentSessionsPanel />);
    const panel = screen.getByTestId('agent-sessions');
    expect(panel.getAttribute('data-state')).toBe('unavailable');
    expect(panel.textContent).toMatch(/сессии агента у источника не подключены/i);
  });

  it('список: заголовок/время/статус/сообщений verbatim; null → «—», parent → «ветка»', async () => {
    seamOn();
    sdkList.mockResolvedValue([SESSION_FIXTURE]);
    render(<AgentSessionsPanel />);
    const row = await screen.findByTestId('session-sess-42');
    expect(row.textContent).toContain('почини тесты');
    expect(row.textContent).toContain('занята');
    expect(row.textContent).toContain('ветка');
    expect(row.textContent).toContain('сообщений: —');
    expect(sdkList).toHaveBeenCalledWith(expect.objectContaining({ archived: false, limit: 50 }));
  });

  it('архивные: тогл переспрашивает с archived=true, маркер «архив»', async () => {
    seamOn();
    sdkList.mockResolvedValue([{ ...SESSION_FIXTURE, archived: true }]);
    const user = userEvent.setup();
    render(<AgentSessionsPanel />);
    await user.click(screen.getByRole('button', { name: 'Показать архивные' }));
    await waitFor(() => expect(sdkList).toHaveBeenCalledWith(expect.objectContaining({ archived: true })));
    const row = await screen.findByTestId('session-sess-42');
    expect(row.textContent).toContain('архив');
  });

  it('пустой список → честное «сессий нет», заглушек нет', async () => {
    seamOn();
    sdkList.mockResolvedValue([]);
    render(<AgentSessionsPanel />);
    const panel = screen.getByTestId('agent-sessions');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('empty'));
    expect(panel.textContent).toContain('Сессий агента нет.');
    expect(panel.querySelector('[data-testid^="session-"]')).toBeNull();
  });

  it('ошибка хоста → «хост не ответил» verbatim + повтор', async () => {
    seamOn();
    sdkList.mockRejectedValueOnce(new Error('SDK-канал выключен (AI2_SDK_ENABLED)'));
    sdkList.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<AgentSessionsPanel />);
    const panel = screen.getByTestId('agent-sessions');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('error'));
    expect(panel.textContent).toContain('AI2_SDK_ENABLED');
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('empty'));
  });

  it('«Продолжить» → run {task, resume:id}; хэндл verbatim в статусе', async () => {
    seamOn();
    sdkList.mockResolvedValue([SESSION_FIXTURE]);
    sdkRun.mockResolvedValue({ id: 'sdk-9', to: 'claude-sdk', state: 'sent', createdAt: 1 });
    const user = userEvent.setup();
    render(<AgentSessionsPanel />);
    const row = await screen.findByTestId('session-sess-42');
    await user.click(within(row).getByRole('button', { name: 'Продолжить' }));
    await user.type(within(row).getByPlaceholderText(/Текст следующего сообщения/), 'продолжи работу');
    const submits = within(row).getAllByRole('button', { name: 'Продолжить' });
    await user.click(submits[submits.length - 1]);
    await waitFor(() => expect(sdkRun).toHaveBeenCalledWith({ task: 'продолжи работу', resume: 'sess-42' }));
    const res = await within(row).findByTestId('session-run');
    expect(res.textContent).toContain('sdk-9');
    expect(res.textContent).toContain('sent');
  });

  it('«Ветка» → fork с atMessage+key verbatim; ответ verbatim', async () => {
    seamOn();
    sdkList.mockResolvedValue([SESSION_FIXTURE]);
    sdkFork.mockResolvedValue({
      id: 'sdk-11', parentSessionId: 'sess-42', atMessage: 'msg-7',
      key: 'k', childSessionId: null, state: 'pending',
    });
    const user = userEvent.setup();
    render(<AgentSessionsPanel />);
    const row = await screen.findByTestId('session-sess-42');
    await user.click(within(row).getByRole('button', { name: 'Ветка' }));
    await user.type(within(row).getByPlaceholderText(/Текст следующего сообщения/), 'новая ветка');
    await user.type(within(row).getByPlaceholderText(/atMessage/), 'msg-9');
    await user.click(within(row).getByRole('button', { name: 'Создать ветку' }));
    await waitFor(() => expect(sdkFork).toHaveBeenCalledWith('sess-42', expect.objectContaining({
      task: 'новая ветка', atMessage: 'msg-9',
    })));
    const res = await within(row).findByTestId('session-fork');
    expect(res.textContent).toContain('sdk-11');
    expect(res.textContent).toContain('ожидает связи');
  });

  it('«Переименовать» и «В архив» → PATCH с verbatim-полями, список перечитывается', async () => {
    seamOn();
    sdkList.mockResolvedValue([SESSION_FIXTURE]);
    sdkPatch.mockResolvedValue({ id: 'sess-42', updated: true });
    const user = userEvent.setup();
    render(<AgentSessionsPanel />);
    const row = await screen.findByTestId('session-sess-42');
    // переименование
    await user.click(within(row).getByRole('button', { name: 'Переименовать' }));
    const input = within(row).getByPlaceholderText('Новое название…');
    await user.clear(input);
    await user.type(input, 'новое имя');
    await user.click(within(row).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(sdkPatch).toHaveBeenCalledWith('sess-42', { title: 'новое имя' }));
    // архив
    await user.click(within(row).getByRole('button', { name: 'В архив' }));
    await waitFor(() => expect(sdkPatch).toHaveBeenCalledWith('sess-42', { archived: true }));
  });

  it('PATCH упал → «хост не ответил» verbatim, карточка не прячется', async () => {
    seamOn();
    sdkList.mockResolvedValue([SESSION_FIXTURE]);
    sdkPatch.mockRejectedValue(new Error('404: сессия SDK не найдена'));
    const user = userEvent.setup();
    render(<AgentSessionsPanel />);
    const row = await screen.findByTestId('session-sess-42');
    await user.click(within(row).getByRole('button', { name: 'Переименовать' }));
    const input = within(row).getByPlaceholderText('Новое название…');
    await user.clear(input);
    await user.type(input, 'x');
    await user.click(within(row).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(row.textContent).toContain('Хост не ответил — 404: сессия SDK не найдена'));
    expect(row.textContent).toContain('почини тесты');
  });

  // XV W3 — фильтры уходят в хост (Query), не отсекаются на клиенте.
  it('фильтры assistant/status/limit уходят в хост verbatim', async () => {
    seamOn();
    sdkList.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<AgentSessionsPanel />);
    await screen.findByTestId('sessions-filters');
    await user.type(screen.getByLabelText('Ассистент'), 'forge');
    await waitFor(() => expect(sdkList).toHaveBeenLastCalledWith(
      expect.objectContaining({ assistant: 'forge', limit: 50 }),
    ));
    await user.selectOptions(screen.getByLabelText('Статус'), 'busy');
    await waitFor(() => expect(sdkList).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'busy', assistant: 'forge' }),
    ));
    await user.selectOptions(screen.getByLabelText('Сколько строк'), '20');
    await waitFor(() => expect(sdkList).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 20, status: 'busy' }),
    ));
  });

  // XV W3 — учёт сессии: токены/стоимость из GET …/sessions/{id}/usage.
  it('«Токены» → учёт сессии verbatim (токены/стоимость/прогоны/модель)', async () => {
    seamOn();
    sdkList.mockResolvedValue([SESSION_FIXTURE]);
    sdkUsage.mockResolvedValue({
      sessionId: 'sess-42', runs: 3, inputTokens: 12, outputTokens: 7,
      cacheReadTokens: null, cacheCreationTokens: null, totalCostUsd: 0.0123,
      durationMs: null, durationApiMs: null, numTurns: null,
      model: 'claude-x', contextFill: null, modelUsage: null,
    });
    const user = userEvent.setup();
    render(<AgentSessionsPanel />);
    const row = await screen.findByTestId('session-sess-42');
    await user.click(within(row).getByRole('button', { name: 'Токены' }));
    const usage = await within(row).findByTestId('session-usage');
    expect(usage.textContent).toContain('токены: 12 → 7');
    expect(usage.textContent).toContain('0,0123');
    expect(usage.textContent).toContain('прогонов: 3');
    expect(usage.textContent).toContain('claude-x');
    expect(sdkUsage).toHaveBeenCalledWith('sess-42');
  });

  it('учёт пустой (все суммы null) → «нет данных у хоста», не нули', async () => {
    seamOn();
    sdkList.mockResolvedValue([SESSION_FIXTURE]);
    sdkUsage.mockResolvedValue({
      sessionId: 'sess-42', runs: null, inputTokens: null, outputTokens: null,
      cacheReadTokens: null, cacheCreationTokens: null, totalCostUsd: null,
      durationMs: null, durationApiMs: null, numTurns: null,
      model: null, contextFill: null, modelUsage: null,
    });
    const user = userEvent.setup();
    render(<AgentSessionsPanel />);
    const row = await screen.findByTestId('session-sess-42');
    await user.click(within(row).getByRole('button', { name: 'Токены' }));
    const empty = await within(row).findByTestId('session-usage-empty');
    expect(empty.textContent).toContain('нет данных у хоста');
  });

  it('учёт упал → verbatim-причина, список не прячется', async () => {
    seamOn();
    sdkList.mockResolvedValue([SESSION_FIXTURE]);
    sdkUsage.mockRejectedValue(new Error('404: сессия SDK не найдена'));
    const user = userEvent.setup();
    render(<AgentSessionsPanel />);
    const row = await screen.findByTestId('session-sess-42');
    await user.click(within(row).getByRole('button', { name: 'Токены' }));
    await waitFor(() => expect(row.textContent).toContain('Учёт недоступен — 404: сессия SDK не найдена'));
    expect(row.textContent).toContain('почини тесты');
  });

  // NQ-092 (fixed): исход действия не дублируется в чужих строках.
  it('NQ-092: бейдж прогона только в строке своей сессии', async () => {
    seamOn();
    sdkList.mockResolvedValue([
      SESSION_FIXTURE,
      { ...SESSION_FIXTURE, id: 'sess-2', title: 'вторая', parent: null },
    ]);
    sdkRun.mockResolvedValue({ id: 'sdk-9', to: 'claude-sdk', state: 'sent', createdAt: 1 });
    const user = userEvent.setup();
    render(<AgentSessionsPanel />);
    const first = await screen.findByTestId('session-sess-42');
    await screen.findByTestId('session-sess-2');
    await user.click(within(first).getByRole('button', { name: 'Продолжить' }));
    await user.type(within(first).getByPlaceholderText(/Текст следующего сообщения/), 'го');
    const submits = within(first).getAllByRole('button', { name: 'Продолжить' });
    await user.click(submits[submits.length - 1]);
    await waitFor(() => expect(screen.getAllByTestId('session-run')).toHaveLength(1));
    expect(within(first).getByTestId('session-run').textContent).toContain('sdk-9');
    const second = screen.getByTestId('session-sess-2');
    expect(within(second).queryByTestId('session-run')).toBeNull();
  });

  // NQ-092 (fixed): бейдж ветки тоже живёт только в строке своей сессии.
  it('NQ-092: бейдж ветки только в строке своей сессии', async () => {
    seamOn();
    sdkList.mockResolvedValue([
      SESSION_FIXTURE,
      { ...SESSION_FIXTURE, id: 'sess-2', title: 'вторая', parent: null },
    ]);
    sdkFork.mockResolvedValue({
      id: 'sdk-7', parentSessionId: 'sess-42', atMessage: null,
      key: 'k', childSessionId: null, state: 'pending',
    });
    const user = userEvent.setup();
    render(<AgentSessionsPanel />);
    const first = await screen.findByTestId('session-sess-42');
    await screen.findByTestId('session-sess-2');
    await user.click(within(first).getByRole('button', { name: 'Ветка' }));
    await user.type(within(first).getByPlaceholderText(/Текст следующего сообщения/), 'ветка');
    await user.click(within(first).getByRole('button', { name: 'Создать ветку' }));
    await waitFor(() => expect(screen.getAllByTestId('session-fork')).toHaveLength(1));
    expect(within(first).getByTestId('session-fork').textContent).toContain('sdk-7');
    const second = screen.getByTestId('session-sess-2');
    expect(within(second).queryByTestId('session-fork')).toBeNull();
  });
});
