/**
 * Incremental SSE parser (Task 6) — WHATWG event-stream syntax:
 * `field: value` lines, blank line dispatches the event, `:` lines are
 * comments/heartbeats, multi-line `data:` joins with \n. Handles CRLF
 * and chunk boundaries (feed() keeps the incomplete tail).
 *
 * Hardening (INT-review pass):
 * - bounded buffering: a peer that never sends a newline must not grow us
 *   without bound — `feed()` throws `SseOverflowError` past
 *   MAX_BUFFER_CHARS instead of degrading into OOM;
 * - a CR at the end of a chunk is no longer consumed as a terminator:
 *   a CRLF split across chunks used to emit a premature blank line, which
 *   flushed `id:`-only state and silently dropped that frame's seq (then
 *   duplicate suppression on reconnect misbehaved);
 * - lines are cut in one pass per chunk instead of re-slicing the buffer
 *   after every line (was O(lines × buffer) on large frames).
 */

export interface SseFrame {
  /** Last `id:` value seen in the frame; absent for ephemeral frames. */
  id?: string;
  /** `event:` value; defaults to `message` per spec. */
  event: string;
  /** Joined `data:` lines. */
  data: string;
}

/** Guard against unbounded buffering of a never-terminated line. */
export const MAX_BUFFER_CHARS = 1_048_576; // 1 MiB — far above any real AI-2 frame

/** Thrown when a peer streams more than MAX_BUFFER_CHARS without a line break. */
export class SseOverflowError extends Error {
  constructor(public readonly limit: number) {
    super(`SSE frame exceeded ${limit} chars without a line break`);
    this.name = 'SseOverflowError';
  }
}

export function createSseParser(): {
  feed(chunk: string): SseFrame[];
  end(): SseFrame[];
} {
  let buffer = '';
  let dataLines: string[] = [];
  let eventType: string | undefined;
  let frameId: string | undefined;
  // AI-2 contract: `id:` marks a frame as persisted (carries its seq);
  // ephemeral frames (model_delta) have no `id:` line at all. Per-frame
  // id, not the stream-persistent WHATWG buffer — otherwise deltas would
  // inherit the previous event's seq and get dropped as duplicates.
  const hasPending = () => dataLines.length > 0 || eventType !== undefined || frameId !== undefined;

  function resetFrameState(): void {
    dataLines = [];
    eventType = undefined;
    frameId = undefined;
  }

  function fail(): never {
    buffer = '';
    resetFrameState();
    throw new SseOverflowError(MAX_BUFFER_CHARS);
  }

  function dispatch(out: SseFrame[]): void {
    if (dataLines.length === 0) {
      // comment/heartbeat or field-less frame — nothing to emit
      resetFrameState();
      return;
    }
    out.push({ id: frameId, event: eventType ?? 'message', data: dataLines.join('\n') });
    resetFrameState();
  }

  function processLine(line: string, out: SseFrame[]): void {
    if (line === '') {
      dispatch(out);
      return;
    }
    if (line.startsWith(':')) return; // comment / heartbeat
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'data':
        dataLines.push(value);
        break;
      case 'event':
        eventType = value;
        break;
      case 'id':
        if (!value.includes('\u0000')) frameId = value;
        break;
      default:
        break; // `retry` and unknown fields ignored
    }
  }

  function feed(chunk: string): SseFrame[] {
    const out: SseFrame[] = [];
    if (chunk.length === 0) return out;
    // A single oversized chunk never enters the buffer at all.
    if (chunk.length > MAX_BUFFER_CHARS) fail();
    buffer += chunk;

    const LF = 10; // '\n'
    const CR = 13; // '\r'
    let start = 0;
    let i = 0;
    while (i < buffer.length) {
      const code = buffer.charCodeAt(i);
      if (code === LF) {
        processLine(buffer.slice(start, i), out);
        i += 1;
        start = i;
      } else if (code === CR) {
        if (i === buffer.length - 1) break; // CRLF may be split across chunks
        processLine(buffer.slice(start, i), out);
        i += buffer.charCodeAt(i + 1) === LF ? 2 : 1;
        start = i;
      } else {
        i += 1;
      }
    }
    buffer = start === 0 ? buffer : start >= buffer.length ? '' : buffer.slice(start);
    // Only the unterminated tail is retained — bound it.
    if (buffer.length > MAX_BUFFER_CHARS) fail();
    return out;
  }

  function end(): SseFrame[] {
    const out: SseFrame[] = [];
    if (buffer.length > 0) {
      processLine(buffer, out);
      buffer = '';
    }
    if (hasPending()) dispatch(out);
    return out;
  }

  return { feed, end };
}
