/**
 * Nexus icon registry (spec §9): own SVG geometry, stroke ≈1.25–1.5,
 * rounded caps, currentColor — no emoji, no cartoon language.
 * Paths are 24×24 viewBox. Agent symbols are identity marks used in
 * avatars, badges, loading and transitions.
 */

export interface IconDef {
  /** Inner SVG markup (paths/circles/lines), drawn with stroke. */
  body: string;
  /** Set true for filled (non-stroke) marks like the agent dots. */
  filled?: boolean;
}

export const iconRegistry = {
  // agent identity marks
  'agent.nexus': { body: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><circle cx="12" cy="12" r="8.5" stroke-dasharray="2 3"/>' },
  'agent.alice': { body: '<circle cx="12" cy="12" r="5"/><path d="M12 3c4 3 4 15 0 18M12 3c-4 3-4 15 0 18"/>' },
  'agent.mech': { body: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>' },
  'agent.forge': { body: '<path d="M12 3c2.5 4-1.5 5.5 1 8.5 1.5-1 2-2.5 2-4 3 2.5 4 5 4 7.5A6.9 6.9 0 0 1 12 21a6.9 6.9 0 0 1-7-5.9C5 11.5 9.5 8 12 3z"/>' },
  'agent.codex': { body: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 8h8M8 12h8M8 16h5"/><path d="M16 16l2 2 3-3"/>' },
  'agent.arch': { body: '<path d="M4 19h16M6 19V9l6-5 6 5v10"/><path d="M9 19v-6h6v6"/>' },
  // chrome / status glyphs
  'nav.search': { body: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>' },
  'nav.settings': { body: '<circle cx="12" cy="12" r="3"/><path d="M12 2l1.2 2.6M12 22l-1.2-2.6M2 12l2.6-1.2M22 12l-2.6 1.2M5 5l2.2 1.8M19 19l-2.2-1.8M5 19l1.8-2.2M19 5l-1.8 2.2"/>' },
  'nav.bell': { body: '<path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5z"/><path d="M10 19a2 2 0 0 0 4 0"/>' },
  'nav.command': { body: '<path d="M9 5a2.5 2.5 0 0 0-2.5 2.5V9h2.5A2.5 2.5 0 0 0 9 6.5V5zM9 5h6M15 5a2.5 2.5 0 0 1 2.5 2.5V9H15A2.5 2.5 0 0 1 15 6.5V5zM9 15a2.5 2.5 0 0 0-2.5 2.5V19h2.5A2.5 2.5 0 0 0 9 16.5V15zM15 15a2.5 2.5 0 0 1 2.5 2.5V19H15a2.5 2.5 0 0 1-2.5-2.5V15zM9 9h6v6H9z"/>' },
  'act.play': { body: '<path d="M7 4l13 8-13 8z"/>' },
  'act.pause': { body: '<path d="M8 6v12M14 6v12"/>' },
  'act.stop': { body: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>', filled: true },
  'act.close': { body: '<path d="M6 6l12 12M18 6L6 18"/>' },
  'act.check': { body: '<path d="M4 12.5l5 5L20 6.5"/>' },
  'act.chevron': { body: '<path d="M9 5l7 7-7 7"/>' },
  'status.dot': { body: '<circle cx="12" cy="12" r="5"/>', filled: true },
  'status.warn': { body: '<path d="M12 4L2.5 20h19L12 4z"/><path d="M12 10v4M12 17.5v.5"/>' },
  'status.info': { body: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.5v.5"/>' },
  // honest-state vocabulary (theme-map §3 — scene labels + state surfaces)
  'status.offline': { body: '<path d="M12 3v7"/><path d="M6.4 5.6a8.5 8.5 0 1 0 11.2 0"/>' },
  'status.question': { body: '<circle cx="12" cy="12" r="8.5"/><path d="M9.4 9.2a2.6 2.6 0 1 1 3.5 2.5c-.7.3-.9.9-.9 1.8"/><path d="M12 16.8v.4"/>' },
  'status.shield': { body: '<path d="M12 3l7 2.8V11c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V5.8L12 3z"/><path d="M9 11.6l2.1 2.1 4-4.2"/>' },
  'status.error': { body: '<circle cx="12" cy="12" r="8.5"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>' },
} as const satisfies Record<string, IconDef>;

export type NexusIconName = keyof typeof iconRegistry;
