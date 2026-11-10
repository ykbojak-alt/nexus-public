// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { RunSummary } from '@nexus/mock-data';
import type { ProductDataSource } from './data-source';
import { WARM_STEPS, peekWarm, resetWarmRuntime, warmRuntime } from './runtime-warmup';

/** Минимальный seam: обязательные методы прогрева + точечные переопределения. */
function fakeSource(over: Partial<ProductDataSource> = {}): ProductDataSource {
  const base = {
    listPresets: () => Promise.resolve([]),
    listModels: () => Promise.resolve([]),
    listAgents: () => Promise.resolve([]),
    listRuns: () => Promise.resolve([]),
    listPresence: () => Promise.resolve([]),
    listHandoffs: () => Promise.resolve([]),
    getUsage: () => Promise.resolve({}),
    getMetrics: () => Promise.resolve({}),
  };
  return { ...base, ...over } as unknown as ProductDataSource;
}

describe('runtime warmup — шаги и job-ы синхронны', () => {
  beforeEach(() => resetWarmRuntime());

  it('каждый шаг получает статус; отсутствующий seam = skipped, а не падение', async () => {
    const status = await warmRuntime(fakeSource());
    expect(Object.keys(status).sort()).toEqual(WARM_STEPS.map((s) => s.key).sort());
    expect(status.runs).toBe('ok');
    expect(status.projects).toBe('skipped'); // listProjects у мока нет
    expect(status.capabilities).toBe('skipped');
    expect(status.fs).toBe('skipped');
  });

  it('упавший seam помечается failed и его значение не переиспользуется', async () => {
    const status = await warmRuntime(fakeSource({
      listRuns: () => Promise.reject(new Error('host down')),
    }));
    expect(status.runs).toBe('failed');
    expect(peekWarm('runs')).toBeUndefined();
  });

  it('успешный шаг виден через peekWarm', async () => {
    const runs = [{ runId: 'run-1' }] as unknown as RunSummary[];
    await warmRuntime(fakeSource({ listRuns: () => Promise.resolve(runs) }));
    expect(peekWarm('runs')).toEqual(runs);
  });
});
