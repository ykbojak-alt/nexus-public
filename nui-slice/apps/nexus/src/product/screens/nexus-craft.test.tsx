// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDataSource } from '../data-source';
import type { CraftSeam } from '../../integrations/craft/seam';
import { CraftSeamError } from '../../integrations/craft/seam';

let craft: CraftSeam | undefined;
vi.mock('../data-source', () => ({
  getDataSource: () => ({ craft }) as ProductDataSource,
  useDataSource: () => ({ craft }) as ProductDataSource,
  getDataSourceKind: () => 'mock',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...rest}>{children}</a>,
}));

import { NexusCraftScreen } from './nexus-craft';

const seamStub = (over: Partial<CraftSeam> = {}): CraftSeam => ({
  health: () => Promise.resolve({ ok: true, service: 'craft-bridge', upstream: 'ok' }),
  inspect: () => Promise.resolve({ adapter: 'Dx12 test', documents: 1 }),
  listCommands: () => Promise.resolve([
    { id: 'parameters.get', label: 'Get parameters', enabled: true },
    { id: 'solid.delete_all', label: 'Delete all', enabled: false },
  ]),
  pending: () => Promise.resolve({ pending: null }),
  running: () => Promise.resolve([]),
  execute: () => Promise.resolve({ kind: 'done', result: { ok: true } }),
  exportFile: () => Promise.resolve({ kind: 'done', result: null }),
  designNew: () => Promise.resolve({ tabs: [] }),
  ...over,
});

describe('NexusCraftScreen — /tools/solidcraft MVP', () => {
  beforeEach(() => { craft = undefined; });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('seam отсутствует → панели unavailable, без выдуманных данных', () => {
    render(<NexusCraftScreen />);
    expect(screen.getByTestId('craft-status').getAttribute('data-state')).toBe('unavailable');
    expect(screen.getByTestId('craft-commands').getAttribute('data-state')).toBe('unavailable');
  });

  it('health+реестр → статус online, команды рендерятся, disabled-команда не кликается', async () => {
    craft = seamStub();
    render(<NexusCraftScreen />);
    await screen.findByText('Get parameters');
    expect(screen.getByTestId('craft-status').getAttribute('data-state')).toBe('ready');
    const disabledRow = screen.getByTestId('craft-cmd-solid.delete_all').querySelector('button');
    expect((disabledRow as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('craft-cmd-parameters.get').querySelector('button')!);
    expect((screen.getByTestId('craft-run-command') as HTMLInputElement).value).toBe('parameters.get');
  });

  it('execute done → результат показывается verbatim', async () => {
    craft = seamStub({ execute: () => Promise.resolve({ kind: 'done', result: { value: 42 } }) });
    render(<NexusCraftScreen />);
    await screen.findByText('Get parameters');
    fireEvent.change(screen.getByTestId('craft-run-command'), { target: { value: 'parameters.get' } });
    fireEvent.click(screen.getByTestId('craft-run-submit'));
    const out = await screen.findByTestId('craft-run-result');
    expect(out.textContent).toContain('"value": 42');
  });

  it('execute 202/running → poll /pending до done → показываем reply, не ошибку', async () => {
    const pending = vi.fn()
      .mockResolvedValueOnce({ pending: 7, method: 'engine.execute', done: false })
      .mockResolvedValue({ done: true, reply: { ok: true, result: { applied: 3 } } });
    craft = seamStub({
      execute: () => Promise.resolve({ kind: 'running', operation: { id: 7, method: 'engine.execute' }, poll: '/pending' }),
      pending,
    });
    render(<NexusCraftScreen />);
    await screen.findByText('Get parameters');
    fireEvent.change(screen.getByTestId('craft-run-command'), { target: { value: 'parameters.get' } });
    await act(async () => { fireEvent.click(screen.getByTestId('craft-run-submit')); });
    expect(screen.getByTestId('craft-run-running').textContent).toContain('id 7');
    const out = await screen.findByTestId('craft-run-result', {}, { timeout: 7000 });
    expect(pending).toHaveBeenCalledTimes(2);
    expect(out.textContent).toContain('"applied": 3');
    expect(screen.queryByTestId('craft-run-error')).toBeNull();
  });

  it('execute reject → честный код ошибки, без retry-loop', async () => {
    craft = seamStub({ execute: () => Promise.reject(new CraftSeamError('adapter_busy', undefined, 429)) });
    render(<NexusCraftScreen />);
    await screen.findByText('Get parameters');
    fireEvent.change(screen.getByTestId('craft-run-command'), { target: { value: 'parameters.get' } });
    await act(async () => { fireEvent.click(screen.getByTestId('craft-run-submit')); });
    expect(screen.getByTestId('craft-run-error').textContent).toContain('adapter_busy');
  });
});
