import type { CSSProperties } from 'react';
import { CHART_CHROME, toneVar } from '../palette';
import { formatTick } from '../chart-math';
import type { RibbonEvent } from './event-ribbon';

const listStyle: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 };

function ts(v: number | Date): number {
  return v instanceof Date ? v.getTime() : v;
}

/**
 * DOM alternative for EventRibbon (runbook W4-01): the same event tape
 * as an ordered list — lane, label, tone and timestamp readable without
 * color, hover or SVG. Order is the ribbon's visual order (time asc).
 */
export function RibbonList({
  events,
  limit,
  lanes,
}: {
  events: RibbonEvent[];
  limit?: number;
  /** Lane filter — when provided, only these lanes render (audit §5: feed filter UX). */
  lanes?: readonly string[];
}) {
  const laneSet = lanes != null ? new Set(lanes) : null;
  const sorted = events
    .filter((e) => Number.isFinite(ts(e.ts)) && (laneSet == null || laneSet.has(e.lane)))
    .slice()
    .sort((a, b) => ts(a.ts) - ts(b.ts));
  const shown = limit != null ? sorted.slice(0, Math.max(0, limit)) : sorted;
  const hidden = sorted.length - shown.length;
  return (
    <ol data-ribbon-list style={listStyle}>
      {shown.map((e) => (
        <li
          key={e.id}
          data-event={e.id}
          data-lane={e.lane}
          data-tone={e.tone ?? 'neutral'}
          style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}
        >
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, flex: 'none', background: toneVar(e.tone ?? 'neutral') }} />
          <span style={{ color: CHART_CHROME.label, flex: 'none', minWidth: 48 }}>{formatTick(ts(e.ts))}</span>
          <span style={{ color: CHART_CHROME.label, flex: 'none' }}>{e.lane}</span>
          <span>{e.label}</span>
        </li>
      ))}
      {hidden > 0 ? (
        <li data-truncated style={{ color: CHART_CHROME.label }}>+{hidden} more events</li>
      ) : null}
    </ol>
  );
}
