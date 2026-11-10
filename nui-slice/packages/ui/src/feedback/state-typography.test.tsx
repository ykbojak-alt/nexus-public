import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './empty-state/empty-state';
import { UnavailableState } from './unavailable-state/unavailable-state';

/**
 * Wave-XXVI rhythm guard: the shared state-primitives text stack must keep
 * token line-heights and long-string wrap protection so long Russian titles
 * never escape the panel — and are never truncated in the DOM.
 */
const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'feedback.module.css'),
  'utf8',
);

const LONG_TITLE =
  'История запусков диагностических прогонов и межсервисных проверок пока не собиралась';
const LONG_REASON =
  'хранилище телеметрии подключено, но выборка за выбранный период пуста по фильтру «все оркестраторы»';

function ruleBody(cls: string): string {
  const match = CSS.match(new RegExp(`\\.${cls} \\{([^}]*)\\}`));
  expect(match, `.${cls} rule missing`).not.toBeNull();
  return match![1];
}

describe('state primitives — variants (W2-133)', () => {
  it('full variant keeps panel semantics and fills the region', () => {
    render(<UnavailableState variant="full" title="Голосовой канал" reason="источник не отвечает" />);
    const el = screen.getByTestId('unavailable-state');
    expect(el.className).toContain('statePanelFull');
    expect(el).toHaveTextContent('источник не отвечает');
  });
});

describe('state primitives — typography rhythm (wave-XXVI)', () => {
  it('keeps the full long Russian title and reason in the DOM — no truncation', () => {
    render(<EmptyState title={LONG_TITLE} reason={LONG_REASON} />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent(LONG_TITLE);
    expect(el).toHaveTextContent(LONG_REASON);
    expect(el.textContent).not.toContain('…');
  });

  it('stateTitle binds the panel-title line-height token and wraps/balances', () => {
    const title = ruleBody('stateTitle');
    expect(title).toContain('var(--nexus-type-panel-title-line-height, 26px)');
    expect(title).toContain('overflow-wrap');
    expect(title).toContain('text-wrap: balance');
  });

  it.each(['stateBody', 'stateReason', 'stateHint'])(
    '%s carries the caption line-height token and wrap protection',
    (cls) => {
      const body = ruleBody(cls);
      expect(body).toContain('line-height: var(--nexus-type-caption-line-height');
      expect(body).toContain('overflow-wrap');
    },
  );

  it('inline hint survives a single unbreakable identifier', () => {
    const id = 'результаты-супердлинной-конфигурации-кластера-оркестратора';
    render(<EmptyState variant="inline" title={id} />);
    expect(screen.getByRole('status')).toHaveTextContent(id);
  });
});
