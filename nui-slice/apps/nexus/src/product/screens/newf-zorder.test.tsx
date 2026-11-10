import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FloatingPane from './newf-float-pane';
import { nextZ, topZ } from './newf-zorder';

describe('newf-zorder', () => {
  it('counter strictly increases', () => {
    const a = nextZ();
    const b = nextZ();
    expect(b).toBeGreaterThan(a);
    expect(topZ()).toBe(b);
  });

  it('floating panes get increasing zIndex on mount', () => {
    render(
      <>
        <FloatingPane address="za" title="A" />
        <FloatingPane address="zb" title="B" />
      </>,
    );
    const za = Number(screen.getByTestId('float-pane-za').style.zIndex);
    const zb = Number(screen.getByTestId('float-pane-zb').style.zIndex);
    expect(zb).toBeGreaterThan(za);
  });

  it('pointerdown raises pane above siblings', () => {
    render(
      <>
        <FloatingPane address="za" title="A" />
        <FloatingPane address="zb" title="B" />
      </>,
    );
    const before = Number(screen.getByTestId('float-pane-za').style.zIndex);
    const top = Number(screen.getByTestId('float-pane-zb').style.zIndex);
    fireEvent.pointerDown(screen.getByTestId('float-pane-za'));
    const after = Number(screen.getByTestId('float-pane-za').style.zIndex);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(top);
  });
});
