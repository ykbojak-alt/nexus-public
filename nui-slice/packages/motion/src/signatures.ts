/**
 * Agent motion signatures — spec §10. Each agent gets a recognizable
 * kinetic identity; shared components consume the signature, never
 * per-agent JSX forks.
 */

import type { MotionDuration, MotionEasing } from './presets';

export type AgentMotionSignatureId = 'nexus' | 'alice' | 'mech' | 'forge' | 'codex' | 'arch';

export interface AgentMotionSignature {
  /** Free verbs describing the kinetic identity (for docs/stories). */
  verbs: readonly string[];
  /** Base breathing/pulse tempo for ambient motion. */
  tempo: MotionDuration;
  easing: MotionEasing;
}

/** Spec §10 signatures — six canonical agents. */
export const AGENT_SIGNATURES: Record<AgentMotionSignatureId, AgentMotionSignature> = {
  alice: { verbs: ['soft', 'fluid', 'breathing', 'radial'], tempo: 'slow', easing: 'standard' },
  mech: { verbs: ['precise', 'linear', 'mechanical'], tempo: 'fast', easing: 'exit' },
  forge: { verbs: ['build-up', 'heat-pulse', 'converge'], tempo: 'normal', easing: 'spring' },
  codex: { verbs: ['layer-reveal', 'geometry-align', 'orbit'], tempo: 'normal', easing: 'standard' },
  arch: { verbs: ['slow-depth', 'memory-unfold', 'temporal'], tempo: 'cinematic', easing: 'enter' },
  nexus: { verbs: ['orbital', 'multi-node', 'synchronized'], tempo: 'slow', easing: 'spring' },
};

export function agentSignature(id: string): AgentMotionSignature {
  return AGENT_SIGNATURES[(id as AgentMotionSignatureId)] ?? AGENT_SIGNATURES.nexus;
}
