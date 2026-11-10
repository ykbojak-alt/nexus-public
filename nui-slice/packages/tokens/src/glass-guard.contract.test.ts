import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('glass-scrim guard (W2-146)', () => {
  it('emits --nexus-glass-scrim in generated tokens.css', () => {
    const css = readFileSync(join(ROOT, 'generated', 'tokens.css'), 'utf8');
    const m = css.match(/--nexus-glass-scrim\s*:\s*([^;]+);/);
    expect(m, 'token missing').not.toBeNull();
    expect(m![1]).toMatch(/color-mix\(in srgb/);
  });

  it('scrim alpha is at least 40% (contrast guard floor)', () => {
    const css = readFileSync(join(ROOT, 'generated', 'tokens.css'), 'utf8');
    const m = css.match(/--nexus-glass-scrim\s*:\s*color-mix\(in srgb,\s*#[0-9A-Fa-f]+\s+(\d+)%/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(40);
  });
});
