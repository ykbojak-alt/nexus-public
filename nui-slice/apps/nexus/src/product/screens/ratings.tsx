'use client';

/**
 * RATINGS (#373): оценки агентов от core /api/core/ratings.
 *
 * - `useRatings` — эффект на загрузку (live через bridge.ratings, иначе mock
 *   fixtures). Ошибки сети/404 не роняют экран: состояние `error` скрывает
 *   бейджи (честная недоступность, без фейков).
 * - `RatingBadge` — score 0-10 + тренд-стрелка по history (↑/↓/→).
 * - `ratingTrend` — чистая функция для тестов.
 */

import { useEffect, useState } from 'react';
import type { AgentRatings, NewfBridge } from './newf-live';
import styles from './newf.module.css';

export type RatingTrend = 'up' | 'down' | 'flat';

export function ratingTrend(history: { score: number }[]): RatingTrend {
  if (history.length < 2) return 'flat';
  const last = history[history.length - 1].score;
  const prev = history[history.length - 2].score;
  if (last > prev) return 'up';
  if (last < prev) return 'down';
  return 'flat';
}

export const TREND_ARROW: Record<RatingTrend, string> = { up: '↑', down: '↓', flat: '→' };

export interface RatingsState {
  entries: Record<string, AgentRatings>;
  error: string | null;
}

export const MOCK_RATINGS: Record<string, AgentRatings> = {
  alice: {
    score: 8.6,
    updated_ts: 1762400000,
    history: [
      { task: 'orchestrate wave 371', score: 8.2, ts: 1762300000, note: 'стабильно' },
      { task: 'wave 372 review', score: 8.6, ts: 1762400000, note: 'точность выше' },
    ],
  },
  forge: {
    score: 8.4,
    updated_ts: 1762400000,
    history: [
      { task: 'NEWF UI #371', score: 8.4, ts: 1762400000, note: 'принято' },
      { task: 'AEGIS #369', score: 8.4, ts: 1762400000, note: 'live-evidence' },
    ],
  },
  codex: {
    score: 7.1,
    updated_ts: 1762400000,
    history: [
      { task: 'patch review', score: 7.4, ts: 1762300000 },
      { task: 'hotfix merge', score: 7.1, ts: 1762400000, note: 'регресс' },
    ],
  },
  qoder: {
    score: 8.9,
    updated_ts: 1762400000,
    history: [
      { task: 'HiveBid audit', score: 8.7, ts: 1762200000 },
      { task: 'attested mint', score: 8.9, ts: 1762400000, note: '104/104' },
    ],
  },
};

function loadRatings(bridge: NewfBridge | null | undefined): Promise<Record<string, AgentRatings>> {
  if (!bridge?.ratings) return Promise.resolve({});
  return bridge.ratings.fetchAll();
}

export function useRatings(bridge: NewfBridge | null | undefined, mockFallback = MOCK_RATINGS): RatingsState {
  const [state, setState] = useState<RatingsState>({ entries: {}, error: null });

  useEffect(() => {
    let cancelled = false;
    if (bridge) {
      loadRatings(bridge)
        .then((entries) => {
          if (!cancelled) setState({ entries, error: null });
        })
        .catch(() => {
          if (!cancelled) setState({ entries: {}, error: 'ratings unavailable' });
        });
    } else {
      // mock-режим: локальные fixtures — UI работает и без core.
      setState({ entries: mockFallback, error: null });
    }
    return () => {
      cancelled = true;
    };
  }, [bridge, mockFallback]);

  return state;
}

export interface RatingAgentRef { id?: string; name?: string }

/**
 * Нормализация ключа агента: «ROLE-5» → «spark», «HERETIC» → «heretic».
 * Core (SPARK #387) адресует оценки lowercase-именами без точек/пробелов.
 */
export function normalizeAgentKey(name?: string | null): string {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

/**
 * Рейтинг агента по ключу. Core адресует оценки lowercase-именами
 * (spark/forge/...), а live-списки агентов дают имена (ROLE-5) и
 * адреса терминалов (t4) — перебираем все три варианта.
 */
export function ratingFor(
  ratings: Record<string, AgentRatings>,
  agent?: RatingAgentRef | null,
): AgentRatings | undefined {
  if (!agent) return undefined;
  if (agent.name && ratings[agent.name]) return ratings[agent.name];
  if (agent.id && ratings[agent.id]) return ratings[agent.id];
  const norm = normalizeAgentKey(agent.name);
  if (norm && ratings[norm]) return ratings[norm];
  return undefined;
}

export function RatingBadge({ rating }: { rating?: AgentRatings }) {
  if (!rating) return null;
  const trend = ratingTrend(rating.history);
  const arrow = TREND_ARROW[trend];
  return (
    <span
      className={`${styles.ratingBadge} ${styles[`rating${trend}`]}`}
      data-testid="newf-rating"
      aria-label={`Рейтинг ${rating.score} ${arrow}`}
      title={`score ${rating.score} · ${trend}`}
    >
      {rating.score.toFixed(1)} {arrow}
    </span>
  );
}
