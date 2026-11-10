/**
 * System contracts — /healthz, /v1/health, /v1/metrics, /v1/models, /v1/presets.
 */

/** GET /healthz — cheap liveness, no auth required. */
export interface Ai2Healthz {
  status: string;
  version: string;
  mode: 'dev' | 'api_key' | string;
  dev_mode: boolean;
  provider?: string;
  models_count?: number;
}

export interface Ai2ComponentHealth {
  ok: boolean;
  detail?: string;
  latency_ms?: number;
  [key: string]: unknown;
}

/**
 * Проверка подсистемы в блоке `checks` `/v1/health` (W1-175+):
 * `state` — ok/degraded/unknown; `detail` — честная причина verbatim.
 * `provider` дополнительно несёт `name` и `network_checked=false`
 * (health не выполняет сетевой ping и не тратит лимиты).
 */
export interface Ai2HealthCheck {
  state?: string;
  detail?: string | null;
  name?: string | null;
  network_checked?: boolean;
  [key: string]: unknown;
}

/** GET /v1/health — deep component check. */
export interface Ai2Health {
  status: 'healthy' | 'degraded' | 'unhealthy' | string;
  components: Record<string, Ai2ComponentHealth>;
  /** Сводка подсистем (W1-175+): `db` (открываемость store + quick_check),
   *  `provider` (конфигурация без сетевого ping), `stores` (store+memory).
   *  `degraded` в checks.provider/checks.db поднимает верхний status. */
  checks?: Record<string, Ai2HealthCheck | undefined> & {
    db?: Ai2HealthCheck;
    provider?: Ai2HealthCheck;
    stores?: Ai2HealthCheck;
  };
  [key: string]: unknown;
}

/** GET /v1/metrics — process + pool + tenant aggregates (telemetry widgets). */
export interface Ai2Metrics {
  ts: string;
  system: {
    cpu_percent?: number;
    memory_percent?: number;
    rss_mb?: number;
    threads?: number;
    uptime_s?: number;
    disk_percent?: number | null;
    gpu_percent?: number | null;
    [key: string]: unknown;
  };
  pool: {
    jobs?: number;
    queued?: number;
    waiting_deps?: number;
    processes_active?: number;
    capacity?: number;
    [key: string]: unknown;
  };
  tenant: {
    runs_active?: number;
    runs_total?: number;
    usage?: Record<string, number>;
    [key: string]: unknown;
  };
  /** Блок сторов (W1-195): counts прогонов/памяти/компактов/fs-заявок,
   *  последние ошибочные прогоны, размеры БД-файлов. Источника нет → ключа нет. */
  stores?: {
    runs?: { total?: number; by_status?: Record<string, number>; [key: string]: unknown };
    memory?: { items?: number; projects?: number; [key: string]: unknown };
    [key: string]: unknown;
  };
  /** `sessions.total` — число сессий tenant'а (W1-199); null, если стор
   *  не умеет агрегат. */
  sessions?: { total?: number | null };
  /** Фоновой retention-проход (W1-173): stats воркера; null — воркер не
   *  поднят (interval_s=0 или отсутствует). */
  retention?: {
    tenants?: number;
    candidates?: number;
    archived?: number;
    deleted?: number;
    scanned?: number;
    scan_ms?: number;
    interval_s?: number;
    older_than_days?: number;
    keep_per_session?: number;
    enabled?: boolean;
    [key: string]: unknown;
  } | null;
  /** Монитор целостности стора (W1-196+): stats монитора + interval_s +
   *  enabled; null — монитора нет. */
  integrity?: {
    interval_s?: number | null;
    enabled?: boolean;
    [key: string]: unknown;
  } | null;
  version?: string;
}

export interface Ai2Model {
  id: string;
  label: string;
  /** true = :free variant; null = the env-default pseudo-entry. */
  free: boolean | null;
}

export interface Ai2Preset {
  name: string;
  flags: Record<string, boolean>;
}

/** GET /v1/keys row (`key_view`) — ISO timestamps; secret never returned. */
export interface Ai2ApiKey {
  keyId: string;
  name: string;
  scopes: string[];
  prefix: string;
  status: 'active' | 'revoked' | 'expired' | string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

/**
 * POST /v1/keys request (verified on live host 2026-10-19, app.py `KeyIn`):
 * 403 when scopes exceed the caller's own; 422 on limit/validation.
 * `expiresAt` ISO-8601; `tenant` is operator-only — UI never sends it.
 */
export interface CreateApiKeyInput {
  name: string;
  scopes: string[];
  expiresAt?: string;
}

/** POST /v1/keys response — wire field `key` carries the secret exactly once. */
export interface Ai2CreatedApiKey extends Ai2ApiKey {
  secret: string;
}

/** GET /v1/usage — tenant spend for a UTC month period. */
export interface Ai2UsageReport {
  period: string;
  tenant: string;
  runsTotal: number;
  runsSucceeded: number;
  runsFailed: number;
  runsCancelled: number;
  runsTimeout: number;
  runsRunning: number;
  costUsd: number;
  /** cost per preset name, e.g. `{baseline:{runs,cost_usd}}`. */
  breakdown: Record<string, { runs: number; cost_usd: number }>;
  budgetUsd?: number | null;
}

/* ------------------------------------------------------------------ */
/* Приёмочный шлюз сценария — GET /v1/scenario/health (волна XV, W1).   */
/* Каждый шаг S1-S9 — реальный вызов seam'а хоста с измеренной           */
/* задержкой; статусы verbatim ok|degraded|unavailable|error.          */
/* ------------------------------------------------------------------ */

export type ScenarioStepStatus = 'ok' | 'degraded' | 'unavailable' | 'error' | (string & {});

export interface ScenarioStep {
  /** 'S1'..'S9' verbatim от хоста. */
  id: string;
  title: string;
  status: ScenarioStepStatus;
  /** Причина/деталь verbatim; может отсутствовать. */
  detail: string | null;
  latencyMs: number | null;
}

export interface ScenarioHealth {
  steps: ScenarioStep[];
  /** Время генерации на хосте (мс epoch); null — хост не отдал. */
  generatedAt: number | null;
}
