'use client';

import type { ProductDataSource } from './data-source';

/**
 * Runtime warmup (boot → runtime): BootScreen starts every seam the runtime
 * tabs need BEFORE navigation, so the first paint is already data-complete.
 * Results live in a short-lived module
 * cache; tabs read through `warmOr` instead of refetching. Failed steps are
 * never reused — a tab that sees a failed warm entry refetches itself and
 * renders the seam's honest error/retry state.
 */

export type WarmStatus = 'loading' | 'ok' | 'failed' | 'skipped';

export interface WarmStep {
  key: string;
  label: string;
}

/** Step list mirrors the runtime tab seam calls (order = display order).
 *  `as const` + `satisfies` дают компиляторную гарантию: набор ключей
 *  шагов и набор job'ов обязаны совпадать (забытый шаг = ошибка сборки,
 *  а не падение прогресс-бара в рантайме). */
export const WARM_STEPS = [
  { key: 'runs', label: 'История прогонов' },
  { key: 'agents', label: 'Реестр агентов' },
  { key: 'presence', label: 'Присутствие процессов' },
  { key: 'handoffs', label: 'Передачи агентов' },
  { key: 'usage', label: 'Расход и лимиты' },
  { key: 'metrics', label: 'Системные метрики' },
  { key: 'models', label: 'Реестр моделей' },
  { key: 'presets', label: 'Контуры запуска' },
  { key: 'projects', label: 'Проекты' },
  { key: 'capabilities', label: 'Возможности хоста' },
  { key: 'fs', label: 'Заявки доступа к файлам' },
  { key: 'scene', label: '3D-сцена ассистента' },
] as const satisfies readonly WarmStep[];

/** Ключ шага прогрева — единый словарь для шагов и job'ов. */
export type WarmKey = (typeof WARM_STEPS)[number]['key'];

type WarmEntry = { at: number; state: 'ready'; value: unknown } | { at: number; state: 'failed' };

const cache = new Map<string, WarmEntry>();

/** Warm values stay fresh this long; older entries refetch on read. */
const WARM_TTL_MS = 5 * 60 * 1000;
/** A hung host call never blocks the readiness bar forever. */
const STEP_TIMEOUT_MS = 12_000;

function fresh(key: string): WarmEntry | undefined {
  const e = cache.get(key);
  return e != null && Date.now() - e.at < WARM_TTL_MS ? e : undefined;
}

/**
 * Warm seed for initial mount state: returns the warmed value when the step
 * succeeded recently, `undefined` otherwise. Warm data seeds the first paint
 * only — every subsequent fetch (polls, retries, user actions) goes to the
 * host directly, so nothing here ever shadows a live refresh.
 */
export function peekWarm<T>(key: string): T | undefined {
  const e = fresh(key);
  return e?.state === 'ready' ? (e.value as T) : undefined;
}

function timed<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), STEP_TIMEOUT_MS);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (err) => { clearTimeout(t); reject(err); },
    );
  });
}

/**
 * Runs every warmup step in parallel; `onStep` fires as each settles so the
 * select screen can render per-stage readiness. Optional seams that are
 * absent resolve as 'skipped'. Returns the per-step status map — callers
 * decide navigation (failures never trap the user on the select screen).
 */
export async function warmRuntime(
  ds: ProductDataSource,
  onStep?: (key: string, status: WarmStatus) => void,
): Promise<Record<string, WarmStatus>> {
  const status: Record<string, WarmStatus> = {};
  const mark = (key: string, s: WarmStatus) => { status[key] = s; onStep?.(key, s); };
  const run = (key: string, p: Promise<unknown> | 'skip' | undefined): Promise<void> => {
    // Отсутствующий seam = «пропущено», а не падение: прогресс-бар не
    // должен роняться из-за рассинхрона шагов и job'ов.
    if (p === 'skip' || p == null) { mark(key, 'skipped'); cache.set(key, { at: Date.now(), state: 'failed' }); return Promise.resolve(); }
    mark(key, 'loading');
    return timed(p)
      .then((v) => { cache.set(key, { at: Date.now(), state: 'ready', value: v }); mark(key, 'ok'); })
      .catch(() => { cache.set(key, { at: Date.now(), state: 'failed' }); mark(key, 'failed'); });
  };

  const jobs: Record<WarmKey, Promise<unknown> | 'skip'> = {
    runs: ds.listRuns({ limit: 50 }),
    agents: ds.listAgents(),
    presence: ds.listPresence(),
    handoffs: ds.listHandoffs(),
    usage: ds.getUsage(),
    metrics: ds.getMetrics(),
    models: ds.listModels(),
    presets: ds.listPresets(),
    projects: ds.listProjects != null ? ds.listProjects() : 'skip',
    capabilities: ds.getCapabilities != null ? ds.getCapabilities() : 'skip',
    fs: ds.fs != null ? ds.fs.requests({ status: 'pending' }) : 'skip',
    // nexus-scene-v1 (W1 S3): open() carries the profile persona — the host
    // starts loading StartScene_<Agent> while the user is still on select.
    scene: ds.unrealScene != null ? ds.unrealScene.open() : 'skip',
  };

  await Promise.all(WARM_STEPS.map((s) => run(s.key, jobs[s.key])));
  return status;
}

/** Test hook — clears the warm cache between cases. */
export function resetWarmRuntime(): void {
  cache.clear();
}
