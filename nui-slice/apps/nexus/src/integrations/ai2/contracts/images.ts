/**
 * Image generation contract — POST /v1/images/generate (INT-23, ai2/imagegen.py).
 *
 * Remote API providers only (OpenRouter-compatible); no local models. The
 * host owns secrets — keys never leave the server, the shell never sees
 * anything but the prompt/response contract. Capability is declared via
 * `features.imageGen` in GET /v1/capabilities (supported + reason + models);
 * the screen must render `unavailable` from that map, never a hidden call.
 *
 * Wire keys are snake_case; the client maps them to this camelCase shape.
 */

/** POST /v1/images/generate request body. */
export interface Ai2ImageGenerateRequest {
  /** Prompt, 1..600 chars — the host answers 422 beyond that, no silent truncation. */
  prompt: string;
  /** Must be one of `features.imageGen.models`; unknown models answer 422. */
  model?: string;
  /**
   * Prompt enrichment by a text model. `undefined` = enrich when the host has
   * an enrich model configured; `false` = send the raw prompt.
   */
  enrich?: boolean;
}

/** POST /v1/images/generate 200 response (after camelCase mapping). */
export interface Ai2GeneratedImage {
  /** Base64-encoded image bytes (PNG/JPEG/WebP, magic-verified by the host). */
  imageB64: string;
  mime: string;
  /** Declared byte size of the decoded image. */
  bytes: number;
  /** Provider model that produced the image (may differ from the request). */
  model: string;
  /**
   * Real provider cost from `usage.cost`. `null` = the provider did not
   * report a price — unknown is NOT zero; UI must render "cost unknown".
   */
  costUsd: number | null;
  /** The prompt as submitted (verbatim echo). */
  prompt: string;
  /** Enriched prompt when enrichment ran; null otherwise. */
  enrichedPrompt: string | null;
  /** True only when `enrichedPrompt` actually produced a different prompt. */
  enriched: boolean;
}
