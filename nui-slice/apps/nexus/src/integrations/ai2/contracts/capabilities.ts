/**
 * Capabilities contract — GET /v1/capabilities (W1-05, server/app.py).
 *
 * The shell must NOT guess which endpoints exist: this feature map answers
 * `supported` + `reason`/`via` per feature. A feature that is absent today
 * is reported honestly (`supported: false` + machine-readable reason) —
 * screens render `unavailable` from this map, never a fabricated seam.
 *
 * Wire keys are snake_case (`features.run_plan_preview`); the client maps
 * them to this camelCase shape — same rule as the rest of the contracts.
 */

/** One feature declaration as the host reports it. */
export interface Ai2Feature {
  supported: boolean;
  /** Human-readable reason when `supported` is false (verbatim from host). */
  reason: string | null;
  /** Working route/mechanism when `supported` is true. */
  via?: string;
  /**
   * Configured value list the feature offers (e.g. `imageGen` model chain).
   * The host reports it — the shell offers only these, never guesses.
   */
  models?: string[];
}

/** Stable feature vocabulary — keys are fixed by the host contract. */
export interface Ai2FeatureMap {
  approvals: Ai2Feature;
  runPlanPreview: Ai2Feature;
  runPauseResume: Ai2Feature;
  runCheckpoints: Ai2Feature;
  runReplay: Ai2Feature;
  runCancel: Ai2Feature;
  idempotentRunCreate: Ai2Feature;
  sseStream: Ai2Feature;
  webhooks: Ai2Feature;
  memory: Ai2Feature;
  worker: Ai2Feature;
  /** INT-23 — remote image generation; `models` carries the configured chain. */
  imageGen: Ai2Feature;
  /** Future features appear here verbatim; unknown keys are ignored by UI. */
  [key: string]: Ai2Feature;
}

/** GET /v1/capabilities response (public shape after client mapping). */
export interface Ai2Capabilities {
  version: string;
  tenant: string;
  features: Ai2FeatureMap;
  /** Server grant vocabulary — `CAPABILITY_NAMES` (keystore.py). */
  capabilityVocabulary: string[];
  /** Union of declared capabilities across the tenant's agents. */
  agentCapabilities: string[];
  /** API-key scope vocabulary (`ALL_SCOPES`). */
  scopes: string[];
  /** Deep-health component map (same shape as /v1/health.components; may be {}). */
  components: Record<string, { ok: boolean; detail?: string;[key: string]: unknown }>;
  /** ISO-8601 server time of the declaration. */
  ts: string;
}
