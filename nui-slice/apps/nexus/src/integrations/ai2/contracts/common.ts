/**
 * Shared AI-2 transport contracts (Window 1).
 *
 * Public surface is camelCase; the wire is the AI-2 FastAPI shape
 * (snake_case). Mapping happens in `api/client.ts` — nothing here
 * invents or defaults fields the server did not send.
 */

/** Error envelope returned by AI-2 (`error_response`, server/app.py). */
export interface Ai2ErrorBody {
  error: string;
  message: string;
  detail: unknown;
  request_id?: string | null;
  retry_after_s?: number;
}

/** Paginated list envelope shared by /v1/runs, /v1/agents, /v1/plugins. */
export interface Ai2Page<T> {
  limit: number;
  offset: number;
  [key: string]: unknown;
}

/** Aggregated run usage counters (runs.usage JSON column). */
export interface Ai2Usage {
  tokens_in?: number;
  tokens_out?: number;
  model_calls?: number;
  tool_calls?: number;
  cost_usd?: number;
  [key: string]: unknown;
}
