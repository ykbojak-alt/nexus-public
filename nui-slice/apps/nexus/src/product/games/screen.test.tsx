// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnrealSceneHostState, UnrealSceneStatus } from '@nexus/mock-data';
import type { ProductDataSource } from '../data-source';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/games',
  useSearchParams: () => new URLSearchParams(''),
}));

let unrealScene: ProductDataSource['unrealScene'] | undefined;
vi.mock('../data-source', () => ({
  getDataSource: () => ({ unrealScene }),
  useDataSource: () => ({ unrealScene }),
}));

import { GamesScreen } from './screen';

// Node ≥22 подставляет свой экспериментальный localStorage поверх jsdom —
// присутствует, но без --localstorage-file молча не хранит (setItem no-op,
// getItem → undefined). Реальный Map-бэкенд для persist-контракта.
const storageMap = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => (storageMap.has(k) ? storageMap.get(k)! : null),
    setItem: (k: string, v: string) => void storageMap.set(k, String(v)),
    removeItem: (k: string) => void storageMap.delete(k),
    clear: () => storageMap.clear(),
    get length() { return storageMap.size; },
    key: (i: number) => [...storageMap.keys()][i] ?? null,
  },
});

const hostState = (status: UnrealSceneStatus, over: Partial<UnrealSceneHostState> = {}): UnrealSceneHostState => ({
  status,
  source: 'live',
  reason: null,
  lastUpdated: 1_800_000_000,
  protocolVersion: 1,
  activeAssistant: null,
  activeMap: null,
  ...over,
});

const tiles = () =>
  within(screen.getByRole('list', { name: 'Игры' })).getAllByRole('listitem');

beforeEach(() => {
  window.localStorage.clear();
  unrealScene = undefined;
  push.mockReset();
});

describe('GamesScreen — канон', () => {
  it('h1 + list/listitem + 6 доступных плиток-кнопок со статусом ON', () => {
    render(<GamesScreen />);
    expect(screen.getByRole('heading', { level: 1, name: 'Игры' })).toBeTruthy();
    const items = tiles();
    expect(items).toHaveLength(6);
    const buttons = within(screen.getByRole('list', { name: 'Игры' })).getAllByRole('button');
    expect(buttons).toHaveLength(6);
    for (const b of buttons) {
      expect(b.getAttribute('aria-controls')).toBe('game-launch-panel');
      expect(b.getAttribute('aria-expanded')).toBe('false');
    }
    expect(within(screen.getByRole('list', { name: 'Игры' })).getAllByText('ON')).toHaveLength(6);
    expect(screen.queryAllByText('СКОРО')).toHaveLength(0);
    expect(screen.getByText('ЛОКАЛЬНО')).toBeTruthy();
    expect(screen.queryByTestId('game-launch-panel')).toBeNull();
  });

  it('продуктовые карточки переехали в «Программы» — в играх их нет', () => {
    render(<GamesScreen />);
    expect(screen.queryByText('NEXUS Craft')).toBeNull();
    expect(screen.queryByText('NEXUS Office')).toBeNull();
    expect(screen.queryByText('NEXUS IGMA')).toBeNull();
  });

  it('persisted-данные из localStorage — счёт и реплей по seed', async () => {
    window.localStorage.setItem('nexus.durak.score', JSON.stringify({ w: 3, l: 1, d: 0 }));
    window.localStorage.setItem('nexus.chess.lastSeed', '4242');
    window.localStorage.setItem('nexus.chess.lastResult', 'w');
    render(<GamesScreen />);
    await waitFor(() => expect(screen.getByText('Счёт 3:1')).toBeTruthy());
    expect(screen.getByText('последняя — победа')).toBeTruthy();
    const replay = screen.getByRole('link', { name: /Реплей · seed 4242/ });
    expect(replay.getAttribute('href')).toBe('/chess?seed=4242');
  });
});

describe('GamesScreen — launch-панель', () => {
  it('клик по плитке открывает inline-панель: aria-expanded, region, фокус на заголовке', async () => {
    render(<GamesScreen />);
    const durak = screen.getByRole('button', { name: /Дурак/ });
    fireEvent.click(durak);
    expect(durak.getAttribute('aria-expanded')).toBe('true');
    const panel = await screen.findByTestId('game-launch-panel');
    expect(panel.getAttribute('role')).toBe('region');
    expect(panel.getAttribute('aria-labelledby')).toBe('game-launch-title');
    const title = within(panel).getByRole('heading', { name: 'Новая партия Дурак' });
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('при открытой панели соседние плитки aria-hidden + inert', async () => {
    render(<GamesScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Дурак/ }));
    await screen.findByTestId('game-launch-panel');
    // hidden: true — aria-hidden плитки исключены из a11y-дерева, это и есть фича;
    // для проверки атрибутов опрашиваем сырой DOM через hidden:true.
    const items = within(screen.getByRole('list', { name: 'Игры' }))
      .getAllByRole('listitem', { hidden: true });
    expect(items).toHaveLength(6);
    const selected = items.find((el) => el.hasAttribute('data-selected-game'));
    expect(selected).toBeTruthy();
    const hidden = items.filter((el) => el !== selected);
    expect(hidden).toHaveLength(5);
    for (const el of hidden) {
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(el.hasAttribute('inert')).toBe(true);
    }
  });

  it('повторный клик закрывает панель и возвращает фокус на плитку', async () => {
    render(<GamesScreen />);
    const durak = screen.getByRole('button', { name: /Дурак/ });
    fireEvent.click(durak);
    await screen.findByTestId('game-launch-panel');
    fireEvent.click(durak);
    expect(screen.queryByTestId('game-launch-panel')).toBeNull();
    expect(durak.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(durak));
  });

  it('Escape закрывает панель и возвращает фокус на плитку', async () => {
    render(<GamesScreen />);
    const chess = screen.getByRole('button', { name: /Шахматы/ });
    fireEvent.click(chess);
    const panel = await screen.findByTestId('game-launch-panel');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByTestId('game-launch-panel')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(chess));
  });

  it('кнопка «Начать партию» ведёт на /chess с setup-параметрами', async () => {
    render(<GamesScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Шахматы/ }));
    await screen.findByTestId('game-launch-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Начать партию' }));
    expect(push).toHaveBeenCalledTimes(1);
    const url = push.mock.calls[0][0] as string;
    expect(url).toMatch(/^\/chess\?start=1&opponent=\w+&difficulty=\w+&seed=\d+$/);
  });

  it('кнопка «Играть →» на MACHINA ведёт на /games/machina', async () => {
    render(<GamesScreen />);
    fireEvent.click(screen.getByRole('button', { name: /MACHINA/ }));
    await screen.findByTestId('game-launch-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Играть →' }));
    expect(push).toHaveBeenCalledWith('/games/machina');
  });

  it('клавиатура: стрелки/Home/End двигают фокус между плитками циклически', () => {
    render(<GamesScreen />);
    const list = screen.getByRole('list', { name: 'Игры' });
    const buttons = within(list).getAllByRole('button');
    expect(buttons.length).toBe(6);
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[2]);
    fireEvent.keyDown(buttons[2], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[3]);
    fireEvent.keyDown(buttons[3], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(buttons[2]);
    fireEvent.keyDown(buttons[2], { key: 'End' });
    expect(document.activeElement).toBe(buttons[5]);
    fireEvent.keyDown(buttons[5], { key: 'ArrowDown' }); // циклически → первая
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0], { key: 'ArrowUp' }); // циклически назад → последняя
    expect(document.activeElement).toBe(buttons[5]);
    fireEvent.keyDown(buttons[5], { key: 'Home' });
    expect(document.activeElement).toBe(buttons[0]);
  });
});

describe('GamesScreen — seam 3D-сцены', () => {
  it('seam отсутствует → карточки живут без бейджа сцены', async () => {
    render(<GamesScreen />);
    await waitFor(() => expect(tiles()).toHaveLength(6));
    expect(screen.queryByTestId('games-scene-badge')).toBeNull();
    expect(screen.queryByTestId('error-state')).toBeNull();
    expect(screen.getByText('ЛОКАЛЬНО')).toBeTruthy();
  });

  it('host not-installed + mock → бейдж verbatim, MOCK и причина хоста', async () => {
    unrealScene = {
      getState: () => Promise.resolve(hostState('not-installed', {
        source: 'mock',
        reason: 'Unreal Editor и DesktopBridge-хост не установлены (демо)',
      })),
      open: vi.fn(),
    };
    render(<GamesScreen />);
    const badge = await screen.findByTestId('games-scene-badge');
    expect(badge.textContent).toContain('СЦЕНА НЕ УСТАНОВЛЕНА');
    expect(screen.getByTestId('games-scene-demo').textContent).toContain('MOCK');
    expect(screen.getByTestId('games-scene-note').textContent)
      .toBe('Unreal Editor и DesktopBridge-хост не установлены (демо)');
    expect(tiles()).toHaveLength(6);
  });

  it('connected → чип сцены только у durak/chess, у oracle его нет', async () => {
    unrealScene = {
      getState: () => Promise.resolve(hostState('connected')),
      open: vi.fn(),
    };
    render(<GamesScreen />);
    await screen.findByTestId('games-scene-badge');
    expect(screen.getByTestId('scene-chip-/durak').textContent).toBe('сцена · подключена');
    expect(screen.getByTestId('scene-chip-/chess').textContent).toBe('сцена · подключена');
    expect(screen.queryByTestId('scene-chip-/oracle')).toBeNull();
    expect(screen.queryByTestId('games-scene-demo')).toBeNull();
  });

  it('getState отклоняет → inline ErrorState + retry восстанавливает', async () => {
    const getState = vi.fn()
      .mockRejectedValueOnce(new Error('bridge offline'))
      .mockResolvedValue(hostState('connected'));
    unrealScene = { getState, open: vi.fn() };
    render(<GamesScreen />);
    const err = await screen.findByTestId('error-state');
    expect(err.textContent).toContain('Состояние 3D-сцены недоступно');
    expect(err.textContent).toContain('bridge offline');
    expect(tiles()).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByTestId('games-scene-badge');
    expect(getState).toHaveBeenCalledTimes(2);
  });
});
