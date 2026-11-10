import { describe, expect, it, vi } from 'vitest';
import { streamRunEvents, type StreamRunEventsOptions } from './run-event-stream';
import type { Ai2RunEvent } from '../contracts/runs';

const BASE = 'http://ai2.test';

function sse(frames: string): Response {
  return new Response(frames, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function frame(seq: number, type: string, data: Record<string, unknown> = {}): string {
  return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify({ seq, type, ...data })}\n\n`;
}

function chunkedResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function collect(
  iterable: AsyncIterable<Ai2RunEvent>,
): Promise<Ai2RunEvent[]> {
  const out: Ai2RunEvent[] = [];
  for await (const e of iterable) out.push(e);
  return out;
}

function fixtureFetch(responders: Array<() => Response>) {
  const seen: { url: string; headers: Headers }[] = [];
  let i = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    seen.push({ url: req.url, headers: req.headers });
    const respond = responders[Math.min(i++, responders.length - 1)];
    return respond();
  }) as typeof fetch;
  return { seen, fetchImpl };
}

const baseOpts = (
  fetchImpl: typeof fetch,
  extra: Partial<StreamRunEventsOptions> = {},
): StreamRunEventsOptions => ({
  runId: 'r1', baseUrl: BASE, fetchImpl, reconnectDelayMs: 0, maxReconnects: 3, ...extra,
});

describe('streamRunEvents (Task 6)', () => {
  it('yields persisted events and stops on the terminal end frame', async () => {
    const { fetchImpl } = fixtureFetch([() => sse(
      frame(1, 'step', { n: 1 }) +
      frame(2, 'final', { answer: 'done' }) +
      'event: end\ndata: {"run_id":"r1","status":"done","stop_reason":null}\n\n' +
      frame(3, 'step', { n: 99 }), // anything after end must not be delivered
    )]);
    const events = await collect(streamRunEvents(baseOpts(fetchImpl)));
    expect(events.map((e) => e.type)).toEqual(['step', 'final', 'end']);
  });

  it('reconnects with Last-Event-ID and suppresses duplicate persisted events', async () => {
    const { seen, fetchImpl } = fixtureFetch([
      // first connection: seq 6,7 then drops (no end frame)
      () => sse(frame(6, 'step') + frame(7, 'step')),
      // reconnect: server replays 7 then continues
      () => sse(frame(7, 'step') + frame(8, 'final') +
        'event: end\ndata: {"run_id":"r1","status":"done"}\n\n'),
    ]);
    const events = await collect(streamRunEvents(baseOpts(fetchImpl)));
    expect(events.filter((e) => e.seq === 7)).toHaveLength(1);
    expect(seen).toHaveLength(2);
    expect(seen[1].headers.get('Last-Event-ID')).toBe('7');
    expect(events.filter((e) => e.seq !== undefined).map((e) => e.seq)).toEqual([6, 7, 8]);
  });

  it('surfaces a sequence gap instead of hiding it', async () => {
    const { fetchImpl } = fixtureFetch([() => sse(
      frame(1, 'step') + frame(3, 'step') +
      'event: end\ndata: {"run_id":"r1","status":"done"}\n\n',
    )]);
    const events = await collect(streamRunEvents(baseOpts(fetchImpl)));
    const gap = events.find((e) => e.type === 'stream_gap');
    expect(gap).toBeTruthy();
    expect(gap!.expectedSeq).toBe(2);
    expect(gap!.receivedSeq).toBe(3);
    expect(events.filter((e) => e.seq !== undefined && e.type !== 'stream_gap')
      .map((e) => e.seq)).toEqual([1, 3]);
  });

  it('parses multi-line data, comments and CRLF', async () => {
    const body = `: heartbeat comment\r\nid: 1\r\nevent: step\r\ndata: {"type":"step","seq":1,\r\ndata: "x":true}\r\n\r\n` +
      'event: end\ndata: {"run_id":"r1","status":"done"}\n\n';
    const { fetchImpl } = fixtureFetch([() => chunkedResponse([body])]);
    const events = await collect(streamRunEvents(baseOpts(fetchImpl)));
    expect(events[0]).toMatchObject({ seq: 1, type: 'step', x: true });
    expect(events.at(-1)!.type).toBe('end');
  });

  it('aborts reader.read() by idle timeout instead of hanging forever', async () => {
    // Сервер отдаёт 200 OK с телом, но никогда не шлёт чанки и не закрывает поток:
    // читатель зависает навсегда, если нет idle watchdog.
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start() {
        // intentionally never enqueue anything and never close
      },
      cancel,
    });
    const hang = new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const { fetchImpl } = fixtureFetch([() => hang]);

    await expect(
      collect(streamRunEvents(baseOpts(fetchImpl, { idleTimeoutMs: 20 }))),
    ).rejects.toThrow('SSE idle timeout');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('idle timer resets on each chunk — fast stream never times out', async () => {
    const { fetchImpl } = fixtureFetch([() =>
      chunkedResponse([
        frame(1, 'step', { n: 1 }),
        frame(2, 'step', { n: 2 }),
        'event: end\ndata: {"run_id":"r1","status":"done"}\n\n',
      ])]);
    const events = await collect(streamRunEvents(baseOpts(fetchImpl, { idleTimeoutMs: 5 })));
    expect(events.map((e) => e.type)).toEqual(['step', 'step', 'end']);
  });

  it('forwards ephemeral model_delta frames without moving the cursor', async () => {
    const { seen, fetchImpl } = fixtureFetch([
      () => sse(
        frame(4, 'step') +
        'event: model_delta\ndata: {"text":"hel"}\n\n' +
        'event: model_delta\ndata: {"text":"lo"}\n\n',
      ),
      () => sse('event: end\ndata: {"run_id":"r1","status":"done"}\n\n'),
    ]);
    const events = await collect(streamRunEvents(baseOpts(fetchImpl)));
    const deltas = events.filter((e) => e.type === 'model_delta');
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({ text: 'hel' });
    // cursor stays at last persisted seq → reconnect asks from 4
    expect(seen[1].headers.get('Last-Event-ID')).toBe('4');
  });

  it('honours an initial after/lastSeq cursor on the first request', async () => {
    const { seen, fetchImpl } = fixtureFetch([
      () => sse('event: end\ndata: {"run_id":"r1","status":"done"}\n\n'),
    ]);
    await collect(streamRunEvents(baseOpts(fetchImpl, { lastSeq: 11 })));
    expect(seen[0].headers.get('Last-Event-ID')).toBe('11');
  });

  it('aborts cleanly when the signal fires', async () => {
    const ac = new AbortController();
    ac.abort();
    const { fetchImpl } = fixtureFetch([() => sse('')]);
    const events = await collect(streamRunEvents(baseOpts(fetchImpl, { signal: ac.signal })));
    expect(events).toEqual([]);
  });
});
