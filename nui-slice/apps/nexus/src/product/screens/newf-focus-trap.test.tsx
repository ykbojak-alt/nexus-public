// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useFocusTrap } from './newf-focus-trap';
import { useRef } from 'react';

function TrapHost({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref, active);
  return (
    <div ref={ref} data-testid="trap">
      <button data-testid="first">first</button>
      <button data-testid="last">last</button>
    </div>
  );
}

describe('useFocusTrap (W24)', () => {
  it('устанавливает фокус на первый элемент при active', () => {
    render(<TrapHost active />);
    expect(document.activeElement).toBe(screen.getByTestId('first'));
  });

  it('Tab на последнем возвращает на первый', () => {
    render(<TrapHost active />);
    screen.getByTestId('last').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByTestId('first'));
  });

  it('Shift+Tab на первом уходит на последний', () => {
    render(<TrapHost active />);
    screen.getByTestId('first').focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId('last'));
  });
});
