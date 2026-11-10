import { T0 } from './personas';
import type { MemoryGraphData, MemoryItem, MemorySearchHit, MemoryStructure } from './types';

const HOUR = 3600;
const DAY = 24 * HOUR;

const PROJECT = 'nexus';

const MEMORY_TEXTS = [
  'Решение: persona-tint отделён от runtime role truth во всех экранах',
  'Legacy UI использует fetch+ReadableStream для SSE из-за Authorization header',
  'Статус timeout — first-class: фильтры, метки, usage и alerts покрыты',
  'Реестр агентов: POST /v1/agents принимает capabilities и maxCostUsd',
  'Briefing card считает прогоны с полуночи локального времени',
  'ProcessRow.state — серверный vocab: new|ready|running|blocked|done|failed|cancelled',
  'Memory API — read/delete only; редактирование не имитируем (решение владельца)',
  'Depth-слои токенов: environment→surface→panel→elevated→overlay→core',
  'chart.series.* — 8 заказанных ролей палитры, переопределяется темой',
  'Суб-агентам дедлайн прогона не наследуется — задокументировано',
  'Webhook deliveries: status pending|delivered|failed + attempts + lastCode',
  'MockStream: события по seq, терминал final + stop_reason',
  'PageState пропагирует вниз: screen → template → pattern → component',
  'Инспектор памяти открывается из списка и из графа — общий selection state',
  'MissionGlobe отложен владельцем до D3 — не release gate',
  'Вкладки runtime: process|results|agents|resources|history — query-параметр tab',
  'Unknown theme id → детерминированный fallback на nexus',
  'localStorage заблокирован → in-memory профиль + заметный баннер',
  'Клавиатура: Alt+1..5 секции, Ctrl+K палитра, / поиск памяти, g граф',
  'Ошибка одной вкладки runtime не роняет остальные — error boundary на вкладку',
];

/** ≥20 items for layout validation (mock-fixtures-spec §1). */
export const memoryItems: MemoryItem[] = MEMORY_TEXTS.map((text, i) => ({
  id: 900 - i,
  project: PROJECT,
  text,
  createdAt: T0 - i * 9 * HOUR,
}));

export const memorySearch: MemorySearchHit[] = [
  { ...memoryItems[0], score: 0.87 },
  { ...memoryItems[2], score: 0.81 },
  { ...memoryItems[6], score: 0.74 },
  { ...memoryItems[11], score: 0.66 },
];

export const memoryStructure: MemoryStructure = {
  project: PROJECT,
  total: memoryItems.length,
  perDay: [
    { day: '2026-10-09', count: 6 },
    { day: '2026-10-10', count: 9 },
    { day: '2026-10-11', count: 5 },
  ],
  sources: [
    { name: 'ui', count: 14 },
    { name: 'agent', count: 6 },
  ],
};

export const memoryGraph: MemoryGraphData = {
  nodes: [
    { id: 'proj', label: PROJECT, kind: 'project' },
    { id: 'm-900', label: 'Persona vs role truth', kind: 'note', group: 'decisions' },
    { id: 'm-898', label: 'Timeout first-class', kind: 'note', group: 'runtime' },
    { id: 'm-896', label: 'Agent registry', kind: 'note', group: 'api' },
    { id: 'm-893', label: 'Depth layers', kind: 'note', group: 'tokens' },
    { id: 'day-10-11', label: '2026-10-11', kind: 'day' },
    { id: 'src-ui', label: 'ui', kind: 'source' },
  ],
  edges: [
    { from: 'proj', to: 'm-900', kind: 'contains' },
    { from: 'proj', to: 'm-898', kind: 'contains' },
    { from: 'proj', to: 'm-896', kind: 'contains' },
    { from: 'm-900', to: 'day-10-11', kind: 'refs' },
    { from: 'm-898', to: 'm-896', kind: 'similar' },
    { from: 'src-ui', to: 'm-893', kind: 'contains' },
  ],
};
