// graphs — owned by Window 4 (patterns/src/graphs/**)
export * from './graphs/types';
export { columnLayout, radialLayout, layeredLayout, type ColumnLayoutOpts, type RadialLayoutOpts, type LayeredLayoutOpts, type GraphLayout, type GraphPoint } from './graphs/layout';
export { GraphFrame, type GraphFrameProps, statusVar } from './graphs/graph-frame';
export { GraphList, GraphLegend, type GraphListProps, type GraphLegendProps } from './graphs/graph-list';
export { AgentFlow, type AgentFlowProps } from './graphs/agent-flow/agent-flow';
export { ModelRouterGraph, type ModelRouterGraphProps } from './graphs/model-router-graph/model-router-graph';
export { KnowledgeGraph, type KnowledgeGraphProps } from './graphs/knowledge-graph/knowledge-graph';
export { PlanDag, type PlanDagProps } from './graphs/plan-dag/plan-dag';
export { MessageGraph, type MessageGraphProps } from './graphs/message-graph/message-graph';
export { capGraphData, capMarkerText, SVG_GRAPH_MAX_NODES, SVG_GRAPH_MAX_EDGES, type GraphCaps, type CappedGraph } from './graphs/caps';

// agents — owned by Window 3 (patterns/src/agents/**)
export { AgentRoster, type AgentRosterProps } from './agents/agent-roster';
export { AgentInspector, type AgentInspectorProps } from './agents/agent-inspector';
export { AgentPresence, type AgentPresenceProps } from './agents/agent-presence';
export { AgentHandoff, type AgentHandoffProps } from './agents/agent-handoff';
export {
    type PatternState, type AgentRosterItem, type PresenceEntry, type HandoffLink, type AgentRunRow,
} from './agents/agent-types';
export { runStatusBadge, processStateBadge, presenceBadge, RUN_STATUS_LABELS, PROCESS_STATE_LABELS } from './agents/status-map';

// missions — owned by Window 3 (patterns/src/missions/**)
export { MissionOverview, type MissionOverviewProps } from './missions/mission-overview';
export { MissionTimeline, type MissionTimelineProps } from './missions/mission-timeline';
export { MissionProgress, type MissionProgressProps } from './missions/mission-progress';
export { MissionOutputs, type MissionOutputsProps } from './missions/mission-outputs';
export {
    missionStateBadge, missionStepBadge, stepDurationSec, fmtDurationSec,
    MISSION_STATE_LABELS, MISSION_STEP_LABELS, OUTPUT_KIND_LABELS,
} from './missions/mission-map';

// memory — owned by Window 3 (patterns/src/memory/**)
export { MemoryTemplate, type MemoryTemplateProps } from './memory/memory-template';
export { MemoryBrowser, type MemoryBrowserProps } from './memory/memory-browser';
export { MemoryInspector, type MemoryInspectorProps } from './memory/memory-inspector';

// models — owned by Window 3 (patterns/src/models/**)
export { ModelCenter, type ModelCenterProps } from './models/model-center';
export { ModelComparison, type ModelComparisonProps } from './models/model-comparison';
export { ModelRouter, type ModelRouterProps } from './models/model-router';
export { ModelPerformance, type ModelPerformanceProps } from './models/model-performance';
export {
  ModelPicker,
  modelProviderOf,
  isOpenCodeModel,
  matchesModelQuery,
  groupModelsByProvider,
  OTHER_PROVIDER_LABEL,
  OPENCODE_PREFIX,
  type ModelPickerOption,
  type ModelPickerProps,
  type ModelGroup,
} from './models/model-picker';
export { modelFreeLabel, routerRows, presetRow, PRESET_FLAG_ORDER, PRESET_FLAG_LABELS, type RouterRow } from './models/model-map';

// settings/system — owned by Window 3 (patterns/src/settings/**)
export { SystemOverview, type SystemOverviewProps } from './settings/system-overview';
export { ToolsPanel, type ToolsPanelProps } from './settings/tools-panel';
export { IntegrationsPanel, type IntegrationsPanelProps } from './settings/integrations-panel';
export { SecurityPanel, type SecurityPanelProps } from './settings/security-panel';
export { CapabilitiesPanel, type CapabilitiesPanelProps } from './settings/capabilities-panel';
export { PresetPanel, type PresetPanelProps } from './settings/preset-panel';
export { AgentRegistryPanel, type AgentRegistryPanelProps } from './settings/agent-registry-panel';

// Runs — run detail (persisted events + stored result, no fabrication)
export { RunDetailPanel, type RunDetailPanelProps } from './runs/run-detail';

// providers — owned by Window 4: typed status → FlowSteps lifecycle mappers
export { telegramLifecycle, instagramWebLifecycle, instagramApiLifecycle } from './providers/provider-lifecycle';

// guard — G.U.A.R.D. security visual (W4-06): honest state, never green-by-default
export { GuardShield, type GuardShieldProps, type GuardShieldState, type GuardShieldNode } from './guard/guard-shield';

// images — INT-23 generated-image display (W4): honest cost/enrichment states
export { GeneratedImageCard, type GeneratedImageCardProps, type GeneratedImage, type GeneratedImageState } from './images/generated-image-card';
