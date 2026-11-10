import type { NexusThemeDefinition } from '../core/types';

/**
 * AGENT-B — graphite + bronze metal, forge amber/red energy build-up.
 */
export const forgeTheme: NexusThemeDefinition = {
  id: 'forge',
  extends: 'nexus',
  description: 'Graphite, bronze, forge red/amber — energy build-up cues.',
  tokens: {
    'surface.root': '{color.graphite.950}',
    'surface.environment': '{color.graphite.900}',
    'surface.base': '{color.graphite.800}',
    'surface.panel': '{color.graphite.700}',
    'surface.elevated': '{color.graphite.600}',
    'text.accent': '{color.bronze.200}',
    // NQ-089 (elevated-gate, 18.10): amber.500 read 4.39:1 as text on
    // graphite.600 elevated. amber.400 holds 5.84 there and lifts the
    // onPrimary pair 7.37 → 9.80; matches personaText.forge canon.
    'text.link': '{color.bronze.200}',
    'text.tertiary': '{color.titanium.300}',
    'accent.primary': '{color.amber.400}',
    'accent.primaryHover': '{color.amber.300}',
    'accent.primaryActive': '{color.amber.500}',
    'accent.primarySoft': 'color-mix(in srgb, {color.amber.400} 16%, transparent)',
    'accent.energy': '{color.red.400}',
    'accent.metal': '{color.bronze.400}',
    'accent.glowColor': 'color-mix(in srgb, {color.amber.400} 45%, transparent)',
    'border.active': '{color.amber.400}',
    'chart.series.1': '{color.amber.400}',
    'chart.series.2': '{color.bronze.300}',
    'chart.series.5': '{color.red.400}',
    'state.syncing': '{color.blue.300}',
    'state.info': '{color.blue.300}',
    // Wave-XIV persona identities on graphite.700 (lighter than obsidian):
    // mech-text blue.500 = 3.92, codex-text gold.600 = 4.38, alice-edge
    // gold.700 = 2.97 — all under the gate; step to the lighter canon refs.
    // NQ-088 re-check on graphite elevated: blue.400 still 4.32 → blue.300;
    // own amber.500 4.39 → amber.400; arch violet.400 3.78 → violet.300.
    'personaText.mech': '{color.blue.300}',
    'personaText.codex': '{color.gold.500}',
    'personaText.forge': '{color.amber.400}',
    'personaText.arch': '{color.violet.300}',
    'personaEdge.alice': '{color.gold.500}',
  },
};
