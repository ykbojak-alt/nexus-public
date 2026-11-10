import type { Density, ThemeId, UiLevel, UserProfile } from '@nexus/mock-data';

export type { Density, ThemeId, UiLevel, UserProfile };

export const PROFILE_STORAGE_KEY = 'nexus.profile.v1';

export const UI_LEVELS: { id: UiLevel; label: string }[] = [
  { id: 'simple', label: 'Простой' },
  { id: 'professional', label: 'Профессиональный' },
  { id: 'team', label: 'Командный' },
];

/** runtime-wave2 2a: пользователь по умолчанию — единственная настройка
 *  профиля, из которой берётся имя в приветствиях; не разметка экранов. */
export const DEFAULT_OPERATOR_NAME = 'Yury';

export function createEmptyProfile(): UserProfile {
  return {
    name: '',
    themeId: 'nexus',
    density: 'standard',
    agentId: 'nexus',
    surfaces: {},
    osNotifications: false,
    uiLevel: 'professional',
    favoritePrompts: [],
    defaultPreset: null,
    defaultModelId: null,
    defaultRunAgent: null,
    voiceSpeakerId: null,
    voiceAutoSpeak: false,
    navCollapsed: false,
    // M2/M3: ON — the host corpus is seeded (task M1) and a live retrieval
    // run verified (run e665f5d1, tool_call memory_search → ответ из доков).
    useMemory: true,
    memoryProject: 'ai2',
    // fs-access: conservative default — writes need an explicit per-request
    // approval until the user flips the regulator under the composer.
    fsMode: 'read_only',
    fsRoots: [],
    // Wave XI — режим композитора по умолчанию: полный прогон (Copilot 'agent').
    composerMode: 'agent',
    // Operator token for RAE daemon POST via Caddy (X-Nexus-Op header)
    raeOpToken: '',
    // Token for TPlayer engine proxy via Caddy (X-Nexus-TPlayer header)
    tplayerToken: '',
  };
}

export function isProfileComplete(p: UserProfile | null): p is UserProfile {
  return p != null && p.name.trim().length > 0;
}
