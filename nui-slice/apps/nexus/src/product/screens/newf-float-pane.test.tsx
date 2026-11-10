import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FloatingPane from './newf-float-pane';

describe('FloatingPane', () => {
  it('renders title and children', () => {
    render(<FloatingPane address="term-1" title="T1"><span>hello</span></FloatingPane>);
    expect(screen.getByText('T1')).toBeTruthy();
    expect(screen.getByText('hello')).toBeTruthy();
  });
  it('docks on button and calls onDockBack', () => {
    const onDockBack = vi.fn();
    render(<FloatingPane address="term-1" title="T1" onDockBack={onDockBack} />);
    fireEvent.click(screen.getByTestId('float-dockback'));
    expect(onDockBack).toHaveBeenCalledWith('term-1', expect.any(Object));
  });
  it('closes and calls onClose', () => {
    const onClose = vi.fn();
    render(<FloatingPane address="term-1" title="T1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('float-close'));
    expect(onClose).toHaveBeenCalledWith('term-1');
  });
  it('W7: drag над слотом показывает drop-zone; mouseup в зоне → dockBack', () => {
    const onDockBack = vi.fn();
    const slot = { x: 0, y: 0, w: 400, h: 300 };
    render(<FloatingPane address="term-1" title="T1" onDockBack={onDockBack} slotRect={slot} />);

    fireEvent.mouseDown(screen.getByTestId('float-title'), { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 50 }); // внутри слота
    expect(screen.getByTestId('drop-zone-term-1')).toBeInTheDocument();

    fireEvent.mouseUp(window, { clientX: 60, clientY: 60 });
    expect(onDockBack).toHaveBeenCalledWith('term-1', expect.any(Object));
    expect(screen.queryByTestId('float-pane-term-1')).not.toBeInTheDocument();
  });
});