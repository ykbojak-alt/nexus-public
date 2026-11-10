// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProfile } from './profile/profile-types';
import { loadProfile, resetProfileStore, saveProfile } from './profile/profile-store';

const push = vi.fn();
const prefetch = vi.fn();
const navState = vi.hoisted(() => ({ pathname: '/runtime' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navState.pathname,
  useRouter: () => ({ push, replace: vi.fn(), prefetch }),
}));

// wave-XII header: точечная подмена seam'ов реального mock-источника —
// остальные поля проходят прозрачно (прокси над mockSource).
const dsOver = vi.hoisted(() => ({ v: {} as Record<string, unknown> }));

// W77: useDataSource() возвращает getDataSource() только после mount — чтобы
// точечные подмены dsOver.v доходили и до первого кадра, заменяем обе ветки
// (mockSource + getDataSource) одним мемоизированным прокси (стабильная
// ссылка — иначе effect'ы с deps [ds] зациклятся).
vi.mock('./data-source', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./data-source')>();
  let proxy: unknown;
  const makeDsProxy = () => {
    if (proxy == null) {
      const ds = mod.getDataSource();
      proxy = new Proxy(ds as unknown as Record<string | symbol, unknown>, {
        get: (t, p) => (typeof p === 'string' && p in dsOver.v ? dsOver.v[p] : Reflect.get(t, p)),
      });
    }
    return proxy;
  };
  return {
    ...mod,
    getDataSource: makeDsProxy,
    useDataSource: makeDsProxy,
  };
});

import { AppShell, sourceBadgeView } from './app-shell';
// XVI: прогрев lazy-чанка палитры — первый dynamic()-импорт под нагрузкой
// трансформации занимает больше findBy-таймаута; без прогрева первые
// тесты палитры падают по таймеру, а не по логике.
import './palette-lazy';

afterEach(() => {
  cleanup();
  navState.pathname = '/runtime';
  dsOver.v = {};
  push.mockReset();
  prefetch.mockReset();
});

describe('AppShell', () => {
  it('only keeps the per-run confirmation poll while Runtime is mounted', async () => {
    const setInterval = vi.spyOn(window, 'setInterval');
    const clearInterval = vi.spyOn(window, 'clearInterval');
    const interval = 73 as unknown as ReturnType<typeof window.setInterval>;
    setInterval.mockReturnValue(interval);
    dsOver.v = { listToolConfirmations: vi.fn().mockResolvedValue([]) };
    navState.pathname = '/home';

    const view = render(<AppShell>x</AppShell>);
    expect(setInterval.mock.calls.some(([, delay]) => delay === 10_000)).toBe(false);

    navState.pathname = '/runtime';
    view.rerender(<AppShell>x</AppShell>);
    await waitFor(() => expect(
      setInterval.mock.calls.some(([, delay]) => delay === 10_000),
    ).toBe(true));

    view.unmount();
    expect(clearInterval).toHaveBeenCalledWith(interval);
  });

  it('Ctrl+K opens the command palette from the global shortcut registry', async () => {
    render(<AppShell>x</AppShell>);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy();
  });

  it('renders shell chrome: brand, nav; нижняя строка подсказок снята', () => {
    render(<AppShell>x</AppShell>);
    // Аннотация владельца 2026-10-29: вордмарк в шапке рейла убран как дубль
    // топбара — бренд в оболочке теперь ровно один.
    expect(screen.getAllByText('NEXUS').length).toBe(1);
    expect(screen.getByRole('navigation', { name: 'Разделы' })).toBeTruthy();
    // Аннотация владельца 2026-10-29: бар хоткеев убран из оболочки.
    expect(screen.queryByText(/Alt\+1/)).toBeNull();
    expect(screen.getByTestId('window-frame')).toBeTruthy();
  });

  it('ALICE-home сцена: /home и его алиас /runtime/alice, остальные маршруты — нет', async () => {
    navState.pathname = '/home';
    const home = render(<AppShell>x</AppShell>);
    const homeWrap = home.container.querySelector('[data-app-shell]');
    await waitFor(() => expect(homeWrap?.getAttribute('data-scene')).toBe('alice-home'));
    expect(homeWrap?.getAttribute('style')).toContain('alice-home-extended.png');

    // Алиас рендерит тот же адаптер — сцена обязана совпадать, иначе
    // манифестный target (он указывает на алиас) снимает не тот вид.
    navState.pathname = '/runtime/alice';
    const alias = render(<AppShell>x</AppShell>);
    const aliasWrap = alias.container.querySelector('[data-app-shell]');
    await waitFor(() => expect(aliasWrap?.getAttribute('data-scene')).toBe('alice-home'));

    navState.pathname = '/runtime';
    const other = render(<AppShell>x</AppShell>);
    const otherWrap = other.container.querySelector('[data-app-shell]');
    await waitFor(() => expect(otherWrap).toBeTruthy());
    expect(otherWrap?.getAttribute('data-scene')).toBeNull();
  });

  it('marks current section active and shows persona identity chip', async () => {
    saveProfile({ ...createEmptyProfile(), name: 'Оператор', agentId: 'alice', themeId: 'alice' });
    render(<AppShell>x</AppShell>);
    // NUE-3: вкладка «Nexus Deck» вычищена — единственный лист deck.
    const deck = screen.getByRole('link', { name: /^Nexus Deck$/ });
    expect(deck.getAttribute('aria-current')).toBe('page');
    // Perf XVI W1: каталог персон — lazy; чип появляется после резолва.
    expect(await screen.findByText(/Оператор · A\.L\.I\.C\.E\./, {}, { timeout: 15_000 })).toBeTruthy();
  });

  it('shows persistence warning when storage denied', () => {
    // jsdom в vitest: localStorage не экземпляр Storage — spy вешаем на
    // сам экземпляр, иначе исключение не перехватится (persisted=true).
    vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    resetProfileStore();
    saveProfile({ ...createEmptyProfile(), name: 'Op' });
    render(<AppShell>x</AppShell>);
    expect(screen.getByTestId('profile-unpersisted')).toBeTruthy();
  });

  it('source badge: SSR (null) → SYNCING, после mount → MOCK', async () => {
    // Юнит: до mount/гидрации raw SSR не должен печатать «MOCK».
    expect(sourceBadgeView(null).label).toBe('SYNCING');
    expect(sourceBadgeView(null).title).not.toMatch(/MOCK|LIVE|CONFIG/);
    expect(sourceBadgeView('mock').label).toBe('MOCK');
    expect(sourceBadgeView('live').label).toBe('LIVE');
    expect(sourceBadgeView('misconfigured').label).toBe('CONFIG');

    // Интеграция: после mount бейдж переходит в реальный режим (mock в тесте).
    render(<AppShell>x</AppShell>);
    await waitFor(() => expect(screen.getByTestId('source-badge').textContent).toBe('MOCK'));
  });

  it('fs-authority: button reflects profile mode/roots and opens the popover', () => {
    resetProfileStore();
    saveProfile({
      ...createEmptyProfile(),
      name: 'Op',
      fsMode: 'read_write',
      fsRoots: [{ id: 'repo', path: 'D:/repo' }],
    });
    render(<AppShell>x</AppShell>);
    const btn = screen.getByTestId('fs-authority');
    expect(btn.textContent).toContain('RW');
    fireEvent.click(btn);
    expect(screen.getByRole('dialog', { name: 'Доступ AGENT-A к файлам' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'чтение+запись' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Убрать корень repo' })).toBeTruthy();
  });

  it('fs-authority: switching mode writes the profile (button re-renders)', () => {
    resetProfileStore();
    saveProfile({ ...createEmptyProfile(), name: 'Op' });
    render(<AppShell>x</AppShell>);
    fireEvent.click(screen.getByTestId('fs-authority'));
    fireEvent.click(screen.getByRole('radio', { name: 'чтение+запись' }));
    expect(screen.getByTestId('fs-authority').textContent).toContain('RW');
  });

  it('fs-authority: mock source shows honest unavailable — no validate seam', () => {
    resetProfileStore();
    saveProfile({ ...createEmptyProfile(), name: 'Op' });
    render(<AppShell>x</AppShell>);
    const btn = screen.getByTestId('fs-authority');
    expect(btn.getAttribute('data-state')).toBe('unavailable');
    fireEvent.click(btn);
    expect(screen.getByText(/fs-контур недоступен/)).toBeTruthy();
    expect(screen.queryByLabelText('Путь корня доступа')).toBeNull();
  });

  it('#53: меню = 9 разделов листов ALICE, Linked Agents и NEXUS CORE внизу', async () => {
    render(<AppShell>x</AppShell>);
    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    // Разделы с детьми — кнопки: Главная, Диалоги, Соц. Сети, Память,
    // Nexus Deck, Оценки, Настройки.
    for (const s of ['Главная', 'Диалоги', 'Соц. Сети', 'Память', 'Nexus Deck', 'Оценки', 'Настройки']) {
      expect(within(nav).getByRole('button', { name: s })).toBeTruthy();
    }
    // Top-level разделы без детей — ссылки: Игры, Программы.
    for (const s of ['Игры', 'Программы']) {
      expect(within(nav).getByRole('link', { name: s })).toBeTruthy();
    }
    // 7 кнопок разделов + grip перемещения и 3 кнопки хрома бара
    // + триггер выпадающего меню агентов + триггер Deck-агентов (PHASE-C).
    expect(within(nav).getAllByRole('button')).toHaveLength(13);
    // NUE-3: единственный лист вкладки «Nexus Deck» — deck, активный на /runtime.
    const deck = within(nav).getByRole('link', { name: /^Nexus Deck$/ });
    expect(deck.getAttribute('aria-current')).toBe('page');
    expect(within(nav).getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page')).toHaveLength(1);
    // Футер рейла: связанные агенты (presence-seam) + карточка ядра.
    await within(nav).findByText('Агенты');
    expect(within(nav).getByTestId('rail-core-card')).toBeTruthy();
  });

  it('UI-5: hover по пункту рейла прелоадит маршрут', () => {
    render(<AppShell>x</AppShell>);
    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    // Top-level секции — прямые ссылки: Игры.
    const games = within(nav).getByRole('link', { name: 'Игры' });
    fireEvent.mouseEnter(games);
    expect(prefetch).toHaveBeenCalledWith('/games');
    // Раздел-родитель: hover прелоадит родителя и листы.
    const main = within(nav).getByRole('button', { name: 'Главная' });
    fireEvent.mouseEnter(main);
    expect(prefetch).toHaveBeenCalledWith('/home');
    expect(prefetch).toHaveBeenCalledWith('/mission-control');
    // Фокус по клавиатуре тоже греет.
    fireEvent.focus(games);
    expect(prefetch).toHaveBeenCalledTimes(5);
  });

  it('#53: активный раздел раскрывает подэкраны, лист несёт page-current', () => {
    navState.pathname = '/agents';
    render(<AppShell>x</AppShell>);
    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    const dialogs = within(nav).getByRole('button', { name: 'Диалоги' });
    expect(dialogs.getAttribute('aria-expanded')).toBe('true');
    expect(dialogs.getAttribute('aria-current')).toBeNull();
    const agents = within(nav).getByRole('link', { name: 'Агенты и сессии' });
    expect(agents.getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Обзор' })).toBeTruthy();
    // Неактивные разделы детей не раскрывают.
    expect(within(nav).queryByRole('link', { name: 'FORGE' })).toBeNull();
  });

  it('#53: Alt+1…9 идёт по разделам рейла, не по листам', () => {
    render(<AppShell>x</AppShell>);
    fireEvent.keyDown(window, { key: '1', altKey: true });
    expect(push).toHaveBeenCalledWith('/home');
    fireEvent.keyDown(window, { key: '2', altKey: true });
    expect(push).toHaveBeenCalledWith('/dialogs');
    fireEvent.keyDown(window, { key: '3', altKey: true });
    expect(push).toHaveBeenCalledWith('/social');
    fireEvent.keyDown(window, { key: '4', altKey: true });
    expect(push).toHaveBeenCalledWith('/games');
    fireEvent.keyDown(window, { key: '5', altKey: true });
    expect(push).toHaveBeenCalledWith('/programs');
    fireEvent.keyDown(window, { key: '6', altKey: true });
    // Память — раздел-родитель: цель — первый лист.
    expect(push).toHaveBeenCalledWith('/memory');
    fireEvent.keyDown(window, { key: '7', altKey: true });
    // Nexus Deck — раздел-родитель: цель — первый лист (Deck-заготовка).
    expect(push).toHaveBeenCalledWith('/deck');
    fireEvent.keyDown(window, { key: '8', altKey: true });
    // Оценки — раздел без собственного href: цель — первый лист.
    expect(push).toHaveBeenCalledWith('/settings/usage');
    fireEvent.keyDown(window, { key: '9', altKey: true });
    expect(push).toHaveBeenCalledWith('/settings');
    // Палитра — Alt+0 (не Alt+9): ни один раздел не открывается.
    push.mockClear();
    fireEvent.keyDown(window, { key: '0', altKey: true });
    expect(push).not.toHaveBeenCalled();
  });

  it('main-delta #15: datetime-чип показывает дату и время после mount', async () => {
    render(<AppShell>x</AppShell>);
    const clock = await screen.findByTestId('clock');
    await waitFor(() => expect(clock.textContent).toMatch(/\d{2}:\d{2}/));
  });

  it('main-delta #15: bell — заявки и завершённые прогоны, бейдж = ждущие', async () => {
    render(<AppShell>x</AppShell>);
    const bell = screen.getByTestId('notif-bell');
    // mock-источник: одна pending-заявка ap-01 + история завершённых прогонов
    await waitFor(() => expect(bell.textContent).toContain('1'), { timeout: 15_000 });
    fireEvent.click(bell);
    const pop = await screen.findByRole('dialog', { name: 'Уведомления' });
    expect(within(pop).getByText('Запись отчёта прогона в рабочую папку')).toBeTruthy();
    // завершённые прогоны из истории — verbatim с пометкой статуса
    expect(within(pop).getByText('Аудит хранилища траекторий')).toBeTruthy();
    expect(within(pop).getByText('Прогон завершился ошибкой')).toBeTruthy();
    // клик по заявке ведёт на прогон-владельца
    fireEvent.click(within(pop).getByText('Запись отчёта прогона в рабочую папку'));
    expect(push).toHaveBeenCalledWith('/runtime?run=run-1042');
  });

  it('main-delta #13: Alt+0 палитра — разделы + прогоны, Enter ведёт в раздел', async () => {
    render(<AppShell>x</AppShell>);
    fireEvent.keyDown(document, { key: '0', altKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    const input = within(dialog).getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Nexus Link' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/mission-control');
  });

  it('палитра добавляет только реальные runs, agents и bus sessions из seam', async () => {
    dsOver.v = {
      listRuns: vi.fn(async () => [{ runId: 'live-run-7', taskText: 'Задача из хоста' }]),
      listAgents: vi.fn(async () => [{ name: 'live-agent-2' }]),
      bus: {
        listSessions: vi.fn(async () => [{ window: 'W3', title: 'Сессия W3 с хоста' }]),
      },
    };
    render(<AppShell>x</AppShell>);
    fireEvent.keyDown(document, { key: '0', altKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    await within(dialog).findByRole('option', { name: /live-run-7|Задача из хоста/ });
    expect(within(dialog).getByRole('option', { name: /live-agent-2/ })).toBeTruthy();
    const input = within(dialog).getByRole('combobox');
    fireEvent.change(input, { target: { value: 'W3' } });
    const session = await within(dialog).findByRole('option', { name: /Сессия W3 с хоста/ });
    expect(within(dialog).queryByRole('option', { name: /live-agent-2/ })).toBeNull();
    fireEvent.mouseDown(session);
    expect(push).toHaveBeenCalledWith('/runtime?tab=bus');
  });

  it('palette source failure does not fabricate or discard other successful sources', async () => {
    dsOver.v = {
      listRuns: vi.fn(async () => { throw new Error('runtime offline'); }),
      listAgents: vi.fn(async () => [{ name: 'real-agent' }]),
      bus: { listSessions: vi.fn(async () => { throw new Error('bus offline'); }) },
    };
    render(<AppShell>x</AppShell>);
    fireEvent.keyDown(document, { key: '0', altKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    await within(dialog).findByRole('option', { name: /real-agent/ });
    expect(within(dialog).queryByRole('option', { name: /runtime offline|bus offline/ })).toBeNull();
  });

  it('VII V1.5: /, /welcome, /agent-select (редирект-заглушка) и /mobile — полноэкранные, без рейла и рамки', () => {
    for (const path of ['/', '/welcome', '/agent-select', '/mobile']) {
      navState.pathname = path;
      const { unmount } = render(<AppShell>child</AppShell>);
      expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
      expect(screen.queryByTestId('window-frame')).toBeNull();
      expect(screen.getByText('child')).toBeTruthy();
      unmount();
    }
  });

  it('NUE-3: субагентские листы удалены из nav; /arch — прямой адрес без подсветки', () => {
    navState.pathname = '/arch';
    render(<AppShell>x</AppShell>);
    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    // Листов A.R.C.H./M.E.C.H./ROLE-1/Runtime в nav больше нет (NUE-3).
    expect(within(nav).queryByRole('link', { name: 'A.R.C.H.' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'M.E.C.H.' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'ROLE-1' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: /^Runtime$/ })).toBeNull();
    // /arch не входит в match ни одного раздела — aria-current в nav отсутствует.
    expect(within(nav).getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page')).toHaveLength(0);
  });

  it('REAL-BUGS /models: nav link exists with aria-current=page on /models route', () => {
    navState.pathname = '/models';
    render(<AppShell>x</AppShell>);
    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    // /models is a leaf of the «Память» section (Intelligence sub-screen), so
    // the section is expanded and its «Модели» leaf carries aria-current.
    const link = within(nav).getByRole('link', { name: 'Модели' });
    expect(link.getAttribute('href')).toBe('/models');
    expect(link.getAttribute('aria-current')).toBe('page');
    const current = within(nav).getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
  });

  it('приоритет 16.10 → #53: strip — 9 иконок рельса, aria-label, активный раздел подсвечен', () => {
    resetProfileStore();
    saveProfile({ ...createEmptyProfile(), name: 'Op', navMode: 'strip' });
    navState.pathname = '/runtime';
    render(<AppShell>x</AppShell>);
    const strip = screen.getByTestId('rail-strip');
    // 7 разделов-родителей (кнопки с меню) + 2 top-level ссылки (Игры,
    // Программы); «Настройки» — 9-й раздел, дублей внизу полосы нет.
    // +3 кнопки хрома и grip перемещения модульного бара.
    const buttons = within(strip).getAllByRole('button');
    expect(buttons).toHaveLength(12);
    const links = within(strip).getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const label of ['Главная', 'Диалоги', 'Соц. Сети', 'Память', 'Nexus Deck', 'Оценки', 'Настройки', 'Игры', 'Программы']) {
      expect(within(strip).getByLabelText(label)).toBeTruthy();
    }
    // Иконки единого набора ≥20px (size=22): 9 разделов + палитра.
    expect(strip.querySelectorAll('svg[width="22"]')).toHaveLength(10);
    // Активный раздел-родитель подсвечен по листу /runtime.
    expect(within(strip).getByLabelText('Nexus Deck').getAttribute('data-active')).toBe('true');
    expect(strip.querySelectorAll('[data-icon]')).toHaveLength(10);
  });

  it('REAL-BUGS /models: strip shows the Модели leaf in the opened Память menu', () => {
    resetProfileStore();
    saveProfile({ ...createEmptyProfile(), name: 'Op', navMode: 'strip' });
    navState.pathname = '/models';
    render(<AppShell>x</AppShell>);
    const strip = screen.getByTestId('rail-strip');
    const memory = within(strip).getByLabelText('Память');
    expect(memory.getAttribute('data-active')).toBe('true');
    fireEvent.click(memory);
    const menu = screen.getByRole('menu', { name: 'Память' });
    const leaf = within(menu).getByRole('menuitem', { name: 'Модели' });
    expect(leaf.getAttribute('href')).toBe('/models');
    expect(leaf.getAttribute('aria-current')).toBe('page');
  });

  it('приоритет 16.10 → #53: strip — раздел с детьми открывает меню по клику, лист ведёт по роуту', () => {
    resetProfileStore();
    saveProfile({ ...createEmptyProfile(), name: 'Op', navMode: 'strip' });
    navState.pathname = '/memory';
    render(<AppShell>x</AppShell>);
    const strip = screen.getByTestId('rail-strip');
    // Память — раздел с детьми: активен по data-active (не aria-current).
    const memory = within(strip).getByLabelText('Память');
    expect(memory.getAttribute('data-active')).toBe('true');
    const agents = within(strip).getByLabelText('Диалоги');
    fireEvent.click(agents);
    expect(agents.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'Диалоги' });
    const leaf = within(menu).getByRole('menuitem', { name: 'Агенты и сессии' });
    expect(leaf.getAttribute('href')).toBe('/agents');
    fireEvent.click(leaf);
    expect(push).toHaveBeenCalledWith('/agents');
    expect(agents.getAttribute('aria-expanded')).toBe('false');
  });

  it('W3-153: фокус на иконке показывает тултип с названием раздела в сторону от рейла', async () => {
    resetProfileStore();
    saveProfile({ ...createEmptyProfile(), name: 'Op', navMode: 'strip' });
    render(<AppShell>x</AppShell>);
    const strip = screen.getByTestId('rail-strip');
    // data-nav='strip' на обёртке — режим применён, переход по одной
    // CSS-переменной (--nexus-frame-left) не рвёт layout контента.
    expect(document.querySelector('[data-nav="strip"]')).not.toBeNull();
    fireEvent.focus(within(strip).getByLabelText('Диалоги'));
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain('Диалоги');
    // Левый рейл → тултип вправо, не поверх иконку.
    expect(tip.getAttribute('data-placement')).toBe('right');
  });

  it('W3-153: ArrowDown на разделе открывает меню и фокусирует первый пункт', async () => {
    resetProfileStore();
    saveProfile({ ...createEmptyProfile(), name: 'Op', navMode: 'strip' });
    render(<AppShell>x</AppShell>);
    const strip = screen.getByTestId('rail-strip');
    fireEvent.keyDown(within(strip).getByLabelText('Диалоги'), { key: 'ArrowDown' });
    const first = await screen.findByRole('menuitem', { name: 'Обзор' });
    expect(document.activeElement).toBe(first);
  });

  it('приоритет 16.10: кнопка циклит full→strip→hidden→full, двойной клик — скрыть, состояние в профиле', () => {
    resetProfileStore();
    saveProfile({ ...createEmptyProfile(), name: 'Op' });
    render(<AppShell>x</AppShell>);
    const toggle = screen.getByTestId('nav-toggle');
    fireEvent.click(toggle);
    expect(loadProfile()?.navMode).toBe('strip');
    expect(screen.getByTestId('rail-strip')).toBeTruthy();
    fireEvent.click(toggle);
    expect(loadProfile()?.navMode).toBe('hidden');
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
    expect(loadProfile()?.navCollapsed).toBe(true);
    fireEvent.click(toggle);
    expect(loadProfile()?.navMode).toBe('full');
    expect(screen.getByTestId('icon-rail')).toBeTruthy();
    // Двойной клик из полного — скрыть.
    fireEvent.doubleClick(toggle);
    expect(loadProfile()?.navMode).toBe('hidden');
  });

  it('Alt+B зарезервирован за правым доком; Alt+1 работает в strip', () => {
    resetProfileStore();
    saveProfile({ ...createEmptyProfile(), name: 'Op', navMode: 'strip' });
    render(<AppShell>x</AppShell>);
    expect(screen.getByTestId('rail-strip')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'b', code: 'KeyB', altKey: true });
    expect(loadProfile()?.navMode).toBe('strip');
    expect(screen.getByTestId('rail-strip')).toBeTruthy();
    // Alt+1 в состоянии strip — переход по первому разделу (AGENT-A).
    fireEvent.keyDown(window, { key: '1', altKey: true });
    expect(push).toHaveBeenCalledWith('/home');
  });

  it('приоритет 16.10: «ещё» в полосе открывает палитру; старый navCollapsed=true → hidden', async () => {
    resetProfileStore();
    saveProfile({ ...createEmptyProfile(), name: 'Op', navMode: 'strip' });
    render(<AppShell>x</AppShell>);
    fireEvent.click(screen.getByLabelText('Все разделы — палитра'));
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    cleanup();
    // Миграция старого флага: navCollapsed без navMode = «всё скрыто».
    resetProfileStore();
    saveProfile({ ...createEmptyProfile(), name: 'Op', navCollapsed: true });
    render(<AppShell>x</AppShell>);
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
    expect(screen.getByTestId('nav-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('wave-XII header: палитра подмешивает хиты searchMemory verbatim, выбор → /memory?tab=archive&q=', async () => {
    const searchMemory = vi.fn(async (q: string) => [
      { id: 42, project: 'nexus', text: `серверный хит без букв запроса`, createdAt: 1700000000, score: 0.9 },
    ]);
    dsOver.v = { searchMemory };
    render(<AppShell>x</AppShell>);
    fireEvent.keyDown(document, { key: '0', altKey: true });
    const input = await screen.findByPlaceholderText(/Раздел, прогон, агент/);
    fireEvent.change(input, { target: { value: 'zz' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(searchMemory).toHaveBeenCalledWith('zz');
    // Серверный хит не содержит подстроку «zz» — serverItems не фильтруются.
    const opt = screen.getByRole('option', { name: /серверный хит/ });
    fireEvent.mouseDown(opt);
    expect(push).toHaveBeenCalledWith('/memory?tab=archive&q=zz');
  });

  it('wave-XII header: колокол — ответ окна по шине (busy→idle), ошибки/завершения прогонов', async () => {
    vi.useFakeTimers();
    try {
      const listSessions = vi.fn()
        .mockResolvedValueOnce([
          { id: 's1', window: 'W3', title: 'W3', kind: 'tui', status: 'busy', lastActivityAt: 1 },
        ])
        .mockResolvedValue([
          { id: 's1', window: 'W3', title: 'W3', kind: 'tui', status: 'idle', lastActivityAt: 2 },
        ]);
      dsOver.v = { bus: { listSessions, delegateTask: vi.fn(), getDelegation: vi.fn() } };
      render(<AppShell>x</AppShell>);
      // Первый опрос — засевка снимка (busy), уведомления ещё нет.
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      // Второй опрос — переход busy→idle → «Окно ответило».
      await act(async () => { await vi.advanceTimersByTimeAsync(30_200); });
      fireEvent.click(screen.getByTestId('notif-bell'));
      expect(screen.getByText('Окно «W3» ответило')).toBeTruthy();
      expect(listSessions.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('#53/#42: стеклянные слои оболочки — контейнер окна, top-бар, док', () => {
    saveProfile({ ...createEmptyProfile(), name: 'Оператор', agentId: 'alice', themeId: 'alice' });
    const { container } = render(<AppShell>x</AppShell>);
    // Контейнер окна — носитель container-type:inline-size и сцены.
    const wrap = container.querySelector('[data-nav]');
    expect(wrap).toBeTruthy();
    expect(wrap!.getAttribute('data-nav')).toBe('full');
    // Маркер стеклянного top-бара (frameTopGlass через topProps).
    expect(container.querySelector('[class*="frameTopGlass"]')).toBeTruthy();
    // Рельс полного режима — стеклянная колонка WindowFrame.
    expect(screen.getByRole('navigation', { name: 'Разделы' })).toBeTruthy();
    // frameEdge несёт data-persona — сцена ALICE вешается селектором.
    expect(container.querySelector('[data-persona="alice"]')).toBeTruthy();
  });

  it('window-chrome 18.10: data-nav доезжает до колонки aside; ширина дока — живой хук WindowFrame', () => {
    resetProfileStore();
    saveProfile({ ...createEmptyProfile(), name: 'Op', navMode: 'strip' });
    const { container } = render(<AppShell>x</AppShell>);
    // Регресс: nav-проп не передавался → колонка оставалась широкой при
    // data-nav=strip на оболочке. Теперь aside несёт то же состояние, а
    // ширина берёт --nexus-frame-left (CSS-контракт shellWrap).
    const aside = container.querySelector('aside[data-nav]');
    expect(aside).toBeTruthy();
    expect(aside!.getAttribute('data-nav')).toBe('strip');
    cleanup();
    resetProfileStore();
    saveProfile({ ...createEmptyProfile(), name: 'Op', navMode: 'hidden' });
    const { container: hidden } = render(<AppShell>x</AppShell>);
    const asideHidden = hidden.querySelector('aside[data-nav]');
    expect(asideHidden!.getAttribute('data-nav')).toBe('hidden');
    expect(asideHidden!.getAttribute('aria-hidden')).toBe('true');
    // Правая колонка читает --nexus-window-frame-right-width (рабочий хук
    // WindowFrame), а не мёртвый --nexus-frame-right. С модульными барами
    // переменная живёт на shellWrap — оттуда наследуется в aside.
    const frame = hidden.querySelector('[data-testid="window-frame"]') as HTMLElement;
    const wrap = frame.closest('[data-nav]') as HTMLElement;
    expect(wrap.style.getPropertyValue('--nexus-window-frame-right-width')).toMatch(/^\d+px$/);
  });

  it('window-chrome: frameless — символы управления справа в шапке, кнопки зовут мост', async () => {
    const api = {
      is_frameless: vi.fn(async () => true),
      minimize: vi.fn(async () => true),
      close_window: vi.fn(async () => true),
      toggle_maximize: vi.fn(async () => true),
    };
    (window as unknown as { pywebview: { api: typeof api } }).pywebview = { api };
    try {
      const { container } = render(<AppShell>x</AppShell>);
      const traffic = await screen.findByTestId('window-traffic', {}, { timeout: 15_000 });
      // Windows-порядок слева направо: свернуть, развернуть, закрыть.
      const labels = within(traffic).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
      expect(labels).toEqual(['Свернуть окно', 'Развернуть окно на весь экран', 'Закрыть окно']);
      // Отдельной системной полосы нет: символы стоят в правом tools-кластере
      // frameTop, на общей подложке и с hover-only подсветкой.
      expect(container.querySelector('[data-testid="os-titlebar"]')).toBeNull();
      const header = traffic.closest('header');
      expect(header).toBeTruthy();
      expect(header!.className).toContain('pywebview-drag-region');
      expect(header!.lastElementChild?.contains(traffic)).toBe(true);
      expect(within(traffic).getAllByRole('button').every((button) => button.querySelector('svg') != null)).toBe(true);
      fireEvent.click(within(traffic).getByLabelText('Свернуть окно'));
      await waitFor(() => expect(api.minimize).toHaveBeenCalled());
      fireEvent.click(within(traffic).getByLabelText('Закрыть окно'));
      await waitFor(() => expect(api.close_window).toHaveBeenCalled());
      fireEvent.click(within(traffic).getByLabelText('Развернуть окно на весь экран'));
      await waitFor(() => expect(api.toggle_maximize).toHaveBeenCalled());
    } finally {
      delete (window as unknown as { pywebview?: unknown }).pywebview;
      window.sessionStorage.removeItem('nexus:frameless');
    }
  });

  it('window opacity slider is interactive inside the frameless drag region', async () => {
    const setWindowOpacity = vi.fn(async () => true);
    const api = {
      is_frameless: vi.fn(async () => true),
      set_window_opacity: setWindowOpacity,
    };
    (window as unknown as { pywebview: { api: typeof api } }).pywebview = { api };
    const bodyMouseDown = vi.fn();
    document.body.addEventListener('mousedown', bodyMouseDown);

    try {
      render(<AppShell>x</AppShell>);
      const control = await screen.findByTestId('window-opacity');
      const slider = control.querySelector('input[type="range"]')!;

      fireEvent.mouseDown(slider);
      expect(bodyMouseDown).not.toHaveBeenCalled();

      fireEvent.change(slider, { target: { value: '70' } });
      await waitFor(() => expect(setWindowOpacity).toHaveBeenCalledWith(0.7));
      expect(control.textContent).toContain('70%');
    } finally {
      document.body.removeEventListener('mousedown', bodyMouseDown);
      delete (window as unknown as { pywebview?: unknown }).pywebview;
    }
  });

  it('frameless window moves only on right-button drags from the top bar', async () => {
    const api = { is_frameless: vi.fn(async () => true) };
    (window as unknown as { pywebview: { api: typeof api } }).pywebview = { api };
    const bodyMouseDown = vi.fn();

    try {
      render(<AppShell>x</AppShell>);
      const traffic = await screen.findByTestId('window-traffic');
      const header = traffic.closest('header')!;
      document.body.addEventListener('mousedown', bodyMouseDown);

      fireEvent.mouseDown(header, { button: 0 });
      expect(bodyMouseDown).not.toHaveBeenCalled();

      fireEvent.mouseDown(header, { button: 2 });
      expect(bodyMouseDown).toHaveBeenCalledOnce();

      const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      fireEvent(header, contextMenu);
      expect(contextMenu.defaultPrevented).toBe(true);
    } finally {
      document.body.removeEventListener('mousedown', bodyMouseDown);
      delete (window as unknown as { pywebview?: unknown }).pywebview;
      window.sessionStorage.removeItem('nexus:frameless');
    }
  });
});


