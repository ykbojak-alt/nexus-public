import { describe, expect, it } from 'vitest';
import { createNexusTheme, registerTheme, resolveTheme } from './index';

describe('theme engine (plan Task 3 contract)', () => {
  it('resolves all six canonical themes', () => {
    for (const id of ['nexus', 'alice', 'mech', 'forge', 'codex', 'arch']) {
      expect(resolveTheme(id).id).toBe(id);
    }
  });

  it('extends nexus for a future agent and falls back safely', () => {
    const sage = createNexusTheme({
      id: 'sage', extends: 'nexus', tokens: { 'accent.energy': '#88ffaa' },
    });
    expect(resolveTheme(sage).tokens['surface.root']).toBe(resolveTheme('nexus').tokens['surface.root']);
    expect(resolveTheme(sage).tokens['accent.energy']).toBe('#88ffaa');
    expect(resolveTheme('does-not-exist').id).toBe('nexus');
  });

  it('lets children override ancestors and records the chain', () => {
    const child = createNexusTheme({ id: 'x', extends: 'alice', tokens: { 'surface.root': '#000' } });
    const r = resolveTheme(child);
    expect(r.tokens['surface.root']).toBe('#000');
    expect(r.tokens['text.accent']).toBe(resolveTheme('alice').tokens['text.accent']);
    expect(r.chain).toContain('nexus');
    expect(r.chain.at(-1)).toBe('x');
  });

  it('stops cyclic extends without hanging', () => {
    const a = createNexusTheme({ id: 'cyc-a', extends: 'cyc-b', tokens: {} });
    const b = createNexusTheme({ id: 'cyc-b', extends: 'cyc-a', tokens: {} });
    registerTheme(a); registerTheme(b);
    expect(resolveTheme('cyc-a').id).toBe('cyc-a');
    expect(resolveTheme('cyc-b').id).toBe('cyc-b');
  });

  it('degrades unknown parents to the nexus base', () => {
    const orphan = createNexusTheme({ id: 'orphan', extends: 'ghost', tokens: { 'text.primary': '#fff' } });
    const r = resolveTheme(orphan);
    expect(r.tokens['surface.root']).toBe(resolveTheme('nexus').tokens['surface.root']);
    expect(r.tokens['text.primary']).toBe('#fff');
  });
});
