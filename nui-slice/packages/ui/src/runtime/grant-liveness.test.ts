import { describe, expect, it } from 'vitest';
import { grantDeadlineText, grantLiveness, GRANT_LIVENESS_STATUS } from './grant-liveness';

const NOW = Date.parse('2026-10-20T12:00:00Z');

describe('grantLiveness — grants-lifecycle-spec §1', () => {
  it('active when not revoked and no expiry', () => {
    expect(grantLiveness({ revoked: false, expiresAt: null }, NOW)).toBe('active');
  });

  it('active when expiry is still in the future', () => {
    expect(grantLiveness({ revoked: false, expiresAt: '2026-10-20T13:00:00Z' }, NOW)).toBe('active');
  });

  it('expired once the absolute deadline passes', () => {
    expect(grantLiveness({ revoked: false, expiresAt: '2026-10-20T11:59:59Z' }, NOW)).toBe('expired');
  });

  it('revoked wins over expired — the stronger denial cause', () => {
    expect(grantLiveness({ revoked: true, expiresAt: '2026-10-20T11:00:00Z' }, NOW)).toBe('revoked');
  });

  it('revoked even with a live TTL remaining', () => {
    expect(grantLiveness({ revoked: true, expiresAt: '2026-10-20T23:00:00Z' }, NOW)).toBe('revoked');
  });
});

describe('grant-liveness presentation', () => {
  it('maps every liveness to a distinct NexusStatus', () => {
    expect(new Set(Object.values(GRANT_LIVENESS_STATUS)).size).toBe(3);
  });

  it('deadline text only for grants that expire', () => {
    expect(grantDeadlineText({ revoked: false, expiresAt: null })).toBeNull();
    expect(grantDeadlineText({ revoked: false, expiresAt: 'not-a-date' })).toBeNull();
    expect(grantDeadlineText({ revoked: false, expiresAt: '2026-10-20T13:00:00Z' })).toMatch(/^до \d{2}\.\d{2}/);
  });
});
