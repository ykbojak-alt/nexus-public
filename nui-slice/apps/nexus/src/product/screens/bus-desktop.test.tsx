// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BusDesktopScreen } from './bus-desktop';
import type { BusStatusPayload } from '../../integrations/ai2/desktop-bridge/bus-bridge';

afterEach(cleanup);

const STATUS: BusStatusPayload = {
  windows: [
    {
      id: 'W0',
      session: 'circular-ounce',
      title: 'M.E.C.H. Blender',
      kind: 'desktop',
      state: 'WORK',
      task: '178-mech-cleanup-final.md',
      ageMin: 12,
      sendPid: 4242,
      model: 'SWE-2-MAX',
      guardReason: null,
      queue: [],
      queueCount: 0,
      held: [],
      heldCount: 0,
      sent: 3,
      sentArchive: 12,
      outbox: 44,
      inbox: 1,
      oldestAgeMin: 12,
      locked: null,
      lastDelivery: null,
    },
  ],
  health: { windows: [], totalSent: 3, totalArchive: 12, state: 'ok' },
  policy: { blocking: false, message: '', source: 'env.ps1' },
  generatedAt: 1_700_000_000,
};

const QUEUE = {
  window: 'W0',
  queue: [{ name: '150-games-hub-polish.md', ageMin: 3, size: 2048, kind: 'md', task: 'почистить', path: 'D:/<repo>/bus/queue/W0/150-games-hub-polish.md' }],
  held: [],
};

/** Мост pywebview: только bus_* методы, которые зовёт экран. */
function installBridge(overrides: Record<string, unknown> = {}) {
  const api = {
    app_info: vi.fn(async () => ({ app: 'NEXUS Bus Desktop', version: '0.1.0', platform: 'win32', desktop: true, pid: 1, busDir: 'D:/<repo>/bus' })),
    bus_status: vi.fn(async () => STATUS),
    bus_queue: vi.fn(async () => QUEUE),
    bus_watchdog_state: vi.fn(async () => ({
      running: true, pid: 7392, startedAt: '00:44:51', uptimeSec: 900,
      autostart: true, generatedAt: '2026-10-22T10:00:00', error: '',
    })),
    bus_card: vi.fn(async () => ({
      window: 'W0', name: '150-games-hub-polish.md', text: 'текст карточки', truncated: false,
    })),
    bus_policy: vi.fn(async () => ({ blocking: false, message: '', source: 'env.ps1' })),
    bus_models: vi.fn(async () => ({ models: {} })),
    bus_health: vi.fn(async () => ({ windows: [], totalSent: 3, totalArchive: 12, state: 'ok' })),
    bus_log: vi.fn(async () => ({ name: 'watch.log', lines: ['строка журнала'], total: 1 })),
    bus_outbox: vi.fn(async () => ({ replies: [] })),
    bus_outbox_index: vi.fn(async () => ({ ok: true })),
    bus_model_guard: vi.fn(async () => ({ ok: true })),
    bus_clean: vi.fn(async () => ({ ok: true, report: '' })),
    bus_requeue_lost: vi.fn(async () => ({ ok: true, counts: {}, output: '' })),
    bus_host_state: vi.fn(async () => ({ available: true, home: {}, error: '' })),
    bus_sessions: vi.fn(async () => ({ sessions: [] })),
    bus_overview: vi.fn(async () => ({ overview: {} })),
    bus_delegation: vi.fn(async () => ({ delegation: {} })),
    bus_add_task: vi.fn(async () => ({ ok: true, card: 'new.md' })),
    bus_hold: vi.fn(async () => ({ ok: true })),
    bus_unhold: vi.fn(async () => ({ ok: true })),
    bus_remove: vi.fn(async () => ({ ok: true })),
    bus_dispatch: vi.fn(async () => ({ ok: true })),
    bus_dispatch_text: vi.fn(async (window: string, _text: string) => ({
      ok: true,
      window,
      delivery: 'verified',
      detail: 'headline visible',
    })),
    bus_set_policy: vi.fn(async () => ({ ok: true })),
    bus_set_model: vi.fn(async () => ({ ok: true })),
    bus_watchdog_start: vi.fn(async () => ({ ok: true })),
    bus_watchdog_stop: vi.fn(async () => ({ ok: true })),
    bus_watchdog_pass_once: vi.fn(async () => ({ ok: true })),
    bus_crashes: vi.fn(async () => ({ crashes: [] })),
    bus_crash: vi.fn(async () => ({ name: 'crash.log', text: 'журнал', truncated: false })),
    bus_audit: vi.fn(async () => ({ entries: [] })),
    bus_sent_health: vi.fn(async () => ({ ok: true, error: '', windows: [], output: '' })),
    bus_queue_age: vi.fn(async () => ({ ok: true, error: '', rows: [], output: '' })),
    bus_trace: vi.fn(async () => ({ ok: true, report: '' })),
    bus_export_outbox: vi.fn(async () => ({ ok: true, text: '' })),
    bus_observe: vi.fn(async () => ({ windows: {} })),
    set_title: vi.fn(async () => true),
    save_text: vi.fn(async () => 'saved.txt'),
    minimize: vi.fn(async () => true),
    close_window: vi.fn(async () => true),
    open_browser: vi.fn(async () => true),
    notify: vi.fn(async () => true),
    is_frameless: vi.fn(async () => true),
    ...overrides,
  };
  (window as unknown as { pywebview?: { api?: unknown } }).pywebview = { api };
  return api;
}

describe('BusDesktopScreen — десктоп-приложение шины (W7)', () => {
  it('без моста — честная заглушка, никаких выдуманных данных', async () => {
    delete (window as unknown as { pywebview?: unknown }).pywebview;
    render(<BusDesktopScreen />);
    // мост ждёт до 1.5 c (поздний bind pywebview) — запас на таймаут ожидания.
    await waitFor(() => expect(screen.getByText('Десктоп-мост недоступен')).toBeTruthy(), { timeout: 6000 });
  });

  it('с мостом — вкладки и очередь окна из моста', async () => {
    const api = installBridge();
    render(<BusDesktopScreen />);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Дозор' })).toBeTruthy(), { timeout: 6000 });
    expect(screen.getByRole('tab', { name: 'Очередь' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Политика и модели' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Здоровье' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Ответы' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Хост AI-2' })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('bus-card-W0/150-games-hub-polish.md')).toBeTruthy());
    expect(api.bus_status).toHaveBeenCalled();
    expect(api.bus_queue).toHaveBeenCalledWith('W0');
  });

  it('текст карточки открывается по кнопке «Текст»', async () => {
    const api = installBridge();
    render(<BusDesktopScreen />);
    const row = await screen.findByTestId('bus-card-W0/150-games-hub-polish.md', {}, { timeout: 6000 });
    fireEvent.click(row.querySelector('button')!);
    await waitFor(() => expect(api.bus_card).toHaveBeenCalledWith('W0', '150-games-hub-polish.md'));
  });

  it('ошибка моста показывается честно, без фантазий', async () => {
    installBridge({ bus_status: vi.fn(async () => null) });
    render(<BusDesktopScreen />);
    await waitFor(() => expect(screen.getByText(/Состояние шины недоступно/)).toBeTruthy(), { timeout: 6000 });
    expect(screen.getByText(/Мост не вернул состояние шины/)).toBeTruthy();
  });

  it('отправляет brief в FORGE и показывает подтверждённый verdict с деталями', async () => {
    const api = installBridge({
      bus_status: vi.fn(async () => ({
        ...STATUS,
        windows: [
          ...STATUS.windows,
          { ...STATUS.windows[0], id: 'FORGE', session: 'FORGE', state: 'OBSERVED' },
        ],
      })),
    });
    render(<BusDesktopScreen />);
    // Выбираем окно FORGE перед dispatch (дефолт — W0, иначе уйдёт не туда)
    await waitFor(() => expect(screen.getByRole('button', { name: 'FORGE' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'FORGE' }));
    // dispatch-контрол живёт на вкладке «Ответы» (outbox), дефолт — «Очередь»
    fireEvent.click(screen.getByRole('tab', { name: 'Ответы' }));

    const input = await screen.findByRole('textbox', { name: 'Dispatch brief for FORGE' });
    fireEvent.change(input, { target: { value: 'Fix the smoke test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch to FORGE' }));

    await waitFor(() => {
      expect(api.bus_dispatch_text).toHaveBeenCalledWith('FORGE', 'Fix the smoke test');
    });
    expect(await screen.findByText('verified', { exact: true })).toBeTruthy();
    expect(screen.getByText('headline visible', { exact: true })).toBeTruthy();
  });
});
