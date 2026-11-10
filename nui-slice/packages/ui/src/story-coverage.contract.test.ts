import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * W2-09/W2-10 contract — the story coverage matrix is enforced, not
 * documented: every public visual export of @nexus/ui must be named in at
 * least one *.stories.tsx file. A missing name means the component has no
 * renderable baseline for the W5 visual matrix.
 *
 * Exemptions by kind (non-visual exports): theme provider + hook (applied
 * implicitly by decorators/consumers), constants and label dictionaries,
 * utils. `export * from './charts'` is W4-owned — covered by per-chart
 * stories and palette tests, intentionally not parsed here.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = join(HERE, 'index.ts');
const STORIES_DIR = join(HERE, '..', '..', '..', 'apps', 'storybook', 'stories');

const EXEMPT = new Set([
  'NexusThemeProvider', 'useNexusTheme', 'maskSecrets',
  'MASKED', 'PERMISSION_MODE_LABELS', 'SERVICE_STATE_LABELS', 'SESSION_STATE_LABELS',
  'ACCESS_MODE_LABELS',
  'CONNECTION_STATE_LABELS', 'QWEN_CLIENT_STATE_LABELS', 'QWEN_SUBSYSTEM_LABELS',
  'QWEN_SUBSYSTEM_STATE_LABELS',
  'GRANT_LIVENESS_STATUS', 'GRANT_LIVENESS_LABELS',
]);

function exportedComponents(): string[] {
  const src = readFileSync(INDEX, 'utf8');
  const names = new Set<string>();
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim();
      if (name === '' || name.startsWith('type ')) continue;
      const local = name.split(/\s+as\s+/).pop()!.trim();
      if (/^[A-Z]/.test(local) && !EXEMPT.has(local)) names.add(local);
    }
  }
  return [...names].sort();
}

describe('story coverage contract (W2-09/10)', () => {
  it('every public component export is named in a story file', () => {
    const storyText = readdirSync(STORIES_DIR)
      .filter((f) => f.endsWith('.stories.tsx'))
      .map((f) => readFileSync(join(STORIES_DIR, f), 'utf8'))
      .join('\n');
    const missing = exportedComponents().filter(
      (n) => !new RegExp(`\\b${n}\\b`).test(storyText),
    );
    expect(missing).toEqual([]);
  });
});
