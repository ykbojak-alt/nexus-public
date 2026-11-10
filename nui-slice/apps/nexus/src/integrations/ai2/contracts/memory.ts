/**
 * Project memory contracts — /v1/memory[/search].
 * `meta` is an arbitrary user payload: keys inside are never renamed.
 */

export interface Ai2MemoryItem {
  id: string;
  tenant: string;
  project: string;
  text: string;
  meta: Record<string, unknown>;
  createdAt: number;
  /** Cosine similarity — present only in /search results. */
  score?: number | null;
}

export interface AddMemoryInput {
  project: string;
  text: string;
  meta?: Record<string, unknown>;
}

export interface MemoryListQuery {
  project: string;
  limit?: number;
  offset?: number;
}

export interface MemorySearchQuery {
  project: string;
  q: string;
  k?: number;
}
