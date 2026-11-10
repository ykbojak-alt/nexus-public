// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/local-agent',
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('../../integrations/ai2/desktop-bridge/adapter', () => ({
  getDesktopBridge: () => Promise.resolve(null),
}));

const workerStatus = vi.fn();
const wLaunch = vi.fn();
const wStatus = vi.fn();
const wRequest = vi.fn();
const wRevoke = vi.fn();
const wShutdown = vi.fn();
const startRun = vi.fn();
// worker-seam toggle: false = mock-source (seam absent → unavailable)
const seams = { worker: true, kind: 'live' as 'live' | 'mock' };
vi.mock('../data-source', () => {
  const compute = () => ({
    workerStatus,
    startRun,
    ...(seams.worker ? { worker: { launch: wLaunch, status: wStatus, request: wRequest, revoke: wRevoke, shutdown: wShutdown } } : {}),
  });
  return {
    getDataSourceKind: () => seams.kind,
    getDataSource: compute,
    useDataSource: compute,
  };
});

import { LocalAgentScreen } from './local-agent';
import { resetProfileStore } from '../profile/profile-store';

const GRANT = {
  grantId: 'grant-abc123def', mode: 'observe' as const,
  roots: ['D:/work/notes'],
  ops: ['read', 'list', 'search', 'stat', 'ping'],
  expiresAt: null, revoked: false,
};

function readyWorker(grant = GRANT) {
  return { state: 'ready' as const, launched: true, pid: 4321, restarts: 0, uptimeS: 12.5, grant };
}

beforeEach(() => {
  resetProfileStore();
  seams.worker = true;
  seams.kind = 'live';
  workerStatus.mockResolvedValue({ state: 'down', launched: false });
});

afterEach(() => {
  cleanup();
  for (const fn of [workerStatus, wLaunch, wStatus, wRequest, wRevoke, wShutdown, startRun]) fn.mockReset();
});

describe('LocalAgentScreen — lifecycle', () => {
  it('down: показывает состояние и не даёт запустить без папки', async () => {
    render(<LocalAgentScreen />);
    const panel = await screen.findByTestId('la-worker');
    expect(within(panel).getByTestId('la-worker-state').textContent).toContain('down');
    const btn = within(panel).getByRole('button', { name: /Запустить worker/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('ready: grant-view verbatim — roots/ops/mode/expires от хоста', async () => {
    workerStatus.mockResolvedValue(readyWorker());
    render(<LocalAgentScreen />);
    const grant = await screen.findByTestId('la-grant');
    expect(grant.textContent).toContain('grant-ab');
    expect(grant.textContent).toContain('observe');
    expect(grant.textContent).toContain('read · list · search · stat · ping');
    expect(grant.textContent).toContain('без срока');
    // корни — verbatim от хоста, не введённая строка
    expect(within(screen.getByTestId('la-workspace')).getByText('D:/work/notes')).toBeTruthy();
  });

  it('crashed: честная ошибка + рестарты, ops недоступны', async () => {
    workerStatus.mockResolvedValue({ state: 'crashed', launched: true, restarts: 3, maxRestarts: 5 });
    render(<LocalAgentScreen />);
    const panel = await screen.findByTestId('la-worker');
    expect(within(panel).getByRole('alert').textContent).toMatch(/упал/i);
    expect(within(panel).getByRole('alert').textContent).toContain('5');
    expect(screen.getByTestId('la-browser').dataset.state).toBe('unavailable');
  });

  it('launch → status.set(res.worker); 409 → перечитывание статуса', async () => {
    const user = userEvent.setup();
    render(<LocalAgentScreen />);
    // добавить папку-кандидат
    const input = screen.getByLabelText('Путь рабочей папки');
    await user.type(input, 'D:/work/notes');
    await user.click(screen.getByRole('button', { name: '+ папка' }));

    wLaunch.mockResolvedValue({ worker: readyWorker(), grant: GRANT });
    wStatus.mockResolvedValue(readyWorker());
    await user.click(await screen.findByRole('button', { name: /Запустить worker/ }));
    expect(wLaunch).toHaveBeenCalledWith({ roots: ['D:/work/notes'], mode: 'observe' });
    expect(await screen.findByTestId('la-grant')).toBeTruthy();
  });

  it('launch 409 — показываем живой грант, не молчим', async () => {
    const { Ai2ApiError } = await import('../../integrations/ai2/api/errors');
    wLaunch.mockRejectedValue(new Ai2ApiError(409, { error: 'conflict', message: 'worker уже запущен' }));
    wStatus.mockResolvedValue(readyWorker());
    const user = userEvent.setup();
    render(<LocalAgentScreen />);
    await user.type(screen.getByLabelText('Путь рабочей папки'), 'D:/work/notes');
    await user.click(screen.getByRole('button', { name: '+ папка' }));
    await user.click(await screen.findByRole('button', { name: /Запустить worker/ }));
    expect((await screen.findByRole('status')).textContent).toMatch(/уже запущен/i);
    expect(wStatus).toHaveBeenCalled();
  });
});

describe('LocalAgentScreen — ops через seam', () => {
  it('list → дерево записей verbatim; read → превью файла', async () => {
    workerStatus.mockResolvedValue(readyWorker());
    wRequest.mockImplementation(async ({ op }: { op: string }) => {
      if (op === 'list') return { path: 'D:/work/notes', entries: [{ name: 'docs', dir: true, size: 0 }, { name: 'README.md', dir: false, size: 120 }] };
      if (op === 'read') return { path: 'D:/work/notes/README.md', content: '# notes', size: 120, truncated: false };
      throw new Error(`op ${op}`);
    });
    const user = userEvent.setup();
    render(<LocalAgentScreen />);
    await screen.findByTestId('la-grant');
    await user.click(screen.getByRole('button', { name: 'notes' }));
    expect(await screen.findByRole('button', { name: /README\.md/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /README\.md/ }));
    const preview = await screen.findByTestId('la-file-preview');
    expect(preview.textContent).toContain('# notes');
  });

  it('403 escape → verbatim-ошибка хоста в панели и ленте', async () => {
    const { Ai2ApiError } = await import('../../integrations/ai2/api/errors');
    workerStatus.mockResolvedValue(readyWorker());
    wRequest.mockRejectedValue(new Ai2ApiError(403, { error: 'escape', message: 'escape: путь вне granted roots' }));
    const user = userEvent.setup();
    render(<LocalAgentScreen />);
    await screen.findByTestId('la-grant');
    await user.click(screen.getByRole('button', { name: 'notes' }));
    const err = await screen.findByRole('alert');
    expect(err.textContent).toContain('403');
    expect(err.textContent).toContain('escape: путь вне granted roots');
    // лента зафиксировала отказ
    const feed = screen.getByTestId('la-feed');
    expect(feed.textContent).toContain('escape');
  });

  it('observe-грант — нет формы записи (canWrite по grant.ops, не по UI)', async () => {
    workerStatus.mockResolvedValue(readyWorker());
    render(<LocalAgentScreen />);
    const diffs = await screen.findByTestId('la-diffs');
    expect(diffs.textContent).toMatch(/Запись недоступна/);
    expect(within(diffs).queryByLabelText('Путь файла для записи')).toBeNull();
  });

  it('revoke и shutdown зовут свои seams', async () => {
    workerStatus.mockResolvedValue(readyWorker());
    wRevoke.mockResolvedValue(readyWorker({ ...GRANT, revoked: true }));
    const user = userEvent.setup();
    render(<LocalAgentScreen />);
    await screen.findByTestId('la-grant');
    await user.click(screen.getByRole('button', { name: 'Отозвать грант' }));
    expect(wRevoke).toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Остановить' }));
    expect(wShutdown).toHaveBeenCalled();
  });
});

describe('LocalAgentScreen — честные границы', () => {
  it('mock-source: worker-блок unavailable, никаких имитаций', async () => {
    seams.worker = false;
    seams.kind = 'mock';
    render(<LocalAgentScreen />);
    const panel = await screen.findByTestId('la-worker');
    expect(within(panel).getByTestId('la-worker-unavailable').textContent).toMatch(/mock не имитирует/i);
  });

  it('лента пустая до первой op — честное empty-состояние', async () => {
    render(<LocalAgentScreen />);
    const feed = await screen.findByTestId('la-feed');
    expect(feed.dataset.state).toBe('empty');
    expect(feed.textContent).toMatch(/Действий не было/);
  });
});

describe('LocalAgentScreen — журнал хоста (wave-2 W3-4)', () => {
  it('audit-seam отсутствует → честный unavailable-ряд, без выдуманных записей', async () => {
    render(<LocalAgentScreen />);
    const row = await screen.findByTestId('la-audit-unavailable');
    expect(row.textContent).toContain('Журнал хоста недоступен');
    expect(row.getAttribute('data-state')).toBe('unavailable');
  });
});
