import { T0 } from './personas';
import type { RunEventView, RunResultView, RunSummary } from './types';

const MIN = 60;
const HOUR = 3600;

export const runStates: Record<
  'idle' | 'running' | 'done' | 'error' | 'cancelled' | 'timeout',
  RunSummary
> = {
  idle: {
    runId: 'run-0000', taskText: 'Черновой прогон — не запускался', config: 'baseline',
    status: 'running', stopReason: null, agent: null, parent: null,
    project: 'nexus', model: null, costUsd: null, createdAt: T0, finishedAt: null,
  },
  running: {
    runId: 'run-1042', taskText: 'Собрать карту суб-агентов для прогона memory-v5', config: 'baseline',
    status: 'running', stopReason: null, agent: 'forge', parent: null,
    project: 'ai2', model: null, costUsd: 0.031, createdAt: T0 - 4 * MIN, finishedAt: null,
  },
  done: {
    runId: 'run-1039', taskText: 'Составить дайджест изменений ветки main за сутки', config: 'baseline',
    status: 'done', stopReason: 'done', agent: 'arch', parent: null,
    project: 'nexus', model: null, costUsd: 0.214, createdAt: T0 - 3 * HOUR, finishedAt: T0 - 3 * HOUR + 187,
  },
  error: {
    runId: 'run-1036', taskText: 'Сравнить latency провайдеров на коротком контексте', config: 'fast',
    status: 'error', stopReason: 'error: provider 429', agent: null, parent: null,
    project: 'bench', model: null, costUsd: 0.008, createdAt: T0 - 6 * HOUR, finishedAt: T0 - 6 * HOUR + 42,
  },
  cancelled: {
    runId: 'run-1033', taskText: 'Проверить длинный сценарий восстановления сессии', config: 'baseline',
    status: 'cancelled', stopReason: 'cancelled', agent: 'mech', parent: 'run-1020',
    project: 'ai2', model: null, costUsd: 0.102, createdAt: T0 - 9 * HOUR, finishedAt: T0 - 9 * HOUR + 305,
  },
  timeout: {
    runId: 'run-1029', taskText: 'Сгенерировать полный отчёт по реестру плагинов', config: 'deep',
    status: 'timeout', stopReason: 'timeout', agent: 'codex', parent: null,
    project: 'nexus', model: null, costUsd: 0.177, createdAt: T0 - 26 * HOUR, finishedAt: T0 - 26 * HOUR + 60,
  },
};

const HISTORY_TASKS = [
  'Аудит хранилища траекторий', 'Прогрев кэша моделей', 'Разбор инцидента доставки webhook',
  'Синтез инструкций для суб-агента', 'Проверка квот tenant', 'Сводка использования за месяц',
  'Миграция памяти проекта', 'Оценка качества ответа критиком', 'Диагностика пула прогонов',
  'Сравнение пресетов на задаче поиска', 'Подготовка релиз-заметок', 'Проверка связности графа зависимостей',
];
const STATUS_CYCLE: RunSummary['status'][] = ['done', 'done', 'done', 'error', 'done', 'timeout', 'done', 'cancelled', 'done', 'done', 'error', 'done'];
const AGENTS = ['forge', 'alice', 'mech', 'codex', 'arch', null];
const PROJECTS = ['ai2', 'nexus', 'bench'];
const CONFIGS = ['baseline', 'fast', 'deep'];

/** ≥12 deterministic history rows for list/filter scenarios (mock-fixtures-spec §1). */
export const runHistory: RunSummary[] = HISTORY_TASKS.map((taskText, i) => {
  const status = STATUS_CYCLE[i];
  const createdAt = T0 - (i + 1) * 5 * HOUR;
  const running = status === 'running';
  const stopReason: RunSummary['stopReason'] =
    status === 'done' ? 'done' : status === 'running' ? null : status;
  return {
    runId: `run-${1028 - i}`,
    taskText,
    config: CONFIGS[i % CONFIGS.length],
    status,
    stopReason,
    agent: AGENTS[i % AGENTS.length],
    parent: i % 4 === 3 ? `run-${1029 - i}` : null,
    project: PROJECTS[i % PROJECTS.length],
    model: null, costUsd: Math.round((0.02 + i * 0.013) * 1000) / 1000,
    createdAt,
    finishedAt: running ? null : createdAt + 60 + i * 17,
  };
});

/** Replayable run event log — planner → tool → model → critic → final. */
export const runEventStream: RunEventView[] = [
  { seq: 1, type: 'run.start', role: null, ts: T0 - 4 * MIN, body: { task: runStates.running.taskText, config: 'baseline' } },
  { seq: 2, type: 'model_call', role: 'planner', ts: T0 - 4 * MIN + 2, body: { model: 'planner-1', stage: 'plan' } },
  { seq: 3, type: 'plan.step', role: 'planner', ts: T0 - 4 * MIN + 5, body: { step: 1, text: 'Загрузить список суб-агентов прогона' } },
  { seq: 4, type: 'plan.step', role: 'planner', ts: T0 - 4 * MIN + 6, body: { step: 2, text: 'Построить карту зависимостей' } },
  { seq: 5, type: 'tool_call', role: 'executor', ts: T0 - 4 * MIN + 9, body: { tool: 'memory.search', args: { k: 5 } } },
  { seq: 6, type: 'tool_result', role: 'executor', ts: T0 - 4 * MIN + 11, body: { tool: 'memory.search', hits: 4 } },
  { seq: 7, type: 'spawn', role: 'executor', ts: T0 - 4 * MIN + 14, body: { child: 'run-1043', agent: 'codex', depth: 1 } },
  { seq: 8, type: 'model_call', role: 'executor', ts: T0 - 4 * MIN + 18, body: { model: 'exec-1', stage: 'synthesis' } },
  { seq: 9, type: 'model_call', role: 'critic', ts: T0 - 4 * MIN + 26, body: { model: 'critic-1', stage: 'verify' } },
  { seq: 10, type: 'final', role: 'arbiter', ts: T0 - 4 * MIN + 33, body: { stop_reason: 'done', answer: 'Карта суб-агентов собрана: 4 узла, 6 рёбер.' } },
];

export const runResults: Record<'done' | 'timeout' | 'error', RunResultView> = {
  done: {
    ...runStates.done,
    answer: 'Дайджест за сутки: 7 коммитов, 2 ветки, заметные изменения — реестр агентов и timeout-статус прогонов.',
    score: 0.86, verified: true, durationS: 187,
    usage: { modelCalls: 5, toolCalls: 3, tokens: 18_420, costUsd: 0.214 },
  },
  timeout: {
    ...runStates.timeout,
    answer: null, score: null, verified: null, durationS: 60,
    usage: { modelCalls: 2, toolCalls: 1, tokens: 6_310, costUsd: 0.177 },
  },
  error: {
    ...runStates.error,
    answer: null, score: null, verified: false, durationS: 42,
    usage: { modelCalls: 1, toolCalls: 0, tokens: 1_140, costUsd: 0.008 },
  },
};

/**
 * Run detail fixtures keyed by runId — persisted events + stored result.
 * Only runs present here have detail data; other ids yield a bare
 * `{ run, result: null, events: [] }` (honest "nothing recorded").
 */
export const runDetails: Record<string, { events: RunEventView[]; result: RunResultView | null }> = {
  'run-1042': { events: runEventStream.slice(0, 6), result: null },
  'run-1039': {
    events: [
      { seq: 1, type: 'run.start', role: null, ts: T0 - 3 * HOUR, body: { task: runStates.done.taskText, config: 'baseline' } },
      { seq: 2, type: 'tool_call', role: 'executor', ts: T0 - 3 * HOUR + 40, body: { tool: 'git.log', args: { since: '1d' } } },
      { seq: 3, type: 'tool_result', role: 'executor', ts: T0 - 3 * HOUR + 44, body: { tool: 'git.log', commits: 7 } },
      { seq: 4, type: 'model_call', role: 'executor', ts: T0 - 3 * HOUR + 120, body: { model: 'exec-1', stage: 'synthesis' } },
      { seq: 5, type: 'final', role: 'arbiter', ts: T0 - 3 * HOUR + 187, body: { stop_reason: 'done' } },
    ],
    result: runResults.done,
  },
  'run-1036': {
    events: [
      { seq: 1, type: 'run.start', role: null, ts: T0 - 6 * HOUR, body: { task: runStates.error.taskText, config: 'fast' } },
      { seq: 2, type: 'model_call', role: 'executor', ts: T0 - 6 * HOUR + 30, body: { model: 'exec-1', stage: 'synthesis' } },
      { seq: 3, type: 'error', role: 'executor', ts: T0 - 6 * HOUR + 42, body: { message: 'provider 429' } },
    ],
    result: runResults.error,
  },
  'run-1029': {
    events: [
      { seq: 1, type: 'run.start', role: null, ts: T0 - 26 * HOUR, body: { task: runStates.timeout.taskText, config: 'deep' } },
      { seq: 2, type: 'model_call', role: 'planner', ts: T0 - 26 * HOUR + 12, body: { model: 'planner-1', stage: 'plan' } },
      { seq: 3, type: 'timeout', role: 'supervisor', ts: T0 - 26 * HOUR + 60, body: { limit_s: 60 } },
    ],
    result: runResults.timeout,
  },
};
