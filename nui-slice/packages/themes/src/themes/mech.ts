import type { NexusThemeDefinition } from '../core/types';

/**
 * M.E.C.H. — precise technical surfaces: obsidian base, gold kept for
 * luxury marks, quantum blue becomes the working/energy accent.
 */
export const mechTheme: NexusThemeDefinition = {
  id: 'mech',
  extends: 'nexus',
  description: 'Obsidian, gold marks, quantum blue — precise technical surfaces.',
  tokens: {
    'surface.panel': '{color.obsidian.800}',
    'surface.elevated': '{color.titanium.800}',
    'text.accent': '{color.blue.300}',
    'text.link': '{color.blue.300}',
    'link.hover': '{color.blue.300}',
    'text.tertiary': '{color.titanium.300}',
    // NQ-089 (elevated-gate, 18.10): blue.500 fell to 3.26:1 as text on
    // titanium.800 elevated and 5.31 under onPrimary. blue.300 holds 5.95
    // on elevated, 8.48 on panel, lifts onPrimary to 9.69.
    'accent.primary': '{color.blue.300}',
    'accent.primaryHover': '{color.blue.200}',
    'accent.primaryActive': '{color.blue.400}',
    'accent.primarySoft': 'color-mix(in srgb, {color.blue.300} 16%, transparent)',
    'accent.energy': '{color.blue.300}',
    'accent.glowColor': 'color-mix(in srgb, {color.blue.400} 45%, transparent)',
    'border.active': '{color.blue.500}',
    'chart.series.1': '{color.blue.400}',
    'chart.series.2': '{color.gold.400}',
    // blue.400/syncing на titanium.800 — 4.45:1; blue.300 держит 4.5+
    // для подписи статуса «ждёт» в панели «Окна и шина».
    'busWindow.waiting': '{color.blue.300}',
    // NQ-088 re-check: mech elevated (#31363F) is lighter than obsidian —
    // persona chips need a further step up: blue.500 3.26→blue.300 5.95,
    // gold.600 3.64→gold.500 5.17, violet.400 3.89→violet.300 5.42;
    // alice edge gold.700 2.47→gold.600 3.64 (non-text ≥3:1).
    'personaText.mech': '{color.blue.300}',
    'personaText.codex': '{color.gold.500}',
    'personaText.arch': '{color.violet.300}',
    'personaEdge.alice': '{color.gold.600}',
  },
};
