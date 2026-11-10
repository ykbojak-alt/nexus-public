import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StatusBadge, type NexusStatus } from './status-badge';

afterEach(cleanup);

const STATUSES: NexusStatus[] = [
  'online', 'active', 'thinking', 'waiting', 'syncing', 'validating',
  'executing', 'complete', 'paused', 'error', 'warning', 'offline', 'info',
];

describe('StatusBadge (W2-132)', () => {
  it.each(STATUSES)('status %s renders canonical label + data hook', (status) => {
    render(<StatusBadge status={status} />);
    const el = screen.getByTestId('status-badge');
    expect(el).toHaveAttribute('data-status', status);
    if (status === 'thinking') {
      expect(el.querySelector('[data-typing-indicator]')).toHaveAttribute('data-typing-indicator', 'dots-cascade');
      expect(el).toHaveTextContent('печатает…');
    } else {
      expect(el).toHaveTextContent(status.toUpperCase());
    }
  });

  it('W2-140 contract: every NexusStatus union member has a css mapping (color + dot)', () => {
    // union из исходника — новый статус без [data-status] правила падает здесь
    const src = readFileSync(join(__dirname, 'status-badge.tsx'), 'utf8');
    const unionBlock = /NexusStatus\s*=\s*([^;]+);/.exec(src)?.[1] ?? '';
    const members = [...unionBlock.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(members.length).toBeGreaterThanOrEqual(STATUSES.length);
    const css = readFileSync(join(__dirname, 'status-badge.module.css'), 'utf8');
    for (const s of members) {
      const rule = new RegExp(`data-status='${s}'`);
      expect(css, `missing [data-status='${s}'] rule`).toMatch(rule);
    }
    // каждый статус биндит state-* цвет (группированные селекторы покрывают
    // всех перечисленных — online/complete делят одно правило)
    const themedRules = css.match(/\.root\[data-status='[^']+'\][^{]*\{[^}]*var\(--nexus-state-/g) ?? [];
    const covered = new Set(
      themedRules.flatMap((r) => [...r.matchAll(/data-status='(\w+)'/g)].map((m) => m[1])),
    );
    for (const s of members) {
      expect(covered.has(s), `status '${s}' has no state-* color binding`).toBe(true);
    }
    // текст бейджа никогда не пустой: label ?? status.toUpperCase()
    expect(src).toContain('status.toUpperCase()');
  });

  it('same-color statuses get a non-color distinction in css', () => {
    const css = readFileSync(join(__dirname, 'status-badge.module.css'), 'utf8');
    // syncing vs info; executing vs warning; waiting/paused/offline; online vs complete
    expect(css).toMatch(/data-status='syncing'\][^{]*\.dot[^}]*conic-gradient/);
    expect(css).toMatch(/data-status='warning'\][^{]*\.dot[^}]*clip-path/);
    expect(css).toMatch(/data-status='paused'\][^{]*\.dot[^}]*linear-gradient/);
    expect(css).toMatch(/data-status='offline'\][^{]*\.dot[^}]*border/);
    expect(css).toMatch(/data-status='complete'\][^{]*\.dot[^}]*clip-path/);
    // motion is honored and gated
    expect(css).toContain('@keyframes statusSpin');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('forced-colors');
  });
});
