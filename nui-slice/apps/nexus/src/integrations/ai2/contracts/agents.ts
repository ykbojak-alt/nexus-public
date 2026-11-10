import type { Ai2Page } from './common';

/**
 * Agent + plugin registry contracts — /v1/agents, /v1/plugins.
 * Records come from the tenant keystore (keystore.py).
 */

/** Wave XI — Handoff-кнопка спеки агента ({label, agent, prompt, send}):
 *  продолжение под ответом, аналог «Start Implementation» у Copilot plan. */
export interface Ai2Handoff {
  label: string;
  agent: string;
  prompt: string;
  send: boolean;
}

export interface Ai2Agent {
  tenant: string;
  name: string;
  description: string;
  config?: string | null;
  capabilities: string[];
  taskPrefix: string;
  maxCostUsd?: number | null;
  /** Wave XI — host-owned list; absent on servers before the column migration. */
  handoffs?: Ai2Handoff[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  config?: string;
  capabilities?: string[];
  taskPrefix?: string;
  maxCostUsd?: number;
  handoffs?: Ai2Handoff[];
}

/** PATCH semantics: only provided fields change; null clears config/maxCostUsd. */
export interface PatchAgentInput {
  description?: string;
  config?: string | null;
  capabilities?: string[];
  taskPrefix?: string;
  maxCostUsd?: number | null;
  handoffs?: Ai2Handoff[];
}

export interface Ai2Plugin {
  tenant: string;
  name: string;
  description: string;
  url: string;
  active: boolean;
  hasSecret: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Plugin record as returned by POST /v1/plugins — the only time `secret` is visible. */
export interface Ai2CreatedPlugin extends Ai2Plugin {
  secret: string;
}

export interface CreatePluginInput {
  name: string;
  url: string;
  description?: string;
  secret?: string;
}

export interface PatchPluginInput {
  description?: string;
  url?: string;
  secret?: string | null;
  active?: boolean;
}

export interface Ai2AgentsPage extends Ai2Page<Ai2Agent> {
  agents: Ai2Agent[];
}

export interface Ai2PluginsPage extends Ai2Page<Ai2Plugin> {
  plugins: Ai2Plugin[];
}
