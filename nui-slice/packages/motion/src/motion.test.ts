import { describe, expect, it } from 'vitest';
import { DURATION_MS, MOTION_PRESETS } from './presets';
import { AGENT_SIGNATURES, agentSignature, type AgentMotionSignatureId } from './signatures';
import { resolveMotion } from './reduced-motion';

const CANONICAL_DURATIONS = [80, 140, 240, 420, 700];

describe('motion presets (spec §10)', () => {
  it('uses only the canonical duration scale', () => {
    for (const ms of Object.values(DURATION_MS)) {
      expect(CANONICAL_DURATIONS).toContain(ms);
    }
    for (const preset of Object.values(MOTION_PRESETS)) {
      expect(CANONICAL_DURATIONS).toContain(DURATION_MS[preset.duration]);
    }
  });

  it('exposes the four motion levels', () => {
    expect(Object.keys(MOTION_PRESETS).sort()).toEqual(['intelligence', 'micro', 'panel', 'spatial']);
  });
});

describe('agent signatures (spec §10)', () => {
  it.each(['nexus', 'alice', 'mech', 'forge', 'codex', 'arch'] as const)('has %s signature', (id: AgentMotionSignatureId) => {
    expect(AGENT_SIGNATURES[id].verbs.length).toBeGreaterThan(0);
  });

  it('falls back to nexus for an unknown agent id', () => {
    expect(agentSignature('does-not-exist')).toBe(AGENT_SIGNATURES.nexus);
  });
});

describe('reduced motion (spec §10/§14)', () => {
  it('strips spatial verbs to fade-only but keeps timing', () => {
    const r = resolveMotion('spatial', { reducedMotion: true });
    expect(r.reduced).toBe(true);
    expect(r.verbs).toEqual(['fade']);
    expect(r.durationMs).toBe(DURATION_MS.slow);
  });

  it('passes through when motion is allowed', () => {
    const r = resolveMotion('intelligence');
    expect(r.reduced).toBe(false);
    expect(r.verbs).toContain('orbit');
  });

  it('never returns an empty verb list', () => {
    const r = resolveMotion('micro', { reducedMotion: true });
    expect(r.verbs.length).toBeGreaterThan(0);
  });
});
