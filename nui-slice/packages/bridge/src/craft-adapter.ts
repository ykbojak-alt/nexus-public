/**
 * craft.* PoC — клиент control-канала SolidCraft (docs/control-protocol.md).
 * JSON-lines на 127.0.0.1:PORT; первая строка соединения несёт "token"
 * из %LOCALAPPDATA%\SolidCraft\control\PORT.token; ответ:
 * {"id":N,"ok":true,"result":…} | {"id":N,"ok":false,"error":"…"}.
 * PoC: без Nx-интеграции, без MCP-слоя — только транспорт + методы.
 */
import { readFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ControlReply {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
  /** Таймаут ≠ провал: запрос продолжает исполняться (см. control.pending). */
  running?: boolean;
  /** Пока идёт другой запрос этого соединения — отклонено сразу. */
  busy?: boolean;
}

/** Путь токена: SOLIDCRAFT_CONTROL_DIR переопределяет, иначе %LOCALAPPDATA%. */
export function tokenPathFor(port: number, dir?: string): string {
  const base =
    dir ??
    process.env.SOLIDCRAFT_CONTROL_DIR ??
    join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'SolidCraft', 'control');
  return join(base, `${port}.token`);
}

export class CraftAdapter {
  private socket: Socket | null = null;
  private buffer = '';
  private nextId = 1;
  private authed = false;
  private readonly pending = new Map<
    number,
    { resolve: (r: ControlReply) => void; reject: (e: Error) => void }
  >();

  private constructor(private readonly token: string) {}

  static fromTokenFile(port: number, dir?: string): CraftAdapter {
    return new CraftAdapter(readFileSync(tokenPathFor(port, dir), 'utf8').trim());
  }

  /** Для харнесса/песочницы: токен из SOLIDCRAFT_CONTROL_TOKEN или явно. */
  static withToken(token: string): CraftAdapter {
    return new CraftAdapter(token);
  }

  connect(port: number, host = '127.0.0.1'): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host, port });
      socket.setNoDelay(true);
      socket.once('error', reject);
      socket.once('connect', () => {
        this.socket = socket;
        socket.on('data', (chunk) => this.onData(chunk.toString('utf8')));
        socket.on('close', () => this.failAll(new Error('control channel closed')));
        resolve();
      });
    });
  }

  private onData(text: string): void {
    this.buffer += text;
    for (;;) {
      const nl = this.buffer.indexOf('\n');
      if (nl < 0) return;
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      const reply = JSON.parse(line) as ControlReply;
      const waiter = this.pending.get(reply.id);
      if (waiter) {
        this.pending.delete(reply.id);
        waiter.resolve(reply);
      }
    }
  }

  private failAll(err: Error): void {
    this.socket = null;
    for (const waiter of this.pending.values()) waiter.reject(err);
    this.pending.clear();
  }

  /** Один запрос — одна строка. busy/timeout приходят как ok:false — не ретраим. */
  call(method: string, params: Record<string, unknown> = {}): Promise<ControlReply> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error('not connected'));
    const id = this.nextId++;
    const request: Record<string, unknown> = { id, method, params };
    if (!this.authed) {
      request.token = this.token;
      this.authed = true;
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      socket.write(JSON.stringify(request) + '\n');
    });
  }

  uiInspect(): Promise<ControlReply> {
    return this.call('ui.inspect');
  }

  engineCommands(): Promise<ControlReply> {
    return this.call('engine.commands');
  }

  engineExecute(command: string, params: Record<string, unknown> = {}, allowPaths?: string[]): Promise<ControlReply> {
    return this.call('engine.execute', { command, params, ...(allowPaths ? { allow_paths: allowPaths } : {}) });
  }

  controlRunning(): Promise<ControlReply> {
    return this.call('control.running');
  }

  close(): void {
    this.socket?.destroy();
    this.failAll(new Error('adapter closed'));
  }
}
