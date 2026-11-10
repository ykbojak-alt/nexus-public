import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MOCK_RATINGS, normalizeAgentKey, RatingBadge, ratingFor, ratingTrend, useRatings, TREND_ARROW } from './ratings';
import { NewfAgents, type ModData } from './newf-mods';
import type { AgentRatings, NewfBridge } from './newf-live';

const mk = (history: { score: number }[]): AgentRatings => ({
  score: history[history.length - 1]?.score ?? 0,
  updated_ts: 0,
  history: history.map((h, i) => ({ task: `t${i}`, score: h.score, ts: i })),
});

describe('ratingTrend (#373)', () => {
  it('↑ при росте последнего score', () => {
    expect(ratingTrend(mk([{ score: 7 }, { score: 8.5 }]).history)).toBe('up');
  });
  it('↓ при падении', () => {
    expect(ratingTrend(mk([{ score: 8 }, { score: 6.2 }]).history)).toBe('down');
  });
  it('→ при равенстве и при единственной записи', () => {
    expect(ratingTrend(mk([{ score: 8 }, { score: 8 }]).history)).toBe('flat');
    expect(ratingTrend(mk([{ score: 8 }]).history)).toBe('flat');
  });
  it('толерантен к пустой history', () => {
    expect(ratingTrend([])).toBe('flat');
  });
});

describe('RatingBadge (#373)', () => {
  it('без рейтинга не рендерится', () => {
    const { container } = render(<RatingBadge />);
    expect(container.firstChild).toBeNull();
  });
  it('показывает score + стрелку тренда', () => {
    const r = mk([{ score: 7 }, { score: 8.5 }]);
    render(<RatingBadge rating={r} />);
    const badge = screen.getByTestId('newf-rating');
    expect(badge.textContent).toContain('8.5');
    expect(badge.textContent).toContain(TREND_ARROW.up);
    expect(badge).toHaveAttribute('aria-label', 'Рейтинг 8.5 ↑');
  });
  it('стрелка ↓ для падения', () => {
    const r = mk([{ score: 9 }, { score: 7.4 }]);
    render(<RatingBadge rating={r} />);
    expect(screen.getByTestId('newf-rating').textContent).toContain(TREND_ARROW.down);
  });
});

describe('MOCK_RATINGS (#373)', () => {
  it('содержит ≥3 агентов с разными score и history', () => {
    const ids = Object.keys(MOCK_RATINGS);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    const scores = ids.map((id) => MOCK_RATINGS[id].score);
    expect(new Set(scores).size).toBeGreaterThanOrEqual(3);
    for (const id of ids) {
      expect(MOCK_RATINGS[id].history.length).toBeGreaterThanOrEqual(1);
      expect(MOCK_RATINGS[id].updated_ts).toBeGreaterThan(0);
    }
  });
});

describe('ratingFor (#373)', () => {
  it('находит по имени агента (live-ключи core)', () => {
    const r = ratingFor(MOCK_RATINGS, { name: 'forge', id: 't1n' });
    expect(r).toBe(MOCK_RATINGS.forge);
  });
  it('фолбэчит на id терминала', () => {
    const r = ratingFor(MOCK_RATINGS, { name: 'unknown', id: 'alice' });
    expect(r).toBe(MOCK_RATINGS.alice);
  });
  it('нормализует имя с точками (ROLE-5 → spark)', () => {
    const live = { spark: MOCK_RATINGS.qoder, forge: MOCK_RATINGS.forge };
    expect(ratingFor(live, { name: 'ROLE-5', id: 't4' })).toBe(live.spark);
    expect(ratingFor(live, { name: 'ROLE-2', id: 't20' })).toBe(live.forge);
  });
  it('возвращает undefined без совпадений и без референса', () => {
    expect(ratingFor(MOCK_RATINGS, { name: 'nope', id: 'nope' })).toBeUndefined();
    expect(ratingFor(MOCK_RATINGS, null)).toBeUndefined();
    expect(ratingFor(MOCK_RATINGS, undefined)).toBeUndefined();
  });
});

describe('normalizeAgentKey (#373)', () => {
  it('lowercase + без точек/пробелов', () => {
    expect(normalizeAgentKey('ROLE-5')).toBe('spark');
    expect(normalizeAgentKey('ROLE-4')).toBe('qoder');
    expect(normalizeAgentKey('H.E.R.E.T.I.C.')).toBe('heretic');
    expect(normalizeAgentKey('FORGE')).toBe('forge');
    expect(normalizeAgentKey('')).toBe('');
  });
});

describe('useRatings (#373)', () => {
  type S = { entries: Record<string, AgentRatings>; error: string | null };
  it('live: грузит из bridge.ratings.fetchAll', async () => {
    const bridge = {
      ratings: { fetchAll: vi.fn(async () => ({ alice: mk([{ score: 8 }]) })) },
    } as unknown as NewfBridge;
    let captured!: S;
    const Probe = () => {
      captured = useRatings(bridge);
      return null;
    };
    render(<Probe />);
    await vi.waitFor(() => expect(captured.entries.alice).toBeDefined());
    expect(captured.error).toBeNull();
  });
  it('mock: без bridge отдаёт fixtures', async () => {
    let captured!: S;
    const Probe = () => {
      captured = useRatings(null);
      return null;
    };
    render(<Probe />);
    expect(captured.entries).toBe(MOCK_RATINGS);
  });
});

describe('NewfAgents + ratings (#373)', () => {
  const data: ModData = {
    live: false,
    error: null,
    spaces: [{ id: 'local', name: 'Local', machine: 'local' }],
    terminals: [
      { address: 't-alice', label: 'AGENT-A', spaceId: 'local', state: 'working', agent: 'alice', seat: 'orchestrator' },
      { address: 't-forge', label: 'ROLE-2', spaceId: 'local', state: 'idle', agent: 'forge', seat: 'coder-1' },
    ],
    agents: [
      { id: 'alice', name: 'AGENT-A', terminal: 't-alice', status: 'working', seat: 'orchestrator' },
      { id: 'forge', name: 'ROLE-2', terminal: 't-forge', status: 'idle', seat: 'coder-1' },
    ],
  };
  it('mock: рендерит бейджи рейтинга для агентов с fixtures', () => {
    render(<NewfAgents data={data} />);
    const badges = screen.getAllByTestId('newf-rating');
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(badges[0].textContent).toContain('8.6');
  });
  it('live: lookup по имени агента, когда id = адрес терминала (ключи core)', () => {
    const liveData: ModData = {
      ...data,
      agents: [
        { id: 't-alice', name: 'alice', terminal: 't-alice', status: 'working', seat: 'orchestrator' },
        { id: 't-forge', name: 'forge', terminal: 't-forge', status: 'idle', seat: 'coder-1' },
      ],
    };
    render(<NewfAgents data={liveData} />);
    const badges = screen.getAllByTestId('newf-rating');
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(badges[0].textContent).toContain('8.6');
    expect(badges[1].textContent).toContain('8.4');
  });
});
