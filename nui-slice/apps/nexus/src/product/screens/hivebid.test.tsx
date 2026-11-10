// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HiveBidScreen } from './hivebid';
import { fetchCoreRatings, fetchLiveBoard } from './hivebid-live';

vi.mock('./hivebid-live', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hivebid-live')>();
  return {
    ...actual,
    fetchLiveBoard: vi.fn(),
    fetchCoreRatings: vi.fn(async () => ({ ok: true, ratings: {} })),
  };
});

const mockedFetch = vi.mocked(fetchLiveBoard);
const mockedCoreRatings = vi.mocked(fetchCoreRatings);

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('HiveBidScreen', () => {
  it('renders a one-line product definition in hero (no testnet claim)', () => {
    render(<HiveBidScreen />);

    const def = screen.getByTestId('hivebid-hero-definition');
    expect(def).toHaveTextContent(/escrow marketplace run by AI agents/i);
    expect(def).toHaveTextContent(/AEGIS policy gate is the core/i);
    expect(def.textContent).not.toMatch(/testnet/i);
  });

  it('renders the board as an explicitly offline demo static board', () => {
    render(<HiveBidScreen />);

    const board = screen.getByTestId('hivebid-board');
    expect(board).toHaveAttribute('data-state', 'mock');
    expect(screen.getByRole('heading', { level: 1, name: /Work moves.*Escrow follows proof/i })).toBeInTheDocument();
    expect(screen.getByText('Offline · no network')).toBeInTheDocument();
    expect(screen.getByText('Demo mode · static data')).toBeInTheDocument();
    expect(screen.getByText(/No network · no live bids, escrow, or swarm status/i)).toBeInTheDocument();
  });

  it('shows the seven demo lots and their current lifecycle states', () => {
    render(<HiveBidScreen />);

    const lots = screen.getByRole('region', { name: /Open lots & awards/i });
    expect(within(lots).getByTestId('hivebid-lot-LOT-001')).toHaveTextContent('Screen recipient risk & write memo');
    expect(within(lots).getByTestId('hivebid-lot-LOT-001')).toHaveTextContent('open');
    expect(within(lots).getByTestId('hivebid-lot-LOT-002')).toHaveTextContent('Monitor shielded transfer receipt');
    expect(within(lots).getByTestId('hivebid-lot-LOT-002')).toHaveTextContent('bids closed');
    expect(within(lots).getByTestId('hivebid-lot-LOT-003')).toHaveTextContent('Prepare a NEAR attest verifier');
    expect(within(lots).getByTestId('hivebid-lot-LOT-003')).toHaveTextContent('awarded');
    expect(within(lots).getByTestId('hivebid-lot-LOT-004')).toHaveTextContent('submitted');
    expect(within(lots).getByTestId('hivebid-lot-LOT-005')).toHaveTextContent('rework');
    expect(within(lots).getByTestId('hivebid-lot-LOT-006')).toHaveTextContent('completed');
    expect(within(lots).getByTestId('hivebid-lot-LOT-007')).toHaveTextContent('failed');
  });

  it('shows the lifecycle stepper on the selected lot card with current state', () => {
    render(<HiveBidScreen />);

    const card = screen.getByTestId('hivebid-lotcard');
    const stepper = within(card).getByTestId('hivebid-lifecycle');
    expect(stepper).toBeInTheDocument();
    const steps = within(stepper).getAllByRole('listitem');
    expect(steps).toHaveLength(5);
    expect(steps.map((step) => step.textContent)).toEqual([
      'OPEN', 'BIDS CLOSED', 'AWARDED', 'SUBMITTED', 'COMPLETED',
    ]);
    // Первый лот — open: пройденных нет, текущий — первый.
    expect(within(stepper).getByText('OPEN').closest('li')).toHaveAttribute('data-state', 'current');
    expect(within(stepper).getByText('AWARDED').closest('li')).toHaveAttribute('data-state', 'pending');
  });

  it('shows the escrow locked indicator on the lot card (frozen funds)', () => {
    render(<HiveBidScreen />);

    const card = screen.getByTestId('hivebid-lotcard');
    const escrow = within(card).getByTestId('hivebid-escrow-bar');
    expect(escrow).toHaveTextContent('escrow · locked');
    expect(escrow).toHaveTextContent('100 cr');
    expect(escrow).toHaveTextContent(/заморожены до вердикта/i);
  });

  it('marks completed lots as released escrow', () => {
    render(<HiveBidScreen />);
    fireEvent.click(screen.getByTestId('hivebid-lot-LOT-006'));

    const escrow = within(screen.getByTestId('hivebid-lotcard')).getByTestId('hivebid-escrow-bar');
    expect(escrow).toHaveTextContent('escrow · released');
    expect(escrow).toHaveTextContent('160 cr');
  });

  it('keeps executor selection read-only and explains the reserve-before-award invariant', () => {
    render(<HiveBidScreen />);

    expect(screen.getByText(/Статический выбор; award с этой страницы не отправляется/i)).toBeInTheDocument();
    expect(screen.getByText(/escrow reserve is recorded before the award is issued/i)).toBeInTheDocument();
  });

  it('renders demo rating badges (reused #373 component) in swarm standings', () => {
    render(<HiveBidScreen />);

    const standings = screen.getByRole('region', { name: /Swarm standings/i });
    const badges = within(standings).getAllByTestId('newf-rating');
    expect(badges.length).toBeGreaterThanOrEqual(3);
    // roy2: 8.5 →; roy3: 7.9 ↓; machine-A: 6.8 ↑ — тренды разные.
    expect(within(standings).getByTestId('hivebid-swarm-roy2')).toHaveTextContent('8.5');
    expect(within(standings).getByTestId('hivebid-swarm-roy3')).toHaveTextContent('7.9');
    expect(within(standings).getByTestId('hivebid-swarm-machine-A')).toHaveTextContent('6.8');
  });

  it('renders the agent panel with a rating badge and ledger events', () => {
    render(<HiveBidScreen />);

    const panel = screen.getByTestId('hivebid-agent');
    expect(within(panel).getByTestId('newf-rating')).toBeInTheDocument();
    expect(within(panel).getByText('30 cr')).toBeInTheDocument();
    expect(within(panel).getByRole('list', { name: /Ledger for/ })).toBeInTheDocument();
    expect(within(panel).getByText(/register_agent · stake 30 cr/)).toBeInTheDocument();
    expect(within(panel).getByText(/verify pass · payout 95 cr/)).toBeInTheDocument();
  });

  it('shows escrow invariant line to the judge', () => {
    render(<HiveBidScreen />);

    expect(screen.getByTestId('hivebid-invariant')).toHaveTextContent(/escrow 810 = Σ резервов 810/i);
  });

  it('maps rework to the submitted stage on the stepper', () => {
    render(<HiveBidScreen />);
    fireEvent.click(screen.getByTestId('hivebid-lot-LOT-005'));

    const stepper = within(screen.getByTestId('hivebid-lotcard')).getByTestId('hivebid-lifecycle');
    expect(within(stepper).getByText('SUBMITTED').closest('li')).toHaveAttribute('data-state', 'current');
    expect(within(screen.getByTestId('hivebid-lotcard')).getByText(/rework · resubmission in progress/)).toBeInTheDocument();
  });

  it('marks failed lots as terminal with escrow released', () => {
    render(<HiveBidScreen />);
    fireEvent.click(screen.getByTestId('hivebid-lot-LOT-007'));

    const stepper = within(screen.getByTestId('hivebid-lotcard')).getByTestId('hivebid-lifecycle');
    expect(within(stepper).getByText('OPEN').closest('li')).toHaveAttribute('data-state', 'pending');
    expect(within(screen.getByTestId('hivebid-lotcard')).getByText(/failed · escrow released per verdict/)).toBeInTheDocument();
    expect(within(screen.getByTestId('hivebid-lotcard')).getByTestId('hivebid-escrow-bar')).toHaveTextContent('escrow · released');
  });

  it('keeps demo scenario labels honest (no live/on-chain claims on rows)', () => {
    render(<HiveBidScreen />);

    const lots = screen.getByRole('region', { name: /Open lots & awards/i });
    for (const id of ['LOT-001', 'LOT-002', 'LOT-003', 'LOT-004', 'LOT-005', 'LOT-006', 'LOT-007']) {
      const row = within(lots).getByTestId(`hivebid-lot-${id}`);
      expect(row.textContent).not.toMatch(/live|on-chain/i);
    }
    // Каждый демо-лот несёт канонический статус-лейбл из контрактного набора.
    const statuses = new Set(['open', 'bids closed', 'awarded', 'submitted', 'rework', 'completed', 'failed']);
    const demoRows = within(lots).getAllByRole('row').slice(1); // без thead
    expect(demoRows).toHaveLength(7);
    for (const row of demoRows) {
      const hasStatus = [...statuses].some((s) => row.textContent?.includes(s));
      expect(hasStatus).toBe(true);
    }
  });

  it('marks the demo agent panel as demo (no live claims)', () => {
    render(<HiveBidScreen />);

    const panel = screen.getByTestId('hivebid-agent');
    expect(panel).toHaveAttribute('data-state', 'mock');
    expect(within(panel).getByText('demo agent')).toBeInTheDocument();
    expect(within(panel).getByTestId('hivebid-agent-demo-note')).toHaveTextContent(/не являются живыми аккаунтами/i);
    expect(panel.textContent).not.toMatch(/live|on-chain/i);
  });

  describe('live ratings', () => {
    it('shows the demo standings while ratings API is unavailable (ok=false)', async () => {
      mockedCoreRatings.mockResolvedValueOnce({ ok: false, ratings: {} });
      mockedFetch.mockResolvedValueOnce({
        mode: 'live',
        rpcUrl: 'https://rpc.testnet.near.org',
        contractId: 'hivebid-market.testnet',
        connected: true,
        lots: [],
        agents: [],
        escrow: '—', treasury: '—', burned: '—',
        updatedAt: Date.now(),
      });

      render(<HiveBidScreen />);
      fireEvent.click(screen.getByRole('button', { name: /Подключить/ }));

      await waitFor(() => {
        expect(screen.getByTestId('hivebid-board')).toHaveAttribute('data-state', 'live');
      });
      const standings = screen.getByRole('region', { name: /Swarm standings/i });
      // Честный маркер fallback, без подмены на fake-live.
      expect(within(standings).getByText(/Ratings API недоступен/)).toBeInTheDocument();
      expect(within(standings).getByTestId('hivebid-swarm-roy2')).toBeInTheDocument();
    });

    it('switches standings to live agents + API ratings when ratings ok', async () => {
      mockedCoreRatings.mockResolvedValueOnce({
        ok: true,
        ratings: {
          'alice.near': { score: 8.1, updated_ts: 1, history: [] },
          'bob.near': { score: 7.4, updated_ts: 1, history: [] },
        },
      });
      mockedFetch.mockResolvedValueOnce({
        mode: 'live',
        rpcUrl: 'https://rpc.testnet.near.org',
        contractId: 'hivebid-market.testnet',
        connected: true,
        lots: [
          {
            id: 'LOT-LIVE-01', status: 'open', reserve: '100 Ⓝ',
            bestBid: '40 Ⓝ', bidder: 'alice.near',
            manager: 'bob.near', winner: '—', deadline: '59m 59s',
            deadlineTs: Date.now() + 59 * 60 * 1000 + 59 * 1000,
          },
        ],
        agents: [
          { account: 'alice.near', stake: '100 Ⓝ', tasksCompleted: 4, tasksFailed: 1, rating: '0.4 Ⓝ' },
          { account: 'bob.near', stake: '50 Ⓝ', tasksCompleted: 2, tasksFailed: 0, rating: '0.2 Ⓝ' },
        ],
        escrow: '100 Ⓝ', treasury: '0 Ⓝ', burned: '123 Ⓝ',
        updatedAt: Date.now(),
      });

      render(<HiveBidScreen />);
      fireEvent.click(screen.getByRole('button', { name: /Подключить/ }));

      await waitFor(() => {
        expect(screen.getByTestId('hivebid-board')).toHaveAttribute('data-state', 'live');
      });
      const standings = screen.getByRole('region', { name: /Swarm standings/i });
      expect(within(standings).getByText(/Живые рейтинги из nexus-core/)).toBeInTheDocument();
      expect(within(standings).getByTestId('hivebid-swarm-alicenear')).toHaveTextContent('8.1');
      expect(within(standings).getByTestId('hivebid-swarm-bobnear')).toHaveTextContent('7.4');
      // Демо-строки нет.
      expect(within(standings).queryByTestId('hivebid-swarm-roy2')).not.toBeInTheDocument();
    });
  });

  describe('connect config', () => {
    it('defaults to DEFAULT_RPC_URL / DEFAULT_CONTRACT_ID when localStorage is empty', () => {
      render(<HiveBidScreen />);

      expect(screen.getByLabelText('RPC')).toHaveValue('https://rpc.testnet.near.org');
      expect(screen.getByLabelText('Contract')).toHaveValue('hivebid-market.testnet');
    });

    it('initializes from persisted localStorage config', () => {
      localStorage.setItem('hivebid.config.v1', JSON.stringify({
        rpcUrl: 'https://rpc.custom.testnet.near.org',
        contractId: 'market.custom.testnet',
      }));

      render(<HiveBidScreen />);

      expect(screen.getByLabelText('RPC')).toHaveValue('https://rpc.custom.testnet.near.org');
      expect(screen.getByLabelText('Contract')).toHaveValue('market.custom.testnet');
    });

    it('persists edits to localStorage', () => {
      render(<HiveBidScreen />);

      fireEvent.change(screen.getByLabelText('Contract'), { target: { value: 'new-contract.testnet' } });
      fireEvent.change(screen.getByLabelText('RPC'), { target: { value: 'https://rpc.new.testnet.near.org' } });

      const saved = JSON.parse(localStorage.getItem('hivebid.config.v1') ?? '{}');
      expect(saved.contractId).toBe('new-contract.testnet');
      expect(saved.rpcUrl).toBe('https://rpc.new.testnet.near.org');
    });

    it('shows "connected to <account>" chip when live connect succeeds', async () => {
      mockedFetch.mockResolvedValueOnce({
        mode: 'live',
        rpcUrl: 'https://rpc.testnet.near.org',
        contractId: 'hivebid-market.testnet',
        connected: true,
        lots: [],
        agents: [],
        escrow: '—', treasury: '—', burned: '—',
        updatedAt: Date.now(),
      });

      render(<HiveBidScreen />);
      fireEvent.click(screen.getByRole('button', { name: /Подключить/ }));

      await waitFor(() => {
        expect(screen.getByTestId('hivebid-connected-chip')).toHaveTextContent(
          'connected to hivebid-market.testnet',
        );
      });
    });

    it('persisted config is used for the connect attempt', async () => {
      localStorage.setItem('hivebid.config.v1', JSON.stringify({
        rpcUrl: 'https://rpc.custom.testnet.near.org',
        contractId: 'market.custom.testnet',
      }));
      mockedFetch.mockResolvedValueOnce({
        mode: 'live',
        rpcUrl: 'https://rpc.custom.testnet.near.org',
        contractId: 'market.custom.testnet',
        connected: true,
        lots: [], agents: [],
        escrow: '—', treasury: '—', burned: '—',
        updatedAt: Date.now(),
      });

      render(<HiveBidScreen />);
      fireEvent.click(screen.getByRole('button', { name: /Подключить/ }));

      await waitFor(() => {
        expect(mockedFetch).toHaveBeenCalledWith(
          'https://rpc.custom.testnet.near.org',
          'market.custom.testnet',
        );
      });
    });
  });

  describe('live binding', () => {
    it('stays in demo mode until connect is requested', () => {
      render(<HiveBidScreen />);
      expect(screen.getByTestId('hivebid-board')).toHaveAttribute('data-state', 'mock');
      expect(mockedFetch).not.toHaveBeenCalled();
      expect(mockedCoreRatings).not.toHaveBeenCalled();
    });

    it('switches to live mode and renders on-chain lots when connect succeeds', async () => {
      mockedFetch.mockResolvedValueOnce({
        mode: 'live',
        rpcUrl: 'https://rpc.testnet.near.org',
        contractId: 'hivebid-market.testnet',
        connected: true,
        lots: [
          {
            id: 'LOT-LIVE-01', status: 'open', reserve: '100 Ⓝ',
            bestBid: '40 Ⓝ', bidder: 'alice.near',
            manager: 'bob.near', winner: '—', deadline: '59m 59s',
            deadlineTs: Date.now() + 59 * 60 * 1000 + 59 * 1000,
          },
        ],
        agents: [{ account: 'alice.near', stake: '100 Ⓝ', tasksCompleted: 4, tasksFailed: 1, rating: '0.4 Ⓝ' }],
        escrow: '100 Ⓝ', treasury: '0 Ⓝ', burned: '123 Ⓝ',
        updatedAt: Date.now(),
      });

      render(<HiveBidScreen />);
      fireEvent.click(screen.getByRole('button', { name: /Подключить/ }));

      await waitFor(() => {
        expect(screen.getByTestId('hivebid-board')).toHaveAttribute('data-state', 'live');
      });
      expect(screen.getByText('Live · on-chain')).toBeInTheDocument();
      expect(screen.getAllByText('100 Ⓝ').length).toBeGreaterThan(0);
      expect(screen.getAllByText('alice.near').length).toBeGreaterThanOrEqual(1);
    });

    it('falls back to demo board when RPC fails', async () => {
      mockedFetch.mockResolvedValueOnce({
        mode: 'live', rpcUrl: 'x', contractId: 'y', connected: false,
        lots: [], agents: [], escrow: '—', treasury: '—', burned: '—',
        error: 'RPC недоступен: network down', updatedAt: Date.now(),
      });

      render(<HiveBidScreen />);
      fireEvent.click(screen.getByRole('button', { name: /Подключить/ }));

      await waitFor(() => {
        expect(screen.getByText(/RPC недоступен/)).toBeInTheDocument();
      });
      expect(screen.getByTestId('hivebid-board')).toHaveAttribute('data-state', 'mock');
      expect(screen.getByText('Offline · no network')).toBeInTheDocument();
      expect(screen.getByTestId('hivebid-lot-LOT-001')).toBeInTheDocument();
    });
  });
});
