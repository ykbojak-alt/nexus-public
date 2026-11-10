/** Persona config for the Agents screen — one entry per agent/robot. */

export type PersonaGroup = 'TEAM' | 'SOCIAL' | 'SWARM';

export interface Persona {
  /** Stable identifier used in URLs, avatars, and routing. */
  id: string;
  /** Display name shown in the UI. */
  name: string;
  /** Role / functional description (short). */
  role: string;
  /** One-line duty summary. */
  line: string;
  /** Group: TEAM (core 7), SOCIAL (2), SWARM (6 traders). */
  group: PersonaGroup;
}

export const PERSONAS: Persona[] = [
  // ── 7 core team ──
  { id: 'alice', name: 'AGENT-A', role: 'оркестратор', line: 'декомпозиция и роутинг', group: 'TEAM' },
  { id: 'forge', name: 'ROLE-2', role: 'инженер', line: 'новые файлы/крупные волны', group: 'TEAM' },
  { id: 'codex', name: 'ROLE-1', role: 'патчер', line: 'точечные патчи', group: 'TEAM' },
  { id: 'ace', name: 'AGENT-B', role: 'кодер', line: 'быстрые волны', group: 'TEAM' },
  { id: 'qoder', name: 'ROLE-4', role: 'интегратор', line: 'tools/rae+notion', group: 'TEAM' },
  { id: 'mech', name: 'M.E.C.H.', role: 'инфраструктура', line: 'исполнение/инфра', group: 'TEAM' },
  { id: 'oracle', name: 'O.R.A.C.L.E.', role: 'стратег', line: 'стратег-советник', group: 'TEAM' },

  // ── 2 social ──
  { id: 'rae', name: 'R.A.E.', role: 'соц-конвейер', line: 'соц-конвейер', group: 'SOCIAL' },
  { id: 'sage', name: 'S.A.G.E.', role: 'канал', line: 'голос канала', group: 'SOCIAL' },

  // ── 6 swarm traders ──
  { id: 'minimax', name: 'MiniMax', role: 'трейдер', line: 'testnet-трейдер', group: 'SWARM' },
  { id: 'gpt', name: 'GPT', role: 'трейдер', line: 'testnet-трейдер', group: 'SWARM' },
  { id: 'mercury', name: 'Mercury', role: 'трейдер', line: 'testnet-трейдер', group: 'SWARM' },
  { id: 'meta', name: 'Meta', role: 'трейдер', line: 'testnet-трейдер', group: 'SWARM' },
  { id: 'agnes', name: 'Agnes', role: 'трейдер', line: 'testnet-трейдер', group: 'SWARM' },
  { id: 'mistral', name: 'Mistral', role: 'трейдер', line: 'testnet-трейдер', group: 'SWARM' },
];
