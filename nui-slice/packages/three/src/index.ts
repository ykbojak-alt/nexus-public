export * from './runtime';

// cores — deterministic AI-core scenes (spec §16)
export { renderCoreState, type CoreKind, type CoreSceneState } from './cores/core-state';
export { CoreViz, type CoreVizProps } from './cores/core-frame';
export { NexusCore, type NexusCoreProps } from './cores/nexus-core';
export { AliceHalo, type AliceHaloProps } from './cores/alice-halo';
export { MechCore, type MechCoreProps } from './cores/mech-core';
export { ForgeCrystal, type ForgeCrystalProps } from './cores/forge-crystal';
export { CodexGeometry, type CodexGeometryProps } from './cores/codex-geometry';
export { ArchMemoryCore, type ArchMemoryCoreProps } from './cores/arch-memory-core';

// spatial — specialized 3D scenes
export { renderSpatialState, projectNode, type SpatialInput, type SpatialNodeInput, type SpatialEdgeInput, type SpatialSceneState, type SpatialKind } from './spatial/spatial-state';
export { SpatialViz, type SpatialVizProps } from './spatial/spatial-frame';
export { AgentConstellation, type AgentConstellationProps } from './spatial/agent-constellation';
export { MissionGlobe, type MissionGlobeProps } from './spatial/mission-globe';
export { MemorySphere, type MemorySphereProps } from './spatial/memory-sphere';
export { KnowledgeOrb, type KnowledgeOrbProps } from './spatial/knowledge-orb';

// fallbacks — shared SVG twins of the 3D states
export { CoreFallbackSvg } from './fallbacks/core-fallback';
export { SpatialFallbackSvg } from './fallbacks/spatial-fallback';

// preview — light static scene preview for the scene-launch tile (XV W4)
export {
  ScenePreview,
  previewCoreFor,
  type ScenePreviewProps,
  type ScenePreviewBridge,
} from './preview/scene-preview';
