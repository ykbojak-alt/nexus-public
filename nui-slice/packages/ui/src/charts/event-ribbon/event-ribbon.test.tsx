import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EventRibbon, mapRunEvents, type RibbonEvent } from './event-ribbon';
import { RibbonList } from './ribbon-list';

afterEach(cleanup);

const EVENTS: RibbonEvent[] = [
  { id: 'a', ts: 1000, lane: 'planner', label: 'plan.step #1', tone: 'primary' },
  { id: 'b', ts: 2000, lane: 'executor', label: 'tool_call memory.search', tone: 'energy' },
  { id: 'c', ts: 3000, lane: 'critic', label: 'model_call critic-1', tone: 'violet' },
];

const a11y = { title: 'Лента событий прогона' };

describe('EventRibbon (Runtime pack, plan 2026-10-13 §W4)', () => {
  it('renders lanes and point markers with semantic tones', () => {
    render(<EventRibbon events={EVENTS} a11y={a11y} />);
    expect(screen.getByTestId('event-ribbon')).toHaveAttribute('data-state', 'ready');
    const svg = screen.getByRole('img', { name: a11y.title });
    expect(svg.querySelector('[data-event="a"]')!.getAttribute('fill')).toBe('var(--nexus-accent-primary)');
    expect(svg.querySelector('[data-event="b"]')!.getAttribute('fill')).toBe('var(--nexus-accent-energy)');
    expect(svg.querySelectorAll('circle[data-event]')).toHaveLength(3);
  });

  it('keeps lane order by first appearance — deterministic, unsorted', () => {
    render(<EventRibbon events={EVENTS} a11y={a11y} />);
    const laneLabels = [...document.querySelectorAll('text')].map((t) => t.textContent).filter((t) => ['planner', 'executor', 'critic'].includes(t!));
    expect(laneLabels).toEqual(['planner', 'executor', 'critic']);
  });

  it('drops malformed timestamps; all-bad input reports insufficient', () => {
    const good = render(<EventRibbon events={[...EVENTS, { id: 'bad', ts: Number.NaN, lane: 'x', label: 'bad' }]} a11y={a11y} />);
    expect(document.querySelectorAll('circle[data-event]')).toHaveLength(3);
    good.unmount();
    render(<EventRibbon events={[{ id: 'bad', ts: Number.NaN, lane: 'x', label: 'bad' }]} a11y={a11y} />);
    expect(screen.getByTestId('event-ribbon')).toHaveAttribute('data-state', 'insufficient');
  });

  it('mapRunEvents maps run-event vocab to tones honestly', () => {
    const mapped = mapRunEvents([
      { seq: 1, type: 'run.start', role: null, ts: 0 },
      { seq: 2, type: 'spawn', role: 'executor', ts: 5, body: { agent: 'codex' } },
      { seq: 3, type: 'final', role: 'arbiter', ts: 9, body: { stop_reason: 'done' } },
      { seq: 4, type: 'final', role: 'arbiter', ts: 10, body: { stop_reason: 'timeout' } },
      { seq: 5, type: 'mystery_type', role: 'x', ts: 11 },
    ]);
    expect(mapped[1].tone).toBe('threshold');   // handoff boundary
    expect(mapped[2].tone).toBe('positive');    // done
    expect(mapped[3].tone).toBe('negative');    // timeout ≠ done
    expect(mapped[4].tone).toBe('neutral');     // unknown type — never hidden
    expect(mapped[4].lane).toBe('x');
  });

  it('marks every control-boundary vocab threshold, failures negative', () => {
    const boundary = mapRunEvents(
      ['handoff', 'approval', 'checkpoint', 'pause', 'resume'].map((type, i) => ({ seq: i, type, role: 'r', ts: i })),
    );
    expect(boundary.every((e) => e.tone === 'threshold')).toBe(true);
    const failed = mapRunEvents(
      ['error', 'timeout', 'cancelled', 'tool_failed'].map((type, i) => ({ seq: i, type, role: 'r', ts: i })),
    );
    expect(failed.every((e) => e.tone === 'negative')).toBe(true);
  });
});

describe('RibbonList — DOM alternative (runbook W4-01)', () => {
  it('renders every event time-ordered with lane/label/tone as text', () => {
    const reversed = [...EVENTS].reverse();
    render(<RibbonList events={reversed} />);
    const items = document.querySelectorAll('[data-ribbon-list] li[data-event]');
    expect(items).toHaveLength(3);
    expect(items[0].getAttribute('data-event')).toBe('a'); // time-asc, not input order
    expect(items[0].getAttribute('data-tone')).toBe('primary');
    expect(items[1].textContent).toContain('executor');
    expect(items[1].textContent).toContain('tool_call memory.search');
  });

  it('drops malformed timestamps instead of fabricating a slot', () => {
    render(<RibbonList events={[...EVENTS, { id: 'bad', ts: Number.NaN, lane: 'x', label: 'bad' }]} />);
    expect(document.querySelectorAll('[data-ribbon-list] li[data-event]')).toHaveLength(3);
  });

  it('limit caps the DOM with an honest "+N more" marker (W4-07)', () => {
    render(<RibbonList events={EVENTS} limit={2} />);
    expect(document.querySelectorAll('[data-ribbon-list] li[data-event]')).toHaveLength(2);
    expect(screen.getByText('+1 more events')).toBeInTheDocument();
  });

  it('lanes filter shows only selected lanes — audit item 5 feed UX', () => {
    render(<RibbonList events={EVENTS} lanes={['planner', 'critic']} />);
    const items = document.querySelectorAll('[data-ribbon-list] li[data-event]');
    expect(items).toHaveLength(2);
    expect([...items].map((i) => i.getAttribute('data-lane'))).toEqual(['planner', 'critic']);
  });
});
