// @vitest-environment jsdom
/**
 * Волна XVI — правая докинг-панель: режимы hidden/push/fullscreen,
 * вкладки из слота rightbar.tabs, разделение, состояние на сессию.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/home',
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('../data-source', () => ({
  getDataSourceKind: () => 'mock',
  getDataSource: () => ({}), // seam'ов нет — вкладки показывают честный unavailable
  useDataSource: () => ({}), // seam'ов нет — вкладки показывают честный unavailable,
}));

import { RightDockToggle, useDockExit, useRightDock, type DockMode } from './right-dock';
import { RightDockPanel } from './right-dock-panel';
import { getPluginHost, resetPluginHost } from './plugin-host';
import './builtin';

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetPluginHost();
});

function Rig() {
  const dock = useRightDock();
  return (
    <>
      <RightDockToggle dock={dock} />
      {dock.state.mode !== 'hidden' && <RightDockPanel dock={dock} />}
    </>
  );
}

// W4-1008: rig с exit keep-alive — паттерн, который использует AppShell.
function ExitRig() {
  const dock = useRightDock();
  const exitMode = useDockExit(dock);
  const shown = dock.state.mode !== 'hidden' ? dock.state.mode : exitMode;
  return (
    <>
      <RightDockToggle dock={dock} />
      {shown != null && (
        <RightDockPanel
          dock={
            dock.state.mode === 'hidden'
              ? { ...dock, state: { ...dock.state, mode: shown as DockMode } }
              : dock
          }
          exiting={dock.state.mode === 'hidden'}
        />
      )}
    </>
  );
}

describe('Правая докинг-панель', () => {
  it('скрыта по умолчанию; тогл в топбаре открывает push с первой вкладкой', async () => {
    render(<Rig />);
    expect(screen.queryByTestId('right-dock')).toBeNull();
    await userEvent.click(screen.getByTestId('right-dock-toggle'));
    const dock = await screen.findByTestId('right-dock');
    expect(dock.getAttribute('data-mode')).toBe('push');
    // вкладки из слота: «Сессии» открыта, «Окна шины» — в списке +вкладка
    expect(screen.getByRole('tab', { name: 'Сессии' })).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Открыть вкладку'), 'windows');
    expect(screen.getByRole('tab', { name: 'Окна шины' })).toBeTruthy();
  });

  it('Ctrl+B открывает и закрывает панель', async () => {
    render(<Rig />);
    await userEvent.keyboard('{Control>}b{/Control}');
    expect(await screen.findByTestId('right-dock')).toBeTruthy();
    await userEvent.keyboard('{Control>}b{/Control}');
    expect(screen.queryByTestId('right-dock')).toBeNull();
  });

  it('NQ-104: клавиатурное открытие переносит фокус В панель', async () => {
    render(<Rig />);
    await userEvent.keyboard('{Control>}b{/Control}');
    const dock = await screen.findByTestId('right-dock');
    await waitFor(() => expect(dock.contains(document.activeElement)).toBe(true));
  });

  it('NQ-104: открытие кликом по триггеру тоже переносит фокус в панель', async () => {
    const user = userEvent.setup();
    render(<Rig />);
    await user.click(screen.getByTestId('right-dock-toggle'));
    const dock = await screen.findByTestId('right-dock');
    await waitFor(() => expect(dock.contains(document.activeElement)).toBe(true));
  });

  it('NQ-104: Ctrl+B закрытие возвращает фокус на pre-hotkey invoker (композитор)', async () => {
    render(
      <>
        <textarea id="probe-task" aria-label="Текст задачи" />
        <Rig />
      </>,
    );
    const composer = screen.getByLabelText('Текст задачи');
    composer.focus();
    await userEvent.keyboard('{Control>}b{/Control}');
    const dock = await screen.findByTestId('right-dock');
    await waitFor(() => expect(dock.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Control>}b{/Control}');
    await waitFor(() => expect(screen.queryByTestId('right-dock')).toBeNull());
    await waitFor(() => expect(composer).toHaveFocus());
  });

  it('NQ-104: без invoker и композитора закрытие хоткеем возвращает фокус на триггер', async () => {
    render(<Rig />);
    await userEvent.keyboard('{Control>}b{/Control}');
    await screen.findByTestId('right-dock');
    await userEvent.keyboard('{Control>}b{/Control}');
    await waitFor(() => expect(screen.queryByTestId('right-dock')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('right-dock-toggle')).toHaveFocus());
  });

  it('NQ-104: session-restore не крадёт фокус (openFocus только по пользовательским путям)', async () => {
    sessionStorage.setItem('nexus.rightbar.v1', JSON.stringify({
      mode: 'push', open: ['sessions'], active: 'sessions', split: null, width: null,
    }));
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    render(<Rig />);
    const dock = await screen.findByTestId('right-dock');
    expect(dock.getAttribute('data-mode')).toBe('push');
    await new Promise((r) => setTimeout(r, 50));
    expect(dock.contains(document.activeElement)).toBe(false);
    outside.remove();
  });

  it('NQ-104: slim→push возвращает фокус на invoker без регрессий', async () => {
    const user = userEvent.setup();
    render(<Rig />);
    const toggle = screen.getByTestId('right-dock-toggle');
    await user.click(toggle);
    await screen.findByTestId('right-dock');
    await user.click(screen.getByRole('button', { name: 'Свернуть панель в полосу' }));
    const slim = await screen.findByTestId('right-dock');
    expect(slim.getAttribute('data-mode')).toBe('slim');
    await user.click(screen.getByRole('button', { name: 'Развернуть панель' }));
    await waitFor(() => expect(screen.getByTestId('right-dock').getAttribute('data-mode')).toBe('push'));
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it('Alt+B скрывает видимую панель и возвращает к push (NQ-097)', async () => {
    render(<Rig />);
    await userEvent.click(screen.getByTestId('right-dock-toggle'));
    const dock = await screen.findByTestId('right-dock');
    expect(dock.getAttribute('data-mode')).toBe('push');
    await userEvent.keyboard('{Alt>}b{/Alt}');
    expect(screen.queryByTestId('right-dock')).toBeNull();
    await userEvent.keyboard('{Alt>}b{/Alt}');
    const back = await screen.findByTestId('right-dock');
    expect(back.getAttribute('data-mode')).toBe('push');
  });

  it('Escape and close restore focus to the dock trigger; outside click closes too', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Rig />
        <button type="button" data-testid="outside-control">Вне панели</button>
      </>,
    );
    const toggle = screen.getByTestId('right-dock-toggle');
    await user.click(toggle);
    const dock = await screen.findByTestId('right-dock');
    dock.querySelector<HTMLElement>('button')?.focus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('right-dock')).toBeNull());
    await waitFor(() => expect(toggle).toHaveFocus());

    await user.click(toggle);
    await screen.findByTestId('right-dock');
    await user.click(screen.getByTestId('outside-control'));
    await waitFor(() => expect(screen.queryByTestId('right-dock')).toBeNull());
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it('cancels the one-frame focus restore if the dock owner unmounts first', async () => {
    const user = userEvent.setup();
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(73);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const view = render(<Rig />);
    await user.click(screen.getByTestId('right-dock-toggle'));
    const dock = await screen.findByTestId('right-dock');
    dock.querySelector<HTMLElement>('button')?.focus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('right-dock')).toBeNull());
    expect(frame).toHaveBeenCalled();

    view.unmount();
    expect(cancel).toHaveBeenCalledWith(73);
  });

  it('cancels the slim-mode focus frame on owner unmount', async () => {
    const user = userEvent.setup();
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(91);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const view = render(<Rig />);
    await user.click(screen.getByTestId('right-dock-toggle'));
    await screen.findByTestId('right-dock');
    await user.click(screen.getByRole('button', { name: 'Свернуть панель в полосу' }));
    await waitFor(() => expect(frame).toHaveBeenCalled());

    view.unmount();
    expect(cancel).toHaveBeenCalledWith(91);
  });

  it('wraps Tab and Shift+Tab inside the visible dock', async () => {
    const user = userEvent.setup();
    render(<Rig />);
    await user.click(screen.getByTestId('right-dock-toggle'));
    const dock = await screen.findByTestId('right-dock');
    const controls = dock.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    expect(controls.length).toBeGreaterThan(1);
    const first = controls[0];
    const last = controls[controls.length - 1];

    last.focus();
    await user.tab();
    expect(first).toHaveFocus();
    first.focus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('закрытие вкладки убирает её; последняя закрытая прячет панель', async () => {
    render(<Rig />);
    await userEvent.click(screen.getByTestId('right-dock-toggle'));
    await screen.findByTestId('right-dock');
    // открываем вторую вкладку, чтобы проверить обе
    await userEvent.selectOptions(screen.getByLabelText('Открыть вкладку'), 'windows');
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть вкладку «Сессии»' }));
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть вкладку «Окна шины»' }));
    expect(screen.queryByTestId('right-dock')).toBeNull();
  });

  it('fullscreen-режим: кнопка шапки переключает data-mode', async () => {
    render(<Rig />);
    await userEvent.click(screen.getByTestId('right-dock-toggle'));
    const dock = await screen.findByTestId('right-dock');
    await userEvent.click(screen.getByRole('button', { name: 'Панель во весь экран' }));
    expect(dock.getAttribute('data-mode')).toBe('fullscreen');
    await userEvent.click(screen.getByRole('button', { name: 'Выйти из полноэкранного режима' }));
    expect(dock.getAttribute('data-mode')).toBe('push');
  });

  it('разделение: сплит-кнопка показывает вторую вкладку рядом', async () => {
    render(<Rig />);
    await userEvent.click(screen.getByTestId('right-dock-toggle'));
    await screen.findByTestId('right-dock');
    await userEvent.selectOptions(screen.getByLabelText('Открыть вкладку'), 'windows');
    await userEvent.click(screen.getByRole('button', { name: 'Разделить панель' }));
    const panels = screen.getAllByRole('tabpanel');
    expect(panels).toHaveLength(2);
  });

  it('состояние пишется в sessionStorage и читается новым хуком', async () => {
    const { unmount } = render(<Rig />);
    await userEvent.click(screen.getByTestId('right-dock-toggle'));
    await screen.findByTestId('right-dock');
    unmount();
    const raw = JSON.parse(sessionStorage.getItem('nexus.rightbar.v1')!);
    expect(raw.mode).toBe('push');
    expect(raw.open).toContain('sessions');
    render(<Rig />);
    expect(await screen.findByTestId('right-dock')).toBeTruthy();
  });

  it('восстанавливает sessionStorage после SSR-safe первого кадра', async () => {
    sessionStorage.setItem('nexus.rightbar.v1', JSON.stringify({
      mode: 'push', open: ['sessions'], active: 'sessions', split: null, width: null,
    }));
    const markup = renderToString(<Rig />);
    expect(markup).not.toContain('data-testid="right-dock"');
    render(<Rig />);
    expect((await screen.findByTestId('right-dock')).getAttribute('data-mode')).toBe('push');
  });

  it('выключение плагина вкладок честно закрывает сирот', async () => {
    render(<Rig />);
    await userEvent.click(screen.getByTestId('right-dock-toggle'));
    await screen.findByTestId('right-dock');
    getPluginHost().setPluginEnabled('nexus.rightbar-tabs', false);
    await waitFor(() => expect(screen.queryByTestId('right-dock')).toBeNull());
  });

  it('W4-1008: slideOut keep-alive — панель инертна в окне выхода и размонтируется после', async () => {
    render(<ExitRig />);
    fireEvent.click(screen.getByTestId('right-dock-toggle'));
    const dock = await screen.findByTestId('right-dock');
    expect(dock.getAttribute('data-mode')).toBe('push');

    fireEvent.click(screen.getByRole('button', { name: /Закрыть панель/ }));
    // Keep-alive: режим заморожен, панель ещё в DOM, но инертна.
    const exiting = await screen.findByTestId('right-dock');
    expect(exiting.getAttribute('data-exit')).toBe('true');
    expect(exiting.getAttribute('inert')).not.toBeNull();
    await waitFor(() => expect(screen.queryByTestId('right-dock')).toBeNull());
  });

  it('W4-1008: reduced-motion → мгновенный unmount без exit-кадра', async () => {
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as MediaQueryList);
    try {
      render(<ExitRig />);
      fireEvent.click(screen.getByTestId('right-dock-toggle'));
      await screen.findByTestId('right-dock');
      fireEvent.click(screen.getByRole('button', { name: /Закрыть панель/ }));
      expect(screen.queryByTestId('right-dock')).toBeNull();
    } finally {
      mm.mockRestore();
    }
  });

  it('W4-1008: повторное открытие в окне exit снимает keep-alive', async () => {
    render(<ExitRig />);
    fireEvent.click(screen.getByTestId('right-dock-toggle'));
    await screen.findByTestId('right-dock');
    fireEvent.click(screen.getByRole('button', { name: /Закрыть панель/ }));
    expect((await screen.findByTestId('right-dock')).getAttribute('data-exit')).toBe('true');
    fireEvent.click(screen.getByTestId('right-dock-toggle'));
    const back = await screen.findByTestId('right-dock');
    expect(back.getAttribute('data-mode')).toBe('push');
    expect(back.getAttribute('data-exit')).toBeNull();
    expect(back.getAttribute('inert')).toBeNull();
  });
});
