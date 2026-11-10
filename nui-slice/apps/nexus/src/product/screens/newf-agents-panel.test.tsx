import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  NewfAgentsPanel,
  formatRelative,
  fmtDuration,
  groupOf,
  groupTerminals,
  machineBadge,
} from './newf-agents-panel';
import { BridgeUnavailable, type LiveTerminal, type MachineDetail, type MachineRecord, type NewfBridge } from './newf-live';

afterEach(() => { cleanup(); window.localStorage.clear(); });

function term(partial: Partial<LiveTerminal>): LiveTerminal {
  return {
    address: 'local/t1',
    label: 't1',
    state: 'idle',
    ...partial,
  };
}

describe('groupOf / groupTerminals (#536)', () => {
  it('maps states into working/idle/done/attention groups', () => {
    expect(groupOf('working')).toBe('working');
    expect(groupOf('idle')).toBe('idle');
    expect(groupOf('blocked')).toBe('attention');
    expect(groupOf('error')).toBe('attention');
    expect(groupOf('done')).toBe('done');
    expect(groupOf('archived')).toBe('archived');
  });

  it('groups and sorts terminals by label', () => {
    const terms = [
      term({ address: 'local/b', label: 'B', state: 'done' }),
      term({ address: 'local/a', label: 'A', state: 'working' }),
      term({ address: 'local/c', label: 'C', state: 'blocked' }),
      term({ address: 'local/d', label: 'D', state: 'idle' }),
      term({ address: 'local/e', label: 'E', state: 'error' }),
    ];
    const g = groupTerminals(terms);
    expect(g.working.map((t) => t.label)).toEqual(['A']);
    expect(g.idle.map((t) => t.label)).toEqual(['D']);
    expect(g.done.map((t) => t.label)).toEqual(['B']);
    expect(g.attention.map((t) => t.label)).toEqual(['C', 'E']); // blocked+error
  });

  it('W30: archived → отдельная группа archived', () => {
    const g = groupTerminals([
      term({ address: 'local/a', label: 'A', state: 'archived' }),
      term({ address: 'local/b', label: 'B', state: 'idle' }),
    ]);
    expect(g.archived.map((t) => t.label)).toEqual(['A']);
    expect(g.idle.map((t) => t.label)).toEqual(['B']);
  });
});

describe('formatRelative (#536)', () => {
  const now = 1_000_000;
  it('formats unix-seconds deltas', () => {
    expect(formatRelative(now - 5, now)).toBe('now');
    expect(formatRelative(now - 45, now)).toBe('45s');
    expect(formatRelative(now - 180, now)).toBe('3m');
    expect(formatRelative(now - 7200, now)).toBe('2h');
    expect(formatRelative(now - 5 * 86400, now)).toBe('5d');
  });
  it('handles missing/future timestamps', () => {
    expect(formatRelative(undefined, now)).toBe('—');
    expect(formatRelative(NaN, now)).toBe('—');
    expect(formatRelative(now + 60, now)).toBe('now'); // clock skew → clamp
  });

  it('W61: fmtDuration форматирует длительность', () => {
    expect(fmtDuration(5)).toBe('5s');
    expect(fmtDuration(45)).toBe('45s');
    expect(fmtDuration(180)).toBe('3m');
    expect(fmtDuration(7200)).toBe('2h');
    expect(fmtDuration(5 * 86400)).toBe('5d');
  });
});

describe('machineBadge (#536)', () => {
  it('classifies machine states', () => {
    expect(machineBadge('connected').label).toBe('connected');
    expect(machineBadge('unreachable').label).toBe('unreachable');
    expect(machineBadge('needs_login').label).toBe('needs login');
    expect(machineBadge('weird').label).toBe('weird');
  });
});

describe('NewfAgentsPanel ctx-menu #552', () => {
  function fakeBridge(): NewfBridge {
    return {
      spaces: async () => [],
      terminals: async () => [term({ address: 'local/t1', label: 't1' })],
      agents: async () => [],
      screen: async () => '',
      send: async () => {},
      keys: async () => {},
      run: async () => ({ address: 'local/new' }),
      programs: async () => [
        { id: 'claude', title: 'Claude Code', cmd: ['claude'], cwd: 'D:/<repo>', available: true, resolved: 'claude' },
        { id: 'gobl', title: 'Gobl', cmd: ['gobl'], cwd: null, available: false, resolved: null },
      ],
      runProgram: async (id) => ({ address: `local/${id}-1` }),
      capabilities: async () => ({ endpoints: { programs: true, restart: true, dump: true } }),
    };
  }

  it('Open floating вызывает onOpenFloating(term)', async () => {
    const opened: string[] = [];
    render(<NewfAgentsPanel bridge={fakeBridge()} pollMs={50} onOpenFloating={(a) => opened.push(a)} />);
    const row = await screen.findByTestId('term-row-local/t1');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    const btn = await screen.findByTestId('ctx-open-float');
    btn.click();
    expect(opened).toEqual(['local/t1']);
  });

  it('#564: New terminal ▾ рендерит программы; unavailable серая; клик → runProgram + открыть', async () => {
    const opened: string[] = [];
    render(<NewfAgentsPanel bridge={fakeBridge()} pollMs={50} onOpenFloating={(a) => opened.push(a)} />);
    const row = await screen.findByTestId('term-row-local/t1');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    (await screen.findByTestId('ctx-new-term')).click();

    const claude = await screen.findByTestId('ctx-program-claude');
    expect(claude).toHaveTextContent('Claude Code');
    const gobl = screen.getByTestId('ctx-program-gobl');
    expect(gobl).toBeDisabled();
    expect(gobl).toHaveAttribute('title', 'недоступна (resolved: null)');

    claude.click();
    await waitFor(() => expect(opened).toEqual(['local/claude-1']));
  });

  it('#564: офлайн-фоллбэк — programs [] → «custom only», custom command работает', async () => {
    const bridge = fakeBridge();
    bridge.programs = async () => [];
    const opened: string[] = [];
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('node worker.js');
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} onOpenFloating={(a) => opened.push(a)} />);
    const row = await screen.findByTestId('term-row-local/t1');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    (await screen.findByTestId('ctx-new-term')).click();

    expect(await screen.findByText('programs offline — custom only')).toBeInTheDocument();
    screen.getByTestId('ctx-custom-command').click();
    await waitFor(() => expect(opened).toEqual(['local/new']));
    promptSpy.mockRestore();
  });

  it('W3: Spawn child ▾ — picker из programs, клик → spawnChild + открыть', async () => {
    const bridge = fakeBridge();
    bridge.spawnChild = async (parent, opts) => ({ address: `${parent}/child-1` });
    bridge.restart = async () => ({ ok: true });
    bridge.terminals = async () => [term({ address: 'local/t1', label: 't1', state: 'done' })];
    const opened: string[] = [];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} onOpenFloating={(a) => opened.push(a)} />);
    const row = await screen.findByTestId('term-row-local/t1');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));

    (await screen.findByTestId('ctx-spawn-child')).click();
    (await screen.findByTestId('ctx-spawn-program-claude')).click();
    await waitFor(() => expect(opened).toEqual(['local/t1/child-1']));
  });

  it('W3: Restart виден только для done/error и вызывает restart()', async () => {
    const bridge = fakeBridge();
    bridge.restart = vi.fn().mockResolvedValue({ ok: true });
    bridge.terminals = async () => [term({ address: 'local/t1', label: 't1', state: 'done' })];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);
    const row = await screen.findByTestId('term-row-local/t1');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));

    const restart = await screen.findByTestId('ctx-restart');
    restart.click();
    await waitFor(() => expect(bridge.restart).toHaveBeenCalledWith('local/t1'));
  });

  it('W4: attention-событие → бейдж ● на строке терминала', async () => {
    const bridge = fakeBridge();
    bridge.terminals = async () => [term({ address: 'local/t1', label: 't1', state: 'blocked', attention: true })];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);
    const badge = await screen.findByTestId('attention-local/t1');
    expect(badge).toHaveTextContent('●');
    expect(badge).toHaveAttribute('role', 'status');
  });

  it('W5: gating off (нет capabilities) → пункты меню активны', async () => {
    const bridge = fakeBridge();
    bridge.capabilities = undefined;
    bridge.restart = async () => ({ ok: true });
    bridge.terminals = async () => [term({ address: 'local/t1', label: 't1', state: 'done' })];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);
    const row = await screen.findByTestId('term-row-local/t1');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    const newTerm = await screen.findByTestId('ctx-new-term');
    expect(newTerm).not.toBeDisabled();
    expect(await screen.findByTestId('ctx-restart')).toBeInTheDocument();
  });

  it('W5: capabilities определена → программы выключены (disabled + title)', async () => {
    const bridge = fakeBridge();
    bridge.capabilities = async () => ({ endpoints: { programs: false, restart: false } });
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);
    const row = await screen.findByTestId('term-row-local/t1');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    const newTerm = await screen.findByTestId('ctx-new-term');
    expect(newTerm).toBeDisabled();
    expect(newTerm).toHaveAttribute('title', 'programs: capability отключена');
    expect(screen.queryByTestId('ctx-restart')).not.toBeInTheDocument();
  });

  it('W6: children под parent (иконка ⛓/○), collapse-стрелка скрывает детей', async () => {
    const bridge = fakeBridge();
    bridge.terminals = async () => [
      term({ address: 'local/t1', label: 't1', state: 'idle' }),
      term({ address: 'local/t1-child', label: 'child', state: 'idle', parent: 'local/t1', dieWithParent: true }),
      term({ address: 'local/t1-surv', label: 'surv', state: 'idle', parent: 'local/t1', dieWithParent: false }),
    ];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    await screen.findByTestId('term-row-local/t1-child');
    expect(screen.getByTestId('tree-icon-local/t1-child')).toHaveTextContent('⛓');
    expect(screen.getByTestId('tree-icon-local/t1-surv')).toHaveTextContent('○');
    expect(screen.getByTestId('survivor-local/t1-surv')).toHaveTextContent('survivor');

    fireEvent.click(screen.getByTestId('collapse-local/t1'));
    await waitFor(() => {
      expect(screen.queryByTestId('term-row-local/t1-child')).not.toBeInTheDocument();
    });
  });

  it('W9: детальная карточка машины — uptime/terms/cpu/mem', async () => {
    const bridge = fakeBridge();
    bridge.machines = {
      list: async (): Promise<MachineRecord[]> => [
        { name: 'local', host: 'localhost', transport: 'local', state: 'connected', since_ms: 1, why: null, labels: {} },
        { name: 'roy2', host: 'roy2', transport: 'ssh', state: 'unreachable', since_ms: 2, why: 'conn refused', labels: {} },
      ],
      get: async () => ({ found: false }),
      schema: async () => ({ name_pattern: '', host_pattern: '', transports: [], host_default_to_name: true, source: 'embedded' }),
    };
    bridge.machinesDetail = async (): Promise<MachineDetail[]> => [
      { name: 'local', state: 'connected', uptime_s: 3661, terminals: 2, metrics: { cpu: 12.5, mem: 41, uptime_s: 999 } },
      { name: 'roy2', state: 'unreachable', why: 'conn refused', uptime_s: 0, terminals: 0 },
    ];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    await waitFor(() => expect(screen.getByText(/up 1h/)).toBeInTheDocument());
    expect(screen.getByText(/cpu 13%/)).toBeInTheDocument();
    expect(screen.getByText(/mem 41%/)).toBeInTheDocument();
    expect(screen.getByText(/2 terms/)).toBeInTheDocument();
  });

  it('W11: labels-бейджи на строке + кнопка редактора', async () => {
    const bridge = fakeBridge();
    bridge.setLabels = vi.fn().mockResolvedValue({ ok: true });
    bridge.terminals = async () => [term({
      address: 'local/t1', label: 't1', state: 'idle',
      labels: { role: 'coder', team: 'forge' },
    })];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    const chips = await screen.findByTestId('labels-local/t1');
    expect(chips).toHaveTextContent('role:coder');
    expect(chips).toHaveTextContent('team:forge');
    expect(screen.getByTestId('edit-labels-local/t1')).toBeInTheDocument();
  });

  it('W13: Clone в ctx-menu → cloneTerminal + открыть floating', async () => {
    const bridge = fakeBridge();
    bridge.cloneTerminal = async () => ({ address: 'local/t1-clone' });
    const opened: string[] = [];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} onOpenFloating={(a) => opened.push(a)} />);
    const row = await screen.findByTestId('term-row-local/t1');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));

    (await screen.findByTestId('ctx-clone')).click();
    await waitFor(() => expect(opened).toEqual(['local/t1-clone']));
  });

  it('W14: worktree-секция с бейджами dirty/failed', async () => {
    const bridge = fakeBridge();
    bridge.worktrees = async () => [
      { main: true, name: 'nexus', path: 'D:/<repo>', branch: 'master' },
      { main: false, name: 'wt-a', path: 'D:/<repo>-wt-a', branch: 'wt-a', status: 'dirty' },
      { main: false, name: 'wt-b', path: 'D:/<repo>-wt-b', branch: 'wt-b', status: 'failed', locked: true },
    ];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    await screen.findByTestId('worktree-wt-a');
    expect(screen.getByTestId('wt-dirty-wt-a')).toHaveTextContent('dirty');
    expect(screen.getByTestId('wt-failed-wt-b')).toHaveTextContent('failed');
    expect(screen.queryByTestId('worktree-nexus')).not.toBeInTheDocument(); // main скрыт
  });

  it('W17: кнопка «запустить cockpit» видна при наличии workspaceSpawn', async () => {
    const bridge = fakeBridge();
    bridge.workspaceTemplates = async () => [];
    bridge.workspaceSpawn = vi.fn().mockResolvedValue({ created: ['t1'], terminals: ['local/t1'] });
    const opened: string[] = [];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} onOpenFloating={(a) => opened.push(a)} />);

    const btn = await screen.findByTestId('cockpit-spawn');
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('cockpit');
    btn.click();
    await waitFor(() => expect(opened).toEqual(['local/t1']));
    promptSpy.mockRestore();
  });

  it('W18: мультивыбор → batch-бар → kill', async () => {
    const bridge = fakeBridge();
    bridge.batch = vi.fn().mockResolvedValue({ results: { 'local/t1': { ok: true } } });
    bridge.terminals = async () => [
      term({ address: 'local/t1', label: 't1', state: 'idle' }),
      term({ address: 'local/t2', label: 't2', state: 'idle' }),
    ];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    fireEvent.click(await screen.findByTestId('select-local/t1'));
    const bar = await screen.findByTestId('batch-bar');
    expect(screen.getByTestId('batch-count')).toHaveTextContent('1 selected');
    fireEvent.click(screen.getByTestId('batch-kill'));
    await waitFor(() => expect(bridge.batch).toHaveBeenCalledWith({ action: 'kill', terms: ['local/t1'] }));
  });

  it('W19: Snapshot в ctx-menu → snapshot()', async () => {
    const bridge = fakeBridge();
    bridge.snapshot = vi.fn().mockResolvedValue({ path: 'snapshots/t1-1.json' });
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);
    const row = await screen.findByTestId('term-row-local/t1');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    fireEvent.click(await screen.findByTestId('ctx-snapshot'));
    await waitFor(() => expect(bridge.snapshot).toHaveBeenCalledWith('local/t1'));
  });

  it('W20: approval-баннер → approve/deny вызывает approvalDecide (без токена — undefined)', async () => {
    const bridge = fakeBridge();
    let resolved = false;
    bridge.approvals = async () => (resolved ? [] : [
      { approval_id: 'a1', status: 'pending', action: 'kill', subject: 'local/t1' },
    ]);
    bridge.approvalDecide = vi.fn(async () => { resolved = true; return { ok: true }; });
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    await screen.findByTestId('approval-banner');
    fireEvent.click(screen.getByTestId('approve-a1'));
    await waitFor(() => expect(bridge.approvalDecide).toHaveBeenCalledWith('a1', true, ''));
    await waitFor(() => expect(screen.queryByTestId('approval-banner')).not.toBeInTheDocument());
  });

  it('W36: dual-control — прогресс 1/2 + кто голосовал + двойной approve → executed → баннер уходит', async () => {
    const bridge = fakeBridge();
    bridge.approvals = async () => [ // константа: не зависит от мутаций — тест детерминирован
      {
        approval_id: 'a2', status: 'pending', action: 'kill', subject: 'local/t1',
        dualControl: true, requiredApprovals: 2, decidedBy: ['alice'],
      },
    ];
    // первый approve → 202 pending (голос 2/2); повторный → executed
    bridge.approvalDecide = vi.fn()
      .mockResolvedValueOnce({ ok: false, pending: true, decidedBy: ['alice', 'bob'], requiredApprovals: 2 })
      .mockResolvedValueOnce({ ok: true });
    // медленный poll (5s): исключаем гонки с повторным /approvals между кликами
    render(<NewfAgentsPanel bridge={bridge} pollMs={5000} />);

    await screen.findByTestId('approval-banner');
    expect(screen.getByTestId('approval-progress-a2')).toHaveTextContent('1/2 голосов');
    expect(screen.getByTestId('approval-by-a2')).toHaveTextContent('alice');

    fireEvent.change(screen.getByTestId('admin-token-input'), { target: { value: 'tok-2' } });
    fireEvent.click(screen.getByTestId('approve-a2'));
    await waitFor(() => expect(bridge.approvalDecide).toHaveBeenCalledWith('a2', true, 'tok-2'));
    // 202 → строка остаётся, прогресс 2/2
    await waitFor(() => expect(screen.getByTestId('approval-progress-a2')).toHaveTextContent('2/2 голосов'));
    expect(screen.getByTestId('approval-banner')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('approve-a2'));
    await waitFor(() => expect(bridge.approvalDecide).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('approval-banner')).not.toBeInTheDocument());
  });

  it('W36: 503 (ключи не настроены) → честная ошибка, баннер остаётся', async () => {
    const bridge = fakeBridge();
    bridge.approvals = async () => [
      { approval_id: 'a3', status: 'pending', action: 'kill', subject: 'local/t1' },
    ];
    bridge.approvalDecide = vi.fn().mockRejectedValue(new Error('bridge 503: AEGIS admin disabled: AEGIS_ADMIN_TOKEN not set'));
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    await screen.findByTestId('approval-banner');
    fireEvent.click(screen.getByTestId('approve-a3'));
    await waitFor(() => expect(screen.getByTestId('approval-error')).toHaveTextContent(/503/));
    expect(screen.getByTestId('approval-banner')).toBeInTheDocument();
  });

  it('W56: 202 pending → строка остаётся, прогресс 1/2 обновляется', async () => {
    const bridge = fakeBridge();
    // Сервер после vote памятит голос: поллинг (pollMs=50) обязан возвращать
    // уже обновлённый decidedBy, иначе следующий тик затирает локальный state
    // (флаки в полном scoped прогоне: 'alice' исчезал через 50мс).
    let decidedBy: string[] = [];
    bridge.approvals = async () => [
      {
        approval_id: 'a4', status: 'pending', action: 'kill', subject: 'local/t1',
        dualControl: true, requiredApprovals: 2, decidedBy,
      },
    ];
    bridge.approvalDecide = vi.fn(async () => {
      decidedBy = ['alice'];
      return {
        ok: false, pending: true, decidedBy, requiredApprovals: 2,
      };
    });
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    await screen.findByTestId('approval-banner');
    fireEvent.click(screen.getByTestId('approve-a4'));
    await waitFor(() => expect(screen.getByTestId('approval-progress-a4')).toHaveTextContent('1/2 голосов'), { timeout: 5000 });
    await waitFor(() => expect(screen.getByTestId('approval-by-a4')).toHaveTextContent('alice'));
    expect(screen.getByTestId('approval-banner')).toBeInTheDocument(); // не удалена
  });

  it('W56: GET /approvals ошибка → offline-плашка, не пустая очередь', async () => {
    const bridge = fakeBridge();
    bridge.approvals = vi.fn().mockRejectedValue(new Error('bridge 503: unavailable'));
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    await waitFor(() => expect(screen.getByTestId('approval-offline')).toBeInTheDocument());
    expect(screen.queryByTestId('approval-banner')).not.toBeInTheDocument();
  });

  it('W29: заметка отображается на карточке', async () => {
    const bridge = fakeBridge();
    bridge.setNote = vi.fn().mockResolvedValue({ ok: true });
    bridge.terminals = async () => [term({
      address: 'local/t1', label: 't1', state: 'idle',
      labels: { note: 'в работе' },
    })];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    const note = await screen.findByTestId('note-local/t1');
    expect(note).toHaveTextContent('в работе');
    expect(screen.getByTestId('edit-note-local/t1')).toBeInTheDocument();
  });

  it('W30: архивный терминал скрыт по умолчанию; тогл показывает группу ARCHIVED + метку', async () => {
    const bridge = fakeBridge();
    bridge.terminals = async () => [
      term({ address: 'local/t1', label: 't1', state: 'idle' }),
      term({ address: 'local/t2', label: 't2', state: 'archived' }),
    ];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    // по умолчанию архивный скрыт, live-счётчик не учитывает его
    await screen.findByTestId('term-row-local/t1');
    expect(screen.queryByTestId('term-row-local/t2')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('live · 1');

    fireEvent.click(screen.getByTestId('toggle-archived'));
    expect(await screen.findByTestId('term-row-local/t2')).toBeInTheDocument();
    expect(screen.getByTestId('archived-local/t2')).toHaveTextContent('архив');
    // группа ARCHIVED отрисована
    expect(screen.getByLabelText('ARCHIVED')).toBeInTheDocument();
  });

  it('W30: Archive в ctx-menu → archive(term)', async () => {
    const bridge = fakeBridge();
    bridge.archive = vi.fn().mockResolvedValue({ ok: true });
    bridge.terminals = async () => [term({ address: 'local/t1', label: 't1', state: 'idle' })];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);
    const row = await screen.findByTestId('term-row-local/t1');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    fireEvent.click(await screen.findByTestId('ctx-archive'));
    await waitFor(() => expect(bridge.archive).toHaveBeenCalledWith('local/t1'));
  });

  it('W30: Archive скрыт для уже архивного терминала', async () => {
    const bridge = fakeBridge();
    bridge.archive = vi.fn();
    bridge.terminals = async () => [
      term({ address: 'local/t2', label: 't2', state: 'archived' }),
    ];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);
    fireEvent.click(screen.getByTestId('toggle-archived'));
    const row = await screen.findByTestId('term-row-local/t2');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(screen.queryByTestId('ctx-archive')).not.toBeInTheDocument();
  });

  it('W31: индикатор send-очереди на карточке (глубина), без flush при отсутствии метода', async () => {
    const bridge = fakeBridge();
    bridge.sendQueues = async () => ({ 'local/t1': 3 });
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    const badge = await screen.findByTestId('sendq-local/t1');
    expect(badge).toHaveTextContent('▸ 3');
    expect(screen.queryByTestId('flush-sendq-local/t1')).not.toBeInTheDocument(); // метода нет
  });

  it('W31: flush-кнопка → flushSendQueue(term), бейдж исчезает', async () => {
    const bridge = fakeBridge();
    let depth = 3;
    bridge.sendQueues = async () => ({ 'local/t1': depth });
    bridge.flushSendQueue = vi.fn(async () => { depth = 0; return { term: 'local/t1', cleared: 3 }; });
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    const badge = await screen.findByTestId('sendq-local/t1');
    fireEvent.click(screen.getByTestId('flush-sendq-local/t1'));
    await waitFor(() => expect(bridge.flushSendQueue).toHaveBeenCalledWith('local/t1'));
    await waitFor(() => expect(screen.queryByTestId('sendq-local/t1')).not.toBeInTheDocument());
    expect(badge).not.toBeInTheDocument();
  });

  it('W32: бейджи terms/live из spacesDetail на строках спейсов', async () => {
    const bridge = fakeBridge();
    bridge.spaces = async () => [{ id: 'ops', name: 'ops', machine: 'local' }];
    bridge.spacesDetail = async () => [
      { id: 'ops', terms: 2, live: 1, labels: [], members: ['local/t1', 'local/t2'] },
    ];
    bridge.terminals = async () => [
      term({ address: 'local/t1', label: 't1', state: 'working', spaceId: 'ops' }),
      term({ address: 'local/t2', label: 't2', state: 'done', spaceId: 'ops' }),
    ];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    await screen.findByTestId('space-row-ops');
    expect(screen.getByTestId('space-live-ops')).toHaveTextContent('1 live');
    expect(screen.getByTestId('space-terms-ops')).toHaveTextContent('2 terms');
  });

  it('W32: клик по спейсу фильтрует карточки по members; сброс возвращает все', async () => {
    const bridge = fakeBridge();
    bridge.spaces = async () => [{ id: 'ops', name: 'ops', machine: 'local' }];
    bridge.spacesDetail = async () => [
      { id: 'ops', terms: 1, live: 1, labels: [], members: ['local/t1'] },
    ];
    bridge.terminals = async () => [
      term({ address: 'local/t1', label: 't1', state: 'working', spaceId: 'ops' }),
      term({ address: 'local/t2', label: 't2', state: 'idle', spaceId: 'other' }),
    ];
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    await screen.findByTestId('term-row-local/t1');
    expect(screen.getByTestId('term-row-local/t2')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('space-filter-ops'));
    await waitFor(() => expect(screen.queryByTestId('term-row-local/t2')).not.toBeInTheDocument());
    expect(screen.getByTestId('term-row-local/t1')).toBeInTheDocument();
    expect(screen.getByTestId('space-filter-ops')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('space-filter-ops'));
    await waitFor(() => expect(screen.getByTestId('term-row-local/t2')).toBeInTheDocument());
    expect(screen.getByTestId('space-filter-ops')).toHaveAttribute('aria-pressed', 'false');
  });
});

function fakeBridge(overrides: Partial<NewfBridge> = {}): NewfBridge {
  return {
    spaces: async () => [],
    terminals: async () => [],
    agents: async () => [],
    screen: async () => '',
    send: async () => {},
    keys: async () => {},
    ...overrides,
  };
}

describe('NewfAgentsPanel render (#536)', () => {
  it('renders machines on top and grouped agents', async () => {
    const bridge = fakeBridge({
      terminals: async () => [
        term({ address: 'local/alice', label: 'AGENT-A', state: 'working', machine: 'local', createdAt: 999_000 }),
        term({ address: 'local/forge', label: 'ROLE-2', state: 'idle', machine: 'sage', createdAt: 998_000 }),
        term({ address: 'local/codex', label: 'ROLE-1', state: 'done', machine: 'roy', exitedAt: 999_500 }),
        term({ address: 'local/ace', label: 'AGENT-B', state: 'blocked', machine: 'local', createdAt: 999_700 }),
      ],
      machines: {
        schema: async () => ({ name_pattern: '', host_pattern: '', transports: [], host_default_to_name: false, source: 'embedded' }),
        list: async () => [
          { name: 'local', host: 'local', transport: 'local', state: 'connected', since_ms: 1, labels: {} },
          { name: 'roy2', host: 'roy2', transport: 'ssh', state: 'unreachable', since_ms: 0, why: 'timeout', labels: {} },
        ],
        get: async () => ({ found: false }),
      },
    });
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} now={() => 1_000_000_000} />);

    await waitFor(() => expect(screen.getAllByText('AGENT-A').length).toBeGreaterThan(0));
    expect(screen.getAllByText('ROLE-2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ROLE-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AGENT-B').length).toBeGreaterThan(0);
    // машины: обе строки с connected/unreachable
    expect(screen.getByText('roy2')).toBeInTheDocument();
    expect(screen.getByText('unreachable')).toBeInTheDocument();
    expect(screen.getByText('connected')).toBeInTheDocument();
    // группы: WORKING / IDLE / DONE / NEEDS ATTENTION
    expect(screen.getByRole('region', { name: 'WORKING' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'IDLE' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'DONE' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'NEEDS ATTENTION' })).toBeInTheDocument();
  });

  it('shows offline state when bridge is unreachable', async () => {
    const bridge = fakeBridge({
      terminals: async () => { throw new BridgeUnavailable('bridge unreachable: x'); },
    });
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/core unreachable/)).toBeInTheDocument();
  });

  it('shows empty state on live core without terminals', async () => {
    render(<NewfAgentsPanel bridge={fakeBridge()} pollMs={50} />);
    await waitFor(() => expect(screen.getByText('no terminals on core')).toBeInTheDocument());
  });
});

describe('NewfAgentsPanel W61 (pin/duration)', () => {
  it('W60: spaces-строки — avatar-буква + gitTail (branch или machine)', async () => {
    const bridge = fakeBridge({
      spaces: async () => [
        { id: 'ops', name: 'ops', machine: 'local' },
        { id: 'dev', name: 'dev', machine: 'machine-A' },
      ],
      worktrees: async () => [
        { main: true, name: 'nexus', path: 'D:/<repo>', branch: 'master' },
        { main: false, name: 'ops', path: 'D:/ops', branch: 'refs/heads/fix/x' },
      ],
      terminals: async () => [],
    });
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    await screen.findByTestId('space-row-ops');
    // avatar: первая буква имени
    expect(screen.getByTestId('space-row-ops').querySelector('[class*="spaceAvatar"]')).toHaveTextContent('O');
    // gitTail: branch (fix/x) для спейса, попавшего в worktree
    expect(screen.getByTestId('space-git-ops')).toHaveTextContent('ops · fix/x');
    // gitTail: machine для спейса без worktree
    expect(screen.getByTestId('space-git-dev')).toHaveTextContent('machine-A');
  });

  it('pin-кнопка: закрепление ставит строку первой в группе и персистится', async () => {
    const bridge = fakeBridge({
      terminals: async () => [
        term({ address: 'local/a', label: 'a', state: 'idle' }),
        term({ address: 'local/b', label: 'b', state: 'idle' }),
      ],
    });
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    await screen.findByTestId('term-row-local/a');
    const order = () => {
      const rows = [...document.querySelectorAll('[data-testid^="term-row-"]')].map((n) => n.getAttribute('data-testid'));
      return rows;
    };
    expect(order()).toEqual(['term-row-local/a', 'term-row-local/b']);

    fireEvent.click(screen.getByTestId('pin-local/b'));
    await waitFor(() => expect(order()).toEqual(['term-row-local/b', 'term-row-local/a']));
    expect(screen.getByTestId('pin-local/b')).toHaveAttribute('aria-pressed', 'true');

    // персист: после перерендера (новый маунт) pin сохраняется
    cleanup();
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);
    await screen.findByTestId('term-row-local/a');
    expect(order()).toEqual(['term-row-local/b', 'term-row-local/a']);

    // открепить → порядок восстанавливается
    fireEvent.click(screen.getByTestId('pin-local/b'));
    await waitFor(() => expect(order()).toEqual(['term-row-local/a', 'term-row-local/b']));
  });

  it('duration: рабочий — «· 1m»; done — «took 45s»', async () => {
    const nowMs = 1_000_000_000_000; // Date.now()-совместимо: компонент делит на 1000
    const bridge = fakeBridge({
      terminals: async () => [
        term({ address: 'local/w', label: 'w', state: 'working', createdAt: nowMs / 1000 - 90 }),
        term({ address: 'local/d', label: 'd', state: 'done', createdAt: nowMs / 1000 - 120, exitedAt: nowMs / 1000 - 75 }),
      ],
    });
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} now={() => nowMs} />);

    await screen.findByTestId('term-row-local/w');
    expect(screen.getByTestId('term-row-local/w').textContent).toContain('· 1m');
    expect(screen.getByTestId('term-row-local/d').textContent).toContain('took 45s');
  });

  it('W66: sort toggle — priority ставит NEEDS ATTENTION первой секцией', async () => {
    const bridge = fakeBridge({
      terminals: async () => [
        term({ address: 'local/w', label: 'w', state: 'working' }),
        term({ address: 'local/b', label: 'b', state: 'blocked' }),
      ],
    });
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    const agentGroups = () => Array.from(document.querySelectorAll('section[aria-label]'))
      .map((n) => n.getAttribute('aria-label'))
      .filter((l): l is string => l !== null && ['WORKING', 'IDLE', 'DONE', 'NEEDS ATTENTION', 'ARCHIVED'].includes(l));
    await waitFor(() => expect(agentGroups()).toContain('WORKING'));

    // grouped: WORKING раньше NEEDS ATTENTION
    const g1 = agentGroups();
    expect(g1.indexOf('WORKING')).toBeLessThan(g1.indexOf('NEEDS ATTENTION'));

    fireEvent.click(screen.getByTestId('agent-sort'));
    await waitFor(() => expect(agentGroups()[0]).toBe('NEEDS ATTENTION'));
    expect(screen.getByTestId('agent-sort')).toHaveAttribute('aria-pressed', 'true');
  });

  it('W66: drag-reorder спейсов — drop меняет порядок + персистится', async () => {
    const bridge = fakeBridge({
      spaces: async () => [
        { id: 'a', name: 'a', machine: 'local' },
        { id: 'b', name: 'b', machine: 'local' },
      ],
      terminals: async () => [],
    });
    render(<NewfAgentsPanel bridge={bridge} pollMs={50} />);

    const order = () => Array.from(document.querySelectorAll('[data-testid^="space-row-"]')).map((n) => n.getAttribute('data-testid'));
    await waitFor(() => expect(order()).toEqual(['space-row-a', 'space-row-b']));

    const a = screen.getByTestId('space-row-a');
    const b = screen.getByTestId('space-row-b');
    fireEvent.dragStart(b);
    fireEvent.dragOver(a);
    fireEvent.drop(a);

    await waitFor(() => expect(order()).toEqual(['space-row-b', 'space-row-a']));
    expect(window.localStorage.getItem('newf.spaces.order.v1')).toBe('["b","a"]');
  });
});
