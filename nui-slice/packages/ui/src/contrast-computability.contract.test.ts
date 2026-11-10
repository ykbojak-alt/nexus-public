import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * NQ-024 regression guard — contrast computability (contracts §5).
 *
 * axe cannot evaluate text contrast over `linear-gradient` backgrounds and
 * silently moves nodes to `incomplete` — a green gate with real violations
 * underneath. Tinted surfaces under text MUST be solid `color-mix`.
 * This test fails if any UI module.css rule both sets `color:` and paints
 * a `linear-gradient` background in the same declaration block.
 */
function* cssFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* cssFiles(full);
    else if (entry.endsWith('.module.css')) yield full;
  }
}

const RULE = /([^{}]+)\{([^{}]*)\}/g;
const COMMENT = /\/\*.*?\*\//gs;

describe('CSS contrast computability (NQ-024 contract)', () => {
  it('no text-colored rule paints a linear-gradient background', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(join(__dirname, '.'))) {
      const css = readFileSync(file, 'utf8').replace(COMMENT, '');
      for (const m of css.matchAll(RULE)) {
        const [, selector, body] = m;
        const setsTextColor = /(^|;)\s*color\s*:/.test(body);
        const paintsGradient = /(^|;)\s*background[^;]*linear-gradient/.test(body);
        if (setsTextColor && paintsGradient) {
          offenders.push(
            `${file}: ${selector.trim().split('\n').pop()?.trim()} — gradient under text is not axe-computable; use solid color-mix`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
