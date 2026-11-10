import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentHandoffs, agentPresence, agents } from '@nexus/mock-data';
import { AgentRoster } from './agent-roster';
import { AgentInspector } from './agent-inspector';
import { AgentPresence } from './agent-presence';
import { AgentHandoff } from './agent-handoff';
import type { AgentRosterItem } from './agent-types';

afterEach(cleanup);

const items: AgentRosterItem[] = agents.map((a, i) => ({
  ...a,
  status: (['active', 'idle', 'blocked', 'offline', 'active'] as const)[i],
  activeTask: i === 0 ? 'Текущая задача' : null,
}));

describe('AgentRoster', () => {
  it('emits selection callback instead of fetching (plan §C-14 acceptance)', () => {
    const onSelect = vi.fn();
    render(<AgentRoster items={items} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('option', { name: /forge/ }));
    expect(onSelect).toHaveBeenCalledWith('forge');
  });

  it('marks the selected spec via aria-selected', () => {
    render(<AgentRoster items={items} selectedName="codex" onSelect={() => { }} />);
    expect(screen.getByRole('option', { name: /codex/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('translates known runtime presence states to Russian labels', () => {
    render(<AgentRoster items={items} onSelect={() => { }} />);
    expect(screen.getByRole('option', { name: /forge.*активен/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /alice.*свободен/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /mech.*заблокирован/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /codex.*не в сети/ })).toBeTruthy();
    expect(screen.queryByText('ACTIVE')).toBeNull();
    expect(screen.queryByText('BLOCKED')).toBeNull();
  });

  it('keeps option→listbox hierarchy unbroken in the AT tree (NQ-026)', () => {
    render(<AgentRoster items={items} onSelect={() => { }} />);
    // li wrappers must be presentation-only — otherwise option's required
    // parent (listbox) is interrupted and bare listitem roles orphan.
    for (const li of document.querySelectorAll('ul[role="listbox"] > li')) {
      expect(li.getAttribute('role')).toBe('none');
    }
  });

  it('renders all non-ready states with data-state', () => {
    for (const state of ['loading', 'empty', 'error', 'stale'] as const) {
      const { unmount } = render(<AgentRoster items={state === 'stale' ? items : []} state={state} />);
      expect(screen.getByTestId('agent-roster').dataset.state).toBe(state);
      unmount();
    }
  });

  it('arrow keys move focus between options; Home/End jump to the edges (listbox contract)', () => {
    render(<AgentRoster items={items} onSelect={() => { }} />);
    const listbox = screen.getByRole('listbox');
    const options = screen.getAllByRole('option');

    options[0].focus();
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(options[options.length - 1]);
    fireEvent.keyDown(listbox, { key: 'Home' });
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(listbox, { key: 'End' });
    expect(document.activeElement).toBe(options[options.length - 1]);
  });

  it('Enter on a focused option selects it — keyboard path equals click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AgentRoster items={items} onSelect={onSelect} />);
    const listbox = screen.getByRole('listbox');
    const options = screen.getAllByRole('option');
    options[0].focus();
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(items[1].name);
  });
});

describe('AgentInspector', () => {
  it('shows registry facts: capabilities, preset, cost cap', () => {
    render(<AgentInspector agent={items[0]} />);
    expect(screen.getByText('spawn_agent')).toBeTruthy();
    expect(screen.getByText('deep')).toBeTruthy();
    expect(screen.getByText('$2.00')).toBeTruthy();
  });

  it('empty state when nothing selected', () => {
    render(<AgentInspector agent={null} />);
    expect(screen.getByTestId('agent-inspector').dataset.state).toBe('empty');
  });

  it('renders recent runs with runtime status labels', () => {
    render(
      <AgentInspector
        agent={items[0]}
        runs={[{ runId: 'r1', taskText: 'задача', status: 'timeout', createdAt: 0, costUsd: 0.1 }]}
      />,
    );
    expect(screen.getByText('просрочен')).toBeTruthy();
  });
});

describe('AgentPresence', () => {
  it('shows live processes with server state vocab', () => {
    render(<AgentPresence entries={agentPresence} freshness="live" />);
    expect(screen.getByText('блокирован')).toBeTruthy();
    expect(screen.getByTestId('agent-presence').dataset.freshness).toBe('live');
  });

  it('empty state when nobody is active', () => {
    render(<AgentPresence entries={[]} state="empty" />);
    expect(screen.getByText('Нет активных агентов.')).toBeTruthy();
  });
});

describe('AgentHandoff', () => {
  it('orders the chain by ts and renders operator origin for null from', () => {
    render(<AgentHandoff links={agentHandoffs} />);
    expect(screen.getByText('оператор')).toBeTruthy();
    const agentsCells = screen.getAllByText(/^(forge|codex|alice|оператор)$/);
    expect(agentsCells[0].textContent).toBe('оператор');
  });

  it('empty state when no delegations happened', () => {
    render(<AgentHandoff links={[]} state="empty" />);
    expect(screen.getByTestId('agent-handoff').dataset.state).toBe('empty');
  });
});
