import type { Ai2ErrorBody } from '../contracts/common';

/**
 * API error carrying the AI-2 error envelope.
 * `code` is the machine code (error field), `requestId` correlates with
 * the server's X-Request-ID, `retryAfterS` is set on 429.
 */
export class Ai2ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: unknown;
  readonly requestId?: string;
  readonly retryAfterS?: number;

  constructor(status: number, body: Partial<Ai2ErrorBody> | undefined) {
    const message = typeof body?.message === 'string' && body.message
      ? body.message
      : `AI-2 request failed (HTTP ${status})`;
    super(message);
    this.name = 'Ai2ApiError';
    this.status = status;
    this.code = typeof body?.error === 'string' && body.error ? body.error : 'error';
    this.detail = body?.detail;
    this.requestId = typeof body?.request_id === 'string' ? body.request_id : undefined;
    this.retryAfterS = typeof body?.retry_after_s === 'number' ? body.retry_after_s : undefined;
  }
}

export function isAi2ApiError(value: unknown): value is Ai2ApiError {
  return value instanceof Ai2ApiError;
}

export type Ai2NetworkErrorKind = 'offline' | 'timeout' | 'aborted';

/**
 * Transport-level failure before any HTTP response: DNS/socket down
 * (`offline`), client-side timeout (`timeout`), or caller AbortSignal
 * (`aborted`). Distinct from Ai2ApiError — no status/envelope exists.
 */
export class Ai2NetworkError extends Error {
  readonly kind: Ai2NetworkErrorKind;
  readonly path: string;
  override readonly cause: unknown;

  constructor(kind: Ai2NetworkErrorKind, path: string, cause: unknown) {
    const label = kind === 'offline' ? 'AI-2 unreachable (offline)'
      : kind === 'timeout' ? 'AI-2 request timed out'
        : 'AI-2 request aborted';
    super(`${label}: ${path}`);
    this.name = 'Ai2NetworkError';
    this.kind = kind;
    this.path = path;
    this.cause = cause;
  }
}

export function isAi2NetworkError(value: unknown): value is Ai2NetworkError {
  return value instanceof Ai2NetworkError;
}
