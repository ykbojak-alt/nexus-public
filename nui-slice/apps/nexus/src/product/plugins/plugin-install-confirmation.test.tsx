// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginInstallNotice } from './plugin-install-notifications';

const setEnabled = vi.fn();
const audit = vi.fn();
vi.mock('../data-source', () => ({
  getDataSource: () => ({
    neuPlugins: { setEnabled },
    sdkAudit: audit,
  }),
  useDataSource: () => ({ neuPlugins: { setEnabled }, sdkAudit: audit, }),
}));

import { PluginInstallConfirmation } from './plugin-install-confirmation';
import {
  pendingPluginInstallNoticeCount,
  getPluginInstallNotices,
} from './plugin-install-notifications';
import { syncPluginInstallNoticesFromTrace } from './plugin-install-sync';

afterEach(() => {
  cleanup();
  setEnabled.mockReset();
  audit.mockReset();
});

function notice(overrides: Partial<PluginInstallNotice> = {}): PluginInstallNotice {
  return {
    runId: 'sdk-run-1',
    confirmation: {
      callId: 'call-1',
      tool: 'plugin_manager.install_bundle',
      input: '',
      inputData: {
        source_path: 'D:/incoming/weather',
        inspection: {
          source: 'D:/incoming/weather',
          name: 'weather-plugin',
          version: '1.2.0',
          manifest: { id: 'weather-plugin', permissions: ['sessions.read'] },
          permissions: ['sessions.read'],
          blockedBuildScripts: [{
            package: 'weather-plugin',
            scripts: [{ name: 'postinstall', command: 'echo API_KEY=super-secret' }],
          }],
          sha256: 'sha256:abc',
        },
      },
      state: 'awaiting',
      parentCallId: null,
      requestedAt: 1792345678,
      title: null,
      displayName: null,
      description: null,
      decisionReason: null,
      agentId: null,
    },
    decision: null,
    message: null,
    outcome: null,
    pluginId: null,
    enabledNow: false,
    ...overrides,
  };
}

describe('PluginInstallConfirmation', () => {
  it('renders real inspection facts and masks inline secrets in blocked scripts', () => {
    const { getByTestId } = render(<PluginInstallConfirmation notice={notice()} onDecide={vi.fn()} />);
    const card = getByTestId('plugin-install-confirmation');
    expect(card.textContent).toContain('weather-plugin');
    expect(card.textContent).toContain('D:/incoming/weather');
    expect(card.textContent).toContain('1.2.0');
    expect(card.textContent).toContain('sessions.read');
    expect(card.textContent).toContain('postinstall: echo API_KEY=***');
    expect(screen.queryByText(/super-secret/)).toBeNull();
    expect(screen.getByText(/Скрипты не исполняются хостом/)).toBeTruthy();
  });

  it('exposes allow, deny, defer and calls host decision seam', () => {
    const decide = vi.fn().mockResolvedValue({ resolved: false, state: 'deferred' });
    render(<PluginInstallConfirmation notice={notice()} onDecide={decide} />);
    fireEvent.click(screen.getByRole('button', { name: 'Отложить' }));
    expect(decide).toHaveBeenCalledWith('defer');
  });

  it.each([
    ['deny', 'Отклонено'],
    ['timeout', 'Время истекло'],
    ['installed', 'Установлен, выключен'],
    ['error', 'Ошибка установки'],
  ] as const)('renders outcome %s', (outcome, expected) => {
    const n = notice({
      outcome: outcome === 'installed' || outcome === 'error' ? outcome : null,
      decision: outcome === 'deny' || outcome === 'timeout' ? 'deny' : null,
      message: outcome === 'timeout' ? 'таймаут подтверждения' : null,
      pluginId: outcome === 'installed' ? 'weather-plugin' : null,
    });
    const { getByTestId } = render(<PluginInstallConfirmation notice={n} />);
    expect(getByTestId('plugin-install-confirmation').textContent).toContain(expected);
  });

  it('enables only after successful installation and uses the host toggle seam', async () => {
    setEnabled.mockResolvedValue({ id: 'weather-plugin', enabled: true, status: 'active' });
    render(<PluginInstallConfirmation notice={notice({
      outcome: 'installed',
      pluginId: 'weather-plugin',
      decision: 'allow',
    })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Включить сейчас' }));
    expect(await screen.findByText('Включён')).toBeTruthy();
    expect(setEnabled).toHaveBeenCalledWith('weather-plugin', true);
  });
});

describe('plugin install notification aggregation', () => {
  it('keeps only plugin install confirmations and counts awaiting notices', () => {
    syncPluginInstallNoticesFromTrace('sdk-run-2', [
      {
        seq: 1,
        type: 'confirmation_requested',
        role: null,
        ts: 1792345678,
        body: {
          callId: 'install-1',
          tool: 'plugin_manager.install_bundle',
          input: { inspection: { name: 'plugin-a', permissions: ['sessions.read'] } },
          state: 'awaiting',
        },
      },
      {
        seq: 2,
        type: 'confirmation_requested',
        role: null,
        ts: 1792345679,
        body: { callId: 'other-1', tool: 'Bash', input: { command: 'ls' }, state: 'awaiting' },
      },
    ]);
    const rows = getPluginInstallNotices().filter((n) => n.runId === 'sdk-run-2');
    expect(rows).toHaveLength(1);
    expect(rows[0].confirmation.callId).toBe('install-1');
    expect(pendingPluginInstallNoticeCount(rows)).toBe(1);
  });
});
