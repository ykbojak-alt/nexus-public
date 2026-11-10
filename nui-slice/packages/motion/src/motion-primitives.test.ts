import { describe, expect, it } from 'vitest';
import { motionStyle, signatureStyle } from './motion-primitives';
import { DURATION_MS } from './presets';
import { AGENT_SIGNATURES } from './signatures';

describe('motionStyle — applicable preset styles (D6)', () => {
    it('resolves preset duration/easing into CSS values', () => {
        const s = motionStyle('panel');
        expect(s.transitionDuration).toBe('140ms');
        expect(s.transitionTimingFunction).toBe('cubic-bezier(0, 0, 0.2, 1)');
        expect(s.transitionProperty).toContain('opacity');
        expect(s.transitionProperty).toContain('transform');
    });

    it('reduced-motion strips spatial verbs to opacity-only', () => {
        const s = motionStyle('spatial', { reducedMotion: true });
        expect(s.transitionProperty).toBe('opacity');
        expect(s.transitionDuration).toBe('420ms');
        expect(s.transitionTimingFunction).toBe('cubic-bezier(0.2, 0, 0, 1)');
    });
});

describe('snapshot-safe mode (D7)', () => {
    it('zeroes duration and keeps opacity only', () => {
        const s = motionStyle('intelligence', { snapshot: true });
        expect(s.transitionDuration).toBe('0ms');
        expect(s.transitionProperty).toBe('opacity');
    });

    it('signatureStyle snapshot is deterministic too', () => {
        const s = signatureStyle('arch', { snapshot: true });
        expect(s.transitionDuration).toBe('0ms');
        expect(s.transitionProperty).toBe('opacity');
    });
});

describe('signatureStyle — agent signatures (D7)', () => {
    it('emits the signature tempo/easing for a known agent', () => {
        const s = signatureStyle('mech');
        expect(s.transitionDuration).toBe('140ms');
        expect(s.transitionTimingFunction).toBe('cubic-bezier(0.4, 0, 1, 1)');
    });

    it('falls back to the nexus signature for unknown ids', () => {
        const s = signatureStyle('not-an-agent');
        expect(s.transitionDuration).toBe('420ms');
        expect(s.verbs).toEqual(['orbital', 'multi-node', 'synchronized']);
    });

    it('reduced-motion drops transform-carrying verbs', () => {
        const s = signatureStyle('forge', { reducedMotion: true });
        expect(s.transitionProperty).not.toContain('transform');
    });
});

describe('signatureStyle — six-signature reduced matrix (W4-03)', () => {
    // Runbook W4-03: status/action must not depend on motion — under
    // reduced-motion every signature degrades to opacity-only while keeping
    // its tempo, so a change is still *visible* (fade), never spatial.
    const IDS = ['nexus', 'alice', 'mech', 'forge', 'codex', 'arch'] as const;

    it.each(IDS)('signature "%s" reduces to opacity-only, tempo preserved', (id) => {
        const s = signatureStyle(id, { reducedMotion: true });
        expect(s.transitionProperty).toBe('opacity');
        expect(s.transitionDuration).toBe(`${DURATION_MS[AGENT_SIGNATURES[id].tempo]}ms`);
        expect(s.transitionProperty.includes('transform')).toBe(false);
    });

    it('a signature is always emitted — unknown id still yields a valid style', () => {
        for (const opts of [{ reducedMotion: true }, { snapshot: true }, {}]) {
            const s = signatureStyle('unknown-agent', opts);
            expect(s.transitionProperty.length).toBeGreaterThan(0);
            expect(s.transitionDuration).toMatch(/^\d+ms$/);
        }
    });
});
