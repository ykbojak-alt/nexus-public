import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NewfMod, type ModData } from './newf-mods';
import { BridgeHttpError, type NewfBridge } from './newf-live';

const data: ModData = {
  live: false,
  error: null,
  spaces: [
    { id: 'local', name: 'Local workspace', machine: 'This machine' },
    { id: 'sage', name: 'Sage worker', machine: 'remote-host' },
    { id: 'roy', name: 'Roy worker', machine: 'roy2' },
  ],
  terminals: [
    { address: 'mock-local-01', label: 'AGENT-A', spaceId: 'local', tab: 'active', state: 'working' },
    { address: 'mock-sage-01', label: 'ROLE-2', spaceId: 'sage', tab: 'review', state: 'idle' },
  ],
  agents: [
    { id: 'alice', name: 'AGENT-A', terminal: 'mock-local-01', status: 'working' },
    { id: 'forge', name: 'ROLE-2', terminal: 'mock-sage-01', status: 'idle' },
  ],
};

const baseProps = {
  data,
  activeTab: 'active',
};

describe('NEWF mods (E3)', () => {
  it('files mod renders mock tree and tracks selection', () => {
    render(<NewfMod name="files" {...baseProps} />);
    const region = screen.getByRole('region', { name: 'Mod Files' });
    expect(region).toHaveAttribute('data-state', 'ready');
    expect(within(region).getByText(/newf-mods\.tsx/)).toBeInTheDocument();
    const rows = within(region).getAllByTestId('file-row-file');
    expect(rows.length).toBeGreaterThan(1);
    fireEvent.click(rows[0]);
    expect(rows[0].closest('li')).toHaveClass(/selected/);
  });

  it('changes mod renders mock changes and tracks selection', () => {
    render(<NewfMod name="changes" {...baseProps} />);
    const region = screen.getByRole('region', { name: 'Mod Changes' });
    expect(region).toHaveAttribute('data-state', 'ready');
    expect(within(region).getByText(/newf\.module\.css/)).toBeInTheDocument();
    const rows = within(region).getAllByTestId('change-row-M');
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(rows[0]);
    expect(rows[0].closest('li')).toHaveClass(/selected/);
  });

  it('sysmon mod renders metrics from terminal data', () => {
    render(<NewfMod name="sysmon" {...baseProps} />);
    const region = screen.getByRole('region', { name: 'System monitor' });
    expect(within(region).getByText('CPU')).toBeInTheDocument();
    const terms = within(region).getByText('Terminals');
    expect(terms.parentElement).toHaveTextContent('2');
  });

  it('nexuslink mod lists gateway addresses as static config', () => {
    render(<NewfMod name="nexuslink" {...baseProps} />);
    const region = screen.getByRole('region', { name: 'NexusLink' });
    expect(within(region).getByText('NexusLink MCP')).toBeInTheDocument();
    expect(within(region).getByText(/nexuslink\.exe mcp/)).toBeInTheDocument();
    expect(within(region).getByText(/static config/)).toBeInTheDocument();
    expect(within(region).getByText(/liveness шлюзов/)).toBeInTheDocument();
  });

  it('nexustick mod shows terminals with status', () => {
    render(<NewfMod name="nexustick" {...baseProps} />);
    const region = screen.getByRole('region', { name: 'NexusTick' });
    expect(within(region).getByText('AGENT-A')).toBeInTheDocument();
    expect(within(region).getByText('working')).toBeInTheDocument();
  });

  it('machine-add form submits mock state', () => {
    render(<NewfMod name="machine-add" {...baseProps} />);
    const form = screen.getByTestId('machine-add-form');
    const host = screen.getByLabelText('Machine host');
    fireEvent.change(host, { target: { value: 'user@host' } });
    fireEvent.submit(form);
    expect(screen.getByText(/Добавлено в локальную форму/)).toBeInTheDocument();
  });

  it('new-menu routes tab/panel actions', () => {
    const onSelect = vi.fn();
    const onOpenMod = vi.fn();
    render(<NewfMod name="new-menu" {...baseProps} onSelectTab={onSelect} onOpenMod={onOpenMod} />);
    const switches = screen.getAllByText('switch');
    fireEvent.click(switches[0].closest('button')!);
    expect(onSelect).toHaveBeenCalled();
    const opens = screen.getAllByText('open');
    fireEvent.click(opens[0].closest('button')!);
    expect(onOpenMod).toHaveBeenCalled();
  });

  it('files/changes in live mode are honest unavailable', () => {
    const liveData = { ...data, live: true };
    render(<NewfMod name="files" data={liveData} activeTab="active" />);
    expect(screen.getByRole('region', { name: 'Mod Files' })).toHaveAttribute('data-state', 'unavailable');
  });

  it('sysmon live labels metrics as derived (live)', () => {
    const liveData = { ...data, live: true };
    render(<NewfMod name="sysmon" data={liveData} activeTab="active" />);
    const region = screen.getByRole('region', { name: 'System monitor' });
    expect(region).toHaveAttribute('data-state', 'ready');
    expect(within(region).getByText(/derived \(live\)/)).toBeInTheDocument();
  });

  it('machine-add live is disabled and honest unavailable', () => {
    const liveData = { ...data, live: true };
    render(<NewfMod name="machine-add" data={liveData} activeTab="active" />);
    const region = screen.getByRole('region', { name: 'Add a machine' });
    expect(region).toHaveAttribute('data-state', 'unavailable');
    expect(screen.getByLabelText('Machine host')).toBeDisabled();
    expect(screen.getByText(/provisioning недоступен через мост/)).toBeInTheDocument();
  });

  it('agents live без терминалов → честный «no terminals: nx run» (не мокает)', () => {
    const liveEmpty = { ...data, live: true, terminals: [], agents: [] };
    render(<NewfMod name="agents" data={liveEmpty} activeTab="active" />);
    const region = screen.getByRole('region', { name: 'Agents' });
    expect(region).toHaveAttribute('data-state', 'ready');
    expect(within(region).getByTestId('agents-no-terminals')).toHaveTextContent(/nx run/);
    expect(within(region).queryByText('MOCK')).not.toBeInTheDocument();
  });
});

describe('NEWF mods live capability (#407, QODER #476 §2)', () => {
  const liveData = { ...data, live: true };

  /** Мост с capability-моками: ошибки файлятся через BridgeHttpError. */
  function bridgeWith(caps: Partial<NewfBridge>): NewfBridge {
    return caps as NewfBridge;
  }

  it('files: live + capability без роута (404 текст) → честный unavailable, не mock', async () => {
    const list = vi.fn().mockResolvedValue({ state: 'unavailable', cwd: '', entries: [], truncated: false, detail: 'Not Found' });
    const bridge = bridgeWith({ files: { list, read: vi.fn() } });
    render(<NewfMod name="files" data={liveData} activeTab="active" bridge={bridge} />);
    const region = screen.getByRole('region', { name: 'Mod Files' });
    expect(await within(region).findByText(/источник не подключён/)).toBeInTheDocument();
    expect(region).toHaveAttribute('data-state', 'unavailable');
    expect(within(region).queryByText('MOCK')).not.toBeInTheDocument();
  });

  it('files: live + happy → список rows (dir/file), data-state ready', async () => {
    const list = vi.fn().mockResolvedValue({
      state: 'ok', cwd: '.', truncated: false,
      entries: [
        { path: 'a.ts', kind: 'file' },
        { path: 'src', kind: 'dir' },
      ],
    });
    const bridge = bridgeWith({ files: { list, read: vi.fn() } });
    render(<NewfMod name="files" data={liveData} activeTab="active" bridge={bridge} />);
    const region = screen.getByRole('region', { name: 'Mod Files' });
    expect(await within(region).findByText(/a\.ts/)).toBeInTheDocument();
    expect(region).toHaveAttribute('data-state', 'ready');
    expect(within(region).getByTestId('file-row-file')).toBeInTheDocument();
    expect(within(region).getByTestId('file-row-dir')).toBeInTheDocument();
  });

  it('files: live + empty → «Каталог пуст» (не путать с not_found)', async () => {
    const list = vi.fn().mockResolvedValue({ state: 'empty', cwd: '.', entries: [], truncated: false });
    const bridge = bridgeWith({ files: { list, read: vi.fn() } });
    render(<NewfMod name="files" data={liveData} activeTab="active" bridge={bridge} />);
    expect(await screen.findByTestId('file-list-empty')).toBeInTheDocument();
    expect(screen.getByText('Каталог пуст')).toBeInTheDocument();
  });

  it('files: live + JSON-404 → not_found («Не найдено»), data-state unavailable', async () => {
    const list = vi.fn().mockResolvedValue({
      state: 'not_found', cwd: 'x', entries: [], truncated: false, detail: 'file not found: x',
    });
    const bridge = bridgeWith({ files: { list, read: vi.fn() } });
    render(<NewfMod name="files" data={liveData} activeTab="active" bridge={bridge} />);
    expect(await screen.findByTestId('file-state-not-found')).toBeInTheDocument();
    expect(screen.getByText(/Не найдено/)).toBeInTheDocument();
  });

  it('files: live + сетевая ошибка → offline', async () => {
    const list = vi.fn().mockResolvedValue({
      state: 'unavailable', cwd: '', entries: [], truncated: false, detail: 'ECONNREFUSED',
    });
    const bridge = bridgeWith({ files: { list, read: vi.fn() } });
    render(<NewfMod name="files" data={liveData} activeTab="active" bridge={bridge} />);
    const region = screen.getByRole('region', { name: 'Mod Files' });
    expect(await within(region).findByText(/ECONNREFUSED/)).toBeInTheDocument();
  });

  it('files: live + bridge без capability (files undefined) → unavailable, не mock', () => {
    render(<NewfMod name="files" data={liveData} activeTab="active" bridge={bridgeWith({})} />);
    const region = screen.getByRole('region', { name: 'Mod Files' });
    expect(region).toHaveAttribute('data-state', 'unavailable');
    expect(within(region).getByText(/не зарегистрирован/)).toBeInTheDocument();
    expect(within(region).queryByText('MOCK')).not.toBeInTheDocument();
  });

  /** files-capability: NewfChanges берёт cwd из files.list() (FORGE #510). */
  const filesOk = {
    list: vi.fn().mockResolvedValue({ state: 'ok', cwd: 'D:/<repo>', entries: [], truncated: false }),
    read: vi.fn(),
  };

  it('changes: live + dirty → rows с kind из первого символа XY (M и ?)', async () => {
    const list = vi.fn().mockResolvedValue({
      state: 'dirty', cwd: 'D:/<repo>', branch: 'master', truncated: false,
      entries: [
        { path: 'docs/x.md', xy: 'M', index: 'M', worktree: '', note: 'modified' },
        { path: 'new.ts', xy: '??', index: '?', worktree: '?' },
      ],
    });
    const bridge = bridgeWith({ changes: { list }, files: filesOk });
    render(<NewfMod name="changes" data={liveData} activeTab="active" bridge={bridge} />);
    // cwd резолвится через files-capability (FORGE #510) — ждём строки,
    // а не первый рендер региона (между loading-стадиями data-state плавает).
    const region = await screen.findByRole('region', { name: 'Mod Changes' });
    expect(await within(region).findByTestId('change-row-M')).toBeInTheDocument();
    expect(region).toHaveAttribute('data-state', 'ready');
    expect(within(region).getByTestId('change-row-?')).toBeInTheDocument();
    expect(within(region).getByText(/docs\/x\.md/)).toBeInTheDocument();
  });

  it('changes: live + clean → «Изменений нет»', async () => {
    const list = vi.fn().mockResolvedValue({
      state: 'clean', cwd: 'D:/<repo>', branch: 'master', entries: [], truncated: false,
    });
    const bridge = bridgeWith({ changes: { list }, files: filesOk });
    render(<NewfMod name="changes" data={liveData} activeTab="active" bridge={bridge} />);
    expect(await screen.findByTestId('change-list-empty')).toBeInTheDocument();
    expect(screen.getByText('Изменений нет')).toBeInTheDocument();
  });

  it('changes: live + not_a_repository → честный текст', async () => {
    const list = vi.fn().mockResolvedValue({
      state: 'not_a_repository', cwd: 'C:/Users', entries: [], truncated: false,
    });
    const bridge = bridgeWith({ changes: { list }, files: filesOk });
    render(<NewfMod name="changes" data={liveData} activeTab="active" bridge={bridge} />);
    expect(await screen.findByText('Это не git-дерево.')).toBeInTheDocument();
  });

  it('changes: live + capability без роута → unavailable, не mock', async () => {
    const list = vi.fn().mockResolvedValue({
      state: 'unavailable', cwd: '', entries: [], truncated: false, detail: 'Not Found',
    });
    const bridge = bridgeWith({ changes: { list }, files: filesOk });
    render(<NewfMod name="changes" data={liveData} activeTab="active" bridge={bridge} />);
    const region = screen.getByRole('region', { name: 'Mod Changes' });
    expect(await within(region).findByText(/источник не подключён/)).toBeInTheDocument();
    expect(region).toHaveAttribute('data-state', 'unavailable');
  });

  it('machine-add: live + happy machines.list → rows, data-state ready', async () => {
    const list = vi.fn().mockResolvedValue([
      { name: 'local', host: 'localhost', transport: 'local', state: 'connected', since_ms: 1, why: null, labels: {} },
      { name: 'worker-2', host: 'bob@10.0.0.7', transport: 'ssh', state: 'connecting', since_ms: 2, why: null, labels: { purpose: 'build' } },
    ]);
    const bridge = bridgeWith({ machines: { list, get: vi.fn(), schema: vi.fn() } });
    render(<NewfMod name="machine-add" data={liveData} activeTab="active" bridge={bridge} />);
    const region = await screen.findByRole('region', { name: 'Add a machine' });
    expect(region).toHaveAttribute('data-state', 'ready');
    expect(await within(region).findByText('worker-2')).toBeInTheDocument();
    expect(within(region).getByText('local')).toBeInTheDocument();
  });

  it('machine-add: live + пустой реестр → честное сообщение', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const bridge = bridgeWith({ machines: { list, get: vi.fn(), schema: vi.fn() } });
    render(<NewfMod name="machine-add" data={liveData} activeTab="active" bridge={bridge} />);
    expect(await screen.findByTestId('machine-list-empty')).toBeInTheDocument();
  });

  it('machine-add: live + denied (403) → machine-state-denied, форма disabled', async () => {
    const list = vi.fn().mockRejectedValue(new BridgeHttpError(403, 'bridge 403: {"error":"denied"}', { error: 'denied' }));
    const bridge = bridgeWith({ machines: { list, get: vi.fn(), schema: vi.fn() } });
    render(<NewfMod name="machine-add" data={liveData} activeTab="active" bridge={bridge} />);
    expect(await screen.findByTestId('machine-state-denied')).toBeInTheDocument();
    expect(screen.getByLabelText('Machine host')).toBeDisabled();
  });

  it('machine-add: live + capability без роута → unavailable, форма disabled', async () => {
    const list = vi.fn().mockRejectedValue(new BridgeHttpError(404, 'bridge 404: Not Found', 'Not Found'));
    const bridge = bridgeWith({ machines: { list, get: vi.fn(), schema: vi.fn() } });
    render(<NewfMod name="machine-add" data={liveData} activeTab="active" bridge={bridge} />);
    const region = screen.getByRole('region', { name: 'Add a machine' });
    expect(await within(region).findByText(/provisioning недоступен через мост/)).toBeInTheDocument();
    expect(region).toHaveAttribute('data-state', 'unavailable');
    expect(screen.getByLabelText('Machine host')).toBeDisabled();
  });
});
