import { T0 } from './personas';
import type { MissionGraphData, NexusMission } from './types';

const MIN = 60;

export const missions: { active: NexusMission; done: NexusMission; failed: NexusMission } = {
  active: {
    id: 'msn-204',
    title: 'Карта суб-агентов memory-v5',
    state: 'active',
    steps: [
      { id: 's1', label: 'Сбор спецификаций', state: 'done', agentId: 'forge', startedAt: T0 - 4 * MIN, endedAt: T0 - 3 * MIN },
      { id: 's2', label: 'Построение графа зависимостей', state: 'active', agentId: 'codex', startedAt: T0 - 3 * MIN, endedAt: null },
      { id: 's3', label: 'Верификация покрытия', state: 'pending', agentId: 'alice', startedAt: null, endedAt: null },
    ],
    outputs: [],
    agents: ['forge', 'codex', 'alice'],
    freshness: 'live',
  },
  done: {
    id: 'msn-199',
    title: 'Дайджест изменений main',
    state: 'done',
    steps: [
      { id: 's1', label: 'Выгрузка журнала', state: 'done', agentId: 'arch', startedAt: T0 - 3 * 3600, endedAt: T0 - 3 * 3600 + 40 },
      { id: 's2', label: 'Синтез дайджеста', state: 'done', agentId: 'arch', startedAt: T0 - 3 * 3600 + 40, endedAt: T0 - 3 * 3600 + 187 },
    ],
    outputs: [{ id: 'out-1', label: 'Дайджест за сутки', kind: 'report', runId: 'run-1039' }],
    agents: ['arch'],
    freshness: 'stale',
  },
  failed: {
    id: 'msn-197',
    title: 'Latency-аудит провайдеров',
    state: 'failed',
    steps: [
      { id: 's1', label: 'Замеры короткого контекста', state: 'failed', agentId: 'mech', startedAt: T0 - 6 * 3600, endedAt: T0 - 6 * 3600 + 42 },
      { id: 's2', label: 'Сводная таблица', state: 'skipped', agentId: null, startedAt: null, endedAt: null },
    ],
    outputs: [],
    agents: ['mech'],
    freshness: 'stale',
  },
};

export const missionGraph: MissionGraphData = {
  nodes: [
    { id: 'a-forge', label: 'forge', kind: 'agent', status: 'active' },
    { id: 'a-codex', label: 'codex', kind: 'agent', status: 'active' },
    { id: 'a-alice', label: 'alice', kind: 'agent', status: 'idle' },
    { id: 's-specs', label: 'Сбор спецификаций', kind: 'step', status: 'done' },
    { id: 's-graph', label: 'Граф зависимостей', kind: 'step', status: 'active' },
    { id: 's-verify', label: 'Верификация', kind: 'step', status: 'pending' },
    { id: 'o-map', label: 'Карта суб-агентов', kind: 'output' },
  ],
  edges: [
    { from: 'a-forge', to: 's-specs', kind: 'delegates' },
    { from: 'a-forge', to: 'a-codex', kind: 'delegates' },
    { from: 'a-codex', to: 's-graph', kind: 'delegates' },
    { from: 'a-alice', to: 's-verify', kind: 'waits' },
    { from: 's-specs', to: 's-graph', kind: 'produces' },
    { from: 's-graph', to: 'o-map', kind: 'produces' },
  ],
};
