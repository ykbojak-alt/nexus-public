import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  BridgeHttpError,
  BridgeUnavailable,
  createCoreBridge,
  createDeckBridge,
  createLiveBridge,
  deckAgentToLive,
  deckMachineFromRaw,
  EMBEDDED_SCHEMA,
  normalizeDeckStatus,
} from './newf-live';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
  } as Response;
}

const SERVER = 'http://core.test:5683';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BridgeHttpError (#407, QODER #476 §1.3)', () => {
  it('extends BridgeUnavailable (instanceof сохраняется для существующих потребителей)', () => {
    const err = new BridgeHttpError(404, 'bridge 404: Not Found', 'Not Found');
    expect(err).toBeInstanceOf(BridgeUnavailable);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('BridgeHttpError');
    expect(err.message).toMatch(/^bridge 404:/);
  });

  it('404 текст (роут не зарегистрирован) → unavailable', () => {
    expect(new BridgeHttpError(404, 'bridge 404: Not Found', 'Not Found').kind).toBe('unavailable');
  });

  it('404 JSON {error} (ресурс отсутствует) → not_found', () => {
    const err = new BridgeHttpError(404, 'bridge 404: {"error":"file not found"}', { error: 'file not found' });
    expect(err.kind).toBe('not_found');
    expect(err.body).toEqual({ error: 'file not found' });
  });

  it('401/403 → denied, 503 → disabled, 501 → unsupported, 409 → conflict', () => {
    expect(new BridgeHttpError(401, 'bridge 401: x', { error: 'x' }).kind).toBe('denied');
    expect(new BridgeHttpError(403, 'bridge 403: x', { error: 'x' }).kind).toBe('denied');
    expect(new BridgeHttpError(503, 'bridge 503: x', { error: 'x' }).kind).toBe('disabled');
    expect(new BridgeHttpError(501, 'bridge 501: x', { error: 'x' }).kind).toBe('unsupported');
    expect(new BridgeHttpError(409, 'bridge 409: x', { error: 'x' }).kind).toBe('conflict');
  });

  it('прочие 4xx/5xx → unavailable', () => {
    expect(new BridgeHttpError(500, 'bridge 500: x', 'x').kind).toBe('unavailable');
    expect(new BridgeHttpError(418, 'bridge 418: x', 'x').kind).toBe('unavailable');
  });
});

describe('NewfBridge capability-методы (#407)', () => {
  it('createLiveBridge (bus) не объявляет files/changes/machines — честный undefined', () => {
    const bus = createLiveBridge(SERVER, '/api/bus');
    expect(bus.files).toBeUndefined();
    expect(bus.changes).toBeUndefined();
    expect(bus.machines).toBeUndefined();
  });

  it('createCoreBridge объявляет files/changes/machines', () => {
    const core = createCoreBridge(SERVER);
    expect(core.files?.list).toBeTypeOf('function');
    expect(core.changes?.list).toBeTypeOf('function');
    expect(core.machines?.list).toBeTypeOf('function');
  });
});

describe('canonical core default endpoint', () => {
  it('createCoreBridge без base использует same-origin /api/core (Caddy :4436 прокси)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      path: '.', entries: [], count: 0, truncated: false,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge();
    await core.files!.list();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/core/file/list?path=.',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('createDeckBridge переключает GET на edge, если same-origin не отвечает', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('same-origin offline'))
      .mockResolvedValueOnce(jsonResponse({ agents: [], count: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    await createDeckBridge().agents();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/deck/agents');
    expect(fetchMock.mock.calls[1][0]).toBe('https://backend.example.invalid/api/deck/agents');
  });

  it('не повторяет мутацию на edge при сетевой ошибке same-origin', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('same-origin offline'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createCoreBridge().sendLine!('local/t1', 'pwd')).rejects.toBeInstanceOf(BridgeUnavailable);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/core/send');
  });
});

describe('createDeckBridge (PKG-B1, /api/deck/*)', () => {
  it('без base использует same-origin /api/deck', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ agents: [], count: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    const deck = createDeckBridge();
    await deck.agents();

    expect(fetchMock).toHaveBeenCalledWith('/api/deck/agents', expect.objectContaining({ cache: 'no-store' }));
  });

  it('deck() GET /api/deck/status → DeckStatus нормализован (snake → camel)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      connected: true,
      events_connected: true,
      core: { id: 'x', name: 'y' },
      version: '0.1.18',
      last_error: '',
      uptime_s: 212.5,
      terminals: 5,
      machines: 1,
      events_seq: 1972,
      session: 'nx-deck',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const deck = createDeckBridge(SERVER);
    const status = await deck.deck!();

    expect(status).toEqual({
      connected: true,
      eventsConnected: true,
      version: '0.1.18',
      lastError: '',
      uptimeS: 212.5,
      terminals: 5,
      machines: 1,
      eventsSeq: 1972,
      session: 'nx-deck',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/deck/status`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('deck() принимает обёртку {status:{…}}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      status: { connected: true, version: '0.1.18', uptime_s: 5 },
    })));
    const deck = createDeckBridge(SERVER);
    const status = await deck.deck!();
    expect(status.connected).toBe(true);
    expect(status.version).toBe('0.1.18');
    expect(status.uptimeS).toBe(5);
  });

  it('agents() GET /api/deck/agents → LiveAgent (agent_state → статус, app/turn/machine)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      agents: [
        { address: 'machine-A/term-1', name: 'ROLE-1 / 1', state: 'live', app: 'codex', agent_state: 'working', agent_msg: null, turn: 94, machine: 'machine-A', cwd: 'D:\\nexus' },
        { address: 'machine-C/term-1', name: 'ROLE-3 / 1', state: 'live', app: null, agent_state: null, agent_msg: null, turn: 0, machine: 'machine-A' },
      ],
      count: 2,
    })));
    const deck = createDeckBridge(SERVER);
    const agents = await deck.agents();

    expect(agents).toHaveLength(2);
    expect(agents[0]).toMatchObject({ id: 'machine-A/term-1', status: 'working', app: 'codex', turn: 94, machine: 'machine-A', cwd: 'D:\\nexus' });
    // agent_state отсутствует → честный idle (не рабочего статуса)
    expect(agents[1].status).toBe('idle');
  });

  it('deckAgentToLive: скалярная нормализация', () => {
    expect(deckAgentToLive({ address: 'a', name: 'n', state: 'live', agent_state: 'working' }))
      .toMatchObject({ id: 'a', name: 'n', status: 'working' });
    expect(deckAgentToLive({ address: 'a', state: 'live' }).status).toBe('idle');
  });

  it('deckAgentToLive: labels {agent,persona} прокидываются (UI-WAVE)', () => {
    const agent = deckAgentToLive({
      address: 'machine-A/term-1',
      name: 'ROLE-1 / 1',
      state: 'live',
      agent_state: 'working',
      labels: { agent: 'ROLE-1', persona: 'ROLE-1' },
    });
    expect(agent.labels).toEqual({ agent: 'ROLE-1', persona: 'ROLE-1' });
  });

  it('deckAgentToLive: agent_state=exited → status exited (не сводится к done)', () => {
    expect(deckAgentToLive({ address: 'a', state: 'live', agent_state: 'exited' }).status).toBe('exited');
  });

  it('terminals() GET /api/deck/terminals → состояние из status.state, notify → attention, машина из адреса', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      terminals: [
        { address: 'machine-A/term-1', state: 'live', status: { app: 'codex', state: 'working' }, notify: true },
        { address: 'machine-C/term-1', state: 'live', status: null, notify: false },
      ],
      count: 2,
    })));
    const deck = createDeckBridge(SERVER);
    const terms = await deck.terminals();

    expect(terms[0]).toMatchObject({ address: 'machine-A/term-1', state: 'working', attention: true, machine: 'machine-A' });
    // state:'live' + status:null → честный idle (в LiveTerminal-union нет 'live';
    // живой терминал без задачи = idle).
    expect(terms[1]).toMatchObject({ state: 'idle', attention: false });
  });

  it('machines() GET /api/deck/machines → MachineRecord (без since_ms/transport)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      machines: [
        { host: 'desktop-2s09h5f', id: 'x', name: 'machine-A', session: 'nx-spark-dev', state: 'connected', target: 'machine-A', temporary: false, version: '0.1.18', via: false },
      ],
      count: 1,
    })));
    const deck = createDeckBridge(SERVER);
    const machines = await deck.machines!.list();

    expect(machines).toHaveLength(1);
    expect(machines[0]).toMatchObject({ name: 'machine-A', host: 'desktop-2s09h5f', state: 'connected' });
    expect(machines[0].since_ms).toBe(0);
  });

  it('deckMachineFromRaw: пустые/честные дефолты', () => {
    expect(deckMachineFromRaw({ name: 'm', state: 'unknown' }))
      .toMatchObject({ name: 'm', host: '', transport: '', state: 'unknown', since_ms: 0, labels: {} });
  });

  it('normalizeDeckStatus: битый ответ → безопасные дефолты', () => {
    expect(normalizeDeckStatus(null)).toEqual({
      connected: false, eventsConnected: false, version: '', lastError: '',
      uptimeS: 0, terminals: 0, machines: 0, eventsSeq: 0, session: '',
    });
  });

  it('SSE /api/deck/events: фреймы event:nx → LiveEvent {seq, type} + flat-поля', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: nx\ndata: {"seq":2352,"ts":1794265400.59,"event":{"jsonrpc":"2.0","method":"event","params":{"data":{"title":"x"},"seq":8229,"terminal":"machine-A/term-1","type":"title"}}}\n\n',
        ));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, body: stream });
    vi.stubGlobal('fetch', fetchMock);

    const deck = createDeckBridge(SERVER);
    const events: Array<{ seq: number; type: string; method?: string; terminal?: string; data?: unknown }> = [];
    const off = deck.streamEvents!((e) => events.push({ seq: e.seq, type: e.type, method: e.method, terminal: e.terminal, data: e.data }));

    await vi.waitFor(() => expect(events[0]).toMatchObject({
      seq: 8229,
      type: 'title',
      method: 'event',
      terminal: 'machine-A/term-1',
      data: { title: 'x' },
    }));
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/deck/events`,
      expect.objectContaining({ cache: 'no-store' }),
    );
    off();
  });

  it('SSE /api/deck/events: ПЛОСКИЙ фрейм ({type,seq,ts,address,machine,term,state}) → поля на верхнем уровне (UI-FIX)', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: nx\ndata: {"type":"status","seq":8229,"ts":1794265400.59,"address":"machine-A/term-1","machine":"machine-A","term":"term-1","state":"working"}\n\n',
        ));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, body: stream });
    vi.stubGlobal('fetch', fetchMock);

    const deck = createDeckBridge(SERVER);
    const events: Array<{ seq: number; type: string; address?: string; machine?: string; term?: string; state?: string }> = [];
    const off = deck.streamEvents!((e) => events.push({
      seq: e.seq,
      type: e.type,
      address: typeof e.address === 'string' ? e.address : undefined,
      machine: typeof e.machine === 'string' ? e.machine : undefined,
      term: typeof e.term === 'string' ? e.term : undefined,
      state: typeof e.state === 'string' ? e.state : undefined,
    }));

    await vi.waitFor(() => expect(events[0]).toMatchObject({
      seq: 8229,
      type: 'status',
      address: 'machine-A/term-1',
      machine: 'machine-A',
      term: 'term-1',
      state: 'working',
    }));
    off();
  });
});

describe('files.list (#407)', () => {
  it('happy: 200 с записями → state ok, entries нормализованы', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      path: '.', entries: [
        { path: 'machines.json', kind: 'file', bytes: 207 },
        { path: 'default', kind: 'dir', bytes: null },
      ], count: 2, truncated: false,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const result = await core.files!.list();
    expect(result.state).toBe('ok');
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ path: 'machines.json', kind: 'file', size: 207 });
    expect(result.entries[1]).toMatchObject({ path: 'default', kind: 'dir', size: undefined });
    expect(result.truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/file/list?path=.`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('empty: 200 с пустыми записями → state empty (легитимная пустая папка)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      path: '.', entries: [], count: 0, truncated: false,
    })));
    const core = createCoreBridge(SERVER);
    const result = await core.files!.list();
    expect(result.state).toBe('empty');
    expect(result.entries).toEqual([]);
  });

  it('unavailable: текст-404 (роут не зарегистрирован) → state unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('Not Found', 404)));
    const core = createCoreBridge(SERVER);
    const result = await core.files!.list();
    expect(result.state).toBe('unavailable');
    expect(result.detail).toMatch(/Not Found/);
  });

  it('not_found: JSON-404 пути → state not_found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'not a directory' }, 404)));
    const core = createCoreBridge(SERVER);
    const result = await core.files!.list('nope');
    expect(result.state).toBe('not_found');
    expect(result.detail).toMatch(/not a directory/);
  });

  it('denied: 403 → state out_of_scope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'NEXUS_CORE_READ_TOKEN required' }, 403)));
    const core = createCoreBridge(SERVER);
    const result = await core.files!.list();
    expect(result.state).toBe('out_of_scope');
  });

  it('сеть упала → state unavailable с detail (не бросает)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const core = createCoreBridge(SERVER);
    const result = await core.files!.list();
    expect(result.state).toBe('unavailable');
    expect(result.detail).toMatch(/ECONNREFUSED/);
  });
});

describe('changes.list (#407)', () => {
  const DIRTY = {
    cwd: 'D:/<repo>', state: 'dirty', branch: 'master',
    changes: [
      { path: 'docs/OVERNIGHT_QUEUE.md', status: 'M', note: 'modified' },
      { path: 'reports/new.md', status: '??', note: null },
    ], count: 2, truncated: false,
  };

  it('happy: dirty → entries с porcelain XY', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(DIRTY)));
    const core = createCoreBridge(SERVER);
    const result = await core.changes!.list();
    expect(result.state).toBe('dirty');
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ path: 'docs/OVERNIGHT_QUEUE.md', xy: 'M', index: 'M', worktree: '', note: 'modified' });
    expect(result.entries[1]).toMatchObject({ xy: '??', index: '?', worktree: '?' });
  });

  it('clean → state clean, entries []', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      cwd: 'D:/<repo>', state: 'clean', branch: 'master', changes: [], count: 0, truncated: false,
    })));
    const core = createCoreBridge(SERVER);
    const result = await core.changes!.list();
    expect(result.state).toBe('clean');
    expect(result.entries).toEqual([]);
  });

  it('не-репозиторий → state not_a_repository', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      cwd: 'C:/Users', state: 'not_a_repository', changes: [], count: 0, truncated: false,
    })));
    const core = createCoreBridge(SERVER);
    const result = await core.changes!.list();
    expect(result.state).toBe('not_a_repository');
  });

  it('git_unavailable → 503 → state git_unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'git unavailable' }, 503)));
    const core = createCoreBridge(SERVER);
    const result = await core.changes!.list();
    expect(result.state).toBe('git_unavailable');
    expect(result.detail).toMatch(/git/);
  });

  it('роут отсутствует (текст-404) → state unavailable (не бросает)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('Not Found', 404)));
    const core = createCoreBridge(SERVER);
    const result = await core.changes!.list();
    expect(result.state).toBe('unavailable');
  });
});

describe('machines.list (#407)', () => {
  it('happy: 200 {machines:{…},count} → MachineRecord[] с labels', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      machines: {
        local: { state: 'connected', terminals: 3, host: 'localhost', transport: 'local', since_ms: 1793959028521.8, why: null, labels: { 'nx.space': 's1' } },
      },
      count: 1,
    })));
    const core = createCoreBridge(SERVER);
    const machines = await core.machines!.list();
    expect(machines).toHaveLength(1);
    expect(machines[0]).toMatchObject({
      name: 'local', host: 'localhost', transport: 'local', state: 'connected',
    });
    expect(machines[0].labels).toEqual({ 'nx.space': 's1' });
  });

  it('empty: 200 {machines:{},count:0} → []', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ machines: {}, count: 0 })));
    const core = createCoreBridge(SERVER);
    const machines = await core.machines!.list();
    expect(machines).toEqual([]);
  });

  it('error: 500 → BridgeHttpError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('Internal Server Error', 500)));
    const core = createCoreBridge(SERVER);
    await expect(core.machines!.list()).rejects.toMatchObject({ kind: 'unavailable', status: 500 });
  });
});

describe('machines.schema / get (#407)', () => {
  it('schema: роут отсутствует → embedded fallback с source embedded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('Not Found', 404)));
    const core = createCoreBridge(SERVER);
    const schema = await core.machines!.schema();
    expect(schema).toEqual(EMBEDDED_SCHEMA);
    expect(schema.source).toBe('embedded');
  });

  it('get: JSON-404 → {found:false}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'machine not found: nope' }, 404)));
    const core = createCoreBridge(SERVER);
    const result = await core.machines!.get('nope');
    expect(result).toEqual({ found: false });
  });

  it('get: 200 → {found:true, machine}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      name: 'worker-2', host: 'bob@10.0.0.7', transport: 'ssh', state: 'connecting',
      since_ms: 1, why: null, labels: { purpose: 'build' },
    })));
    const core = createCoreBridge(SERVER);
    const result = await core.machines!.get('worker-2');
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.machine.labels).toEqual({ purpose: 'build' });
      expect(result.machine.name).toBe('worker-2');
    }
  });
});

describe('archive терминала (W30)', () => {
  it('archive() шлёт POST /api/core/terminal/<term>/archive и возвращает ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ term: 't1', archived: true }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const result = await core.archive!('local/t1');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/terminal/t1/archive`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('terminals(): state "archived" сохраняется, не сводится к idle', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([
      { name: 't1', machine: 'local', state: 'archived', created_at: 1000 },
      { name: 't2', machine: 'local', state: 'idle' },
    ])));
    const core = createCoreBridge(SERVER);
    const terms = await core.terminals();
    expect(terms[0].state).toBe('archived');
    expect(terms[1].state).toBe('idle');
  });
});

describe('send-queue (W31)', () => {
  it('sendQueues() GET /api/core/send-queues → {address: depth}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      queues: { 'local/t1': 3, 'local/t2': 1 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const queues = await core.sendQueues!();

    expect(queues).toEqual({ 'local/t1': 3, 'local/t2': 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/send-queues`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('flushSendQueue() DELETE /api/core/send-queue/<term> → {term, cleared}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ term: 'local/t1', cleared: 3 }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const result = await core.flushSendQueue!('local/t1');

    expect(result).toEqual({ term: 'local/t1', cleared: 3 });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/send-queue/t1`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('spacesDetail (W32)', () => {
  it('spacesDetail() GET /api/core/spaces/detail → LiveSpaceDetail[]', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      spaces: [
        { id: 'local', terms: 2, live: 1, labels: ['ops'], members: ['local/t1', 'local/t2'] },
        { id: 'roy2', terms: 0, live: 0, labels: [], members: [] },
      ],
      count: 2,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const spaces = await core.spacesDetail!();

    expect(spaces).toEqual([
      { id: 'local', terms: 2, live: 1, labels: ['ops'], members: ['local/t1', 'local/t2'] },
      { id: 'roy2', terms: 0, live: 0, labels: [], members: [] },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/spaces/detail`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('createLiveBridge (bus) не объявляет spacesDetail — честный undefined', () => {
    const bus = createLiveBridge(SERVER, '/api/bus');
    expect(bus.spacesDetail).toBeUndefined();
  });
});

describe('eventsSince (W33)', () => {
  it('eventsSince() GET /api/core/events/since?since&limit → {events, cursor, total_seen}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      events: [
        { seq: 1, type: 'status', ts: 1000.5, address: 'local/t1' },
        { seq: 2, type: 'send_queue', ts: 1001.0, address: 'local/t2' },
      ],
      cursor: 1001.0,
      total_seen: 2,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const res = await core.eventsSince!(1000, 10);

    expect(res.cursor).toBe(1001.0);
    expect(res.total_seen).toBe(2);
    expect(res.events).toHaveLength(2);
    expect(res.events[0]).toMatchObject({ type: 'status', address: 'local/t1' });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/events/since?since=1000&limit=10`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('eventsSince() фолбэк cursor = since при отсутствии cursor в ответе', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ events: [] })));
    const core = createCoreBridge(SERVER);
    const res = await core.eventsSince!(1234, 5);
    expect(res.cursor).toBe(1234);
    expect(res.events).toEqual([]);
  });
});

describe('server (PKG-B1, шаг 9)', () => {
  it('server() GET /api/core/server → CoreServerInfo нормализован (плоский ответ)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      version: 'N3.1.0', uptime_s: 86400, state: 'running', started_at: 1000, pid: 42, host: 'remote-host',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const info = await core.server!();

    expect(info).toEqual({
      version: 'N3.1.0', uptime_s: 86400, state: 'running', startedAt: 1000, pid: 42, host: 'remote-host',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/server`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('server() принимает обёртку {server:{…}} и умеет отсутствующие поля', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      server: { version: 'N3', uptime_s: 5, state: 'starting' },
    })));
    const core = createCoreBridge(SERVER);
    const info = await core.server!();
    expect(info.version).toBe('N3');
    expect(info.state).toBe('starting');
    expect(info.startedAt).toBeUndefined();
  });

  it('createLiveBridge (bus) не объявляет server — честный undefined', () => {
    const bus = createLiveBridge(SERVER, '/api/bus');
    expect(bus.server).toBeUndefined();
  });
});

describe('diag (W34)', () => {
  it('diag() GET /api/core/diag → CoreDiag нормализован', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      ts: 1000.5,
      version: 'N3',
      uptime_s: 3600,
      health: { pump_alive: true, drain_alive: false },
      stats: { sent: 5, failed: 1, dead: 0, pending: 2 },
      terminals: { live: 3, total: 4, exited: 1, states: { working: 2, idle: 1 } },
      spaces: 2,
      alerts: { rules: 3, history_count: 7 },
      config: { pump_interval_s: 1, rate_limit: 100, scrollback_maxlen: 2000 },
      events_total: 10,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const d = await core.diag!();

    expect(d).toEqual({
      ts: 1000.5,
      version: 'N3',
      uptime_s: 3600,
      health: { pump_alive: true, drain_alive: false },
      stats: { sent: 5, failed: 1, dead: 0, pending: 2 },
      terminals: { live: 3, total: 4, exited: 1, states: { working: 2, idle: 1 } },
      spaces: 2,
      alerts: { rules: 3, history_count: 7 },
      config: { pump_interval_s: 1, rate_limit: 100, scrollback_maxlen: 2000 },
      events_total: 10,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/diag`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('diag() фолбэки при битом ответе', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));
    const core = createCoreBridge(SERVER);
    const d = await core.diag!();
    expect(d.health).toEqual({ pump_alive: false, drain_alive: false });
    expect(d.terminals).toEqual({ live: 0, total: 0, exited: 0, states: {} });
    expect(d.config.pump_interval_s).toBeNull();
    expect(d.stats).toEqual({ sent: 0, failed: 0, dead: 0, pending: 0 });
  });
});

describe('terminalsSummary (W35)', () => {  it('terminalsSummary() GET /api/core/terminals/summary?limit=500 → TermSummary[]', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      count: 2,
      terminals: [
        { name: 't1', space: 'local', state: 'working', last_line: 'Planning…', last_activity_ts: 1000.5 },
        { name: 't2', space: 'local', state: 'idle', last_line: '', last_activity_ts: null },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const res = await core.terminalsSummary!();

    expect(res.count).toBe(2);
    expect(res.terminals).toEqual([
      { name: 't1', space: 'local', state: 'working', lastLine: 'Planning…', lastActivityTs: 1000.5 },
      { name: 't2', space: 'local', state: 'idle', lastLine: '', lastActivityTs: undefined },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/terminals/summary?limit=500`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('createLiveBridge (bus) не объявляет terminalsSummary — честный undefined', () => {
    const bus = createLiveBridge(SERVER, '/api/bus');
    expect(bus.terminalsSummary).toBeUndefined();
  });
});

describe('approvalDecide (W36 — header X-AEGIS-Key)', () => {
  it('с токеном: тело {approved} без by; заголовок X-AEGIS-Key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ outcome: 'approved' }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    await core.approvalDecide!('a1', true, 'tok-1');

    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/approvals/a1`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-AEGIS-Key': 'tok-1' }),
        body: JSON.stringify({ approved: true }),
      }),
    );
  });

  it('без токена: заголовок X-AEGIS-Key отсутствует (бэк сам вернёт 401/503)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'denied' }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    await core.approvalDecide!('a1', false);

    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/approvals/a1`,
      expect.objectContaining({
        headers: expect.not.objectContaining({ 'X-AEGIS-Key': expect.anything() }),
        body: JSON.stringify({ approved: false }),
      }),
    );
  });

  it('503 (ключи не настроены) → BridgeHttpError с kind disabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('AEGIS admin disabled: AEGIS_ADMIN_TOKEN not set', 503)));
    const core = createCoreBridge(SERVER);
    await expect(core.approvalDecide!('a1', true, 'tok')).rejects.toMatchObject({ kind: 'disabled', status: 503 });
  });
});

describe('alert-rules (W37)', () => {
  it('alertRules() GET /api/core/alert-rules → AlertRuleEntry[]', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      count: 2,
      rules: [
        { idx: 0, pattern: 'error', action: 'notify', disabled: false, runtime: true },
        { idx: 1, pattern: 'fatal', action: 'kill', disabled: true, runtime: false },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const res = await core.alertRules!();

    expect(res.count).toBe(2);
    expect(res.rules).toEqual([
      { idx: 0, pattern: 'error', action: 'notify', disabled: false, runtime: true },
      { idx: 1, pattern: 'fatal', action: 'kill', disabled: true, runtime: false },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/alert-rules`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('alertToggle() POST /api/core/alert-rules/{idx}/toggle {enabled}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ idx: 0, disabled: true }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const res = await core.alertToggle!(0, false);

    expect(res).toEqual({ idx: 0, disabled: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/alert-rules/0/toggle`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('alerts() GET /api/core/alerts?limit=50 → история', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      alerts: [
        { ts: 1000, term: 'local/t1', rule_idx: 0, pattern: 'error', action: 'notify', line: 'boom' },
      ],
      count: 1,
      rules_loaded: 1,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const res = await core.alerts!();

    expect(res.count).toBe(1);
    expect(res.rules_loaded).toBe(1);
    expect(res.alerts[0]).toMatchObject({ term: 'local/t1', ruleIdx: 0, line: 'boom' });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/alerts?limit=50`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});

describe('share (W38)', () => {
  it('shareCreate() POST /api/core/share {term, scopes, ttl_s} → ShareCreated', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      token: 'tok-1', term: 'local/t1', scopes: ['screen'], expires_at: 123, view_url: '/view/tok-1/screen',
    }, 201));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const res = await core.shareCreate!('local/t1', { scopes: ['screen'], ttlS: 600 });

    expect(res).toEqual({
      token: 'tok-1', term: 'local/t1', scopes: ['screen'], expiresAt: 123, viewUrl: '/view/tok-1/screen',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/share`,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"scopes":["screen"]'),
      }),
    );
  });

  it('shares() GET /api/core/shares → ShareEntry[]', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      shares: [
        { token: 'tok-1234…', term: 'local/t1', scopes: ['screen'], expires_at: 123, expired: false, hits: 2 },
      ],
      count: 1,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const res = await core.shares!();

    expect(res).toEqual([
      { token: 'tok-1234…', term: 'local/t1', scopes: ['screen'], expiresAt: 123, expired: false, hits: 2 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/shares`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('shareRevoke() DELETE /api/core/share/{token} → {revoked}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ revoked: true }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const res = await core.shareRevoke!('tok-1');

    expect(res).toEqual({ revoked: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/share/tok-1`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('inputLog (W39)', () => {
  it('inputLog() GET /api/core/terminal/t1/input-log?limit=50 → entries (ts/text/enter)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      term: 'local/t1',
      entries: [
        { ts: 1000.5, text: 'ls -la', enter: true },
        { ts: 1001.0, text: '', enter: true },
        { ts: 1002.0, text: 'git status' },
      ],
      count: 3,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const res = await core.inputLog!('local/t1', 50);

    expect(res.term).toBe('local/t1');
    expect(res.count).toBe(3);
    expect(res.entries).toEqual([
      { ts: 1000.5, text: 'ls -la', enter: true },
      { ts: 1001.0, text: '', enter: true },
      { ts: 1002.0, text: 'git status', enter: false },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/terminal/t1/input-log?limit=50`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});

describe('send variants (W41)', () => {  it('sendLine() POST /api/core/send {term, text, enter:true}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'sent' }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    await core.sendLine!('local/t1', 'ls -la');

    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/send`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ term: 'local/t1', text: 'ls -la', enter: true }),
      }),
    );
  });

  it('sendRaw() POST /api/core/send {term, text, enter:false}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'sent' }));
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    await core.sendRaw!('local/t1', 'x');

    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/send`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ term: 'local/t1', text: 'x', enter: false }),
      }),
    );
  });

  it('screenStream() GET /api/core/terminal/t1/stream — SSE screen → onScreen; unsubscribe закрывает', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: screen\ndata: {"term":"local/t1","seq":1,"screen":"abc"}\n\n: ping\n\n'));
        controller.enqueue(encoder.encode('event: screen\ndata: {"term":"local/t1","seq":2,"screen":"abcd"}\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, body: stream });
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const screens: string[] = [];
    const seqs: number[] = [];
    const off = core.screenStream!('local/t1', (s, seq) => { screens.push(s); seqs.push(seq); });

    await vi.waitFor(() => expect(screens).toEqual(['abc', 'abcd']));
    expect(seqs).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/api/core/terminal/t1/stream`,
      expect.objectContaining({ cache: 'no-store' }),
    );
    off();
  });

  it('W57: 404 → стоп retry (нет повторных вызовов)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const errors: string[] = [];
    const off = core.screenStream!('local/t1', () => {}, (e) => errors.push(e));

    await vi.waitFor(() => expect(errors).toEqual(['stream 404']));
    // нет retry через 2с
    await new Promise((r) => setTimeout(r, 2200));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    off();
  });

  it('W57: abort останавливает retry после EOF', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: screen\ndata: {"seq":1,"screen":"x"}\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, body: stream });
    vi.stubGlobal('fetch', fetchMock);

    const core = createCoreBridge(SERVER);
    const off = core.screenStream!('local/t1', () => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    off(); // unsubscribe → стоп retry
    await new Promise((r) => setTimeout(r, 2200));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
