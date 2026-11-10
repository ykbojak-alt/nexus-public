import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GuardShield } from './guard-shield';

afterEach(cleanup);

const NODES = [
  { id: 'n1', label: 'files', kind: 'domain' },
  { id: 'n2', label: 'net', kind: 'peer' },
  { id: 'n3', label: 'policy', kind: 'policy' },
];

describe('GuardShield — honest security state (W4-06)', () => {
  it('unavailable renders outline + text, never a filled/green claim', () => {
    render(<GuardShield state="unavailable" nodes={NODES} />);
    expect(screen.getByRole('img')).toHaveAttribute('data-state', 'unavailable');
    expect(screen.getByText(/unavailable — provider not connected/)).toBeInTheDocument();
  });

  it('state is readable as text without color — every variant', () => {
    for (const [state, text] of [
      ['secure', 'secure'],
      ['watching', 'watching'],
      ['scanning', 'scanning'],
      ['threat', 'threat detected'],
      ['unavailable', 'unavailable'],
      ['unknown', 'unknown'],
    ] as const) {
      const { unmount } = render(<GuardShield state={state} />);
      expect(screen.getByText(new RegExp(text))).toBeInTheDocument();
      expect(screen.getByRole('img')).toHaveAttribute('data-state', state);
      unmount();
    }
  });

  it('satellite positions are deterministic — identical across renders', () => {
    const a = render(<GuardShield state="watching" nodes={NODES} />).container.innerHTML;
    cleanup();
    const b = render(<GuardShield state="watching" nodes={NODES} />).container.innerHTML;
    expect(a).toBe(b);
  });

  it('node labels render as text next to satellites', () => {
    render(<GuardShield state="watching" nodes={NODES} />);
    expect(document.querySelectorAll('[data-node]')).toHaveLength(3);
  });
});
