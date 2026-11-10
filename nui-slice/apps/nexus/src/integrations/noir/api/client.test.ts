import { describe, expect, it } from 'vitest';
import { createNoirClient, NoirApiError } from './client';
import { createNoirMockClient } from './mock-transport';

type Seen = { url: string; method: string; headers: Headers; body: string | null };

function stubFetch(responses: Array<{ status?: number; body?: unknown }>) {
  const seen: Seen[] = [];
  const queue = [...responses];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    seen.push({
      url: req.url, method: req.method, headers: req.headers,
      body: init?.body === undefined ? null : String(init.body),
    });
    const next = queue.shift() ?? { status: 200, body: {} };
    return new Response(
      next.body === undefined ? null : JSON.stringify(next.body),
      { status: next.status ?? 200, headers: { 'content-type': 'application/json' } },
    );
  };
  return { seen, fetchImpl: fetchImpl as typeof fetch };
}

const BASE = 'http://noir.test';

describe('createNoirClient (INT-24)', () => {
  it('session.create posts init_data and maps the token', async () => {
    const stub = stubFetch([{ body: { session_token: 'tok1', expires_at: '2027-01-01T00:00:00Z' } }]);
    const client = createNoirClient({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    const s = await client.session.create('query_id=AA…');
    expect(stub.seen[0].method).toBe('POST');
    expect(stub.seen[0].url).toBe(`${BASE}/api/web/session`);
    expect(JSON.parse(stub.seen[0].body ?? '')).toEqual({ init_data: 'query_id=AA…' });
    expect(s).toEqual({ sessionToken: 'tok1', expiresAt: '2027-01-01T00:00:00Z' });
  });

  it('session.createWithLinkCode posts link_code (desktop pairing path)', async () => {
    const stub = stubFetch([{ body: { session_token: 'tok2', expires_at: '2027-01-01T00:10:00Z' } }]);
    const client = createNoirClient({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    const s = await client.session.createWithLinkCode('ABCD-2345');
    expect(JSON.parse(stub.seen[0].body ?? '')).toEqual({ link_code: 'ABCD-2345' });
    expect(s.sessionToken).toBe('tok2');
  });

  it('withToken attaches Bearer; errors surface the wire code', async () => {
    const stub = stubFetch([{ status: 401, body: { error: 'invalid_session' } }]);
    const client = createNoirClient({ baseUrl: BASE, fetchImpl: stub.fetchImpl }).withToken('tok1');
    await expect(client.player.dashboard()).rejects.toMatchObject({
      name: 'NoirApiError', status: 401, code: 'invalid_session',
    });
    expect(stub.seen[0].headers.get('authorization')).toBe('Bearer tok1');
  });

  it('dashboard maps snake_case wire to the camelCase contract', async () => {
    const stub = stubFetch([{
      body: {
        identity: { id: 7, name: 'Вертоль', alias: 'VER', role: 'player', gender: 'm' },
        worldline: { id: 101, era_id: 1, base_canon_version: 3 },
        runtime: {
          state: 'FREE', location_code: 'NEON_MILE', game_started_at: '2027-01-01T00:00:00Z',
          game_start_generation: 1, active_story_run_id: null, active_work_shift_id: null,
        },
        wallet: { credits: 120 },
        character: { humanity: 92, era_heat: 1 },
        employment: null, active_story: null, active_work_shift: null,
        launch: { state: 'LIVE', system_model_version: '1.0', is_active: true },
        is_gm: false,
      },
    }]);
    const client = createNoirClient({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    const d = await client.player.dashboard();
    expect(d.worldline.eraId).toBe(1);
    expect(d.runtime.locationCode).toBe('NEON_MILE');
    expect(d.character.eraHeat).toBe(1);
    expect(d.launch.isActive).toBe(true);
    expect(d.isGm).toBe(false);
  });

  it('storyChoice sends authored index verbatim and maps the next scene', async () => {
    const stub = stubFetch([{
      body: {
        completed: false, waiting: false, deadlock: false,
        scene: { title: 'T', body: 'B', choices: [{ label: 'Go', custom: false, choice_index: 0 }] },
      },
    }]);
    const client = createNoirClient({ baseUrl: BASE, fetchImpl: stub.fetchImpl });
    const r = await client.actions.storyChoice({ runId: 5, choiceIndex: 2, customText: 'своё' });
    expect(JSON.parse(stub.seen[0].body ?? ''))
      .toEqual({ run_id: 5, choice_index: 2, custom_text: 'своё' });
    expect(r.scene?.choices[0].choiceIndex).toBe(0);
  });
});

describe('createNoirMockClient (INT-24)', () => {
  it('player calls without a session answer 401 invalid_session', async () => {
    const c = createNoirMockClient();
    await expect(c.player.dashboard()).rejects.toMatchObject({ status: 401, code: 'invalid_session' });
    const { sessionToken } = await c.session.create('init');
    const bound = c.withToken(sessionToken);
    const d = await bound.player.dashboard();
    expect(d.wallet.credits).toBe(120);

    // link-code path issues the same kind of binding
    const viaLink = c.withToken((await c.session.createWithLinkCode('XXXX-2345')).sessionToken);
    expect((await viaLink.player.economy()).balance).toBe(120);
  });

  it('mock link codes are one-time and format-checked like the host', async () => {
    const c = createNoirMockClient();
    await expect(c.session.createWithLinkCode('0O1I-!!!!')).rejects.toMatchObject({
      status: 401, code: 'invalid_link_code',
    });
    await expect(c.session.createWithLinkCode('ABCD-2345')).resolves.toMatchObject({
      sessionToken: expect.any(String),
    });
    // burned on exchange — replay is rejected
    await expect(c.session.createWithLinkCode('ABCD-2345')).rejects.toMatchObject({
      status: 401, code: 'invalid_link_code',
    });
    // normalization: lowercase + spaces parse to the same canonical code
    await expect(c.session.createWithLinkCode('wxyz 6789')).resolves.toBeTruthy();
  });

  it('story loop: bootstrap → start → choice advances → completes', async () => {
    const { sessionToken } = await createNoirMockClient().session.create('i');
    const c = createNoirMockClient(); // fresh world for determinism
    const s = await c.session.create('i');
    const bound = c.withToken(s.sessionToken);

    await bound.actions.bootstrapGame();
    const started = await bound.actions.storyStart('NEON_DELIVERY');
    expect(started.runId).toBe(1);

    const cur = await bound.player.storyCurrent();
    expect(cur.active && cur.scene?.choices).toHaveLength(3);

    const next = await bound.actions.storyChoice({ runId: 1, choiceIndex: 0 });
    expect(next.completed).toBe(false);
    expect(next.scene?.title).toBe('Ларек с лапшой');

    const done = await bound.actions.storyChoice({ runId: 1, choiceIndex: 1 });
    expect(done.completed).toBe(true);
    expect((await bound.player.storyCurrent()).active).toBe(false);
    expect(sessionToken).toBeTruthy();
  });

  it('enforces server codes: locked story, bad route, insufficient credits', async () => {
    const c = createNoirMockClient();
    const bound = c.withToken((await c.session.create('i')).sessionToken);
    await bound.actions.bootstrapGame();
    await expect(bound.actions.storyStart('STATIC'))
      .rejects.toMatchObject({ status: 403, code: 'story_locked' });
    await expect(bound.actions.travel('NOWHERE'))
      .rejects.toMatchObject({ status: 404, code: 'route_not_found' });
    await expect(bound.actions.travel('CROWN'))
      .rejects.toMatchObject({ status: 403, code: 'access_denied' });
    await expect(bound.actions.buy(9, { itemCode: 'INFO_PACKET', quantity: 99 }))
      .rejects.toMatchObject({ status: 409, code: 'insufficient_credits' });
    const ok = await bound.actions.buy(9, { itemCode: 'INFO_PACKET' });
    expect(ok.balanceAfter).toBe(80);
    expect((await bound.player.economy()).balance).toBe(80);
  });
});
