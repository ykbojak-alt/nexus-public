import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { missions } from '@nexus/mock-data';
import { MissionOverview } from './mission-overview';
import { MissionTimeline } from './mission-timeline';
import { MissionProgress } from './mission-progress';
import { MissionOutputs } from './mission-outputs';
import { stepDurationSec, fmtDurationSec } from './mission-map';

afterEach(cleanup);

describe('MissionOverview', () => {
  it('renders title, state badge (server vocab), and agent ids verbatim', () => {
    render(<MissionOverview mission={missions.active} />);
    expect(screen.getByTestId('mission-overview').dataset.state).toBe('ready');
    expect(screen.getByTestId('mission-overview').dataset.freshness).toBe('live');
    expect(screen.getByText('Карта суб-агентов memory-v5')).toBeTruthy();
    expect(screen.getByText('ИДЁТ')).toBeTruthy(); // active → идёт
    // agentId verbatim — runtime truth, not persona labels
    expect(screen.getByText('forge')).toBeTruthy();
    expect(screen.getByText('codex')).toBeTruthy();
    expect(screen.getByText('alice')).toBeTruthy();
  });

  it('empty state is honest — no fabricated mission', () => {
    render(<MissionOverview mission={null} state="empty" />);
    expect(screen.getByText('Нет активной миссии.')).toBeTruthy();
  });
});

describe('MissionTimeline', () => {
  it('renders steps in order with state labels and agentId', () => {
    render(<MissionTimeline mission={missions.active} />);
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0].dataset.stepState).toBe('done');
    expect(steps[1].dataset.stepState).toBe('active');
    expect(steps[2].dataset.stepState).toBe('pending');
    expect(steps[1].textContent).toContain('codex');
  });

  it('shows duration only when both timestamps exist', () => {
    render(<MissionTimeline mission={missions.active} />);
    const steps = screen.getAllByRole('listitem');
    // s1 done with both ts → 60s → "1 мин"; s2 active, no endedAt → no duration
    expect(steps[0].textContent).toContain('1 мин');
    expect(steps[1].textContent).not.toMatch(/\d+\s*(мин|с|ч)/);
  });

  it('stale state still renders data with data-state marker', () => {
    render(<MissionTimeline mission={missions.done} state="stale" />);
    expect(screen.getByTestId('mission-timeline').dataset.state).toBe('stale');
    expect(screen.getByText('Синтез дайджеста')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('MissionProgress', () => {
  it('reports honest counts — 1/3 done for active mission', () => {
    render(<MissionProgress mission={missions.active} />);
    expect(screen.getByText(/из/).textContent).toContain('1');
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('1 из 3');
  });

  it('failed step counts are visible — failures are not hidden', () => {
    render(<MissionProgress mission={missions.failed} />);
    expect(screen.getByText(/упал 1/)).toBeTruthy();
    expect(screen.getByText(/пропущен 1/)).toBeTruthy();
  });

  it('empty/error states do not invent numbers', () => {
    const { unmount } = render(<MissionProgress mission={null} state="empty" />);
    expect(screen.queryByRole('img')).toBeNull();
    unmount();
    render(<MissionProgress mission={null} state="error" />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('MissionOutputs', () => {
  it('renders kind labels and delegates runId via callback', () => {
    const onOpenRun = vi.fn();
    render(<MissionOutputs mission={missions.done} onOpenRun={onOpenRun} />);
    const btn = screen.getByText('Дайджест за сутки');
    fireEvent.click(btn);
    expect(onOpenRun).toHaveBeenCalledWith('run-1039');
    expect(screen.getByText('отчёт')).toBeTruthy();
  });

  it('empty state is honest for missions without outputs', () => {
    render(<MissionOutputs mission={missions.active} state="empty" />);
    expect(screen.getByText('Выходов пока нет.')).toBeTruthy();
  });
});

describe('mission-map helpers', () => {
  it('stepDurationSec returns null without both timestamps', () => {
    expect(stepDurationSec(missions.active.steps[1])).toBeNull();
    expect(stepDurationSec(missions.active.steps[0])).toBe(60);
  });

  it('fmtDurationSec formats compact RU durations', () => {
    expect(fmtDurationSec(42)).toBe('42 с');
    expect(fmtDurationSec(187)).toBe('3 мин');
    expect(fmtDurationSec(3725)).toBe('1 ч 2 мин');
  });
});
