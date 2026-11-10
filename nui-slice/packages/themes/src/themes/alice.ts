import type { NexusThemeDefinition } from '../core/types';

/**
 * AGENT-A — ivory/warm glass light identity: soft cognitive light,
 * champagne accent. Only semantic roles flip to the ivory ramp; depth,
 * shadow and layout stay inherited from nexus.
 */
export const aliceTheme: NexusThemeDefinition = {
  id: 'alice',
  extends: 'nexus',
  description: 'Ivory warm glass, champagne, soft cognitive light.',
  tokens: {
    'surface.root': '{color.ivory.50}',
    'surface.environment': '{color.ivory.100}',
    'surface.base': '{color.ivory.200}',
    'surface.panel': '{color.ivory.50}',
    'surface.elevated': '{color.ivory.100}',
    'surface.overlay': 'color-mix(in srgb, {color.ivory.50} 80%, transparent)',
    'surface.glass': 'color-mix(in srgb, {color.obsidian.900} 5%, transparent)',
    // Glass bars (wave-XVI): pearl-milk glass over the ivory shell — higher
    // alphas than the dark canon (light substrate needs more fill to keep
    // text ≥4.5:1), obsidian hairlines instead of ivory, warm gold shadows.
    'glass.rail.bg': 'color-mix(in srgb, {color.ivory.50} 60%, transparent)',
    'glass.rail.bgOpaque': 'color-mix(in srgb, {color.ivory.50} 60%, {surface.root})',
    'glass.rail.border': 'color-mix(in srgb, {color.obsidian.900} 14%, transparent)',
    'glass.rail.highlight': 'color-mix(in srgb, {color.ivory.50} 55%, transparent)',
    'glass.rail.shadow': '12px 0 28px 0 rgba(120,98,58,0.16)',
    'glass.topbar.bg': 'color-mix(in srgb, {color.ivory.50} 62%, transparent)',
    'glass.topbar.bgOpaque': 'color-mix(in srgb, {color.ivory.50} 62%, {surface.root})',
    'glass.topbar.border': 'color-mix(in srgb, {color.obsidian.900} 12%, transparent)',
    'glass.topbar.highlight': 'color-mix(in srgb, {color.ivory.50} 50%, transparent)',
    'glass.topbar.shadow': '0 8px 24px 0 rgba(120,98,58,0.14)',
    'glass.card.bg': 'color-mix(in srgb, {color.ivory.50} 65%, transparent)',
    'glass.card.bgOpaque': 'color-mix(in srgb, {color.ivory.50} 65%, {surface.root})',
    'glass.card.border': 'color-mix(in srgb, {color.obsidian.900} 16%, transparent)',
    'glass.card.highlight': 'color-mix(in srgb, {color.ivory.50} 55%, transparent)',
    'glass.card.shadow': '0 10px 32px 0 rgba(120,98,58,0.18)',
    'glass.statusbar.bg': 'color-mix(in srgb, {color.ivory.100} 65%, transparent)',
    'glass.statusbar.bgOpaque': 'color-mix(in srgb, {color.ivory.100} 65%, {surface.root})',
    'glass.statusbar.border': 'color-mix(in srgb, {color.obsidian.900} 14%, transparent)',
    'glass.statusbar.highlight': 'color-mix(in srgb, {color.ivory.50} 45%, transparent)',
    'glass.statusbar.shadow': '0 -8px 24px 0 rgba(120,98,58,0.16)',
    // GlassPanel is shared by screen tabs (runtime, settings, agents). It
    // inherits the dark Obsidian recipe otherwise, so Alice panels stay
    // charcoal even though the shell and text ramp are ivory.
    'glassPanel.bg': 'color-mix(in srgb, {color.ivory.50} 90%, transparent)',
    'glassPanel.bgElevated': 'color-mix(in srgb, {color.ivory.100} 92%, transparent)',
    'glassPanel.shadow': '0 8px 32px 0 rgba(120,98,58,0.16)',
    'glassPanel.edge': 'inset 0 1px 0 color-mix(in srgb, {color.ivory.50} 72%, transparent)',
    // W3-structural-contrast (variant B): the assistant screens re-theme the
    // nested sub-tree to a dark persona (arch/codex/mech → nexus base,
    // text.primary=light) while the alice shell keeps a LIGHT GlassPanel
    // substrate (depth-panel-bg=ivory). A re-themed screen then paints light
    // text on light glass → 1.3–2.1:1. glassPanel.text is the role that the
    // panel ink + idle/secondary controls follow; on the light alice shell it
    // must stay DARK (obsidian.900) so it reads on ivory. Dark themes inherit
    // the {text.primary} default, so they are unchanged.
    'glassPanel.text': '{color.obsidian.900}',
    // vnue/wave-XXII: наследуемый topBar.bg obsidian.850@80% — почти глухой
    // тёмный бар на жемчужной оболочке, против референса (молочная шапка).
    // Молочный композит, как у glass.topbar; RT-фоллбэк соберётся из него же.
    'topBar.bg': 'color-mix(in srgb, {color.ivory.50} 80%, transparent)',
    'surface.inverse': '{color.obsidian.900}',
    'text.primary': '{color.obsidian.900}',
    'text.secondary': '{color.obsidian.400}',
    'text.tertiary': '{color.graphite.400}',
    // NQ-091: obsidian.300 read 4.13:1 on ivory.50 — below the S2 4.5:1
    // live-check for the disabled starter chip. obsidian.350 (#6C6C7C)
    // lands at 4.86:1 on surface.panel / 4.54:1 on elevated while staying
    // dimmer than tertiary (graphite.400, 5.46:1).
    'text.disabled': '{color.obsidian.350}',
    // W3 #6: ModeSwitch idle seg — the control sits on the light GlassPanel
    // (depth-panel-bg=ivory), so idle text must stay dark on the alice shell.
    // Following glassPanel.text (obsidian.900) keeps it ≥4.5:1 on ivory while
    // dark themes inherit their light default. Closes the NQ-081 #6 gap at the
    // token level (NOT scoped-CSS, NOT a persona sub-tree selector).
    'modeSwitch.idleText': '{glassPanel.text}',
    // REAL-BUGS (alice contrast, topSearch 1.11:1 / opacityLabel 1.29:1 on the
    // /home topbar): re-point the topbar ink roles to the same dark ink that
    // glassPanel.text already uses on this shell. The generic fallback for a
    // missing theme token is the default value, so dark themes (nexus/arch/
    // codex/mech/forge/aurum-dark) stay unchanged — they inherit the
    // {text.primary}/{text.tertiary} defaults; only alice re-points them.
    // No scoped-CSS override, no hardcode — token level, per 0930ba29 pattern.
    'glassPanel.topbarText': '{color.obsidian.900}',
    'glassPanel.topbarTextDim': '{color.graphite.600}',
    'text.inverse': '{color.ivory.50}',
    // text.accent sits on the accent.primarySoft tint (Tabs aria-selected,
    // Pagination aria-current): gold.700 on 16%-gold-over-ivory composite
    // = 3.80:1 — under AA. gold.800 holds 5.8:1 on the tint, ~7:1 on plain
    // panel (contrast contract: text.accent on primarySoft, NQ-036 class).
    'text.accent': '{color.gold.800}',
    // NQ-088: the inherited blue link loses contrast on ivory surfaces
    // (1.92:1 on ivory.50). Use the dark gold stop on every light surface.
    'text.link': '{color.gold.800}',
    'link.hover': '{color.gold.900}',
    // NQ-081 / wave-XIV: persona identity colors on the ivory shell.
    // personaText = persona color as text ≥4.5:1 on surface.panel;
    // personaEdge = frame/hairline ≥3:1 (only forge/arch/nexus need a step
    // darker — alice/mech/codex already hold ≥3.14:1).
    // NQ-088 (W1 live re-check 18.10): persona chip text is measured on
    // ivory.100 cards, not ivory.50 — gold.700 reads 4.33:1 there, blue.600
    // 4.20, amber.700 3.50. Bump a step darker; arch violet.600 (5.09) holds.
    'personaText.alice': '{color.gold.800}',
    'personaText.mech': '{color.blue.700}',
    'personaText.forge': '{color.amber.800}',
    'personaText.codex': '{color.gold.800}',
    'personaText.arch': '{color.violet.600}',
    'personaText.nexus': '{color.gold.800}',
    'personaEdge.forge': '{color.amber.600}',
    'personaEdge.arch': '{color.violet.500}',
    'personaEdge.nexus': '{color.gold.700}',
    // NQ-088: gold.600 edge is 2.94:1 on ivory.100 elevated — under the 3:1
    // non-text floor. gold.700 holds 4.33.
    'personaEdge.codex': '{color.gold.700}',
    // WCAG AA (all-theme axe, evidence-links/launcher): gold.600 gives 3.14:1
    // both as link text on ivory.50 and as button bg under onPrimary text —
    // accent.primary serves both roles, so the pair must hold ≥4.5:1.
    // NQ-089/NQ-091 (W5 live, 18.10): монограмма .sideAvatar читается на
    // ivory.100 (surface.elevated + 12%-тинт), не на ivory.50 — gold.700
    // даёт 4.33:1. Шаг темнее: gold.800 = 6.62:1 на ivory.100, 7.09 на
    // ivory.50, и улучшает onPrimary-текст на accent-заливке (7.09 vs 4.63).
    'accent.primary': '{color.gold.800}',
    'accent.primaryHover': '{color.gold.900}',
    'accent.primaryActive': '{color.gold.950}',
    'accent.primarySoft': 'color-mix(in srgb, {color.gold.800} 16%, transparent)',
    'accent.onPrimary': '{color.ivory.50}',
    'accent.energy': '{color.blue.500}',
    'accent.glowColor': 'color-mix(in srgb, {color.gold.800} 40%, transparent)',
    'border.subtle': 'color-mix(in srgb, {color.ivory.900} 8%, transparent)',
    'border.default': 'color-mix(in srgb, {color.ivory.900} 14%, transparent)',
    'border.strong': 'color-mix(in srgb, {color.ivory.900} 24%, transparent)',
    'border.active': '{color.gold.800}',
    // vnue (волна D): дефолтные «осветляющие» тинты ivory.100@N% — невидимы
    // на жемчужной оболочке (ghost-hover, трек кольца, сетка чартов). Референс
    // main7/backalice — молочные пилюли с тёмными волосинами: тинты перевёрнуты
    // в затемнение obsidian.900 (та же альфа-ступень, что у border.subtle).
    'navItem.bgHover': 'color-mix(in srgb, {color.obsidian.900} 5%, transparent)',
    'metricRing.track': 'color-mix(in srgb, {color.obsidian.900} 8%, transparent)',
    'chart.grid': 'color-mix(in srgb, {color.obsidian.900} 7%, transparent)',
    'chart.gridMajor': 'color-mix(in srgb, {color.obsidian.900} 12%, transparent)',
    'chart.series.6': '{color.titanium.500}',
    // WCAG AA on light tinted surfaces (NQ-024): dark-context brights
    // (green.400/#36BE79 etc.) give 1.8–3.8:1 over ivory — state fg flips
    // to the 700/800 stop, all pairs ≥5.1:1 measured on ivory.50.
    'state.online': '{color.green.700}',
    'state.complete': '{color.green.700}',
    'state.success': '{color.green.700}',
    'state.active': '{color.gold.800}',
    'state.thinking': '{color.blue.700}',
    'state.syncing': '{color.blue.700}',
    'state.info': '{color.blue.700}',
    'state.validating': '{color.violet.700}',
    'state.executing': '{color.amber.700}',
    'state.warning': '{color.amber.700}',
    'state.error': '{color.red.700}',
    'state.waiting': '{color.titanium.700}',
    'state.paused': '{color.titanium.700}',
    'state.offline': '{color.titanium.700}',
    // 1.4.11 focus indicator ≥3:1 vs adjacent: inherited blue.400 gives
    // 2.20:1 on ivory.200 — flip to blue.600 (4.23:1 worst surface).
    'focus.ring': '{color.blue.600}',
    'focus.ringSoft': 'color-mix(in srgb, {color.blue.600} 30%, transparent)',
  },
};
