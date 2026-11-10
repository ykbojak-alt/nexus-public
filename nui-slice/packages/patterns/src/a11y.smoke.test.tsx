/**
 * Accessibility smoke for patterns (Window 5): jest-axe pass over the dense
 * composite patterns — CapabilitiesPanel (3-section lists + badges) and
 * RunDetailPanel (facts dl + event log). jsdom catches ARIA/role/name;
 * browser-level checks stay in e2e/visual/a11y.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';
import { runDetails, runStates, agents, metrics, plugins } from '@nexus/mock-data';

const health = metrics.healthy.health;
import { CapabilitiesPanel } from './settings/capabilities-panel';
import { RunDetailPanel } from './runs/run-detail';
import { AgentRoster } from './agents/agent-roster';

describe('patterns a11y smoke (jest-axe / jsdom)', () => {
  it('CapabilitiesPanel — populated sections', async () => {
    const { container } = render(<CapabilitiesPanel health={health} agents={agents} plugins={plugins} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('RunDetailPanel — done run with event log', async () => {
    const { container } = render(
      <RunDetailPanel
        detail={{ run: runStates.done, result: runDetails['run-1039'].result, events: runDetails['run-1039'].events }}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('AgentRoster — NQ-026 semantics guard', async () => {
    const { container } = render(<AgentRoster items={agents} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
