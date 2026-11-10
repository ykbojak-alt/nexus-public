import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DURATION_MS, EASING_BEZIER } from './presets';

const generatedCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../tokens/generated/tokens.css'),
  'utf8',
);

function varValue(name: string): string | undefined {
  const m = generatedCss.match(new RegExp(`${name}:\\s*([^;]+);`));
  return m?.[1].trim();
}

describe('motion presets ↔ generated tokens (motion.tokens.json → tokens.css)', () => {
  it('every duration literal equals its generated --nexus-duration-* value', () => {
    for (const [key, ms] of Object.entries(DURATION_MS)) {
      expect(varValue(`--nexus-duration-${key}`), key).toBe(`${ms}ms`);
    }
  });

  it('every easing bezier equals its generated --nexus-easing-* value', () => {
    for (const [key, bezier] of Object.entries(EASING_BEZIER)) {
      expect(varValue(`--nexus-easing-${key}`), key).toBe(bezier.join(', '));
    }
  });
});
