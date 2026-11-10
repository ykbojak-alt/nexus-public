// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/mission-control',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

import { MissionControlScreen, NEXUSLINK_STATUS_URL } from './mission-control';

// Минимальный честный снимок /api/status (форма — из живого эндпоинта).
const SNAPSHOT = {
  version: '0.2.1',
  ok: true,
  port: 5679,
  uptime_s: 71949,
  token_set: true,
  providers: 7,
  slots: 8,
  keys_health: [
    { key: 'abc123', provider: 'Inception', ready: true, benched: false, exhausted: false, next_ready_in_s: 0 },
    { key: 'def456', provider: 'OpenRouter', ready: false, benched: true, exhausted: false, next_ready_in_s: 12 },
    { key: 'ghi789', provider: 'Agnes', ready: false, benched: false, exhausted: true, next_ready_in_s: 300 },
  ],
  slots_health: [
    { slot: 'claude-opus-5', model: 'mercury-3', ready: 3, benched: 0, blocked: null, candidates: null, next_ready_in_s: 0, exhausted: false },
    { slot: 'claude-sonnet-5', model: 'recursive/flint-v1.0:free', ready: 0, benched: 2, candidates: null, next_ready_in_s: 5, exhausted: false },
    { slot: 'claude-haiku-4-5', model: 'agnes-3.0-flash', ready: 0, benched: 0, candidates: null, next_ready_in_s: 0, exhausted: true },
    { slot: 'claude-opus-4-6', model: 'stealth/crouton-alpha', ready: 0, benched: 0, blocked: 5, candidates: null, next_ready_in_s: 0, exhausted: false },
  ],
  metrics: [
    { scope: 'Ollama-Beam|beam:cloud|ollama', ok: 1098, fail: 0, avg_ms: 979, last_ms: 788, last_ttfb_ms: 787, age_s: 650, note: '' },
    { scope: 'Inception|mercury-3|dc6d21', ok: 580, fail: 0, avg_ms: 2590, last_ms: 3359, last_ttfb_ms: 3358, age_s: 2, note: '' },
    { scope: 'Agnes|agnes-3.0-flash|YCC1bL', ok: 0, fail: 480, avg_ms: 658, last_ms: 1114, last_ttfb_ms: 1114, age_s: 47, note: 'upstream HTTP 400' },
  ],
  blacklist: [],
};

const jsonResponse = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(async () => jsonResponse(SNAPSHOT));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('MissionControlScreen — дашборд Nexus Link (NUE-3)', () => {
  it('заголовок экрана и единственный источник статуса — /api/status', async () => {
    render(<MissionControlScreen pollMs={60000} />);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Nexus Link');
    expect(fetchSpy).toHaveBeenCalledWith(
      NEXUSLINK_STATUS_URL,
      expect.objectContaining({ method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store' }),
    );
  });

  it('loading: до ответа — честный индикатор подключения', async () => {
    let resolveSnapshot!: (body: unknown) => void;
    const pending = new Promise<unknown>((resolve) => { resolveSnapshot = resolve; });
    fetchSpy.mockImplementation(() => pending.then((body) => jsonResponse(body)));

    render(<MissionControlScreen pollMs={60000} />);
    expect(screen.getByText('Подключение к Nexus Link…')).toBeTruthy();
    expect(screen.getByTestId('panel-skeleton')).toBeTruthy();

    resolveSnapshot(SNAPSHOT);
    expect(await screen.findByTestId('nx-status-line')).toBeTruthy();
  });

  it('online: сводка KPI — version/uptime/провайдеры/слоты/ключи/ok', async () => {
    render(<MissionControlScreen pollMs={60000} />);

    const statusLine = await screen.findByTestId('nx-status-line');
    expect(statusLine.textContent).toContain('онлайн · v0.2.1');
    expect(statusLine.textContent).toContain('ключи заданы');

    expect(screen.getByTestId('kpi-version').textContent).toContain('0.2.1');
    // 71949 с ≈ 19 ч 59 мин.
    expect(screen.getByTestId('kpi-uptime').textContent).toContain('19 ч');
    expect(screen.getByTestId('kpi-providers').textContent).toContain('7');
    expect(screen.getByTestId('kpi-slots').textContent).toContain('8');
    expect(screen.getByTestId('kpi-token').textContent).toContain('ЗАДАНЫ');
    expect(screen.getByTestId('kpi-ok').textContent).toContain('НОРМА');
  });

  it('провайдеры группируются из keys_health: готово/benched/exhausted', async () => {
    render(<MissionControlScreen pollMs={60000} />);

    const inception = await screen.findByTestId('provider-Inception');
    expect(inception.textContent).toContain('1/1 готово');

    const openRouter = screen.getByTestId('provider-OpenRouter');
    expect(openRouter.textContent).toContain('0/1 готово · 1 benched');

    const agnes = screen.getByTestId('provider-Agnes');
    expect(agnes.textContent).toContain('1 exhausted');
  });

  it('ключи: 19-реестр показывает готов/benched/exhausted + next_ready_in_s', async () => {
    render(<MissionControlScreen pollMs={60000} />);

    const ready = await screen.findByTestId('key-abc123');
    expect(ready.textContent).toContain('готов');
    expect(ready.textContent).toContain('Inception');
    expect(ready.textContent).not.toContain('след. через');

    const benched = screen.getByTestId('key-def456');
    expect(benched.textContent).toContain('benched');
    expect(benched.textContent).toContain('след. через 12 с');

    const exhausted = screen.getByTestId('key-ghi789');
    expect(exhausted.textContent).toContain('exhausted');
    expect(exhausted.textContent).toContain('след. через 5 мин');
  });

  it('слоты: статус-тон и детали доступности', async () => {
    render(<MissionControlScreen pollMs={60000} />);

    const readySlot = await screen.findByTestId('slot-claude-opus-5');
    expect(readySlot.textContent).toContain('3 готово');
    expect(readySlot.getAttribute('data-state')).toBe('complete');

    const waitingSlot = screen.getByTestId('slot-claude-sonnet-5');
    expect(waitingSlot.getAttribute('data-state')).toBe('waiting');
    expect(waitingSlot.textContent).toContain('2 benched');
    expect(waitingSlot.textContent).toContain('след. через 5 с');

    const blockedSlot = screen.getByTestId('slot-claude-haiku-4-5');
    expect(blockedSlot.getAttribute('data-state')).toBe('error');

    const blockedDetails = screen.getByTestId('slot-claude-opus-4-6');
    expect(blockedDetails.getAttribute('data-state')).toBe('waiting');
    expect(blockedDetails.textContent).toContain('5 blocked');
  });

  it('метрики сортируются по числу запросов (ok+fail) убыванием', async () => {
    render(<MissionControlScreen pollMs={60000} />);

    // 1098 → 580 → 480 (Agnes fail=480).
    const first = await screen.findByTestId('metric-0');
    expect(first.textContent).toContain('Ollama-Beam');
    expect(first.textContent).toContain('1098 ok');

    const second = screen.getByTestId('metric-1');
    expect(second.textContent).toContain('Inception');

    const third = screen.getByTestId('metric-2');
    expect(third.textContent).toContain('Agnes');
    // note → безопасная классификация, без сырого текста.
    expect(third.textContent).toContain('upstream отклонил запрос');
  });

  it('blacklist: секция только при непустом списке', async () => {
    const { unmount } = render(<MissionControlScreen pollMs={60000} />);
    await screen.findByTestId('nx-status-line');
    expect(screen.queryByTestId('blacklist-panel')).toBeNull();
    unmount();

    fetchSpy.mockResolvedValue(jsonResponse({
      ...SNAPSHOT,
      blacklist: [{ entry: 'key|abc123', reason: 'upstream HTTP 429', ttl_s: 3600 }],
    }));
    render(<MissionControlScreen pollMs={60000} />);
    await screen.findByTestId('blacklist-panel');
    expect(screen.getByText('ключ временно заблокирован')).toBeTruthy();
    expect(screen.getByText(/лимит частоты/)).toBeTruthy();
  });

  it('token_set=false → честный бейдж «НЕ ЗАДАНЫ»', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ ...SNAPSHOT, token_set: false }));
    render(<MissionControlScreen pollMs={60000} />);

    await screen.findByTestId('nx-status-line');
    expect(screen.getByTestId('kpi-token').textContent).toContain('НЕ ЗАДАНЫ');
    expect(screen.getByTestId('nx-status-line').textContent).toContain('ключи НЕ заданы');
  });

  it('offline: «нет данных Nexus Link» + retry после восстановления', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    render(<MissionControlScreen pollMs={60000} />);

    expect(await screen.findByText('Nexus Link недоступен')).toBeTruthy();
    expect(screen.getByText(/Нет данных Nexus Link/)).toBeTruthy();
    expect(screen.queryByTestId('nx-status-line')).toBeNull();

    // Retry → повторный fetch → живой дашборд.
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByTestId('nx-status-line')).toBeTruthy();
    expect(screen.getByTestId('nx-status-line').textContent).toContain('онлайн · v0.2.1');
  });

  it('offline после живого снимка: честно «показан последний снимок»', async () => {
    render(<MissionControlScreen pollMs={50} />);
    await screen.findByTestId('nx-status-line');

    // Поллинг далее падает постоянно — снимок остаётся, статус offline.
    // (mockImplementation, а не mockRejectedValueOnce: один тик создавал бы
    // гонку со следующим успешным опросом.)
    fetchSpy.mockImplementation(async () => { throw new Error('timeout'); });
    await vi.waitFor(() => {
      expect(screen.getByTestId('nx-status-line').textContent).toContain('не отвечает');
    }, { timeout: 3000 });

    expect(screen.getByTestId('kpi-version').textContent).toContain('0.2.1');
    expect(screen.getByTestId('kpi-ok').textContent).toContain('последний снимок');
  });
});
