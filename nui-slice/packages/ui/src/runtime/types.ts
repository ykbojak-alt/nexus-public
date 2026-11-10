/** Shared vocabulary for local-runtime primitives. All unions describe
 *  NEXUS-owned state — host/workspace/session truth, never provider internals. */

/** Local Executor workspace root grant state. */
export type WorkspaceRootState = 'granted' | 'pending' | 'revoked' | 'unavailable';

/** Runtime permission mode — the three contract modes, verbatim semantics. */
export type PermissionModeKind = 'observe' | 'approve-each' | 'autonomy-scope';

/** Worker-grant liveness as the host enforces it (grants-lifecycle-spec §1):
 *  `revoked` wins over `expired` — the denial reason follows the stronger cause.
 *  A live worker process can still hold a dead grant; never derive this from
 *  worker lifecycle state. */
export type GrantLiveness = 'active' | 'expired' | 'revoked';

/** Local session lifecycle (worker/session truth, not agent status). */
export type LocalSessionState = 'idle' | 'starting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'unavailable' | 'error';

/** Environment readiness check result. */
export type ReadinessState = 'ready' | 'checking' | 'unavailable' | 'unknown';

/** Runtime event/action-feed row kind. `model_call` — фактический вид
 *  события AI-2 (вызов модели), контракт-тест и прод-логи его несут. */
export type RuntimeEventKind = 'file' | 'command' | 'result' | 'plan' | 'checkpoint' | 'model_call' | 'error' | 'info';

/** File-diff review state. */
export type FileDiffState = 'pending' | 'accepted' | 'rejected' | 'restored';

/** Plan step progress. */
export type PlanStepState = 'pending' | 'running' | 'done' | 'blocked' | 'skipped';

/** Local audio player state — local files only; remote providers keep their
 *  own controls and never reuse this vocabulary. */
export type AudioTrackState = 'ready' | 'loading' | 'playing' | 'paused' | 'ended' | 'unsupported' | 'error';

/** Provider embed container state. */
export type ProviderEmbedState = 'idle' | 'loading' | 'ready' | 'blocked' | 'unavailable' | 'error';

/** Provider account-connection lifecycle — adapter `getStatus` vocabulary
 *  (telegram-runtime-window-contract: disconnected→authorizing→connected,
 *  plus reconnecting/locked/unavailable/error). Verbatim union; UI maps
 *  through ConnectionStatus, never invents a connected-looking state. */
export type ProviderConnectionState =
    | 'disconnected' | 'authorizing' | 'connected' | 'reconnecting'
    | 'locked' | 'unavailable' | 'error';
