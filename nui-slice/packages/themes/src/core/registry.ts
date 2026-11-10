import type { NexusThemeDefinition } from './types';
import { nexusTheme } from '../themes/nexus';
import { aliceTheme } from '../themes/alice';
import { mechTheme } from '../themes/mech';
import { forgeTheme } from '../themes/forge';
import { codexTheme } from '../themes/codex';
import { archTheme } from '../themes/arch';
import { aurumDarkTheme } from '../themes/aurum-dark';

/** Canonical themes, keyed by id. Custom themes join via registerTheme(). */
export const themeRegistry: ReadonlyMap<string, NexusThemeDefinition> = new Map(
  [nexusTheme, aliceTheme, mechTheme, forgeTheme, codexTheme, archTheme, aurumDarkTheme]
    .map((t) => [t.id, t]),
);

/** Register an extension theme (created via createNexusTheme). */
export function registerTheme(def: NexusThemeDefinition): void {
  (themeRegistry as Map<string, NexusThemeDefinition>).set(def.id, def);
}
