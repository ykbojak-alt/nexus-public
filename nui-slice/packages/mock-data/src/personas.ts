import type { AgentIdentity, UserProfile } from './types';

/** Deterministic anchor — all fixture timestamps derive from T0 (mock-fixtures-spec §1). */
export const T0 = 1_760_000_000;

const ROLE_NOTE =
  'Персона управляет оформлением интерфейса. Роли рантайма (planner, executor, critic) и спеки агентов показываются фактами — без подмены персоной.';

export const PERSONAS: AgentIdentity[] = [
  { id: 'nexus', name: 'NEXUS', themeId: 'nexus', description: 'Ядро среды — нейтральный оператор по умолчанию.', focus: ['ядро', 'оркестрация'], roleNote: ROLE_NOTE },
  { id: 'alice', name: 'AGENT-A', themeId: 'alice', description: 'Аналитик: интерпретация, координация, смыслы.', focus: ['диалог', 'инсайты', 'креативность'], roleNote: ROLE_NOTE },
  { id: 'mech', name: 'M.E.C.H.', themeId: 'mech', description: 'Исполнитель: процессы, диагностика, каналы.', focus: ['инженерия', 'анализ', 'автоматизация'], roleNote: ROLE_NOTE },
  { id: 'forge', name: 'AGENT-B', themeId: 'forge', description: 'Инженер: архитектура, крупные задачи, оркестрация.', focus: ['синтез', 'создание', 'оркестрация'], roleNote: ROLE_NOTE },
  { id: 'codex', name: 'AGENT-C', themeId: 'codex', description: 'Точечные патчи и ревизии существующего кода.', focus: ['логика', 'правила', 'память'], roleNote: ROLE_NOTE },
  { id: 'arch', name: 'A.R.C.H.', themeId: 'arch', description: 'Архивариус: память, канон, прослеживаемость.', focus: ['поиск', 'анализ', 'исследования'], roleNote: ROLE_NOTE },
];

export const profiles: { default: UserProfile; empty: UserProfile } = {
  default: {
    name: 'Оператор',
    themeId: 'nexus',
    density: 'standard',
    agentId: 'nexus',
    surfaces: { briefing: true, telemetry: true, alerts: true },
    osNotifications: false,
    favoritePrompts: [
      { id: 'fp-1', text: 'Разбери логи прогона и предложи следующий эксперимент' },
      { id: 'fp-2', text: 'Собери дайджест за сегодня по активным проектам' },
    ],
  },
  empty: {
    name: '',
    themeId: 'nexus',
    density: 'standard',
    agentId: 'nexus',
    surfaces: {},
    osNotifications: false,
    favoritePrompts: [],
  },
};
