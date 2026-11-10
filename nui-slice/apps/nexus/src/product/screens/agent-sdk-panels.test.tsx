// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sdkDelList = vi.fn();
const sdkDelDelegate = vi.fn();
const sdkDelCancel = vi.fn();
const sdkHoList = vi.fn();
const sdkHoCreate = vi.fn();
const sdkHoResolve = vi.fn();
let delSeam: unknown;
let hoSeam: unknown;

const SDKP_DS = () => ({ sdkDelegations: delSeam, sdkHandoffs: hoSeam });
vi.mock('../data-source', () => ({
  getDataSourceKind: () => 'live',
  getDataSource: () => SDKP_DS(),
  // #418 (wave #418-2): stable for useAsyncValue deps
  useDataSource: () => SDKP_DS(),
}));

import { SdkDelegationsPanel, SdkHandoffsPanel } from './agent-sdk-panels';

afterEach(() => {
  cleanup();
  delSeam = undefined;
  hoSeam = undefined;
  for (const fn of [sdkDelList, sdkDelDelegate, sdkDelCancel, sdkHoList, sdkHoCreate, sdkHoResolve]) {
    fn.mockReset();
  }
});

// ФИКСТУРЫ: записи по sdk-delegations-contract.md (draft) — поля verbatim.
const DELEGATION = {
  id: 'sdk-d1', parentRunId: 'sdk-p0', agent: 'alpha', label: 'черновик отчёта',
  state: 'sent', createdAt: 1_792_160_000_000, durationMs: 4230.5,
  summary: null, summaryPath: null,
};
const HANDOFF = {
  id: 'h-7', from: 'alice', to: 'codex', prompt: 'забери ревизию',
  runId: null, status: 'pending', reason: null,
  createdAt: 1_792_160_000_000, resolvedAt: null,
};

describe('SdkDelegationsPanel — дерево делегаций (XIV W3)', () => {
  it('seam отсутствует → unavailable, списка нет', () => {
    render(<SdkDelegationsPanel agentNames={['alpha']} />);
    const p = screen.getByTestId('sdk-delegations');
    expect(p.getAttribute('data-state')).toBe('unavailable');
    expect(p.textContent).toMatch(/источник не реализует делегации/i);
  });

  it('список verbatim: метка/агент/родитель/длительность; sent → Отменить', async () => {
    delSeam = { list: sdkDelList, delegate: sdkDelDelegate, cancel: sdkDelCancel };
    sdkDelList.mockResolvedValue([DELEGATION]);
    sdkDelCancel.mockResolvedValue({ id: 'sdk-d1', cancelled: true });
    const user = userEvent.setup();
    render(<SdkDelegationsPanel agentNames={['alpha']} />);
    const row = await screen.findByTestId('sdk-delegation-sdk-d1');
    expect(row.textContent).toContain('черновик отчёта');
    expect(row.textContent).toContain('alpha');
    expect(row.textContent).toContain('родитель sdk-p0');
    expect(row.textContent).toContain('4.2 с');
    await user.click(within(row).getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(sdkDelCancel).toHaveBeenCalledWith('sdk-d1'));
  });

  it('пусто → честный empty; 503 → verbatim + повтор', async () => {
    delSeam = { list: sdkDelList, delegate: sdkDelDelegate, cancel: sdkDelCancel };
    sdkDelList.mockRejectedValueOnce(new Error('SDK-канал выключен (AI2_SDK_ENABLED)'));
    sdkDelList.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<SdkDelegationsPanel agentNames={[]} />);
    const p = screen.getByTestId('sdk-delegations');
    await waitFor(() => expect(p.getAttribute('data-state')).toBe('error'));
    expect(p.textContent).toContain('AI2_SDK_ENABLED');
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(p.getAttribute('data-state')).toBe('empty'));
  });

  it('форма → delegate verbatim {task,agent,label}; хэндл в статусе', async () => {
    delSeam = { list: sdkDelList, delegate: sdkDelDelegate, cancel: sdkDelCancel };
    sdkDelList.mockResolvedValue([]);
    sdkDelDelegate.mockResolvedValue({ id: 'sdk-d9', to: 'claude-sdk', state: 'sent', createdAt: 1 });
    const user = userEvent.setup();
    render(<SdkDelegationsPanel agentNames={['alpha', 'beta']} />);
    await screen.findByTestId('sdk-delegate-form');
    await user.type(screen.getByLabelText('id родительского прогона'), 'sdk-p0');
    await user.selectOptions(screen.getByLabelText('Субагент'), 'beta');
    await user.type(screen.getByLabelText('Задача делегата'), 'собери метрики');
    await user.type(screen.getByLabelText('Метка делегации'), 'метрики');
    await user.click(screen.getByRole('button', { name: 'Делегировать' }));
    await waitFor(() => expect(sdkDelDelegate).toHaveBeenCalledWith('sdk-p0', {
      task: 'собери метрики', agent: 'beta', label: 'метрики',
    }));
    expect((await screen.findByText(/sdk-d9/)).textContent).toContain('sdk-d9');
  });
});

describe('SdkHandoffsPanel — передачи SDK (XIV W3)', () => {
  it('seam отсутствует → unavailable', () => {
    render(<SdkHandoffsPanel agentNames={[]} />);
    expect(screen.getByTestId('sdk-handoffs').getAttribute('data-state')).toBe('unavailable');
  });

  it('список verbatim; pending → Принять вызывает resolve(id,true)', async () => {
    hoSeam = { list: sdkHoList, create: sdkHoCreate, resolve: sdkHoResolve };
    sdkHoList.mockResolvedValue([HANDOFF]);
    sdkHoResolve.mockResolvedValue({ ...HANDOFF, status: 'accepted', resolvedAt: 1_792_160_000_500 });
    const user = userEvent.setup();
    render(<SdkHandoffsPanel agentNames={['codex']} />);
    const row = await screen.findByTestId('sdk-handoff-h-7');
    expect(row.textContent).toContain('alice → codex');
    expect(row.textContent).toContain('забери ревизию');
    expect(row.textContent).toContain('ожидает');
    await user.click(within(row).getByRole('button', { name: 'Принять' }));
    await waitFor(() => expect(sdkHoResolve).toHaveBeenCalledWith('h-7', true));
  });

  it('создание → create verbatim {to,prompt}; решённая карточка без кнопок', async () => {
    hoSeam = { list: sdkHoList, create: sdkHoCreate, resolve: sdkHoResolve };
    sdkHoList.mockResolvedValue([{ ...HANDOFF, status: 'accepted', resolvedAt: 5 }]);
    sdkHoCreate.mockResolvedValue({ ...HANDOFF, id: 'h-8' });
    const user = userEvent.setup();
    render(<SdkHandoffsPanel agentNames={['codex']} />);
    const row = await screen.findByTestId('sdk-handoff-h-7');
    expect(row.textContent).toContain('принята');
    expect(within(row).queryByRole('button', { name: 'Принять' })).toBeNull();
    await user.type(screen.getByLabelText('Кому передать'), 'codex');
    await user.type(screen.getByLabelText('Текст передачи'), 'передай отчёт');
    await user.click(screen.getByRole('button', { name: 'Передать' }));
    await waitFor(() => expect(sdkHoCreate).toHaveBeenCalledWith({ to: 'codex', prompt: 'передай отчёт' }));
  });
});
