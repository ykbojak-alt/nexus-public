import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// jest-dom + cleanup live in this file until Window 5's shared harness
// (test/setup.ts) lands; then the import moves there.
afterEach(cleanup);
import { NexusThemeProvider } from './nexus-theme-provider';
import { GlassPanel } from '../surfaces/glass-panel/glass-panel';
import { NexusShell } from '../layout/nexus-shell';
import { ReferenceFrame } from '../dev/reference-frame/reference-frame';
import userEvent from '@testing-library/user-event';
import { Button } from '../actions/button/button';
import { StatusBadge } from '../feedback/status-badge/status-badge';

describe('NexusThemeProvider (Task 8 contract)', () => {
  it('applies semantic theme attributes without changing component markup', () => {
    render(
      <NexusThemeProvider theme="mech">
        <GlassPanel data-testid="p" />
      </NexusThemeProvider>,
    );
    expect(screen.getByTestId('p').closest('[data-theme]')).toHaveAttribute('data-theme', 'mech');
  });

  it('falls back to nexus for unknown theme ids', () => {
    render(<NexusThemeProvider theme="does-not-exist"><span /></NexusThemeProvider>);
    expect(document.querySelector('[data-theme]')).toHaveAttribute('data-theme', 'nexus');
  });

  it('W2-129: mirrors theme and density onto documentElement for the canvas layer', () => {
    const { unmount } = render(
      <NexusThemeProvider theme="alice" density="dense"><span /></NexusThemeProvider>,
    );
    expect(document.documentElement).toHaveAttribute('data-theme', 'alice');
    expect(document.documentElement).toHaveAttribute('data-density', 'dense');
    expect(document.documentElement.style.colorScheme).toBe('light');
    unmount();
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(document.documentElement).not.toHaveAttribute('data-density');
    expect(document.documentElement.style.colorScheme).toBe('');
  });

  it('updates the document color-scheme when the theme changes', () => {
    const { rerender } = render(<NexusThemeProvider theme="nexus"><span /></NexusThemeProvider>);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    rerender(<NexusThemeProvider theme="alice"><span /></NexusThemeProvider>);
    expect(document.documentElement.style.colorScheme).toBe('light');
    rerender(<NexusThemeProvider theme="aurum-dark"><span /></NexusThemeProvider>);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('keeps a visible focus-visible state on buttons', async () => {
    const user = userEvent.setup();
    render(<Button>Run</Button>);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Run' })).toHaveFocus();
  });

  it('renders canonical status vocabulary on StatusBadge', () => {
    render(<StatusBadge status="executing" />);
    expect(screen.getByTestId('status-badge')).toHaveAttribute('data-status', 'executing');
    expect(screen.getByText('EXECUTING')).toBeInTheDocument();
  });
});

describe('layout / reference frame (Task 9 contract)', () => {
  it('uses the canonical reference viewport', () => {
    render(<ReferenceFrame mode="live"><div /></ReferenceFrame>);
    expect(screen.getByTestId('reference-frame')).toHaveStyle({ width: '1920px', height: '1080px' });
  });

  it.each(['calm', 'standard', 'dense'] as const)('applies %s density', (density) => {
    render(<NexusShell density={density}>x</NexusShell>);
    expect(screen.getByTestId('nexus-shell')).toHaveAttribute('data-density', density);
  });
});
