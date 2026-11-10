'use client';

/**
 * OpenCode seam — клиент к сервису OpenCode (v2.0.32).
 * Эндпоинты и формы ответов сняты с живого OpenAPI (/openapi.json) на
 * managed-сервисе :45278. Ответы обёрнуты в { location?, data } — seam
 * разворачивает data. При недоступности сервиса / 401 — reject → экраны
 * показывают honest error/unavailable, мок не имитирует живой OpenCode.
 *
 * Спека: docs/product/opencode-integration-spec.md (Фаза 0).
 */

export interface OpenCodeSession { id: string; title?: string; directory?: string; projectID?: string }
export interface OpenCodeModel { id: string; name: string; provider?: string; providerID?: string }
export interface OpenCodeMcpServer { name: string; url?: string; connected?: boolean }
export interface OpenCodeCommand { id: string; label: string; name?: string; description?: string }

export interface OpenCodeSeam {
  info(): Promise<{ version: string; healthy: boolean }>;
  listSessions(): Promise<OpenCodeSession[]>;
  listModels(): Promise<OpenCodeModel[]>;
  listMcpServers(): Promise<OpenCodeMcpServer[]>;
  listCommands(): Promise<OpenCodeCommand[]>;
  listSkills(): Promise<{ id: string; name: string; description?: string }[]>;
  listProviders(): Promise<{ id: string; name: string }[]>;
}

const TIMEOUT_MS = 8000;

function baseUrl(): string {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_OPENCODE_URL) {
    return process.env.NEXT_PUBLIC_OPENCODE_URL.replace(/\/$/, '');
  }
  return 'http://127.0.0.1:4096';
}

function authHeader(): Record<string, string> {
  const pw = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_OPENCODE_PASSWORD) || '';
  if (!pw) return {};
  const cred = btoa(`opencode:${pw}`);
  return { authorization: `Basic ${cred}` };
}

async function request<T>(path: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', ...authHeader() },
    });
    if (!res.ok) throw new Error(`OpenCode ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

function unwrap<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  const obj = r as { data?: T[] } | null;
  return Array.isArray(obj?.data) ? obj.data : [];
}

export function createOpenCodeSeam(url?: string): OpenCodeSeam {
  const b = (url ?? baseUrl()).replace(/\/$/, '');
  const req = <T>(path: string) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    return fetch(`${b}${path}`, { signal: ctrl.signal, headers: { accept: 'application/json', ...authHeader() } })
      .then((res) => {
        clearTimeout(t);
        if (!res.ok) throw new Error(`OpenCode ${path}: HTTP ${res.status}`);
        return res.json() as Promise<T>;
      })
      .catch((e) => { clearTimeout(t); throw e; });
  };
  return {
    async info() {
      const r = await req<{ version?: string; healthy?: boolean }>('/api/info');
      return { version: (r as { version?: string }).version ?? 'unknown', healthy: (r as { healthy?: boolean }).healthy !== false };
    },
    async listSessions() {
      const r = await req<unknown>('/api/session');
      return unwrap<OpenCodeSession>(r).map((s) => ({ id: s.id, title: s.title, directory: s.directory, projectID: s.projectID }));
    },
    async listModels() {
      const r = await req<unknown>('/api/model');
      return unwrap<OpenCodeModel>(r).map((m) => ({ id: m.id ?? (m as { modelID?: string }).modelID ?? '', name: m.name ?? m.id ?? (m as { modelID?: string }).modelID ?? '', provider: m.provider ?? m.providerID }));
    },
    async listMcpServers() {
      const r = await req<unknown>('/api/mcp');
      return unwrap<OpenCodeMcpServer>(r).map((s) => ({ name: s.name, url: s.url, connected: s.connected }));
    },
    async listCommands() {
      const r = await req<unknown>('/api/command');
      return unwrap<{ name?: string; description?: string }>(r).map((c) => ({ id: c.name ?? '', label: c.description ? `${c.name} — ${c.description}` : (c.name ?? ''), name: c.name, description: c.description }));
    },
    async listSkills() {
      const r = await req<unknown>('/api/skill');
      return unwrap<{ id?: string; name?: string; description?: string }>(r).map((s) => ({ id: s.id ?? s.name ?? '', name: s.name ?? s.id ?? '', description: s.description }));
    },
    async listProviders() {
      const r = await req<unknown>('/api/provider');
      return unwrap<{ id?: string; name?: string }>(r).map((p) => ({ id: p.id ?? '', name: p.name ?? p.id ?? '' }));
    },
  };
}

export function openCodeSeamFromEnv(): OpenCodeSeam | undefined {
  const url = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_OPENCODE_URL) || '';
  if (!url) return undefined;
  return createOpenCodeSeam(url);
}