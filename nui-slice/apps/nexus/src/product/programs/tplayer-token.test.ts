// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { getTPlayerToken, setTPlayerToken, syncTPlayerTokenFromProfile } from './tplayer-token';

const KEY = 'nexus.tplayer.token';

afterEach(() => {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
});

describe('tplayer-token (X-Nexus-TPlayer для /api/tplayer)', () => {
  it('returns null when nothing stored', () => {
    expect(getTPlayerToken()).toBeNull();
  });

  it('round-trips a stored token', () => {
    setTPlayerToken('tok_123');
    expect(getTPlayerToken()).toBe('tok_123');
  });

  it('removes the token when set to null/empty', () => {
    setTPlayerToken('tok_123');
    setTPlayerToken(null);
    expect(getTPlayerToken()).toBeNull();
  });

  it('syncs from profile only when a token is present', () => {
    syncTPlayerTokenFromProfile('tok_profile');
    expect(getTPlayerToken()).toBe('tok_profile');
    syncTPlayerTokenFromProfile(undefined);
    expect(getTPlayerToken()).toBe('tok_profile'); // не затирает без значения
  });
});
