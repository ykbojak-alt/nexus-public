/**
 * NUE gateway auth — вынесено из data-source.ts в отдельный ленивый модуль
 * (perf-budget: уменьшает shared-чанк /_not-found; модуль грузится только
 * при первом фактическом fetch-запросе через createNueAuthFetch).
 */
const AI2_API_KEY_STORAGE_KEY = 'nexus.ai2.apiKey';
const NUE_CLIENT_KEY_PATTERN = /^nue_[a-f0-9]+$/i;
let nueRegisterToken: string | null = null;

/** Raised when the gateway requires its optional registration guard token. */
export class NueRegisterTokenRequiredError extends Error {
  readonly code = 'nue_register_token_required';

  constructor() {
    super('NUE registration requires a register token. Enter the token and retry.');
    this.name = 'NueRegisterTokenRequiredError';
  }
}

class NueGatewayUnavailableError extends Error {}

/** Read the client key without making browser storage a server-side dependency. */
export function getAi2ApiKey(): string | null {
  try {
    const value = globalThis.localStorage?.getItem(AI2_API_KEY_STORAGE_KEY)?.trim();
    if (!value) return null;
    if (/^nue_/i.test(value) && !NUE_CLIENT_KEY_PATTERN.test(value)) {
      globalThis.localStorage?.removeItem(AI2_API_KEY_STORAGE_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

/** Store or clear the client key. Register tokens are intentionally memory-only. */
export function setAi2ApiKey(value: string | null | undefined): void {
  const key = value?.trim() ?? '';
  if (/^nue_/i.test(key) && !NUE_CLIENT_KEY_PATTERN.test(key)) {
    throw new Error('Invalid NUE client key format.');
  }
  try {
    if (key) globalThis.localStorage?.setItem(AI2_API_KEY_STORAGE_KEY, key);
    else globalThis.localStorage?.removeItem(AI2_API_KEY_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (privacy mode/embedded webview). The current
    // request can still use the in-memory key path only when storage succeeds;
    // do not turn an otherwise usable source into a crash.
  }
}

/** Keep the optional registration guard out of persistent browser storage. */
export function setNueRegisterToken(value: string | null | undefined): void {
  nueRegisterToken = value?.trim() || null;
}

/** Register a client key with a NexusLink NUE gateway. */
export async function registerNueKey(
  baseUrl: string,
  registerToken?: string,
  fetchImpl?: typeof fetch,
): Promise<string> {
  const headers = new Headers();
  if (registerToken?.trim()) headers.set('X-Register-Token', registerToken.trim());
  const fetcher = fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const response = await fetcher(new URL('/nue/register', baseUrl), {
    method: 'POST',
    headers,
  });
  if (response.status === 401) throw new NueRegisterTokenRequiredError();
  // Прямой хост без NUE-шлюза: нет роута → фреймворк отдаёт 405 (allow: GET)
  // или 404. Оба варианта — «шлюз недоступен», запросы идут без gateway-auth.
  if (response.status === 404 || response.status === 405) throw new NueGatewayUnavailableError('NUE registration route is unavailable.');
  if (!response.ok) throw new Error(`NUE registration failed with HTTP ${response.status}.`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('NUE registration returned invalid JSON.');
  }
  const key = payload && typeof payload === 'object' && 'key' in payload
    ? (payload as { key?: unknown }).key
    : undefined;
  if (typeof key !== 'string' || !NUE_CLIENT_KEY_PATTERN.test(key)) {
    throw new Error('NUE registration returned an invalid NUE key.');
  }
  setAi2ApiKey(key);
  return key;
}

/**
 * Fetch adapter for the live AI-2 client. Registration is lazy and shared by
 * concurrent first requests. A direct AI-2 host has no /nue/register route
 * (404 или 405); it is remembered and requests continue without gateway auth.
 */
export function createNueAuthFetch(baseUrl: string, fetchImpl?: typeof fetch): typeof fetch {
  let gatewayUnavailable = false;
  let registration: Promise<string | null> | null = null;
  const fetcher = fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));

  const requestPath = (input: RequestInfo | URL): string => {
    try {
      const url = input instanceof Request ? input.url : String(input);
      return new URL(url, baseUrl || globalThis.location?.href).pathname;
    } catch {
      return '';
    }
  };

  const getOrRegisterKey = async (): Promise<string | null> => {
    const stored = getAi2ApiKey();
    if (stored) return stored;
    if (gatewayUnavailable) return null;
    registration ??= registerNueKey(
      baseUrl || globalThis.location?.origin || '',
      nueRegisterToken ?? undefined,
      fetcher,
    )
      .catch((error: unknown) => {
        if (error instanceof NueGatewayUnavailableError) {
          gatewayUnavailable = true;
          return null;
        }
        throw error;
      })
      .finally(() => { registration = null; });
    return registration;
  };

  const send = async (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    key: string | null,
  ): Promise<Response> => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    if (key) headers.set('Authorization', `Bearer ${key}`);
    else headers.delete('Authorization');
    return fetcher(input, { ...init, headers });
  };

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!requestPath(input).startsWith('/v1/')) return fetcher(input, init);
    const key = await getOrRegisterKey();
    const response = await send(input, init, key);
    if (response.status !== 401 || !key || !NUE_CLIENT_KEY_PATTERN.test(key)) return response;

    // A revoked/lost key gets exactly one register + original-request retry.
    await response.body?.cancel().catch(() => undefined);
    setAi2ApiKey(null);
    const refreshed = await getOrRegisterKey();
    return send(input, init, refreshed);
  }) as typeof fetch;
}
