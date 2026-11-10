/**
 * Craft Bridge MVP — безопасный loopback HTTP-слой поверх craft-adapter
 * (control-канал SolidCraft). Только 127.0.0.1, bearer-токен через
 * timing-safe compare, узкие schemas, allowlist безопасных команд,
 * экспорт только в craft-workspace без traversal.
 *
 * Никаких destructive-команд, никакого GUI/live app здесь не запускается;
 * мост лишь проксирует команды в уже работающее приложение. Секреты и токены
 * никуда не логируются. Новые файлы: craft-bridge.mjs + craft-bridge.test.mjs.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { CraftAdapter, tokenPathFor } from './craft-adapter.mjs';

const HOST = '127.0.0.1';
const BODY_LIMIT = Number(process.env.CRAFT_BRIDGE_BODY_LIMIT ?? 16 * 1024); // 16 KiB
const TIMEOUT_MS = Number(process.env.CRAFT_BRIDGE_TIMEOUT_MS ?? 65_000); // > 60-сек ответа приложения
const DEFAULT_EXPORT_ROOT = 'D:\\nexus\\craft-workspace';

/** Только безопасные (недеструктивные) команды моделирования. */
const ALLOW_PREFIXES = ['sketch.', 'solid.', 'parameters.', 'measure.'];
const DENY_RE = /(^|\.)(delete|remove|undo|redo|recover|clear|restore|reset)(\.|$)/i;

function sha256(value) {
  return createHash('sha256').update(value).digest();
}

/** Timing-safe сравнение bearer-токенов (хеши выравнивают длину). */
function safeEqual(a, b) {
  return timingSafeEqual(sha256(a), sha256(b));
}

/** Экспортный путь: только внутри root, без traversal (.. , абсолют, drive). */
function safeExportPath(root, raw) {
  const rel = String(raw ?? '').trim().replace(/\\/g, '/');
  if (!rel || rel.includes('..') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return null;
  const joined = resolve(root, rel);
  if (joined !== root && !joined.startsWith(root + sep)) return null;
  return joined;
}

export class CraftBridge {
  #server = null;
  #adapter = null;
  #bearerToken = null;
  #controlPort = null;
  #exportRoot;

  constructor({
    controlPort,
    controlDir,
    bodyLimit = BODY_LIMIT,
    timeoutMs = TIMEOUT_MS,
    controlCallTimeoutMs,
    exportRoot = process.env.CRAFT_EXPORT_ROOT ?? DEFAULT_EXPORT_ROOT,
  } = {}) {
    this.#exportRoot = resolve(exportRoot);
    this.bodyLimit = bodyLimit;
    this.timeoutMs = timeoutMs;
    this.controlCallTimeoutMs = controlCallTimeoutMs;
    this.#controlPort = controlPort ?? null;
    const bearerToken = process.env.CRAFT_BRIDGE_TOKEN;
    if (!bearerToken) throw new Error('NEXUS bearer required: set CRAFT_BRIDGE_TOKEN');
    if (!Number.isInteger(controlPort) || controlPort < 1 || controlPort > 65535) {
      throw new Error('upstream controlPort required');
    }
    const upstreamToken = readFileSync(tokenPathFor(controlPort, controlDir), 'utf8').trim();
    if (!upstreamToken) throw new Error('upstream SolidCraft token file is empty');
    if (safeEqual(bearerToken, upstreamToken)) {
      throw new Error('NEXUS bearer and upstream SolidCraft token must differ');
    }
    this.#bearerToken = bearerToken;
    this.#adapter = new CraftAdapter(upstreamToken);
    this.#server = createServer((req, res) => void this.#handle(req, res));
    this.#server.on('clientError', (_err, socket) => socket.destroy());
  }

  get port() {
    return this.#server?.address()?.port ?? null;
  }

  async start(port = 0, host = HOST) {
    if (host !== HOST) throw new Error('CraftBridge only binds to 127.0.0.1');
    if (this.#controlPort) await this.#adapter.connect(this.#controlPort);
    await new Promise((resolve_, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(port, HOST, () => {
        this.#server.removeListener('error', reject);
        resolve_();
      });
    });
    return this;
  }

  async stop() {
    this.#adapter?.close();
    this.#adapter = null;
    if (this.#server?.listening) {
      await new Promise((resolve_) => this.#server.close(() => resolve_()));
    }
  }

  #authorized(req) {
    const header = req.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    // constant-time и для отсутствующего токена
    return safeEqual(provided, this.#bearerToken);
  }

  #json(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
      'connection': 'close',
    });
    res.end(payload);
  }

  #readBody(req) {
    return new Promise((resolve_) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > this.bodyLimit) return; // сливаем, но не копим
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (size > this.bodyLimit) {
          resolve_({ tooLarge: true });
          return;
        }
        resolve_({ tooLarge: false, text: Buffer.concat(chunks).toString('utf8') });
      });
      req.on('error', () => resolve_({ tooLarge: false, text: '' }));
    });
  }

  #withTimeout(task) {
    return new Promise((resolve_, reject) => {
      const timer = setTimeout(() => {
        reject(Object.assign(new Error('bridge request timeout'), { status: 504, running: true }));
      }, this.timeoutMs);
      timer.unref();
      task().then(
        (v) => { clearTimeout(timer); resolve_(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  /** Маппинг ответа control-канала в HTTP. Таймаут (running) ≠ провал. */
  #mapControl(reply) {
    if (!reply) return { status: 502, body: { error: 'adapter_no_reply' } };
    if (reply.ok) return { status: 200, body: { ok: true, result: reply.result ?? null } };
    if (reply.running) return { status: 504, body: { ok: false, error: 'adapter_running', running: true } };
    if (reply.busy) return { status: 429, body: { ok: false, error: 'adapter_busy' } };
    return { status: 502, body: { ok: false, error: 'adapter_error', detail: String(reply.error ?? '') } };
  }

  #denied(command) {
    if (typeof command !== 'string' || command.length === 0 || command.length > 200) return true;
    if (DENY_RE.test(command)) return true;
    return !ALLOW_PREFIXES.some((p) => command.startsWith(p));
  }

  async #handle(req, res) {
    const { method, url } = req;
    if (!this.#authorized(req)) {
      this.#json(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    const path = url.split('?')[0];
    if (method === 'GET' && path === '/health') {
      this.#json(res, 200, { ok: true, service: 'craft-bridge' });
      return;
    }
    if (method === 'GET' && (path === '/commands' || path === '/pending' || path === '/status')) {
      try {
        const op = path === '/commands'
          ? () => this.#adapter.engineCommands()
          : path === '/pending'
            ? () => this.#adapter.controlPending()
            : () => this.#adapter.controlRunning();
        const mapped = this.#mapControl(await this.#withTimeout(op));
        this.#json(res, mapped.status, mapped.body);
      } catch (e) {
        this.#json(res, e.status ?? 502, {
          ok: false,
          error: e.status === 504 ? 'gateway_timeout' : 'adapter_unreachable',
          running: e.running,
        });
      }
      return;
    }
    if (method === 'POST' && (path === '/execute' || path === '/export')) {
      const { tooLarge, text } = await this.#readBody(req);
      if (tooLarge) {
        this.#json(res, 413, { ok: false, error: 'body_too_large' });
        return;
      }
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        this.#json(res, 400, { ok: false, error: 'malformed_json' });
        return;
      }
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        this.#json(res, 400, { ok: false, error: 'invalid_schema' });
        return;
      }
      const command = body.command;
      if (typeof command !== 'string' || command.length === 0 || command.length > 200) {
        this.#json(res, 400, { ok: false, error: 'invalid_command' });
        return;
      }
      const params = body.params ?? {};
      if (typeof params !== 'object' || params === null || Array.isArray(params)) {
        this.#json(res, 400, { ok: false, error: 'invalid_params' });
        return;
      }
      try {
        let reply;
        if (path === '/export') {
          if (command !== 'file.export') {
            this.#json(res, 403, { ok: false, error: 'forbidden_command' });
            return;
          }
          const target = safeExportPath(this.#exportRoot, params.path);
          if (!target) {
            this.#json(res, 400, { ok: false, error: 'path_outside_workspace' });
            return;
          }
          reply = await this.#withTimeout(() =>
            this.#adapter.engineExecute('file.export', { path: target }, [this.#exportRoot]),
          );
        } else {
          if (this.#denied(command)) {
            this.#json(res, 403, { ok: false, error: 'forbidden_command' });
            return;
          }
          reply = await this.#withTimeout(() => this.#adapter.engineExecute(
            command,
            params,
            undefined,
            this.controlCallTimeoutMs ? { timeoutMs: this.controlCallTimeoutMs } : {},
          ));
        }
        const mapped = this.#mapControl(reply);
        this.#json(res, mapped.status, mapped.body);
      } catch (e) {
        if (e.code === 'control_timeout') {
          try { await this.#adapter.controlPending(); } catch { /* preserve the timed-out operation response */ }
          this.#json(res, 202, {
            ok: true,
            running: true,
            operation: { id: e.opId, method: e.method },
            poll: '/pending',
          });
          return;
        }
        this.#json(res, e.status ?? 502, {
          ok: false,
          error: e.status === 504 ? 'gateway_timeout' : 'adapter_unreachable',
          running: e.running,
        });
      }
      return;
    }
    this.#json(res, 404, { ok: false, error: 'not_found' });
  }
}
