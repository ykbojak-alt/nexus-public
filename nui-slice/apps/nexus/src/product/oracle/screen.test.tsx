// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { OracleScreen } from './screen';

// matchMedia/canvas stubs живут в общем harness (packages/ui/test/setup.ts).
// Журнал пишется в localStorage — чистим между тестами.

beforeEach(() => {
  window.localStorage.clear();
});

const openLog = () =>
  fireEvent.click(screen.getByRole('tab', { name: 'Журнал' }));

describe('OracleScreen — состояния', () => {
  it('empty → ready: лендинг с интро, после тяги — расклад', () => {
    const { container } = render(<OracleScreen />);
    const root = container.firstElementChild!;
    expect(root.getAttribute('data-screen')).toBe('oracle');
    expect(root.getAttribute('data-state')).toBe('empty');
    expect(screen.getByRole('heading', { level: 1, name: 'Song of Light and Shadow' })).toBeTruthy();
    expect(screen.getByText('ЛОКАЛЬНО')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Потянуть карты' }));
    expect(root.getAttribute('data-state')).toBe('ready');
    // voices — три позиции → три слота-кнопки на скатерти
    const slots = screen.getAllByRole('button', { name: /:/ }).filter((b) => b.className.includes('slot'));
    expect(slots).toHaveLength(3);
    expect(screen.getAllByText(/seed \d+/).length).toBeGreaterThan(0);
    expect(screen.getByText('раскрыто 0/3')).toBeTruthy();
  });

  it('карты раскрываются по таймеру; «Копия разбора» активна только когда все открыты', async () => {
    render(<OracleScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Потянуть карты' }));
    const copy = screen.getByRole('button', { name: 'Копия разбора' });
    expect(copy.hasAttribute('disabled')).toBe(true);
    // voices: последняя карта на 420+2*550 ≈ 1.5с
    await waitFor(() => expect(screen.getByText('раскрыто 3/3')).toBeTruthy(), { timeout: 4000 });
    expect(copy.hasAttribute('disabled')).toBe(false);
  });

  it('«Карта дня» — детерминированная тяга сразу при выборе режима', () => {
    render(<OracleScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Карта дня/ }));
    const root = document.querySelector('[data-screen="oracle"]')!;
    expect(root.getAttribute('data-state')).toBe('ready');
    const slots = screen.getAllByRole('button', { name: /:/ }).filter((b) => b.className.includes('slot'));
    expect(slots).toHaveLength(1);
  });

  it('журнал: тяга пишет запись, реплей по seed возвращает расклад', () => {
    render(<OracleScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Потянуть карты' }));
    openLog();
    const items = screen.getAllByRole('button', { name: /seed \d+/ });
    expect(items.length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Сменить режим' }));
    expect(document.querySelector('[data-screen="oracle"]')!.getAttribute('data-state')).toBe('empty');
    fireEvent.click(items[0]);
    expect(document.querySelector('[data-screen="oracle"]')!.getAttribute('data-state')).toBe('ready');
  });

  it('журнал: стрелки/Home/End двигают фокус между записями', () => {
    render(<OracleScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Потянуть карты' }));
    fireEvent.click(screen.getByRole('button', { name: 'Новая тяга' }));
    openLog();
    const list = document.querySelector('.journal') ?? screen.getByLabelText(/Журнал раскладов/);
    const items = Array.from(list.querySelectorAll('button'));
    expect(items.length).toBe(2);
    items[0].focus();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(list, { key: 'ArrowDown' }); // циклически → первая
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(list, { key: 'End' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(list, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('табы разбора: ArrowRight/Left листают, tabpanel связан aria', () => {
    render(<OracleScreen />);
    const tablist = screen.getByRole('tablist', { name: 'Разбор расклада' });
    const read = screen.getByRole('tab', { name: 'Разбор' });
    const map = screen.getByRole('tab', { name: 'Схема' });
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(map.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(read.getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(read.id);
  });

  it('пустые состояния панелей: разбор/схема/журнал честно объясняют пустоту', () => {
    render(<OracleScreen />);
    expect(screen.getByText(/разбор позиций появится здесь/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Схема' }));
    expect(screen.getByText(/геометрию позиций после тяги/)).toBeTruthy();
    openLog();
    expect(screen.getByText(/Журнал пуст/)).toBeTruthy();
  });
});
