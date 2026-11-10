/**
 * Agent pattern prop contracts — view-model shapes only (docs/product/
 * view-model-contracts.md). Patterns never fetch and never see raw
 * backend JSON; screens/adapters supply these props.
 */
import type { ProcessState, RunStatus } from '@nexus/mock-data';

/** Shared product state union (view-model §7). */
export type PatternState = 'loading' | 'ready' | 'empty' | 'error' | 'stale';

/** Registry spec (GET /v1/agents shape, view-model §5) + optional live overlay. */
export interface AgentRosterItem {
  name: string;
  description: string | null;
  config: string | null;
  capabilities: string[];
  maxCostUsd: number | null;
  /** Live presence — from processes, not invented (§8 invariant 5). */
  status?: 'idle' | 'active' | 'blocked' | 'offline';
  activeTask?: string | null;
}

/** Live process row per agent — server state vocab verbatim (§1 ProcessRow). */
export interface PresenceEntry {
  agent: string;
  state: ProcessState;
  task: string;
  runId: string | null;
}

/** Delegation edge between agents (spawn/handoff — mission graph 'delegates'). */
export interface HandoffLink {
  id: string;
  /** Parent agent spec name; null = started by operator/system. */
  from: string | null;
  to: string;
  task: string;
  runId: string;
  status: RunStatus;
  ts: number;
}

/** Recent-run row for the inspector. */
export interface AgentRunRow {
  runId: string;
  taskText: string;
  status: RunStatus;
  createdAt: number;
  costUsd: number | null;
}
