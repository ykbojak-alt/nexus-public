import type { InstagramApiStatus, InstagramWebState, TelegramStatus } from '@nexus/mock-data';
import { mapLifecycle, type FlowStep } from '@nexus/ui';

/**
 * Typed provider lifecycle mappers — Window 4 handoff for Window 3 screens.
 *
 * Each mapper takes the verbatim status from the adapter boundary types in
 * `@nexus/mock-data` and produces `FlowStep[]` for `FlowSteps`. The rule is
 * "claim only what the status proves": a happy-path step is `done`/`current`
 * only when the status positionally implies it; terminal outcomes
 * (`locked`, `unavailable`, `error`, …) are appended as a `blocked` step
 * without marking unconfirmed path progress.
 *
 * `rate-limited` and `permission-revoked` are states OF a connection — they
 * definitionally require `connected` was reached, so the path up to
 * `connected` is shown done. `limited-account-type`, `offline`,
 * `unavailable`, `error`, `locked` prove no specific position — path stays
 * pending and only the blocked outcome is drawn.
 */

const TELEGRAM_PATH = ['disconnected', 'authorizing', 'connected', 'reconnecting'] as const;
const INSTAGRAM_WEB_PATH = ['closed', 'opening', 'open'] as const;
const INSTAGRAM_API_PATH = ['not-connected', 'connecting', 'needs-permission', 'connected'] as const;

/** Terminal Telegram statuses that prove no positional progress. */
const TELEGRAM_OUTCOMES: ReadonlySet<TelegramStatus> = new Set(['locked', 'unavailable', 'error']);

/** Terminal Instagram Web statuses that prove no positional progress. */
const INSTAGRAM_WEB_OUTCOMES: ReadonlySet<InstagramWebState> = new Set(['unavailable', 'error']);

/** Instagram API statuses that definitionally require `connected` was reached. */
const INSTAGRAM_API_POST_CONNECT: ReadonlySet<InstagramApiStatus> = new Set([
    'permission-revoked',
    'rate-limited',
]);

/** Terminal Instagram API statuses that prove no positional progress. */
const INSTAGRAM_API_OUTCOMES: ReadonlySet<InstagramApiStatus> = new Set([
    'limited-account-type',
    'offline',
    'unavailable',
    'error',
]);

export function telegramLifecycle(status: TelegramStatus): FlowStep[] {
    if (TELEGRAM_OUTCOMES.has(status)) {
        return mapLifecycle([...TELEGRAM_PATH, status], null, { blocked: status });
    }
    return mapLifecycle(TELEGRAM_PATH, status);
}

export function instagramWebLifecycle(state: InstagramWebState): FlowStep[] {
    if (INSTAGRAM_WEB_OUTCOMES.has(state)) {
        return mapLifecycle([...INSTAGRAM_WEB_PATH, state], null, { blocked: state });
    }
    return mapLifecycle(INSTAGRAM_WEB_PATH, state);
}

export function instagramApiLifecycle(status: InstagramApiStatus): FlowStep[] {
    if (INSTAGRAM_API_POST_CONNECT.has(status)) {
        return mapLifecycle([...INSTAGRAM_API_PATH, status], 'connected', { blocked: status });
    }
    if (INSTAGRAM_API_OUTCOMES.has(status)) {
        return mapLifecycle([...INSTAGRAM_API_PATH, status], null, { blocked: status });
    }
    return mapLifecycle(INSTAGRAM_API_PATH, status);
}
