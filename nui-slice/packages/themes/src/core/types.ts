/**
 * Nexus theme engine — type contracts (implementation plan Task 3, spec §7).
 * Themes override semantic/component token paths only; they never fork components.
 */

export type CanonicalThemeId = 'nexus' | 'alice' | 'mech' | 'forge' | 'codex' | 'arch' | 'aurum-dark';

/** Canonical ids plus extension point for future agent themes (e.g. 'sage'). */
export type NexusThemeId = CanonicalThemeId | (string & {});

/** Dotted token path into the token tree, e.g. 'surface.root', 'accent.primary'. */
export type TokenPath = string;

export interface NexusThemeDefinition {
  id: NexusThemeId;
  /** Parent theme id; defaults to 'nexus' via createNexusTheme. */
  extends?: NexusThemeId;
  description?: string;
  /**
   * Semantic/component overrides keyed by token path.
   * Values are literal values or '{path.to.token}' references resolved by the generator.
   */
  tokens: Record<TokenPath, string>;
}

export interface ResolvedNexusTheme {
  /** Effective theme id (deterministic 'nexus' fallback for unknown ids). */
  id: string;
  /** Declared + inherited overrides, child wins over ancestors. */
  tokens: Record<TokenPath, string>;
  /** Resolved inheritance chain, base first (e.g. ['nexus', 'sage']). */
  chain: string[];
}
