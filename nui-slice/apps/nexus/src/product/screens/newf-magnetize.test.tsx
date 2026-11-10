// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  DEFAULT_SNAP_DISTANCE,
  MAGNET_LAYOUT_KEY,
  MAGNET_SETTINGS_KEY,
  MagnetizeShell,
  readMagnetLayout,
  readMagnetSettings,
  withMagnetize,
  writeMagnetLayout,
  writeMagnetSettings,
} from './newf-magnetize';

afterEach(() => { cleanup(); window.localStorage.clear(); });

const Dummy = ({ label }: { label: string }) => <div data-testid="dummy-body">{label}</div>;

describe('MagnetizeShell (W42/W45)', () => {
  it('рендерит хэндл + кнопки home/detach', () => {
    render(
      <MagnetizeShell title="PANEL" floating={false} onHome={() => {}} onDetach={() => {}} onBeginDrag={() => {}}>
        <div>body</div>
      </MagnetizeShell>,
    );
    expect(screen.getByTestId('magnet-handle')).toHaveTextContent('PANEL');
    expect(screen.getByTestId('magnet-home')).toBeInTheDocument();
    expect(screen.getByTestId('magnet-detach')).toBeInTheDocument();
  });
});

describe('withMagnetize (W42/W45/W46/W48)', () => {
  it('drag → floating + persist v2 (detached:true); double-click → домой (detached:false)', async () => {
    const Panels = withMagnetize('p1', 'PANEL 1')(Dummy);
    render(<Panels label="x" />);

    fireEvent.mouseDown(screen.getByTestId('magnet-handle'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 110, clientY: 60 });
    fireEvent.mouseUp(window);

    expect(screen.getByTestId('magnet-p1')).toHaveAttribute('data-floating', 'true');
    expect(readMagnetLayout().p1?.detached).toBe(true);

    fireEvent.doubleClick(screen.getByTestId('magnet-handle'));
    await waitFor(() => expect(screen.getByTestId('magnet-p1')).toHaveAttribute('data-floating', 'false'));
    expect(readMagnetLayout().p1?.detached).toBe(false);
  });

  it('W45: кнопка detach → floating без drag', async () => {
    const Panels = withMagnetize('p1b', 'PANEL')(Dummy);
    render(<Panels label="x" />);
    fireEvent.click(screen.getByTestId('magnet-detach'));
    expect(screen.getByTestId('magnet-p1b')).toHaveAttribute('data-floating', 'true');
    expect(readMagnetLayout().p1b?.detached).toBe(true);
  });

  it('W46: restore detached из localStorage + размеры', async () => {
    writeMagnetLayout({ p3: { x: 333, y: 222, w: 300, h: 200, detached: true } });
    const Panels = withMagnetize('p3', 'PANEL 3')(Dummy);
    render(<Panels label="x" />);
    await waitFor(() => expect(screen.getByTestId('magnet-p3')).toHaveAttribute('data-floating', 'true'));
    expect(readMagnetLayout().p3).toMatchObject({ x: 333, y: 222, w: 300, h: 200 });
  });

  it('W65: home-размеры из localStorage не перезаписываются измерением на маунте', () => {
    writeMagnetLayout({ p9: { x: 10, y: 20, w: 600, h: 400, detached: false } });
    const Panels = withMagnetize('p9', 'PANEL 9')(Dummy);
    render(<Panels label="x" />);
    expect(readMagnetLayout().p9).toMatchObject({ w: 600, h: 400, detached: false });
  });

  it('W65: после user-действия persist продолжает писать актуальную геометрию', async () => {
    writeMagnetLayout({ pA: { x: 10, y: 20, w: 600, h: 400, detached: false } });
    const Panels = withMagnetize('pA', 'PANEL A')(Dummy);
    render(<Panels label="x" />);

    // открепить → запись detached:true
    fireEvent.click(screen.getByTestId('magnet-detach'));
    expect(readMagnetLayout().pA?.detached).toBe(true);

    // вернуть домой → detached:false (live-мерка, уже не первый persist)
    fireEvent.doubleClick(screen.getByTestId('magnet-handle'));
    await waitFor(() => expect(readMagnetLayout().pA?.detached).toBe(false));
  });

  it('W67: max — на весь canvas (position fixed) и обратно', async () => {
    const Panels = withMagnetize('pM', 'PANEL M')(Dummy);
    render(<Panels label="x" />);
    expect(screen.getByTestId('magnet-pM')).not.toHaveAttribute('data-maximized');

    fireEvent.click(screen.getByTestId('magnet-max'));
    expect(screen.getByTestId('magnet-pM')).toHaveAttribute('data-maximized', 'true');
    expect(screen.getByTestId('magnet-pM').style.position).toBe('fixed');
    expect(screen.getByTestId('magnet-pM').style.width).toBe('auto');

    fireEvent.click(screen.getByTestId('magnet-max'));
    await waitFor(() => expect(screen.getByTestId('magnet-pM')).not.toHaveAttribute('data-maximized'));
  });

  it('W67: min — сворачивание в чип; restore разворачивает', async () => {
    const Panels = withMagnetize('pN', 'PANEL N')(Dummy);
    render(<Panels label="x" />);
    fireEvent.click(screen.getByTestId('magnet-min'));
    await waitFor(() => expect(screen.getByTestId('magnet-chip-pN')).toBeInTheDocument());
    expect(screen.queryByTestId('dummy-body')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('magnet-restore-pN'));
    await waitFor(() => expect(screen.queryByTestId('magnet-chip-pN')).not.toBeInTheDocument());
    expect(screen.getByTestId('dummy-body')).toBeInTheDocument();
  });

  it('W67: close — панель закрывается; reopen возвращает', async () => {
    const Panels = withMagnetize('pO', 'PANEL O')(Dummy);
    render(<Panels label="x" />);
    fireEvent.click(screen.getByTestId('magnet-close'));
    await waitFor(() => expect(screen.getByTestId('magnet-pO')).toHaveAttribute('data-closed', 'true'));
    expect(screen.queryByTestId('dummy-body')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('magnet-reopen-pO'));
    await waitFor(() => expect(screen.queryByTestId('magnet-reopen-pO')).not.toBeInTheDocument());
    expect(screen.getByTestId('dummy-body')).toBeInTheDocument();
  });

  it('W67: pin — всегда поверх (data-pinned) и персистится', async () => {
    writeMagnetLayout({ pP: { x: 10, y: 20, w: 400, h: 300, detached: true } });
    const Panels = withMagnetize('pP', 'PANEL P')(Dummy);
    render(<Panels label="x" />);
    expect(screen.getByTestId('magnet-pP')).toHaveAttribute('data-floating', 'true');
    expect(screen.getByTestId('magnet-pP')).not.toHaveAttribute('data-pinned');

    fireEvent.click(screen.getByTestId('magnet-pin'));
    expect(screen.getByTestId('magnet-pP')).toHaveAttribute('data-pinned', 'true');
    expect(screen.getByTestId('magnet-pin')).toHaveAttribute('aria-pressed', 'true');
    expect(readMagnetLayout().pP?.pinned).toBe(true);

    cleanup();
    render(<Panels label="x" />);
    await waitFor(() => expect(screen.getByTestId('magnet-pP')).toHaveAttribute('data-pinned', 'true'));
  });

  it('W48: snap-порог из settings (больше 24px); default 24', async () => {
    writeMagnetSettings({ snapDistance: 60 });
    const Panels = withMagnetize('p4', 'PANEL')(Dummy);
    render(<Panels label="x" />);

    fireEvent.mouseDown(screen.getByTestId('magnet-handle'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 50 }); // ~56px — в пределах 60
    fireEvent.mouseUp(window);

    expect(screen.getByTestId('magnet-p4')).toHaveAttribute('data-floating', 'false');
    expect(readMagnetSettings().snapDistance).toBe(60);
    expect(DEFAULT_SNAP_DISTANCE).toBe(24);
  });
});
