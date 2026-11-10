import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfidenceMeter } from './ai/confidence-meter/confidence-meter';
import { EvidenceStrength } from './ai/evidence-strength/evidence-strength';
import { AgentAvatar } from './ai/agent-avatar/agent-avatar';
import { AgentStatus } from './ai/agent-status/agent-status';
import { AgentCard } from './ai/agent-card/agent-card';
import { AgentSelector } from './ai/agent-selector/agent-selector';
import { AgentHandoff } from './ai/agent-handoff/agent-handoff';
import { AgentPresence } from './ai/agent-presence/agent-presence';
import { RuntimeStatus } from './ai/runtime-status/runtime-status';
import { ModelBadge } from './ai/model-badge/model-badge';
import { IntegrationBadge } from './ai/integration-badge/integration-badge';
import { MemoryState } from './ai/memory-state/memory-state';
import { MetricCard } from './metrics/metric-card/metric-card';
import { MetricRing } from './metrics/metric-ring/metric-ring';
import { ResourceBar } from './metrics/resource-bar/resource-bar';
import { Sparkline } from './metrics/sparkline/sparkline';

afterEach(cleanup);

const AGENTS = [
  { id: 'forge', name: 'AGENT-B' },
  { id: 'alice', name: 'AGENT-A' },
  { id: 'arch', name: 'A.R.C.H.' },
];

describe('Task 11 AI components — semantic contracts', () => {
  it('does not convert categorical confidence into a fake percentage', () => {
    render(<ConfidenceMeter value={{ kind: 'category', value: 'high' }} />);
    expect(screen.getByTestId('confidence-meter')).toHaveAttribute('aria-label', 'Confidence: high');
    expect(document.body.textContent).not.toMatch(/\d+%/);
  });

  it('percent confidence renders an honest meter', () => {
    render(<ConfidenceMeter value={{ kind: 'percent', value: 73 }} />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '73');
    expect(document.body.textContent).toContain('73%');
  });

  it('AgentSelector is a listbox and reports selection by agent id', () => {
    const onChange = vi.fn();
    render(<AgentSelector agents={AGENTS} value="forge" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select agent' }));
    fireEvent.click(screen.getByRole('option', { name: 'A.R.C.H.' }));
    expect(onChange).toHaveBeenCalledWith('arch');
  });

  it('AgentPresence exposes agents as a labelled list', () => {
    render(<AgentPresence agents={[
      { agent: AGENTS[0], status: 'online' },
      { agent: AGENTS[1], status: 'busy' },
    ]} />);
    expect(screen.getByRole('list', { name: 'Active agents' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'AGENT-B — online' })).toBeInTheDocument();
  });

  it('AgentCard keeps persona description separate from role note', () => {
    render(<AgentCard
      agent={{ id: 'arch', name: 'A.R.C.H.', description: 'Архивариус', roleNote: 'Персона ≠ роль рантайма' }}
      status="online" capabilities={['memory.write', 'audit']} />);
    const card = screen.getByText('A.R.C.H.').closest('[data-testid]');
    expect(screen.getByText('Архивариус')).toBeInTheDocument();
    expect(screen.getByText('Персона ≠ роль рантайма')).toBeInTheDocument();
    expect(screen.getByText('memory.write')).toBeInTheDocument();
  });

  it('AgentCard states: loading skeleton / error retry / stale marker', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<AgentCard agent={{ id: 'arch', name: 'A.R.C.H.' }} state="loading" />);
    expect(document.querySelector('[data-state="loading"]')).toBeInTheDocument();
    rerender(<AgentCard agent={{ id: 'arch', name: 'A.R.C.H.' }} state="error" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('недоступен');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(onRetry).toHaveBeenCalled();
    rerender(<AgentCard agent={{ id: 'arch', name: 'A.R.C.H.' }} state="stale" />);
    expect(screen.getByTestId('memory-state')).toHaveAttribute('data-freshness', 'stale');
  });

  it('AgentCard hosts a metrics slot for observed runtime data (tok/s, sparkline)', () => {
    render(<AgentCard agent={{ id: 'alice', name: 'AGENT-A' }}
      metrics={<span data-testid="agent-metrics">12 tok/s</span>} />);
    expect(screen.getByText('12 tok/s')).toBeInTheDocument();
  });

  it('MetricCard (StatCard v2): null value is «нет данных», unavailable state surfaces', () => {
    const { rerender } = render(<MetricCard label="Активные задачи" value={null} />);
    expect(screen.getByText('нет данных')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    rerender(<MetricCard label="Задержка" value="240ms" state="unavailable" />);
    expect(screen.getByTestId('metric-card')).toHaveAttribute('data-state', 'unavailable');
    expect(screen.getByText('240ms')).toBeInTheDocument();
  });

  it('Sparkline domain keeps percent metrics honest — no autoscale', () => {
    // domain [0,100]: v=40 → y = 22-(40/100)*20 = 14; autoscale would
    // stretch a flat cpu trail to a fake full swing.
    const { container } = render(<Sparkline data={[40, 50]} domain={[0, 100]} label="cpu" />);
    const line = container.querySelector('polyline');
    expect(line?.getAttribute('points')).toBe('0.0,14.0 96.0,12.0');
  });

  it('RuntimeStatus maps runtime kinds onto the status dictionary', () => {
    render(<RuntimeStatus status="blocked" />);
    expect(screen.getByTestId('status-badge')).toHaveAttribute('data-status', 'warning');
  });

  it('AgentHandoff renders from → to with accessible agent names', () => {
    render(<AgentHandoff from={AGENTS[0]} to={AGENTS[2]} reason="эскалация" />);
    const el = screen.getByTestId('agent-handoff');
    expect(el).toHaveTextContent('эскалация');
    expect(screen.getByRole('img', { name: 'AGENT-B' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'A.R.C.H.' })).toBeInTheDocument();
  });

  it('ResourceBar warns at thresholds and renders null honestly', () => {
    const { rerender } = render(<ResourceBar label="RAM" value={92} />);
    expect(screen.getByRole('meter', { name: 'RAM' })).toHaveAttribute('aria-valuenow', '92');
    rerender(<ResourceBar label="GPU" value={null} />);
    expect(screen.getByRole('meter', { name: 'GPU' })).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('n/a')).toBeInTheDocument();
  });

  it('ResourceBar renders a limit marker when limitAt is supplied', () => {
    render(<ResourceBar label="Budget" value={42} limitAt={80} />);
    const track = screen.getByRole('meter', { name: 'Budget' });
    const tick = track.querySelector('[class*="resBarLimit"]');
    expect(tick).toBeInTheDocument();
    expect(tick).toHaveStyle({ left: '80%' });
  });

  it('MetricRing renders progressbar semantics with center display', () => {
    render(<MetricRing value={61.8} label="RAM" display="61.8" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '61.8');
    expect(screen.getByText('61.8')).toBeInTheDocument();
  });

  it('Sparkline is decorative without a label', () => {
    const { container } = render(<Sparkline data={[1, 4, 2, 8, 3]} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
