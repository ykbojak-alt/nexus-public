export * from './presets';
export * from './signatures';
export * from './reduced-motion';
export * from './motion-primitives';
export {
  compactionMotion, COMPACTION_MOTION_MS, COMPACTION_MOTION_EASING,
  type CompactionMotionVerb, type CompactionMotionSpec,
} from './compaction-motion';
export { gameMotion, GAME_MOTION_MS, GAME_MOTION_EASING, type GameMotionVerb, type GameMotionEasing, type GameMotionSpec } from './game-motion';
export {
  pageMotion, PAGE_MOTION_MS, PAGE_MOTION_EASING,
  type PageMotionVerb, type PageMotionSpec,
} from './page-motion';
export {
  dockMotion, DOCK_MOTION_MS, DOCK_MOTION_EASING,
  type DockMotionVerb, type DockMotionSpec,
} from './dock-motion';
export {
  notifyMotion, NOTIFY_MOTION_MS, NOTIFY_MOTION_EASING,
  type NotifyMotionVerb, type NotifyMotionSpec,
} from './notify-motion';
export {
  dragMotion, DRAG_MOTION_MS, DRAG_MOTION_EASING,
  type DragMotionVerb, type DragMotionSpec,
} from './drag-motion';
export {
  loadingMotion, LOADING_MOTION_MS, LOADING_MOTION_EASING,
  type LoadingMotionVerb, type LoadingMotionSpec,
} from './loading-motion';
export {
  typingMotion, TYPING_MOTION_MS, TYPING_MOTION_EASING,
  type TypingMotionSpec,
} from './typing-motion';
export {
  bootMotion, BOOT_MOTION_MS, BOOT_MOTION_EASING,
  BOOT_HANDOFF_KEY, markBootHandoff, consumeBootHandoff,
  bootSequenceProgress,
  type BootMotionVerb, type BootMotionEasing, type BootMotionSpec,
  type BootStageState, type BootSequenceProgressInput, type BootSequenceProgress,
} from './boot-motion';
export {
  railMotion, RAIL_MOTION_MS, RAIL_MOTION_EASING,
  type RailMotionVerb, type RailMotionEasing, type RailMotionSpec,
} from './rail-motion';
export {
  feedMotion, feedWindow, assessFeedPerformance,
  FEED_MOTION_MS, FEED_MOTION_EASING, FEED_PERF_BUDGET,
  type FeedMotionVerb, type FeedMotionEasing, type FeedMotionSpec,
  type FeedWindow, type FeedWindowInput, type FeedPerfAssessment,
} from './feed-motion';
export {
  PLUGIN_DOCK_MOTION_MS, PLUGIN_SURFACE_MOTION_MS, PLUGIN_PANEL_EASING,
  PLUGIN_MOTION_BUDGET, pluginPanelMotion, pluginSurfaceMotion,
  assessPluginMotionBudget,
  type PluginDockMode, type PluginMotionSurface, type PluginMotionSpec,
  type PluginMotionOptions, type PluginMotionMeasurement,
} from './plugin-panel-motion';
export {
  PluginPanelLayout, PluginMotionItem, usePluginMotionPerformance,
  type PluginPanelLayoutProps, type PluginMotionItemKind,
  type PluginMotionItemProps, type PluginMotionPerformance,
} from './plugin-panel-components';
export {
  heroMotion, HERO_MOTION_MS, HERO_MOTION_EASING,
  type HeroMotionVerb, type HeroMotionSpec,
} from './hero-motion';
export {
  HeroArt, KpiItem,
  type HeroArtProps, type KpiItemProps,
} from './hero-components';
export {
  GLASS_BACKDROP, GLASS_BACKDROP_VARS,
  compositeScrim, wcagLuminance, contrastOnBackdrop,
} from './glass-backdrop';
export {
  GlassBackdrop, GlassBar,
  type GlassBackdropProps, type GlassBarProps,
} from './glass-backdrop-components';
export {
  adaptiveWindowMotion, ADAPTIVE_WINDOW_MOTION_MS, ADAPTIVE_WINDOW_EASING,
  ADAPTIVE_WINDOW_BREAKPOINTS, ADAPTIVE_WINDOW_SIZES,
  type AdaptiveWindowVerb, type AdaptiveWindowEasing, type AdaptiveWindowMotionSpec,
} from './adaptive-window';
export {
  AdaptiveShell, AdaptiveRail, AdaptiveStrip, AdaptiveMain, AdaptiveLabel,
  type AdaptiveShellProps, type AdaptiveWindowMode,
} from './adaptive-window-components';
export {
  scenarioMotion, SCENARIO_MOTION_MS, SCENARIO_MOTION_EASING,
  type ScenarioMotionVerb, type ScenarioMotionEasing, type ScenarioMotionSpec,
  type ConfirmationMotionState, type CheckpointMotionState,
} from './scenario-motion';
export {
  ConfirmationMotion, DiffReviewMotion, CheckpointMotion,
  type ConfirmationMotionProps, type DiffReviewMotionProps, type CheckpointMotionProps,
} from './scenario-components';
