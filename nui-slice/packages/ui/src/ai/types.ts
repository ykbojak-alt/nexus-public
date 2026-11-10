/** Shared AI-component prop contracts — transport-free, presentation only. */

export type AgentPresenceKind = 'online' | 'busy' | 'idle' | 'offline' | 'error';
export type Freshness = 'live' | 'stale' | 'archived';

/** Persona identity — maps to an agent.* icon and theme accent by id. */
export interface AgentRef {
  id: string;        // canonical persona id: nexus|alice|mech|forge|codex|arch
  name: string;
}

/** Runtime truth is separate from persona identity — never conflate. */
export type AgentStatusKind = 'active' | 'idle' | 'working' | 'blocked' | 'offline';

export type ConfidenceValue =
  | { kind: 'category'; value: 'low' | 'medium' | 'high' }
  | { kind: 'percent'; value: number };
