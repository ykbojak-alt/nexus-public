// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NotificationsTray, type Notice } from './newf-notifications';

afterEach(cleanup);

const NOTICES: Notice[] = [
  { id: '1', text: 't1 attention', ts: 1, kind: 'attention' },
  { id: '2', text: 't2 exited', ts: 2, kind: 'info' },
];

describe('NotificationsTray (W23)', () => {
  it('свернут по умолчанию; toggle открывает', () => {
    render(<NotificationsTray notices={NOTICES} />);
    expect(screen.queryByTestId('tray-panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tray-toggle'));
    expect(screen.getByTestId('tray-panel')).toBeInTheDocument();
    expect(screen.getByTestId('notice-1')).toHaveTextContent('t1 attention');
    expect(screen.getByTestId('notice-1')).toHaveAttribute('data-kind', 'attention');
  });

  it('dismiss вызывает onDismiss; clear — onClear', () => {
    const onDismiss = vi.fn();
    const onClear = vi.fn();
    render(<NotificationsTray notices={NOTICES} onDismiss={onDismiss} onClear={onClear} />);
    fireEvent.click(screen.getByTestId('tray-toggle'));
    fireEvent.click(screen.getByTestId('notice-dismiss-1'));
    expect(onDismiss).toHaveBeenCalledWith('1');
    fireEvent.click(screen.getByTestId('tray-clear'));
    expect(onClear).toHaveBeenCalled();
  });

  it('пустой список → честная подпись', () => {
    render(<NotificationsTray notices={[]} />);
    fireEvent.click(screen.getByTestId('tray-toggle'));
    expect(screen.getByText('нет уведомлений')).toBeInTheDocument();
  });
});
