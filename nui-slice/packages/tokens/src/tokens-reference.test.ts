import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTokenReference } from '../scripts/gen-token-reference';

/**
 * Freshness contract (wave-XV W2): docs/product/tokens-reference.md must be
 * byte-equal to a fresh render of the token pipeline. If a token or theme
 * changes, regenerate: `npx tsx packages/tokens/scripts/gen-token-reference.ts`.
 */
describe('tokens-reference freshness', () => {
  it('docs/product/tokens-reference.md equals the generated render', async () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'product', 'tokens-reference.md');
    const onDisk = readFileSync(file, 'utf8');
    const fresh = await renderTokenReference();
    expect(onDisk).toBe(fresh);
  });
});
