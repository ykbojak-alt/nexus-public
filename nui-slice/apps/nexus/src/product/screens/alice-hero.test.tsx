// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AliceHero } from './alice-hero';

afterEach(cleanup);

describe('AliceHero — R-W3.0', () => {
  it('режим-пилюля + quick-chips: клик зовёт onChip verbatim', async () => {
    const user = userEvent.setup();
    const onChip = vi.fn();
    render(
      <AliceHero mode="Персональный интеллект"
        chips={[{ id: 'c1', label: 'Составь план' }]} onChip={onChip}>
        <h1>Привет</h1>
      </AliceHero>,
    );
    expect(screen.getByText('Персональный интеллект')).toBeTruthy();
    expect(screen.getByText('Привет')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Составь план' }));
    expect(onChip).toHaveBeenCalledWith({ id: 'c1', label: 'Составь план' });
  });

  it('без ассета — честный EmptyState, не орб-подмена', async () => {
    render(<AliceHero mode="m" />);
    // jsdom не грузит изображения — эмулируем error как делает браузер.
    const img = document.querySelector('img');
    expect(img).toBeTruthy();
    img!.dispatchEvent(new Event('error'));
    expect(await screen.findByTestId('empty-state')).toBeTruthy();
    expect(screen.getByText(/образ.*в подготовке/i)).toBeTruthy();
  });
});
