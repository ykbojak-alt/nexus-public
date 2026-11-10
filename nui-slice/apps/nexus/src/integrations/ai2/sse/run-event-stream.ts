import { createSseParser, type SseFrame } from './parser';
import { mapRunEvent } from '../api/client';
import { Ai2ApiError } from '../api/errors';
import type { Ai2ErrorBody } from '../contracts/common';
import type { Ai2RunEvent } from '../contracts/runs';

/**
 * Resilient SSE consumer for GET /v1/runs/{id}/stream (Task 6).
 *
 * Server framing (server/app.py `sse_frame`): persisted events carry
 * `id: {seq}` + `event: {type}` + one-line JSON `data` containing the
 * full event; ephemeral `model_delta` frames have no id; the terminal
 * frame is `event: end`. Reconnect sends `Last-Event-ID` (server prefers
 * it over ?after=).
 *
 * Guarantees:
 * - persisted events delivered once (seq <= cursor suppressed);
 * - a forward seq gap emits a typed `stream_gap` diagnostic event;
 * - ephemeral frames pass through without touching the cursor;
 * - `end` frame completes the iterable; a drop without `end` triggers
 *   reconnect (bounded by `maxReconnects`, delay `reconnectDelayMs`).
 *
 * Hardening (INT‑review):
 * - AbortSignal is checked inside the inner read loop (prevents hanging
 *   if signal fires while awaiting reader.read);
 * - each fetch request has a timeout guard via AbortSignal.timeout()
 *   (falls back to AbortController + setTimeout for browsers that lack
 *   signal.timeout, e.g., old Safari). The client default is 15000 ms.
 */

export interface StreamRunEventsOptions {
  runId: string;
  /** '' for same-origin (desktop static build) or http://127.0.0.1:PORT. */
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** AbortSignal to stop the stream. */
  signal?: AbortSignal;
  /** Resume cursor — sent as Last-Event-ID on the first request. */
  lastSeq?: number;
  /** ?after= fallback when no Last-Event-ID is set. */
  after?: number;
  /** Reconnect attempts after a drop. Default 5. */
  maxReconnects?: number;
  /** Delay before reconnect, ms or function of attempt index. Default 250·2^n. */
  reconnectDelayMs?: number | ((attempt: number) => number);
  /**
   * Request timeout in milliseconds — overrides any global client timeout
   * from the caller (Ai2Client). Defaults to 15000 ms for SSE requests.
   */
  timeoutMs?: number;
  /**
   * Idle timeout: maximum time to wait between two chunks. If no data arrives
   * within this window, the stream is aborted with a TimeoutError instead of
   * hanging forever on reader.read(). Default: 30000 ms.
   */
  idleTimeoutMs?: number;
}

const DEFAULT_MAX_RECONNECTS = 5;
const DEFAULT_SSE_TIMEOUT_MS = 15_000; // 15 seconds — enough for long‑poll with 30‑s server timeout
const DEFAULT_IDLE_TIMEOUT_MS = 30_000; // idle watchdog: no chunk for N ms -> abort

export async function* streamRunEvents(
  options: StreamRunEventsOptions,
): AsyncIterable<Ai2RunEvent> {
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
  const maxReconnects = options.maxReconnects ?? DEFAULT_MAX_RECONNECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SSE_TIMEOUT_MS;
  let lastSeq = options.lastSeq ?? -1;
  let sawEnd = false;
  let attempt = 0;

  while (!sawEnd) {
    if (options.signal?.aborted) return;

    const headers = new Headers({ accept: 'text/event-stream' });
    if (options.apiKey) headers.set('Authorization', `Bearer ${options.apiKey}`);
    if (lastSeq >= 0) headers.set('Last-Event-ID', String(lastSeq));

    const url = new URL(`${baseUrl}/v1/runs/${encodeURIComponent(options.runId)}/stream`,
      baseUrl ? undefined : globalThis.location?.href);
    if (lastSeq < 0 && options.after !== undefined) {
      url.searchParams.set('after', String(options.after));
    }

    let res: Response;
    try {
      // Guard against indefinite hangs: wrap the fetch with an explicit timeout.
      const ac = new AbortController();
      const timeoutId = setTimeout(() => ac.abort(new DOMException('The operation timed out.', 'TimeoutError')), timeoutMs);
      // If the caller provided a signal, link it.
      if (options.signal) {
        options.signal.addEventListener('abort', () => ac.abort(options.signal?.reason));
      }
      const fetchSignal = ac.signal;
      try {
        res = await fetchImpl(url, { headers, signal: fetchSignal });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      if (options.signal?.aborted) return;
      if (attempt++ >= maxReconnects) throw err;
      await delay(reconnectDelay(options.reconnectDelayMs, attempt), options.signal);
      continue;
    }

    if (!res.ok) {
      const body = await safeError(res);
      // 4xx is a definitive answer (auth, missing run) — don't retry
      if (res.status < 500 || attempt++ >= maxReconnects) {
        throw new Ai2ApiError(res.status, body);
      }
      await delay(reconnectDelay(options.reconnectDelayMs, attempt), options.signal);
      continue;
    }

    if (!res.body) return;
    const reader = res.body.getReader();
    const parser = createSseParser();
    const decoder = new TextDecoder();
    const idleMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

    try {
      for (; ;) {
        // Abort signal can fire while awaiting reader.read() — aborting the
        // fetch closes the body stream, so read() resolves and we exit below.
        // Idle watchdog: each read() gets its own timer. If no chunk arrives
        // within idleMs, cancel the reader and reject with TimeoutError — so
        // the caller (adapter) can flip the run out of 'running' instead of
        // hanging forever on a stalled body.
        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        const onCallerAbort = () => {
          if (idleTimer) clearTimeout(idleTimer);
        };
        options.signal?.addEventListener('abort', onCallerAbort, { once: true });

        let readResult: { done: boolean; value?: Uint8Array };
        try {
          readResult = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => {
              idleTimer = setTimeout(() => {
                // reader.read() висит дальше — его дождётся finally (releaseLock +
                // res.body.cancel()). Главное —レース выиграл reject, а не done.
                reject(
                  new DOMException(
                    `SSE idle timeout: no data for ${idleMs}ms`,
                    'TimeoutError',
                  ),
                );
              }, idleMs);
            }),
          ]);
        } catch (err) {
          if (idleTimer) clearTimeout(idleTimer);
          options.signal?.removeEventListener('abort', onCallerAbort);
          throw err;
        }
        if (idleTimer) clearTimeout(idleTimer);
        options.signal?.removeEventListener('abort', onCallerAbort);

        const { done, value } = readResult;
        if (options.signal?.aborted) return;
        const frames = done
          ? parser.end()
          : parser.feed(decoder.decode(value, { stream: true }));
        for (const f of frames) {
          for (const out of translate(f, lastSeq)) {
            if (out.seq !== undefined) lastSeq = out.seq;
            yield out;
            if (out.type === 'end') {
              sawEnd = true;
              break;
            }
          }
          if (sawEnd) break;
        }
        if (done || sawEnd) break;
      }
    } finally {
      reader.releaseLock();
      await res.body.cancel().catch(() => undefined);
    }

    if (sawEnd) return;
    // Stream ended without `end` — the connection dropped; reconnect.
    if (attempt++ >= maxReconnects) return;
    await delay(reconnectDelay(options.reconnectDelayMs, attempt), options.signal);
  }
}

/**
 * Frame → public events (0, 1, or 2). Empty for comment-only frames and
 * replayed seqs; a forward gap prepends a typed `stream_gap` event whose
 * `seq` is the first missing sequence number.
 */
function translate(f: SseFrame, lastSeq: number): Ai2RunEvent[] {
  const parsed = parseData(f.data);
  if (f.event === 'end') {
    return [{
      type: 'end',
      runId: parsed?.run_id as string | undefined,
      status: parsed?.status as string | undefined,
      stopReason: (parsed?.stop_reason as string | null | undefined) ?? undefined,
    }];
  }
  if (f.id === undefined) {
    // Ephemeral frame (model_delta and friends) — passthrough payload.
    return [{ type: f.event, ...(parsed ?? { text: f.data }) }];
  }
  const seq = Number.parseInt(f.id, 10);
  if (!Number.isFinite(seq)) return [];
  if (seq <= lastSeq) return []; // replayed on reconnect
  const event = parsed ? mapRunEvent(parsed) : { type: f.event };
  const out: Ai2RunEvent[] = [];
  if (seq > lastSeq + 1 && lastSeq >= 0) {
    out.push({
      type: 'stream_gap',
      seq: lastSeq + 1,
      expectedSeq: lastSeq + 1,
      receivedSeq: seq,
    });
  }
  out.push({ ...event, seq, type: event.type === 'message' ? f.event : event.type });
  return out;
}

function parseData(data: string): Record<string, unknown> | undefined {
  if (!data) return undefined;
  try {
    const v: unknown = JSON.parse(data);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function reconnectDelay(
  spec: number | ((attempt: number) => number) | undefined,
  attempt: number,
): number {
  if (typeof spec === 'function') return spec(attempt);
  if (typeof spec === 'number') return spec;
  return Math.min(250 * 2 ** (attempt - 1), 5000);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

async function safeError(res: Response): Promise<Partial<Ai2ErrorBody> | undefined> {
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as Partial<Ai2ErrorBody>) : undefined;
  } catch {
    return undefined;
  }
}