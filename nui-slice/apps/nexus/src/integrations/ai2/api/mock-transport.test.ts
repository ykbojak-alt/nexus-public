import { describe, expect, it } from 'vitest';
import { createMockAi2Client } from './mock-transport';

describe('createMockAi2Client (deterministic transport for backend-less dev)', () => {
  it('serves deterministic fixtures for agents, models, presets, health', async () => {
    const client = createMockAi2Client();
    const agents = await client.agents.list();
    expect(agents.agents.length).toBeGreaterThan(0);
    expect(agents.agents[0].name).toBe('builder');
    const models = await client.models.list();
    expect(models.models.map((m) => m.id)).toContain('default');
    const presets = await client.presets.list();
    expect(presets.default).toBe('baseline');
    const health = await client.health();
    expect(health.status).toBe('healthy');
    // Same call twice → identical payload (determinism).
    expect(await client.agents.list()).toEqual(agents);
  });

  it('creates a run that completes deterministically end-to-end', async () => {
    const client = createMockAi2Client();
    const ref = await client.runs.create({ task: 'summarize', agent: 'builder' });
    expect(ref.runId).toBe('run_mock_1');
    const run = await client.runs.get(ref.runId);
    expect(run.status).toBe('done');
    const result = await client.runs.result(ref.runId);
    expect(result.answer).toBeTruthy();
    const page = await client.runs.events(ref.runId);
    expect(page.events.at(-1)?.type).toBe('end');
  });

  it('memory add/list round-trips within the mock store', async () => {
    const client = createMockAi2Client();
    const added = await client.memory.add({ project: 'nexus', text: 'note-1' });
    const items = await client.memory.list({ project: 'nexus' });
    expect(items.map((i) => i.id)).toContain(added.id);
    expect(items.find((i) => i.id === added.id)?.text).toBe('note-1');
  });

  it('GET /v1/runs отвечает с фильтрами (agent/parent/project/status), как живой хост', async () => {
    const client = createMockAi2Client();
    const a = await client.runs.create({ task: 'задача A', agent: 'builder', project: 'nexus' });
    const b = await client.runs.create({ task: 'задача B', agent: 'coder', project: 'ai2' });

    // Порядок хоста — created_at DESC, rowid DESC: новые сверху.
    expect((await client.runs.list()).runs.map((r) => r.runId)).toEqual([b.runId, a.runId]);
    expect((await client.runs.list({ agent: 'coder' })).runs.map((r) => r.runId)).toEqual([b.runId]);
    expect((await client.runs.list({ project: 'ai2' })).runs.map((r) => r.runId)).toEqual([b.runId]);
    expect((await client.runs.list({ status: 'done' })).runs.map((r) => r.runId)).toEqual([b.runId, a.runId]);
    expect((await client.runs.list({ status: 'running' })).runs).toEqual([]);
    // Неизвестный фильтр не должен ломать выдачу.
    expect((await client.runs.list({ parent: 'run-nope' })).runs).toEqual([]);
  });

  // — Волна XXIX: зеркало контракта хоста W1-175…W1-200 ————————

  it('GET /v1/runs: preview у прогона + пагинация before/has_more/next_cursor, как у хоста', async () => {
    const client = createMockAi2Client();
    const longTask = `длинная задача ${'x'.repeat(300)}`;
    const a = await client.runs.create({ task: 'первая', agent: 'builder' });
    const b = await client.runs.create({ task: 'вторая', agent: 'builder' });
    const c = await client.runs.create({ task: longTask, agent: 'builder' });

    const p1 = await client.runs.list({ limit: 2 });
    expect(p1.runs.map((r) => r.runId)).toEqual([c.runId, b.runId]);
    expect(p1.has_more).toBe(true);
    expect(p1.next_cursor).toBe(b.runId);
    // preview — однострочный, ≤161 символа, с многоточием при усечении.
    expect(p1.runs[0].preview).toMatch(/…$/);
    expect(p1.runs[0].preview!.length).toBeLessThanOrEqual(161);
    expect(p1.runs[1].preview).toBe('вторая');

    const p2 = await client.runs.list({ limit: 2, before: p1.next_cursor! });
    expect(p2.runs.map((r) => r.runId)).toEqual([a.runId]);
    expect(p2.has_more).toBe(false);
    expect(p2.next_cursor).toBeNull();

    // Курсор — позиция во всём сторе: фильтр не двигает якорь.
    const filtered = await client.runs.list({ agent: 'builder', before: c.runId });
    expect(filtered.runs.map((r) => r.runId)).toEqual([b.runId, a.runId]);

    // Ошибки хоста verbatim: неизвестный курсор → 404, before+offset → 422.
    await expect(client.runs.list({ before: 'run_nope' }))
      .rejects.toMatchObject({ status: 404, message: 'run_not_found' });
    await expect(client.runs.list({ before: c.runId, offset: 1 }))
      .rejects.toMatchObject({ status: 422 });
  });

  it('GET /v1/runs?session_id= фильтрует по треду, как хост', async () => {
    const client = createMockAi2Client();
    const root = await client.runs.create({ task: 'корень', agent: 'builder' });
    const other = await client.runs.create({ task: 'другой тред', agent: 'builder' });
    const turn = await client.runs.create({ task: 'второй ход', agent: 'builder', sessionId: root.runId });

    const list = await client.runs.list({ sessionId: root.runId });
    expect(list.runs.map((r) => r.runId)).toEqual([turn.runId]);
    expect(list.runs[0].sessionId).toBe(root.runId);
    // Прогон без сессии в выборку не попадает.
    expect(list.runs.map((r) => r.runId)).not.toContain(other.runId);
    // Неизвестная сессия — честный пустой список (как у хоста по колонке).
    expect((await client.runs.list({ sessionId: 'run_nope' })).runs).toEqual([]);
  });

  it('POST /v1/runs: session_id в теле → эхо в ответе; 404/409 как у хоста', async () => {
    const client = createMockAi2Client();
    const root = await client.runs.create({ task: 'корень', agent: 'builder' });
    const turn = await client.runs.create({ task: 'ход', agent: 'builder', sessionId: root.runId });
    expect(turn.sessionId).toBe(root.runId);
    // Без session_id эха нет (поле отсутствует, как у хоста).
    expect(root.sessionId).toBeUndefined();
    await expect(client.runs.create({ task: 'в никуда', agent: 'builder', sessionId: 'run_nope' }))
      .rejects.toMatchObject({ status: 404, message: 'session_not_found' });
  });

  it('GET /v1/runs/{id}/events несёт gaps — честный пустой список', async () => {
    const client = createMockAi2Client();
    const ref = await client.runs.create({ task: 't', agent: 'builder' });
    const page = await client.runs.events(ref.runId);
    expect(page.gaps).toEqual([]);
  });

  it('GET /v1/health: checks.db/provider/stores; provider.network_checked=false', async () => {
    const health = await createMockAi2Client().health();
    expect(health.checks?.db).toMatchObject({ state: 'ok' });
    expect(health.checks?.stores).toMatchObject({ state: 'ok' });
    // Сетевого ping у мока нет — provider не притворяется проверенным.
    expect(health.checks?.provider).toMatchObject({
      state: 'unknown',
      network_checked: false,
    });
  });

  it('GET /v1/metrics: retention/integrity/sessions.total — как блоки хоста', async () => {
    const client = createMockAi2Client();
    const root = await client.runs.create({ task: 'корень', agent: 'builder' });
    await client.runs.create({ task: 'ход', agent: 'builder', sessionId: root.runId });
    const m = await client.metrics();
    expect(m.sessions?.total).toBe(1);
    // Воркеров retention/integrity в моке нет — явный null, не выдумки.
    expect(m.retention).toBeNull();
    expect(m.integrity).toBeNull();
    expect(m.stores?.runs?.total).toBe(2);
  });

  it('GET /v1/chat/sessions: session_id/runs/last_activity_at/expired/ttl_hours/reason', async () => {
    const client = createMockAi2Client();
    const root = await client.runs.create({ task: 'корень', agent: 'builder' });
    await client.runs.create({ task: 'ход', agent: 'builder', sessionId: root.runId });
    await client.runs.create({ task: 'ход 2', agent: 'builder', sessionId: root.runId });
    await client.runs.create({ task: 'без сессии', agent: 'builder' });

    const page = await client.chat.sessions();
    expect(page.sessions).toHaveLength(1);
    expect(page.sessions[0]).toMatchObject({
      sessionId: root.runId,
      runs: 3, // корневой + 2 помеченных, как агрегат хоста
      expired: false,
      ttlHours: 24,
      reason: null,
    });
    expect(page.sessions[0].lastActivityAt).toBeTypeOf('number');
    expect(page).toMatchObject({ hasMore: false, nextCursor: null, ttlHours: 24 });
  });

  it('GET /v1/chat/compaction-status: блок session протухания; 404 неизвестной', async () => {
    const client = createMockAi2Client();
    const root = await client.runs.create({ task: 'корень', agent: 'builder' });
    const st = await client.chat.compactionStatus(root.runId);
    expect(st).toMatchObject({
      sessionId: root.runId,
      compaction: null, // состояния авто-компакта в моке нет — не 'none'
      session: { expired: false, ttlHours: 24, reason: null },
    });
    await expect(client.chat.compactionStatus('run_nope'))
      .rejects.toMatchObject({ status: 404, message: 'session_not_found' });
  });

  it('POST /v1/chat/retry: новый прогон с retry_of; 422/404; 409 session_expired', async () => {
    const client = createMockAi2Client();
    const src = await client.runs.create({ task: 'исходный', agent: 'builder' });

    const retried = await client.chat.retry({ messageId: `${src.runId}:task` });
    expect(retried).toMatchObject({
      retryOf: src.runId, sourceMessageId: `${src.runId}:task`, status: 'running',
    });
    const stored = await client.runs.get(retried.runId);
    expect(stored.retryOf).toBe(src.runId);

    await expect(client.chat.retry({ messageId: 'no-colon' }))
      .rejects.toMatchObject({ status: 422 });
    await expect(client.chat.retry({ messageId: 'run_nope:task' }))
      .rejects.toMatchObject({ status: 404, message: 'message_not_found' });

    // Протухшая сессия (фикстурная): 409 с message вида session_expired: …
    const expired = createMockAi2Client({ expiredSessions: ['run_mock_1'] });
    const dead = await expired.runs.create({ task: 'корень', agent: 'builder' });
    await expect(expired.chat.retry({ messageId: `${dead.runId}:answer` }))
      .rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^session_expired: /) });
    // И новый ход в протухшую сессию — 409 (POST /v1/runs).
    await expect(expired.runs.create({ task: 'ход', agent: 'builder', sessionId: dead.runId }))
      .rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^session_expired: /) });
    // Список сессий при этом честно помечает expired.
    const st = await expired.chat.compactionStatus(dead.runId);
    expect(st?.session).toMatchObject({ expired: true, ttlHours: 24 });
    expect(st?.session?.reason).toContain('сессия протухла');
  });

  it('POST /v1/runs/gc: dry-run ответ {dry_run,…,candidates,archived,deleted}', async () => {
    const client = createMockAi2Client();
    const gc = await client.runs.gc({ dryRun: true, olderThanDays: 14, keepPerSession: 5 });
    expect(gc).toMatchObject({
      dry_run: true, older_than_days: 14, keep_per_session: 5,
      // Мок без часов не доказывает возраст — candidates честно 0;
      // deleted всегда 0: hard-delete хост не делает.
      candidates: 0, archived: 0, deleted: 0,
    });
  });

  it('GET /v1/runs/{id}: error у завершённого с ошибкой — {kind,retryAfter,status,upstream}', async () => {
    const client = createMockAi2Client({
      seedRuns: [{
        runId: 'run_seed_fail', status: 'error', tenant: 'local',
        task: 'упавшая задача', config: 'baseline', agent: 'builder',
        answer: null, stopReason: 'provider_error', success: false,
        createdAt: 1_600_000_000, finishedAt: 1_600_000_005,
        error: {
          kind: 'provider', retryAfter: 30, status: 502,
          upstream: 'https://provider.example/v1',
        },
      }],
    });
    const run = await client.runs.get('run_seed_fail');
    expect(run.status).toBe('error');
    expect(run.error).toEqual({
      kind: 'provider', retryAfter: 30, status: 502,
      upstream: 'https://provider.example/v1',
    });
    // У успешного прогона error отсутствует — как и в записи хоста.
    const ok = await client.runs.create({ task: 'ok', agent: 'builder' });
    expect((await client.runs.get(ok.runId)).error).toBeUndefined();
  });
});
