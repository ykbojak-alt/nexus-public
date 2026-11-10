import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLiveBoard, resolveContractId, resolveRpcUrl } from './hivebid-live';

function b64json(obj: unknown): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))));
}

function makeFetch(routes: Record<string, (args: Record<string, unknown>) => unknown>) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; params: { method_name: string; args_base64?: string } };
    const route = routes[body.params.method_name];
    if (!route) throw new Error(`no route for ${body.params.method_name}`);
    const args = body.params.args_base64 ? JSON.parse(atob(body.params.args_base64)) as Record<string, unknown> : {};
    const out = route(args);
    const result = Array.from(new TextEncoder().encode(JSON.stringify(out)));
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { result, logs: [], block_height: 100 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

const LOT = {
  lot_id: 'LOT-LIVE-01',
  status: 'Open',
  manager: 'bob.near',
  budget: '100000000000000000000000000',
  bids: [{ agent: 'alice.near', price: '40000000000000000000000000', eta_ms: 30000 }],
  winner: null,
  winning_price: '0',
  work_deadline_ms: Date.now() + 60 * 60 * 1000,
};

const AGENT = {
  account: 'alice.near',
  stake: '100000000000000000000000000',
  tasks_completed: 4,
  tasks_failed: 1,
  rating: '400000',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hivebid-live', () => {
  it('resolves RPC/contract config with env and defaults', () => {
    expect(resolveRpcUrl()).toBe('https://rpc.testnet.near.org');
    expect(resolveContractId()).toBe('hivebid-market.testnet');
    expect(resolveRpcUrl('https://rpc.mainnet.near.org')).toBe('https://rpc.mainnet.near.org');
    expect(resolveContractId('hivebid.prod.near')).toBe('hivebid.prod.near');
  });

  it('loads lots/agents/escrow via near RPC view calls', async () => {
    const fetchMock = makeFetch({
      get_lot_ids: () => ['LOT-LIVE-01'],
      get_lot: (_) => LOT,
      get_agent: (args) => args.account === 'alice.near' ? AGENT : null,
      get_escrow: () => '100000000000000000000000000',
      get_treasury: () => '0',
      get_burned: () => '123000000000000000000000000',
    });
    vi.stubGlobal('fetch', fetchMock);

    const data = await fetchLiveBoard();

    expect(data.connected).toBe(true);
    expect(data.lots).toHaveLength(1);
    expect(data.lots[0]).toMatchObject({
      id: 'LOT-LIVE-01',
      status: 'open',
      bidder: 'alice.near',
    });
    expect(data.lots[0].reserve).toBe('100.00 Ⓝ');
    expect(data.lots[0].bestBid).toBe('40.00 Ⓝ');
    expect(data.agents).toHaveLength(1);
    expect(data.agents[0].account).toBe('alice.near');
    expect(data.escrow).toBe('100.00 Ⓝ');
    expect(data.burned).toBe('123.00 Ⓝ');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('falls back to disconnected mock state when RPC fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));

    const data = await fetchLiveBoard();

    expect(data.connected).toBe(false);
    expect(data.error).toContain('RPC недоступен');
    expect(data.lots).toEqual([]);
  });
});
