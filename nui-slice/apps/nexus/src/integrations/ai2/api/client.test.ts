import { describe, expect, it } from 'vitest';
import { createAi2Client } from './client';
import { Ai2ApiError, Ai2NetworkError } from './errors';
import type { Ai2Run } from '../contracts/runs';

type Seen = { url: string; method: string; headers: Headers; body: string | null };

/** fetch stub: records the request, responds with the queued payload. */
function stubFetch(responses: Array<{ status?: number; body?: unknown }>) {
  const seen: Seen[] = [];
  const queue = [...responses];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    seen.push({
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: init?.body === undefined ? null : String(init.body),
    });
    const next = queue.shift() ?? { status: 200, body: {} };
    return new Response(
      next.body === undefined ? null : JSON.stringify(next.body),
      {
        status: next.status ?? 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  };
  return { seen, fetchImpl: fetchImpl as typeof fetch };
}

const BASE = 'http://ai2.test';

describe('createAi2Client (Task 5)', () => {
  it('maps a run without inventing optional fields', async () => {
    const { fetchImpl } = stubFetch([{
      body: {
        run_id: 'r1', tenant: 'local', project: null, task_id: 't1',
        config: 'baseline', task_text: 'do', mock: 0, agent: null,
        parent: null, status: 'running', answer: null, stop_reason: null,
        usage: null, success: null, score: null,
        created_at: 1000.5, finished_at: null,
      },
    }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl });
    const run: Ai2Run = await client.runs.get('r1');
    expect(run).toMatchObject({ runId: 'r1', status: 'running', config: 'baseline' });
    expect(run.agent).toBeUndefined();
    expect(run.createdAt).toBe(1000.5);
    expect(run.mock).toBe(false);
  });

  it('sends Authorization only when apiKey exists', async () => {
    const anon = stubFetch([{ body: { status: 'healthy', components: {} } }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: anon.fetchImpl });
    await client.health();
    expect(anon.seen[0].headers.has('Authorization')).toBe(false);
    expect(anon.seen[0].headers.has('X-API-Key')).toBe(false);

    const authed = stubFetch([{ body: { status: 'healthy', components: {} } }]);
    const client2 = createAi2Client({
      baseUrl: BASE, apiKey: 'k_test_0123456789', fetchImpl: authed.fetchImpl,
    });
    await client2.health();
    expect(authed.seen[0].headers.get('Authorization')).toBe('Bearer k_test_0123456789');
  });

  it('serializes create-run input to the wire shape (snake_case)', async () => {
    const { seen, fetchImpl } = stubFetch([{ status: 202, body: { run_id: 'r9', status: 'running' } }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl });
    const created = await client.runs.create({
      task: 'summarize', config: 'memory', project: 'nexus', useMemory: true,
      model: 'openrouter/qwen-3', maxCostUsd: 0.5, priority: 5,
      dependsOn: ['r1', 'r2'], agent: 'builder', maxDurationS: 300,
      idempotencyKey: 'idem-1',
    });
    expect(created).toEqual({ runId: 'r9', status: 'running' });
    const req = seen[0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`${BASE}/v1/runs`);
    expect(req.headers.get('Idempotency-Key')).toBe('idem-1');
    expect(JSON.parse(req.body!)).toEqual({
      task: 'summarize', config: 'memory', mock: false, project: 'nexus',
      use_memory: true, model: 'openrouter/qwen-3', max_cost_usd: 0.5,
      priority: 5, depends_on: ['r1', 'r2'], agent: 'builder',
      max_duration_s: 300,
    });
  });

  it('maps W1 chat compact and status requests to their real wire contracts', async () => {
    const { seen, fetchImpl } = stubFetch([
      {
        body: {
          compacted: true,
          compact_id: 'compact-r1',
          thread_id: 'thread-r1',
          summary: 'Host summary',
          covers_message_ids: ['r1:task', 'r1:answer'],
          kept_message_ids: [],
          created_at: '2026-10-19T12:00:00Z',
        },
      },
      {
        body: {
          session_id: 'r1',
          compaction: {
            compaction: 'triggered',
            triggered: true,
            used_tokens: 34000,
            threshold_tokens: 32000,
            usage_method: 'run_usage',
          },
        },
      },
      {
        body: {
          window_tokens: 100000,
          reserve_tokens: 16000,
          keep_tokens: 15000,
          threshold_tokens: 84000,
        },
      },
    ]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl });
    await expect(client.chat.compact({
      runIds: ['r1', 'r2'],
      maxTokens: 6000,
      maxMessages: 20,
      keepTokens: 1200,
    })).resolves.toEqual({
      compacted: true,
      compactId: 'compact-r1',
      threadId: 'thread-r1',
      summary: 'Host summary',
      coversMessageIds: ['r1:task', 'r1:answer'],
      keptMessageIds: [],
      createdAt: '2026-10-19T12:00:00Z',
    });
    await expect(client.chat.compactionStatus('r1')).resolves.toEqual({
      sessionId: 'r1',
      compaction: 'triggered',
      triggered: true,
      usedTokens: 34000,
      thresholdTokens: 32000,
      usageMethod: 'run_usage',
    });
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url).toBe(`${BASE}/v1/chat/compact`);
    expect(JSON.parse(seen[0].body!)).toEqual({
      run_ids: ['r1', 'r2'],
      max_tokens: 6000,
      max_messages: 20,
      keep_tokens: 1200,
    });
    expect(seen[1].method).toBe('GET');
    expect(seen[1].url).toBe(`${BASE}/v1/chat/compaction-status?session_id=r1`);
    await expect(client.chat.compactionConfig()).resolves.toEqual({
      windowTokens: 100000,
      reserveTokens: 16000,
      keepTokens: 15000,
      thresholdTokens: 84000,
    });
    expect(seen[2].url).toBe(`${BASE}/v1/chat/compaction-config`);
  });

  it('maps W3 chat history query and effective compact entries', async () => {
    const { seen, fetchImpl } = stubFetch([{
      body: {
        session_id: 'root',
        limit: 50,
        has_more: true,
        next_cursor: 'r2:task',
        messages: [
          { type: 'message', id: 'r2:task', role: 'user', text: 'older', created_at: 100, usage: null },
          { type: 'compact', compact_id: 'compact-1', summary: 'covered', covers_message_ids: ['r1:task'], created_at: '2026-10-19T12:00:00Z' },
        ],
      },
    }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl });
    await expect(client.chat.history('root', {
      beforeId: 'r3:task', limit: 50, effective: true,
    })).resolves.toEqual({
      sessionId: 'root',
      limit: 50,
      hasMore: true,
      nextCursor: 'r2:task',
      messages: [
        { type: 'message', id: 'r2:task', role: 'user', text: 'older', createdAt: 100, usageTokens: null },
        {
          type: 'compact', id: 'compact-1', summary: 'covered',
          coversMessageIds: ['r1:task'], createdAt: '2026-10-19T12:00:00Z',
        },
      ],
    });
    const url = new URL(seen[0].url);
    expect(url.pathname).toBe('/v1/chat/history');
    expect(url.searchParams.get('session_id')).toBe('root');
    expect(url.searchParams.get('before_id')).toBe('r3:task');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('effective')).toBe('1');
  });

  it('throws Ai2ApiError carrying the error envelope', async () => {
    const { fetchImpl } = stubFetch([{
      status: 404,
      body: { error: 'not_found', message: 'прогон не найден', detail: 'прогон не найден', request_id: 'req_abc' },
    }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl });
    const err = await client.runs.get('missing').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Ai2ApiError);
    const apiErr = err as Ai2ApiError;
    expect(apiErr.status).toBe(404);
    expect(apiErr.code).toBe('not_found');
    expect(apiErr.requestId).toBe('req_abc');
  });

  it('exposes retryAfterS on 429', async () => {
    const { fetchImpl } = stubFetch([{
      status: 429,
      body: {
        error: 'rate_limit_exceeded', message: 'лимит', detail: 'лимит',
        request_id: 'req_x', retry_after_s: 12,
      },
    }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl });
    const err = await client.runs.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Ai2ApiError);
    expect((err as Ai2ApiError).retryAfterS).toBe(12);
  });

  it('maps list endpoints with pagination and filters', async () => {
    const { seen, fetchImpl } = stubFetch([{ body: { runs: [], limit: 10, offset: 40 } }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl });
    const page = await client.runs.list({ limit: 10, offset: 40, status: 'running', project: 'nexus' });
    expect(page).toEqual({ runs: [], limit: 10, offset: 40 });
    const url = new URL(seen[0].url);
    expect(url.pathname).toBe('/v1/runs');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('offset')).toBe('40');
    expect(url.searchParams.get('status')).toBe('running');
    expect(url.searchParams.get('project')).toBe('nexus');
  });

  it('maps agent records (snake → camel, timestamps preserved)', async () => {
    const { fetchImpl } = stubFetch([{
      body: {
        tenant: 'local', name: 'builder', description: 'd', config: 'screen',
        capabilities: ['fs.read'], task_prefix: 'P:', max_cost_usd: 1.5,
        created_at: 100, updated_at: 200,
      },
    }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl });
    const agent = await client.agents.get('builder');
    expect(agent.name).toBe('builder');
    expect(agent.taskPrefix).toBe('P:');
    expect(agent.maxCostUsd).toBe(1.5);
    expect(agent.createdAt).toBe(100);
    expect(agent.updatedAt).toBe(200);
  });

  it('keeps memory meta payload keys untouched (no deep rename)', async () => {
    const { fetchImpl } = stubFetch([{
      body: {
        project: 'nexus',
        items: [{
          id: 'm1', tenant: 'local', project: 'nexus', text: 'note',
          meta: { snake_key: 1, nested_dict: { inner_key: true } },
          created_at: 50, score: null,
        }],
      },
    }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl });
    const items = await client.memory.list({ project: 'nexus' });
    const item = items[0];
    expect(item.createdAt).toBe(50);
    expect(item.meta).toEqual({ snake_key: 1, nested_dict: { inner_key: true } });
  });

  it('resolves 204 deletes without a body parse', async () => {
    const { fetchImpl } = stubFetch([{ status: 204, body: undefined }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl });
    await expect(client.agents.delete('builder')).resolves.toBeUndefined();
  });

  it('system endpoints hit their canonical paths', async () => {
    const { seen, fetchImpl } = stubFetch([
      { body: { status: 'healthy', components: { store: { ok: true } } } },
      { body: { ts: '2026-10-12T00:00:00Z', system: {}, pool: {}, tenant: {}, version: '0.0' } },
      { body: { models: [{ id: 'default', label: 'l', free: null }], default: 'default' } },
      { body: { presets: [{ name: 'baseline', flags: {} }], default: 'baseline' } },
      { body: { processes: [] } },
    ]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl });
    await client.health();
    await client.metrics();
    await client.models.list();
    await client.presets.list();
    await client.processes.list();
    expect(seen.map((r) => new URL(r.url).pathname)).toEqual([
      '/v1/health', '/v1/metrics', '/v1/models', '/v1/presets', '/v1/processes',
    ]);
  });

  it('maps /v1/usage wire shape (snake_case counters + breakdown)', async () => {
    const { seen, fetchImpl } = stubFetch([{
      body: {
        period: 'current_month', tenant: 'local', runs_total: 9, runs_succeeded: 7,
        runs_failed: 1, runs_cancelled: 1, runs_timeout: 0, runs_running: 0,
        cost_usd: 0.42, breakdown: { baseline: { runs: 9, cost_usd: 0.42 } }, budget_usd: 5,
      },
    }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl });
    const report = await client.usage.get({ period: 'current_month' });
    expect(report.runsTotal).toBe(9);
    expect(report.runsSucceeded).toBe(7);
    expect(report.costUsd).toBe(0.42);
    expect(report.budgetUsd).toBe(5);
    expect(report.breakdown.baseline).toEqual({ runs: 9, cost_usd: 0.42 });
    expect(new URL(seen[0].url).searchParams.get('period')).toBe('current_month');
  });

  it('maps webhooks list/create/deliveries (iso timestamps, secret on create only)', async () => {
    const { seen, fetchImpl } = stubFetch([
      { body: { webhooks: [{ webhook_id: 'w1', url: 'https://h.test/x', events: ['run.done'], active: true, created_at: '2026-10-12T00:00:00Z' }], events: ['run.done', 'run.error'] } },
      { status: 201, body: { webhook_id: 'w2', url: 'https://h.test/y', events: ['run.error'], active: true, created_at: '2026-10-12T00:01:00Z', secret: 's_0123456789abcdef' } },
      { body: { deliveries: [{ delivery_id: 'd1', event: 'run.done', status: 'delivered', attempts: 1, next_at: null, last_code: 200, last_error: null, created_at: '2026-10-12T00:02:00Z', finished_at: '2026-10-12T00:02:01Z' }] } },
    ]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl });
    const list = await client.webhooks.list();
    expect(list.webhooks[0]).toMatchObject({ webhookId: 'w1', active: true });
    expect(list.events).toContain('run.done');
    const created = await client.webhooks.create({ url: 'https://h.test/y', events: ['run.error'] });
    expect(created.secret).toBe('s_0123456789abcdef');
    const del = await client.webhooks.deliveries('w1');
    expect(del.deliveries[0].deliveryId).toBe('d1');
    expect(del.deliveries[0].finishedAt).toBe('2026-10-12T00:02:01Z');
    expect(seen.map((r) => new URL(r.url).pathname)).toEqual([
      '/v1/webhooks', '/v1/webhooks', '/v1/webhooks/w1/deliveries',
    ]);
  });

  it('webhook PATCH omits undefined fields (server 422s on explicit nulls)', async () => {
    const { seen, fetchImpl } = stubFetch([{ body: { webhook_id: 'w1', url: 'u', events: [], active: false, created_at: 't' } }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl });
    await client.webhooks.update('w1', { active: false });
    expect(JSON.parse(seen[0].body!)).toEqual({ active: false });
  });
});

describe('network/timeout errors (Task 8 seam: offline, abort, timeout)', () => {
  it('wraps a fetch TypeError as Ai2NetworkError kind=offline', async () => {
    const fetchImpl = () => Promise.reject(new TypeError('fetch failed'));
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: fetchImpl as typeof fetch });
    const err = await client.health().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Ai2NetworkError);
    expect((err as Ai2NetworkError).kind).toBe('offline');
  });

  it('caller AbortSignal aborts the request with kind=aborted', async () => {
    const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      const fire = () => reject(init!.signal!.reason ?? new DOMException('aborted', 'AbortError'));
      if (init?.signal?.aborted) return fire();
      init?.signal?.addEventListener('abort', fire);
    });
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: fetchImpl as typeof fetch });
    const ac = new AbortController();
    ac.abort();
    const err = await client.health({ signal: ac.signal }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Ai2NetworkError);
    expect((err as Ai2NetworkError).kind).toBe('aborted');
  });

  it('timeoutMs aborts a stalled request with kind=timeout', async () => {
    const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(init.signal!.reason ?? new DOMException('aborted', 'AbortError'));
      });
    });
    const client = createAi2Client({ baseUrl: BASE, timeoutMs: 5, fetchImpl: fetchImpl as typeof fetch });
    const err = await client.health().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Ai2NetworkError);
    expect((err as Ai2NetworkError).kind).toBe('timeout');
  });

  it('per-call timeoutMs overrides the client default', async () => {
    const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(init.signal!.reason ?? new DOMException('aborted', 'AbortError'));
      });
    });
    const client = createAi2Client({ baseUrl: BASE, timeoutMs: 60_000, fetchImpl: fetchImpl as typeof fetch });
    const err = await client.health({ timeoutMs: 5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Ai2NetworkError);
    expect((err as Ai2NetworkError).kind).toBe('timeout');
  });
});

describe('worker endpoints (W1-07..09)', () => {
  it('status maps the honest not-launched answer', async () => {
    const { fetchImpl } = stubFetch([{ body: { worker: { state: 'down', launched: false } } }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl });
    const { worker } = await client.worker.status();
    expect(worker.state).toBe('down');
    expect(worker.launched).toBe(false);
    expect(worker.grant).toBeUndefined();
  });

  it('launch sends ttl_s and maps the grant view (snake → camel)', async () => {
    const stub = stubFetch([{
      status: 201,
      body: {
        worker: {
          state: 'ready', pid: 4321, restarts: 0, max_restarts: 2, uptime_s: 0.4,
          grant: {
            grant_id: 'g1', mode: 'observe', roots: ['D:/ws'],
            ops: ['list', 'read'], expires_at: null, revoked: false,
          },
        },
        grant: {
          grant_id: 'g1', roots: ['D:/ws'], ops: ['list', 'read'],
          commands: [['python', '-m']], mode: 'observe',
          expires_at: '2026-10-19T10:00:00Z', revoked: false,
          created_at: '2026-10-19T09:00:00Z',
        },
      },
    }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    const out = await client.worker.launch({ roots: ['D:/ws'], mode: 'observe', ttlS: 3600 });
    expect(JSON.parse(stub.seen[0].body!)).toMatchObject({ roots: ['D:/ws'], mode: 'observe', ttl_s: 3600 });
    expect(out.worker.state).toBe('ready');
    expect(out.worker.grant?.grantId).toBe('g1');
    expect(out.grant.commands).toEqual([['python', '-m']]);
    expect(out.grant.expiresAt).toBe('2026-10-19T10:00:00Z');
  });

  it('grant mapping tolerates legacy epoch-float expires_at (older hosts)', async () => {
    const stub = stubFetch([{
      status: 201,
      body: {
        worker: { state: 'ready', pid: 1, restarts: 0, max_restarts: 2, uptime_s: 0.1 },
        grant: {
          grant_id: 'g2', roots: ['D:/ws'], ops: ['read'], commands: [],
          mode: 'observe', expires_at: 1760918400.5, revoked: false,
          created_at: 1760918000.0,
        },
      },
    }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    const out = await client.worker.launch({ roots: ['D:/ws'] });
    expect(out.grant.expiresAt).toBe(new Date(1760918400.5 * 1000).toISOString());
    expect(out.grant.createdAt).toBe(new Date(1760918000 * 1000).toISOString());
  });

  it('request posts op/args/timeout_s and returns the raw result', async () => {
    const stub = stubFetch([{ body: { ok: true, result: { content: 'hello' } } }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    const result = await client.worker.request({ op: 'read', args: { path: 'a.txt' }, timeoutS: 30 });
    expect(JSON.parse(stub.seen[0].body!)).toEqual({ op: 'read', args: { path: 'a.txt' }, timeout_s: 30 });
    expect(result).toEqual({ content: 'hello' });
  });

  it('revoke and shutdown hit their routes and map status', async () => {
    const stub = stubFetch([
      { body: { worker: { state: 'ready', pid: 9 } } },
      { body: { worker: { state: 'down' } } },
    ]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    const r = await client.worker.revoke();
    const s = await client.worker.shutdown();
    expect(stub.seen.map((x) => `${x.method} ${x.url}`)).toEqual([
      `POST ${BASE}/v1/worker/revoke`,
      `POST ${BASE}/v1/worker/shutdown`,
    ]);
    expect(r.worker.state).toBe('ready');
    expect(s.worker.state).toBe('down');
  });
});

describe('image generation endpoint (INT-23)', () => {
  it('posts snake_case body and maps the image response', async () => {
    const stub = stubFetch([{
      body: {
        image_b64: 'aVBORw==', mime: 'image/png', bytes: 68,
        model: 'm/free', cost_usd: 0.0, prompt: 'cat',
        enriched_prompt: 'a red cat', enriched: true,
      },
    }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    const img = await client.images.generate({ prompt: 'cat', model: 'm/free', enrich: true });
    expect(stub.seen[0].method).toBe('POST');
    expect(stub.seen[0].url).toBe(`${BASE}/v1/images/generate`);
    expect(JSON.parse(stub.seen[0].body ?? 'null')).toEqual(
      { prompt: 'cat', model: 'm/free', enrich: true });
    expect(img).toEqual({
      imageB64: 'aVBORw==', mime: 'image/png', bytes: 68,
      model: 'm/free', costUsd: 0.0, prompt: 'cat',
      enrichedPrompt: 'a red cat', enriched: true,
    });
  });

  it('omits optional fields and keeps costUsd null when unreported', async () => {
    const stub = stubFetch([{
      body: {
        image_b64: 'aVBORw==', mime: 'image/png', bytes: 68,
        model: 'm/free', cost_usd: null, prompt: 'cat',
        enriched_prompt: null, enriched: false,
      },
    }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    const img = await client.images.generate({ prompt: 'cat' });
    expect(JSON.parse(stub.seen[0].body ?? 'null')).toEqual({ prompt: 'cat' });
    expect(img.costUsd).toBeNull();
    expect(img.enriched).toBe(false);
  });
});

describe('fs-access seam (fs-dispatch 2026-10-20)', () => {
  it('runs.create wires fsPolicy → fs_policy (snake_case, request_writes)', async () => {
    const stub = stubFetch([{ body: { run_id: 'r1', status: 'running' } }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    await client.runs.create({
      task: 'запиши',
      fsPolicy: {
        mode: 'read_only',
        roots: [{ id: 'nexus', path: 'D:/<repo>', access: 'rw' }],
        requestWrites: true,
      },
    });
    expect(JSON.parse(stub.seen[0].body ?? '{}')).toEqual({
      task: 'запиши',
      config: 'baseline',
      mock: false,
      fs_policy: {
        mode: 'read_only',
        roots: [{ id: 'nexus', path: 'D:/<repo>', access: 'rw' }],
        request_writes: true,
      },
    });
  });

  it('runs.create без fsPolicy — поле fs_policy не уходит', async () => {
    const stub = stubFetch([{ body: { run_id: 'r1', status: 'running' } }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    await client.runs.create({ task: 'x' });
    expect(JSON.parse(stub.seen[0].body ?? '{}').fs_policy).toBeUndefined();
  });

  it('fs.validate posts {path} и мапит ok/reason/path verbatim', async () => {
    const stub = stubFetch([{ body: { ok: false, reason: 'не директория: D:/x.txt' } }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    const r = await client.fs.validate('D:/x.txt');
    expect(stub.seen[0].url).toBe(`${BASE}/v1/fs/validate`);
    expect(JSON.parse(stub.seen[0].body ?? '{}')).toEqual({ path: 'D:/x.txt' });
    expect(r).toEqual({ ok: false, reason: 'не директория: D:/x.txt', path: undefined });
  });

  it('fs.requests мапит фильтры в query и snake→camel в записях', async () => {
    const stub = stubFetch([{
      body: {
        requests: [{
          id: 'fsr-1', tenant: 'local', run_id: 'run-9', root: 'nexus',
          path: 'docs/NOTE.md', op: 'write', size: 128, sha256: 'ab12',
          preview: 'line 1', status: 'pending', created_at: 1000, resolved_at: null,
        }],
      },
    }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    const list = await client.fs.requests({ status: 'pending', runId: 'run-9', limit: 5 });
    expect(stub.seen[0].url).toBe(`${BASE}/v1/fs/requests?status=pending&run_id=run-9&limit=5`);
    expect(list[0]).toEqual({
      id: 'fsr-1', runId: 'run-9', root: 'nexus', path: 'docs/NOTE.md',
      op: 'write', size: 128, sha256: 'ab12', preview: 'line 1',
      status: 'pending', createdAt: 1000, resolvedAt: null,
    });
  });

  it('fs.approve/deny — POST по id, ответ маппится в запись', async () => {
    const stub = stubFetch([
      { body: { request: { id: 'fsr-1', run_id: 'r', root: 'n', path: 'a.md', op: 'write', size: 1, sha256: 's', preview: '', status: 'approved', created_at: 1, resolved_at: 2 } } },
      { body: { request: { id: 'fsr-2', run_id: 'r', root: 'n', path: 'b.md', op: 'write', size: 1, sha256: 's', preview: '', status: 'denied', created_at: 1, resolved_at: 3 } } },
    ]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    const a = await client.fs.approve('fsr-1');
    expect(stub.seen[0].url).toBe(`${BASE}/v1/fs/requests/fsr-1/approve`);
    expect(stub.seen[0].method).toBe('POST');
    expect(a.status).toBe('approved');
    const d = await client.fs.deny('fsr-2');
    expect(stub.seen[1].url).toBe(`${BASE}/v1/fs/requests/fsr-2/deny`);
    expect(d.status).toBe('denied');
  });

  it('neuPlugins maps the W1 inventory contract without fabricating nullable fields', async () => {
    const stub = stubFetch([{
      body: {
        plugins: [{
          id: 'local.weather', version: '0.2.0', title: null, description: null,
          icon: null, source: 'local', enabled: false, status: 'disabled',
          overriddenBy: null, errors: null, permissions: null, contributes: null,
          rows: [{ id: 'weather-card', slot: 'home.widgets', enabled: false }],
          clientEntry: null, clientHash: null, hasHostEntry: false,
        }],
        recovery: false,
        sources: [{ source: 'local', path: 'D:/plugins' }],
      },
    }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    const inventory = await client.neuPlugins.list();
    expect(stub.seen[0].url).toBe(`${BASE}/v1/neu/plugins`);
    expect(inventory).toEqual({
      recovery: false,
      sources: [{ source: 'local', path: 'D:/plugins' }],
      plugins: [{
        id: 'local.weather', version: '0.2.0', title: null, description: null,
        icon: null, kind: 'local', enabled: false, status: 'disabled',
        overriddenBy: null, errors: null, permissions: null, contributes: null,
        rows: [{ rowId: 'weather-card', slot: 'home.widgets', title: null, enabled: false }],
        clientEntry: null, clientHash: null, hasHostEntry: false,
      }],
    });
  });

  it('neuPlugins toggles use W1 POST /toggle routes and unwrap {plugin}', async () => {
    const plugin = {
      id: 'local.weather', version: '0.2.0', title: 'Погода', description: null,
      icon: null, source: 'local', enabled: true, status: 'active',
      overriddenBy: null, errors: null, permissions: null, contributes: null,
      rows: [{ id: 'weather-card', slot: 'home.widgets', enabled: true }],
      clientEntry: 'client.js', clientHash: 'sha256:abc', hasHostEntry: false,
    };
    const stub = stubFetch([{ body: { plugin } }, { body: { plugin } }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    await client.neuPlugins.setEnabled('local.weather', true);
    await client.neuPlugins.setRowEnabled('local.weather', 'weather-card', true);
    expect(stub.seen.map((r) => [r.method, r.url, JSON.parse(r.body ?? '{}')])).toEqual([
      ['POST', `${BASE}/v1/neu/plugins/local.weather/toggle`, { enabled: true }],
      ['POST', `${BASE}/v1/neu/plugins/local.weather/rows/weather-card/toggle`, { enabled: true }],
    ]);
  });

  it('sdk.auditLog maps the W1 journal and keeps unknown evidence null', async () => {
    const stub = stubFetch([{
      body: {
        entries: [{
          id: 'audit-1', ts: 1792345678.12, actor: 'local', runId: 'sdk-run-1',
          callId: 'call-1', tool: 'plugin_manager.install_bundle',
          decision: 'deny', reason: 'таймаут подтверждения',
          initiator: 'sdk-run-1', source: 'D:/incoming/weather', sha256: 'sha256:abc',
        }],
        total: 1, limit: 100, offset: 0,
      },
    }]);
    const client = createAi2Client({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    const page = await client.sdk.auditLog({ limit: 100, offset: 0 });
    expect(stub.seen[0].url).toBe(`${BASE}/v1/sdk/audit?limit=100&offset=0`);
    expect(page.entries[0]).toEqual({
      id: 'audit-1', ts: 1792345678.12, actor: 'local', runId: 'sdk-run-1',
      callId: 'call-1', tool: 'plugin_manager.install_bundle',
      decision: 'deny', reason: 'таймаут подтверждения',
      initiator: 'sdk-run-1', source: 'D:/incoming/weather', sha256: 'sha256:abc',
    });
  });
});
