import type { NexusThemeDefinition } from '../core/types';

/**
 * NEXUS — canonical dark identity: obsidian surfaces, champagne gold accent,
 * quantum-blue energy. Carries the anchor semantic values that other themes
 * and consumers (charts, cores) read through resolveTheme().
 */
export const nexusTheme: NexusThemeDefinition = {
  id: 'nexus',
  description: 'Obsidian + champagne gold + multi-agent energy.',
  tokens: {
    'surface.root': '{color.obsidian.950}',
    'surface.environment': '{color.obsidian.900}',
    'surface.base': '{color.obsidian.850}',
    'surface.panel': '{color.obsidian.800}',
    'surface.elevated': '{color.obsidian.700}',
    'text.primary': '{color.ivory.100}',
    'text.secondary': '{color.titanium.300}',
    'text.accent': '{color.gold.300}',
    'accent.primary': '{color.gold.500}',
    'accent.primaryHover': '{color.gold.400}',
    'accent.primaryActive': '{color.gold.600}',
    'accent.energy': '{color.blue.400}',
    'accent.violet': '{color.violet.400}',
    'border.active': '{color.gold.500}',
    'focus.ring': '{color.blue.400}',
    'chart.series.1': '{color.gold.400}',
    'chart.series.2': '{color.blue.400}',
    'chart.series.3': '{color.violet.300}',
  },
};
