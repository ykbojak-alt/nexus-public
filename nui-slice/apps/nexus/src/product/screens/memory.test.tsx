// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navSearch = vi.hoisted(() => ({ raw: '' }));
const push = vi.hoisted(() => vi.fn());
const sourceMode = vi.hoisted(() => ({ value: 'mock' as 'mock' | 'live' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/memory',
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navSearch.raw),
}));
vi.mock('../data-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data-source')>();
  return { ...actual, getDataSourceKind: () => sourceMode.value };
});

import { MemoryScreen } from './memory';

afterEach(() => {
  cleanup();
  navSearch.raw = '';
  sourceMode.value = 'mock';
  push.mockClear();
});

describe('MemoryScreen — refs3 MEMORY-эталон', () => {
  it('hero + табы Обзор/Архив/Таймлайн, KPI-полоса из реальных seams', async () => {
    render(<MemoryScreen />);
    expect(screen.getByRole('heading', { name: 'Память' })).toBeTruthy();
    const tablist = screen.getByRole('tablist', { name: 'Память' });
    expect(within(tablist).getAllByRole('tab')).toHaveLength(3);
    expect(within(tablist).getByRole('tab', { name: 'Обзор' }).getAttribute('aria-selected')).toBe('true');

    const kpi = await screen.findByTestId('memory-kpi');
    // mock-фикстуры: 20 записей, 2 источника, 7 узлов графа — verbatim из seams
    await within(kpi).findByText('20');
    expect(within(kpi).getByText('Записей')).toBeTruthy();
    expect(within(kpi).getByText('2')).toBeTruthy();
    expect(within(kpi).getByText('7')).toBeTruthy();
    expect(within(kpi).getByText(/узлов · связей 6/)).toBeTruthy();
    expect(within(kpi).getByText(/\d+ (мин|ч|дн) назад/)).toBeTruthy();
    const graphPanel = await screen.findByTestId('memory-graph-panel');
    expect(within(graphPanel).getByText('Структура построена по выборке источника.')).toBeTruthy();
    expect(within(graphPanel).queryByText(/узлов · связей/)).toBeNull();
  });

  it('Обзор: сигналы памяти — дериваты выборки, без выдуманных инсайтов', async () => {
    render(<MemoryScreen />);
    const rail = await screen.findByTestId('memory-insights');
    await within(rail).findByText(/Свежая запись · \d+ дн назад/);
    // первая запись фикстуры — verbatim текст
    expect(within(rail).getByText('Решение: persona-tint отделён от runtime role truth во всех экранах')).toBeTruthy();
    expect(within(rail).getByText(/Плотный день · \d+ записей/)).toBeTruthy();
    expect(within(rail).getByText(/Основной источник · 14/)).toBeTruthy();
    expect(within(rail).getByText(/Покрытие · \d+ дн с записями/)).toBeTruthy();
  });

  it('Обзор: «Недавние записи» ведут в Архив с выбором записи', async () => {
    render(<MemoryScreen />);
    // top-3 записи — items[0..2]; клик по свежей → selectedId + переход в Архив
    const recall = await screen.findByRole('button', { name: /Решение: persona-tint/ });
    fireEvent.click(recall);
    expect(push).toHaveBeenCalledWith('/memory?tab=archive');
  });

  it('Архив: слои/список/инспектор — прежняя 3-колонка внутри вкладки', async () => {
    navSearch.raw = 'tab=archive';
    render(<MemoryScreen />);
    expect(await screen.findByTestId('memory-layers')).toBeTruthy();
    // region «Память» — сам MemoryBrowser (testid дублируется на GlassPanel)
    expect(await screen.findByRole('region', { name: 'Память' })).toBeTruthy();
    // то же у инспектора: testid на обёртке и на внутреннем section
    expect((await screen.findAllByTestId('memory-inspector')).length).toBeGreaterThan(0);
  });

  it('Таймлайн: дни с барами плотности и записями verbatim', async () => {
    navSearch.raw = 'tab=timeline';
    render(<MemoryScreen />);
    const panel = await screen.findByTestId('memory-timeline');
    const bars = await within(panel).findAllByRole('img', { name: /записей/ });
    expect(bars.length).toBeGreaterThan(1);
    // записи сгруппированы по дням — текст verbatim из фикстуры
    expect(within(panel).getAllByText(/записей/).length).toBeGreaterThan(1);
    expect(within(panel).getByText('Webhook deliveries: status pending|delivered|failed + attempts + lastCode')).toBeTruthy();
  });

  it('wave-XII: ?q= из палитры открывает Архив сразу в режиме поиска', async () => {
    navSearch.raw = 'tab=archive&q=webhook';
    render(<MemoryScreen />);
    const browser = await screen.findByRole('region', { name: 'Память' });
    // хит verbatim из searchMemory — подстрока «webhook» в фикстуре
    await within(browser).findByText('Webhook deliveries: status pending|delivered|failed + attempts + lastCode');
    // поле поиска предзаполнено запросом
    expect((browser.querySelector('input') as HTMLInputElement).value).toBe('webhook');
  });

  it('клик по табу пушит ?tab= — URL остаётся источником истины', async () => {
    render(<MemoryScreen />);
    const tablist = screen.getByRole('tablist', { name: 'Память' });
    fireEvent.click(within(tablist).getByRole('tab', { name: 'Таймлайн' }));
    expect(push).toHaveBeenCalledWith('/memory?tab=timeline');
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(push).toHaveBeenCalledWith('/memory?tab=timeline');
  });

  it('live source does not pretend local memory writes were persisted', async () => {
    sourceMode.value = 'live';
    navSearch.raw = 'tab=archive';
    render(<MemoryScreen />);

    const template = await screen.findByTestId('memory-template');
    expect(template.getAttribute('data-state')).toBe('unavailable');
    expect(within(template).queryByRole('textbox', { name: 'Текст записи' })).toBeNull();
    expect(within(template).getByTestId('empty-state')).toHaveTextContent(/Создание записей недоступно/);
    expect(await screen.findByText(/Удаление недоступно: активный источник/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Удалить запись' })).toBeNull();
  });
});
