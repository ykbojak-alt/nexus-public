import { registerTheme, themeRegistry } from './registry';
import type { NexusThemeDefinition, ResolvedNexusTheme } from './types';

export const FALLBACK_THEME_ID = 'nexus';

/**
 * Resolve a theme id or an ad-hoc definition into effective token overrides.
 * - Unknown string id -> deterministic 'nexus' fallback (spec §7, plan Task 3).
 * - `extends` chains resolve child-over-ancestors; unknown parents degrade to
 *   'nexus'; cycles stop at the first repeated id.
 */
export function resolveTheme(idOrDef: string | NexusThemeDefinition): ResolvedNexusTheme {
  const def = typeof idOrDef === 'string' ? themeRegistry.get(idOrDef) : idOrDef;
  if (!def) return materialize(themeRegistry.get(FALLBACK_THEME_ID)!);
  return materialize(def);
}

export { registerTheme };

function materialize(def: NexusThemeDefinition): ResolvedNexusTheme {
  const chain: NexusThemeDefinition[] = [];
  const seen = new Set<string>();
  let cur: NexusThemeDefinition | undefined = def;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    const parentId: string | undefined = cur.extends;
    if (!parentId) break;
    // Unknown parent degrades to the nexus base so partial themes still render.
    cur = themeRegistry.get(parentId) ?? themeRegistry.get(FALLBACK_THEME_ID);
  }

  const tokens: Record<string, string> = {};
  for (const layer of chain) Object.assign(tokens, layer.tokens);

  return { id: def.id, tokens, chain: chain.map((t) => t.id) };
}
