import { describe, expect, it } from 'vitest';
import { buildTokens, loadCanonicalThemes, loadTokenSources } from '../scripts/build-tokens';

describe('title token contract (W2-126)', async () => {
  const result = buildTokens(loadTokenSources(), await loadCanonicalThemes());
  const rootBlock = result.css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
  const vars = new Map([...rootBlock.matchAll(/(--nexus-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

  it('emits the three-level title scale bound to the canonical type roles', () => {
    const expected: Record<string, { size: string; line: string; weight: string }> = {
      panel: { size: '18px', line: '26px', weight: '500' },
      section: { size: '28px', line: '36px', weight: '400' },
      screen: { size: '40px', line: '48px', weight: '300' },
    };
    for (const [level, spec] of Object.entries(expected)) {
      expect(vars.get(`--nexus-title-${level}-font-size`), `${level} size`).toBe(spec.size);
      expect(vars.get(`--nexus-title-${level}-line-height`), `${level} line`).toBe(spec.line);
      expect(vars.get(`--nexus-title-${level}-font-weight`), `${level} weight`).toBe(spec.weight);
      expect(vars.get(`--nexus-title-${level}-font-family`)).toContain('Inter Tight');
    }
  });

  it('emits theme-resolved chrome tokens (color, subtitle, icon, divider, gaps)', () => {
    for (const name of [
      '--nexus-title-color',
      '--nexus-title-subtitle-color',
      '--nexus-title-icon-color',
      '--nexus-title-divider',
      '--nexus-title-gap',
      '--nexus-title-icon-size',
      '--nexus-title-padding-block',
      '--nexus-title-padding-inline',
    ]) {
      expect(vars.get(name), `missing ${name}`).toBeTruthy();
    }
    const alice = result.css.match(/\[data-theme="alice"\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(alice).toContain('--nexus-title-color:');
    expect(alice).toContain('--nexus-title-subtitle-color:');
  });
});
