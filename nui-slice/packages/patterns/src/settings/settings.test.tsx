import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agents, apiKeys, metrics, plugins, presets, webhookDeliveries, webhooks } from '@nexus/mock-data';
import { SystemOverview } from './system-overview';
import { ToolsPanel } from './tools-panel';
import { IntegrationsPanel } from './integrations-panel';
import { SecurityPanel } from './security-panel';
import { CapabilitiesPanel } from './capabilities-panel';
import { PresetPanel } from './preset-panel';
import { AgentRegistryPanel } from './agent-registry-panel';

afterEach(cleanup);

describe('SystemOverview', () => {
  it('renders meters with honest null — gpu shows dash, not 0', () => {
    render(<SystemOverview metrics={metrics.healthy} />);
    expect(screen.getByTestId('system-overview').dataset.freshness).toBe('live');
    expect(screen.getByTestId('meter-GPU').textContent).toContain('—');
    expect(screen.getByTestId('meter-GPU').textContent).not.toContain('0.0%');
    expect(screen.getByTestId('meter-CPU').textContent).toContain('23.4%');
  });

  it('health rows show server detail verbatim (degraded)', () => {
    render(<SystemOverview metrics={metrics.degraded} />);
    expect(screen.getByText('очередь индексации 1.2k записей')).toBeTruthy();
    expect(screen.getByText('3 доставки упали подряд')).toBeTruthy();
    expect(screen.getByTestId('system-overview').dataset.freshness).toBe('stale');
  });
});

describe('ToolsPanel', () => {
  it('renders plugins with signed/secret facts', () => {
    render(<ToolsPanel plugins={plugins} />);
    expect(screen.getByText('screen-tool')).toBeTruthy();
    expect(screen.getAllByText('unsigned').length).toBe(1);
    expect(screen.getAllByText('secret').length).toBe(2);
  });

  it('pending row shows in-flight state, never looks saved', () => {
    render(<ToolsPanel plugins={plugins} pending={new Set(['echo'])} />);
    const row = screen.getByText('echo').closest('li')!;
    expect(row.dataset.busy).toBe('true');
    const btn = screen.getByLabelText(/echo/);
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(row.textContent).toContain('…');
  });

  it('failed write surfaces error inline', () => {
    render(
      <ToolsPanel plugins={plugins} errors={{ 'sandbox-browser': 'write rejected: unsigned plugin' }} />,
    );
    const row = screen.getByText('sandbox-browser').closest('li')!;
    expect(row.querySelector('[role="alert"]')!.textContent).toContain('write rejected');
    // state remains server truth — unsigned plugin still OFF
    expect(row.textContent).toContain('OFF');
  });

  it('toggle emits callback — pattern never writes itself', () => {
    const onToggle = vi.fn();
    render(<ToolsPanel plugins={plugins} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText('Включить sandbox-browser'));
    expect(onToggle).toHaveBeenCalledWith('sandbox-browser', true);
  });
});

describe('IntegrationsPanel', () => {
  it('renders webhooks and deliveries incl. failed with lastError', () => {
    render(<IntegrationsPanel webhooks={webhooks} deliveries={webhookDeliveries} />);
    expect(screen.getByText('wh-01')).toBeTruthy();
    expect(screen.getByText(/TLS handshake timeout/)).toBeTruthy();
    expect(screen.getByText(/попыток 5 · HTTP 503/)).toBeTruthy();
  });

  it('webhook toggle emits callback with next state', () => {
    const onToggle = vi.fn();
    render(<IntegrationsPanel webhooks={webhooks} deliveries={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText('Включить wh-03'));
    expect(onToggle).toHaveBeenCalledWith('wh-03', true);
  });

  it('create emits structured input (SC-SET-3); form clears on success', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<IntegrationsPanel webhooks={webhooks} deliveries={[]} onCreate={onCreate} />);
    fireEvent.change(screen.getByLabelText('URL вебхука'), { target: { value: 'https://ok.example/hook' } });
    fireEvent.click(screen.getByLabelText('run.completed'));
    fireEvent.click(screen.getByRole('button', { name: 'Создать вебхук' }));
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledWith({
      url: 'https://ok.example/hook', events: ['run.completed'],
    }));
    await vi.waitFor(() =>
      expect((screen.getByLabelText('URL вебхука') as HTMLInputElement).value).toBe(''));
  });

  it('invalid URL is rejected client-side — no write, field error', async () => {
    const onCreate = vi.fn();
    render(<IntegrationsPanel webhooks={webhooks} deliveries={[]} onCreate={onCreate} />);
    fireEvent.change(screen.getByLabelText('URL вебхука'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByLabelText('run.failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Создать вебхук' }));
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('http'));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('adapter reject keeps input and shows error (SC-SET-3 4xx)', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('422'));
    render(<IntegrationsPanel webhooks={webhooks} deliveries={[]} onCreate={onCreate} />);
    fireEvent.change(screen.getByLabelText('URL вебхука'), { target: { value: 'https://old.invalid/x' } });
    fireEvent.click(screen.getByLabelText('run.completed'));
    fireEvent.click(screen.getByRole('button', { name: 'Создать вебхук' }));
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('отклонено'));
    expect((screen.getByLabelText('URL вебхука') as HTMLInputElement).value).toBe('https://old.invalid/x');
  });

  it('empty state still offers create when onCreate is wired', () => {
    render(<IntegrationsPanel webhooks={[]} deliveries={[]} state="empty" onCreate={vi.fn()} />);
    expect(screen.getByText('Вебхуков нет.')).toBeTruthy();
    expect(screen.getByLabelText('URL вебхука')).toBeTruthy();
  });

  it('create rejects credentialed/non-http URLs before the adapter sees them', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<IntegrationsPanel webhooks={webhooks} deliveries={[]} onCreate={onCreate} />);
    fireEvent.change(screen.getByLabelText('URL вебхука'), {
      target: { value: 'https://user:pass@evil.example/hook' },
    });
    fireEvent.click(screen.getByLabelText('run.completed'));
    fireEvent.click(screen.getByText('Создать вебхук'));
    await screen.findByRole('alert');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('create keeps the input on adapter reject (SC-SET-3)', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('409 duplicate'));
    render(<IntegrationsPanel webhooks={webhooks} deliveries={[]} onCreate={onCreate} />);
    const url = screen.getByLabelText('URL вебхука');
    fireEvent.change(url, { target: { value: 'https://ok.example/hook' } });
    fireEvent.click(screen.getByLabelText('run.completed'));
    fireEvent.click(screen.getByText('Создать вебхук'));
    await screen.findByRole('alert');
    expect(onCreate).toHaveBeenCalledWith({
      url: 'https://ok.example/hook',
      events: ['run.completed'],
    });
    // input preserved so the user fixes, not retypes
    expect((url as HTMLInputElement).value).toBe('https://ok.example/hook');
  });
});

describe('SecurityPanel', () => {
  it('renders prefix only — full secret is never listed', () => {
    render(<SecurityPanel keys={apiKeys} />);
    expect(screen.getByText('ai2_k_nxu…')).toBeTruthy();
    // no key material anywhere — fixture has none, panel must not invent it
    expect(screen.queryByText(/ai2_k_[a-z0-9]{20,}/i)).toBeNull();
  });

  it('status vocab verbatim: active / revoked / expired', () => {
    render(<SecurityPanel keys={apiKeys} />);
    expect(screen.getAllByText('АКТИВЕН').length).toBe(2);
    expect(screen.getByText('ОТОЗВАН')).toBeTruthy();
    expect(screen.getByText('ИСТЁК')).toBeTruthy();
  });

  it('revoke is a callback; revoked/expired keys offer no action', () => {
    const onRevoke = vi.fn();
    render(<SecurityPanel keys={apiKeys} onRevoke={onRevoke} />);
    const revokeButtons = screen.getAllByText('Отозвать');
    expect(revokeButtons.length).toBe(2); // only the two active keys
    fireEvent.click(revokeButtons[0]);
    expect(onRevoke).toHaveBeenCalledWith('key-01');
  });

  it('create emits structured input; secret shown once via prop', () => {
    const onCreate = vi.fn();
    render(
      <SecurityPanel
        keys={apiKeys}
        onCreate={onCreate}
        createdSecret={{ name: 'nexus-ui', secret: 'ai2_k_secret_once' }}
      />,
    );
    expect(screen.getByTestId('created-secret').textContent).toContain('ai2_k_secret_once');
    fireEvent.change(screen.getByLabelText('Имя ключа'), { target: { value: 'ci-bot' } });
    fireEvent.change(screen.getByLabelText('Области ключа'), { target: { value: 'runs:read, memory:read' } });
    fireEvent.click(screen.getByText('Создать ключ'));
    expect(onCreate).toHaveBeenCalledWith({ name: 'ci-bot', scopes: ['runs:read', 'memory:read'] });
  });
});

describe('CapabilitiesPanel', () => {
  it('renders the composed view with per-source labels', () => {
    render(
      <CapabilitiesPanel
        health={metrics.healthy.health}
        agents={agents}
        plugins={plugins}
      />,
    );
    const el = screen.getByTestId('capabilities-panel');
    expect(el.dataset.state).toBe('ready');
    expect(screen.getByText('/v1/health')).toBeTruthy();
    expect(screen.getByText('реестр')).toBeTruthy();
    expect(screen.getByText('/v1/plugins')).toBeTruthy();
    // agent capabilities verbatim from the registry spec
    expect(screen.getByText('spawn_agent')).toBeTruthy();
    expect(screen.getByText('forge')).toBeTruthy();
  });

  it('each source keeps its own state — a null list shows loading, never a guess', () => {
    render(<CapabilitiesPanel health={null} agents={agents} plugins={[]} />);
    expect(screen.getByText('Загрузка…')).toBeTruthy();
    expect(screen.getByText('Плагинов нет.')).toBeTruthy();
    expect(screen.getByText('spawn_agent')).toBeTruthy();
  });

  it('agent without capabilities says so — no fabricated list', () => {
    render(
      <CapabilitiesPanel
        health={[]}
        agents={[{ name: 'ghost', description: null, config: null, capabilities: [], maxCostUsd: null }]}
        plugins={plugins}
      />,
    );
    expect(screen.getByText('без заявленных возможностей')).toBeTruthy();
    expect(screen.getByText('Компоненты не сообщаются.')).toBeTruthy();
  });
});

describe('PresetPanel', () => {
  it('renders flags read-only; server default tagged separately from local pick', () => {
    const onPick = vi.fn();
    render(<PresetPanel presets={presets} selectedName="deep" onPick={onPick} />);
    const baseline = screen.getByText('baseline').closest('button')!;
    expect(baseline.dataset.selected).toBe('false');
    expect(baseline.textContent).toContain('default');
    const deep = screen.getByText('deep').closest('button')!;
    expect(deep.dataset.selected).toBe('true');
    fireEvent.click(baseline);
    expect(onPick).toHaveBeenCalledWith('baseline');
  });

  it('null description renders honest dash', () => {
    render(<PresetPanel presets={presets} />);
    expect(screen.getByText('custom-x').closest('button')!.textContent).toContain('—');
  });
});

describe('AgentRegistryPanel', () => {
  it('renders registry facts verbatim — config, caps, cost cap', () => {
    render(<AgentRegistryPanel agents={agents} />);
    expect(screen.getByText('forge')).toBeTruthy();
    expect(screen.getByText('spawn_agent')).toBeTruthy();
    expect(screen.getByText('$2.00')).toBeTruthy();
    expect(screen.getByText('deep')).toBeTruthy();
  });

  it('null fields render — / без лимита, never fabricated', () => {
    render(
      <AgentRegistryPanel
        agents={[{ name: 'ghost', description: null, config: null, capabilities: [], maxCostUsd: null }]}
      />,
    );
    const row = screen.getByText('ghost').closest('li')!;
    expect(row.textContent).toContain('без лимита');
    expect(row.textContent).toContain('—');
  });
});
