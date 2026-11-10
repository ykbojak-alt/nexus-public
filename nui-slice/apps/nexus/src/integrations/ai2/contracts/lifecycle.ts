/**
 * Run-lifecycle contracts — W1-05 (plan/approval/provenance/readiness) +
 * W1-06 (pause/resume/checkpoint/retry/replay semantics).
 *
 * These are CONTRACT shapes: they describe what a future AI-2 endpoint
 * would emit (see docs/product/run-lifecycle-contract-2026-10-13.md).
 * Until `/v1/capabilities` reports a feature `supported: true`, the live
 * adapter leaves the seam undefined and screens render `unavailable` —
 * the shapes here are for mock-first UI work and for the eventual backend
 * to implement against. Nothing here may be fabricated by the UI.
 */

// ---------------------------------------------------------------- plan (W3-02)

/**
 * Pre-run plan — what the runtime DECLARES it will do before execution
 * starts. Dry-run of `POST /v1/runs`: same input, no run created, no side
 * effects. Candidate wire: `POST /v1/runs/plan` (or `?dry_run=1`).
 */
export interface Ai2RunPlan {
  /** Declared goal — verbatim task text, never paraphrased by the UI. */
  goal: string;
  stages: { id: string; label: string; agent: string | null }[];
  /** Capability-grant vocabulary the plan declares (CAPABILITY_NAMES). */
  tools: string[];
  limits: { maxCostUsd: number | null; maxDurationS: number | null };
  /** True when declared tools include grants that gate on human approval. */
  approvalsPlanned: boolean;
  /** Plan is a projection — it may drift from actual execution; the UI shows it as "declared". */
  provisional?: boolean;
}

// ------------------------------------------------------------ approvals (W3-04)

/**
 * Approval request — a run paused on a human decision (O7).
 * Candidate wire: `GET /v1/approvals?status=pending&run_id=` +
 * `POST /v1/approvals/{id}/respond {"decision":"approve"|"deny"}`.
 */
export type Ai2ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'revoked';

export interface Ai2Approval {
  approvalId: string;
  runId: string;
  /** Server/action vocabulary verbatim (`tool_call: file.write`). */
  action: string;
  /** Requested capability grant; null = not disclosed by the runtime. */
  scope: string | null;
  detail: string;
  status: Ai2ApprovalStatus;
  requestedAt: number;
  decidedAt: number | null;
  /** Grant expiry (epoch s); null = the request does not expire. */
  expiresAt?: number | null;
  /** Decision linkage — which seq/step the gate was raised at. */
  eventSeq?: number | null;
}

export type Ai2ApprovalDecision = 'approve' | 'deny';

// ----------------------------------------------------- run controls (W3-04/05)

/** Single control availability — disabled actions carry a host reason. */
export interface Ai2RunControlGate {
  available: boolean;
  reason: string | null;
}

/**
 * Run control state — pause/resume/replay as reported by the runtime.
 * Candidate wire: `GET /v1/runs/{id}/controls`,
 * `POST /v1/runs/{id}/pause|resume|replay` → updated RunControlState.
 *
 * Semantics (W1-06):
 * - `paused` is a control flag; the run keeps status `running` until a
 *   terminal/heartbeat event says otherwise.
 * - pause/resume are IDEMPOTENT (repeat → same state, no duplicate steps).
 * - replay = read-only event-stream replay (`stream?after=-1`); it never
 *   re-executes the task and never repeats external side effects.
 * - checkpoint = persisted resume point; a runtime without checkpoint
 *   storage reports `{ available: false, reason }` — never silently no-ops.
 * - retry = a NEW run (new run_id, fresh Idempotency-Key); side effects
 *   that already happened are NOT silently repeated — they require a new
 *   approval grant if gated.
 */
export interface Ai2RunControls {
  paused: boolean;
  pause: Ai2RunControlGate;
  resume: Ai2RunControlGate;
  replay: Ai2RunControlGate;
  checkpoint: Ai2RunControlGate;
  retry: Ai2RunControlGate;
}

// ------------------------------------------------------- provenance (W1-05)

/**
 * Event provenance — who emitted a run event and on whose authority.
 * Persisted events (GET /v1/runs/{id}/events) carry the fields the server
 * recorded; ephemeral SSE frames (model_delta) have none. Unknown/missing
 * provenance renders as `unknown`, never as "system" or "trusted".
 */
export interface Ai2EventProvenance {
  /** What produced the event. */
  actor: 'agent' | 'system' | 'user' | 'tool' | 'scheduler' | 'unknown' | string;
  /** Grant/scope the action ran under; null = none / not disclosed. */
  authority: string | null;
  /** Approval that authorized it, when gated. */
  approvalId?: string | null;
  /** Host clock (epoch s) at emission. */
  emittedAt?: number | null;
}

// ---------------------------------------------- readiness / resources (W1-05)

/**
 * Run readiness — what the host checks BEFORE a run may start.
 * Candidate wire: `POST /v1/runs/readiness` (same body as create).
 * Every check is honest: `unknown` is a state, never silently `ok`.
 */
export interface Ai2RunReadiness {
  ready: boolean;
  checks: {
    name: string;
    status: 'ok' | 'warn' | 'fail' | 'unknown';
    detail: string | null;
  }[];
  /** Estimated resource envelope when the host can compute one — else nulls. */
  resources: {
    estimatedCostUsd: number | null;
    estimatedDurationS: number | null;
    budgetRemainingUsd: number | null;
  };
}
