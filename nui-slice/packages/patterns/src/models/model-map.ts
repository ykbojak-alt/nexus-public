import type { ModelInfo, ModelRouterData, PresetInfo } from '@nexus/mock-data';

/** Flag keys that decide the route contour — order is display order. */
export const PRESET_FLAG_ORDER = ['planner', 'executor', 'critic', 'arbiter', 'memory', 'subagents'] as const;

export const PRESET_FLAG_LABELS: Record<string, string> = {
  planner: 'planner',
  executor: 'executor',
  critic: 'critic',
  arbiter: 'arbiter',
  memory: 'memory',
  subagents: 'sub-агенты',
};

/**
 * Model price honesty — `free: null` means the server did not say.
 * Returns a display tri-state, never a guess.
 */
export function modelFreeLabel(free: ModelInfo['free']): { text: string; state: 'yes' | 'no' | 'unknown' } {
  if (free === true) return { text: 'free', state: 'yes' };
  if (free === false) return { text: 'платная', state: 'no' };
  return { text: '—', state: 'unknown' };
}

/** Routes grouped by preset node — preset → roles → models. */
export interface RouterRow {
  preset: string;
  roles: string[];
  /** Fallback edges land here, marked honestly. */
  fallbacks: { from: string; to: string }[];
}

export function routerRows(data: ModelRouterData): RouterRow[] {
  const label = (id: string) => data.nodes.find((n) => n.id === id)?.label ?? id;
  const presets = data.nodes.filter((n) => n.kind === 'preset');
  return presets.map((p) => {
    const roleIds = data.edges.filter((e) => e.from === p.id && e.kind === 'routes').map((e) => e.to);
    const fallbacks = data.edges
      .filter((e) => e.kind === 'fallback' && roleIds.includes(e.from))
      .map((e) => ({ from: label(e.from), to: label(e.to) }));
    return { preset: p.label, roles: roleIds.map(label), fallbacks };
  });
}

/** Preset row for the comparison matrix — description may be null (honest). */
export function presetRow(p: PresetInfo): { name: string; flags: Record<string, boolean>; description: string | null; isDefault: boolean } {
  return { name: p.name, flags: p.flags, description: p.description, isDefault: p.isDefault };
}
