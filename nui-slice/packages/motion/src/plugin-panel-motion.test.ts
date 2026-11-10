import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PLUGIN_DOCK_MOTION_MS,
  PLUGIN_MOTION_BUDGET,
  PLUGIN_PANEL_EASING,
  PLUGIN_SURFACE_MOTION_MS,
  assessPluginMotionBudget,
  pluginPanelMotion,
  pluginSurfaceMotion,
} from './plugin-panel-motion';

// Файл лежит в репо с CRLF — нормализуем EOL, чтобы \n-литералы ниже
// проверяли содержимое правил, а не кодировку строк.
const stylesheet = readFileSync(new URL('./plugin-panel-motion.module.css', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');

describe('NEU plugin-panel motion contract', () => {
  it('uses one curve and duration for push/fullscreen and their shared grid edge', () => {
    const push = pluginPanelMotion('push');
    const fullscreen = pluginPanelMotion('fullscreen');
    expect(PLUGIN_DOCK_MOTION_MS).toBe(240);
    expect(push.durationMs).toBe(fullscreen.durationMs);
    expect(push.easing).toBe(PLUGIN_PANEL_EASING);
    expect(fullscreen.easing).toBe(push.easing);
    expect(push.transitionProperty).toBe('grid-template-columns');
    expect(stylesheet).toContain('grid-template-columns var(--nexus-plugin-panel-duration) var(--nexus-plugin-panel-easing)');
  });

  it('turns every transition off during pointer resize and reduced motion', () => {
    expect(pluginPanelMotion('push', { resizing: true })).toMatchObject({
      durationMs: 0,
      transitionProperty: 'none',
      reduced: false,
    });
    expect(pluginPanelMotion('fullscreen', { reducedMotion: true }).durationMs).toBe(0);
    expect(pluginPanelMotion('push', { snapshot: true }).durationMs).toBe(0);
    expect(stylesheet).toContain(".layout[data-resizing='true'] {\n  transition: none;");
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('defines entry/exit motion for tabs, floating surfaces and plugin blocks', () => {
    expect(pluginSurfaceMotion('tab').durationMs).toBe(PLUGIN_SURFACE_MOTION_MS.tab);
    expect(pluginSurfaceMotion('floating').durationMs).toBe(PLUGIN_SURFACE_MOTION_MS.floating);
    expect(pluginSurfaceMotion('pluginBlock').transitionProperty).toContain('grid-template-rows');
    expect(stylesheet).toContain('.floating {\n  position: absolute;');
    expect(stylesheet).toContain('grid-template-rows: 0fr;');
    expect(stylesheet).toContain(".pluginBlock[data-present='true']");
  });

  it('reports only actual measurements; unsupported metrics stay null', () => {
    expect(assessPluginMotionBudget(null, null)).toEqual({
      fps: null, longTasks: null, overBudget: null, availability: 'unavailable',
    });
    expect(assessPluginMotionBudget(60, null)).toEqual({
      fps: 60, longTasks: null, overBudget: null, availability: 'partial',
    });
    expect(assessPluginMotionBudget(60, 2).overBudget).toBe(false);
    expect(assessPluginMotionBudget(52, 5).overBudget).toBe(true);
    expect(assessPluginMotionBudget(null, 5).overBudget).toBe(true);
    expect(PLUGIN_MOTION_BUDGET).toMatchObject({
      minFps: 55,
      longTaskMs: 50,
      maxLongTasksPerWindow: 4,
      windowMs: 5000,
    });
  });
});
