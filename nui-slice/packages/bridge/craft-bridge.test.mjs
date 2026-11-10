/**
 * Craft Bridge MVP — node:test suite (встроенный runner, без зависимостей).
 * Запуск: node --test packages/bridge/craft-bridge.test.mjs
 *
 * Покрытие: happy path (health/status/commands/pending/execute/export) и отказы
 * (unauthorized, malformed, oversized, forbidden command, path traversal,
 * adapter disconnect/timeout, shutdown). Fake control-сервер — JSON-lines,
 * per-connection token auth, как реальный SolidCraft.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CraftBridge } from './craft-bridge.mjs';

const UPSTREAM_TOKEN = 'a1b2c3d4'.repeat(8);
const NEXUS_BEARER = 'e5f6a7b8'.repeat(8);

/** Fake control-сервер: modes normal | silent | engine-timeout | disconnect. */
async function startControl(mode = 'normal') {
  const seen = [];
  const server = createServer((conn) => {
    let authed = false;
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (;;) {
        const nl = buf.indexOf('\n');
        if (nl < 0) break;
        const req = JSON.parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        seen.push(req);
        if (!authed && req.token !== UPSTREAM_TOKEN) {
          conn.write(JSON.stringify({ id: req.id, ok: false, error: 'unauthorized: bad token' }) + '\n');
          conn.end();
          return;
        }
        authed = true;
        if (mode === 'silent' || (mode === 'engine-timeout' && req.method === 'engine.execute')) return;
        if (mode === 'disconnect') {
          conn.destroy();
          return;
        }
        const result =
          req.method === 'control.pending' ? { pending: null }
          : req.method === 'control.running' ? { running: [] }
          : req.method === 'engine.commands' ? { commands: [{ id: 'sketch.line', enabled: true }] }
          : { method: req.method, params: req.params };
        conn.write(JSON.stringify({ id: req.id, ok: true, result }) + '\n');
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port, seen, close: () => new Promise((r) => server.close(() => r())) };
}

async function withBridge(mode = 'normal', opts = {}) {
  const control = await startControl(mode);
  const workspace = await mkdtemp(join(tmpdir(), 'craft-ws-'));
  await writeFile(join(workspace, `${control.port}.token`), UPSTREAM_TOKEN, 'utf8');
  const previousBearer = process.env.CRAFT_BRIDGE_TOKEN;
  process.env.CRAFT_BRIDGE_TOKEN = opts.bearerToken ?? NEXUS_BEARER;
  let bridge;
  try {
    bridge = await new CraftBridge({
      controlPort: control.port,
      controlDir: workspace,
      bodyLimit: opts.bodyLimit ?? 16 * 1024,
      timeoutMs: opts.timeoutMs ?? 65_000,
      controlCallTimeoutMs: opts.controlCallTimeoutMs,
      exportRoot: workspace,
    }).start(0);
  } finally {
    if (previousBearer === undefined) delete process.env.CRAFT_BRIDGE_TOKEN;
    else process.env.CRAFT_BRIDGE_TOKEN = previousBearer;
  }
  const base = `http://127.0.0.1:${bridge.port}`;
  const auth = { authorization: `Bearer ${NEXUS_BEARER}` };
  return { control, bridge, workspace, base, auth, close: async () => {
    await bridge.stop();
    await control.close();
    await rm(workspace, { recursive: true, force: true });
  } };
}

test('health — 200 c токеном (токен обязателен везде)', async () => {
  const ctx = await withBridge();
  try {
    const res = await fetch(`${ctx.base}/health`, { headers: ctx.auth });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, service: 'craft-bridge' });
  } finally { await ctx.close(); }
});

test('remote bind override is rejected; bridge remains on loopback', async () => {
  const ctx = await withBridge();
  try {
    await assert.rejects(ctx.bridge.start(0, '0.0.0.0'), /only binds to 127\.0\.0\.1/);
    assert.ok(ctx.bridge.port);
  } finally { await ctx.close(); }
});

test('happy path: status/commands/pending/execute/export', async () => {
  const ctx = await withBridge();
  try {
    const s = await fetch(`${ctx.base}/status`, { headers: ctx.auth });
    assert.equal(s.status, 200);
    assert.deepEqual((await s.json()).result, { running: [] });
    assert.equal(ctx.control.seen[0].token, UPSTREAM_TOKEN);
    assert.notEqual(ctx.control.seen[0].token, NEXUS_BEARER);

    const c = await fetch(`${ctx.base}/commands`, { headers: ctx.auth });
    assert.equal(c.status, 200);
    assert.equal((await c.json()).result.commands[0].id, 'sketch.line');

    const p = await fetch(`${ctx.base}/pending`, { headers: ctx.auth });
    assert.equal(p.status, 200);
    assert.deepEqual((await p.json()).result, { pending: null });

    const e = await fetch(`${ctx.base}/execute`, {
      method: 'POST', headers: ctx.auth, body: JSON.stringify({ command: 'sketch.line', params: { points: [[0, 0], [40, 0]] } }),
    });
    assert.equal(e.status, 200);
    assert.equal((await e.json()).result.method, 'engine.execute');
    assert.equal(ctx.control.seen.at(-1).params.command, 'sketch.line');

    const ex = await fetch(`${ctx.base}/export`, {
      method: 'POST', headers: ctx.auth, body: JSON.stringify({ command: 'file.export', params: { path: 'probe.step' } }),
    });
    assert.equal(ex.status, 200);
    const last = ctx.control.seen.at(-1);
    assert.deepEqual(last.params.allow_paths, [ctx.workspace]);
    assert.equal(last.params.params.path.startsWith(ctx.workspace), true);
  } finally { await ctx.close(); }
});

test('unauthorized: без токена и с неверным → 401', async () => {
  const ctx = await withBridge();
  try {
    const no = await fetch(`${ctx.base}/status`);
    assert.equal(no.status, 401);
    assert.deepEqual(await no.json(), { ok: false, error: 'unauthorized' });
    const bad = await fetch(`${ctx.base}/status`, { headers: { authorization: 'Bearer wrong-token' } });
    assert.equal(bad.status, 401);
    const upstreamAsBearer = await fetch(`${ctx.base}/status`, {
      headers: { authorization: `Bearer ${UPSTREAM_TOKEN}` },
    });
    assert.equal(upstreamAsBearer.status, 401);
  } finally { await ctx.close(); }
});

test('bridge refuses identical NEXUS and upstream tokens', async () => {
  const control = await startControl();
  const workspace = await mkdtemp(join(tmpdir(), 'craft-ws-'));
  await writeFile(join(workspace, `${control.port}.token`), UPSTREAM_TOKEN, 'utf8');
  const previousBearer = process.env.CRAFT_BRIDGE_TOKEN;
  process.env.CRAFT_BRIDGE_TOKEN = UPSTREAM_TOKEN;
  try {
    assert.throws(() => new CraftBridge({
      controlPort: control.port,
      controlDir: workspace,
      exportRoot: workspace,
    }), /must differ/);
  } finally {
    if (previousBearer === undefined) delete process.env.CRAFT_BRIDGE_TOKEN;
    else process.env.CRAFT_BRIDGE_TOKEN = previousBearer;
    await control.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('malformed JSON → 400; invalid schema → 400', async () => {
  const ctx = await withBridge();
  try {
    const mal = await fetch(`${ctx.base}/execute`, { method: 'POST', headers: ctx.auth, body: '{not json' });
    assert.equal(mal.status, 400);
    assert.deepEqual(await mal.json(), { ok: false, error: 'malformed_json' });

    const arr = await fetch(`${ctx.base}/execute`, { method: 'POST', headers: ctx.auth, body: '[1,2]' });
    assert.equal(arr.status, 400);

    const noCmd = await fetch(`${ctx.base}/execute`, { method: 'POST', headers: ctx.auth, body: '{}' });
    assert.equal(noCmd.status, 400);
    assert.deepEqual(await noCmd.json(), { ok: false, error: 'invalid_command' });
  } finally { await ctx.close(); }
});

test('oversized body → 413', async () => {
  const ctx = await withBridge({}, { bodyLimit: 512 });
  try {
    const big = 'x'.repeat(2048);
    const res = await fetch(`${ctx.base}/execute`, { method: 'POST', headers: ctx.auth, body: big });
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { ok: false, error: 'body_too_large' });
  } finally { await ctx.close(); }
});

test('forbidden commands → 403 и не доходят до приложения', async () => {
  const ctx = await withBridge();
  try {
    const before = ctx.control.seen.length;
    for (const command of ['file.delete', 'solid.remove', 'undo', 'sketch.delete', 'engine.batch', 'doc.open', 'ui.set']) {
      const res = await fetch(`${ctx.base}/execute`, { method: 'POST', headers: ctx.auth, body: JSON.stringify({ command, params: {} }) });
      assert.equal(res.status, 403, `command ${command}`);
      assert.deepEqual(await res.json(), { ok: false, error: 'forbidden_command' });
    }
    assert.equal(ctx.control.seen.length, before, 'ни одна запрещённая команда не была отправлена в SolidCraft');
  } finally { await ctx.close(); }
});

test('path traversal в export → 400 (никогда не уходит в канал)', async () => {
  const ctx = await withBridge();
  try {
    const before = ctx.control.seen.length;
    for (const evil of ['../evil.step', '..\\evil.step', 'C:/Windows/evil.step', '/etc/passwd', 'sub/../../evil.step']) {
      const res = await fetch(`${ctx.base}/export`, { method: 'POST', headers: ctx.auth, body: JSON.stringify({ command: 'file.export', params: { path: evil } }) });
      assert.equal(res.status, 400, `path ${evil}`);
      assert.deepEqual(await res.json(), { ok: false, error: 'path_outside_workspace' });
    }
    assert.equal(ctx.control.seen.length, before);
  } finally { await ctx.close(); }
});

test('adapter disconnect во время запроса → 502', async () => {
  const ctx = await withBridge('disconnect');
  try {
    const res = await fetch(`${ctx.base}/execute`, { method: 'POST', headers: ctx.auth, body: JSON.stringify({ command: 'sketch.line', params: {} }) });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /adapter/);
  } finally { await ctx.close(); }
});

test('adapter control timeout → 202 running with operation and pending poll', async () => {
  const ctx = await withBridge('engine-timeout', { timeoutMs: 500, controlCallTimeoutMs: 40 });
  try {
    const res = await fetch(`${ctx.base}/execute`, { method: 'POST', headers: ctx.auth, body: JSON.stringify({ command: 'sketch.line', params: {} }) });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.running, true);
    assert.deepEqual(body.operation, { id: 1, method: 'engine.execute' });
    assert.equal(body.poll, '/pending');
    assert.ok(ctx.control.seen.some((request) => request.method === 'control.pending'));
  } finally { await ctx.close(); }
});

test('shutdown: после stop() сервер не принимает', async () => {
  const ctx = await withBridge();
  await ctx.bridge.stop();
  await assert.rejects(fetch(`${ctx.base}/health`, { headers: ctx.auth }), /fetch failed|ECONNREFUSED|connect/);
  await ctx.close();
});
