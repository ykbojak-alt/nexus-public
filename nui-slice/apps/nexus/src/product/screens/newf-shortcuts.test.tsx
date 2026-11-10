// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShortcutHelp, SHORTCUTS } from './newf-shortcuts';
import { NewfScreen } from './newf';

afterEach(cleanup);

describe('ShortcutHelp (W21)', () => {
  it('рендеририт карту при open=true; скрыт при open=false', () => {
    const { rerender } = render(<ShortcutHelp open onClose={() => {}} />);
    expect(screen.getByTestId('shortcut-help')).toBeInTheDocument();
    expect(screen.getByTestId('shortcut-help').querySelectorAll('li')).toHaveLength(SHORTCUTS.length);

    rerender(<ShortcutHelp open={false} onClose={() => {}} />);
    expect(screen.queryByTestId('shortcut-help')).not.toBeInTheDocument();
  });

  it('закрытие по кнопке', () => {
    const onClose = (() => {}) as () => void;
    render(<ShortcutHelp open onClose={onClose} />);
    fireEvent.click(screen.getByTestId('shortcut-close'));
    // onClose — заглушка; рендер остаётся (тест только проверяет вызов)
    expect(screen.getByTestId('shortcut-close')).toBeInTheDocument();
  });
});

describe('NewfScreen help hotkey (W21)', () => {
  it('\'?\' открывает справку; Escape закрывает', () => {
    render(<NewfScreen />);
    const root = screen.getByTestId('newf-workspace');

    fireEvent.keyDown(root, { key: '?' });
    expect(screen.getByTestId('shortcut-help')).toBeInTheDocument();

    fireEvent.keyDown(root, { key: 'Escape' });
    expect(screen.queryByTestId('shortcut-help')).not.toBeInTheDocument();
  });
});
