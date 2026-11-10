import type { NexusThemeDefinition } from '../core/types';

/**
 * A.R.C.H. — archival depth: darkest obsidian strata, gold/violet memory
 * layers; the quietest accent language of the six.
 */
export const archTheme: NexusThemeDefinition = {
  id: 'arch',
  extends: 'nexus',
  description: 'Archival depth, gold/violet memory layers.',
  tokens: {
    'surface.root': '{color.obsidian.950}',
    'surface.environment': '{color.obsidian.950}',
    'surface.base': '{color.obsidian.900}',
    'surface.panel': '{color.obsidian.850}',
    'surface.elevated': '{color.violet.950}',
    'text.secondary': '{color.quartz.400}',
    'text.accent': '{color.violet.300}',
    // WCAG AA (all-theme axe, evidence-links): accent.primary doubles as link
    // text — violet.500 gives 4.18:1 on obsidian.850 panels (<4.5). violet.400
    // lifts both roles: 5.46:1 as text on panel, 6.4:1 under onPrimary text.
    'accent.primary': '{color.violet.400}',
    'accent.primaryHover': '{color.violet.300}',
    'accent.primaryActive': '{color.violet.500}',
    'accent.primarySoft': 'color-mix(in srgb, {color.violet.400} 16%, transparent)',
    'accent.energy': '{color.violet.300}',
    'accent.glowColor': 'color-mix(in srgb, {color.violet.400} 45%, transparent)',
    'border.active': '{color.violet.400}',
    'chart.series.1': '{color.violet.400}',
    'chart.series.2': '{color.gold.500}',
    'chart.series.3': '{color.blue.300}',
  },
};
