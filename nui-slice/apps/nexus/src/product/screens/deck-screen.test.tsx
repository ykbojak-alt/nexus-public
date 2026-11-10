// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeckScreen, formatUptime, formatSince } from './deck-screen';
import type { NewfBridge, MachineSchema, LiveTerminal, LiveAgent, MachineRecord } from './newf-live';
import { EMBEDDED_SCHEMA } from './newf-live';

afterEach(cleanup);

function fakeBridge(overrides: Partial<NewfBridge> = {}): NewfBridge {
  return {
    spaces: async () => [],
    terminals: async () => [],
    agents: async () => [],
    screen: async () => '',
    send: async () => {},
    keys: async () => {},
    deck: vi.fn(async () => ({
      connected: true,
      eventsConnected: true,
      version: '0.1.18',
      lastError: '',
      uptimeS: 212.5,
      terminals: 0,
      machines: 0,
      eventsSeq: 24,
      session: 'nx-deck',
    })),
    server: vi.fn(async () => ({ version: 'N3.1.0', uptime_s: 3600, state: 'running', host: 'remote-host' })),
    machines: {
      schema: async (): Promise<MachineSchema> => EMBEDDED_SCHEMA,
      list: vi.fn(async () => [] as MachineRecord[]),
      get: async () => ({ found: false as const }),
    },
    ...overrides,
  };
}

const AGENTS: LiveAgent[] = [
  { id: 'machine-A/term-1', name: 'ROLE-1 / 1', terminal: 'machine-A/term-1', status: 'working', seat: 'term-1', app: 'codex', turn: 94, machine: 'machine-A', cwd: 'D:\\nexus' },
  { id: 'machine-B/term-1', name: 'ROLE-2 / 1', terminal: 'machine-B/term-1', status: 'working', seat: 'term-2', app: 'claude-code', turn: 41, machine: 'machine-A' },
];

const TERMINALS: LiveTerminal[] = [
  { address: 'local/t1', label: 'forge', state: 'working', agent: 'forge', machine: 'local', labels: { agent: 'ROLE-2', persona: 'ROLE-2' } },
  { address: 'local/t7', label: 'neo2', state: 'error', agent: 'neo2', machine: 'local', attention: true, labels: { agent: 'ROLE-3' } },
  { address: 'local/t2', label: 'idle-term', state: 'idle', machine: 'local' },
];

const MACHINES: MachineRecord[] = [
  { name: 'local', host: 'localhost', transport: 'local', state: 'connected', since_ms: Date.now() - 30000, why: null, labels: {} },
];

describe('DeckScreen (PKG-B1, шаги 11–21)', () => {
  it('шапка: статус соединения CORE LIVE при живом ядре', async () => {
    render(<DeckScreen bridge={fakeBridge()} />);
    await waitFor(() => expect(screen.getByText('CORE LIVE')).toBeInTheDocument());
    expect(screen.getByTestId('deck-conn-note').textContent).toContain('Ядро отвечает');
  });

  it('панель ядра: версия/аптайм/состояние из server() (шаг 12)', async () => {
    render(<DeckScreen bridge={fakeBridge()} />);
    await waitFor(() => expect(screen.getByTestId('deck-core-version').textContent).toBe('N3.1.0'));
    expect(screen.getByText('RUNNING')).toBeInTheDocument();
    expect(screen.getByText('1ч')).toBeInTheDocument();
  });

  it('агенты: карточки со статус-словарём OSC + мета-инфой ростера (шаг 11+15)', async () => {
    render(<DeckScreen bridge={fakeBridge({ agents: async () => AGENTS })} />);
    await waitFor(() => expect(screen.getByText('ROLE-1 / 1')).toBeInTheDocument());
    expect(screen.getAllByText('LIVE').length).toBeGreaterThanOrEqual(2); // working → LIVE
    expect(screen.getByText(/^codex/)).toBeInTheDocument();   // app из ростера (sub: «app · ход N»)
    expect(screen.getByText(/ход 94/)).toBeInTheDocument();    // turn
    expect(screen.getByText('ROLE-2 / 1')).toBeInTheDocument();
    // фокусируемые карточки для клавиатурной навигации
    const cards = document.querySelectorAll('[data-agent-card]');
    expect(cards.length).toBe(2);
    expect(cards[0].getAttribute('tabindex')).toBe('0');
  });

  it('клавиатурная навигация по карточкам агентов (шаг 21)', async () => {
    render(<DeckScreen bridge={fakeBridge({ agents: async () => AGENTS })} />);
    await waitFor(() => expect(screen.getByText('ROLE-1 / 1')).toBeInTheDocument());
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-agent-card]'));
    cards[0].focus();
    fireEvent.keyDown(cards[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cards[1]);
    fireEvent.keyDown(cards[1], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(cards[0]);
  });

  it('терминалы: персоны из labels вместо адреса, term-id бейджем, attention (шаг 16 + UI-WAVE)', async () => {
    render(<DeckScreen bridge={fakeBridge({ terminals: async () => TERMINALS })} />);
    await waitFor(() => expect(screen.getByText('ROLE-2')).toBeInTheDocument());
    expect(screen.getByText('ROLE-3')).toBeInTheDocument();
    expect(screen.getByText('ВНИМАНИЕ')).toBeInTheDocument(); // attention у local/t7
    expect(screen.getByText('2/3 live')).toBeInTheDocument();
  });

  it('группировка по машинам: секция local с хостом, счётчиком и людьми', async () => {
    const agents = [
      { id: 'machine-A/term-1', name: 'ROLE-1 / 1', terminal: 'machine-A/term-1', status: 'working', machine: 'machine-A', labels: { agent: 'ROLE-1', persona: 'ROLE-1' } } as LiveAgent,
      { id: 'local/t9', name: 'forge-local', terminal: 'local/t9', status: 'done', machine: 'local' } as LiveAgent,
    ];
    const machines = [
      { name: 'machine-A', host: 'desktop-2s09h5f', transport: 'ssh', state: 'connected', since_ms: 0, why: null, labels: {} },
      { name: 'local', host: 'localhost', transport: 'local', state: 'connected', since_ms: 0, why: null, labels: {} },
    ] as MachineRecord[];
    render(<DeckScreen bridge={fakeBridge({ agents: async () => agents, terminals: async () => TERMINALS, machines: { ...fakeBridge().machines!, list: async () => machines } })} />);
    await waitFor(() => expect(screen.getAllByText('machine-A').length).toBeGreaterThanOrEqual(2));
    expect(screen.getAllByText('desktop-2s09h5f').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('machine-A/term-1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('local').length).toBeGreaterThanOrEqual(1);
  });

  it('группировка: deck-мост отдаёт target вместо host → заголовок секции показывает target (UI-FIX)', async () => {
    const machines = [
      { name: 'machine-A', target: 'machine-A', transport: 'ssh', state: 'connected', since_ms: 0, why: null, labels: {} },
      { name: 'local', host: 'localhost', transport: 'local', state: 'connected', since_ms: 0, why: null, labels: {} },
    ] as MachineRecord[];
    render(<DeckScreen bridge={fakeBridge({ agents: async () => AGENTS, terminals: async () => TERMINALS, machines: { ...fakeBridge().machines!, list: async () => machines } })} />);
    await waitFor(() => expect(screen.getAllByText('machine-A').length).toBeGreaterThanOrEqual(1));
  });

  it('статус exited → бейдж EXITED (dim, offline-тон), не сводится к done', async () => {
    const term: LiveTerminal = { address: 'local/t9', label: 'gone', state: 'exited', machine: 'local' };
    render(<DeckScreen bridge={fakeBridge({ terminals: async () => [term] })} />);
    await waitFor(() => expect(screen.getByText('EXITED')).toBeInTheDocument());
    // UI-FIX: exited → offline (не paused); data-status=offline на StatusBadge
    expect(screen.getByText('EXITED').closest('[data-status="offline"]')).not.toBeNull();
    expect(screen.queryByText('DONE')).not.toBeInTheDocument();
  });

  it('SSE: title-событие → заголовок обновляется только sanitized, персона нетронута', async () => {
    const agentsMock = vi.fn(async () => AGENTS);
    const terminalsMock = vi.fn(async () => TERMINALS);
    let onEvent: ((e: { type: string; seq: number; address?: string; title?: string; data?: unknown }) => void) | undefined;
    const streamEvents = vi.fn((cb: typeof onEvent) => {
      onEvent = cb;
      return () => {};
    });
    render(<DeckScreen bridge={fakeBridge({ agents: agentsMock, terminals: terminalsMock, streamEvents })} />);
    await waitFor(() => expect(screen.getByText('ROLE-2')).toBeInTheDocument());

    onEvent?.({ type: 'title', seq: 4, address: 'local/t1', title: 'C:\\Windows\\pwsh.exe' });
    // путь pwsh титруется (не показывается)
    await waitFor(() => expect(screen.queryByText('C:\\Windows\\pwsh.exe')).not.toBeInTheDocument());
    // персона не перезаписана title-текстом
    expect(screen.getByText('ROLE-2')).toBeInTheDocument();
  });

  it('SSE: title со спец-символами sanitized (без управляющих)', async () => {
    const agentsMock = vi.fn(async () => AGENTS);
    const terminalsMock = vi.fn(async () => TERMINALS);
    let onEvent: ((e: { type: string; seq: number; address?: string; title?: string; data?: unknown }) => void) | undefined;
    const streamEvents = vi.fn((cb: typeof onEvent) => {
      onEvent = cb;
      return () => {};
    });
    render(<DeckScreen bridge={fakeBridge({ agents: agentsMock, terminals: terminalsMock, streamEvents })} />);
    await waitFor(() => expect(screen.getByText('ROLE-2')).toBeInTheDocument());

    onEvent?.({ type: 'title', seq: 5, address: 'local/t7', title: 'run \u0001\u0002clean' });
    await waitFor(() => expect(screen.getByText('run clean')).toBeInTheDocument());
    expect(screen.queryByText(/run \u0001/)).not.toBeInTheDocument();
  });

  it('SSE: статус-событие (плоский address+state) → плавный локальный переход', async () => {
    const agentsMock = vi.fn(async () => AGENTS);
    const terminalsMock = vi.fn(async () => TERMINALS);
    let onEvent: ((e: { type: string; seq: number; address?: string; terminal?: string; state?: string; data?: unknown }) => void) | undefined;
    const streamEvents = vi.fn((cb: typeof onEvent) => {
      onEvent = cb;
      return () => {};
    });
    render(<DeckScreen bridge={fakeBridge({ agents: agentsMock, terminals: terminalsMock, streamEvents })} />);
    await waitFor(() => expect(screen.getByText('ROLE-2')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('deck-screen').getAttribute('data-state')).toBe('ok'));
    const agentReadsBeforeEvent = agentsMock.mock.calls.length;
    const terminalReadsBeforeEvent = terminalsMock.mock.calls.length;

    // Плоский кадр /api/core/events: state на верхнем уровне
    await act(async () => {
      onEvent?.({ type: 'status', seq: 3, address: 'local/t1', state: 'blocked' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Переход локальный: ни один read-list вызов не запускается.
    expect(agentsMock).toHaveBeenCalledTimes(agentReadsBeforeEvent);
    expect(terminalsMock).toHaveBeenCalledTimes(terminalReadsBeforeEvent);
    expect(screen.getByText('BLOCKED')).toBeInTheDocument();
  });

  it('SSE: legacy-фрейм (terminal+data.state) продолжает работать', async () => {
    const agentsMock = vi.fn(async () => AGENTS);
    const terminalsMock = vi.fn(async () => TERMINALS);
    let onEvent: ((e: { type: string; seq: number; address?: string; terminal?: string; state?: string; data?: unknown }) => void) | undefined;
    const streamEvents = vi.fn((cb: typeof onEvent) => {
      onEvent = cb;
      return () => {};
    });
    render(<DeckScreen bridge={fakeBridge({ agents: agentsMock, terminals: terminalsMock, streamEvents })} />);
    await waitFor(() => expect(screen.getByText('ROLE-2')).toBeInTheDocument());

    onEvent?.({ type: 'status', seq: 3, terminal: 'local/t1', data: { state: 'blocked' } });
    await waitFor(() => expect(screen.getByText('BLOCKED')).toBeInTheDocument());
  });

  it('машины: host/transport/state/since (шаг 17)', async () => {
    render(<DeckScreen bridge={fakeBridge({ machines: { ...fakeBridge().machines!, list: async () => MACHINES } })} />);
    await waitFor(() => expect(screen.getByText('CONNECTED')).toBeInTheDocument());
    expect(screen.getByText('localhost')).toBeInTheDocument();
    expect(screen.getAllByText('local').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('только что')).toBeInTheDocument();
  });

  it('экран терминала: выбор строки → подключение screenStream + снимок (шаг 18)', async () => {
    const screenStream = vi.fn((term: string, onScreen: (s: string) => void) => {
      queueMicrotask(() => onScreen(`$ echo hello\nhello`));
      return () => {};
    });
    render(<DeckScreen bridge={fakeBridge({ terminals: async () => TERMINALS, screenStream })} />);
    await waitFor(() => expect(screen.getByText('local/t1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('local/t1'));
    await waitFor(() => expect(screen.getByTestId('deck-screen-preview').textContent).toContain('hello'));
    expect(screenStream).toHaveBeenCalledWith('local/t1', expect.any(Function), expect.any(Function));
  });

  it('SSE: событие agent триггерит мягкое обновление без поллинга (шаг 19)', async () => {
    const agentsMock = vi.fn(async () => AGENTS);
    const terminalsMock = vi.fn(async () => TERMINALS);
    let onEvent: ((e: { type: string; seq: number }) => void) | undefined;
    const streamEvents = vi.fn((cb: typeof onEvent) => {
      onEvent = cb;
      return () => {};
    });
    render(<DeckScreen bridge={fakeBridge({ agents: agentsMock, terminals: terminalsMock, streamEvents })} />);
    await waitFor(() => expect(agentsMock).toHaveBeenCalledTimes(1));

    onEvent?.({ type: 'agent', seq: 2 });
    await waitFor(() => expect(agentsMock).toHaveBeenCalledTimes(2));
  });

  it('offline: server() недостижим → CORE OFFLINE с причиной (шаг 13)', async () => {
    render(<DeckScreen bridge={fakeBridge({
      server: vi.fn().mockRejectedValue(new Error('bridge unreachable: ECONNREFUSED')),
    })} />);
    await waitFor(() => expect(screen.getByText('CORE OFFLINE')).toBeInTheDocument());
    expect(screen.getByTestId('deck-conn-note').textContent).toContain('ECONNREFUSED');
  });

  it('offline: /api/deck/status connected=false → CORE OFFLINE «ферма не подключена» + честные пустые секции', async () => {
    render(<DeckScreen bridge={fakeBridge({
      deck: vi.fn(async () => ({
        connected: false,
        eventsConnected: false,
        version: '0.1.18',
        lastError: 'core not connected',
        uptimeS: 0,
        terminals: 0,
        machines: 0,
        eventsSeq: 0,
        session: 'nx-deck',
      })),
    })} />);
    await waitFor(() => expect(screen.getByText('CORE OFFLINE')).toBeInTheDocument());
    expect(screen.getByTestId('deck-conn-note').textContent).toContain('ферма не подключена');
    // данные не фабрикуются: пустые списки показываются честно
    await waitFor(() => expect(screen.getByText(/Агентов нет/)).toBeInTheDocument());
  });

  it('статус фермы: версия/сессия/seq из /api/deck/status', async () => {
    render(<DeckScreen bridge={fakeBridge()} />);
    await waitFor(() => expect(screen.getByTestId('deck-farm-note').textContent).toContain('0.1.18'));
    expect(screen.getByTestId('deck-farm-note').textContent).toContain('nx-deck');
    expect(screen.getByTestId('deck-farm-note').textContent).toContain('24');
  });

  it('degraded: server жив, но agents упал → ЧАСТИЧНО с причиной (шаг 13)', async () => {
    render(<DeckScreen bridge={fakeBridge({
      agents: vi.fn().mockRejectedValue(new Error('bridge 500: agents exploded')),
    })} />);
    await waitFor(() => expect(screen.getByText('ЧАСТИЧНО')).toBeInTheDocument());
    expect(screen.getByTestId('deck-conn-note').textContent).toContain('agents');
  });

  it('HonestEmpty для пустых агентов/терминалов/машин (шаг 14)', async () => {
    render(<DeckScreen bridge={fakeBridge()} />);
    await waitFor(() => expect(screen.getByText(/Агентов нет/)).toBeInTheDocument());
    expect(screen.getByText(/Терминалов нет/)).toBeInTheDocument();
    expect(screen.getByText(/Машин нет/)).toBeInTheDocument();
  });

  it('aria-live регион статуса соединения присутствует (шаг 21)', async () => {
    render(<DeckScreen bridge={fakeBridge()} />);
    await waitFor(() => expect(screen.getByTestId('deck-conn-live').getAttribute('aria-live')).toBe('polite'));
    expect(screen.getByTestId('deck-conn-live').textContent).toBe('Ядро онлайн');
  });

  it('запись Deck из манифеста читается лениво (NUE-1 не сломан)', async () => {
    render(<DeckScreen bridge={fakeBridge()} />);
    await waitFor(() => expect(screen.getByTestId('deck-app-note').textContent).toContain('NEXUS Deck'));
    expect(screen.getByTestId('deck-app-note').textContent).toContain('0.0.1');
  });
});

describe('форматтеры DeckScreen', () => {
  it('formatUptime: 86400 → 24ч, 90 → 1м 30с, 5 → 5с', () => {
    expect(formatUptime(86400)).toBe('24ч');
    expect(formatUptime(90)).toBe('1м 30с');
    expect(formatUptime(5)).toBe('5с');
    expect(formatUptime(-1)).toBe('—');
  });

  it('formatSince: недавнее → «только что», 5 мин → «5 мин назад»', () => {
    expect(formatSince(Date.now() - 1000)).toBe('только что');
    expect(formatSince(Date.now() - 5 * 60000)).toBe('5 мин назад');
    expect(formatSince(undefined)).toBe('—');
  });
});
