import { describe, expect, it, vi } from 'vitest';
import { createLazySeam } from './lazy-seam';

interface FakeSeam {
  ping(): Promise<string>;
  add(a: number, b: number): Promise<number>;
  youtube?: {
    listVideos(): Promise<{ id: string }[]>;
  };
}

describe('createLazySeam (perf dozhim)', () => {
  it('не грузит модуль до первого метода, кэширует инстанс', async () => {
    const load = vi.fn(async (): Promise<FakeSeam> => ({
      ping: async () => 'pong',
      add: async (a, b) => a + b,
    }));

    const seam = createLazySeam<FakeSeam>(load);
    expect(load).not.toHaveBeenCalled();

    await expect(seam.ping()).resolves.toBe('pong');
    expect(load).toHaveBeenCalledTimes(1);

    await expect(seam.add(2, 3)).resolves.toBe(5);
    expect(load).toHaveBeenCalledTimes(1); // тот же инстанс
  });

  it('не является thenable и пробрасывает неизвестный метод', async () => {
    const seam = createLazySeam<FakeSeam>(async () => ({
      ping: async () => 'pong',
      add: async () => 0,
      youtube: {
        listVideos: async () => [{ id: 'v1' }],
      },
    }));
    // Proxy обязан скрывать then, иначе await воспримет объект как промис.
    expect((seam as unknown as { then?: unknown }).then).toBeUndefined();
    await expect((seam as unknown as { nope(): Promise<void> }).nope()).rejects.toThrow(
      'lazy seam: unknown method nope',
    );
  });

  it('поддерживает вложенные объекты (рекурсивный seam)', async () => {
    const load = vi.fn(async (): Promise<FakeSeam> => ({
      ping: async () => 'pong',
      add: async () => 0,
      youtube: {
        listVideos: async () => [{ id: 'v1' }],
      },
    }));

    const seam = createLazySeam<FakeSeam>(load);
    await expect(seam.youtube?.listVideos()).resolves.toEqual([{ id: 'v1' }]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('поддерживает параллельные вызовы до завершения загрузки', async () => {
    let resolveLoad!: (s: FakeSeam) => void;
    const load = vi.fn(() => new Promise<FakeSeam>((res) => { resolveLoad = res; }));

    const seam = createLazySeam<FakeSeam>(load);
    const p1 = seam.ping();
    const p2 = seam.ping();
    resolveLoad({ ping: async () => 'pong', add: async () => 0, youtube: { listVideos: async () => [] } });

    await expect(p1).resolves.toBe('pong');
    await expect(p2).resolves.toBe('pong');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
