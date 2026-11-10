/**
 * PoC-тест craft-adapter: fake control-сервер (net.createServer) проверяет
 * JSON-lines, авторизацию token в первой строке и маппинг методов.
 * Запуск: pnpm vitest run packages/bridge/src/craft-adapter.test.ts
 */
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CraftAdapter } from './craft-adapter';

const TOKEN = 'deadbeef'.repeat(8);

describe('CraftAdapter (fake control server)', () => {
  let server: Server;
  let port = 0;
  const seen: Array<Record<string, unknown>> = [];

  beforeEach(async () => {
    seen.length = 0;
    server = createServer((conn: Socket) => {
      let buf = '';
      conn.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        for (;;) {
          const nl = buf.indexOf('\n');
          if (nl < 0) break;
          const req = JSON.parse(buf.slice(0, nl)) as Record<string, unknown>;
          buf = buf.slice(nl + 1);
          seen.push(req);
          const authorized = req.token === TOKEN || seen.length > 1;
          conn.write(
            JSON.stringify(
              authorized
                ? { id: req.id, ok: true, result: { method: req.method } }
                : { id: req.id, ok: false, error: 'unauthorized: bad token' },
            ) + '\n',
          );
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('auth + ui.inspect round-trip, токен только в первой строке', async () => {
    const adapter = CraftAdapter.withToken(TOKEN);
    await adapter.connect(port);
    const r1 = await adapter.uiInspect();
    expect(r1.ok).toBe(true);
    expect(seen[0].token).toBe(TOKEN);
    const r2 = await adapter.engineExecute('ui.view', { view: 'iso' });
    expect(r2.ok).toBe(true);
    expect(seen[1].token).toBeUndefined();
    expect(seen[1].params).toEqual({ command: 'ui.view', params: { view: 'iso' } });
    adapter.close();
  });

  it('неверный токен → ok:false "unauthorized"', async () => {
    const adapter = CraftAdapter.withToken('wrong');
    await adapter.connect(port);
    const reply = await adapter.uiInspect();
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/unauthorized/);
    adapter.close();
  });

  it('engine.execute несёт allow_paths, когда задан', async () => {
    const adapter = CraftAdapter.withToken(TOKEN);
    await adapter.connect(port);
    await adapter.engineExecute('file.export', { path: 'D:/out.step' }, ['D:/nexus/craft-workspace']);
    expect(seen[0].params).toMatchObject({
      command: 'file.export',
      allow_paths: ['D:/nexus/craft-workspace'],
    });
    adapter.close();
  });
});
