import { describe, expect, it } from 'vitest';
import {
    instagramApiLifecycle,
    instagramWebLifecycle,
    telegramLifecycle,
} from './provider-lifecycle';

const byId = (steps: { id: string; status?: string }[]) =>
    Object.fromEntries(steps.map((s) => [s.id, s.status]));

describe('provider-lifecycle mappers', () => {
    it('maps telegram path positionally', () => {
        const steps = byId(telegramLifecycle('connected'));
        expect(steps['disconnected']).toBe('done');
        expect(steps['authorizing']).toBe('done');
        expect(steps['connected']).toBe('current');
        expect(steps['reconnecting']).toBe('pending');
    });

    it('appends unconfirmed outcomes as blocked without invented progress', () => {
        for (const status of ['locked', 'unavailable', 'error'] as const) {
            const steps = telegramLifecycle(status);
            const last = steps[steps.length - 1];
            expect(last.id).toBe(status);
            expect(last.status).toBe('blocked');
            expect(steps.slice(0, -1).every((s) => s.status === 'pending')).toBe(true);
        }
    });

    it('maps instagram web path and terminal outcomes', () => {
        expect(byId(instagramWebLifecycle('open'))['open']).toBe('current');
        for (const state of ['unavailable', 'error'] as const) {
            const steps = instagramWebLifecycle(state);
            expect(steps[steps.length - 1]).toMatchObject({ id: state, status: 'blocked' });
        }
    });

    it('treats post-connect api outcomes as requiring a reached connection', () => {
        for (const status of ['permission-revoked', 'rate-limited'] as const) {
            const steps = byId(instagramApiLifecycle(status));
            expect(steps['connected']).toBe('current');
            expect(steps[status]).toBe('blocked');
            expect(steps['needs-permission']).toBe('done');
        }
    });

    it('claims no progress for api outcomes without positional proof', () => {
        for (const status of ['limited-account-type', 'offline', 'unavailable', 'error'] as const) {
            const steps = instagramApiLifecycle(status);
            expect(steps.slice(0, -1).every((s) => s.status === 'pending')).toBe(true);
            expect(steps[steps.length - 1].status).toBe('blocked');
        }
    });
});
