import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, describe, expect, it } from 'vitest';
import { CompactBadge } from './compact-badge';
import { CompactSummaryRow } from './compact-summary-row';

afterEach(cleanup);

describe('compact summary badge and row', () => {
  it.each([
    [1, false, '1 сообщение сжато', '1'],
    [12, false, '12 сообщений сжато', '12'],
    [120, true, 'Не менее 120 сообщений сжато', '120+'],
  ] as const)('labels %s truthfully and preserves the visible count', (count, atLeast, label, text) => {
    render(<main><CompactBadge count={count} atLeast={atLeast} /></main>);
    expect(screen.getByRole('img', { name: label })).toHaveTextContent(text);
  });

  it('renders the shared body/caption hierarchy and expands by keyboard without losing the range', async () => {
    const user = userEvent.setup();
    render(
      <main>
        <CompactSummaryRow count={12} timeRange="10:24–10:31">
          <p>Фрагмент диалога сохранён полностью.</p>
        </CompactSummaryRow>
      </main>,
    );
    const button = screen.getByRole('button', { name: /Сжатая история/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveTextContent('12 сообщений · 10:24–10:31');
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('img', { name: '12 сообщений сжато' })).toHaveAttribute('data-state', 'expanded');
    expect(screen.getByRole('region', { name: 'Содержимое сжатой истории' })).toHaveTextContent('Фрагмент диалога сохранён полностью.');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('uses tokenized badge states and existing type-rhythm roles without hex literals', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'compact-summary.module.css'), 'utf8');
    expect(css).toContain('--nexus-compact-badge-min-width');
    expect(css).toContain('--nexus-compact-badge-expanded-background');
    expect(css).toContain('--nexus-type-code-font-family');
    expect(css).toContain('font-variant-numeric: tabular-nums');
    expect(css).toContain('--nexus-type-body-font-size');
    expect(css).toContain('--nexus-type-caption-font-size');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
