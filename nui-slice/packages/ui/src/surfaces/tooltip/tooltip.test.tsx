import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from './tooltip';

afterEach(cleanup);

describe('Tooltip (W2-130)', () => {
  it('links content via aria-describedby, shows on focus, dismisses on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Разделить панель">
        <button type="button">◫</button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-describedby');
    await user.tab();
    expect(btn).toHaveFocus();
    const tip = await screen.findByRole('tooltip');
    expect(btn).toHaveAttribute('aria-describedby', tip.id);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('merges with an existing aria-describedby and never takes focus', async () => {
    const user = userEvent.setup();
    render(
      <>
        <span id="meta">hint</span>
        <Tooltip content="Закрыть" position="bottom" arrow>
          <button type="button" aria-describedby="meta">✕</button>
        </Tooltip>
      </>,
    );
    const btn = screen.getByRole('button');
    await user.tab();
    const tip = await screen.findByRole('tooltip');
    expect(btn.getAttribute('aria-describedby')).toContain('meta');
    expect(btn.getAttribute('aria-describedby')).toContain(tip.id);
    expect(tip).not.toHaveAttribute('tabindex');
  });

  it('wraps disabled buttons — hover on the wrapper still reveals the label', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Недоступно без гранта" delay={0}>
        <button type="button" disabled>▶</button>
      </Tooltip>,
    );
    await user.hover(screen.getByRole('button').parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Недоступно без гранта');
  });

  it('renders a keyboard hint next to the action label and exposes it through describedby', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Показать правую панель" kbd={['Ctrl/Cmd+B', 'Alt+B']}>
        <button type="button">Панель</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button');
    await user.tab();
    const tip = await screen.findByRole('tooltip');
    expect(button.getAttribute('aria-describedby')).toContain(tip.id);
    expect(tip).toHaveTextContent('Показать правую панель');
    expect(tip.querySelectorAll('kbd')).toHaveLength(2);
    expect(tip.querySelectorAll('kbd')[0]).toHaveTextContent('Ctrl/Cmd+B');
    expect(tip.querySelectorAll('kbd')[1]).toHaveTextContent('Alt+B');
  });
});
