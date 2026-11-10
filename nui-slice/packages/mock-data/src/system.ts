import { T0 } from './personas';
import type {
  AgentSpec, ApiKeyInfo, ApprovalRequest, PluginInfo, ProcessRow, SystemMetrics, UsageSummary, WebhookDelivery, WebhookRow,
} from './types';

const MIN = 60;

export const agents: AgentSpec[] = [
  {
    name: 'forge', description: 'Крупные задачи и оркестрация', config: 'deep',
    capabilities: ['spawn_agent', 'memory.write'], maxCostUsd: 2.0,
    // Wave XI — handoff-кнопки спеки (демо-фикстур, как весь mock-источник):
    // план → реализация у codex, отправка окну механика.
    handoffs: [
      { label: 'Реализовать план', agent: 'codex', prompt: 'Реализуй утверждённый план из контекста прогона', send: true },
      { label: 'Отдать MECH на исполнение', agent: 'mech', prompt: 'Возьми исполнение по плану FORGE', send: false },
    ],
  },
  { name: 'alice', description: 'Анализ и координация', config: 'baseline', capabilities: ['memory.write'], maxCostUsd: 1.0 },
  { name: 'mech', description: 'Исполнение и диагностика', config: 'fast', capabilities: ['shell', 'files'], maxCostUsd: 0.5 },
  { name: 'codex', description: 'Точечные патчи', config: 'baseline', capabilities: ['files'], maxCostUsd: 0.8 },
  { name: 'arch', description: 'Память и прослеживаемость', config: 'baseline', capabilities: ['memory.write', 'audit'], maxCostUsd: 0.6 },
];

export const processes: ProcessRow[] = [
  { pid: 4101, runId: 'run-1042', task: 'Собрать карту суб-агентов для прогона memory-v5', state: 'running', depth: 0, parentPid: null },
  { pid: 4102, runId: 'run-1043', task: 'Извлечь зависимости по траекториям', state: 'running', depth: 1, parentPid: 4101 },
  { pid: 4103, runId: 'run-1044', task: 'Проверить кворум критика', state: 'blocked', depth: 1, parentPid: 4101 },
  { pid: 4090, runId: 'run-1039', task: 'Дайджест изменений main за сутки', state: 'done', depth: 0, parentPid: null },
  { pid: 4088, runId: 'run-1036', task: 'Latency провайдеров, короткий контекст', state: 'failed', depth: 0, parentPid: null },
  { pid: 4077, runId: 'run-1033', task: 'Восстановление сессии — длинный сценарий', state: 'cancelled', depth: 0, parentPid: null },
  { pid: 4065, runId: null, task: 'system watcher', state: 'ready', depth: 0, parentPid: null },
];

const baseMetrics: Omit<SystemMetrics, 'freshness' | 'health'> = {
  cpuPct: 23.4,
  ramPct: 61.8,
  diskPct: 44.1,
  gpuPct: null,
  uptimeS: 3 * 3600 + 41 * MIN,
  // Два процесса из `processes` выше стоят в state='running'.
  processesActive: 2,
  counters: { modelCalls: 142, toolCalls: 87, tokensIn: 512_900, tokensOut: 128_400, costUsd: 4.731 },
};

export const metrics: { healthy: SystemMetrics; degraded: SystemMetrics } = {
  healthy: {
    ...baseMetrics,
    freshness: 'live',
    health: [
      { component: 'store', status: 'ok', detail: null },
      { component: 'memory', status: 'ok', detail: null },
      { component: 'run_pool', status: 'ok', detail: null },
      { component: 'webhooks', status: 'ok', detail: null },
    ],
  },
  degraded: {
    ...baseMetrics,
    cpuPct: 88.2,
    ramPct: 93.0,
    freshness: 'stale',
    health: [
      { component: 'store', status: 'ok', detail: null },
      { component: 'memory', status: 'warn', detail: 'очередь индексации 1.2k записей' },
      { component: 'run_pool', status: 'warn', detail: 'заполнение 91%' },
      { component: 'webhooks', status: 'error', detail: '3 доставки упали подряд' },
    ],
  },
};

export const usage: UsageSummary = {
  period: '2026-10',
  runsTotal: 214,
  runsSucceeded: 189,
  runsFailed: 9,
  runsCancelled: 11,
  runsTimeout: 4,
  runsRunning: 1,
  costUsd: 38.412,
  breakdown: [
    { config: 'baseline', runs: 152, costUsd: 21.305 },
    { config: 'fast', runs: 41, costUsd: 3.118 },
    { config: 'deep', runs: 21, costUsd: 13.989 },
  ],
};

/** Live presence rows — processes attributed to registry specs (AgentPresence pattern). */
export const agentPresence = [
  { agent: 'forge', state: 'running' as const, task: 'Собрать карту суб-агентов для прогона memory-v5', runId: 'run-1042' },
  { agent: 'codex', state: 'running' as const, task: 'Извлечь зависимости по траекториям', runId: 'run-1043' },
  { agent: 'alice', state: 'blocked' as const, task: 'Проверить кворум критика', runId: 'run-1044' },
  { agent: 'mech', state: 'ready' as const, task: 'Ожидание задания планировщика', runId: null },
];

/** Delegation chain — operator → forge → codex (AgentHandoff pattern). */
export const agentHandoffs = [
  {
    id: 'ho-1', from: null, to: 'forge',
    task: 'Собрать карту суб-агентов для прогона memory-v5',
    runId: 'run-1042', status: 'running' as const, ts: T0 - 4 * MIN,
  },
  {
    id: 'ho-2', from: 'forge', to: 'codex',
    task: 'Извлечь зависимости по траекториям',
    runId: 'run-1043', status: 'running' as const, ts: T0 - 4 * MIN + 14,
  },
  {
    id: 'ho-3', from: 'forge', to: 'alice',
    task: 'Проверить кворум критика',
    runId: 'run-1044', status: 'running' as const, ts: T0 - 4 * MIN + 21,
  },
];

export const plugins: PluginInfo[] = [
  { name: 'echo', url: 'builtin', active: true, signed: true, hasSecret: false },
  { name: 'screen-tool', url: 'file:///opt/ai2/plugins/screen', active: true, signed: true, hasSecret: true },
  { name: 'sandbox-browser', url: 'https://plugins.invalid/sandbox-browser', active: false, signed: false, hasSecret: true },
];

export const webhooks: WebhookRow[] = [
  { webhookId: 'wh-01', url: 'https://ops.invalid/hooks/ai2', events: ['run.completed', 'run.failed', 'run.timeout'], active: true },
  { webhookId: 'wh-02', url: 'https://chat.invalid/bot/notify', events: ['run.completed'], active: true },
  { webhookId: 'wh-03', url: 'https://old.invalid/legacy', events: ['run.started'], active: false },
];

/**
 * Pending approval on the hydrated active run (run-1042) — demonstrates the
 * queue seam; the running run is waiting on a file-write grant. Mock only:
 * a real runtime emits these from its own gate, never from UI state.
 */
export const approvals: ApprovalRequest[] = [
  {
    approvalId: 'ap-01',
    runId: 'run-1042',
    action: 'tool_call: file.write',
    scope: 'fs:write D:\\nexus\\reports',
    detail: 'Запись отчёта прогона в рабочую папку',
    status: 'pending',
    requestedAt: T0 - 3 * MIN,
    decidedAt: null,
  },
];

export const apiKeys: ApiKeyInfo[] = [
  {
    keyId: 'key-01', name: 'nexus-ui', scopes: ['runs:write', 'memory:read'],
    prefix: 'ai2_k_nxu', status: 'active',
    createdAt: T0 - 20 * 24 * 3600, expiresAt: T0 + 70 * 24 * 3600, revokedAt: null,
  },
  {
    keyId: 'key-02', name: 'ops-webhook-bot', scopes: ['runs:read'],
    prefix: 'ai2_k_ops', status: 'active',
    createdAt: T0 - 9 * 24 * 3600, expiresAt: null, revokedAt: null,
  },
  {
    keyId: 'key-03', name: 'legacy-import', scopes: ['admin'],
    prefix: 'ai2_k_leg', status: 'revoked',
    createdAt: T0 - 60 * 24 * 3600, expiresAt: null, revokedAt: T0 - 5 * 24 * 3600,
  },
  {
    keyId: 'key-04', name: 'trial-embed', scopes: ['runs:read'],
    prefix: 'ai2_k_trl', status: 'expired',
    createdAt: T0 - 45 * 24 * 3600, expiresAt: T0 - 2 * 24 * 3600, revokedAt: null,
  },
];

export const webhookDeliveries: WebhookDelivery[] = [
  { deliveryId: 'dl-901', event: 'run.completed', status: 'delivered', attempts: 1, lastCode: 200, lastError: null, ts: T0 - 12 * MIN },
  { deliveryId: 'dl-900', event: 'run.timeout', status: 'delivered', attempts: 2, lastCode: 200, lastError: null, ts: T0 - 26 * 3600 + 61 },
  { deliveryId: 'dl-899', event: 'run.failed', status: 'failed', attempts: 5, lastCode: 503, lastError: 'endpoint unreachable', ts: T0 - 6 * 3600 + 44 },
  { deliveryId: 'dl-898', event: 'run.completed', status: 'failed', attempts: 5, lastCode: 0, lastError: 'TLS handshake timeout', ts: T0 - 9 * 3600 },
  { deliveryId: 'dl-897', event: 'run.started', status: 'pending', attempts: 0, lastCode: null, lastError: null, ts: T0 - 2 * MIN },
];
