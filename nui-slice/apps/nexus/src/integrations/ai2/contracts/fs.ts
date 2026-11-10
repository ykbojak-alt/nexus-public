/**
 * Fs-access contract — `/v1/fs/*` + `fs_policy` run field (fs-access dispatch,
 * W1 backend live-verified). The boundary is host-enforced: the shell only
 * sends the policy and renders facts — never simulates file access.
 */

/** Global gate for fs tools inside a run. */
export type FsMode = 'read_only' | 'read_write';

/** One project root the run may touch. */
export interface FsRoot {
  id: string;
  /** Absolute host path, canonicalized server-side (realpath). */
  path: string;
  /** Declared per-root cap; the run mode is the master gate. */
  access: 'rw' | 'ro';
}

/** POST /v1/runs field `fs_policy` (≤16 roots). */
export interface FsPolicy {
  mode: FsMode;
  roots: FsRoot[];
  /** read_only: write attempts become FsWriteRequest tickets for the user. */
  requestWrites: boolean;
}

/** POST /v1/fs/validate reply. `path` is the server's canonical realpath. */
export interface FsValidateResult {
  ok: boolean;
  path?: string;
  /** Verbatim host reason when ok=false — render it, never translate. */
  reason?: string;
}

export type FsRequestStatus = 'pending' | 'approved' | 'denied' | 'expired';

/**
 * Write-ticket created by a read_only run when the model asks for a write
 * (fs_request trace event carries the same fields). Content is never sent —
 * preview ≤400B + sha256+size are what the user reviews.
 */
export interface FsWriteRequest {
  id: string;
  runId: string;
  root: string;
  path: string;
  op: string;
  size: number;
  sha256: string;
  preview: string;
  status: FsRequestStatus;
  createdAt?: number;
  resolvedAt?: number | null;
}
