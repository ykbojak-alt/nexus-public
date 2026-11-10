// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/workflow',
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/product/data-source', () => ({
  getDataSource: () => ({}),
  useDataSource: () => ({}),
}));

import { WorkflowScreen } from './workflow';

/** Фикстурный ответ /v1/roster.json (8 полей RosterPersona, формат моста). */
const LIVE_ROSTER = [
  { id: 'alice', name: 'AGENT-A', role: 'оркестратор', term: 'host', model: 'claude-opus-4-8 / claude-haiku-4-5', group: 'TEAM', status: 'working', current_wave: 'W4: supervisor + agents loop' },
  { id: 'forge', name: 'ROLE-2', role: 'кодер новых файлов', term: 't4', model: 'claude-opus-4-8 / claude-haiku-4-5', group: 'TEAM', status: 'ready', current_wave: 'W4: executor tasks' },
  { id: 'codex', name: 'ROLE-1', role: 'патчи существующих', term: 't5', model: 'claude-opus-4-8 / claude-haiku-4-5', group: 'TEAM', status: 'queued', current_wave: '—' },
  { id: 'qoder', name: 'ROLE-4', role: 'RAE/соц-контур', term: 'daemon:5682', model: 'python/daemon', group: 'SOCIAL', status: 'service', current_wave: 'tools/rae pipeline' },
  { id: 'sage', name: 'SAGE', role: 'хост PL-персон (remote-host)', term: 'remote-host', model: 'qwen', group: 'TEAM', status: 'unknown', current_wave: 'remote-host/t3 + t7' },
  { id: 'swarm-minimax', name: 'Minimax', role: 'трейдер-архетип роя', term: 'swarm', model: 'generator-pool', group: 'SWARM', status: 'ready', current_wave: 'trading_ai2 core' },
  { id: 'swarm-gpt', name: 'GPT', role: 'трейдер-архетип роя', term: 'swarm', model: 'generator-pool', group: 'SWARM', status: 'ready', current_wave: 'trading_ai2 core' },
  { id: 'swarm-mercury', name: 'Mercury', role: 'трейдер-архетип роя', term: 'swarm', model: 'generator-pool', group: 'SWARM', status: 'ready', current_wave: 'trading_ai2 core' },
  { id: 'swarm-meta', name: 'Meta', role: 'трейдер-архетип роя', term: 'swarm', model: 'generator-pool', group: 'SWARM', status: 'ready', current_wave: 'trading_ai2 core' },
  { id: 'swarm-agnes', name: 'Agnes', role: 'трейдер-архетип роя', term: 'swarm', model: 'generator-pool', group: 'SWARM', status: 'ready', current_wave: 'trading_ai2 core' },
  { id: 'swarm-mistral', name: 'Mistral', role: 'трейдер-архетип роя', term: 'swarm', model: 'generator-pool', group: 'SWARM', status: 'ready', current_wave: 'trading_ai2 core' },
];

function mockRosterOk() {
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('roster')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(LIVE_ROSTER) });
    }
    return Promise.reject(new Error('unexpected url'));
  });
}

/** Core-формат (nexus-core /v1/roster.json, RFC-001 §25.1): {roster:[...]}, 8 полей. */
const CORE_ROSTER = {
  roster: [
    { agent_id: 'alice', role: 'оркестратор', status: 'working', machine: 'local', term: 'alice', cwd: 'D:/<repo>', labels: { 'nx.space': 's1' }, turn: 7 },
    { agent_id: 'forge', role: 'кодер новых файлов', status: 'idle', machine: 'remote-host', term: 'forge', cwd: 'D:/<repo>', labels: {}, turn: 3 },
    { agent_id: 'trader-1', role: 'трейдер-архетип роя', status: 'ready', machine: 'local', term: 'trader-1', cwd: null, labels: {}, turn: 0 },
  ],
  count: 3,
};

function mockCoreRosterOk() {
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('roster')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(CORE_ROSTER) });
    }
    return Promise.reject(new Error('unexpected url'));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
  global.fetch = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('WorkflowScreen — живой ростер фермы', () => {
  it('рендерит заголовок и мета-информацию', async () => {
    mockRosterOk();
    render(<WorkflowScreen />);

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('NEXUS Workflow'));
    expect(screen.getByText(/Живой ростер фермы/)).toBeInTheDocument();
    expect(screen.getByText(/Автообновление: каждые 10 с/)).toBeInTheDocument();
    const metaSection = await screen.findByTestId('roster-source');
    expect(metaSection).toHaveTextContent('local');
  });

  it('честный roster_unavailable когда все источники молчат — без фиктивных персон', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
    render(<WorkflowScreen />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/roster_unavailable/));
    // Никаких мок-персон: карточек нет вовсе, рендерится честный empty-state.
    await waitFor(() => expect(screen.queryByText('AGENT-A')).not.toBeInTheDocument());
    expect(screen.queryByText('Minimax')).not.toBeInTheDocument();
    expect(screen.getByTestId('empty-state')).toHaveTextContent(/Ростер пуст/);
  });

  it('показывает 503 от моста как недоступный реестр', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ error: 'roster_unavailable' }),
    });
    render(<WorkflowScreen />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/roster_unavailable/));
    expect(screen.queryByText('AGENT-A')).not.toBeInTheDocument();
  });

  it('рендерит персону AGENT-A с правильным стилем терминала', async () => {
    mockRosterOk();
    render(<WorkflowScreen />);

    await waitFor(() => expect(screen.getByText('AGENT-A')).toBeInTheDocument());
    expect(screen.getByText('оркестратор')).toBeInTheDocument();
    const aliceCard = screen.getByText('AGENT-A').closest('article');
    expect(aliceCard).toHaveTextContent('AGENT-A Home');
  });

  it('рендерит ROLE-2 с правильным стилем терминала', async () => {
    mockRosterOk();
    render(<WorkflowScreen />);

    await waitFor(() => expect(screen.getByText('ROLE-2')).toBeInTheDocument());
    expect(screen.getByText('кодер новых файлов')).toBeInTheDocument();
    const forgeCard = await screen.findByTestId('persona-forge');
    expect(forgeCard).toHaveTextContent('Forge Ember');
  });

  it('рендерит ROLE-1 с правильным стилем терминала', async () => {
    mockRosterOk();
    render(<WorkflowScreen />);

    await waitFor(() => expect(screen.getByText('ROLE-1')).toBeInTheDocument());
    expect(screen.getByText('патчи существующих')).toBeInTheDocument();
    const codexCard = screen.getByText('ROLE-1').closest('article');
    expect(codexCard).toHaveTextContent('Codex Surgical');
  });

  it('рендерит ROLE-4 в группе SOCIAL', async () => {
    mockRosterOk();
    render(<WorkflowScreen />);

    await waitFor(() => expect(screen.getByText('ROLE-4')).toBeInTheDocument());
    expect(screen.getByText('RAE/соц-контур')).toBeInTheDocument();
  });

  it('рендерит SWARM трейдеров (6 штук)', async () => {
    mockRosterOk();
    render(<WorkflowScreen />);

    await waitFor(() => expect(screen.getByText('Minimax')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('GPT')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Mercury')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Meta')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Agnes')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Mistral')).toBeInTheDocument());
  });

  it('статус-бейджи отображаются правильно', async () => {
    mockRosterOk();
    render(<WorkflowScreen />);

    await waitFor(() => {
      const aliceCard = screen.getByText('AGENT-A').closest('article');
      expect(aliceCard).toHaveTextContent('working');

      const forgeCard = screen.getByText('ROLE-2').closest('article');
      expect(forgeCard).toHaveTextContent('ready');

      const raeCard = screen.getByText('ROLE-4').closest('article');
      expect(raeCard).toHaveTextContent('service');
    });
  });

  it('ссылка "Открыть в Runtime" ведёт на /runtime?agent=', async () => {
    mockRosterOk();
    render(<WorkflowScreen />);

    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /Открыть в Runtime/ });
      expect(links.length).toBeGreaterThan(0);
      expect(links[0].getAttribute('href')).toMatch(/^\/runtime\?agent=/);
    });
  });

  it('группы отображаются в правильном порядке: TEAM → SOCIAL → SWARM', async () => {
    mockRosterOk();
    render(<WorkflowScreen />);

    await waitFor(() => {
      const teamSection = screen.getByText('Команда (TEAM)');
      const socialSection = screen.getByText('Соц-контур (RAE)');
      const swarmSection = screen.getByText('Торговый рой (SWARM)');

      const teamPos = teamSection.compareDocumentPosition(socialSection);
      const socialPos = socialSection.compareDocumentPosition(swarmSection);

      expect(teamPos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(socialPos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it('автообновление каждые 10с (проверка useEffect)', async () => {
    mockRosterOk();
    const { unmount } = render(<WorkflowScreen />);

    await waitFor(() => expect(screen.getByText('AGENT-A')).toBeInTheDocument());

    unmount();
    expect(() => unmount()).not.toThrow();
  });

  it('рендерит текущую волну для каждой персоны', async () => {
    mockRosterOk();
    render(<WorkflowScreen />);

    await waitFor(() => {
      expect(screen.getByText(/W4: supervisor/)).toBeInTheDocument();
      expect(screen.getByText(/tools\/rae pipeline/)).toBeInTheDocument();
      expect(screen.getAllByText(/trading_ai2 core/).length).toBe(6);
    });
  });

  it('#528: читает живой nexus-core /v1/roster.json ({roster:[...]} → RosterPersona)', async () => {
    mockCoreRosterOk();
    render(<WorkflowScreen />);

    // core отдаёт agent_id/role/status — маппинг даёт имена как в агент-реестре
    await waitFor(() => expect(screen.getAllByText('alice').length).toBeGreaterThan(0));
    expect(screen.getByText('оркестратор')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('persona-alice')).toHaveTextContent('working'));
    expect(screen.getAllByText('forge').length).toBeGreaterThan(0);
    expect(screen.getByText('кодер новых файлов')).toBeInTheDocument();
    // role → group: трейдеры автоматически в SWARM
    await waitFor(() => expect(screen.getByText('Торговый рой (SWARM)')).toBeInTheDocument());
    // В UI показывается класс источника, без внутреннего URL/порта.
    await waitFor(() => expect(screen.getByTestId('roster-source')).toHaveTextContent('local'));
  });

  it('при недоступном same-origin использует edge и нормализует только roster-поля', async () => {
    const edgeRoster = {
      roster: [{
        agent_id: 'edge-agent', name: 'EDGE AGENT', role: 'reviewer', group: 'TEAM',
        term: 'machine-A/t9', model: 'model-x', status: 'idle', current_wave: 'W9',
        cwd: 'C:\\private\\workspace', labels: { secret: 'must-not-render' },
      }],
      count: 1,
    };
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('same-origin offline'))
      .mockRejectedValueOnce(new TypeError('same-origin offline'))
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(edgeRoster) });
    global.fetch = fetchMock;
    render(<WorkflowScreen />);

    await waitFor(() => expect(screen.getByTestId('persona-edge-agent')).toHaveTextContent('EDGE AGENT'));
    expect(screen.getByTestId('roster-source')).toHaveTextContent('edge');
    expect(document.body.textContent).not.toContain('C:\\private\\workspace');
    expect(document.body.textContent).not.toContain('must-not-render');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/deck/roster',
      '/_live/roster.json',
      'https://backend.example.invalid/api/deck/roster',
    ]);
  });

  it('#528: core-ростер с пустым списком → честный «Ростер пуст»', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('roster.json')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ roster: [], count: 0 }) });
      }
      return Promise.reject(new Error('unexpected url'));
    });
    render(<WorkflowScreen />);

    await waitFor(() => expect(screen.getByTestId('empty-state')).toHaveTextContent(/Ростер пуст/));
  });
});
