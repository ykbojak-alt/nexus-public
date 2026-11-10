// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MachinaScreen } from './machina-screen';

describe('MachinaScreen', () => {
  it('embeds the game document and links back to the games catalog', () => {
    render(<MachinaScreen />);

    const game = screen.getByTitle('MACHINA');
    expect(game.tagName).toBe('IFRAME');
    expect(game.getAttribute('src')).toBe('/games/machina/index.html');

    const back = screen.getByRole('link', { name: '← В КАТАЛОГ' });
    expect(back.getAttribute('href')).toBe('/games');
  });
});
