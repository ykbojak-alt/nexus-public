import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHART_CHROME, TONE_VARS, seriesVar } from './palette';

const here = dirname(fileURLToPath(import.meta.url));
const generatedCss = readFileSync(
  join(here, '../../../tokens/generated/tokens.css'),
  'utf8',
);
const generatedVars = new Set(generatedCss.match(/--nexus-[a-z0-9-]+/g));

const VAR_USE = /var\((--nexus-[a-z0-9-]+)/g;

describe('palette ↔ generated tokens (chart.tokens.json → tokens.css)', () => {
  it('every tone var resolves to a generated token', () => {
    for (const [tone, v] of Object.entries(TONE_VARS)) {
      const name = VAR_USE.exec(v)?.[1];
      VAR_USE.lastIndex = 0;
      expect(generatedVars.has(name!), `tone '${tone}' → ${v}`).toBe(true);
    }
  });

  it('auto palette slots 1..8 all exist', () => {
    for (let i = 0; i < 8; i++) {
      const name = VAR_USE.exec(seriesVar(i))?.[1];
      VAR_USE.lastIndex = 0;
      expect(generatedVars.has(name!)).toBe(true);
    }
  });

  it('chrome vars exist in generated css', () => {
    for (const [role, v] of Object.entries(CHART_CHROME)) {
      const name = VAR_USE.exec(v)?.[1];
      VAR_USE.lastIndex = 0;
      expect(generatedVars.has(name!), `chrome '${role}' → ${v}`).toBe(true);
    }
  });

  it('every --nexus-* var used in chart css files is generated', () => {
    for (const dir of readdirSync(here, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      for (const f of readdirSync(join(here, dir.name))) {
        if (!f.endsWith('.css')) continue;
        const css = readFileSync(join(here, dir.name, f), 'utf8');
        for (const m of css.matchAll(VAR_USE)) {
          expect(generatedVars.has(m[1]), `${f}: ${m[1]}`).toBe(true);
        }
      }
    }
  });
});
