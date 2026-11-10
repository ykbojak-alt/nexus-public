// @vitest-environment jsdom
/**
 * V42: roundtrip-e2e для magnetize-persist. Не дублирует
 * newf-magnetize.test.tsx (тот юнитит API и заранее подложенный
 * localStorage); здесь именно жизненный цикл: живая панель что-то
 * записала → размонтирована → смонтирована заново → геометрия на экране
 * совпала с тем, что лежит в хранилище. Плюс соседние панели, мусор в
 * storage и storage, который бросается.
 *
 * jsdom возвращает нулевой getBoundingClientRect, поэтому геометрия
 * home stub-ится детерминированно — без этого roundtrip проверял бы
 * только нули.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  MAGNET_LAYOUT_KEY,
  readMagnetLayout,
  withMagnetize,
  writeMagnetSettings,
} from './newf-magnetize';

const HOME = { left: 120, top: 240, width: 360, height: 220 };

const Dummy = ({ label }: { label: string }) => <div data-testid="dummy-body">{label}</div>;

function stubHomeRect() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return {
      ...HOME,
      right: HOME.left + HOME.width,
      bottom: HOME.top + HOME.height,
      x: HOME.left,
      y: HOME.top,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

function storedRaw(): string | null {
  return window.localStorage.getItem(MAGNET_LAYOUT_KEY);
}

function panel(id: string) {
  return screen.getByTestId(`magnet-${id}`);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('magnetize persist roundtrip e2e (V42)', () => {
  it('detach в живой сессии → перезапись storage → новый маунт поднимает панель в тех же координатах', () => {
    stubHomeRect();
    const Panels = withMagnetize('v42a', 'PANEL A')(Dummy);

    const first = render(<Panels label="x" />);
    fireEvent.click(screen.getByTestId('magnet-detach'));
    expect(panel('v42a')).toHaveAttribute('data-floating', 'true');

    const written = readMagnetLayout().v42a;
    expect(written).toEqual({ x: HOME.left, y: HOME.top, w: HOME.width, h: HOME.height, detached: true, pinned: false });

    // «перезагрузка»: тот же компонент, свежий инстанс, storage не трогали руками
    first.unmount();
    render(<Panels label="x" />);

    expect(panel('v42a')).toHaveAttribute('data-floating', 'true');
    expect(panel('v42a').style.left).toBe(`${HOME.left}px`);
    expect(panel('v42a').style.top).toBe(`${HOME.top}px`);
    expect(panel('v42a').style.width).toBe(`${HOME.width}px`);
    // запись после remount не деградировала: тот же detached:true
    expect(readMagnetLayout().v42a).toEqual(written);
  });

  it('drag-position переживает перезагрузку бит-в-бит', async () => {
    stubHomeRect();
    const Panels = withMagnetize('v42b', 'PANEL B')(Dummy);

    render(<Panels label="x" />);
    fireEvent.mouseDown(screen.getByTestId('magnet-handle'), {
      button: 0, clientX: HOME.left + 5, clientY: HOME.top + 5,
    });
    fireEvent.mouseMove(window, { clientX: HOME.left + 205, clientY: HOME.top + 155 });
    fireEvent.mouseUp(window);
    await waitFor(() => expect(panel('v42b')).toHaveAttribute('data-floating', 'true'));

    const afterDrag = readMagnetLayout().v42b;
    expect(afterDrag).toMatchObject({ x: HOME.left + 200, y: HOME.top + 150, detached: true });

    cleanup();
    render(<Panels label="x" />);
    expect(panel('v42b').style.left).toBe(`${afterDrag.x}px`);
    expect(panel('v42b').style.top).toBe(`${afterDrag.y}px`);
  });

  it('соседние панели не затирают друг друга через map', () => {
    stubHomeRect();
    const A = withMagnetize('v42c-det', 'A')(Dummy);
    const B = withMagnetize('v42c-home', 'B')(Dummy);

    const view = render(
      <div>
        <A label="a" />
        <B label="b" />
      </div>,
    );
    fireEvent.click(screen.getAllByTestId('magnet-detach')[0]);
    const map = readMagnetLayout();
    expect(map['v42c-det']?.detached).toBe(true);
    expect(map['v42c-home']?.detached).toBe(false);

    view.unmount();
    render(
      <div>
        <A label="a" />
        <B label="b" />
      </div>,
    );
    expect(panel('v42c-det')).toHaveAttribute('data-floating', 'true');
    expect(panel('v42c-home')).toHaveAttribute('data-floating', 'false');
  });

  it('мусор в storage не роняет панель; чтение нормализует, а первый маунт НЕ перечёркивает сохранённые home-размеры', () => {
    stubHomeRect();
    window.localStorage.setItem(MAGNET_LAYOUT_KEY, 'это не json {');
    const A = withMagnetize('v42d', 'A')(Dummy);
    render(<A label="a" />);
    expect(panel('v42d')).toHaveAttribute('data-floating', 'false');

    // смешанная карта: битая запись, битые поля и валидная v1-запись без detached
    window.localStorage.setItem(MAGNET_LAYOUT_KEY, JSON.stringify({
      broken: 'не объект',
      also: { x: 'строка', w: null },
      legacy: { x: 40, y: 60, w: 300, h: 150 },
    }));

    // нормализация на чтении, до всякого маунта: v1 -> домой, битое -> дефолты, мусор -> нет ключа
    const before = readMagnetLayout();
    expect(before.legacy).toEqual({ x: 40, y: 60, w: 300, h: 150, detached: false, pinned: false });
    expect(before.also).toEqual({ x: 0, y: 0, w: 360, h: 220, detached: false, pinned: false });
    expect(before.broken).toBeUndefined();

    cleanup();
    const B = withMagnetize('legacy', 'L')(Dummy);
    render(<B label="l" />);
    expect(panel('legacy')).toHaveAttribute('data-floating', 'false');

    // W65: первый маунт не перечёркивает сохранённую home-запись измеренным
    // rect — размеры прошлой сессии остаются в хранилище.
    expect(readMagnetLayout().legacy).toEqual({ x: 40, y: 60, w: 300, h: 150, detached: false, pinned: false });

    // и они живые: detach после маунта даёт новые координаты + сохранённые размеры
    fireEvent.click(screen.getByTestId('magnet-detach'));
    expect(panel('legacy')).toHaveStyle({ width: '300px' });
    expect(readMagnetLayout().legacy).toEqual({
      x: HOME.left, y: HOME.top, w: 300, h: 150, detached: true, pinned: false,
    });
  });

  it('порог snap читается живой панелью из settings, а не только функцией', () => {
    stubHomeRect();
    writeMagnetSettings({ snapDistance: 400 });
    const Panels = withMagnetize('v42e', 'E')(Dummy);
    render(<Panels label="x" />);

    // смещение 200px < 400 -> домой; с дефолтным 24 осталось бы detached
    fireEvent.mouseDown(screen.getByTestId('magnet-handle'), {
      button: 0, clientX: 10, clientY: 10,
    });
    fireEvent.mouseMove(window, { clientX: 210, clientY: 210 });
    fireEvent.mouseUp(window);

    expect(panel('v42e')).toHaveAttribute('data-floating', 'false');
    expect(readMagnetLayout().v42e?.detached).toBe(false);
  });

  it('storage, который бросается, не ломает UI: detach работает в сессии', () => {
    stubHomeRect();
    // jsdom не прокидывает window.localStorage.setItem через Storage.prototype —
    // шпионим сам экземпляр, иначе проверка «код реально пытался записать» пуста.
    const boom = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const A = withMagnetize('v42f', 'F')(Dummy);
    render(<A label="f" />);
    fireEvent.click(screen.getByTestId('magnet-detach'));
    expect(panel('v42f')).toHaveAttribute('data-floating', 'true');
    expect(boom).toHaveBeenCalled();
  });
});
