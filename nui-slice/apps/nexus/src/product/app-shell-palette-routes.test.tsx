// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.hoisted(() => vi.fn());
const prefetch = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  usePathname: () => '/runtime',
  useRouter: () => ({ push, replace: vi.fn(), prefetch }),
  useSearchParams: () => new URLSearchParams(''),
}));

import { AppShell } from './app-shell';
import './palette-lazy';

afterEach(() => {
  cleanup();
  push.mockReset();
  prefetch.mockReset();
  window.localStorage.clear();
});

async function openPalette() {
  fireEvent.keyDown(document, { key: '0', altKey: true });
  return screen.findByRole('dialog', { name: 'Command palette' });
}

describe('AppShell secondary route palette items', () => {
  it('finds and opens each secondary route under «Ещё»', async () => {
    render(<AppShell>x</AppShell>);

    for (const route of [
      { query: 'FORGE', label: 'FORGE', href: '/forge', hint: 'Ещё' },
      // /models is a leaf of «Память» (Intelligence sub-screen), so the palette
      // hint shows the owning section instead of the secondary «Ещё» bucket.
      { query: 'Модели', label: 'Модели', href: '/models', hint: 'Память' },
      { query: 'Медиаплеер', label: 'Медиаплеер', href: '/media', hint: 'Ещё' },
      { query: 'NOIR', label: 'NOIR', href: '/noir', hint: 'Ещё' },
    ]) {
      const dialog = await openPalette();
      const input = within(dialog).getByRole('combobox');
      fireEvent.change(input, { target: { value: route.query } });
      const option = await within(dialog).findByRole('option', {
        name: new RegExp(`${route.label}.*${route.hint}`, 'i'),
      });
      fireEvent.mouseDown(option);
      expect(push).toHaveBeenLastCalledWith(route.href);
    }
  });
});

describe('AppShell palette programs (UI-2)', () => {
  it('jumps to a program with a real href from the manifest', async () => {
    render(<AppShell>x</AppShell>);
    const dialog = await openPalette();
    const input = within(dialog).getByRole('combobox');
    fireEvent.change(input, { target: { value: 'NEXUS Bus' } });
    const option = await within(dialog).findByRole('option', { name: /NEXUS Bus.*программа/i });
    fireEvent.mouseDown(option);
    expect(push).toHaveBeenLastCalledWith('/bus-desktop');
  });
});

describe('AppShell palette fuzzy filter (UI-2)', () => {
  it('matches words in any order (per-word substring)', async () => {
    render(<AppShell>x</AppShell>);
    const dialog = await openPalette();
    const input = within(dialog).getByRole('combobox');
    // «Агенты и сессии» (раздел Диалоги) — слова в любом порядке.
    fireEvent.change(input, { target: { value: 'сессии агенты' } });
    const option = await within(dialog).findByRole('option', { name: /Агенты и сессии/i });
    expect(option).toBeTruthy();
  });

  it('hides items that do not match all words', async () => {
    render(<AppShell>x</AppShell>);
    const dialog = await openPalette();
    const input = within(dialog).getByRole('combobox');
    fireEvent.change(input, { target: { value: 'фордж несуществующий' } });
    const empty = await within(dialog).findByText('No results');
    expect(empty).toBeTruthy();
  });
});

describe('AppShell palette recent items (UI-2)', () => {
  it('shows recent runs/agents at top after selecting them', async () => {
    render(<AppShell>x</AppShell>);

    // Открываем, выбираем «NEXUS Bus» (идёт в recent).
    const dialog1 = await openPalette();
    const input1 = within(dialog1).getByRole('combobox');
    fireEvent.change(input1, { target: { value: 'NEXUS Bus' } });
    const bus = await within(dialog1).findByRole('option', { name: /NEXUS Bus.*программа/i });
    fireEvent.mouseDown(bus);
    expect(push).toHaveBeenLastCalledWith('/bus-desktop');

    // Повторное открытие — recent-пункт есть сверху и исполняется.
    const dialog2 = await openPalette();
    const recent = await within(dialog2).findByRole('option', { name: /NEXUS Bus/ });
    expect(recent).toBeTruthy();
    fireEvent.mouseDown(recent);
    expect(push).toHaveBeenLastCalledWith('/bus-desktop');
  });

  it('persists recent items across remounts via localStorage', async () => {
    const first = render(<AppShell>x</AppShell>);
    const dialog1 = await openPalette();
    const input1 = within(dialog1).getByRole('combobox');
    fireEvent.change(input1, { target: { value: 'NEXUS Bus' } });
    const bus = await within(dialog1).findByRole('option', { name: /NEXUS Bus.*программа/i });
    fireEvent.mouseDown(bus);
    first.unmount();

    const stored = JSON.parse(window.localStorage.getItem('nexus.palette.recent') ?? '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('program:bus');

    render(<AppShell>x</AppShell>);
    const dialog2 = await openPalette();
    const recent = await within(dialog2).findByRole('option', { name: /NEXUS Bus/ });
    expect(recent).toBeTruthy();
  });
});

describe('AppShell shortcuts help overlay (UI-2)', () => {
  it('opens on «?» and lists bindings', async () => {
    render(<AppShell>x</AppShell>);
    fireEvent.keyDown(document, { key: '?', shiftKey: true });
    const overlay = await screen.findByRole('dialog', { name: 'Горячие клавиши' });
    const rows = within(overlay).getAllByText('Открыть командную палитру');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(within(overlay).getAllByText('Ctrl/Cmd+K').length).toBeGreaterThanOrEqual(1);
  });

  it('closes on Escape', async () => {
    render(<AppShell>x</AppShell>);
    fireEvent.keyDown(document, { key: '?', shiftKey: true });
    const overlay = await screen.findByRole('dialog', { name: 'Горячие клавиши' });
    expect(overlay).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Горячие клавиши' })).toBeNull();
  });
});
