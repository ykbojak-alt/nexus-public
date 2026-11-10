import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NewfSystemPanel, formatBytes, barPct, formatUptime } from './newf-system-panel';

afterEach(() => vi.unstubAllGlobals());

describe('NewfSystemPanel', () => {
  it('renders system snapshot from fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cpu_pct: 50,
        mem_used: 1024 * 1024 * 1024,
        mem_total: 2 * 1024 * 1024 * 1024,
        disks: [{ letter: 'C:', free: 10, total: 100 }],
        net: { rx_bps: 100, tx_bps: 200 },
        gpu: null,
        uptime_s: 3661,
      }),
    }));
    render(<NewfSystemPanel base="http://core.test:5683" pollMs={10000} />);
    expect(await screen.findByText(/SYSTEM/i)).toBeTruthy();
    expect(screen.getByText(/no gpu/i)).toBeTruthy();
  });
});

describe('helpers', () => {
  it('formatBytes', () => expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0G'));
  it('barPct', () => expect(barPct(50, 100)).toBe(50));
  it('formatUptime', () => expect(formatUptime(3661)).toBe('1h 1m 1s'));
});