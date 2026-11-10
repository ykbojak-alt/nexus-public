// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createAi2DataSource } from './product-data-source';
import { createMockAi2Client } from '../api/mock-transport';
import { streamRunEvents } from '../sse/run-event-stream';

// Мокаем SSE-потребитель через управляемую очередь: тесты выбирают, что
// отдаёт поток, и как он завершается (EOF без `end`, gap + дельты + догонка).
vi.mock('../sse/run-event-stream', () => ({
  streamRunEvents: vi.fn(async function* () {
    yield { seq: 1, ts: 101, type: 'run.start', role: 'ядро' } as any;
    // кадра `end` нет — поток завершается сам (EOF после исчерпания
    // попыток переподключения). Это и есть баг: адаптер должен завершить
    // прогон терминальным статусом, а не оставлять `running`.
  }),
}));


describe('streamRun — EOF потока (P1 SSE)', () => {
  it('не оставляет прогон в running, когда SSE обрывается без end-кадра', async () => {
    const ds = createAi2DataSource({ client: createMockAi2Client() });
    const onEnd = vi.fn();
    const cleanup = ds.streamRun('run-eof', {
      fromSeq: 0,
      onEvent: vi.fn(),
      onDelta: vi.fn(),
      onEnd,
      onGap: vi.fn(),
    });

    // Дать async-работе осесть (microtask + macrotask).
    await new Promise((resolve) => setTimeout(resolve, 100));
    cleanup();

    // Баг: адаптер вызывает onEnd('running') на EOF — UI зависает в
    // «выполняется». Инвариант после починки: 'running' сюда не попадает
    // (терминальный статус или отсутствие вызова).
    expect(onEnd).not.toHaveBeenCalledWith('running');
  });
});

describe('streamRun — gap/stale догонка (NQ-115)', () => {
  it('stale держится, пока не придёт ПЕРСИСТИРОВАННОЕ событие: ephemeral-дельта разрыв не гасит', async () => {
    const ds = createAi2DataSource({ client: createMockAi2Client() });
    const gap = vi.fn();
    const delta = vi.fn();
    const persisted = vi.fn();
    let pushed = 0;
    const queue: Array<Record<string, unknown>> = [
      { seq: 1, ts: 101, type: 'run.start' },
      { type: 'stream_gap', seq: 3, expectedSeq: 2, receivedSeq: 4 },
      // Связка из двух эфемерных кадров — разрыв НЕ должен закрыться.
      { type: 'model_delta', text: 'а' },
      { type: 'model_delta', text: 'б' },
    ];
    queue.push({ seq: 4, ts: 104, type: 'run.message' }); // догоняет

    vi.mocked(streamRunEvents).mockImplementation(async function* () {
      for (const ev of queue) {
        yield ev;
        await new Promise((r) => setTimeout(r, 1));
      }
    } as unknown as typeof streamRunEvents);

    let gapAfterStale: number | null = null;
    let gapAfterDeltas: number | null = null;
    let gapAfterPersisted: number | null = null;
    ds.streamRun('run-stale', {
      fromSeq: 0,
      onEvent: (ev) => {
        persisted(ev.type);
        // после догоняющего persist-кадра разрыв обязан закрыться
        gapAfterPersisted = gap.mock.calls.length;
      },
      onDelta: () => {
        delta();
        gapAfterDeltas = gap.mock.calls.length;
      },
      onEnd: vi.fn(),
      onGap: (paused) => {
        gap(paused);
        if (paused) gapAfterStale = gap.mock.calls.length;
      },
    });

    await vi.waitFor(() => expect(gapAfterPersisted).not.toBeNull());
    expect(gap).toHaveBeenNthCalledWith(1, true); // stream_gap открыл разрыв
    expect(gapAfterDeltas, 'эфемерные дельты НЕ закрывают разрыв').toBe(1);
    expect(gapAfterPersisted, 'persist-кадр закрывает разрыв').toBe(2);
    expect(gap).toHaveBeenNthCalledWith(2, false);
    // dельты дошли до лент, persist-кадр дошёл в onEvent
    expect(delta).toHaveBeenCalledTimes(2);
    expect(persisted).toHaveBeenCalledWith('run.message');
  });
});

