import type { ModelInfo, ModelRouterData, PresetInfo } from './types';

export const modelsList: ModelInfo[] = [
  { id: 'default', label: 'по умолчанию (из env)', free: null, isDefault: true },
  { id: 'deep/planner-2', label: 'planner-2', free: false, isDefault: false },
  { id: 'fast/exec-1', label: 'exec-1', free: true, isDefault: false },
  { id: 'analyt/critic-1', label: 'critic-1', free: false, isDefault: false },
];

export const presets: PresetInfo[] = [
  {
    name: 'baseline',
    description: 'Сбалансированный контур: planner → executor → critic.',
    flags: { planner: true, critic: true, memory: true, arbiter: true },
    isDefault: true,
  },
  {
    name: 'fast',
    description: 'Минимальная цепочка без критика — короткие задачи.',
    flags: { planner: false, critic: false, memory: true, arbiter: false },
    isDefault: false,
  },
  {
    name: 'deep',
    description: 'Полный контур с суб-агентами и расширенной верификацией.',
    flags: { planner: true, critic: true, memory: true, arbiter: true, subagents: true },
    isDefault: false,
  },
  {
    name: 'custom-x',
    description: null, // unknown to the adapter map — honest empty, never fabricated
    flags: { planner: true, critic: false, memory: false, arbiter: false },
    isDefault: false,
  },
];

export const modelRouter: ModelRouterData = {
  nodes: [
    { id: 'role-planner', label: 'planner', kind: 'role' },
    { id: 'role-executor', label: 'executor', kind: 'role' },
    { id: 'role-critic', label: 'critic', kind: 'role' },
    { id: 'role-arbiter', label: 'arbiter', kind: 'role' },
    { id: 'm-planner-2', label: 'planner-2', kind: 'model' },
    { id: 'm-exec-1', label: 'exec-1', kind: 'model' },
    { id: 'm-critic-1', label: 'critic-1', kind: 'model' },
    { id: 'p-baseline', label: 'baseline', kind: 'preset' },
    { id: 'p-fast', label: 'fast', kind: 'preset' },
  ],
  edges: [
    { from: 'p-baseline', to: 'role-planner', kind: 'routes' },
    { from: 'p-baseline', to: 'role-executor', kind: 'routes' },
    { from: 'p-baseline', to: 'role-critic', kind: 'routes' },
    { from: 'p-baseline', to: 'role-arbiter', kind: 'routes' },
    { from: 'p-fast', to: 'role-executor', kind: 'routes' },
    { from: 'role-planner', to: 'm-planner-2', kind: 'routes' },
    { from: 'role-executor', to: 'm-exec-1', kind: 'routes' },
    { from: 'role-critic', to: 'm-critic-1', kind: 'routes' },
    { from: 'role-arbiter', to: 'm-planner-2', kind: 'fallback' },
  ],
};
