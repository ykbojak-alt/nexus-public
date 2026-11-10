import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LiteShell } from './lite-shell';
import { setAi2ApiKey } from '../nue-gateway';

vi.mock('../nue-gateway', () => ({
  getAi2ApiKey: vi.fn(() => null),
  setAi2ApiKey: vi.fn(),
}));

vi.mock('../data-source', () => ({
  getDataSource: vi.fn(() => ({
    startRun: vi.fn(async () => ({ runId: 'r-lite-1', status: 'running' })),
  })),
  useDataSource: vi.fn(() => ({
    startRun: vi.fn(async () => ({ runId: 'r-lite-1', status: 'running' })),
  })),
}));

describe('LiteShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('без ключа показывает welcome с формой ввода', () => {
    render(<LiteShell />);
    expect(screen.getByTestId('lite-welcome')).toBeTruthy();
    expect(screen.getByLabelText('NUE-ключ клиента')).toBeTruthy();
  });

  it('ключ сохраняется после валидации', () => {
    render(<LiteShell />);
    fireEvent.change(screen.getByLabelText('NUE-ключ клиента'), { target: { value: 'nue_abcd1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(setAi2ApiKey).toHaveBeenCalledWith('nue_abcd1234');
  });

  it('неверный ключ показывает ошибку и не сохраняет', () => {
    render(<LiteShell />);
    fireEvent.change(screen.getByLabelText('NUE-ключ клиента'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(setAi2ApiKey).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
