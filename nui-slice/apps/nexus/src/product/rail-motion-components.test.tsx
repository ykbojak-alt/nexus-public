// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeckItem, RailMarker, RailTip, railTipHost } from '@nexus/motion/rail-components';

describe('rail-components (волна XIV W4)', () => {
  it('RailMarker — aria-hidden кромка; animated=false статична', () => {
    const { container, rerender } = render(<RailMarker data-testid="m" />);
    const m = screen.getByTestId('m');
    expect(m.getAttribute('aria-hidden')).toBe('true');
    expect(m.className).toContain('marker');
    rerender(<RailMarker animated={false} data-testid="m" />);
    expect(screen.getByTestId('m').className).toContain('markerStatic');
    expect(container.querySelectorAll('span').length).toBe(1);
  });

  it('RailTip — подпись с role=tooltip внутри tipHost-кнопки', () => {
    render(
      <button type="button" className={railTipHost} aria-label="Рантайм">
        ⚙ <RailTip label="Рантайм" />
      </button>,
    );
    const tip = screen.getByText('Рантайм');
    expect(tip.getAttribute('data-tip')).toBe('');
    expect(tip.getAttribute('aria-hidden')).toBe('true'); // видимость — CSS :hover хоста
    expect(railTipHost).toContain('tipHost');
  });

  it('DeckItem — стаггер-задержка index*60ms; animated=false без неё', () => {
    const { rerender } = render(<DeckItem index={2} data-testid="d">x</DeckItem>);
    const d = screen.getByTestId('d');
    expect(d.className).toContain('deckIn');
    expect(d.style.animationDelay).toBe('120ms');
    rerender(<DeckItem index={2} animated={false} data-testid="d">x</DeckItem>);
    expect(screen.getByTestId('d').className).not.toContain('deckIn');
    expect(screen.getByTestId('d').style.animationDelay).toBe('');
  });
});
