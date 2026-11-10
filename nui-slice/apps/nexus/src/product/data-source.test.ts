// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAi2ApiKey,
  NueRegisterTokenRequiredError,
  createNueAuthFetch,
  registerNueKey,
  setAi2ApiKey,
  setNueRegisterToken,
} from './nue-gateway';
import { getDataSource, getDataSourceKind } from './data-source';
import { createAi2DataSource } from '../integrations/ai2/adapters/product-data-source';

describe('mock telegram source — contract boundary', () => {
  it('created runs appear in the list and detail seam for runtime attach', async () => {
    const ds = getDataSource();
    const created = await ds.startRun({ task: 'new mock runtime task', config: 'baseline' });
    expect((await ds.listRuns({ limit: 20 })).some((run) => run.runId === created.runId)).toBe(true);
    expect(await ds.getRunDetail?.(created.runId)).toMatchObject({
      run: { runId: created.runId, taskText: 'new mock runtime task' },
      result: null,
    });
  });

  it('walks the auth machine phone → code → password → connected', async () => {
    process.env.NEXT_PUBLIC_AI2_DATA_SOURCE = 'mock';
    const tg = getDataSource().telegram!;
    expect(tg).toBeDefined();
    expect((await tg.getState()).status).toBe('disconnected');

    expect(await tg.startAuth({ phone: '+7000' }))
      .toMatchObject({ status: 'authorizing', authStep: 'code' });
    expect(await tg.startAuth({ code: '12345' }))
      .toMatchObject({ status: 'authorizing', authStep: 'password' });
    expect(await tg.startAuth({ password: 'pw' }))
      .toMatchObject({ status: 'connected', authStep: 'none' });
  });

  it('lists chats and history only when connected; send is explicit', async () => {
    const tg = getDataSource().telegram!;
    const chats = await tg.listChats();
    expect(chats.length).toBeGreaterThan(0);
    const before = await tg.getHistory('chat-ops');
    const sent = await tg.sendText('chat-ops', 'тестовое сообщение');
    expect(sent.fromMe).toBe(true);
    const after = await tg.getHistory('chat-ops');
    expect(after.length).toBe(before.length + 1);
    expect(after.at(-1)!.text).toBe('тестовое сообщение');
  });

  it('setMockState drives offline/locked/error demos; logout resets', async () => {
    const tg = getDataSource().telegram!;
    expect(await tg.setMockState!('reconnecting'))
      .toMatchObject({ status: 'reconnecting' });
    expect(await tg.setMockState!('error'))
      .toMatchObject({ status: 'error', error: expect.any(String) });
    expect(await tg.logout()).toMatchObject({ status: 'disconnected' });
    expect(await tg.listChats()).toEqual([]);
  });

  it('source kind is mock in test env', () => {
    expect(getDataSourceKind()).toBe('mock');
  });
});

describe('mock instagram sources — two independent integrations', () => {
  it('consumer account resolves limited-account-type, never connected', async () => {
    const api = getDataSource().instagram!.api!;
    const s = await api.connect({ accountType: 'consumer' });
    expect(s.status).toBe('limited-account-type');
    expect(s.account).toBeNull();
    expect(await api.listMedia()).toEqual([]);
  });

  it('business connects with basic+comments scopes; DM stays needs-permission', async () => {
    const api = getDataSource().instagram!.api!;
    const s = await api.connect({ accountType: 'business' });
    expect(s.status).toBe('connected');
    expect(s.account!.grantedScopes).toContain('instagram_business_manage_comments');
    expect(s.account!.grantedScopes).not.toContain('instagram_business_manage_messages');
    expect((await api.listMedia()).length).toBeGreaterThan(0);
    expect(await api.listDmThreads()).toEqual([]);
  });

  it('creator gains messages scope; explicit postComment appends', async () => {
    const api = getDataSource().instagram!.api!;
    const s = await api.connect({ accountType: 'creator' });
    expect(s.account!.grantedScopes).toContain('instagram_business_manage_messages');
    expect((await api.listDmThreads()).length).toBeGreaterThan(0);
    const before = await api.listComments('ig-1001');
    await api.postComment('ig-1001', 'подтверждённый комментарий');
    const after = await api.listComments('ig-1001');
    expect(after.length).toBe(before.length + 1);
    expect(after.at(-1)!.from).toBe('@nexus_official');
  });

  it('web lifecycle is separate: open/close do not touch api state', async () => {
    const ig = getDataSource().instagram!;
    expect((await ig.web!.open()).state).toBe('open');
    expect((await ig.web!.open()).state).toBe('open'); // repeat focuses
    expect((await ig.api!.getState()).status).toBe('connected'); // untouched
    expect((await ig.web!.setMockState!('unavailable')).state).toBe('unavailable');
    await ig.api!.disconnect();
    expect((await ig.web!.getState()).state).toBe('unavailable'); // web unaffected
  });
});

describe('mock services catalog — connections surface', () => {
  it('lists every provider entry as separate access paths', async () => {
    const svc = getDataSource().services!;
    const items = await svc.list();
    expect(items.length).toBe(19);
    expect(items.filter((s) => s.id.startsWith('google-')).length).toBe(4);
    expect(items.find((s) => s.id === 'tiktok-display.api')).toBeDefined();
    expect(items.find((s) => s.id === 'tiktok-post.api')).toBeDefined();
  });

  it('connect only simulates connectable entries; agenda/docs gate on state', async () => {
    const svc = getDataSource().services!;
    const blocked = await svc.connect('hiro.native');
    expect(blocked!.state).not.toBe('connected');

    expect(await svc.calendarAgenda!()).toEqual([]);
    await svc.connect('google-calendar.api');
    expect((await svc.calendarAgenda!()).length).toBe(3);
    await svc.connect('google-docs.api');
    expect((await svc.pickedDocuments!()).length).toBe(1);

    await svc.disconnect('google-calendar.api');
    expect(await svc.calendarAgenda!()).toEqual([]);
    expect((await svc.pickedDocuments!()).length).toBe(1); // docs unaffected
  });
});

describe('mock webhook write-path — seam for W1 live adapter', () => {
  it('create returns row + one-time secret; update toggles; delete removes', async () => {
    const ds = getDataSource();
    const { webhook, secret } = await ds.createWebhook!({
      url: 'https://hooks.example/ai2', events: ['run.completed'],
    });
    expect(webhook.webhookId).toMatch(/^wh-mock-/);
    expect(secret).toContain('(mock)');
    expect((await ds.listWebhooks()).some((w) => w.webhookId === webhook.webhookId)).toBe(true);

    const updated = await ds.updateWebhook!(webhook.webhookId, { active: false });
    expect(updated?.active).toBe(false);

    await ds.deleteWebhook!(webhook.webhookId);
    expect((await ds.listWebhooks()).some((w) => w.webhookId === webhook.webhookId)).toBe(false);
  });

  it('deterministic rejects: old.invalid create; legacy-endpoint update', async () => {
    const ds = getDataSource();
    await expect(ds.createWebhook!({ url: 'https://old.invalid/x', events: ['run.failed'] }))
      .rejects.toThrow('422');
    await expect(ds.updateWebhook!('wh-03', { active: true })).rejects.toThrow('legacy endpoint');
    expect(await ds.updateWebhook!('wh-nope', { active: true })).toBeNull();
  });
});

describe('mock api-key write-path — POST/DELETE /v1/keys seam', () => {
  it('create returns row + one-time secret; revoke marks status; re-revoke idempotent', async () => {
    const ds = getDataSource();
    const { key, secret } = await ds.createApiKey!({ name: 'ci-bot', scopes: ['runs:write'] });
    expect(key.keyId).toMatch(/^key-mock-/);
    expect(key.status).toBe('active');
    expect(secret).toContain('(mock)');
    expect((await ds.listApiKeys())[0]?.keyId).toBe(key.keyId);
    // secret never re-listed — rows carry prefix only
    expect((await ds.listApiKeys()).every((k) => !('secret' in k))).toBe(true);

    await ds.revokeApiKey!(key.keyId);
    const row = (await ds.listApiKeys()).find((k) => k.keyId === key.keyId);
    expect(row?.status).toBe('revoked');
    await ds.revokeApiKey!(key.keyId); // server is idempotent — second revoke is 204
    await ds.revokeApiKey!('key-unknown'); // unknown id — still a no-op resolve
  });

  it('deterministic reject: key-02 stands in for "key in use"', async () => {
    const ds = getDataSource();
    await expect(ds.revokeApiKey!('key-02')).rejects.toThrow('in use');
  });
});

describe('mock plugin write-path — PATCH /v1/plugins seam', () => {
  it('toggle persists via updatePlugin; unsigned activation rejected; unknown → null', async () => {
    const ds = getDataSource();
    const plugins = await ds.listPlugins();
    const target = plugins.find((p) => p.signed) ?? plugins[0]!;
    const next = !target.active;
    const updated = await ds.updatePlugin!(target.name, { active: next });
    expect(updated?.active).toBe(next);
    expect((await ds.listPlugins()).find((p) => p.name === target.name)?.active).toBe(next);

    const unsigned = plugins.find((p) => p.signed === false);
    if (unsigned) {
      await expect(ds.updatePlugin!(unsigned.name, { active: true })).rejects.toThrow('unsigned');
    }
    expect(await ds.updatePlugin!('plugin-nope', { active: true })).toBeNull();
  });
});

describe('mock run-cancel — отмена исполняется, а не no-op', () => {
  it('отменённый прогон становится терминальным в list/detail/controls', async () => {
    const ds = getDataSource();
    const created = await ds.startRun({ task: 'отменяемый прогон', config: 'baseline' });

    const before = await ds.getRunControls!(created.runId);
    expect(before.pause.available).toBe(true);

    await ds.cancelRun(created.runId);

    // Прогон больше не «running» — пауза/резюм не предлагаются, retry доступен.
    const after = await ds.getRunControls!(created.runId);
    expect(after.pause.available).toBe(false);
    expect(after.resume.available).toBe(false);
    expect(after.retry.available).toBe(true);

    const detail = await ds.getRunDetail!(created.runId);
    expect(detail?.run.status).toBe('cancelled');
    expect(detail?.run.stopReason).toBe('cancelled');

    const row = (await ds.listRuns({ limit: 50 })).find((r) => r.runId === created.runId);
    expect(row?.status).toBe('cancelled');
  });

  it('поток отменённого прогона обрывается финалом cancelled', async () => {
    const ds = getDataSource();
    const created = await ds.startRun({ task: 'поток отменяемого прогона', config: 'baseline' });
    const seen: string[] = [];
    let final: string | null = null;
    const stop = ds.streamRun(created.runId, {
      onEvent: (e) => { seen.push(e.type); },
      onEnd: (s) => { final = s; },
    });
    await ds.cancelRun(created.runId);
    await new Promise((r) => setTimeout(r, 400));
    stop();
    expect(final).toBe('cancelled');
    // Фикстура — 10 событий; отменённый прогон не доигрывает её до конца.
    expect(seen.length).toBeLessThan(10);
  });

  it('неизвестный прогон → 404, не «running» → 409 (как у живого хоста)', async () => {
    const ds = getDataSource();
    await expect(ds.cancelRun('run-nope')).rejects.toThrow('404');
    await expect(ds.cancelRun('run-1039')).rejects.toThrow('409'); // фикстурный done
  });

  it('retry = новый прогон с тем же входом: модель, память, проект, пресет', async () => {
    const ds = getDataSource();
    const created = await ds.startRun({
      task: 'повтор с тем же входом', config: 'deep', model: 'qwen3-coder',
      useMemory: true, project: 'ai2',
    });
    // Retry доступен только на терминальных прогонах.
    await ds.cancelRun(created.runId);

    const next = await ds.retryRun!(created.runId);
    expect(next).not.toBeNull();
    expect(next!.runId).not.toBe(created.runId);
    expect(next!.taskText).toBe('повтор с тем же входом');
    expect(next!.config).toBe('deep');
    expect(next!.project).toBe('ai2');
    expect(next!.model).toBe('qwen3-coder');
    expect(next!.useMemory).toBe(true);
  });
});

describe('NUE gateway auth', () => {
  const originalSource = process.env.NEXT_PUBLIC_AI2_DATA_SOURCE;
  const originalBaseUrl = process.env.NEXT_PUBLIC_AI2_BASE_URL;
  const values = new Map<string, string>();

  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

  beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
    process.env.NEXT_PUBLIC_AI2_DATA_SOURCE = 'live';
    process.env.NEXT_PUBLIC_AI2_BASE_URL = 'https://nue.example';
    setAi2ApiKey(null);
    setNueRegisterToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalSource === undefined) delete process.env.NEXT_PUBLIC_AI2_DATA_SOURCE;
    else process.env.NEXT_PUBLIC_AI2_DATA_SOURCE = originalSource;
    if (originalBaseUrl === undefined) delete process.env.NEXT_PUBLIC_AI2_BASE_URL;
    else process.env.NEXT_PUBLIC_AI2_BASE_URL = originalBaseUrl;
  });

  it('registers lazily through the live data-source and sends the new Bearer key', async () => {
    const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const authorization = new Headers(init?.headers).get('Authorization');
      calls.push({ url, method, authorization });
      if (url.endsWith('/nue/register')) return ok({ key: 'nue_a1B2c3' });
      if (url.includes('/v1/runs?')) return ok({ runs: [], has_more: false });
      return ok({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getDataSource().listRuns({ limit: 5 })).resolves.toEqual([]);

    expect(calls.map(({ url, method }) => [url, method])).toEqual([
      ['https://nue.example/nue/register', 'POST'],
      ['https://nue.example/v1/runs?limit=5', 'GET'],
    ]);
    expect(calls[0]?.authorization).toBeNull();
    expect(calls[1]?.authorization).toBe('Bearer nue_a1B2c3');
    expect(getAi2ApiKey()).toBe('nue_a1B2c3');
  });

  it('surfaces a typed register-token request and retries after token entry', async () => {
    const calls: Array<{ url: string; token: string | null }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, token: new Headers(init?.headers).get('X-Register-Token') });
      if (url.endsWith('/nue/register')) {
        if (!calls.at(-1)?.token) return ok({ error: 'register token required' }, 401);
        return ok({ key: 'nue_f00d42' });
      }
      if (url.includes('/v1/runs')) return ok({ runs: [], has_more: false });
      return ok({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getDataSource().listRuns({ limit: 1 }))
      .rejects.toBeInstanceOf(NueRegisterTokenRequiredError);

    setNueRegisterToken('register-secret');
    await expect(getDataSource().listRuns({ limit: 1 })).resolves.toEqual([]);
    expect(calls.filter((c) => c.url.endsWith('/nue/register')).map((c) => c.token))
      .toEqual([null, 'register-secret']);
  });

  it('clears a revoked NUE key, registers once, and retries the original request once', async () => {
    setAi2ApiKey('nue_deadbeef');
    const calls: Array<{ url: string; authorization: string | null }> = [];
    let runCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get('Authorization');
      calls.push({ url, authorization });
      if (url.endsWith('/nue/register')) return ok({ key: 'nue_cafe1234' });
      if (url.includes('/v1/runs')) {
        runCalls += 1;
        return runCalls === 1 ? ok({ error: 'invalid key' }, 401)
          : ok({ runs: [], has_more: false });
      }
      return ok({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getDataSource().listRuns({ limit: 2 })).resolves.toEqual([]);

    const apiCalls = calls.filter((c) => c.url.includes('/v1/runs'));
    expect(apiCalls.map((c) => c.authorization)).toEqual([
      'Bearer nue_deadbeef', 'Bearer nue_cafe1234',
    ]);
    expect(calls.filter((c) => c.url.endsWith('/nue/register'))).toHaveLength(1);
    expect(getAi2ApiKey()).toBe('nue_cafe1234');
  });

  it('rejects malformed registered keys and leaves a direct AI-2 host usable', async () => {
    const malformed = vi.fn(async () => ok({ key: 'nue_not-hex' }));
    await expect(registerNueKey('https://nue.example', undefined, malformed as typeof fetch))
      .rejects.toThrow(/invalid NUE key/i);
    values.set('nexus.ai2.apiKey', 'nue_not-hex');
    expect(getAi2ApiKey()).toBeNull();
    expect(values.has('nexus.ai2.apiKey')).toBe(false);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/nue/register')) return ok({ detail: 'not found' }, 404);
      if (url.includes('/v1/runs')) return ok({ runs: [], has_more: false });
      return ok({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getDataSource().listRuns({ limit: 3 })).resolves.toEqual([]);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'https://nue.example/nue/register', 'https://nue.example/v1/runs?limit=3',
    ]);
  });

  it('does not loop when the replacement NUE key is also rejected', async () => {
    setAi2ApiKey('nue_dead123');
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/nue/register')) return ok({ key: 'nue_beef456' });
      if (url.includes('/v1/runs')) return ok({ error: 'invalid key' }, 401);
      return ok({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    // Use a fresh adapter/auth wrapper for this scenario. getDataSource() is
    // intentionally singleton-cached, and the prior direct-host test taught
    // its wrapper that this origin has no /nue/register route (404).
    const baseUrl = 'https://nue.example';
    const ds = createAi2DataSource({
      baseUrl,
      fetchImpl: createNueAuthFetch(baseUrl, fetchMock as typeof fetch),
    });

    await expect(ds.listRuns({ limit: 4 })).rejects.toThrow('401');
    expect(calls.filter((url) => url.endsWith('/nue/register'))).toHaveLength(1);
    expect(calls.filter((url) => url.includes('/v1/runs'))).toHaveLength(2);
  });
});

describe('mock social source (честный пустой контур)', () => {
  it('starts in stealth mode and switches only on explicit selection', async () => {
    const social = getDataSource().social!;
    expect(social.mode).toBe('stealth');
    const state = await social.setMode('open');
    expect(social.mode).toBe('open');
    expect(state).toEqual(await social.getState());
    await social.setMode('stealth');
  });

  it('не фабрикует данные: пустые сети, очередь и утверждения', async () => {
    const social = getDataSource().social!;
    const state = await social.getState();
    expect(state.accounts).toEqual([]);            // никаких выдуманных подключений
    expect(state.agent.subAgents.map((s) => s.key)).toEqual(['spark', 'codex', 'forge', 'neo2']);
    expect(state.agent.subAgents.every((s) => s.task === null)).toBe(true);
    expect(await social.listApprovals()).toEqual([]);
    expect(await social.listQueue()).toEqual([]);
  });

  it('createDraft честно отказывает (роль планировщика RAE, не UI)', async () => {
    const social = getDataSource().social!;
    await expect(social.createDraft({ network: 'instagram', text: 'x' }))
      .rejects.toThrow(/планировщиком RAE/);
    await expect(social.respondApproval('post-unknown', 'approve')).resolves.toBeNull();
    expect((await social.listQueue()).length).toBe(0);
  });
});
