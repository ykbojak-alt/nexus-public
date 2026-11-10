import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileShell } from './mobile';
import { setAi2ApiKey } from '../nue-gateway';

const startRun = vi.fn(async () => ({ runId: 'r-mobile-1', status: 'running' }));

vi.mock('../nue-gateway', () => ({
  getAi2ApiKey: vi.fn(() => null),
  setAi2ApiKey: vi.fn(),
}));

vi.mock('../data-source', () => ({
  getDataSourceKind: vi.fn(() => 'mock'),
  useDataSource: vi.fn(() => ({ startRun })),
}));

vi.mock('./runtime-echo', () => ({
  useRuntimeEcho: vi.fn(() => ({
    live: null,
    lines: [],
    answer: null,
    question: null,
    feedRef: { current: null },
    start: vi.fn(),
    close: vi.fn(),
  })),
}));

describe('MobileShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('без ключа показывает pairing-welcome с bottom-nav', () => {
    vi.mocked(setAi2ApiKey).mockClear();
    render(<MobileShell />);
    expect(screen.getByTestId('mobile-welcome')).toBeTruthy();
    expect(screen.getByTestId('mobile-nav')).toBeTruthy();
    expect(screen.getByLabelText('NUE-ключ клиента')).toBeTruthy();
  });

  it('валидный ключ сохраняет и открывает чат с pairing-статусом', () => {
    render(<MobileShell />);
    fireEvent.change(screen.getByLabelText('NUE-ключ клиента'), { target: { value: 'nue_abcd1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Подключиться' }));
    expect(setAi2ApiKey).toHaveBeenCalledWith('nue_abcd1234');
  });

  it('неверный ключ показывает ошибку и не сохраняет', () => {
    render(<MobileShell />);
    fireEvent.change(screen.getByLabelText('NUE-ключ клиента'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Подключиться' }));
    expect(setAi2ApiKey).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('ни один интерактив не зависит от hover: bottom-nav рендерит 4 таба в welcome-состоянии', () => {
    render(<MobileShell />);
    const nav = screen.getByTestId('mobile-nav');
    expect(nav.querySelectorAll('[data-tab]')).toHaveLength(4);
  });
});
