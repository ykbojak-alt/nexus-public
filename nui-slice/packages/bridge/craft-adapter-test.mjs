/**
 * Deterministic client-side tests for CraftAdapter TCP JSON-lines framing.
 * Run with: node --test packages/bridge/craft-adapter-test.mjs
 * All tests use a local fake node:net server; no SolidCraft host is involved.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import { CraftAdapter } from './craft-adapter.mjs';

const TOKEN = 'deadbeef'.repeat(8);

function sendReply(conn, id, fields = {}) {
  conn.write(JSON.stringify({ id, ok: true, ...fields }) + '\n');
}

function sendLater(conn, delayMs, data) {
  const timer = setTimeout(() => {
    if (!conn.destroyed) conn.write(data);
  }, delayMs);
  conn.once('close', () => clearTimeout(timer));
  return timer;
}

async function startHarness(onRequest) {
  const seen = [];
  const connections = new Set();
  const server = createServer((conn) => {
    connections.add(conn);
    conn.once('close', () => connections.delete(conn));
    let buffer = '';
    conn.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const nl = buffer.indexOf('\n');
        if (nl < 0) break;
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let request;
        try {
          request = JSON.parse(line);
        } catch (error) {
          conn.destroy(error);
          return;
        }
        seen.push(request);
        onRequest(request, conn, seen);
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const adapter = new CraftAdapter(TOKEN);
  try {
    await adapter.connect(server.address().port);
  } catch (error) {
    for (const conn of connections) conn.destroy();
    await new Promise((resolve) => server.close(resolve));
    throw error;
  }
  return {
    adapter,
    seen,
    async close() {
      adapter.close();
      for (const conn of connections) conn.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function withHarness(onRequest, run) {
  const harness = await startHarness(onRequest);
  try {
    return await run(harness);
  } finally {
    await harness.close();
  }
}

test('auth is first-line only and existing command envelopes still round-trip', async () => {
  await withHarness((request, conn) => {
    const result =
      request.method === 'control.pending'
        ? { pending: null }
        : { method: request.method, params: request.params };
    sendReply(conn, request.id, { result });
  }, async ({ adapter, seen }) => {
    const inspected = await adapter.uiInspect();
    assert.equal(inspected.ok, true);
    assert.equal(seen[0].token, TOKEN);

    const executed = await adapter.engineExecute(
      'file.export',
      { path: 'D:/out.step' },
      ['D:/nexus/craft-workspace'],
    );
    assert.equal(executed.ok, true);
    assert.equal(seen[1].token, undefined);
    assert.equal(seen[1].params.command, 'file.export');
    assert.deepEqual(seen[1].params.allow_paths, ['D:/nexus/craft-workspace']);

    const pending = await adapter.controlPending();
    assert.deepEqual(pending.result, { pending: null });
    assert.equal(adapter.pendingCount, 0);
  });
});

test('buffers a JSON frame split across TCP chunks, including a split UTF-8 character', async () => {
  await withHarness((request, conn) => {
    const frame = Buffer.from(
      JSON.stringify({ id: request.id, ok: true, result: { label: 'Журнал' } }) + '\n',
      'utf8',
    );
    const marker = Buffer.from('Ж', 'utf8');
    const splitAt = frame.indexOf(marker) + 1;
    conn.write(frame.subarray(0, splitAt));
    sendLater(conn, 20, frame.subarray(splitAt));
  }, async ({ adapter }) => {
    const reply = await adapter.uiInspect();
    assert.deepEqual(reply.result, { label: 'Журнал' });
    assert.equal(adapter.pendingCount, 0);
  });
});

test('processes multiple newline frames from one TCP write and skips empty lines', async () => {
  await withHarness((request, conn, seen) => {
    if (seen.length !== 2) return;
    const first = JSON.stringify({ id: seen[0].id, ok: true, result: { order: 1 } });
    const second = JSON.stringify({ id: seen[1].id, ok: true, result: { order: 2 } });
    conn.write('\n' + first + '\n' + second + '\n\n');
  }, async ({ adapter }) => {
    const [first, second] = await Promise.all([
      adapter.call('first'),
      adapter.call('second'),
    ]);
    assert.deepEqual(first.result, { order: 1 });
    assert.deepEqual(second.result, { order: 2 });
    assert.equal(adapter.pendingCount, 0);
  });
});

test('malformed JSON rejects pending calls without exposing frame contents', async () => {
  const malformed = 'not-json-sensitive-payload';
  await withHarness((request, conn, seen) => {
    if (seen.length === 2) conn.write(malformed + '\n');
  }, async ({ adapter }) => {
    const calls = [adapter.call('first'), adapter.call('second')];
    const settled = await Promise.allSettled(calls);
    assert.equal(settled.length, 2);
    for (const item of settled) {
      assert.equal(item.status, 'rejected');
      assert.match(item.reason.message, /invalid JSON frame/i);
      assert.equal(item.reason.message.includes(malformed), false);
    }
    assert.equal(adapter.pendingCount, 0);
    await assert.rejects(adapter.call('after-protocol-error'), /not connected/);
  });
});

test('ignores a valid reply with an unknown id and keeps the real call pending', async () => {
  await withHarness((request, conn) => {
    sendReply(conn, request.id + 1000, { result: { wrong: true } });
    sendLater(
      conn,
      25,
      JSON.stringify({ id: request.id, ok: true, result: { right: true } }) + '\n',
    );
  }, async ({ adapter }) => {
    const call = adapter.call('expected');
    const early = await Promise.race([
      call.then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 10)),
    ]);
    assert.equal(early, 'pending');
    assert.equal(adapter.pendingCount, 1);
    assert.deepEqual((await call).result, { right: true });
    assert.equal(adapter.pendingCount, 0);
  });
});

test('timeout clears pending, does not retry, and ignores a late reply during the next call', async () => {
  await withHarness((request, conn) => {
    if (request.method === 'slow') {
      sendLater(
        conn,
        70,
        JSON.stringify({ id: request.id, ok: true, result: { late: true } }) + '\n',
      );
      return;
    }
    sendLater(
      conn,
      110,
      JSON.stringify({ id: request.id, ok: true, result: { method: request.method } }) + '\n',
    );
  }, async ({ adapter, seen }) => {
    await assert.rejects(adapter.call('slow', {}, { timeoutMs: 25 }), /timed out/i);
    assert.equal(adapter.pendingCount, 0);
    assert.equal(seen.length, 1, 'one request was sent; adapter did not retry');

    const next = adapter.call('next', {}, { timeoutMs: 250 });
    const reply = await next;
    assert.deepEqual(reply.result, { method: 'next' });
    assert.equal(seen.length, 2);
    assert.equal(adapter.pendingCount, 0);
  });
});

test('running:true keeps engine.batch pending and extends only to its configured cap', async () => {
  await withHarness((request, conn) => {
    sendReply(conn, request.id, { running: true, result: null });
    sendLater(
      conn,
      75,
      JSON.stringify({ id: request.id, ok: true, result: { completed: true } }) + '\n',
    );
  }, async ({ adapter }) => {
    const call = adapter.engineExecute(
      'engine.batch',
      {},
      undefined,
      { timeoutMs: 45, maxTimeoutMs: 150 },
    );
    const early = await Promise.race([
      call.then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 15)),
    ]);
    assert.equal(early, 'pending');
    assert.equal(adapter.pendingCount, 1);
    assert.deepEqual((await call).result, { completed: true });
    assert.equal(adapter.pendingCount, 0);
  });
});

test('repeated running:true cannot cancel the absolute per-call deadline', async () => {
  let runningCount = 0;
  await withHarness((request, conn) => {
    sendReply(conn, request.id, { running: true, result: null });
    const interval = setInterval(() => {
      if (conn.destroyed) {
        clearInterval(interval);
        return;
      }
      runningCount++;
      sendReply(conn, request.id, { running: true, result: null });
    }, 20);
    conn.once('close', () => clearInterval(interval));
  }, async ({ adapter }) => {
    await assert.rejects(
      adapter.call('engine.batch', {}, { timeoutMs: 40, maxTimeoutMs: 160 }),
      (error) => error.message === 'control call timed out'
        && error.code === 'control_timeout'
        && error.opId === 1
        && error.method === 'engine.batch',
    );
    assert.ok(runningCount >= 2);
    assert.equal(adapter.pendingCount, 0);
  });
});

test('disconnect rejects every pending call and clears the map', async () => {
  await withHarness((request, conn, seen) => {
    if (seen.length === 2) conn.destroy();
  }, async ({ adapter }) => {
    const settled = await Promise.allSettled([
      adapter.call('first'),
      adapter.call('second'),
    ]);
    assert.equal(settled.length, 2);
    for (const item of settled) {
      assert.equal(item.status, 'rejected');
      assert.match(item.reason.message, /control channel closed/);
    }
    assert.equal(adapter.pendingCount, 0);
    await assert.rejects(adapter.call('after-disconnect'), /not connected/);
  });
});

test('an ok:false busy/auth envelope is returned without an automatic retry', async () => {
  await withHarness((request, conn) => {
    conn.write(JSON.stringify({ id: request.id, ok: false, busy: true, error: 'busy' }) + '\n');
  }, async ({ adapter, seen }) => {
    const reply = await adapter.call('busy-check');
    assert.equal(reply.ok, false);
    assert.equal(reply.busy, true);
    assert.equal(seen.length, 1);
    assert.equal(adapter.pendingCount, 0);
  });
});
