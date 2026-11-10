import type { CanonicalThemeId } from '@nexus/themes';

/**
 * Canonical public type surface for the shared NEXUS UI primitives.
 * Add consumer-facing component/theme/token types here, then re-export them
 * from the package root (`@nexus/ui`).
 */
export type {
  GlassSurfaceProps,
  GlassVariant,
  GlassTone,
} from '../surfaces/glass-bars/glass-surface';
export type { CapsuleInputProps } from '../surfaces/glass-bars/capsule-input';
export type { StatusStripProps } from '../surfaces/glass-bars/status-strip';

export type { LoadingStateProps } from '../feedback/loading-state/loading-state';
export type { EmptyStateProps } from '../feedback/empty-state/empty-state';
export type { ErrorStateProps } from '../feedback/error-state/error-state';
export type { UnavailableStateProps } from '../feedback/unavailable-state/unavailable-state';

export type {
  CanonicalThemeId,
  NexusThemeId,
  NexusThemeDefinition,
  ResolvedNexusTheme,
  TokenPath,
} from '@nexus/themes';
export type { NexusThemeProviderProps } from '../theme/nexus-theme-provider';
export type { TokenKey } from '@nexus/tokens';

/** Canonical assistant identities; excludes shell-only themes such as nexus. */
export type AssistantThemeId = Extract<
  CanonicalThemeId,
  'alice' | 'arch' | 'codex' | 'forge' | 'mech'
>;
