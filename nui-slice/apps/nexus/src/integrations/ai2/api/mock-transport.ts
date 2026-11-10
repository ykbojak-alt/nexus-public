import type { Ai2Client } from './client';
import { Ai2ApiError } from './errors';
import type { Ai2Agent, Ai2Plugin } from '../contracts/agents';
import type { Ai2MemoryItem } from '../contracts/memory';
import type { Ai2Run, Ai2RunEvent } from '../contracts/runs';
import type { Ai2Webhook } from '../contracts/webhooks';
import type { Ai2ApiKey } from '../contracts/system';

/**
 * Deterministic in-memory AI-2 transport (Task 8 / roadmap D2).
 * Lets the app and adapters run without a live backend — dev mode,
 * unit tests, Storybook. Same `Ai2Client` surface as `createAi2Client`;
 * callers swap the factory, never the call sites.
 *
 * Determinism rules: fixed epoch T0, sequential ids (`run_mock_N`),
 * created runs complete instantly, no clock reads.
 */

const T0 = 1_700_000_000;

const AGENTS: Ai2Agent[] = [
  {
    tenant: 'local', name: 'builder', description: 'Строит и проверяет артефакты',
    config: 'screen', capabilities: ['fs.read', 'fs.write', 'exec'],
    taskPrefix: 'BUILD:', maxCostUsd: 2, createdAt: T0, updatedAt: T0,
  },
  {
    tenant: 'local', name: 'planner', description: 'Разбивает задачи на шаги',
    config: 'planner', capabilities: ['fs.read'],
    taskPrefix: 'PLAN:', maxCostUsd: 1, createdAt: T0, updatedAt: T0,
  },
];

const PLUGINS: Ai2Plugin[] = [];

const WEBHOOKS: Ai2Webhook[] = [];

const API_KEYS: Ai2ApiKey[] = [];

/** Deterministic fixture workspace for the mock worker (grant-bounded ops). */
const MOCK_WORKER_FILES: Record<string, string> = {
  'src/a.txt': 'hello nexus',
  'src/b.txt': 'mock worker file',
  'README.md': '# mock workspace\n',
};

export function createMockAi2Client(opts?: {
  /**
   * W1-173: сессии (корневые run_id тредов), протухшие по TTL. У фикстуры
   * нет часов — протухание моделируется явным списком, а не таймером:
   * expired/expiry-поля и 409 `session_expired` воспроизводятся
   * детерминированно, без выдумывания в рантайме.
   */
  expiredSessions?: readonly string[];
  /**
   * Предзасеянные прогоны (W1-172 `error` у failed-прогона и т.п.): записи
   * кладутся в стор verbatim — мок не «вычисляет» их поля. runSeq
   * продолжается поверх, так что seed `run_mock_N` коллидирует с создаваемыми
   * id — используйте собственные префиксы (`run_seed_…`).
   */
  seedRuns?: readonly Ai2Run[];
}): Ai2Client {
  const expiredSessions = new Set(opts?.expiredSessions ?? []);
  const runs = new Map<string, Ai2Run>((opts?.seedRuns ?? []).map((r) => [r.runId, r]));
  const memory = new Map<string, Ai2MemoryItem>();
  let runSeq = 0;
  let memSeq = 0;
  // Mock worker lifecycle — mirrors the real grant semantics (roots/ops/allowlist/
  // revoke), backed by the fixture tree, never the real filesystem.
  let workerUp = false;
  let workerRevoked = false;
  let workerGrant: { roots: string[]; ops: string[]; commands: string[][]; mode: string } | null = null;
  const workerCheckpoints = new Map<string, Map<string, string>>();
  let checkpointSeq = 0;

  const workerDenied = (msg: string) =>
    new Ai2ApiError(403, { error: 'denied', message: msg });
  const workerPathOk = (p: string) =>
    workerGrant!.roots.some((r) => {
      const last = r[r.length - 1];
      const root = last === '/' || last === '\\' ? r.slice(0, -1) : r;
      return p === root || p.startsWith(`${root}/`) || p.startsWith(`${root}\\`);
    });
  const workerStatus = () => workerUp
    ? {
      state: 'ready' as const, pid: 4242, restarts: 0, maxRestarts: 2, uptimeS: 1,
      grant: workerGrant == null ? undefined : {
        grantId: 'mock-grant-1', mode: workerGrant.mode as 'observe',
        roots: workerGrant.roots, ops: [...workerGrant.ops].sort(),
        expiresAt: null, revoked: workerRevoked,
      },
    }
    : { state: 'down' as const, launched: false };

  const runEvents = (runId: string): Ai2RunEvent[] => [
    { seq: 1, ts: T0, runId, type: 'run_started', text: 'run accepted (mock)' },
    { seq: 2, ts: T0 + 1, runId, type: 'end', status: 'done' },
  ];

  // W1-185: однострочный превью промпта — первые RUN_PREVIEW_CHARS символов,
  // как у хоста (task_preview). Полный текст остаётся в run.task.
  const RUN_PREVIEW_CHARS = 160;
  const taskPreview = (text: unknown): string => {
    if (typeof text !== 'string') return '';
    const flat = text.split(/\s+/).join(' ').trim();
    return flat.length <= RUN_PREVIEW_CHARS ? flat : `${flat.slice(0, RUN_PREVIEW_CHARS).trimEnd()}…`;
  };

  // W1-190: сессия существует, когда прогон с run_id === session_id есть в
  // сторе (session_id — корневой прогон треда). Пустая строка = «сессии нет».
  const checkSession = (sessionId: string | undefined) => {
    if (!sessionId) return;
    if (!runs.has(sessionId)) {
      throw new Ai2ApiError(404, { error: 'not_found', message: 'session_not_found' });
    }
    // W1-173: протухшая сессия читается, но новый ход в неё запрещён —
    // 409 с причиной verbatim формы `session_expired: <reason>` хоста.
    const expiry = sessionExpiry(sessionId);
    if (expiry.expired) {
      throw new Ai2ApiError(409, {
        error: 'conflict', message: `session_expired: ${expiry.reason}`,
      });
    }
  };

  /** Прогоны в хост-порядке: created_at DESC, rowid DESC (новые сверху). */
  const orderedRuns = (): Ai2Run[] =>
    [...runs.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
      || Number(b.runId.replace(/\D/g, '')) - Number(a.runId.replace(/\D/g, '')));

  /** Протухание сессии verbatim формы `session_expiry` хоста (W1-173):
   *  без часов expired=false — кроме сессий из фикстурного expiredSessions,
   *  там idle детерминированно за пределом TTL и reason в форме хоста. */
  const sessionExpiry = (sessionId: string) => {
    const root = runs.get(sessionId);
    const members = [...runs.values()].filter((r) => r.sessionId === sessionId);
    const stamps = [root?.createdAt, ...members.map((r) => r.createdAt)]
      .filter((t): t is number => typeof t === 'number');
    const last = stamps.length > 0 ? Math.max(...stamps) : null;
    if (expiredSessions.has(sessionId)) {
      // Форма reason — та же, что у хоста; idle фиксирован TTL+1 ч.
      const idleS = 25 * 3600;
      return {
        expired: true,
        ttlHours: 24,
        lastActivityAt: last,
        idleSeconds: idleS as number | null,
        reason: 'сессия протухла: нет активности 25.0 ч (TTL 24 ч); начните новую сессию' as string | null,
      };
    }
    return {
      expired: false,
      ttlHours: 24,
      lastActivityAt: last,
      idleSeconds: null as number | null,
      reason: null as string | null,
    };
  };

  return {
    healthz: async () => ({
      status: 'ok', version: 'mock', mode: 'dev', dev_mode: true, provider: 'mock',
    }),
    health: async () => ({
      status: 'healthy',
      components: { store: { ok: true }, runner: { ok: true } },
      // W1-175+: сводка подсистем — форма verbatim (db/stores ok — сторы
      // мока живые; provider unknown — сетевой проверки в моке нет, как и у
      // хоста без реального ping: network_checked=false).
      checks: {
        db: { state: 'ok', detail: '' },
        provider: {
          state: 'unknown', name: 'mock', network_checked: false,
          detail: 'mock: конфигурация провайдера не проверяется — сетевого ping нет',
        },
        stores: { state: 'ok', detail: '' },
      },
    }),
    // XV — шлюз сценария у мока нет: честный пустой список шагов
    // («нет данных у хоста»), демо-статусы не выдумываются.
    scenarioHealth: async () => ({ steps: [], generatedAt: null }),
    metrics: async () => ({
      ts: new Date(T0 * 1000).toISOString(),
      system: { cpu_percent: 0, memory_percent: 0, rss_mb: 0, threads: 1, uptime_s: 0 },
      pool: { jobs: 0, queued: 0, waiting_deps: 0, processes_active: 0, capacity: 4 },
      tenant: { runs_active: 0, runs_total: runs.size },
      // W1-195+: блоки хоста verbatim — счётчики реальные, из стора мока.
      stores: {
        runs: {
          total: runs.size,
          by_status: [...runs.values()].reduce<Record<string, number>>((acc, r) => {
            acc[r.status] = (acc[r.status] ?? 0) + 1;
            return acc;
          }, {}),
        },
        memory: {
          items: memory.size,
          projects: new Set([...memory.values()].map((m) => m.project)).size,
        },
      },
      // W1-199: sessions.total — distinct session_id с прогонами.
      sessions: {
        total: new Set(
          [...runs.values()].map((r) => r.sessionId).filter((s): s is string => s != null),
        ).size,
      },
      // Воркера retention и монитора целостности в моке нет — как у живого
      // хоста без них: явный null, не выдуманные счётчики.
      retention: null,
      integrity: null,
      version: 'mock',
    }),
    // W1-05 shape — mirrors the real endpoint's honest map: optional
    // features report supported=false, not silence.
    capabilities: async () => ({
      version: 'mock',
      tenant: 'mock',
      features: {
        approvals: { supported: false, reason: 'mock transport' },
        runPlanPreview: { supported: false, reason: 'mock transport' },
        runPauseResume: { supported: false, reason: 'mock transport' },
        runCheckpoints: { supported: false, reason: 'mock transport' },
        runReplay: { supported: true, reason: null },
        runCancel: { supported: true, reason: null },
        idempotentRunCreate: { supported: true, reason: null },
        sseStream: { supported: true, reason: null },
        webhooks: { supported: true, reason: null },
        memory: { supported: true, reason: null },
        worker: { supported: true, reason: null, via: 'mock transport — in-memory grant worker over a fixture fs' },
        imageGen: { supported: true, reason: null, via: 'mock transport — deterministic fixture PNG', models: ['mock/ming-image-free'] },
        voice: { supported: true, reason: null, via: 'mock transport — deterministic fixture WAV (tone, not speech)' },
        fs: { supported: false, reason: 'mock transport — нет хостовой ФС' },
      },
      capabilityVocabulary: ['compute', 'external', 'fs.read', 'fs.write'],
      agentCapabilities: [],
      scopes: [],
      components: {},
      ts: new Date(T0 * 1000).toISOString(),
    }),

    models: {
      list: async () => ({
        models: [{ id: 'default', label: 'Built-in default', free: null }],
        default: 'default',
      }),
    },
    presets: {
      list: async () => ({ presets: [{ name: 'baseline', flags: {} }], default: 'baseline' }),
    },

    agents: {
      list: async (q) => ({
        agents: AGENTS.slice(q?.offset ?? 0, (q?.offset ?? 0) + (q?.limit ?? AGENTS.length)),
        limit: q?.limit ?? AGENTS.length, offset: q?.offset ?? 0,
      }),
      get: async (name) => {
        const found = AGENTS.find((a) => a.name === name);
        if (!found) throw new Error(`mock agent not found: ${name}`);
        return found;
      },
      create: async (input) => ({
        tenant: 'local', name: input.name, description: input.description ?? '',
        config: input.config ?? null, capabilities: input.capabilities ?? [],
        taskPrefix: input.taskPrefix ?? '', maxCostUsd: input.maxCostUsd ?? null,
        createdAt: T0, updatedAt: T0,
      }),
      update: async (name, patch) => {
        const base = AGENTS.find((a) => a.name === name) ?? AGENTS[0];
        return {
          ...base,
          description: patch.description ?? base.description,
          config: patch.config === undefined ? base.config : patch.config,
          capabilities: patch.capabilities ?? base.capabilities,
          taskPrefix: patch.taskPrefix ?? base.taskPrefix,
          maxCostUsd: patch.maxCostUsd === undefined ? base.maxCostUsd : patch.maxCostUsd,
          updatedAt: T0 + 1,
        };
      },
      delete: async () => undefined,
    },

    plugins: {
      list: async (q) => ({
        plugins: PLUGINS.slice(q?.offset ?? 0, (q?.offset ?? 0) + (q?.limit ?? PLUGINS.length)),
        limit: q?.limit ?? PLUGINS.length, offset: q?.offset ?? 0,
      }),
      get: async (name) => {
        const found = PLUGINS.find((p) => p.name === name);
        if (!found) throw new Error(`mock plugin not found: ${name}`);
        return found;
      },
      create: async (input) => ({
        tenant: 'local', name: input.name, description: input.description ?? '',
        url: input.url, active: true, hasSecret: Boolean(input.secret),
        secret: input.secret ?? 'mock_secret', createdAt: T0, updatedAt: T0,
      }),
      update: async (name, patch) => {
        const base = PLUGINS.find((p) => p.name === name) ?? {
          tenant: 'local', name, description: '', url: '', active: true,
          hasSecret: false, createdAt: T0, updatedAt: T0,
        };
        return { ...base, ...patch, hasSecret: patch.secret ? true : base.hasSecret, updatedAt: T0 + 1 };
      },
      delete: async () => undefined,
    },

    processes: {
      list: async () => ({ processes: [] }),
    },

    runs: {
      list: async (q) => {
        // Фильтры GET /v1/runs (контракт ListRunsQuery) — mock-хост отвечает
        // так же, как живой: иначе пути «дети прогона» (parent) и «прогоны
        // агента» проверялись бы в тестах на неотфильтрованной выдаче.
        // W1-185/190: порядок хоста created_at DESC + session_id-фильтр +
        // before-курсор (строго старше якоря; неизвестный → 404; с offset
        // несовместим → 422) и поля has_more/next_cursor/preview.
        if (q?.before != null && q.offset != null && q.offset !== 0) {
          throw new Ai2ApiError(422, {
            error: 'validation_error',
            message: 'before и offset несовместимы: курсор уже задаёт позицию',
          });
        }
        const all = orderedRuns().filter((r) => {
          if (q?.agent != null && r.agent !== q.agent) return false;
          if (q?.parent != null && r.parent !== q.parent) return false;
          if (q?.project != null && (r.project ?? null) !== q.project) return false;
          if (q?.config != null && r.config !== q.config) return false;
          if (q?.status != null && r.status !== q.status) return false;
          if (q?.since != null && (r.createdAt ?? 0) < q.since) return false;
          if (q?.until != null && (r.createdAt ?? 0) > q.until) return false;
          if (q?.sessionId != null && (r.sessionId ?? null) !== q.sessionId) return false;
          return true;
        });
        // Курсор — позиция, а не предикат: якорь ищется во всём сторе,
        // страница идёт строго после него в общем порядке выборки.
        let start = q?.offset ?? 0;
        if (q?.before != null) {
          const anchor = orderedRuns().findIndex((r) => r.runId === q.before);
          if (anchor === -1) {
            throw new Ai2ApiError(404, { error: 'not_found', message: 'run_not_found' });
          }
          const anchorRun = orderedRuns()[anchor];
          start = all.findIndex(
            (r) => (r.createdAt ?? 0) < (anchorRun.createdAt ?? 0)
              || ((r.createdAt ?? 0) === (anchorRun.createdAt ?? 0)
                && Number(r.runId.replace(/\D/g, '')) < Number(anchorRun.runId.replace(/\D/g, ''))),
          );
          if (start === -1) start = all.length;
        }
        const limit = q?.limit ?? all.length;
        const page = all.slice(start, start + limit)
          .map((r) => ({ ...r, preview: taskPreview(r.task) }));
        const hasMore = start + page.length < all.length;
        return {
          runs: page,
          limit, offset: q?.offset ?? 0,
          has_more: hasMore,
          next_cursor: hasMore && page.length > 0 ? page[page.length - 1].runId : null,
        };
      },
      get: async (runId) => {
        const run = runs.get(runId);
        // Same envelope as the real client — adapters branch on status.
        if (!run) throw new Ai2ApiError(404, { error: 'not_found', message: `run not found: ${runId}` });
        return run;
      },
      create: async (input) => {
        // W1-190: новый ход присоединяется к сессии — корневому прогону
        // треда. Несуществующая → 404 session_not_found (как живой хост);
        // протухшая в моке не возникает (фикстура без часов).
        checkSession(input.sessionId);
        runSeq += 1;
        const runId = `run_mock_${runSeq}`;
        runs.set(runId, {
          runId, status: 'done', tenant: 'local',
          project: input.project ?? null, taskId: `t_${runSeq}`,
          task: input.task, config: input.config ?? 'baseline',
          mock: input.mock ?? true, agent: input.agent ?? 'builder',
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          answer: `mock answer for: ${input.task}`,
          stopReason: null, usage: null, success: true, score: null,
          createdAt: T0, finishedAt: T0 + 1,
        });
        return {
          runId, status: 'running',
          // Эхо session_id — только при явном присоединении (как у хоста).
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        };
      },
      cancel: async (runId) => {
        const run = runs.get(runId);
        if (run) run.status = 'cancelled';
        return { runId, status: 'cancelled' };
      },
      events: async (runId) => {
        const run = runs.get(runId);
        if (!run) throw new Ai2ApiError(404, { error: 'not_found', message: `run not found: ${runId}` });
        // W1-177: gaps — честный пустой список: в детерминистической
        // фикстуре пропусков seq нет (поле присутствует, список пуст).
        return { runId, status: run.status, events: runEvents(runId), gaps: [] };
      },
      result: async (runId) => {
        const run = runs.get(runId);
        if (!run) throw new Ai2ApiError(404, { error: 'not_found', message: `run not found: ${runId}` });
        return {
          runId, status: run.status,
          answer: run.answer ?? `mock answer for ${runId}`,
          score: null, verified: null, stopReason: null,
          usage: undefined, durationS: 1, config: run.config ?? 'baseline',
          createdAt: T0, finishedAt: T0 + 1,
        };
      },
      audit: async (runId) => ({ runId, events: [] }),
      // W1-173: retention-проход. Мок без часов не может доказать возраст —
      // «неизвестное ≠ старше политики»: candidates честно 0, plan пуст.
      // deleted всегда 0 — hard-delete хост не делает.
      gc: async (q) => ({
        dry_run: q?.dryRun ?? false,
        older_than_days: q?.olderThanDays ?? 30,
        keep_per_session: q?.keepPerSession ?? 20,
        candidates: 0,
        archived: 0,
        deleted: 0,
        plan: [],
      }),
    },

    chat: {
      compact: async () => {
        throw new Ai2ApiError(503, {
          error: 'unavailable',
          message: 'mock transport does not store host chat-compaction history',
        });
      },
      // W3-143: мок не хранит историю треда — отдаём честную пустую страницу,
      // а не выдуманные сообщения.
      history: async (threadId, q) => ({
        sessionId: threadId,
        messages: [],
        limit: q?.limit ?? 0,
        hasMore: false,
        nextCursor: null,
      }),
      compactionStatus: async (sessionId) => {
        if (!runs.has(sessionId)
          && ![...runs.values()].some((r) => r.sessionId === sessionId)) {
          throw new Ai2ApiError(404, { error: 'not_found', message: 'session_not_found' });
        }
        // W1-173: форма хоста — compaction + блок session (протухание по
        // TTL). Мок не хранит состояния авто-компакта и durable-записи →
        // compaction честно null (значение 'none' хост не отдаёт).
        return {
          sessionId,
          compaction: null,
          session: sessionExpiry(sessionId),
        };
      },
      compactionConfig: async () => ({
        windowTokens: null,
        reserveTokens: 16000,
        keepTokens: 15000,
        thresholdTokens: null,
      }),
      // W1-189/190/199: список сессий — агрегат по session_id (корень треда
      // считается +1, как у хоста: runs = помеченные + корневой). Сортировка
      // по последней активности, новые сверху; постранично limit/offset.
      sessions: async (q) => {
        const bySession = new Map<string, Ai2Run[]>();
        for (const r of runs.values()) {
          if (r.sessionId == null) continue;
          const list = bySession.get(r.sessionId) ?? [];
          list.push(r);
          bySession.set(r.sessionId, list);
        }
        const rows = [...bySession.entries()]
          .map(([sessionId, members]) => {
            const expiry = sessionExpiry(sessionId);
            return {
              sessionId,
              runs: members.length + 1,
              createdAt: null as string | null, // стор хоста колонку не отдаёт
              lastActivityAt: expiry.lastActivityAt,
              expired: expiry.expired,
              ttlHours: expiry.ttlHours,
              reason: expiry.reason,
            };
          })
          .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
        const limit = q?.limit ?? 50;
        const offset = q?.offset ?? 0;
        const page = rows.slice(offset, offset + limit);
        const hasMore = offset + page.length < rows.length;
        return {
          sessions: page,
          limit, offset,
          hasMore,
          nextCursor: hasMore && page.length > 0 ? page[page.length - 1].sessionId : null,
          ttlHours: 24,
        };
      },
      // POST /v1/chat/retry: message_id `<run_id>:task|:answer` → новый
      // прогон-повтор в том же треде (retry_of — реальная связь записей).
      // 422 — неверная форма; 404 message_not_found; 409 — исходный идёт /
      // сессия протухла (в моке протухание не наступает — нет часов).
      retry: async (input) => {
        const idx = input.messageId.lastIndexOf(':');
        const runId = input.messageId.slice(0, idx);
        const part = input.messageId.slice(idx + 1);
        if (idx <= 0 || (part !== 'task' && part !== 'answer')) {
          throw new Ai2ApiError(422, {
            error: 'validation_error',
            message: 'message_id должен иметь форму <run_id>:task или <run_id>:answer',
          });
        }
        const src = runs.get(runId);
        if (!src) throw new Ai2ApiError(404, { error: 'not_found', message: 'message_not_found' });
        if (src.status === 'running') {
          throw new Ai2ApiError(409, {
            error: 'conflict',
            message: 'исходный прогон ещё идёт: повтор возможен после завершения',
          });
        }
        // W1-173: повтор в протухшей сессии — 409 `session_expired: <reason>`.
        // Сессия прогона в моке: его sessionId, иначе он сам — корень треда.
        const threadSession = src.sessionId ?? src.runId;
        const expiry = sessionExpiry(threadSession);
        if (expiry.expired) {
          throw new Ai2ApiError(409, {
            error: 'conflict', message: `session_expired: ${expiry.reason}`,
          });
        }
        runSeq += 1;
        const newId = `run_mock_${runSeq}`;
        runs.set(newId, {
          runId: newId, status: 'done', tenant: 'local',
          project: src.project ?? null, taskId: `t_${runSeq}`,
          task: src.task, config: src.config ?? 'baseline',
          mock: src.mock ?? true, agent: src.agent ?? 'builder',
          parent: src.parent, retryOf: src.runId,
          ...(src.sessionId ? { sessionId: src.sessionId } : {}),
          answer: `mock answer for: ${src.task}`,
          stopReason: null, usage: null, success: true, score: null,
          createdAt: T0, finishedAt: T0 + 1,
        });
        return {
          runId: newId, retryOf: src.runId,
          sourceMessageId: input.messageId, status: 'running',
        };
      },
    },

    memory: {
      add: async (input) => {
        memSeq += 1;
        const id = `mem_${memSeq}`;
        memory.set(id, {
          id, tenant: 'local', project: input.project,
          text: input.text, meta: input.meta ?? {}, createdAt: T0,
        });
        return { id, project: input.project };
      },
      list: async (q) => [...memory.values()].filter((m) => m.project === q.project),
      search: async (q) =>
        [...memory.values()].filter((m) => m.project === q.project && m.text.includes(q.q))
          .map((m) => ({ ...m, score: 1 })),
      delete: async (itemId) => { memory.delete(itemId); },
    },

    webhooks: {
      list: async () => ({ webhooks: WEBHOOKS, events: ['run.done', 'run.error'] }),
      create: async (input) => ({
        webhookId: `wh_${WEBHOOKS.length + 1}`, url: input.url, events: input.events,
        active: true, createdAt: new Date(T0 * 1000).toISOString(),
        secret: input.secret ?? 'mock_secret',
      }),
      update: async (webhookId, patch) => {
        const base = WEBHOOKS.find((w) => w.webhookId === webhookId) ?? WEBHOOKS[0];
        return { ...base, ...patch };
      },
      delete: async () => undefined,
      deliveries: async () => ({ deliveries: [] }),
    },

    usage: {
      get: async (q) => ({
        period: q?.period ?? 'current_month', tenant: q?.tenant ?? 'local',
        runsTotal: runs.size, runsSucceeded: runs.size, runsFailed: 0,
        runsCancelled: 0, runsTimeout: 0, runsRunning: 0,
        costUsd: 0, breakdown: {}, budgetUsd: null,
      }),
    },

    keys: {
      list: async () => ({ keys: API_KEYS }),
      create: async (input) => ({
        keyId: `key_${API_KEYS.length + 1}`, name: input.name, scopes: input.scopes,
        prefix: 'ai2_mock_', status: 'active', createdAt: new Date(T0 * 1000).toISOString(),
        expiresAt: input.expiresAt ?? null, revokedAt: null, secret: 'mock_key_secret',
      }),
      delete: async () => undefined,
    },

    worker: {
      launch: async (input) => {
        if (workerUp) throw new Ai2ApiError(409, { error: 'conflict', message: 'worker уже запущен' });
        workerUp = true;
        workerRevoked = false;
        workerGrant = {
          roots: input.roots,
          ops: input.ops ?? ['read', 'list', 'stat', 'search', 'diff'],
          commands: input.commands ?? [],
          mode: input.mode ?? 'observe',
        };
        return {
          worker: workerStatus(),
          grant: {
            grantId: 'mock-grant-1', roots: workerGrant.roots, ops: [...workerGrant.ops].sort(),
            commands: workerGrant.commands, mode: workerGrant.mode as 'observe',
            expiresAt: null, revoked: false, createdAt: new Date(T0 * 1000).toISOString(),
          },
        };
      },
      status: async () => ({ worker: workerStatus() }),
      request: async (input) => {
        if (!workerUp || workerGrant == null) {
          throw new Ai2ApiError(409, { error: 'conflict', message: 'worker не запущен' });
        }
        if (workerRevoked) throw workerDenied('grant revoked');
        if (!workerGrant.ops.includes(input.op)) throw workerDenied(`op не разрешена грантом: ${input.op}`);
        const path = input.args?.path === undefined ? null : String(input.args.path);
        if (path !== null && !workerPathOk(path)) {
          throw new Ai2ApiError(403, { error: 'escape', message: `путь вне корней гранта: ${path}` });
        }
        switch (input.op) {
          case 'read': {
            const content = MOCK_WORKER_FILES[path ?? ''];
            if (content === undefined) {
              throw new Ai2ApiError(404, { error: 'not_found', message: `нет файла: ${path}` });
            }
            return { path, content, size: content.length, truncated: false };
          }
          case 'list':
            return {
              path, entries: Object.keys(MOCK_WORKER_FILES)
                .filter((k) => k.startsWith(path ?? '')),
              truncated: false,
            };
          case 'stat':
            return { path, exists: MOCK_WORKER_FILES[path ?? ''] !== undefined };
          case 'search':
            return {
              hits: Object.keys(MOCK_WORKER_FILES)
                .filter((k) => MOCK_WORKER_FILES[k].includes(String(input.args?.q ?? ''))),
              truncated: false,
            };
          case 'exec': {
            const argv = (input.args?.argv as string[] | undefined) ?? [];
            const allowed = workerGrant.commands.some(
              (c) => argv.length >= c.length && c.every((v, i) => argv[i] === v),
            );
            if (!allowed) throw workerDenied(`команда ${argv[0] ?? ''} вне списка разрешённых`);
            return { exit_code: 0, stdout: 'mock exec output', stderr: '', timed_out: false };
          }
          case 'write': {
            checkpointSeq += 1;
            const cid = `ckpt_${checkpointSeq}`;
            workerCheckpoints.set(cid, new Map(Object.entries(MOCK_WORKER_FILES)));
            return { path, written: true, checkpoint_id: cid, existed: MOCK_WORKER_FILES[path ?? ''] !== undefined };
          }
          case 'checkpoint': {
            checkpointSeq += 1;
            const cid = `ckpt_${checkpointSeq}`;
            workerCheckpoints.set(cid, new Map(Object.entries(MOCK_WORKER_FILES)));
            return { checkpoint_id: cid };
          }
          case 'list_checkpoints':
            return { checkpoints: [...workerCheckpoints.keys()] };
          case 'rollback': {
            const cid = String(input.args?.checkpoint_id ?? '');
            if (!workerCheckpoints.has(cid)) {
              throw new Ai2ApiError(404, { error: 'not_found', message: `нет checkpoint: ${cid}` });
            }
            return { checkpoint_id: cid, restored: true };
          }
          case 'diff':
            return { path, diff: `--- a/${path}\n+++ b/${path}\n`, truncated: false };
          default:
            throw new Ai2ApiError(422, { error: 'invalid', message: `неизвестная op: ${input.op}` });
        }
      },
      revoke: async () => {
        if (!workerUp) throw new Ai2ApiError(409, { error: 'conflict', message: 'worker не запущен' });
        workerRevoked = true;
        return { worker: workerStatus() };
      },
      shutdown: async () => {
        workerUp = false;
        workerGrant = null;
        return { worker: { state: 'down' as const } };
      },
    },

    images: {
      generate: async (input) => {
        const prompt = input.prompt.trim();
        if (!prompt) throw new Ai2ApiError(400, { error: 'invalid_request', message: 'prompt обязателен' });
        if (prompt.length > 600) throw new Ai2ApiError(422, { error: 'validation_error', message: 'prompt > 600' });
        if (input.model !== undefined && input.model !== 'mock/ming-image-free') {
          throw new Ai2ApiError(422, { error: 'validation_error', message: `unknown_model: ${input.model}` });
        }
        // Deterministic 1×1 PNG — mock honesty: real bytes, not a stub URL.
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const enrichedPrompt = input.enrich === false ? null : `${prompt}, neon detail`;
        return {
          imageB64: png,
          mime: 'image/png',
          bytes: 68,
          model: 'mock/ming-image-free',
          costUsd: 0,
          prompt: input.prompt,
          enrichedPrompt,
          enriched: enrichedPrompt !== null,
        };
      },
    },

    // W1 voice: deterministic fixture WAV — a real PCM16 container the
    // browser actually plays (pure tone, honestly NOT synthesized speech).
    voice: {
      list: async () => ({
        voices: [
          // Каталог один: AGENT-A на облачном Fish Audio — как у хоста без ключа.
          { id: 'fish', engine: 'fish', label: 'AGENT-A', labelEn: 'AGENT-A', available: false, reason: 'нет AI2_FISH_API_KEY (бесплатный ключ: fish.audio → API Keys)' },
        ],
        defaultVoice: 'fish',
        formats: ['wav'],
        defaultFormat: 'wav',
        stt: { supported: true, reason: null, model: 'mock-whisper:fixture' },
      }),
      speak: async (input) => {
        const text = input.text.trim();
        if (!text) throw new Ai2ApiError(422, { error: 'validation_error', message: 'empty: нечего озвучивать' });
        if (input.voice !== undefined && input.voice !== 'fish') {
          throw new Ai2ApiError(422, { error: 'validation_error', message: `unknown_voice: ${input.voice}` });
        }
        const wav = mockToneWav();
        return {
          audioB64: wav.b64,
          mime: 'audio/wav',
          bytes: wav.bytes,
          voice: input.voice ?? 'fish',
          chars: text.length,
          cached: false,
        };
      },
      // STT mock: deterministic transcript — the bytes are real, the text is
      // a fixture (no decoder in the mock; honestly labelled by the seam).
      transcribe: async (audio) => {
        if (audio.size === 0) {
          throw new Ai2ApiError(422, { error: 'validation_error', message: 'empty: пустое аудио' });
        }
        return {
          text: 'Проверь статус прогонов',
          language: 'ru',
          languageProbability: 1,
          durationS: Math.round((audio.size / 16000) * 100) / 100,
          model: 'mock-whisper:fixture',
        };
      },
    },

    // W1 telegram: honest unavailable — no live TDLib in the mock host,
    // mirroring a real host without the native build/credentials (the
    // deterministic mock adapter lives in product/data-source.ts).
    telegram: {
      status: async () => ({
        status: 'unavailable',
        authStep: 'none',
        error: 'mock: TDLib JSON-библиотека не найдена — соберите tdjson и задайте AI2_TDLIB_DLL',
      }),
      auth: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: telegram adapter unavailable' });
      },
      chats: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: telegram adapter unavailable' });
      },
      history: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: telegram adapter unavailable' });
      },
      send: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: telegram adapter unavailable' });
      },
      logout: async () => ({
        status: 'unavailable',
        authStep: 'none',
        error: 'mock: TDLib JSON-библиотека не найдена — соберите tdjson и задайте AI2_TDLIB_DLL',
      }),
    },

    // fs-access: the mock host has no real filesystem boundary — the feature
    // is honestly unsupported and every call answers like a host without fs,
    // never a fabricated validation or ticket.
    fs: {
      validate: async () => ({
        ok: false,
        reason: 'mock: файловый контур недоступен — нет хостовой ФС',
      }),
      requests: async () => [],
      approve: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: fs-заявки недоступны — нет хостовой ФС' });
      },
      deny: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: fs-заявки недоступны — нет хостовой ФС' });
      },
    },

    // Wave XI W1 — шина окон: у mock-хоста нет реального D:/<repo>\bus —
    // отвечаем как живой хост без AI2_NEXUS_BUS (503 + причина), живые
    // окна не имитируются.
    bus: {
      sessions: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: шина окон не настроена (AI2_NEXUS_BUS)' });
      },
      delegate: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: шина окон не настроена (AI2_NEXUS_BUS)' });
      },
      delegation: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: шина окон не настроена (AI2_NEXUS_BUS)' });
      },
      // XIV: у mock-хоста нет каталога шины — как живой хост без
      // AI2_NEXUS_BUS: 200 + status unknown + пустые списки.
      overview: async () => ({
        status: 'unknown' as const,
        generatedAt: 0,
        windows: [],
        watch: [],
      }),
    },

    // XIV — SDK-подтверждения: у mock-хоста нет AI2_SDK_ENABLED — отвечаем
    // как живой хост без флага (503 + причина verbatim), карточки и
    // решения не имитируются.
    sdk: {
      confirmations: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      auditLog: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      confirm: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      sessions: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      // XV: учёт сессии/ассистентов — тот же выключенный канал.
      sessionUsage: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      assistantUsage: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      patchSession: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      forkSession: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      run: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      delegations: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      delegate: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      cancelRun: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      handoffs: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      createHandoff: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      resolveHandoff: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      rules: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      usage: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      checkpoints: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
      rewind: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
      },
    },

    // XIV — каталог MCP: у mock-хоста нет mcp_servers.json — живой хост в
    // этом случае отвечает {servers:[], configured:false} (без ошибки);
    // вызов инструмента — через канал подтверждений, которого в моке нет.
    mcp: {
      servers: async () => ({ configured: false, servers: [], error: null }),
      call: async () => {
        throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: канал подтверждений (fs_requests) недоступен' });
      },
    },

    // Wave XII W1 — каталог prompt-файлов: у mock-хоста нет AI2_PROMPTS_DIR —
    // живой хост в этом случае отвечает пустым списком, мок повторяет его.
    // XIV: CRUD сохранённых сценариев — за AI2_SDK_ENABLED → 503 verbatim.
    prompts: async () => ({ prompts: [] }),
    createPrompt: async () => {
      throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
    },
    updatePrompt: async () => {
      throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
    },
    deletePrompt: async () => {
      throw new Ai2ApiError(503, { error: 'service_unavailable', message: 'mock: SDK-канал выключен (AI2_SDK_ENABLED)' });
    },

    // XVI — маршрутов /v1/neu/plugins у мока нет (как и у живого хоста
    // до задачи W1): 404 verbatim, инвентарь не имитируется.
    neuPlugins: {
      list: async () => {
        throw new Ai2ApiError(404, { error: 'not_found', message: 'mock: маршрут /v1/neu/plugins не объявлен' });
      },
      setEnabled: async () => {
        throw new Ai2ApiError(404, { error: 'not_found', message: 'mock: маршрут /v1/neu/plugins не объявлен' });
      },
      setRowEnabled: async () => {
        throw new Ai2ApiError(404, { error: 'not_found', message: 'mock: маршрут /v1/neu/plugins не объявлен' });
      },
    },
  };
}

/** 300ms 440Hz sine, PCM16 mono 24kHz — deterministic bytes, no engine. */
function mockToneWav(): { b64: string; bytes: number } {
  const rate = 24000;
  const n = Math.floor(rate * 0.3);
  const data = new Uint8Array(n * 2);
  const view = new DataView(data.buffer);
  for (let i = 0; i < n; i++) {
    view.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), true);
  }
  const header = new Uint8Array(44);
  const hv = new DataView(header.buffer);
  const text = (s: string, off: number) => { for (let i = 0; i < s.length; i++) header[off + i] = s.charCodeAt(i); };
  text('RIFF', 0); hv.setUint32(4, 36 + data.length, true); text('WAVE', 8);
  text('fmt ', 12); hv.setUint32(16, 16, true); hv.setUint16(20, 1, true); hv.setUint16(22, 1, true);
  hv.setUint32(24, rate, true); hv.setUint32(28, rate * 2, true); hv.setUint16(32, 2, true); hv.setUint16(34, 16, true);
  text('data', 36); hv.setUint32(40, data.length, true);
  const all = new Uint8Array(44 + data.length);
  all.set(header); all.set(data, 44);
  let bin = '';
  for (const b of all) bin += String.fromCharCode(b);
  return { b64: btoa(bin), bytes: all.length };
}
