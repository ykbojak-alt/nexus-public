import { describe, expect, it } from 'vitest';
import { buildTokens, loadCanonicalThemes, loadTokenSources } from '../scripts/build-tokens';

describe('compact state token contract', async () => {
  const result = buildTokens(loadTokenSources(), await loadCanonicalThemes());
  const rootBlock = result.css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
  const vars = new Map([...rootBlock.matchAll(/(--nexus-[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));

  it('defines theme-resolved normal, warning and active semantic state roles', () => {
    for (const state of ['normal', 'warning', 'active']) {
      expect(vars.get(`--nexus-compact-${state}`), `missing compact ${state}`).toBeTruthy();
    }
    expect(vars.get('--nexus-compact-block-edge')).toBe('#C9A45C');
    expect(vars.get('--nexus-compact-block-bg')).toBeTruthy();
    expect(vars.get('--nexus-compact-block-bg-opaque')).toBeTruthy();
  });

  it('keeps compact block states mapped to semantic theme roles', () => {
    const alice = result.css.match(/\[data-theme="alice"\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(alice).toContain('--nexus-compact-normal:');
    expect(alice).toContain('--nexus-compact-warning:');
    expect(alice).toContain('--nexus-compact-active:');
    expect(alice).toContain('--nexus-compact-block-edge: #876D38;');
  });

  it('includes reduced-transparency glass fallback and keeps the blur budget unchanged', () => {
    expect(result.css).toContain('--nexus-compact-block-bg-opaque');
    expect(result.flat.find((token) => token.path === 'glass.maxBlurLayers')?.value).toBe(4);
    expect(result.flat.some((token) => token.path === 'compactBlock.blur')).toBe(false);
  });

  it('defines theme-resolved badge states and compact-row text colors', () => {
    for (const path of [
      'compactBadge.background',
      'compactBadge.text',
      'compactBadge.border',
      'compactBadge.hoverBackground',
      'compactBadge.expandedBackground',
      'compactBadge.expandedText',
      'compactBadge.expandedBorder',
      'compactBadge.minWidth',
      'compactRow.primaryText',
      'compactRow.secondaryText',
    ]) {
      expect(result.flat.some((token) => token.path === path), `missing ${path}`).toBe(true);
    }
    const alice = result.css.match(/\[data-theme="alice"\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(alice).toContain('--nexus-compact-badge-background:');
    expect(alice).toContain('--nexus-compact-badge-expanded-background:');
    expect(vars.get('--nexus-compact-badge-min-width')).toBe('40px');
  });
});
