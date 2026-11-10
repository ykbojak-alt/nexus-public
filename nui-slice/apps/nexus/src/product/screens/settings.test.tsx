// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(''),
}));

const getMetrics = vi.fn();
const listAgents = vi.fn();
const SETTINGS_DS = { getMetrics, listAgents };
vi.mock('../data-source', () => ({
  getDataSourceKind: () => 'live',
  getDataSource: () => SETTINGS_DS,
  // #418 (wave #418-2): mount-gated hook; same stable seam as getDataSource.
  useDataSource: () => SETTINGS_DS,
}));

vi.mock('../nue-gateway', () => ({
  getAi2ApiKey: () => null,
  setAi2ApiKey: () => {},
}));

import { SettingsScreen } from './settings';
import { loadProfile, saveProfile } from '../profile/profile-store';
import { createEmptyProfile } from '../profile/profile-types';

const METRICS = {
  cpuPct: 12, ramPct: 34, diskPct: 56, gpuPct: null, uptimeS: 3600,
  counters: { modelCalls: 1, toolCalls: 2, tokensIn: 3, tokensOut: 4, costUsd: 0.01 },
  health: [], freshness: null,
};

beforeEach(() => {
  getMetrics.mockResolvedValue(METRICS);
  listAgents.mockResolvedValue([{ name: 'alpha', description: '', config: 'deliberate', capabilities: [] }]);
  window.localStorage.clear();
  saveProfile(createEmptyProfile());
});

describe('SettingsScreen — канон', () => {
  it('screen header h1 + панели с data-state; без seam — честный unavailable', async () => {
    render(<SettingsScreen />);
    expect(screen.getByRole('heading', { level: 1, name: 'Настройки' })).toBeTruthy();
    // h2-порядок: панели — второй уровень
    expect(screen.getByRole('heading', { level: 2, name: 'Профиль' })).toBeTruthy();
    expect(screen.getByTestId('settings-opencode').getAttribute('data-state')).toBe('unavailable');
    expect(screen.getByText(/seam отсутствует/)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('settings-system').getAttribute('data-state')).toBe('ready'));
  });

  it('не показывает панели без работающего data-seam', () => {
    render(<SettingsScreen />);
    for (const testId of [
      'settings-runtime-ops', 'settings-presets', 'settings-models', 'settings-agents',
      'settings-plugins', 'settings-integrations', 'settings-capabilities', 'settings-security',
    ]) {
      expect(screen.queryByTestId(testId), testId).toBeNull();
    }
    expect(screen.queryByText(/Дайджест дня/)).toBeNull();
  });

  it('голосовой seam отсутствует → селект/тоггл disabled с честной причиной', async () => {
    render(<SettingsScreen />);
    const voice = await screen.findByLabelText('Голос AGENT-A');
    expect(voice.hasAttribute('disabled')).toBe(true);
    // Тоггл «Озвучивать ответы» без seam — disabled
    expect(screen.getByRole('button', { name: 'Выключена' }).hasAttribute('disabled')).toBe(true);
    await waitFor(() => expect(screen.getByText(/Голосовой seam не подключён/)).toBeTruthy());
  });

  it('группы выбора — listbox/option/aria-selected; стрелки двигают фокус, Enter выбирает', async () => {
    render(<SettingsScreen />);
    const density = screen.getByRole('listbox', { name: 'Плотность' });
    const opts = within(density).getAllByRole('option');
    expect(opts).toHaveLength(3);
    expect(opts[1].getAttribute('aria-selected')).toBe('true'); // standard — дефолт пустого профиля
    opts[0].focus();
    fireEvent.keyDown(density, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(opts[1]);
    fireEvent.keyDown(density, { key: 'End' });
    expect(document.activeElement).toBe(opts[2]);
    fireEvent.keyDown(density, { key: 'ArrowRight' }); // циклически → первая
    expect(document.activeElement).toBe(opts[0]);
    fireEvent.click(opts[0]);
    await waitFor(() => expect(opts[0].getAttribute('aria-selected')).toBe('true'));
    expect(loadProfile()?.density).toBe('calm');
  });

});
