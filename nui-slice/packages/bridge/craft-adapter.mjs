/**
 * craft.* PoC — клиент control-канала SolidCraft (docs/control-protocol.md).
 * JSON-lines на 127.0.0.1:PORT; первая строка соединения несёт "token"
 * из %LOCALAPPDATA%\SolidCraft\control\PORT.token (SOLIDCRAFT_CONTROL_DIR
 * переопределяет каталог). Ответ: {"id":N,"ok":true,"result":…}
 * | {"id":N,"ok":false,"error":"…"}; running:true сохраняет вызов pending
 * в пределах bounded deadline. Локальный deadline очищает вызов без retry.
 * PoC: только транспорт + методы, без MCP/интеграции.
 */
import { readFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

const DEFAULT_CALL_TIMEOUT_MS = 60_000;
const MAX_CALL_TIMEOUT_MS = 3_600_000;
const MAX_CONTROL_FRAME_BYTES = 16 * 1024 * 1024;

export function tokenPathFor(port, dir) {
  const base =
    dir ??
    process.env.SOLIDCRAFT_CONTROL_DIR ??
    join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'SolidCraft', 'control');
  return join(base, `${port}.token`);
}

export class CraftAdapter {
  #token;
  #socket = null;
  #buffer = '';
  #decoder = new StringDecoder('utf8');
  #nextId = 1;
  #authed = false;
  #pending = new Map(); // id -> {resolve, reject, timer, deadline, absoluteDeadline, method}

  constructor(token) {
    if (token) this.#token = token;
    else {
      const t = process.env.SOLIDCRAFT_CONTROL_TOKEN;
      if (!t) throw new Error('no token: pass one or set SOLIDCRAFT_CONTROL_TOKEN / use fromTokenFile');
      this.#token = t;
    }
  }

  static fromTokenFile(port, dir) {
    return new CraftAdapter(readFileSync(tokenPathFor(port, dir), 'utf8').trim());
  }

  async connect(port, host = '127.0.0.1') {
    const socket = new Socket();
    socket.setNoDelay(true);
    this.#buffer = '';
    this.#decoder = new StringDecoder('utf8');
    socket.on('data', (chunk) => this.#onData(chunk));
    socket.on('close', () => this.#failAll(new Error('control channel closed')));
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
      socket.connect(port, host);
    });
    socket.on('error', () => {}); // после подключения ошибки гасит 'close' → #failAll
    this.#socket = socket;
    return this;
  }

  #onData(chunk) {
    this.#buffer += this.#decoder.write(chunk);
    for (;;) {
      const nl = this.#buffer.indexOf('\n');
      if (nl < 0) return;
      let line = this.#buffer.slice(0, nl);
      this.#buffer = this.#buffer.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.trim()) continue;

      let reply;
      try {
        reply = JSON.parse(line);
      } catch {
        this.#failProtocol('invalid JSON frame');
        return;
      }
      if (
        reply === null ||
        typeof reply !== 'object' ||
        Array.isArray(reply) ||
        !Number.isSafeInteger(reply.id) ||
        reply.id < 1
      ) {
        this.#failProtocol('invalid protocol frame');
        return;
      }

      const waiter = this.#pending.get(reply.id);
      if (!waiter) continue;
      if (reply.running === true) {
        this.#extendDeadline(reply.id, waiter);
        continue;
      }
      this.#settle(reply.id, 'resolve', reply);
    }
  }

  #failProtocol(message) {
    const socket = this.#socket;
    this.#failAll(new Error(message));
    socket?.destroy();
  }

  #extendDeadline(id, waiter) {
    const now = Date.now();
    if (now >= waiter.absoluteDeadline) return;
    waiter.deadline = waiter.absoluteDeadline;
    clearTimeout(waiter.timer);
    waiter.timer = setTimeout(() => this.#timeout(id), waiter.deadline - now);
  }

  #timeout(id) {
    const waiter = this.#pending.get(id);
    if (!waiter) return;
    this.#settle(id, 'reject', Object.assign(new Error('control call timed out'), {
      code: 'control_timeout',
      opId: id,
      method: waiter.method,
    }));
  }

  #settle(id, outcome, value) {
    const waiter = this.#pending.get(id);
    if (!waiter) return;
    this.#pending.delete(id);
    clearTimeout(waiter.timer);
    waiter[outcome](value);
  }

  #failAll(err) {
    this.#socket = null;
    this.#buffer = '';
    this.#decoder = new StringDecoder('utf8');
    for (const w of this.#pending.values()) {
      clearTimeout(w.timer);
      w.reject(err);
    }
    this.#pending.clear();
  }

  /** Один запрос — одна строка. Ответ busy сохраняется; локальный timeout без retry. */
  call(method, params = {}, options = {}) {
    const socket = this.#socket;
    if (!socket) return Promise.reject(new Error('not connected'));
    const isBatch = method === 'engine.batch' ||
      (method === 'engine.execute' && params?.command === 'engine.batch');
    const timeoutMs = options.timeoutMs ?? (isBatch ? MAX_CALL_TIMEOUT_MS : DEFAULT_CALL_TIMEOUT_MS);
    const maxTimeoutMs = options.maxTimeoutMs ?? timeoutMs;
    if (
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > MAX_CALL_TIMEOUT_MS ||
      !Number.isFinite(maxTimeoutMs) ||
      maxTimeoutMs < timeoutMs ||
      maxTimeoutMs > MAX_CALL_TIMEOUT_MS
    ) {
      return Promise.reject(new RangeError('invalid control call deadline'));
    }

    const id = this.#nextId++;
    const req = { id, method, params };
    if (!this.#authed) req.token = this.#token;
    const line = JSON.stringify(req) + '\n';
    if (Buffer.byteLength(line) > MAX_CONTROL_FRAME_BYTES) {
      return Promise.reject(new RangeError('control request exceeds 16 MiB'));
    }
    this.#authed = true;
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const waiter = {
        resolve,
        reject,
        method,
        timeoutMs,
        deadline: startedAt + timeoutMs,
        absoluteDeadline: startedAt + maxTimeoutMs,
        timer: null,
      };
      waiter.timer = setTimeout(() => this.#timeout(id), timeoutMs);
      this.#pending.set(id, waiter);
      try {
        socket.write(line, (error) => {
          if (error) this.#settle(id, 'reject', new Error('control channel write failed'));
        });
      } catch {
        this.#settle(id, 'reject', new Error('control channel write failed'));
      }
    });
  }

  get pendingCount() {
    return this.#pending.size;
  }

  uiInspect() {
    return this.call('ui.inspect');
  }

  engineCommands() {
    return this.call('engine.commands');
  }

  engineExecute(command, params = {}, allowPaths, options = {}) {
    return this.call('engine.execute', {
      command,
      params,
      ...(allowPaths ? { allow_paths: allowPaths } : {}),
    }, options);
  }

  /** Статус своего pending-запроса после timeout-ответа (→ done+reply). */
  controlPending() {
    return this.call('control.pending');
  }

  controlRunning() {
    return this.call('control.running');
  }

  close() {
    this.#socket?.destroy();
    this.#failAll(new Error('adapter closed'));
  }
}

// --- smoke CLI: node craft-adapter.mjs <port> --------------------------------
// Автономный прогон против живого приложения (app должен быть запущен).
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const port = Number(process.argv[2] ?? 27990);
  const adapter = CraftAdapter.fromTokenFile(port);
  await adapter.connect(port);
  console.log('ui.inspect →', JSON.stringify((await adapter.uiInspect()).result ?? {}).slice(0, 400));
  console.log('engine.commands →', (await adapter.engineCommands()).ok ? 'ok' : 'FAIL');
  console.log('control.pending →', JSON.stringify(await adapter.controlPending()));
  adapter.close();
}
