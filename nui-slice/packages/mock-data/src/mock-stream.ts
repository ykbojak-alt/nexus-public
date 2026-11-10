import type { RunEventView, RunStatus } from './types';

export interface MockStreamOptions {
  /** Resume point — mirrors SSE Last-Event-ID semantics. */
  fromSeq?: number;
  /** Delay between events (default 120ms; pass 0 for synchronous replay). */
  intervalMs?: number;
  /** After this seq, pause `gapMs` and invoke onGap — exercises `stale` state. */
  gapAtSeq?: number;
  gapMs?: number;
  /**
   * Pause check for the O7 controls seam — when it returns true the emitter
   * holds (keeps polling) instead of emitting; events resume in seq order.
   * Pauses replay, it does not fake a paused run: the stream simply stops
   * advancing until the flag clears.
   */
  isPaused?: () => boolean;
  /** Injectable scheduler for tests (default: setTimeout). */
  schedule?: (fn: () => void, ms: number) => () => void;
}

/**
 * Deterministic SSE-like replay (mock-fixtures-spec §3). Emits events in
 * seq order, then calls onEnd with the terminal run status derived from
 * the last event's stop_reason (default 'done'). Returns unsubscribe.
 */
export function createMockStream(
  events: RunEventView[],
  opts: MockStreamOptions,
  onEvent: (e: RunEventView) => void,
  onEnd: (status: RunStatus) => void,
  onGap?: (paused: boolean) => void,
): () => void {
  const { fromSeq = 0, intervalMs = 120, gapAtSeq, gapMs = 1500, isPaused } = opts;
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  });
  const queue = events.filter((e) => e.seq > fromSeq);
  let idx = 0;
  let cancelled = false;
  let cancelPending: (() => void) | null = null;

  const endStatus: RunStatus = (() => {
    const last = queue[queue.length - 1];
    const reason = (last?.body as { stop_reason?: string } | undefined)?.stop_reason;
    return reason === 'cancelled' || reason === 'timeout' || reason === 'error' ? reason : 'done';
  })();

  const step = () => {
    if (cancelled) return;
    if (isPaused?.()) {
      cancelPending = schedule(step, intervalMs);
      return;
    }
    if (idx >= queue.length) {
      onEnd(endStatus);
      return;
    }
    const event = queue[idx++];
    onEvent(event);
    if (gapAtSeq != null && event.seq === gapAtSeq && idx < queue.length) {
      onGap?.(true);
      cancelPending = schedule(() => {
        onGap?.(false);
        cancelPending = schedule(step, intervalMs);
      }, gapMs);
      return;
    }
    cancelPending = schedule(step, intervalMs);
  };

  cancelPending = schedule(step, intervalMs);
  return () => {
    cancelled = true;
    cancelPending?.();
  };
}
