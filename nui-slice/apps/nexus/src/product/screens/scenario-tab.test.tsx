// @vitest-environment jsdom
/**
 * Wave XV W3 — панель «Сценарий» (чек-лист S1–S9 по /v1/scenario/health).
 * Фикстуры помечены // FIXTURE — реальная форма ответа хоста verbatim.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/runtime',
  useSearchParams: () => new URLSearchParams('tab=scenario'),
}));

const scenarioHealth = vi.fn();
let withSeam = true;
vi.mock('../data-source', () => ({
  getDataSource: () => ({
    ...(withSeam ? { scenarioHealth } : {}),
  }),
  useDataSource: () => ({ ...(withSeam ? { scenarioHealth } : {}), }),
}));

import { ScenarioTab } from './scenario-tab';

afterEach(cleanup);
beforeEach(() => {
  scenarioHealth.mockReset();
  withSeam = true;
});

describe('ScenarioTab — чек-лист S1–S9 (фикстуры)', () => {
  it('шаги verbatim: id, заголовок, статус, причина, задержка', async () => {
    // FIXTURE: ответ /v1/scenario/health живого хоста (SDK выключен).
    scenarioHealth.mockResolvedValue({
      generatedAt: 1792190035298,
      steps: [
        { id: 'S1', title: 'Запуск: boot и выбор ассистента', status: 'ok', detail: 'manifest v1, файлов: 375', latencyMs: 12.3 },
        { id: 'S3', title: 'Новая сессия: композитор, сессии, resume/fork', status: 'unavailable', detail: 'нет данных: SDK-канал недоступен', latencyMs: 0.4 },
      ],
    });
    render(<ScenarioTab />);
    await waitFor(() => expect(screen.getByTestId('scenario-S1')).toBeTruthy());
    expect(screen.getByTestId('scenario-S1').getAttribute('data-status')).toBe('ok');
    expect(screen.getByTestId('scenario-S3').getAttribute('data-status')).toBe('unavailable');
    expect(screen.getByText('manifest v1, файлов: 375')).toBeTruthy();
    expect(screen.getByText('нет данных: SDK-канал недоступен')).toBeTruthy();
    expect(screen.getByText('12.3 мс')).toBeTruthy();
  });

  it('пустой список шагов → «Нет данных у хоста»', async () => {
    scenarioHealth.mockResolvedValue({ steps: [], generatedAt: null });
    render(<ScenarioTab />);
    await waitFor(() => expect(screen.getByText(/Нет данных у хоста/)).toBeTruthy());
  });

  it('seam отсутствует → честное «недоступен», запросов нет', () => {
    withSeam = false;
    render(<ScenarioTab />);
    expect(screen.getByText(/Шлюз сценария недоступен/)).toBeTruthy();
    expect(scenarioHealth).not.toHaveBeenCalled();
  });

  it('сбой seam → ошибка verbatim + «Повторить»', async () => {
    scenarioHealth.mockRejectedValue(new Error('HTTP 502: шлюз упал'));
    render(<ScenarioTab />);
    await waitFor(() => expect(screen.getByText(/HTTP 502: шлюз упал/)).toBeTruthy());
    expect(screen.getByText('Повторить')).toBeTruthy();
  });

  it('неизвестный статус хоста → верхний регистр verbatim, без подмены', async () => {
    // FIXTURE: статус, которого нет в словаре (будущий контракт).
    scenarioHealth.mockResolvedValue({
      generatedAt: null,
      steps: [{ id: 'S9', title: 'Сцена UE', status: 'skipped', detail: null, latencyMs: null }],
    });
    render(<ScenarioTab />);
    await waitFor(() => expect(screen.getByTestId('scenario-S9').getAttribute('data-status')).toBe('skipped'));
    expect(screen.getByText('SKIPPED')).toBeTruthy();
  });
});
