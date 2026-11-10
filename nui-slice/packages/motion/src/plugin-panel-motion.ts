/**
 * Motion contract for plugin docks and their transient surfaces.
 * Both dock modes deliberately share a single timing curve and duration so
 * the center track and the panel edge arrive on the same frame.
 */

export type PluginDockMode = 'hidden' | 'push' | 'fullscreen';
export type PluginMotionSurface = 'dock' | 'tab' | 'floating' | 'pluginBlock';

export const PLUGIN_DOCK_MOTION_MS = 240;
export const PLUGIN_SURFACE_MOTION_MS: Record<Exclude<PluginMotionSurface, 'dock'>, number> = {
  tab: 180,
  floating: 240,
  pluginBlock: 240,
};
export const PLUGIN_PANEL_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

export const PLUGIN_MOTION_BUDGET = {
  minFps: 55,
  longTaskMs: 50,
  maxLongTasksPerWindow: 4,
  windowMs: 5000,
} as const;

export interface PluginMotionSpec {
  durationMs: number;
  easing: string;
  reduced: boolean;
  transitionProperty: string;
}

export interface PluginMotionOptions {
  reducedMotion?: boolean;
  snapshot?: boolean;
  resizing?: boolean;
}

export function pluginPanelMotion(
  mode: PluginDockMode,
  opts: PluginMotionOptions = {},
): PluginMotionSpec {
  const reduced = opts.reducedMotion === true || opts.snapshot === true;
  const resizing = opts.resizing === true;
  return {
    durationMs: reduced || resizing ? 0 : PLUGIN_DOCK_MOTION_MS,
    easing: PLUGIN_PANEL_EASING,
    reduced,
    transitionProperty: resizing ? 'none' : 'grid-template-columns',
  };
}

export function pluginSurfaceMotion(
  surface: Exclude<PluginMotionSurface, 'dock'>,
  opts: PluginMotionOptions = {},
): PluginMotionSpec {
  const reduced = opts.reducedMotion === true || opts.snapshot === true;
  return {
    durationMs: reduced ? 0 : PLUGIN_SURFACE_MOTION_MS[surface],
    easing: PLUGIN_PANEL_EASING,
    reduced,
    transitionProperty: surface === 'pluginBlock'
      ? 'grid-template-rows, opacity, transform'
      : 'opacity, transform',
  };
}

export interface PluginMotionMeasurement {
  fps: number | null;
  longTasks: number | null;
  overBudget: boolean | null;
  availability: 'measured' | 'partial' | 'unavailable';
}

/** Unknown metrics stay null; only observed values participate in the budget. */
export function assessPluginMotionBudget(
  fps: number | null,
  longTasks: number | null,
): PluginMotionMeasurement {
  const hasFps = fps != null && Number.isFinite(fps);
  const hasLongTasks = longTasks != null && Number.isFinite(longTasks);
  const overBudget = (hasFps && fps < PLUGIN_MOTION_BUDGET.minFps)
    || (hasLongTasks && longTasks > PLUGIN_MOTION_BUDGET.maxLongTasksPerWindow)
    ? true
    : hasFps && hasLongTasks
      ? false
      : null;
  return {
    fps: hasFps ? fps : null,
    longTasks: hasLongTasks ? longTasks : null,
    overBudget,
    availability: hasFps && hasLongTasks ? 'measured' : hasFps || hasLongTasks ? 'partial' : 'unavailable',
  };
}
