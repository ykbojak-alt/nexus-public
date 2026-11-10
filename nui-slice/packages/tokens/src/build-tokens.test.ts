import { describe, expect, it } from 'vitest';
import { buildTokensForTest } from '../scripts/build-tokens';
import { validateTokenSet } from '../scripts/validate-tokens';

describe('token pipeline', () => {
  it('emits canonical primitive and semantic roles', () => {
    const out = buildTokensForTest();
    expect(out.css).toContain('--nexus-color-gold-500: #C9A45C');
    expect(out.css).toContain('--nexus-accent-primary:');
    expect(out.css).toContain('--nexus-glass-panel-border:');
  });

  it('emits chart series palette consumed by @nexus/ui charts', () => {
    const out = buildTokensForTest();
    expect(out.css).toContain('--nexus-chart-series-1:');
    expect(out.css).toContain('--nexus-chart-grid-major:');
  });

  it('rejects unresolved token references', () => {
    const broken = { a: { $type: 'color', b: { $value: '{does.not.exist}' } } };
    expect(() => validateTokenSet(broken)).toThrow(/unresolved/i);
  });

  it('rejects unknown token types', () => {
    const bad = { a: { $type: 'bogus', b: { $value: '1px' } } };
    expect(() => validateTokenSet(bad)).toThrow(/unknown \$type/i);
  });

  it('rejects cyclic references at resolution', async () => {
    const { resolveReferences, flattenTokens } = await import('../scripts/validate-tokens');
    const cyc = flattenTokens({
      a: { $type: 'color', x: { $value: '{a.y}' }, y: { $value: '{a.x}' } },
    });
    expect(() => resolveReferences(cyc)).toThrow(/cyclic/i);
  });

  it('emits density-scaled spacing blocks', () => {
    const { css } = buildTokensForTest();
    for (const d of ['calm', 'standard', 'dense']) {
      expect(css).toContain(`[data-density='${d}']`);
      expect(css).toContain('--nexus-density-scale');
    }
    expect(css).toContain('--nexus-space-4: calc(16px * 1.15)');
    expect(css).toContain('--nexus-space-4: calc(16px * 0.85)');
  });

  it('emits a [data-theme] block for every canonical theme', async () => {
    const { buildTokens, loadTokenSources, loadCanonicalThemes } = await import(
      '../scripts/build-tokens'
    );
    const { css } = buildTokens(loadTokenSources(), await loadCanonicalThemes());
    for (const id of ['nexus', 'alice', 'mech', 'forge', 'codex', 'arch']) {
      expect(css).toContain(`[data-theme="${id}"]`);
    }
    // Real pipeline: loadTokenSources off disk + full re-resolve per theme
    // (dependent propagation since 2026-10-19) — legitimately over 5s.
  }, 30_000);
});
