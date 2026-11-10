// @vitest-environment jsdom
/**
 * P1-4: честный idle-статус TPlayer. Без токена probe не уходит —
 * сразу TOKEN REQUIRED; с токеном + 200 probe → ENGINE ONLINE.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TPlayerScreen } from './tplayer-screen';

const KEY = 'nexus.tplayer.token';

vi.mock('../profile/profile-store', () => ({
  useProfile: () => ({ profile: {}, persisted: true, complete: true, loaded: true }),
}));

describe('TPlayerScreen — honest idle (P1-4)', () => {
  beforeEach(() => {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  });

  it('без токена — TOKEN REQUIRED, fetch к /api/tplayer не уходит', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, engine: 'nexus-p2p' })));
    vi.stubGlobal('fetch', fetchMock);
    render(<TPlayerScreen />);
    expect(await screen.findByText('TOKEN REQUIRED')).toBeInTheDocument();
    // probe не запускается без токена: fetch не вызывался с /api/tplayer
    const calls = fetchMock.mock.calls as unknown as Array<[unknown]>;
    expect(calls.some(([input]) => String(input).includes('/api/tplayer'))).toBe(false);
    vi.unstubAllGlobals();
  });

  it('с токеном и 200 от прокси — ENGINE ONLINE', async () => {
    localStorage.setItem(KEY, 'tok_ok');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, engine: 'nexus-p2p' })));
    vi.stubGlobal('fetch', fetchMock);
    render(<TPlayerScreen />);
    expect(await screen.findByText('ENGINE ONLINE')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
