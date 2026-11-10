import type { NexusStatus } from '../feedback/status-badge/status-badge';
import type { GrantLiveness } from './types';

/** Grant view needed for liveness — matches the `grant` block of
 *  `Ai2WorkerStatus` and `WorkspaceGrant.to_dict()` in the ai2 contract. */
export interface GrantLivenessInput {
  /** True once the operator revoked the grant — survives worker restart. */
  revoked: boolean;
  /** ISO-8601 absolute deadline; null = the grant never self-expires. */
  expiresAt: string | null;
}

/** Derives grant liveness per grants-lifecycle-spec §1: `revoked` is checked
 *  before `expired` — a revoked grant whose TTL also passed answers `revoked`,
 *  because the stronger denial cause wins.
 *  `nowMs` defaults to the clock; tests and renderers pass a fixed instant. */
export function grantLiveness(grant: GrantLivenessInput, nowMs: number = Date.now()): GrantLiveness {
  if (grant.revoked) return 'revoked';
  if (grant.expiresAt != null && Date.parse(grant.expiresAt) <= nowMs) return 'expired';
  return 'active';
}

export const GRANT_LIVENESS_STATUS: Record<GrantLiveness, NexusStatus> = {
  active: 'online',
  expired: 'warning',
  revoked: 'error',
};

export const GRANT_LIVENESS_LABELS: Record<GrantLiveness, string> = {
  active: 'Grant active',
  expired: 'Grant expired',
  revoked: 'Grant revoked',
};

/** Human detail for an active grant with a deadline — absolute, never
 *  relative ("in 5 min" drifts between renders). Returns null for eternal grants. */
export function grantDeadlineText(grant: GrantLivenessInput): string | null {
  if (grant.expiresAt == null) return null;
  const ms = Date.parse(grant.expiresAt);
  if (Number.isNaN(ms)) return null;
  return `до ${new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
}
