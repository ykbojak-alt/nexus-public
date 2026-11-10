// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/agents',
  useSearchParams: () => new URLSearchParams(''),
}));

const listAgents = vi.fn();
const listPresence = vi.fn();
const listHandoffs = vi.fn();
const getMissionGraph = vi.fn();
const listPresets = vi.fn();
const listRuns = vi.fn();
const startRun = vi.fn();
const agentsGet = vi.fn();
const agentsCreate = vi.fn();
const agentsUpdate = vi.fn();
const agentsDelete = vi.fn();
const AGENT_DS = {
  listAgents, listPresence, listHandoffs, getMissionGraph,
  listPresets, listRuns, startRun,
  agents: { get: agentsGet, create: agentsCreate, update: agentsUpdate, delete: agentsDelete },
};
vi.mock('../data-source', () => ({
  getDataSourceKind: () => 'live',
  getDataSource: () => AGENT_DS,
  // #418 (wave #418-2): mount-gated hook — stable object so useAsyncValue
  // deps don't refetch; resolves to the same seam getDataSource returns.
  useDataSource: () => AGENT_DS,
}));

import { AgentsScreen } from './agents';

const SPEC = {
  name: 'alpha', description: 'первый агент', config: 'deliberate',
  capabilities: ['fs.read'], taskPrefix: 'Сначала план.', maxCostUsd: 1.5,
};

beforeEach(() => {
  listAgents.mockResolvedValue([{ name: 'alpha', description: 'первый агент', config: 'deliberate', capabilities: ['fs.read'], maxCostUsd: 1.5 }]);
  listPresence.mockResolvedValue([]);
  listHandoffs.mockResolvedValue([]);
  getMissionGraph.mockResolvedValue({ nodes: [], edges: [] });
  listPresets.mockResolvedValue([{ name: 'deliberate' }]);
  listRuns.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  for (const fn of [listAgents, listPresence, listHandoffs, getMissionGraph, listPresets, listRuns, startRun, agentsGet, agentsCreate, agentsUpdate, agentsDelete]) fn.mockReset();
});

describe('AgentsScreen — реестр PATCH (wave-2 W3-3)', () => {
  it('«Изменить» → prefill из agents.get → update с PatchAgentInput-полями → roster перечитан', { timeout: 15000 }, async () => {
    agentsGet.mockResolvedValue({ ...SPEC, taskPrefix: 'Сначала план.' });
    agentsUpdate.mockResolvedValue(SPEC);
    const user = userEvent.setup();
    render(<AgentsScreen />);

    const registry = await screen.findByTestId('agents-registry');
    await user.selectOptions(within(registry).getByLabelText('Агент для задачи'), 'alpha');
    await user.click(within(registry).getByRole('button', { name: 'Изменить' }));

    await waitFor(() => expect(agentsGet).toHaveBeenCalledWith('alpha'));
    // prefill: поля формы заполнены значениями спеки
    expect((within(registry).getByLabelText('Описание агента') as HTMLInputElement).value).toBe('первый агент');
    expect((within(registry).getByLabelText('Префикс задачи') as HTMLInputElement).value).toBe('Сначала план.');
    expect(within(registry).getByRole('button', { name: 'fs.read' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(registry).getByRole('button', { name: 'fs.write' }).getAttribute('aria-pressed')).toBe('false');

    // правим описание и сохраняем — имя не редактируется (update по нему)
    await user.clear(within(registry).getByLabelText('Описание агента'));
    await user.type(within(registry).getByLabelText('Описание агента'), 'обновлённый агент');
    await user.click(within(registry).getByRole('button', { name: /Сохранить alpha/ }));

    await waitFor(() => expect(agentsUpdate).toHaveBeenCalledWith('alpha', expect.objectContaining({
      description: 'обновлённый агент',
      taskPrefix: 'Сначала план.',
      capabilities: ['fs.read'],
      maxCostUsd: 1.5,
      config: 'deliberate',
    })));
    await waitFor(() => expect(listAgents.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('ошибка хоста на update — verbatim, форма остаётся в редактировании', async () => {
    agentsGet.mockResolvedValue(SPEC);
    agentsUpdate.mockRejectedValue(new Error('409 · спека изменилась на хосте'));
    const user = userEvent.setup();
    render(<AgentsScreen />);

    const registry = await screen.findByTestId('agents-registry');
    await user.selectOptions(within(registry).getByLabelText('Агент для задачи'), 'alpha');
    await user.click(within(registry).getByRole('button', { name: 'Изменить' }));
    await waitFor(() => expect(agentsGet).toHaveBeenCalled());

    await user.click(within(registry).getByRole('button', { name: /Сохранить alpha/ }));
    const alert = await within(registry).findByRole('alert');
    expect(alert.textContent).toContain('спека изменилась на хосте');
    // форма всё ещё в режиме редактирования — кнопка сохранения на месте
    expect(within(registry).getByRole('button', { name: /Сохранить alpha/ })).toBeTruthy();
  });
});

describe('AgentsScreen — U-2 редактор rights', () => {
  it('редактор отрисован, но отключён с объяснением до контракта rights (W1)', async () => {
    render(<AgentsScreen />);
    const registry = await screen.findByTestId('agents-registry');
    const editor = within(registry).getByTestId('rights-editor');

    // Контракт CreateAgentInput не несёт rights — fieldset disabled + объяснение.
    expect(editor.getAttribute('data-wire')).toBe('pending');
    expect((editor as HTMLFieldSetElement).disabled).toBe(true);
    expect(editor.textContent).toContain('не принимает rights');

    // Превью итоговой политики — дефолтные значения (inherit, пустые списки).
    const preview = within(editor).getByTestId('rights-preview');
    expect(preview.textContent).toContain('"mode":"inherit"');
    expect(preview.textContent).toContain('"capabilities"');

    // Создание спеки права не тащит — контракт verbatim.
    agentsCreate.mockResolvedValue(SPEC);
    const user = userEvent.setup();
    await user.type(within(registry).getByLabelText('Имя агента'), 'beta');
    await user.click(within(registry).getByRole('button', { name: 'Зарегистрировать' }));
    await waitFor(() => expect(agentsCreate).toHaveBeenCalled());
    const sent = agentsCreate.mock.calls[0][0] as Record<string, unknown>;
    expect('rights' in sent).toBe(false);
  });
});

describe('AgentsScreen — ref-parity P-2 констелляция + рейл активности', () => {
  it('орб-чипы по реальным агентам; донат и % по live-статусам', async () => {
    listAgents.mockResolvedValue([
      { name: 'alpha', description: 'а', config: null, capabilities: [], maxCostUsd: null },
      { name: 'beta', description: 'б', config: null, capabilities: [], maxCostUsd: null },
      { name: 'gamma', description: 'г', config: null, capabilities: [], maxCostUsd: null },
      { name: 'delta', description: 'д', config: null, capabilities: [], maxCostUsd: null },
    ]);
    listPresence.mockResolvedValue([
      { agent: 'alpha', state: 'running', task: 'считает', runId: 'r-1' },
      { agent: 'beta', state: 'blocked', task: 'ждёт аппрув', runId: 'r-2' },
    ]);
    render(<AgentsScreen />);

    const panel = await screen.findByTestId('agents-activity');
    // Чипы — инициалы реальных агентов на орбите; статусы из presence-оверлея.
    const chips = panel.querySelectorAll('[role="listitem"]');
    expect(chips.length).toBe(4);
    expect(panel.textContent).toContain('AL');
    expect(panel.textContent).toContain('GA');
    const alpha = [...chips].find((c) => c.getAttribute('title')?.startsWith('alpha'));
    expect(alpha?.getAttribute('data-status')).toBe('active');
    const gamma = [...chips].find((c) => c.getAttribute('title') === 'gamma');
    expect(gamma?.getAttribute('data-status')).toBe('idle');

    // Диаграмма остаётся единственной агрегированной статусной сводкой:
    // соседняя текстовая копия тех же чисел удалена.
    expect(within(panel).getByTestId('donut-chart')).toBeTruthy();
    expect(within(panel).queryByTestId('agents-activity-pct')).toBeNull();
  });

  it('последние прогоны остаются одной выборкой и ведут к полной истории', async () => {
    listRuns.mockResolvedValue([{
      runId: 'run-alpha-1', taskText: 'Проверить миграцию', status: 'done',
      createdAt: 10, costUsd: 0.02,
    }]);
    render(<AgentsScreen />);

    const inspector = await screen.findByTestId('agent-inspector');
    const recentRun = await within(inspector).findByRole('button', { name: /Проверить миграцию/ });
    expect(within(inspector).getAllByRole('button', { name: /Проверить миграцию/ })).toHaveLength(1);
    expect(recentRun).toBeTruthy();
    expect(await screen.findByTestId('agents-full-history')).toHaveAttribute('href', '/runtime?tab=history');
  });

  it('выбранный агент без загруженных прогонов → честная строка загрузки', async () => {
    let resolveRuns: ((v: never[]) => void) | null = null;
    listRuns.mockImplementation(() => new Promise<never[]>((res) => { resolveRuns = res; }));
    render(<AgentsScreen />);
    // В реестре есть и <select><option> — option ищем строго внутри listbox.
    const listbox = await screen.findByRole('listbox');
    await within(listbox).findByRole('option', { name: /alpha/ });
    // agent-inspector — секция паттерна внутри GlassPanel со state-атрибутом.
    const panel = (await screen.findByTestId('agent-inspector')).parentElement as HTMLElement;
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('loading'));
    expect(screen.getByText('Прогоны агента загружаются…')).toBeTruthy();

    resolveRuns!([]);
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('ready'));
    expect(screen.getByText('Прогонов этого агента нет.')).toBeTruthy();
  });

  it('клавиатура: стрелки по listbox + Enter выбирают агента', async () => {
    listAgents.mockResolvedValue([
      { name: 'alpha', description: '', config: 'deliberate', capabilities: [], maxCostUsd: null },
      { name: 'beta', description: '', config: 'fast', capabilities: [], maxCostUsd: null },
    ]);
    const user = userEvent.setup();
    render(<AgentsScreen />);
    const listbox = await screen.findByRole('listbox');
    const options = await within(listbox).findAllByRole('option');
    (options[0] as HTMLElement).focus();
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[1]);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(
      (document.activeElement as HTMLElement).getAttribute('aria-selected'),
    ).toBe('true'));
    expect((await screen.findByTestId('agent-inspector')).textContent).toContain('beta');
  });

  it('пустой реестр → честный empty без орба и доната', async () => {
    listAgents.mockResolvedValue([]);
    render(<AgentsScreen />);
    const panel = await screen.findByTestId('agents-activity');
    expect(panel.textContent).toContain('Агентов нет');
    expect(panel.querySelector('[role="list"]')).toBeNull();
  });
});

describe('волна XII — продолжения спеки агента (AgentSpec.handoffs)', () => {
  it('спека с handoffs → HandoffBar verbatim; send:true → реальный прогон целевому агенту', async () => {
    listAgents.mockResolvedValue([{
      name: 'alpha', description: 'первый агент', config: 'deliberate',
      capabilities: ['fs.read'], maxCostUsd: 1.5,
      handoffs: [{ label: 'Реализовать план', agent: 'codex', prompt: 'реализуй по плану', send: true }],
    }]);
    startRun.mockResolvedValue({ runId: 'run-h1' });
    const user = userEvent.setup();
    render(<AgentsScreen />);
    const bar = await screen.findByTestId('agent-spec-handoffs');
    await user.click(within(bar).getByRole('button', { name: 'Реализовать план' }));
    await waitFor(() => expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'codex', task: 'реализуй по плану' }),
    ));
  });

  it('send:false → промпт уходит драфтом в композитор главной, а не в прогон', async () => {
    listAgents.mockResolvedValue([{
      name: 'alpha', description: 'первый агент', config: 'deliberate',
      capabilities: ['fs.read'], maxCostUsd: 1.5,
      handoffs: [{ label: 'В композитор', agent: 'mech', prompt: 'черновик текста', send: false }],
    }]);
    const user = userEvent.setup();
    render(<AgentsScreen />);
    const bar = await screen.findByTestId('agent-spec-handoffs');
    await user.click(within(bar).getByRole('button', { name: 'В композитор' }));
    expect(sessionStorage.getItem('nexus.composer.draft')).toBe('черновик текста');
    expect(startRun).not.toHaveBeenCalled();
  });

  it('спека без handoffs → бара нет (отсутствие — не пустышка)', async () => {
    render(<AgentsScreen />);
    await screen.findByTestId('agents-inspector');
    await waitFor(() => expect(listAgents).toHaveBeenCalled());
    expect(screen.queryByTestId('agent-spec-handoffs')).toBeNull();
  });
});
