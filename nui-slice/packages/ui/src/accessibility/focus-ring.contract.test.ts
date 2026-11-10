import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'focus-ring.css'), 'utf8');
const tokens = readFileSync(join(__dirname, '../../../tokens/generated/tokens.css'), 'utf8');

describe('shared focus ring contract (W2-143)', () => {
  it('uses the theme color and shared width/offset for every keyboard target', () => {
    expect(css).toMatch(/\[data-theme\]\s*:is\([\s\S]*?\):focus-visible:not\(:root\)\s*\{/);
    expect(css).toContain('outline: var(--nexus-focus-ring-width, 2px) solid var(--nexus-focus-ring, #539EFF)');
    expect(css).toContain('outline-offset: var(--nexus-focus-ring-offset, 2px)');
    expect(css).toContain('transition: outline-offset var(--nexus-duration-fast, 140ms)');
    expect(css).toContain('cubic-bezier(var(--nexus-easing-enter, 0, 0, 0.2, 1))');
    expect(css).toContain('box-shadow: none');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*?:focus-visible:not\(:root\)\s*\{\s*transition:\s*none;/);
    expect(tokens).toContain('--nexus-focus-ring-width: 2px');
    expect(tokens).toContain('--nexus-focus-ring-offset: 2px');
    expect(tokens).toContain('--nexus-focus-ring: #539EFF');
    expect(tokens).toContain('--nexus-duration-fast: 140ms');
    expect(tokens).toContain('--nexus-easing-enter: 0, 0, 0.2, 1');
  });

  it('uses the system Highlight ring in forced-colors mode', () => {
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('outline: var(--nexus-focus-ring-width, 2px) solid Highlight');
    expect(css).toContain('outline-offset: var(--nexus-focus-ring-offset, 2px)');
  });
});
