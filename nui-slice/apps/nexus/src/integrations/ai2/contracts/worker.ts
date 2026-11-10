/**
 * Local worker contract — /v1/worker/* (W1-07..09, server/app.py + ai2/worker/).
 *
 * The worker is a grant-bounded child process: it sees ONLY the declared
 * workspace roots, runs ONLY the granted ops, and exec is restricted to exact
 * argv prefixes. The server is the enforcement boundary — these types describe
 * what the host reports, never what the shell assumes.
 *
 * Wire keys are snake_case; the client maps them to this camelCase shape.
 */

/** Permission posture of the grant. `observe` strips exec/write/rollback at grant level. */
export type Ai2WorkerMode = 'observe' | 'approve_each' | 'autonomy';

/** Worker lifecycle as the host reports it; `down` means never launched (or shut down). */
export type Ai2WorkerState = 'down' | 'starting' | 'ready' | 'crashed';

/** Serializable grant view — matches `WorkspaceGrant.to_dict()`. */
export interface Ai2WorkerGrant {
  grantId: string;
  /** Canonicalized realpaths — the only directories the worker can address. */
  roots: string[];
  /** Granted ops (read/list/stat/search/diff/exec/write/checkpoint/rollback/list_checkpoints). */
  ops: string[];
  /** Exact argv prefixes allowed for exec — `[python -c]` does not cover `[python -m]`. */
  commands: string[][];
  mode: Ai2WorkerMode;
  /** ISO-8601 expiry; null = the grant does not expire on its own. */
  expiresAt: string | null;
  /** True after revoke — subsequent ops fail `revoked`. */
  revoked: boolean;
  createdAt: string;
}

/** Worker status block (GET /v1/worker/status → `worker`). */
export interface Ai2WorkerStatus {
  state: Ai2WorkerState;
  /** False only for the honest not-launched answer; absent fields stay undefined. */
  launched?: boolean;
  pid?: number | null;
  restarts?: number;
  maxRestarts?: number;
  uptimeS?: number | null;
  grant?: {
    grantId: string;
    mode: Ai2WorkerMode;
    roots: string[];
    ops: string[];
    expiresAt: string | null;
    revoked: boolean;
  };
}

/** POST /v1/worker/launch body. */
export interface WorkerLaunchInput {
  roots: string[];
  ops?: string[];
  commands?: string[][];
  mode?: Ai2WorkerMode;
  /** Grant TTL in seconds (>1, ≤86400); omit = no self-expiry. */
  ttlS?: number;
}

/** POST /v1/worker/launch → 201 response. */
export interface Ai2WorkerLaunched {
  worker: Ai2WorkerStatus;
  grant: Ai2WorkerGrant;
}

/** POST /v1/worker/request body — one bounded op against the grant. */
export interface WorkerRequestInput {
  op: string;
  args?: Record<string, unknown>;
  /** Per-op deadline in seconds (>0.5, ≤300); default 60. */
  timeoutS?: number;
}

/** Worker error kinds map to HTTP by the host: denied/escape/revoked/expired → 403,
 * not_found → 404, invalid → 422, timeout → 504, crash → 503. The client's
 * Ai2ApiError already carries the status; the kind text is in the message. */
export type Ai2WorkerErrorKind =
  | 'denied' | 'escape' | 'revoked' | 'expired'
  | 'not_found' | 'invalid' | 'timeout' | 'crash' | 'internal';
