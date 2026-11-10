// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NesScreen } from './screen';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ roms: [] }) })));
});

describe('NesScreen — catalog removed', () => {
  it('does not render external ROM catalog', async () => {
    render(<NesScreen />);
    await waitFor(() => expect(document.querySelector('canvas')).toBeTruthy());
    expect(screen.queryByRole('heading', { name: /Каталог ROM/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Встроенные/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Внешние \(/)).not.toBeInTheDocument();
  });

  it('keeps game stage and management panel', async () => {
    render(<NesScreen />);
    await waitFor(() => expect(document.querySelector('canvas')).toBeTruthy());
    expect(document.querySelector('canvas')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Управление' })).toBeInTheDocument();
  });
});
