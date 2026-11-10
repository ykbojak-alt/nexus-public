'use client';

/**
 * PHASE-C shared vocab — единый словарь OSC-статусов агентов Nexus Deck.
 * До этого AGENT_VOCAB дублировался inline в rail-deck-agents.tsx и
 * deck-agents-strip.tsx (осознанный дубль до single-source решения).
 *
 * Одно место для всех маппингов:
 *  - label  — verbatim-подпись (LIVE/BLOCKED/…);
 *  - row    — data-state для .linkedRow i (screens/app-shell CSS);
 *  - status — NexusStatus для StatusBadge;
 *  - tone   — триггер-точка rail (none|attention|live|idle).
 */

import type { NexusStatus } from '@nexus/ui';
import type { DeckAgent } from './screens/use-deck-agents';

export type { DeckAgent as AgentRow };

export interface AgentVocabEntry {
  label: string;
  row: string;
  status: NexusStatus;
  tone: 'live' | 'attention' | 'idle';
}

export const AGENT_VOCAB: Record<string, AgentVocabEntry> = {
  working: { label: 'LIVE', row: 'running', status: 'active', tone: 'live' },
  idle: { label: 'IDLE', row: 'idle', status: 'waiting', tone: 'idle' },
  done: { label: 'DONE', row: 'done', status: 'complete', tone: 'idle' },
  blocked: { label: 'BLOCKED', row: 'blocked', status: 'warning', tone: 'attention' },
  error: { label: 'ERROR', row: 'failed', status: 'error', tone: 'attention' },
};

/** agent_state приоритетен (verbatim /api/deck/agents), state — fallback. */
export function stateOf(agent: DeckAgent): string {
  return agent.agent_state ?? agent.state ?? '';
}

export function agentEntry(agent: DeckAgent): AgentVocabEntry {
  const raw = stateOf(agent);
  return AGENT_VOCAB[raw] ?? { label: raw ? raw.toUpperCase() : '—', row: 'unknown', status: 'info', tone: 'idle' };
}

export type AgentTone = 'none' | 'attention' | 'live' | 'idle';

/** Тон триггера — worst-wins: attention > live > idle > none. */
export function toneOfAgents(agents: DeckAgent[]): AgentTone {
  const tones = agents.map((a) => agentEntry(a).tone);
  if (tones.includes('attention')) return 'attention';
  if (tones.includes('live')) return 'live';
  return tones.length > 0 ? 'idle' : 'none';
}

const ATTENTION_STATES = new Set(['blocked', 'error']);

/** Худший агент для бейджа: attention → working → первый. */
export function worstAgent(agents: DeckAgent[]): DeckAgent | null {
  return agents.find((a) => ATTENTION_STATES.has(stateOf(a)))
    ?? agents.find((a) => stateOf(a) === 'working')
    ?? agents[0]
    ?? null;
}
