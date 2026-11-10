// @vitest-environment jsdom
/**
 * W3-158 — единый toast-стек ошибок API: честный текст из ApiError,
 * липкие ошибки, retry-действие, dedup, авто-dismiss успехов.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ai2ApiError } from '../integrations/ai2/api/errors';
import { ApiToastProvider, apiErrorToastText, useApiToast } from './api-toast';

const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => media),
  });
});

afterEach(() => {
  vi.useRealTimers();
  media.matches = false;
  vi.clearAllMocks();
  if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
});

function Trigger({ onApi }: { onApi: (api: ReturnType<typeof useApiToast>) => void }) {
  const api = useApiToast();
  return <button type="button" onClick={() => onApi(api)}>fire</button>;
}

function renderWithTrigger() {
  let api: ReturnType<typeof useApiToast> = null;
  render(
    <ApiToastProvider>
      <Trigger onApi={(a) => { api = a; }} />
    </ApiToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'fire' }));
  return api!;
}

describe('apiErrorToastText — честный текст причины', () => {
  it('Ai2ApiError → HTTP-статус + verbatim message хоста', () => {
    const err = new Ai2ApiError(503, { error: 'unavailable', message: 'summary_model_unavailable' });
    expect(apiErrorToastText(err, 'Не удалось сжать историю'))
      .toBe('Не удалось сжать историю (HTTP 503 · summary_model_unavailable)');
  });

  it('обычный Error → message verbatim; мусор → честный fallback без выдумок', () => {
    expect(apiErrorToastText(new Error('socket hangup'), 'Не удалось'))
      .toBe('Не удалось: socket hangup');
    expect(apiErrorToastText(null, 'Не удалось загрузить историю'))
      .toBe('Не удалось загрузить историю. Проверьте подключение и повторите.');
  });
});

describe('ApiToastProvider — стек, dedup, retry, lifecycle', () => {
  it('API-ошибка всплывает липким alert-тостом с честным текстом', () => {
    const api = renderWithTrigger();
    act(() => {
      api!.notifyApiError(new Ai2ApiError(409, { error: 'conflict', message: 'concurrent compact' }), 'Не удалось сжать историю');
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Не удалось сжать историю (HTTP 409 · concurrent compact)');
    // Липкий: время идёт — тост остаётся.
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('retry-действие вызывает повтор операции и дисмиссит тост', () => {
    const api = renderWithTrigger();
    const retry = vi.fn();
    act(() => {
      api!.notifyApiError(new Ai2ApiError(500, { error: 'x', message: 'flaky' }), 'Не удалось', { retry });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(retry).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(140); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('dedup: повтор той же ошибки не плодит второй тост', () => {
    const api = renderWithTrigger();
    act(() => {
      const err = new Ai2ApiError(503, { error: 'x', message: 'down' });
      api!.notifyApiError(err, 'Не удалось');
      api!.notifyApiError(err, 'Не удалось');
      api!.notifyApiError(new Ai2ApiError(500, { error: 'x', message: 'other' }), 'Не удалось');
    });
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('успех — status-тост с авто-dismiss, alert не поднимается', () => {
    const api = renderWithTrigger();
    act(() => { api!.notifySuccess('Профиль сохранён'); });
    const note = screen.getByRole('status');
    expect(note.textContent).toContain('Профиль сохранён');
    // Авто-dismiss: durationMs → exit-фаза → notifyOut-окно → снятие.
    act(() => { vi.advanceTimersByTime(5000); });
    act(() => { vi.advanceTimersByTime(140); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('без провайдера useApiToast → null (баре-рендеры не падают)', () => {
    function Bare() { return <div data-testid="bare">{useApiToast() == null ? 'null' : 'api'}</div>; }
    render(<Bare />);
    expect(screen.getByTestId('bare').textContent).toBe('null');
  });
});
