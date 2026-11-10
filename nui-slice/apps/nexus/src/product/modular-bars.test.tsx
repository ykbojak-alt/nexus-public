// @vitest-environment jsdom
/** Модульные бары NUE: каждый край — move/collapse/close/restore/resize.
 *  Хром — кнопки BarTools (⇄ ▾ ×), возврат — BarEdge у края, ресайз —
 *  pointer-drag. Состояние живёт в профиле (localStorage). */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProfile } from './profile/profile-types';
import { loadProfile, resetProfileStore, saveProfile } from './profile/profile-store';

const push = vi.fn();
const navState = vi.hoisted(() => ({ pathname: '/runtime' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navState.pathname,
  useRouter: () => ({ push, replace: vi.fn() }),
}));

import { AppShell } from './app-shell';
import './palette-lazy';

afterEach(() => {
  cleanup();
  navState.pathname = '/runtime';
  // Бар-состояние живёт в профиле/сессии — сбрасываем, чтобы тесты не
  // наследовали скрытые/перенесённые бары друг друга.
  resetProfileStore();
  saveProfile(createEmptyProfile());
  try { window.sessionStorage.clear(); } catch { /* jsdom */ }
});

function shellWrap(): HTMLElement {
  return (screen.getByTestId('window-frame') as HTMLElement).closest('[data-nav]') as HTMLElement;
}

describe('Модульные бары NUE', () => {
  it('шапка: ⇄ переносит вниз и обратно, слоты не дублируются', () => {
    render(<AppShell>x</AppShell>);
    // header вверху: role=banner виден, нижнего дока шапки нет.
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.queryByTestId('topbar-bottom')).toBeNull();

    fireEvent.click(screen.getByLabelText('Шапку вниз'));
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.getByTestId('topbar-bottom')).toBeTruthy();
    expect(loadProfile()?.bars?.top?.side).toBe('bottom');
    // Нижняя строка подсказок снята (2026-10-29): слот belowTop больше не
    // заполняется — под перенесённой шапкой ничего нет.
    const wrap = shellWrap();
    expect(wrap.querySelector('[class*="frameBelowTop"]')).toBeNull();
    expect(screen.queryByText(/Alt\+1/)).toBeNull();

    fireEvent.click(screen.getByLabelText('Шапку наверх'));
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.queryByTestId('topbar-bottom')).toBeNull();
  });

  it('шапка: ▾ сворачивает до 44px, ▴ разворачивает', () => {
    render(<AppShell>x</AppShell>);
    fireEvent.click(screen.getByLabelText('Свернуть шапку в тонкую полосу'));
    expect(shellWrap().style.getPropertyValue('--nexus-window-frame-header-height')).toBe('44px');
    expect(loadProfile()?.bars?.top?.mode).toBe('slim');
    fireEvent.click(screen.getByLabelText('Развернуть шапку'));
    expect(shellWrap().style.getPropertyValue('--nexus-window-frame-header-height')).toBe('72px');
  });

  it('шапка: × закрывает, полоса у края возвращает', () => {
    render(<AppShell>x</AppShell>);
    fireEvent.click(screen.getByLabelText('Закрыть шапку (вернуть — полоса у края)'));
    expect(screen.queryByRole('banner')).toBeNull();
    expect(loadProfile()?.bars?.top?.mode).toBe('hidden');
    const edge = screen.getByTestId('bar-edge-top');
    fireEvent.click(edge);
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(loadProfile()?.bars?.top?.mode).toBe('full');
  });

  it('нижняя строка подсказок не рендерится: хоткеи живут в палитре', () => {
    render(<AppShell>x</AppShell>);
    // Аннотация владельца 2026-10-29: бар Alt+1…8 / Ctrl+B / Enter снят,
    // футер кадра пуст, пока шапка не перенесена вниз.
    expect(screen.queryByText(/Alt\+1/)).toBeNull();
    expect(screen.queryByTestId('bar-edge-bottom')).toBeNull();
    const wrap = shellWrap();
    expect(wrap.querySelector('[class*="frameBottom"]')).toBeNull();
    expect(wrap.querySelector('[class*="frameBelowTop"]')).toBeNull();
  });

  it('навигация: ⇄ переносит рейл направо, data-nav едет на правую колонку', () => {
    render(<AppShell>x</AppShell>);
    const frame = screen.getByTestId('window-frame');
    // Слева — единственная aside несёт data-nav и стоит ПЕРЕД main.
    const asidesBefore = Array.from(frame.querySelectorAll('aside'));
    expect(asidesBefore).toHaveLength(1);
    expect(asidesBefore[0]?.getAttribute('data-nav')).toBe('full');
    expect(asidesBefore[0]?.nextElementSibling?.tagName).toBe('MAIN');

    fireEvent.click(screen.getByLabelText('Навигацию вправо'));
    const asides = Array.from(frame.querySelectorAll('aside'));
    const navAside = asides.find((a) => a.hasAttribute('data-nav'))!;
    // Теперь колонка с data-nav стоит ПОСЛЕ main — правая.
    expect(navAside.getAttribute('data-nav')).toBe('full');
    expect(navAside.previousElementSibling?.tagName).toBe('MAIN');
    expect(loadProfile()?.bars?.nav?.side).toBe('right');
    // Контент рейла реально в правой колонке.
    expect(within(navAside as HTMLElement).getByRole('navigation', { name: 'Разделы' })).toBeTruthy();
  });

  it('навигация: hidden → railOut keep-alive кадр, затем полоса-возврат у края', async () => {
    render(<AppShell>x</AppShell>);
    fireEvent.click(screen.getByLabelText('Скрыть навигацию (вернуть — полоса у края)'));
    // railMotion railOut: рейл держится на окно выхода — инертный кадр
    // (inert скрывает его у AT — ищем по attr, не по role).
    const exiting = document.querySelector('[data-nav-exit]');
    expect(exiting).toBeTruthy();
    expect(exiting!.hasAttribute('inert')).toBe(true);
    expect(exiting!.querySelector('[data-testid="icon-rail"], [data-testid="rail-strip"]')).toBeTruthy();
    expect(screen.getByTestId('bar-edge-left')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-nav-exit]')).toBeNull());
    fireEvent.click(screen.getByTestId('bar-edge-left'));
    expect(screen.getByRole('navigation', { name: 'Разделы' })).toBeTruthy();
    expect(loadProfile()?.navMode).toBe('full');
  });

  it('док: slim — иконополоса 48px, разворот возвращает push', async () => {
    render(<AppShell>x</AppShell>);
    // Поднимаем док хоткеем Ctrl+B.
    act(() => {
      fireEvent.keyDown(document, { key: 'b', ctrlKey: true });
    });
    const dock = await screen.findByTestId('right-dock', undefined, { timeout: 5000 });
    fireEvent.click(within(dock).getByLabelText('Свернуть панель в полосу'));
    expect(screen.getByTestId('right-dock').getAttribute('data-mode')).toBe('slim');
    expect(shellWrap().style.getPropertyValue('--nexus-window-frame-right-width')).toBe('48px');
    fireEvent.click(within(screen.getByTestId('right-dock')).getByLabelText('Развернуть панель'));
    expect(screen.getByTestId('right-dock').getAttribute('data-mode')).toBe('push');
  });

  it('док: hidden → keep-alive exit-кадр, затем полоса-возврат у правого края', async () => {
    render(<AppShell>x</AppShell>);
    act(() => {
      fireEvent.keyDown(document, { key: 'b', ctrlKey: true });
    });
    await screen.findByTestId('right-dock', undefined, { timeout: 5000 });
    act(() => {
      fireEvent.keyDown(document, { key: 'b', ctrlKey: true });
    });
    // dockMotion slideOut: панель держится на окно выхода — инертный кадр.
    const exiting = screen.getByTestId('right-dock');
    expect(exiting.getAttribute('data-exit')).toBe('true');
    expect(exiting.hasAttribute('inert')).toBe(true);
    expect(screen.getByTestId('bar-edge-right')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('right-dock')).toBeNull());
  });

  it('ресайз шапки: pointer-drag на кромке меняет --nexus-window-frame-header-height', () => {
    render(<AppShell>x</AppShell>);
    const handle = screen.getByLabelText('Высота шапки — тянуть или стрелки ↑/↓');
    // jsdom без PointerEvent: координаты несёт MouseEvent с типом pointer*.
    fireEvent(handle, new MouseEvent('pointerdown', { button: 0, clientY: 100, bubbles: true }));
    fireEvent(window, new MouseEvent('pointermove', { clientY: 120 }));
    fireEvent(window, new MouseEvent('pointerup', {}));
    expect(shellWrap().style.getPropertyValue('--nexus-window-frame-header-height')).toBe('92px');
    expect(loadProfile()?.bars?.top?.height).toBe(92);
  });

  it('grip отрывает бар в свободную позицию, Arrow двигает, повторный drag докит у края', () => {
    render(<AppShell>x</AppShell>);
    const shell = document.querySelector<HTMLElement>('[data-app-shell]')!;
    const header = shell.querySelector<HTMLElement>('[data-bar-surface="top"]')!;
    const asRect = (left: number, top: number, width: number, height: number) => ({
      x: left, y: top, left, top, width, height, right: left + width, bottom: top + height,
      toJSON: () => ({}),
    }) as DOMRect;
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(asRect(0, 0, 1000, 700));
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(asRect(12, 12, 700, 72));
    const gripName = /Переместить шапку/;
    const grip = screen.getByRole('button', { name: gripName });
    fireEvent(grip, new MouseEvent('pointerdown', { button: 0, clientX: 30, clientY: 30, bubbles: true }));
    fireEvent(window, new MouseEvent('pointermove', { clientX: 150, clientY: 140 }));
    fireEvent(window, new MouseEvent('pointerup', { clientX: 150, clientY: 140 }));

    expect(loadProfile()?.bars?.top?.position).toEqual({ x: 132, y: 122 });
    const floatingBar = shell.querySelector<HTMLElement>('[data-bar-id="top"]');
    expect(floatingBar).toBeTruthy();
    const xBefore = loadProfile()?.bars?.top?.position?.x;
    fireEvent.keyDown(within(floatingBar!).getByRole('button', { name: gripName }), { key: 'ArrowRight' });
    expect(loadProfile()?.bars?.top?.position?.x).toBe((xBefore ?? 0) + 16);

    vi.spyOn(floatingBar!, 'getBoundingClientRect').mockReturnValue(asRect(164, 122, 700, 72));
    const dockGrip = within(floatingBar!).getByRole('button', { name: gripName });
    fireEvent(dockGrip, new MouseEvent('pointerdown', { button: 0, clientX: 180, clientY: 130, bubbles: true }));
    fireEvent(window, new MouseEvent('pointermove', { clientX: 180, clientY: 13 }));
    fireEvent(window, new MouseEvent('pointerup', { clientX: 180, clientY: 13 }));
    expect(loadProfile()?.bars?.top?.position).toBeNull();
    expect(shell.querySelector('[data-bar-id="top"]')).toBeNull();
    expect(screen.getByRole('banner')).toBeTruthy();
  });

  it('dragLift: data-drag-lift ставится после порога 4px и снимается на pointerup', () => {
    render(<AppShell>x</AppShell>);
    const shell = document.querySelector<HTMLElement>('[data-app-shell]')!;
    const header = shell.querySelector<HTMLElement>('[data-bar-surface="top"]')!;
    const asRect = (left: number, top: number, width: number, height: number) => ({
      x: left, y: top, left, top, width, height, right: left + width, bottom: top + height,
      toJSON: () => ({}),
    }) as DOMRect;
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(asRect(0, 0, 1000, 700));
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(asRect(12, 12, 700, 72));
    const grip = screen.getByRole('button', { name: /Переместить шапку/ });
    fireEvent(grip, new MouseEvent('pointerdown', { button: 0, clientX: 30, clientY: 30, bubbles: true }));
    // Подпороговое движение — drag ещё не начался, lift нет.
    fireEvent(window, new MouseEvent('pointermove', { clientX: 32, clientY: 31 }));
    expect(header.hasAttribute('data-drag-lift')).toBe(false);
    expect(header.hasAttribute('data-bar-id')).toBe(false);
    // Порог преодолён — поверхность оторвалась и поднялась.
    fireEvent(window, new MouseEvent('pointermove', { clientX: 150, clientY: 140 }));
    expect(header.getAttribute('data-drag-lift')).toBe('');
    fireEvent(window, new MouseEvent('pointerup', { clientX: 150, clientY: 140 }));
    // После drop поверхность ушла в float — новый узел без lift-атрибута.
    const floatingBar = shell.querySelector<HTMLElement>('[data-bar-id="top"]');
    expect(floatingBar).toBeTruthy();
    expect(floatingBar!.hasAttribute('data-drag-lift')).toBe(false);
  });

  it('отмена drag снимает lift и восстанавливает поверхность без коммита', () => {
    render(<AppShell>x</AppShell>);
    const shell = document.querySelector<HTMLElement>('[data-app-shell]')!;
    const header = shell.querySelector<HTMLElement>('[data-bar-surface="top"]')!;
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
      x: 12, y: 12, left: 12, top: 12, width: 700, height: 72, right: 712, bottom: 84,
      toJSON: () => ({}),
    } as DOMRect);
    const grip = screen.getByRole('button', { name: /Переместить шапку/ });
    fireEvent(grip, new MouseEvent('pointerdown', { button: 0, clientX: 30, clientY: 30, bubbles: true }));
    fireEvent(window, new MouseEvent('pointermove', { clientX: 150, clientY: 140 }));
    expect(header.getAttribute('data-drag-lift')).toBe('');
    fireEvent(window, new MouseEvent('pointercancel', {}));
    expect(header.hasAttribute('data-drag-lift')).toBe(false);
    expect(document.body.hasAttribute('data-bar-floating-drag')).toBe(false);
    // Отмена — не commit: позиция не записалась, бар остался в доке.
    expect(loadProfile()?.bars?.top?.position).toBeUndefined();
    expect(shell.querySelector('[data-bar-id="top"]')).toBeNull();
  });

  it('состояние переживает remount: скрытая шапка не возвращается сама', () => {
    saveProfile({ ...createEmptyProfile(), bars: { top: { mode: 'hidden' } } });
    render(<AppShell>x</AppShell>);
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.getByTestId('bar-edge-top')).toBeTruthy();
    cleanup();
    render(<AppShell>x</AppShell>);
    expect(screen.queryByRole('banner')).toBeNull();
  });

  it('bar surfaces float from blank space while interactive controls stay usable', () => {
    render(<AppShell>x</AppShell>);
    const shell = document.querySelector<HTMLElement>('[data-app-shell]')!;
    const header = shell.querySelector<HTMLElement>('[data-bar-surface="top"]')!;
    const asRect = (left: number, top: number, width: number, height: number) => ({
      x: left, y: top, left, top, width, height, right: left + width, bottom: top + height,
      toJSON: () => ({}),
    }) as DOMRect;
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(asRect(0, 0, 1000, 700));
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(asRect(12, 12, 700, 72));

    const opacity = screen.getByTestId('window-opacity').querySelector('input')!;
    fireEvent(opacity, new MouseEvent('pointerdown', { button: 0, clientX: 300, clientY: 30, bubbles: true }));
    expect(document.body.hasAttribute('data-bar-floating-drag')).toBe(false);

    fireEvent(header, new MouseEvent('pointerdown', { button: 0, clientX: 30, clientY: 30, bubbles: true }));
    fireEvent(window, new MouseEvent('pointermove', { clientX: 130, clientY: 100 }));
    fireEvent(window, new MouseEvent('pointerup', { clientX: 130, clientY: 100 }));

    expect(loadProfile()?.bars?.top?.position).toEqual({ x: 112, y: 82 });
    expect(shell.querySelector('[data-bar-id="top"]')).toBeTruthy();
  });
});
