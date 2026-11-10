// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { NewfLuxScreen } from './newf-lux';

afterEach(cleanup);

describe('NEWF Lux (minimal-lux shell)', () => {
  it('renders five fixed seats from mock fixtures', () => {
    render(<NewfLuxScreen />);
    const strip = screen.getByRole('list', { name: 'Agent seats' });
    const seats = within(strip).getAllByRole('listitem');
    expect(seats).toHaveLength(5);
    // занятые места показывают имя и адрес, свободные — vacant
    expect(screen.getAllByText('AGENT-A').length).toBeGreaterThan(0);
    expect(screen.getByText('mock-local-01 · 1 sub')).toBeInTheDocument();
  });

  it('renders agents hierarchy with sub-agents nested', () => {
    render(<NewfLuxScreen />);
    const tree = screen.getByRole('region', { name: 'Agents hierarchy' });
    expect(tree).toBeInTheDocument();
    // субагенты видны в дереве
    expect(within(tree).getByText('OpenCode')).toBeInTheDocument();
    expect(within(tree).getByText('forge-r')).toBeInTheDocument();
  });

  it('shows machines footer from fixture spaces', () => {
    render(<NewfLuxScreen />);
    expect(screen.getByText(/machines:/)).toHaveTextContent(/remote-host/);
    expect(screen.getByText(/roy2/)).toBeInTheDocument();
  });

  it('shows events panel in core-only note without live bridge', () => {
    render(<NewfLuxScreen />);
    expect(screen.getByRole('region', { name: 'Event stream' })).toBeInTheDocument();
    expect(screen.getByText(/events: core-only/)).toBeInTheDocument();
  });

  it('selecting a seat focuses its agent', async () => {
    const user = userEvent.setup();
    render(<NewfLuxScreen />);
    const strip = screen.getByRole('list', { name: 'Agent seats' });
    const forge = within(strip).getByText('ROLE-2').closest('button');
    expect(forge).not.toBeNull();
    await user.click(forge!);
    expect(forge).toHaveAttribute('data-seat', 'coder-1');
  });
});
