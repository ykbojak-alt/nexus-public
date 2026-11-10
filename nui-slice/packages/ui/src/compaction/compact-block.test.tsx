import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, describe, expect, it } from 'vitest';
import { CompactBlock } from './compact-block';
import { CompactIndicator } from './compact-indicator';

afterEach(cleanup);

const longRussianText =
  'Сжатый контекст сохраняет решения, ограничения и подтверждённые договорённости между этапами диалога.';

describe('CompactBlock', () => {
  it('exposes native button expansion semantics and labelled content region', async () => {
    const user = userEvent.setup();
    render(<main><CompactBlock title="Сжатый контекст">{longRussianText}</CompactBlock></main>);
    const toggle = screen.getByRole('button', { name: /сжатый контекст/i });
    const region = screen.getByRole('region', { hidden: true });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(region).toHaveAttribute('hidden');
    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: /содержимое/i })).toHaveTextContent(longRussianText);
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('supports Space activation and keeps long Russian content untruncated', async () => {
    const user = userEvent.setup();
    render(<CompactBlock title="Длинный заголовок режима компактизации" state="warning">{longRussianText}</CompactBlock>);
    const toggle = screen.getByRole('button', { name: /длинный заголовок/i });
    toggle.focus();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region')).toHaveTextContent(longRussianText);
    expect(screen.getByRole('region').textContent).not.toContain('…');
  });

  it('provides the full truncated compact title in the accessible name and when expanded', async () => {
    const user = userEvent.setup();
    const title = 'Сохранённый контекст диалога с подтверждёнными ограничениями, решениями и следующими действиями';
    render(<main><CompactBlock title={title}>{longRussianText}</CompactBlock></main>);
    const toggle = screen.getByRole('button', { name: `${title} — Обычный режим` });
    expect(toggle).toHaveAttribute('aria-label', expect.stringContaining(title));
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent(title);
  });

  it.each(['normal', 'warning', 'active'] as const)('renders a labelled dots and bar indicator for %s', (state) => {
    const { rerender } = render(<CompactIndicator state={state} pattern="dots" />);
    expect(screen.getByRole('img', { name: /режим|компактизация/i })).toHaveAttribute('data-state', state);
    rerender(<CompactIndicator state={state} pattern="bar" />);
    expect(screen.getByRole('img')).toHaveAttribute('data-state', state);
  });

  it('uses shared state tokens and wrap behavior without line-clamping text', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'compact-block.module.css'), 'utf8');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('-webkit-line-clamp: 2');
    expect(css).toContain(".root[data-expanded='true'] .heading");
    expect(css).toContain('--nexus-compact-warning');
    expect(css).toContain('prefers-reduced-transparency: reduce');
  });
});
