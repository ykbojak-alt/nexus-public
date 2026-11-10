import type { NexusThemeDefinition } from '../core/types';

/**
 * AGENT-C — graphite/obsidian archive, antique gold marks,
 * archive violet for logic/energy.
 */
export const codexTheme: NexusThemeDefinition = {
  id: 'codex',
  extends: 'nexus',
  description: 'Graphite/obsidian, antique gold, archive violet — geometric logic.',
  tokens: {
    'surface.root': '{color.graphite.950}',
    'surface.environment': '{color.obsidian.900}',
    'surface.base': '{color.obsidian.850}',
    'surface.panel': '{color.obsidian.800}',
    'surface.elevated': '{color.graphite.700}',
    'text.accent': '{color.gold.300}',
    // NQ-089 (elevated-gate, 18.10): gold.600 read 4.38:1 as text on
    // graphite.700 elevated. gold.400 holds 7.07 there and lifts the
    // onPrimary pair 5.94 → 9.58. gold.500 отпал — совпал бы с nexus
    // accent и сломал «5 distinct window-frame hairlines».
    'text.link': '{color.gold.300}',
    'accent.primary': '{color.gold.400}',
    'accent.primaryHover': '{color.gold.300}',
    'accent.primaryActive': '{color.gold.500}',
    'accent.primarySoft': 'color-mix(in srgb, {color.gold.400} 16%, transparent)',
    'accent.energy': '{color.violet.400}',
    'accent.energySoft': 'color-mix(in srgb, {color.violet.400} 16%, transparent)',
    'accent.violet': '{color.violet.300}',
    'accent.glowColor': 'color-mix(in srgb, {color.violet.400} 45%, transparent)',
    'border.active': '{color.violet.400}',
    'chart.series.1': '{color.violet.300}',
    'chart.series.2': '{color.gold.400}',
    // NQ-088 re-check on codex elevated (#26292E): codex-text gold.600 4.38→
    // gold.500 6.22; alice edge gold.700 2.97→gold.600 4.38 (non-text ≥3:1).
    'personaText.codex': '{color.gold.500}',
    'personaEdge.alice': '{color.gold.600}',
  },
};
