import { describe, expect, it, vi, afterEach } from 'vitest';
import type { UnrealSceneWireState } from '../desktop-bridge/types';
import { createAi2DataSource } from './product-data-source';
import { createAi2Client } from '../api/client';
import { createMockAi2Client } from '../api/mock-transport';
import { Ai2ApiError, isAi2NetworkError } from '../api/errors';
import { SCENE_MAP_BY_ASSISTANT } from '@nexus/mock-data';
import { resetProfileStore, saveProfile } from '../../../product/profile/profile-store';
import { createEmptyProfile } from '../../../product/profile/profile-types';

const streamRunEventsMock = vi.hoisted(() => vi.fn());
vi.mock('../sse/run-event-stream', () => ({ streamRunEvents: streamRunEventsMock }));

// Bridge-level fake: the lazy getDesktopBridge() resolves to whatever the
// test installs — real pywebview is never touched in unit runs.
const bridgeMocks = vi.hoisted(() => ({
  unrealSceneState: vi.fn<() => Promise<UnrealSceneWireState | null>>(),
  unrealSceneOpen: vi.fn<(theme?: string, assistant?: string) => Promise<UnrealSceneWireState | null>>(),
  systemMetrics: vi.fn<() => Promise<import('../desktop-bridge/types').DesktopSystemMetrics | null>>(),
  subscribe: { current: undefined as undefined | ((cb: (s: UnrealSceneWireState) => void) => () => void) },
  events: { current: undefined as undefined | ((cb: (e: unknown) => void) => () => void) },
}));
vi.mock('../desktop-bridge/adapter', () => ({
  getDesktopBridge: () => Promise.resolve({
    available: true,
    unrealSceneState: bridgeMocks.unrealSceneState,
    unrealSceneOpen: bridgeMocks.unrealSceneOpen,
    systemMetrics: bridgeMocks.systemMetrics,
    unrealSceneSubscribe: bridgeMocks.subscribe.current,
    unrealSceneEvents: bridgeMocks.events.current,
  }),
}));

const source = () => createAi2DataSource({ client: createMockAi2Client() });

afterEach(() => {
  streamRunEventsMock.mockReset();
  bridgeMocks.unrealSceneState.mockReset();
  bridgeMocks.unrealSceneOpen.mockReset();
  bridgeMocks.systemMetrics.mockReset();
  bridgeMocks.subscribe.current = undefined;
  bridgeMocks.events.current = undefined;
  resetProfileStore();
  vi.useRealTimers();
});

describe('createAi2DataSource (Task: view-model mapping over live transport)', () => {
  it('maps agents/models/presets to view-model shapes', async () => {
    const ds = source();
    const agents = await ds.listAgents();
    expect(agents[0]).toMatchObject({ name: 'builder', capabilities: ['fs.read', 'fs.write', 'exec'] });
    const models = await ds.listModels();
    expect(models.find((m) => m.id === 'default')?.isDefault).toBe(true);
    const presets = await ds.listPresets();
    const baseline = presets.find((p) => p.name === 'baseline');
    expect(baseline?.name).toBe('baseline');
    expect(baseline?.isDefault).toBe(true);
  });

  it('listPresets shows exactly the host catalog — no local definitions or fallbacks', async () => {
    const base = createMockAi2Client();
    const HOST_PRESETS = [
      'baseline', 'plan', 'critic', 'triad', 'checkpoints', 'full', 'memory', 'recovery',
      'router', 'tasks', 'tasks_check', 'tasks_par', 'critic_tools', 'hashing', 'sentence',
      'hybrid', 'cross', 'screen', 'inline_data', 'perceive', 'deliberate', 'learn', 'schema_hint',
      'tasks_all',
    ];
    const ds = createAi2DataSource({
      client: {
        ...base,
        presets: {
          list: async () => ({
            presets: HOST_PRESETS.map((name) => ({ name, flags: { planner: name === 'baseline' } })),
            default: 'baseline',
          }),
        },
      },
    });

    const presets = await ds.listPresets();
    // The full host catalog is visible; nothing is added or filtered locally.
    expect(presets).toHaveLength(HOST_PRESETS.length);
    const names = presets.map((p) => p.name);
    expect(new Set(names).size).toBe(HOST_PRESETS.length);
    for (const name of HOST_PRESETS) {
      expect(names).toContain(name);
    }
    // Host baseline keeps host truth.
    const baseline = presets.find((p) => p.name === 'baseline')!;
    expect(baseline.isDefault).toBe(true);
    expect(baseline.flags).toMatchObject({ planner: true });
    // No local quick aliases leak in — the client keeps no definitions.
    for (const local of ['fast', 'deep', 'custom-x']) {
      expect(names).not.toContain(local);
    }
  });

  it('startRun returns a stored RunSummary; listRuns includes it', async () => {
    const ds = source();
    const run = await ds.startRun({ task: 'ship it', config: 'baseline', agent: 'builder' });
    expect(run.runId).toBe('run_mock_1');
    expect(run.taskText).toBe('ship it');
    const runs = await ds.listRuns();
    expect(runs.map((r) => r.runId)).toContain('run_mock_1');
  });

  it('reuses an intent idempotency key on retry and accepts a fresh key for a new intent', async () => {
    const base = createMockAi2Client();
    let attempts = 0;
    const create = vi.fn(async (input: Parameters<typeof base.runs.create>[0]) => {
      attempts += 1;
      if (attempts === 1) throw new Error('network unavailable');
      return base.runs.create(input);
    });
    const ds = createAi2DataSource({
      client: { ...base, runs: { ...base.runs, create } },
    });
    const firstIntent = {
      task: 'retry this intent', config: 'baseline', idempotencyKey: 'intent-1',
    };

    await expect(ds.startRun(firstIntent)).rejects.toThrow('network unavailable');
    await ds.startRun(firstIntent);
    await ds.startRun({ task: firstIntent.task, config: firstIntent.config, idempotencyKey: 'intent-2' });
    await ds.startRun({ task: 'generated key', config: 'baseline' });

    const keys = create.mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys.slice(0, 3)).toEqual(['intent-1', 'intent-1', 'intent-2']);
    expect(keys[3]).toEqual(expect.any(String));
    expect(keys[3]).not.toBe('intent-1');
    expect(keys[3]).not.toBe('intent-2');
  });

  it('retryRun sends a fresh UUID idempotency key', async () => {
    const base = createMockAi2Client();
    const create = vi.fn(base.runs.create);
    const ds = createAi2DataSource({
      client: { ...base, runs: { ...base.runs, create } },
    });
    const run = await ds.startRun({ task: 'retry with a fresh key', config: 'baseline' });

    await ds.retryRun!(run.runId);

    const keys = create.mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(keys[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it.each([
    ['404', new Ai2ApiError(404, { error: 'not_found', message: 'run missing' })],
    ['network error', new Error('network unavailable')],
    ['idle timeout', new DOMException('SSE idle timeout', 'TimeoutError')],
  ])('ends the stream exactly once with error after %s', async (_label, failure) => {
    streamRunEventsMock.mockImplementationOnce(async function* () {
      yield { type: 'stream_gap' };
      throw failure;
    });
    const ds = source();
    const onEnd = vi.fn();
    const onGap = vi.fn();

    ds.streamRun('run_stream_failure', {
      fromSeq: 0,
      onEvent: vi.fn(),
      onDelta: vi.fn(),
      onEnd,
      onGap,
    });

    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledTimes(1));
    expect(onEnd).toHaveBeenCalledWith('error');
    expect(onGap.mock.calls).toEqual([[true], [false]]);
  });

  it('does not call onEnd twice if the terminal callback throws', async () => {
    streamRunEventsMock.mockImplementationOnce(async function* () {
      yield { type: 'end', status: 'done' };
    });
    const ds = source();
    const onEnd = vi.fn(() => { throw new Error('consumer callback failed'); });

    ds.streamRun('run_terminal_callback_failure', {
      fromSeq: 0,
      onEvent: vi.fn(),
      onDelta: vi.fn(),
      onEnd,
    });

    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledTimes(1));
  });

  it('listRuns({agent: null}) отдаёт прогоны без агента — фильтр не теряется', async () => {
    const base = createMockAi2Client();
    const ds = createAi2DataSource({
      client: {
        ...base,
        runs: {
          ...base.runs,
          // Хост отдаёт окно без фильтра (?agent=пусто игнорируется) —
          // оболочка обязана сама отобрать прогоны без агента.
          list: async () => ({
            runs: [
              { runId: 'run_a', status: 'done' as const, task: 'с агентом', agent: 'forge' },
              { runId: 'run_b', status: 'done' as const, task: 'без агента' },
            ],
            limit: 2,
            offset: 0,
          }),
        },
      },
    });
    expect((await ds.listRuns()).map((r) => r.runId)).toEqual(['run_a', 'run_b']);
    expect((await ds.listRuns({ agent: null })).map((r) => r.runId)).toEqual(['run_b']);
  });

  it.each([
    ['cancelled', { runId: 'run_cancelled', status: 'cancelled' }, 'cancelled'],
    ['timeout', { runId: 'run_timeout', status: 'timeout' }, 'timeout'],
    ['null', { runId: 'run_null', status: null }, 'done'],
    ['missing', { runId: 'run_missing_status' }, 'done'],
  ] as const)('maps host run status %s', async (_label, run, expectedStatus) => {
    const base = createMockAi2Client();
    const ds = createAi2DataSource({
      client: {
        ...base,
        runs: {
          ...base.runs,
          // Exercise older/malformed host payloads as well as terminal states.
          list: async () => ({ runs: [run] as never, limit: 1, offset: 0 }),
        },
      },
    });

    await expect(ds.listRuns()).resolves.toMatchObject([
      { runId: run.runId, status: expectedStatus },
    ]);
  });

  it('normalizes the legacy default placeholder to a valid baseline preset', async () => {
    const ds = source();
    const run = await ds.startRun({ task: 'legacy profile preset', config: 'default' });
    expect(run.config).toBe('baseline');
  });

  it('missions derive from runs; graph carries dependency edges', async () => {
    const ds = source();
    await ds.startRun({ task: 'root task', config: 'baseline' });
    const missions = await ds.listMissions();
    expect(missions[0]).toMatchObject({ title: 'root task', state: 'done' });
    expect(missions[0].outputs).toHaveLength(1);
    const graph = await ds.getMissionGraph();
    expect(graph.nodes[0].kind).toBe('mission');
  });

  it('memory view-models round-trip through project scope', async () => {
    const ds = source();
    await ds.searchMemory('nothing'); // empty → fine
    const structure = await ds.getMemoryStructure();
    expect(structure.project).toBe('nexus');
    const graph = await ds.getMemoryGraph();
    expect(graph.edges).toEqual([]);
  });

  it('listProjects derives the observed set; listMemory honours the scope override', async () => {
    const ds = source();
    // Runs window empty → union collapses to the configured scope + memory.
    expect(await ds.listProjects?.()).toEqual(['nexus']);
    // A run under another project surfaces it — union over the window.
    await ds.startRun({ task: 'x', config: 'baseline', project: 'ai2' });
    expect(await ds.listProjects?.()).toEqual(['ai2', 'nexus']);
    const all = await ds.listMemory();
    const scoped = await ds.listMemory('nexus');
    expect(scoped.length).toBe(all.length);
    expect(await ds.listMemory('no-such-project')).toEqual([]);
  });

  it('usage maps snake_case report to UsageSummary', async () => {
    const ds = source();
    await ds.startRun({ task: 'x', config: 'baseline' });
    const usage = await ds.getUsage();
    expect(usage.runsTotal).toBe(1);
    expect(usage.period).toBe('current_month');
  });

  it('webhooks/plugins/presence/handoffs return honest empty views', async () => {
    const ds = source();
    expect(await ds.listWebhooks()).toEqual([]);
    expect(await ds.listWebhookDeliveries()).toEqual([]);
    expect(await ds.listPlugins()).toEqual([]);
    expect(await ds.listPresence()).toEqual([]);
    expect(await ds.listHandoffs()).toEqual([]);
    const router = await ds.getModelRouter();
    expect(router.nodes.some((n) => n.kind === 'preset')).toBe(true);
  });

  it('getRunDetail composes run + persisted events + stored result', async () => {
    const ds = source();
    const ref = await ds.startRun({ task: 'detail me', config: 'baseline', agent: 'builder' });
    const detail = await ds.getRunDetail!(ref.runId);
    expect(detail).not.toBeNull();
    expect(detail!.run).toMatchObject({ runId: ref.runId, taskText: 'detail me', status: 'done' });
    expect(detail!.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(detail!.result).toMatchObject({ runId: ref.runId, answer: 'mock answer for: detail me' });
  });

  it('getRunDetail resolves null for an unknown runId', async () => {
    const ds = source();
    expect(await ds.getRunDetail!('run_missing')).toBeNull();
  });

  it('wires host compact and status through the live product data-source seam', async () => {
    const base = createMockAi2Client();
    const compact = vi.fn(async () => ({
      compacted: true as const,
      compactId: 'compact-live-contract',
      threadId: 'thread-root',
      summary: 'Host summary',
      coversMessageIds: ['root:task', 'root:answer'],
      keptMessageIds: [],
      createdAt: '2026-10-19T12:00:00Z',
    }));
    const compactionStatus = vi.fn(async () => ({
      sessionId: 'root',
      compaction: 'triggered',
      triggered: true,
    }));
    const compactionConfig = vi.fn(async () => ({
      windowTokens: 100000,
      reserveTokens: 16000,
      keepTokens: 15000,
      thresholdTokens: 84000,
    }));
    const ds = createAi2DataSource({
      client: { ...base, chat: { ...base.chat, compact, compactionStatus, compactionConfig } },
    });

    await expect(ds.chatCompact!({ runIds: ['root'] })).resolves.toMatchObject({
      compacted: true,
      compactId: 'compact-live-contract',
      threadId: 'thread-root',
      coversMessageIds: ['root:task', 'root:answer'],
    });
    await expect(ds.getChatCompactionStatus!('root')).resolves.toMatchObject({
      sessionId: 'root',
      compaction: 'triggered',
    });
    await expect(ds.getChatCompactionConfig!()).resolves.toEqual({
      windowTokens: 100000,
      reserveTokens: 16000,
      keepTokens: 15000,
      thresholdTokens: 84000,
    });
    expect(compact).toHaveBeenCalledWith({ runIds: ['root'] });
    expect(compactionStatus).toHaveBeenCalledWith('root');
    expect(compactionConfig).toHaveBeenCalledOnce();
  });

  it('does not fabricate compact data or triggered status in the mock transport', async () => {
    const ds = source();
    await expect(ds.chatCompact!({ runIds: ['run_mock_1'] }))
      .rejects.toMatchObject({ status: 503 });
    await expect(ds.getChatCompactionStatus!('run_mock_1')).resolves.toBeNull();
    await expect(ds.getChatCompactionConfig!()).resolves.toMatchObject({
      thresholdTokens: null,
      windowTokens: null,
    });
  });

  it('maps host history into chronological product entries and preserves cursors', async () => {
    const base = createMockAi2Client();
    const history = vi.fn(async () => ({
      sessionId: 'root',
      limit: 50,
      hasMore: true,
      nextCursor: 'r1:task',
      messages: [
        { type: 'message' as const, id: 'r2:answer', role: 'assistant' as const, text: 'new answer', createdAt: 200, usageTokens: null },
        { type: 'compact' as const, id: 'compact-1', summary: 'covered', coversMessageIds: ['r1:task'], createdAt: '2026-10-19T12:00:00Z' },
        { type: 'message' as const, id: 'r1:task', role: 'user' as const, text: 'old task', createdAt: 100, usageTokens: null },
      ],
    }));
    const ds = createAi2DataSource({
      client: { ...base, chat: { ...base.chat, history } },
    });

    await expect(ds.getChatHistory!('root', {
      beforeId: 'r2:task', limit: 50, effective: true,
    })).resolves.toEqual({
      sessionId: 'root',
      hasMore: true,
      nextCursor: 'r1:task',
      entries: [
        { kind: 'message', id: 'r1:task', runId: 'r1', part: 'task', role: 'user', text: 'old task', createdAt: 100 },
        { kind: 'compact', id: 'compact-1', summary: 'covered', coversMessageIds: ['r1:task'], createdAt: '2026-10-19T12:00:00Z' },
        { kind: 'message', id: 'r2:answer', runId: 'r2', part: 'answer', role: 'assistant', text: 'new answer', createdAt: 200 },
      ],
    });
    expect(history).toHaveBeenCalledWith('root', {
      beforeId: 'r2:task', limit: 50, effective: true,
    });
  });

  it('getRunDetail tolerates a missing stored result (404 → null)', async () => {
    const base = createMockAi2Client();
    const ref = await base.runs.create({ task: 'live run' });
    const client: typeof base = {
      ...base,
      runs: {
        ...base.runs,
        result: async () => {
          throw new Ai2ApiError(404, { error: 'not_found', message: 'no result yet' });
        },
      },
    };
    const ds = createAi2DataSource({ client });
    const detail = await ds.getRunDetail!(ref.runId);
    expect(detail!.run.status).toBe('done');
    expect(detail!.result).toBeNull();
    expect(detail!.events.length).toBeGreaterThan(0);
  });

  it('getRunControls gates actions on the host feature map (W1-05/06)', async () => {
    const ds = source();
    const run = await ds.startRun({ task: 'control me', config: 'baseline' });
    const c = await ds.getRunControls!(run.runId);
    // Host map: replay/cancel supported; pause/resume/checkpoint not.
    expect(c.paused).toBe(false);
    expect(c.replay).toEqual({ available: true, reason: null });
    expect(c.pause).toEqual({ available: false, reason: 'mock transport' });
    expect(c.resume).toEqual({ available: false, reason: 'mock transport' });
    expect(c.checkpoint).toEqual({ available: false, reason: 'mock transport' });
    expect(c.retry).toEqual({ available: true, reason: null }); // terminal run
  });

  it('не рекламирует действие, которое оболочка не может исполнить', async () => {
    const base = createMockAi2Client();
    const caps = await base.capabilities();
    const ds = createAi2DataSource({
      client: {
        ...base,
        capabilities: async () => ({
          ...caps,
          features: {
            ...caps.features,
            // Хост заявляет поддержку — эндпоинтов в оболочке всё равно нет.
            runPauseResume: { supported: true, reason: null, via: 'POST /v1/runs/{id}/pause' },
            runCheckpoints: { supported: true, reason: null },
          },
        }),
      },
    });
    const run = await ds.startRun({ task: 'host supports pause', config: 'baseline' });
    const c = await ds.getRunControls!(run.runId);
    // Реклама без исполнения = включённая кнопка, которая молча ничего не
    // делает. Значит действие недоступно — с честной причиной.
    expect(c.pause.available).toBe(false);
    expect(c.pause.reason).toMatch(/оболочка не подключила/);
    expect(c.resume.available).toBe(false);
    expect(c.checkpoint.available).toBe(false);
    // Replay исполним — он остаётся доступным.
    expect(c.replay.available).toBe(true);
    // И самих методов паузы у источника по-прежнему нет.
    expect(ds.pauseRun).toBeUndefined();
    expect(ds.resumeRun).toBeUndefined();
    expect(ds.checkpointRun).toBeUndefined();
  });

  it('replayRun returns the controls snapshot when the map supports replay', async () => {
    const ds = source();
    const run = await ds.startRun({ task: 'replay me', config: 'baseline' });
    const next = await ds.replayRun!(run.runId);
    expect(next?.replay.available).toBe(true);
  });

  it('retryRun creates a NEW run with the same input; original untouched', async () => {
    const ds = source();
    const run = await ds.startRun({ task: 'retry me', config: 'baseline', agent: 'builder' });
    const next = await ds.retryRun!(run.runId);
    expect(next).not.toBeNull();
    expect(next!.runId).not.toBe(run.runId);
    expect(next!.taskText).toBe('retry me');
    expect(next!.agent).toBe('builder');
    const runs = await ds.listRuns();
    expect(runs.map((r) => r.runId)).toEqual(expect.arrayContaining([run.runId, next!.runId]));
  });

  it('getRunControls rejects on an unknown runId (honest, not silent)', async () => {
    const ds = source();
    await expect(ds.getRunControls!('run_missing')).rejects.toThrow('unknown run');
  });
});

describe('unrealScene seam (bridge-contract §2)', () => {
  const wire = (over: Partial<UnrealSceneWireState> = {}): UnrealSceneWireState => ({
    status: 'connected', source: 'live', reason: null, lastUpdated: 100, protocolVersion: 1, ...over,
  });

  it('getState normalizes the wire dict; out-of-schema enum → unknown', async () => {
    bridgeMocks.unrealSceneState.mockResolvedValueOnce(wire());
    const ds = source();
    expect(await ds.unrealScene!.getState()).toEqual({
      status: 'connected', source: 'live', reason: null, lastUpdated: 100, protocolVersion: 1,
      activeAssistant: null, activeMap: null,
    });
    bridgeMocks.unrealSceneState.mockResolvedValueOnce(wire({ status: 'teleported', source: 'wire' }));
    const s = await ds.unrealScene!.getState();
    expect(s.status).toBe('unknown');
    expect(s.source).toBeNull();
  });

  it('nexus-scene-v1: activeAssistant проходит verbatim; без поля → null', async () => {
    bridgeMocks.unrealSceneState.mockResolvedValueOnce(wire({ activeAssistant: 'mech' }));
    const ds = source();
    expect((await ds.unrealScene!.getState()).activeAssistant).toBe('mech');
    bridgeMocks.unrealSceneState.mockResolvedValueOnce(wire());
    expect((await ds.unrealScene!.getState()).activeAssistant).toBeNull();
  });

  it('VII V3-3: activeMap проходит verbatim; без поля → null', async () => {
    bridgeMocks.unrealSceneState.mockResolvedValueOnce(wire({ activeMap: '/Game/Maps/StartScene_Arch' }));
    const ds = source();
    expect((await ds.unrealScene!.getState()).activeMap).toBe('/Game/Maps/StartScene_Arch');
    bridgeMocks.unrealSceneState.mockResolvedValueOnce(wire());
    expect((await ds.unrealScene!.getState()).activeMap).toBeNull();
  });

  it('VII V3-1: subscribeEvents проксирует события моста verbatim; без источника подписка нулевая', async () => {
    const received: unknown[] = [];
    bridgeMocks.events.current = (cb) => {
      cb({ type: 'map-error', map: '/Game/Maps/SelectScene', ts: 1700000000 });
      return () => { };
    };
    let ds = source();
    const off = ds.unrealScene!.subscribeEvents!((e) => received.push(e));
    await new Promise((r) => setTimeout(r, 0));
    expect(received).toEqual([{ type: 'map-error', map: '/Game/Maps/SelectScene', ts: 1700000000 }]);
    off();

    // мост без push-канала событий → подписка не выдумывает событий
    bridgeMocks.events.current = undefined;
    received.length = 0;
    ds = source();
    const off2 = ds.unrealScene!.subscribeEvents!((e) => received.push(e));
    await new Promise((r) => setTimeout(r, 0));
    expect(received).toHaveLength(0);
    off2();
  });

  it('VII V3-3: SCENE_MAP_BY_ASSISTANT покрывает все 5 персон сцены, FORGE → StartScene', () => {
    expect(Object.keys(SCENE_MAP_BY_ASSISTANT).sort()).toEqual(['alice', 'arch', 'codex', 'forge', 'mech']);
    for (const map of Object.values(SCENE_MAP_BY_ASSISTANT)) {
      expect(map).toMatch(/^\/Game\/Maps\/StartScene(_[A-Za-z]+)?$/);
    }
    expect(SCENE_MAP_BY_ASSISTANT.forge).toBe('/Game/Maps/StartScene');
  });

  it('VIII V3-3: getPanelData собирает реальные поля §11; сбой seam → поле null, вызов не падает', async () => {
    const ds = source();
    const data = await ds.unrealScene!.getPanelData!();
    expect(data.agents?.[0]?.name).toBe('builder');
    expect(data.models?.some((m) => m.isDefault)).toBe(true);
    expect(data.runs).not.toBeNull();
    expect(data.metrics).not.toBeNull();
    expect(data.collectedAt).toBeGreaterThan(0);

    // один сбойный источник не роняет снапшот — панель получает null
    const flaky = source();
    flaky.listRuns = () => Promise.reject(new Error('down'));
    const partial = await flaky.unrealScene!.getPanelData!();
    expect(partial.runs).toBeNull();
    expect(partial.agents).not.toBeNull();
  });

  it('getState rejects when the host exposes no scene method (error+retry in UI)', async () => {
    bridgeMocks.unrealSceneState.mockResolvedValue(null);
    const ds = source();
    await expect(ds.unrealScene!.getState()).rejects.toThrow('unreal_scene_state');
  });

  it('open returns the host-reported state — starting, never connected', async () => {
    bridgeMocks.unrealSceneOpen.mockResolvedValue(wire({ status: 'starting', source: null }));
    const ds = source();
    const s = await ds.unrealScene!.open();
    expect(s.status).toBe('starting');
    expect(bridgeMocks.unrealSceneOpen).toHaveBeenCalledOnce();
  });

  it('open forwards the profile persona → NEXUS_SCENE_ASSISTANT; nexus/unknown omitted', async () => {
    bridgeMocks.unrealSceneOpen.mockResolvedValue(wire({ status: 'starting', source: null }));
    const ds = source();
    saveProfile({ ...createEmptyProfile(), agentId: 'mech' });
    await ds.unrealScene!.open();
    expect(bridgeMocks.unrealSceneOpen).toHaveBeenLastCalledWith(undefined, 'mech');
    // default 'nexus' and unknown ids are NOT a scene persona — host gets
    // no assistant arg and the scene itself resolves alice.
    saveProfile({ ...createEmptyProfile(), agentId: 'nexus' });
    await ds.unrealScene!.open();
    expect(bridgeMocks.unrealSceneOpen).toHaveBeenLastCalledWith(undefined, undefined);
    saveProfile({ ...createEmptyProfile(), agentId: 'nova' });
    await ds.unrealScene!.open();
    expect(bridgeMocks.unrealSceneOpen).toHaveBeenLastCalledWith(undefined, undefined);
    resetProfileStore();
  });

  it('subscribe consumes host pushes; unsubscribe stops them', async () => {
    const seen: string[] = [];
    bridgeMocks.subscribe.current = (cb) => {
      cb(wire({ status: 'starting' }));
      cb(wire());
      return () => { bridgeMocks.subscribe.current = undefined; };
    };
    const ds = source();
    const off = ds.unrealScene!.subscribe!((s) => seen.push(s.status));
    // Push path is async (bridge() promise) — flush microtasks.
    await Promise.resolve(); await Promise.resolve();
    expect(seen).toEqual(['starting', 'connected']);
    off();
  });

  it('subscribe without a push source falls back to 10s polling', async () => {
    vi.useFakeTimers();
    try {
      bridgeMocks.unrealSceneState.mockResolvedValue(wire());
      const ds = source();
      const seen: string[] = [];
      const off = ds.unrealScene!.subscribe!((s) => seen.push(s.status));
      await vi.advanceTimersByTimeAsync(0); // resolve bridge()
      expect(bridgeMocks.unrealSceneState).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(seen).toEqual(['connected']);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(seen).toEqual(['connected', 'connected']);
      off();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(seen).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('XIII W1 — таймауты и честные ошибки seams', () => {
  it('bus.listSessions проксирует 503 verbatim — причину хоста не маскируем', async () => {
    const reason = 'шина окон не настроена — задайте AI2_NEXUS_BUS';
    // Реальный конверт хоста: {error, message, detail, request_id}.
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ error: 'service_unavailable', message: reason, detail: reason, request_id: 'r1' }),
      { status: 503, headers: { 'content-type': 'application/json' } }));
    const ds = createAi2DataSource({
      client: createAi2Client({ baseUrl: 'http://127.0.0.1:0', fetchImpl: fetchImpl as typeof fetch }),
    });
    try {
      await ds.bus!.listSessions();
      expect.unreachable('503 должен был всплыть');
    } catch (e) {
      expect(e).toBeInstanceOf(Ai2ApiError);
      expect((e as Ai2ApiError).status).toBe(503);
      expect((e as Ai2ApiError).message).toBe(reason);
    }
  });

  it('delegateTask: 422 валидации хоста уходит наверх verbatim', async () => {
    const reason = 'окно W99 неизвестно';
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ error: 'unprocessable', message: reason, detail: reason, request_id: 'r2' }),
      { status: 422, headers: { 'content-type': 'application/json' } }));
    const ds = createAi2DataSource({
      client: createAi2Client({ baseUrl: 'http://x', fetchImpl: fetchImpl as typeof fetch }),
    });
    await expect(ds.bus!.delegateTask({ window: 'W99', task: 't' }))
      .rejects.toMatchObject({ status: 422, message: reason });
  });

  it('таймаут запроса → честная Ai2NetworkError(timeout), не молчаливое зависание', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () =>
        rej(new DOMException('The operation timed out.', 'TimeoutError')));
    }));
    const ds = createAi2DataSource({
      client: createAi2Client({ baseUrl: 'http://x', fetchImpl: fetchImpl as typeof fetch, timeoutMs: 5 }),
    });
    try {
      await ds.bus!.listSessions();
      expect.unreachable('таймаут должен был всплыть');
    } catch (e) {
      expect(isAi2NetworkError(e)).toBe(true);
      expect((e as { kind: string }).kind).toBe('timeout');
    }
  });
});

describe('getMetrics — DesktopBridge local-first (NUE-2)', () => {
  it('живой мост: метрики ЛОКАЛЬНОЙ машины, /v1/metrics не дёргается', async () => {
    bridgeMocks.systemMetrics.mockResolvedValueOnce({
      cpu: 12.5, ram: 63.2, disk: 44.1, uptime_s: 98765,
      processes: [
        { pid: 100, name: 'nx.exe', status: 'running' },
        { pid: 200, name: 'pwsh.exe', status: 'running' },
      ],
    });
    const ds = source();
    const m = await ds.getMetrics();
    expect(m.cpuPct).toBe(12.5);
    expect(m.ramPct).toBe(63.2);
    expect(m.diskPct).toBe(44.1);
    expect(m.uptimeS).toBe(98765);
    expect(m.processesActive).toBe(2);
    expect(m.health).toEqual([{ component: 'local-host', status: 'ok', detail: expect.any(String) }]);
    expect(m.freshness).toBe('live');
  });

  it('мост вернул null → честный fallback на /v1/metrics (браузер/старый бинарь)', async () => {
    bridgeMocks.systemMetrics.mockResolvedValueOnce(null);
    const ds = source();
    const m = await ds.getMetrics();
    // Значения из mock-транспорта ai2 (/v1/metrics), не из моста.
    expect(m.health.some((h) => h.component !== 'local-host')).toBe(true);
    expect(m.freshness).toBe('live');
  });

  it('мост без метода systemMetrics → fallback (bridge без NUE-2)', async () => {
    bridgeMocks.systemMetrics.mockImplementationOnce(() => {
      throw new Error('method not present');
    });
    const ds = source();
    const m = await ds.getMetrics();
    expect(m.health.some((h) => h.component !== 'local-host')).toBe(true);
  });
});
