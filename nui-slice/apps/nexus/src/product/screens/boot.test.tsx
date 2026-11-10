// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDataSource } from '../data-source';
import { BootScreen } from './boot';
import { resetProfileStore, saveProfile } from '../profile/profile-store';
import { createEmptyProfile } from '../profile/profile-types';
import { resetWarmRuntime } from '../runtime-warmup';

const replace = vi.fn();
const prefetch = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, prefetch }),
}));

let dsStub: ProductDataSource;
let kind: 'mock' | 'live' = 'mock';
vi.mock('../data-source', () => ({
  getDataSource: () => dsStub,
  useDataSource: () => dsStub,
  getDataSourceKind: () => kind,
  // boot.tsx различает «явный live-конфиг сломан» и «готовый mock» —
  // без этого экспорта мок роняет рендер.
  getDataSourceConfigStatus: () => 'ready' as const,
}));

const ds = (over: Partial<ProductDataSource> = {}): ProductDataSource =>
  ({
    listRuns: vi.fn(() => Promise.resolve([])),
    listAgents: vi.fn(() => Promise.resolve([])),
    listPresence: vi.fn(() => Promise.resolve([])),
    listHandoffs: vi.fn(() => Promise.resolve([])),
    getUsage: vi.fn(() => Promise.resolve({})),
    getMetrics: vi.fn(() => Promise.resolve({})),
    listModels: vi.fn(() => Promise.resolve([])),
    listPresets: vi.fn(() => Promise.resolve([])),
    ...over,
  }) as unknown as ProductDataSource;

describe('BootScreen — экран загрузки (приоритет Yury 16.10)', () => {
  beforeEach(() => {
    replace.mockClear();
    prefetch.mockClear();
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
    resetProfileStore();
    resetWarmRuntime();
    dsStub = ds();
    kind = 'mock';
  });

  it('этапы с честными статусами; без профиля → /welcome после settle', async () => {
    render(<BootScreen />);
    const panel = await screen.findByTestId('boot-progress');
    expect(panel.getAttribute('role')).toBe('status');
    expect(screen.getByRole('progressbar')).toBeDefined();
    for (const key of ['profile', 'host', 'sync', 'screen']) {
      expect(screen.getByTestId(`boot-stage-${key}`)).toBeTruthy();
    }
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/welcome'));
  });

  it('полный профиль → /runtime/alice после загрузки', async () => {
    saveProfile({ ...createEmptyProfile(), name: 'Yury', agentId: 'alice', themeId: 'alice' });
    render(<BootScreen />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/runtime/alice'));
    expect(prefetch).toHaveBeenCalledWith('/runtime/alice');
  });

  it('устаревшая персона профиля не открывает субагента вместо AGENT-A', async () => {
    saveProfile({ ...createEmptyProfile(), name: 'Yury', agentId: 'arch', themeId: 'arch' });
    render(<BootScreen />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/runtime/alice'));
    expect(prefetch).toHaveBeenCalledWith('/runtime/alice');
  });

  it('полный профиль без persona id сразу открывает AGENT-A', async () => {
    saveProfile({ ...createEmptyProfile(), name: 'Yury' });
    render(<BootScreen />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/runtime/alice'));
  });

  it('мок-источник → подключение к хосту честно «недоступно», без фейка', async () => {
    render(<BootScreen />);
    const host = await screen.findByTestId('boot-stage-host');
    await waitFor(() => expect(host.getAttribute('data-state')).toBe('skipped'));
    expect(host.textContent).toContain('недоступно');
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  it('unmount до конца warm → устаревшее продолжение не навигирует и не ставит флаг', async () => {
    let release: (v: unknown[]) => void = () => {};
    dsStub = ds({
      listRuns: vi.fn(() => new Promise((r) => { release = r; })) as unknown as ProductDataSource['listRuns'],
    });
    const view = render(<BootScreen />);
    // Ждём старта warm-цепочки (шаги синхронизации в DOM).
    await waitFor(() => expect(screen.getAllByText('История прогонов').length).toBeGreaterThan(0));
    view.unmount();
    release([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(replace).not.toHaveBeenCalled();
    expect(prefetch).not.toHaveBeenCalled();
    expect(globalThis.sessionStorage?.getItem('nexus:boot-handoff')).toBeNull();
  });

  it('live + отказ probe → хост «нет данных»; упавший seam → «нет данных» шага', async () => {
    kind = 'live';
    dsStub = ds({
      getCapabilities: vi.fn(() => Promise.reject(new Error('down'))),
      listAgents: vi.fn(() => Promise.reject(new Error('down'))),
    });
    render(<BootScreen />);
    const host = await screen.findByTestId('boot-stage-host');
    await waitFor(() => expect(host.getAttribute('data-state')).toBe('failed'));
    expect(host.textContent).toContain('нет данных');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/welcome'));
    const failed = screen.getByTestId('boot-progress').querySelector('[data-state="failed"]');
    expect(failed).not.toBeNull();
  });
});
