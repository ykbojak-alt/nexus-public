// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Ai2ClientKeySettings } from './settings-ai2-client-key';

// Изолируем nue-gateway (get/setAi2ApiKey) — хранилище = глобальный localStorage (стабится в beforeEach).
vi.mock('../nue-gateway', () => ({
  getAi2ApiKey: () => {
    try {
      return globalThis.localStorage?.getItem('nexus.ai2.apiKey')?.trim() || null;
    } catch {
      return null;
    }
  },
  setAi2ApiKey: (v: string | null | undefined) => {
    const key = v?.trim() ?? '';
    try {
      if (key) globalThis.localStorage?.setItem('nexus.ai2.apiKey', key);
      else globalThis.localStorage?.removeItem('nexus.ai2.apiKey');
    } catch {
      /* storage unavailable */
    }
  },
}));

const KEY_LABEL = 'Ключ клиента AI-2 (NUE)';

describe('Ai2ClientKeySettings', () => {
  beforeEach(() => {
    vi.resetModules();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });

  it('shows "not set" status initially and never exposes a key in the DOM', () => {
    render(<Ai2ClientKeySettings />);
    expect(screen.getByText(/не задан/)).toBeTruthy();
    // статус «установлен» отсутствует
    expect(screen.queryByText(/установлен/)).toBeNull();
    // Поле пустое (по label)
    const input = screen.getByLabelText(KEY_LABEL) as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('validates format and refuses invalid keys', () => {
    render(<Ai2ClientKeySettings />);
    const input = screen.getByLabelText(KEY_LABEL);
    fireEvent.change(input, { target: { value: 'nue_GG' } });
    fireEvent.click(screen.getByText('Сохранить'));
    expect(screen.getByText(/Неверный формат/)).toBeTruthy();
    expect(screen.queryByText(/установлен/)).toBeNull();
  });

  it('saves a valid NUE key, clears the field, marks installed', () => {
    const { unmount } = render(<Ai2ClientKeySettings />);
    const input = screen.getByLabelText(KEY_LABEL);
    fireEvent.change(input, { target: { value: 'nue_a1b2c3d4' } });
    fireEvent.click(screen.getByText('Сохранить'));
    // статус + очищенное поле
    expect(screen.getByText(/установлен/)).toBeTruthy();
    expect((screen.getByLabelText(KEY_LABEL) as HTMLInputElement).value).toBe('');
    // секрет не в DOM
    expect(document.body.textContent).not.toContain('nue_a1b2c3d4');
    // повторный рендер — статус сохранился (из storage)
    unmount();
    render(<Ai2ClientKeySettings />);
    expect(screen.getByText(/установлен/)).toBeTruthy();
  });

  it('clears the key via remove and returns to "not set"', () => {
    const { unmount } = render(<Ai2ClientKeySettings />);
    const input = screen.getByLabelText(KEY_LABEL);
    fireEvent.change(input, { target: { value: 'nue_a1b2c3d4' } });
    fireEvent.click(screen.getByText('Сохранить'));
    expect(screen.getByText(/установлен/)).toBeTruthy();

    fireEvent.click(screen.getByText('Удалить'));
    expect(screen.getByText(/не задан/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('nue_a1b2c3d4');
    // повторный рендер — статус «не задан»
    unmount();
    render(<Ai2ClientKeySettings />);
    expect(screen.getByText(/не задан/)).toBeTruthy();
  });
});
