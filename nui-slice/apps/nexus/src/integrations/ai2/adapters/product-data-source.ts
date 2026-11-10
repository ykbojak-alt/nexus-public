import type { Ai2Client, Ai2RequestOptions } from '../api/client';
import { createAi2Client } from '../api/client';
import { createLazyNoirClient } from '../../noir/api/lazy-client';
import { streamRunEvents } from '../sse/run-event-stream';
import { isAi2ApiError } from '../api/errors';
import { getDesktopBridge } from '../desktop-bridge/adapter';
import { loadProfile } from '../../../product/profile/profile-store';
import type { UnrealSceneWireState } from '../desktop-bridge/types';
import type { Ai2Agent, Ai2Plugin } from '../contracts/agents';
import { isHandoff } from '../contracts/copilot';
import type { Ai2MemoryItem } from '../contracts/memory';
import type { Ai2Run, Ai2RunEvent, Ai2RunResult } from '../contracts/runs';
import type { Ai2Feature } from '../contracts/capabilities';
import type { Ai2ApiKey } from '../contracts/system';
import type { ChatHistoryEntry, ProductDataSource, StartRunInput } from '../../../product/data-source';
import type {
  AgentSpec,
  ApiKeyInfo,
  MemoryGraphData,
  MemoryItem,
  MemorySearchHit,
  MemoryStructure,
  MissionGraphData,
  ModelInfo,
  ModelRouterData,
  NexusMission,
  NexusMissionStep,
  PluginInfo,
  PresetInfo,
  PromptFileRef,
  RunControlState,
  RunDetail,
  RunEventView,
  RunResultView,
  RunStatus,
  RunSummary,
  SystemMetrics,
  UnrealSceneHostState,
  UnrealSceneStatus,
  UsageSummary,
  WebhookDelivery,
  WebhookRow,
} from '@nexus/mock-data';
import type { HandoffLink, PresenceEntry } from '@nexus/patterns';

/**
 * Live product data source — `ProductDataSource` backed by a real AI-2
 * server (roadmap D6, Window 1). Swap target for `getDataSource()`:
 * screens see identical view-model shapes, never transport JSON.
 *
 * Honesty rules (missing-api-list §2–3): only server-backed fields are
 * populated; derivations are labelled (recent-window stats); anything the
 * server cannot supply renders as empty/[] rather than fabricated data.
 */

export interface Ai2DataSourceConfig {
  /** Same shape as Ai2ClientConfig + stream transport bits. */
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Memory scope — AI-2 memory is project-scoped; runs list default. */
  project?: string;
  /** Page size for composed derivations (runs window). */
  windowSize?: number;
  /** Injected client for tests; absent → createAi2Client(config). */
  client?: Ai2Client;
  /**
   * INT-24 — base URL of the noir_bot web host (e.g. http://127.0.0.1:PORT).
   * Absent → the `noir` seam stays undefined and the screen renders
   * `unavailable`; never defaulted to same-origin (the AI-2 host is not
   * the NOIR host).
   */
  noirBaseUrl?: string;
}

const DEFAULT_WINDOW = 200;

/** §2.3 — description map for presets the server names but never describes. */
const PRESET_DESCRIPTIONS: Record<string, string> = {
  baseline: 'Сбалансированный контур: planner → executor → critic.',
  fast: 'Минимальная цепочка без критика — короткие задачи.',
  deep: 'Полный контур с суб-агентами и расширенной верификацией.',
};

/** Unreal scene wire → host state; unknown enums never map to connected. */
const UNREAL_SCENE_STATUSES = new Set<UnrealSceneStatus>([
  'not-installed', 'starting', 'connected', 'stale', 'disconnected', 'error', 'unknown',
]);

/** nexus-scene-v1 (W1 S3): выбор персоны пользователя — закрытый словарь
 *  пяти карт. 'nexus' (профиль по умолчанию) и любое иное значение не
 *  передаются на хост: env не заводится, сцена сама берёт alice. */
const SCENE_PERSONAS = new Set(['arch', 'mech', 'alice', 'codex', 'forge']);

function sceneAssistantOf(agentId: string | null | undefined): string | undefined {
  return agentId != null && SCENE_PERSONAS.has(agentId) ? agentId : undefined;
}

const toUnrealSceneState = (w: UnrealSceneWireState): UnrealSceneHostState => ({
  status: UNREAL_SCENE_STATUSES.has(w.status as UnrealSceneStatus)
    ? (w.status as UnrealSceneStatus)
    : 'unknown',
  source: w.source === 'live' || w.source === 'mock' ? w.source : null,
  reason: typeof w.reason === 'string' ? w.reason : null,
  lastUpdated: typeof w.lastUpdated === 'number' ? w.lastUpdated : null,
  protocolVersion: typeof w.protocolVersion === 'number' ? w.protocolVersion : null,
  activeAssistant: typeof w.activeAssistant === 'string' ? w.activeAssistant : null,
  activeMap: typeof w.activeMap === 'string' ? w.activeMap : null,
});

const toRunStatus = (s: string | null | undefined): RunStatus =>
  s == null
    ? 'done'
    : (['running', 'done', 'error', 'cancelled', 'timeout'] as const).includes(s as RunStatus)
      ? (s as RunStatus)
      : 'error';

/** Base64 wire audio → Blob for playback (W1 voice). */
function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const toMissionState = (s: string): NexusMission['state'] =>
  s === 'done' ? 'done'
    : s === 'cancelled' ? 'cancelled'
      : s === 'running' ? 'active'
        : 'failed'; // error | timeout

const toStepState = (s: string): NexusMissionStep['state'] =>
  s === 'done' ? 'done'
    : s === 'running' ? 'active'
      : s === 'cancelled' ? 'skipped'
        : s === 'error' || s === 'timeout' ? 'failed'
          : 'pending';

/** Terminal run statuses — retry is a new run only after the old one ends. */
const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set(['done', 'error', 'cancelled', 'timeout']);

/** Feature-map gate → RunControlState action slot (host reason verbatim). */
const featureGate = (f: Ai2Feature): { available: boolean; reason: string | null } =>
  f.supported ? { available: true, reason: null } : { available: false, reason: f.reason };

/**
 * Фича, которую оболочка исполнить НЕ может: даже при supported=true из
 * карты хоста действие остаётся недоступным — с честной причиной
 * («хост умеет, оболочка не подключила эндпоинт»). Иначе источник
 * рекламировал бы аффорданс, которого нет: экран показал бы включённую
 * кнопку, клик по которой молча ничего не делает (no-op — прямое нарушение
 * контракта «Unavailable actions carry a reason; the UI disables them and
 * never presents a no-op»).
 */
const notWiredGate = (f: Ai2Feature, what: string): { available: boolean; reason: string | null } =>
  f.supported
    ? { available: false, reason: `хост поддерживает, но оболочка не подключила эндпоинт ${what}` }
    : { available: false, reason: f.reason ?? `хост не поддерживает ${what}` };

function toRunSummary(r: Ai2Run): RunSummary {
  return {
    runId: r.runId,
    taskText: r.task ?? '',
    config: r.config ?? 'baseline',
    status: toRunStatus(r.status),
    stopReason: r.stopReason ?? null,
    agent: r.agent ?? null,
    parent: r.parent ?? null,
    retryOf: r.retryOf ?? null,
    project: r.project ?? null,
    // model is a create-input, not a stored field — GET /v1/runs/{id} does
    // not report it back, so the live summary leaves it undefined (honest).
    costUsd: r.usage?.cost_usd ?? null,
    createdAt: r.createdAt ?? 0,
    finishedAt: r.finishedAt ?? null,
  };
}

function toAgentSpec(a: Ai2Agent): AgentSpec {
  return {
    name: a.name,
    description: a.description || null,
    config: a.config ?? null,
    capabilities: a.capabilities,
    maxCostUsd: a.maxCostUsd ?? null,
    // Wave XI — handoff-кнопки спеки; поле verbatim от хоста, guard отсекает
    // мусорную запись до миграции колонки.
    handoffs: a.handoffs?.filter(isHandoff),
  };
}

function toPluginInfo(p: Ai2Plugin): PluginInfo {
  return {
    name: p.name,
    url: p.url,
    active: p.active,
    // Server tracks no signature state — honest false, not fabricated true.
    signed: false,
    hasSecret: p.hasSecret,
  };
}

function toApiKeyInfo(k: Ai2ApiKey): ApiKeyInfo {
  return {
    keyId: k.keyId,
    name: k.name,
    scopes: k.scopes,
    prefix: k.prefix,
    status: (k.status === 'revoked' || k.status === 'expired' ? k.status : 'active'),
    createdAt: Date.parse(k.createdAt) / 1000 || 0,
    expiresAt: k.expiresAt ? Date.parse(k.expiresAt) / 1000 : null,
    revokedAt: k.revokedAt ? Date.parse(k.revokedAt) / 1000 : null,
  };
}

function toMemoryItem(m: Ai2MemoryItem): MemoryItem {
  return {
    id: Number(m.id),
    project: m.project,
    text: m.text,
    createdAt: m.createdAt,
  };
}

function toRunEventView(e: Ai2RunEvent): RunEventView | null {
  if (e.seq === undefined) return null; // ephemeral frames carry no persisted seq
  const { seq, ts, type, ...body } = e;
  return {
    seq,
    type,
    role: (body.role as string | null | undefined) ?? null,
    ts: ts ?? 0,
    body,
  };
}

/** Result endpoint payload → RunResultView. Run summary fields come from the
 *  stored run record (result omits task/agent/parent); `tokens` is the honest
 *  in+out sum — the server keeps them split. */
function toRunResultView(run: Ai2Run, r: Ai2RunResult): RunResultView {
  const u = r.usage ?? run.usage ?? {};
  return {
    ...toRunSummary(run),
    answer: r.answer ?? run.answer ?? null,
    score: r.score ?? run.score ?? null,
    verified: r.verified ?? null,
    durationS: r.durationS
      ?? (run.finishedAt != null ? Math.max(0, run.finishedAt - (run.createdAt ?? 0)) : null),
    usage: {
      modelCalls: u.model_calls ?? 0,
      toolCalls: u.tool_calls ?? 0,
      tokens: (u.tokens_in ?? 0) + (u.tokens_out ?? 0),
      costUsd: u.cost_usd ?? 0,
    },
  };
}

async function allRuns(client: Ai2Client, windowSize: number, opts?: Ai2RequestOptions): Promise<Ai2Run[]> {
  // Recent-window derivation (missing-api §3): the mission/presence/handoff
  // views are computed over the newest `windowSize` runs — honest bounded set.
  const page = await client.runs.list({ limit: windowSize }, opts);
  return page.runs;
}

export function createAi2DataSource(config: Ai2DataSourceConfig = {}): ProductDataSource {
  const client = config.client ?? createAi2Client(config);
  const noirBaseUrl = config.noirBaseUrl;
  // INT-18: managed Instagram window exists only inside the pywebview
  // shell — resolve once, every seam call goes through the bridge. In a
  // plain browser the facade resolves 'unavailable' (honest, not hidden).
  let bridgePromise: ReturnType<typeof getDesktopBridge> | null = null;
  const bridge = () => (bridgePromise ??= getDesktopBridge());
  const project = config.project ?? 'nexus';
  const windowSize = config.windowSize ?? DEFAULT_WINDOW;

  /** Run-controls snapshot from the host feature map (W1-05/06). */
  const runControlsFor = async (runId: string): Promise<RunControlState> => {
    const [run, caps] = await Promise.all([
      client.runs.get(runId).catch((err) => {
        if (isAi2ApiError(err) && err.status === 404) return null;
        throw err;
      }),
      client.capabilities(),
    ]);
    if (!run) throw new Error(`ai2: unknown run ${runId}`);
    const terminal = TERMINAL_STATUSES.has(toRunStatus(run.status));
    const f = caps.features;
    return {
      paused: false, // no server-side pause state exists (map is the truth)
      // Пауза/резюм/чекпоинт: исполнять нечем — у клиента нет эндпоинтов
      // POST /v1/runs/{id}/pause|resume|checkpoint (см. run-lifecycle-contract
      // §«pauseRun/resumeRun»). Поэтому даже при supported=true в карте
      // хоста действие остаётся недоступным: карта отвечает «хост умеет»,
      // а решает оболочка, у которой эндпоинта нет.
      pause: notWiredGate(f.runPauseResume, 'паузы'),
      resume: notWiredGate(f.runPauseResume, 'резюма'),
      replay: featureGate(f.runReplay),
      checkpoint: notWiredGate(f.runCheckpoints, 'чекпоинтов'),
      // Restart is honest today — a NEW run via POST /v1/runs; the original
      // stays in history unchanged. Gated on terminal, same as the mock.
      retry: terminal
        ? { available: true, reason: null }
        : { available: false, reason: 'Прогон ещё выполняется' },
    };
  };

  const missionFor = async (root: Ai2Run, children: Ai2Run[]): Promise<NexusMission> => {
    const result = TERMINAL_STATUSES.has(toRunStatus(root.status))
      ? await client.runs.result(root.runId).catch(() => null)
      : null;
    return {
      id: root.runId,
      title: root.task ?? root.runId,
      state: toMissionState(root.status),
      steps: children.map((c) => ({
        id: c.runId,
        label: c.task ?? c.runId,
        state: toStepState(c.status),
        agentId: c.agent ?? null,
        startedAt: c.createdAt ?? null,
        endedAt: c.finishedAt ?? null,
      })),
      outputs: result?.answer
        ? [{ id: `${root.runId}-answer`, label: 'Ответ', kind: 'answer' as const, runId: root.runId }]
        : [],
      agents: [...new Set([root.agent, ...children.map((c) => c.agent)].filter(Boolean) as string[])],
      freshness: 'live',
    };
  };

  const ds: ProductDataSource = {
    listPresets: async () => {
      const page = await client.presets.list();
      return page.presets.map((p): PresetInfo => ({
        name: p.name,
        description: PRESET_DESCRIPTIONS[p.name] ?? null,
        flags: p.flags,
        isDefault: p.name === page.default,
      }));
    },

    listModels: async () => {
      const page = await client.models.list();
      return page.models.map((m): ModelInfo => ({
        id: m.id,
        label: m.label,
        free: m.free,
        isDefault: m.id === page.default,
      }));
    },

    listAgents: async () => (await client.agents.list({ limit: 200 })).agents.map(toAgentSpec),

    // Agent registry writes — /v1/agents CRUD. Specs apply when a run is
    // submitted with `agent` or the model spawns a named child; the host
    // narrows capabilities to ≤ parent's, never widens.
    agents: {
      get: (name) => client.agents.get(name),
      create: (input) => client.agents.create(input),
      update: (name, patch) => client.agents.update(name, patch),
      delete: (name) => client.agents.delete(name),
    },

    listRuns: async (opts) => {
      const page = await client.runs.list({
        limit: opts?.limit ?? 50,
        offset: opts?.offset,
        since: opts?.since,
        agent: opts?.agent ?? undefined,
        parent: opts?.parent,
        status: opts?.status,
      });
      const runs = page.runs.map(toRunSummary);
      // `agent: null` = «прогоны БЕЗ агента» (семантика seam'а, mock так же
      // фильтрует). На проводе такой фильтр невыразим — хост игнорирует
      // пустой ?agent=, — поэтому отбираем на стороне оболочки. Раньше фильтр
      // просто терялся, и live отдавал все прогоны вместо agent-less: тот же
      // экран в mock и на живом хосте показывал разные списки.
      return opts?.agent === null ? runs.filter((r) => r.agent == null) : runs;
    },

    listPresence: async () => {
      const [{ processes }, { runs }] = await Promise.all([
        client.processes.list(),
        client.runs.list({ limit: windowSize }),
      ]);
      const taskByRun = new Map(runs.map((r) => [r.runId, r.task ?? '']));
      return processes.map((p): PresenceEntry => ({
        agent: p.agent ?? 'unknown',
        state: p.state as PresenceEntry['state'],
        task: (p.runId && taskByRun.get(p.runId)) ?? '',
        runId: p.runId ?? null,
      }));
    },

    listHandoffs: async () => {
      const runs = await allRuns(client, windowSize);
      const agentByRun = new Map(runs.map((r) => [r.runId, r.agent ?? null]));
      return runs
        .filter((r) => r.parent)
        .map((r): HandoffLink => ({
          id: r.runId,
          from: agentByRun.get(r.parent!) ?? null,
          to: r.agent ?? 'unknown',
          task: r.task ?? '',
          runId: r.runId,
          status: toRunStatus(r.status),
          ts: r.createdAt ?? 0,
        }));
    },

    getMissionGraph: async () => {
      const runs = await allRuns(client, windowSize);
      const nodes: MissionGraphData['nodes'] = runs.map((r) => ({
        id: r.runId,
        label: (r.task ?? r.runId).slice(0, 48),
        kind: 'mission',
        status: toMissionState(r.status),
      }));
      const edges: MissionGraphData['edges'] = runs.flatMap((r) => [
        ...(r.parent ? [{ from: r.parent, to: r.runId, kind: 'delegates' }] : []),
        ...(r.dependsOn ?? []).map((dep) => ({ from: dep, to: r.runId, kind: 'depends' })),
      ]);
      return { nodes, edges };
    },

    listMissions: async () => {
      const runs = await allRuns(client, windowSize);
      const childrenOf = (id: string) => runs.filter((r) => r.parent === id);
      const roots = runs.filter((r) => !r.parent);
      return Promise.all(roots.map((r) => missionFor(r, childrenOf(r.runId))));
    },

    // §2.1 — no project-list endpoint: derive the switcher from what the
    // runs window and the configured-project memory actually contain.
    // Provably incomplete under pagination — the screen labels it so.
    listProjects: async () => {
      const [runs, items] = await Promise.all([
        allRuns(client, windowSize),
        client.memory.list({ project, limit: windowSize }),
      ]);
      const found = new Set<string>([project]);
      for (const r of runs) if (r.project) found.add(r.project);
      for (const m of items) if (m.project) found.add(m.project);
      return [...found].sort();
    },

    listMemory: async (scope) =>
      (await client.memory.list({ project: scope ?? project, limit: windowSize })).map(toMemoryItem),

    searchMemory: async (query, scope) => {
      const items = await client.memory.search({ project: scope ?? project, q: query, k: 10 });
      return items.map((m): MemorySearchHit => ({ ...toMemoryItem(m), score: m.score ?? 0 }));
    },

    getMemoryStructure: async () => {
      // §2.5 — computed over the fetched window only; labelled "recent window".
      const items = await client.memory.list({ project, limit: windowSize });
      const perDay = new Map<string, number>();
      const sources = new Map<string, number>();
      for (const m of items) {
        const day = new Date(m.createdAt * 1000).toISOString().slice(0, 10);
        perDay.set(day, (perDay.get(day) ?? 0) + 1);
        const src = typeof m.meta?.source === 'string' ? m.meta.source : null;
        if (src) sources.set(src, (sources.get(src) ?? 0) + 1);
      }
      return {
        project,
        total: items.length,
        perDay: [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count })),
        sources: [...sources.entries()].map(([name, count]) => ({ name, count })),
      } satisfies MemoryStructure;
    },

    getMemoryGraph: async () => {
      const items = await client.memory.list({ project, limit: windowSize });
      // No relation store exists — nodes only, edges honestly empty.
      const nodes: MemoryGraphData['nodes'] = items.map((m) => ({
        id: m.id,
        label: m.text.slice(0, 48),
        kind: 'memory',
      }));
      return { nodes, edges: [] };
    },

    getModelRouter: async () => {
      const [models, presets] = await Promise.all([client.models.list(), client.presets.list()]);
      const nodes: ModelRouterData['nodes'] = [
        ...presets.presets.map((p) => ({ id: `p-${p.name}`, label: p.name, kind: 'preset' })),
        ...models.models.map((m) => ({ id: `m-${m.id}`, label: m.label, kind: 'model' })),
      ];
      // Server exposes no routing table — preset→default-model edges only
      // for what is verifiably routed: each preset falls back to `default`.
      const edges: ModelRouterData['edges'] = presets.presets.map((p) => ({
        from: `p-${p.name}`, to: `m-${models.default}`, kind: 'routes' as const,
      }));
      return { nodes, edges };
    },

    getUsage: async () => {
      const u = await client.usage.get({ period: 'current_month' });
      return {
        period: u.period,
        runsTotal: u.runsTotal,
        runsSucceeded: u.runsSucceeded,
        runsFailed: u.runsFailed,
        runsCancelled: u.runsCancelled,
        runsTimeout: u.runsTimeout,
        runsRunning: u.runsRunning,
        costUsd: u.costUsd,
        breakdown: Object.entries(u.breakdown).map(([config, row]) => ({
          config, runs: row.runs, costUsd: row.cost_usd,
        })),
      } satisfies UsageSummary;
    },

    listPlugins: async () => (await client.plugins.list({ limit: 200 })).plugins.map(toPluginInfo),

    updatePlugin: async (name, patch) => {
      try {
        return toPluginInfo(await client.plugins.update(name, { active: patch.active }));
      } catch (err) {
        if (isAi2ApiError(err) && err.status === 404) return null; // unknown name — honest null
        throw err;
      }
    },

    listWebhooks: async () => {
      const { webhooks } = await client.webhooks.list();
      return webhooks.map((w): WebhookRow => ({
        webhookId: w.webhookId, url: w.url, events: w.events, active: w.active,
      }));
    },

    createWebhook: async (input) => {
      const w = await client.webhooks.create({ url: input.url, events: input.events });
      return {
        webhook: { webhookId: w.webhookId, url: w.url, events: w.events, active: w.active },
        secret: w.secret, // returned by the server once — never re-listed
      };
    },

    updateWebhook: async (webhookId, patch) => {
      const w = await client.webhooks.update(webhookId, { active: patch.active });
      return { webhookId: w.webhookId, url: w.url, events: w.events, active: w.active };
    },

    deleteWebhook: (webhookId) => client.webhooks.delete(webhookId),

    listWebhookDeliveries: async () => {
      const { webhooks } = await client.webhooks.list();
      const pages = await Promise.all(
        webhooks.map((w) => client.webhooks.deliveries(w.webhookId, { limit: 50 }).catch((err) => {
          if (isAi2ApiError(err) && err.status === 404) return { deliveries: [] };
          throw err;
        })),
      );
      const rows: WebhookDelivery[] = pages.flatMap((p) => p.deliveries.map((d) => ({
        deliveryId: d.deliveryId,
        event: d.event,
        status: (d.status === 'delivered' || d.status === 'failed' ? d.status : 'pending') as WebhookDelivery['status'],
        attempts: d.attempts,
        lastCode: d.lastCode ?? null,
        lastError: d.lastError ?? null,
        ts: Date.parse(d.createdAt) / 1000 || 0,
      })));
      return rows.sort((a, b) => b.ts - a.ts);
    },

    getMetrics: async () => {
      // NUE-2: в --url-режиме встроенный ai2 не поднимается и /v1/metrics
      // уходят на УДАЛЁННЫЙ хост (чужие метрики/401). Сначала локальный
      // мост DesktopBridge (system_metrics) — данные машины, где запущен
      // клиент; null/отсутствие метода → честный fallback на /v1/metrics
      // (веб-браузер без моста ведёт себя как раньше).
      const local = await bridge()
        .then((b) => b?.systemMetrics?.() ?? null)
        .catch(() => null);
      if (local != null) {
        const localHealth: SystemMetrics['health'] = [
          { component: 'local-host', status: 'ok', detail: 'DesktopBridge (локальная машина)' },
        ];
        return {
          cpuPct: local.cpu,
          ramPct: local.ram,
          diskPct: local.disk,
          gpuPct: null,
          uptimeS: local.uptime_s,
          processesActive: Array.isArray(local.processes) ? local.processes.length : null,
          counters: { modelCalls: 0, toolCalls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 },
          health: localHealth,
          freshness: 'live',
        } satisfies SystemMetrics;
      }
      const [m, h] = await Promise.all([client.metrics(), client.health()]);
      const counters = m.tenant.usage ?? {};
      type HealthEntry = SystemMetrics['health'][number];
      // Хост отдаёт компоненты как { healthy, message }; старая форма
      // { ok, detail } остаётся валидной (mock-транспорт, старые хосты).
      // Без fallback на healthy каждый компонент читался как error и рейл
      // показывал ложное «Требует внимания».
      const health: HealthEntry[] = Object.entries(h.components).map(([component, c]) => {
        const raw = c as { ok?: boolean; healthy?: boolean; detail?: string; message?: string };
        return {
          component,
          status: (raw.ok ?? raw.healthy) === false ? 'error' : 'ok',
          detail: raw.detail ?? raw.message ?? null,
        };
      });
      // checks.* — verbatim сводка хоста (db/provider/stores); degraded
      // провайдер поднимает верхний status хоста, поэтому он обязан дойти
      // до рейла как warn, а не потеряться.
      for (const [check, c] of Object.entries(h.checks ?? {})) {
        if (c == null) continue;
        if (c.state === 'degraded') {
          health.push({ component: `check:${check}`, status: 'warn', detail: c.detail ?? null });
        } else if (c.state === 'error' || c.state === 'unhealthy') {
          health.push({ component: `check:${check}`, status: 'error', detail: c.detail ?? null });
        }
      }
      return {
        cpuPct: m.system.cpu_percent ?? null,
        ramPct: m.system.memory_percent ?? null,
        diskPct: m.system.disk_percent ?? null,
        gpuPct: m.system.gpu_percent ?? null,
        uptimeS: m.system.uptime_s ?? null,
        processesActive: m.pool?.processes_active ?? null,
        counters: {
          modelCalls: counters.model_calls ?? 0,
          toolCalls: counters.tool_calls ?? 0,
          tokensIn: counters.tokens_in ?? 0,
          tokensOut: counters.tokens_out ?? 0,
          costUsd: counters.cost_usd ?? 0,
        },
        health,
        freshness: 'live',
      } satisfies SystemMetrics;
    },

    listApiKeys: async () => {
      // §2.4 — /v1/keys has no pagination; fetch whole list.
      const { keys } = await client.keys.list();
      return keys.map(toApiKeyInfo);
    },

    createApiKey: async (input) => {
      const k = await client.keys.create({ name: input.name, scopes: input.scopes });
      return { key: toApiKeyInfo(k), secret: k.secret }; // secret only on create — never re-listed
    },

    revokeApiKey: (keyId) => client.keys.delete(keyId),

    startRun: async (input: StartRunInput) => {
      const ref = await client.runs.create({
        task: input.task,
        // 'default' was a UI placeholder — the host preset enum rejects it;
        // normalize to the valid baseline preset.
        config: input.config === 'default' ? 'baseline' : input.config,
        agent: input.agent ?? undefined,
        project: input.project ?? undefined,
        useMemory: input.useMemory ?? undefined,
        model: input.model ?? undefined,
        fsPolicy: input.fsPolicy ?? undefined,
        idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
      });
      // create → 202 ref only; fetch the stored record for honest fields.
      const run = await client.runs.get(ref.runId).catch(() => null);
      return run
        ? toRunSummary(run)
        : {
          runId: ref.runId, taskText: input.task, config: input.config,
          status: toRunStatus(ref.status), stopReason: null,
          agent: input.agent ?? null, parent: null,
          project: input.project ?? null, model: input.model ?? null, costUsd: null,
          createdAt: 0, finishedAt: null,
        };
    },

    cancelRun: async (runId) => { await client.runs.cancel(runId); },

    // W1-05: GET /v1/capabilities — the host-declared feature map. Approvals
    // and plan-preview seams stay unimplemented until the map reports them
    // supported — `unavailable` by design, never fabricated. Run controls
    // ARE wired (below): the map gates each action's availability.
    getCapabilities: () => client.capabilities(),

    // W3-11: GET /v1/worker/status — host-reported worker state verbatim;
    // `down` is the honest not-launched answer, never synthesized locally.
    workerStatus: async () => (await client.worker.status()).worker,

    // Local-agent dispatch: full worker lifecycle + bounded ops. Results
    // pass through verbatim — op payloads and host error text stay the
    // host's words, the screen never fabricates workspace authority.
    worker: {
      launch: (input) => client.worker.launch(input),
      status: async () => (await client.worker.status()).worker,
      request: (input) => client.worker.request(input),
      revoke: async () => (await client.worker.revoke()).worker,
      shutdown: async () => (await client.worker.shutdown()).worker,
    },

    // backlog #2 (route-runbook): /run?id= screen. Composition of
    // runs.get + runs.events + runs.result; unknown id → null (404),
    // missing stored result → null (run still live or nothing recorded).
    getRunDetail: async (runId) => {
      const run = await client.runs.get(runId).catch((err) => {
        if (isAi2ApiError(err) && err.status === 404) return null;
        throw err;
      });
      if (!run) return null;
      const [evPage, result] = await Promise.all([
        client.runs.events(runId, { limit: 1000 }),
        client.runs.result(runId).catch((err) => {
          if (isAi2ApiError(err) && err.status === 404) return null;
          throw err;
        }),
      ]);
      return {
        run: toRunSummary(run),
        result: result ? toRunResultView(run, result) : null,
        events: evPage.events
          .map(toRunEventView)
          .filter((e): e is RunEventView => e !== null),
      } satisfies RunDetail;
    },

    // W1-133: the endpoint accepts one root run/thread only. UI gates the
    // action until the visible chat proves a single compatible root ID.
    chatCompact: (input) => client.chat.compact(input),
    // W1-139: status is host-owned; absent auto-compaction state remains null.
    // Unknown session → host 404 session_not_found → null, как getRunDetail:
    // «нет данных» ≠ «ошибка транспорта».
    getChatCompactionStatus: (sessionId) =>
      client.chat.compactionStatus(sessionId).catch((err) => {
        if (isAi2ApiError(err) && err.status === 404) return null;
        throw err;
      }),
    // W1: unknown model window/threshold remains null through the adapter.
    getChatCompactionConfig: () => client.chat.compactionConfig(),

    // W3-143: история треда постранично. Wire newest-first → хронология;
    // message id `<run>:task|answer` разбирается до runId/part, compact-ноды
    // сохраняют coversMessageIds для существующего renderer'а.
    getChatHistory: async (threadId, q) => {
      const page = await client.chat.history(threadId, q);
      const entries: ChatHistoryEntry[] = [];
      for (const m of page.messages) {
        if (m.type === 'compact') {
          entries.push({
            kind: 'compact',
            id: m.id,
            summary: m.summary,
            coversMessageIds: m.coversMessageIds,
            createdAt: m.createdAt,
          });
          continue;
        }
        const sep = m.id.lastIndexOf(':');
        const runId = sep < 0 ? m.id : m.id.slice(0, sep);
        const part = sep < 0 ? null : m.id.slice(sep + 1);
        if (part !== 'task' && part !== 'answer') continue; // неизвестный part — не выдумываем роль
        entries.push({
          kind: 'message',
          id: m.id,
          runId,
          part,
          role: m.role,
          text: m.text,
          createdAt: m.createdAt,
        });
      }
      // Хост отдаёт newest-first; лента читает старые → новые.
      entries.reverse();
      return {
        sessionId: page.sessionId,
        entries,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      };
    },

    streamRun: (runId, { fromSeq, onEvent, onDelta, onEnd, onGap }) => {
      const ac = new AbortController();
      let gapOpen = false;
      let ended = false;
      const finish = (status: Parameters<typeof onEnd>[0]) => {
        if (ended) return;
        ended = true;
        onEnd(status);
      };
      const closeGap = () => {
        if (gapOpen) { gapOpen = false; onGap?.(false); }
      };
      void (async () => {
        try {
          for await (const e of streamRunEvents({
            runId,
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            fetchImpl: config.fetchImpl,
            signal: ac.signal,
            lastSeq: fromSeq,
          })) {
            if (e.type === 'stream_gap') {
              if (!gapOpen) { gapOpen = true; onGap?.(true); }
              continue;
            }
            if (e.type === 'model_delta') {
              // Ephemeral token chunk — passthrough, no seq (toRunEventView
              // would drop it); screens accumulate it as the live draft.
              // NQ-115: an ephemeral delta does NOT prove the persisted
              // stream caught up, so it must not clear the open gap — stale
              // stays on until a real (persisted) event re-synchronises.
              onDelta?.(typeof e.text === 'string' ? e.text : '');
              continue;
            }
            closeGap();
            if (e.type === 'end') {
              finish(toRunStatus(String(e.status ?? 'done')));
              return;
            }
            const view = toRunEventView(e);
            if (view) onEvent(view);
          }
          // Iterable finished without an `end` frame (reconnects exhausted).
          finish(toRunStatus('error'));
        } catch {
          // Transport errors surface through the status channel — screens
          // already render error/stale from the data seam (no raw throws up).
          closeGap();
          finish(toRunStatus('error'));
        }
      })();
      return () => ac.abort();
    },

    // W1-05/06 live-wiring: controls consult the host feature map — the shell
    // never guesses endpoints. Unsupported actions stay disabled with the
    // host's own `reason` (never hidden, never no-ops); pause/resume/
    // checkpoint have no server methods until the map flips them supported.
    getRunControls: runControlsFor,

    replayRun: async (runId) => {
      const next = await runControlsFor(runId);
      return next.replay.available ? next : null;
    },

    retryRun: async (runId) => {
      const src = await client.runs.get(runId).catch((err) => {
        if (isAi2ApiError(err) && err.status === 404) return null;
        throw err;
      });
      if (!src || !TERMINAL_STATUSES.has(toRunStatus(src.status))) return null;
      const ref = await client.runs.create({
        task: src.task ?? '',
        config: src.config ?? 'baseline',
        agent: src.agent ?? undefined,
        project: src.project ?? undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      const run = await client.runs.get(ref.runId).catch(() => null);
      return run ? toRunSummary(run) : null;
    },

    // pause/resume/checkpoint methods stay undefined while the map reports
    // unsupported — getRunControls renders them disabled with the reason.

    // INT-23: image generation pass-through — the host owns provider keys
    // and capability reporting; the screen gates on features.imageGen.
    generateImage: (input) => client.images.generate(input),

    // W1 voice: TTS pass-through — the host renders the voice with Fish Audio
    // (AGENT-A), the screen gates on features.voice; audio arrives as
    // base64 and becomes a Blob here — callers never touch the wire encoding.
    voice: {
      voices: async () => (await client.voice.list()).voices,
      stt: async () => (await client.voice.list()).stt,
      speak: async (text, voiceId) => {
        // WAV/PCM16 — the host always lists it and every WebView/browser
        // decodes it; the ogg default trips WebView2's codec set.
        const s = await client.voice.speak({ text, voice: voiceId, format: 'wav' });
        return { audio: b64ToBlob(s.audioB64, s.mime), voice: s.voice, mime: s.mime, cached: s.cached };
      },
      transcribe: (audio) => client.voice.transcribe(audio),
    },

    // fs-access dispatch: typed pass-through — the host owns the boundary
    // (roots validation, write-request execution); the shell only forwards
    // paths/decisions and renders verbatim reasons.
    fs: {
      validate: (path) => client.fs.validate(path),
      requests: (q) => client.fs.requests(q),
      approve: (requestId) => client.fs.approve(requestId),
      deny: (requestId) => client.fs.deny(requestId),
    },

    // Wave XI W1 — шина окон NEU (/v1/bus/*): сессии окон и делегация
    // задач через send.ps1 на хосте. Ответ 503 (шина не настроена) — это
    // честный ответ хоста, seam присутствует всегда: экран получает
    // Ai2ApiError с verbatim-причиной и показывает её, не мок.
    bus: {
      listSessions: async () => (await client.bus.sessions()).sessions,
      delegateTask: (input) => client.bus.delegate(input),
      getDelegation: (id) => client.bus.delegation(id),
      // XIV — GET /v1/bus/overview: таблица окон + дозор; status unknown —
      // честный пустой экран, не ошибка.
      overview: () => client.bus.overview(),
    },

    // Wave XIV — подтверждения SDK-канала (sdk-confirm-contract.md):
    // открытые карточки + решение allow|deny|defer с причиной. 503 при
    // выключенном AI2_SDK_ENABLED — verbatim-ошибка, не мок.
    listToolConfirmations: async (runId) =>
      (await client.sdk.confirmations(runId)).confirmations,
    respondToolConfirmation: (runId, callId, decision, reason) =>
      client.sdk.confirm(runId, callId, { decision, reason }),
    sdkAudit: (query) => client.sdk.auditLog(query),

    // Wave XIV — сессии агента SDK (sdk-sessions-contract.md): тот же
    // флаг AI2_SDK_ENABLED; 503 без него — verbatim-причина, не мок.
    sdkSessions: {
      list: (query) => client.sdk.sessions(query ?? {}).then((r) => r.sessions),
      patch: (sessionId, input) => client.sdk.patchSession(sessionId, input),
      fork: (sessionId, input) => client.sdk.forkSession(sessionId, input),
      run: (input) => client.sdk.run(input),
      usage: (sessionId) => client.sdk.sessionUsage(sessionId),
    },
    // XV — учёт по ассистентам (W1 задача 23): базис KPI-плиток /home.
    // Тот же флаг AI2_SDK_ENABLED → 503 verbatim; пусто → assistants: [].
    sdkAssistantUsage: () => client.sdk.assistantUsage(),

    // XIV — дерево делегаций и хэндофы SDK (sdk-delegations-contract.md):
    // параллельные фоновые прогоны, кооперативная отмена, передачи между
    // ассистентами. Тот же флаг AI2_SDK_ENABLED → 503 verbatim без него.
    sdkDelegations: {
      list: (parentRunId) => client.sdk.delegations({ parentRunId }).then((r) => r.delegations),
      delegate: (runId, input) => client.sdk.delegate(runId, input),
      cancel: (runId) => client.sdk.cancelRun(runId),
    },
    sdkHandoffs: {
      list: (status) => client.sdk.handoffs({ status }).then((r) => r.handoffs),
      create: (input) => client.sdk.createHandoff(input),
      resolve: (id, accept, reason) => client.sdk.resolveHandoff(id, accept, reason),
    },
    // XIV — правила проекта (sdk-rules-contract.md): только метаданные.
    sdkRules: {
      list: (directory) => client.sdk.rules({ directory }),
    },
    // XIV — каталог MCP (mcp-servers-contract.md): без SDK-флага;
    // вызов — через канал подтверждений fs_requests.
    mcpServers: {
      list: () => client.mcp.servers(),
      call: (name, input) => client.mcp.call(name, input),
    },
    // XIV — библиотека промптов (prompts-contract.md): файлы + saved +
    // CRUD сохранённых (за AI2_SDK_ENABLED).
    prompts: {
      list: async () => (await client.prompts()).prompts.map((p) => ({
        name: p.name,
        path: p.path,
        id: p.id ?? null,
        source: p.source ?? 'file',
        updatedAt: p.updatedAt ?? null,
      })),
      create: (input) => client.createPrompt(input),
      update: (id, input) => client.updatePrompt(id, input),
      remove: (id) => client.deletePrompt(id),
    },
    // XIV — учёт прогона SDK и чекпоинты отката (sdk-usage-checkpoints-
    // contract.md): rewind → 202 + карточка tool='rewind'; восстановление
    // выполняет хост после allow — локального отката нет.
    sdkRunUsage: (runId) => client.sdk.usage(runId),
    sdkCheckpoints: {
      list: async (runId) => (await client.sdk.checkpoints(runId)).checkpoints,
      rewind: (runId, checkpointId) => client.sdk.rewind(runId, checkpointId),
    },
    // XV — приёмочный шлюз сценария S1-S9: статусы verbatim от хоста.
    scenarioHealth: () => client.scenarioHealth(),
    // XVI — инвентарь NEU-плагинов: маршруты /v1/neu/plugins объявляет
    // W1; до их появления live отвечает 404 — экран честно «недоступно».
    neuPlugins: {
      list: () => client.neuPlugins.list(),
      setEnabled: (id, enabled) => client.neuPlugins.setEnabled(id, enabled),
      setRowEnabled: (id, rowId, enabled) => client.neuPlugins.setRowEnabled(id, rowId, enabled),
    },

    // Wave XII W1 — каталог prompt-файлов библиотеки (GET /v1/prompts,
    // AI2_PROMPTS_DIR на хосте). Каталога нет → хост отвечает пустым
    // списком: экран показывает «Нет данных», файлы не выдумываются.
    // XIV: path стал nullable (saved-записи) — ключ строки = path ?? id.
    listPrompts: async (): Promise<PromptFileRef[]> =>
      (await client.prompts()).prompts.map((p) => ({
        name: p.name,
        path: p.path ?? p.id ?? p.name,
      })),

    // W1 telegram: typed pass-through — the host adapter owns TDLib and app
    // credentials; unavailable arrives as a real status (native lib/creds
    // absent) with the host's verbatim reason, not as a missing seam.
    telegram: {
      getState: () => client.telegram.status(),
      startAuth: (input) => client.telegram.auth(input),
      listChats: () => client.telegram.chats(),
      getHistory: (chatId) => client.telegram.history(chatId),
      sendText: (chatId, text) => client.telegram.send(chatId, text),
      logout: () => client.telegram.logout(),
      // no setMockState — live adapters never fake connectivity (contract)
    },

    // INT-24: NOIR player seam — present only when the host URL is
    // configured; session auth stays inside the client (Bearer binding).
    noir: noirBaseUrl
      ? createLazyNoirClient(() =>
          import('../../noir/api/client').then((m) => m.createNoirClient({ baseUrl: noirBaseUrl })),
        )
      : undefined,

    // Unreal scene: DesktopBridge js_api (unreal_scene_state/open). Rejects
    // when the shell has no bridge or no scene methods — the tab renders
    // error+retry, which also covers the late pywebviewready injection.
    unrealScene: {
      getState: async () => {
        const b = await bridge();
        if (!b.available) throw new Error('desktop bridge unavailable');
        const s = await b.unrealSceneState();
        if (s == null) throw new Error('host exposes no unreal_scene_state');
        return toUnrealSceneState(s);
      },
      open: async () => {
        const b = await bridge();
        if (!b.available) throw new Error('desktop bridge unavailable');
        // Active theme → NEXUS_SCENE_THEME (material-contract §1): the
        // theme wrapper div carries data-theme; absent attr → host default.
        const theme = typeof document !== 'undefined'
          ? document.querySelector('[data-theme]')?.getAttribute('data-theme') ?? undefined
          : undefined;
        // W1 S3: profile persona → NEXUS_SCENE_ASSISTANT. The closed set is
        // the five scene personas; 'nexus'/missing is NOT sent — the scene
        // falls back to alice instead of receiving a fabricated value.
        const assistant = sceneAssistantOf(loadProfile()?.agentId);
        const s = await b.unrealSceneOpen(theme, assistant);
        if (s == null) throw new Error('host exposes no unreal_scene_open');
        return toUnrealSceneState(s);
      },
      // VIII V1.4: переключение персоны без перезапуска — verbatim ответ
      // хоста; sent:false = канал мёртв/значение отвергнуто (UI не
      // показывает переключение, которого не было).
      setActive: async (assistant: string) => {
        const b = await bridge();
        if (!b.available || b.unrealSceneSetActive == null) {
          throw new Error('host exposes no unreal_scene_set_active');
        }
        const r = await b.unrealSceneSetActive(assistant);
        if (r == null) throw new Error('unreal_scene_set_active rejected');
        return { sent: r.sent === true, state: toUnrealSceneState(r.state ?? {}) };
      },
      // bridge-contract §2 push: the host dispatches `unreal-scene.state`
      // DOM events. When the shell has no push source (browser/older host)
      // subscribe honestly falls back to polling — callers never need to
      // know which transport feeds the updates.
      subscribe: (onState) => {
        let stop: (() => void) | undefined;
        let cancelled = false;
        void bridge().then((b) => {
          if (cancelled || !b.available) return;
          if (b.unrealSceneSubscribe != null) {
            stop = b.unrealSceneSubscribe((s) => onState(toUnrealSceneState(s)));
          } else {
            const poll = setInterval(() => {
              void b.unrealSceneState()
                .then((s) => { if (!cancelled && s != null) onState(toUnrealSceneState(s)); })
                .catch(() => { });
            }, 10_000);
            stop = () => clearInterval(poll);
          }
        });
        return () => { cancelled = true; stop?.(); };
      },
      // Обратные события сцены `unreal-scene.event` (VII V3-1): клик по
      // портрету, возврат, ошибка карты — verbatim, без опроса-фолбэка
      // (события по природе push; без источника подписка честно нулевая).
      subscribeEvents: (onEvent) => {
        let stop: (() => void) | undefined;
        let cancelled = false;
        void bridge().then((b) => {
          if (cancelled || !b.available || b.unrealSceneEvents == null) return;
          stop = b.unrealSceneEvents(onEvent);
        });
        return () => { cancelled = true; stop?.(); };
      },
      // VIII V3-3: снапшот для 3D-панелей — только реальные seam'ы live AI-2
      // (§11 контракта); упавший seam → поле null («нет данных»), сам вызов
      // не падает из-за одного сбойного источника.
      getPanelData: async () => {
        const [agents, presence, runs, metrics, models, usage] = await Promise.allSettled([
          ds.listAgents(), ds.listPresence(), ds.listRuns(), ds.getMetrics(), ds.listModels(), ds.getUsage(),
        ]);
        const pick = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);
        return {
          agents: pick(agents), presence: pick(presence), runs: pick(runs),
          metrics: pick(metrics), models: pick(models), usage: pick(usage),
          collectedAt: Math.floor(Date.now() / 1000),
        };
      },
    },

    // INT-18: Instagram Web managed window — bridge-backed lifecycle
    // (separate profile, no js_api on the page). `api` stays absent:
    // Graph API keys are a different integration, never fabricated here.
    instagram: {
      web: {
        getState: async () => (await bridge()).instagramWebState(),
        open: async () => (await bridge()).instagramWebOpen(),
        close: async () => (await bridge()).instagramWebClose(),
      },
    },
  };
  return ds;
}
