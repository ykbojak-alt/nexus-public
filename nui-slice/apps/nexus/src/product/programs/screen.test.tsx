// @vitest-environment jsdom
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/programs',
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, className, ...props }: any) => (
    <a href={href} className={className} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/product/programs/installer-factories', () => ({
  createHttpProgramInstaller: vi.fn(() => ({
    state: () => ({ stage: 'idle', progress: null, error: null, version: null, installDir: null, verifiedBytes: null, simulated: true }),
    download: vi.fn(),
    install: vi.fn(),
    update: vi.fn(),
    rollback: vi.fn(),
    uninstall: vi.fn(),
    subscribe: vi.fn((_id, cb) => { cb({ stage: 'idle', progress: null, error: null, version: null, installDir: null, verifiedBytes: null, simulated: true }); return () => {}; }),
  })),
  createLocalProgramInstaller: vi.fn(() => ({
    state: () => ({ stage: 'idle', progress: null, error: null, version: null, installDir: null, verifiedBytes: null, simulated: true }),
    download: vi.fn(),
    install: vi.fn(),
    update: vi.fn(),
    rollback: vi.fn(),
    uninstall: vi.fn(),
    subscribe: vi.fn((_id, cb) => { cb({ stage: 'idle', progress: null, error: null, version: null, installDir: null, verifiedBytes: null, simulated: true }); return () => {}; }),
  })),
  createCompositeProgramInstaller: vi.fn((http, local) => http),
}));

vi.mock('@/product/use-reduced-motion', () => ({
  useReducedMotion: () => false,
}));

import { ProgramsScreen } from './screen';

describe('ProgramsScreen — канон порта из бандла', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('h1 «Программы» + 9 манифест-тайлов в list', () => {
    render(<ProgramsScreen />);
    expect(screen.getByRole('heading', { level: 1, name: 'Программы' })).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Программы' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(9);
    for (const name of ['NEXUS Bus', 'NEXUS SWARM', 'NEXUS Craft', 'NEXUS Office', 'NEXUS IGMA', 'NEXUS TPLAYER', 'NEXUS VLOADER', 'NEXUS Link', 'NEXUS Deck']) {
      expect(within(list).getByText(name, { exact: false })).toBeTruthy();
    }
  });

  it('NEXUS IGMA: единственная плитка со статусом soon + aria-disabled', () => {
    render(<ProgramsScreen />);
    const card = screen.getByText('NEXUS IGMA');
    const tile = card.closest('[data-status="soon"]');
    expect(tile).toBeTruthy();
    expect(tile!.getAttribute('aria-disabled')).toBe('true');
    // no link for soon
    const links = within(screen.getByRole('list', { name: 'Программы' })).queryAllByRole('link');
    const hrefs = links.map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain('/tools/igma');
  });

  it('downloadable-программы (craft/office/tplayer/vloader): тайлы кнопки с aria-expanded/aria-controls', () => {
    render(<ProgramsScreen />);
    for (const name of ['NEXUS Craft', 'NEXUS Office', 'NEXUS TPLAYER', 'NEXUS VLOADER']) {
      const btn = within(screen.getByRole('list', { name: 'Программы' })).getByRole('button', { name });
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      expect(btn.getAttribute('aria-controls')).toBe('program-launch-panel');
    }
  });

  it('клик по доступной плитке открывает launch-panel (role=region, aria-labelledby=program-launch-title)', () => {
    render(<ProgramsScreen />);
    const craftBtn = within(screen.getByRole('list', { name: 'Программы' })).getByRole('button', { name: 'NEXUS Craft' });
    fireEvent.click(craftBtn);
    const panel = screen.getByTestId('program-launch-panel');
    expect(panel).toBeTruthy();
    expect(panel.getAttribute('role')).toBe('region');
    expect(panel.getAttribute('aria-labelledby')).toBe('program-launch-title');
    expect(screen.getByRole('heading', { name: 'NEXUS Craft' })).toBeTruthy();
    // back button closes panel
    const backBtn = screen.getByRole('button', { name: /Назад к программам/ });
    fireEvent.click(backBtn);
    expect(screen.queryByTestId('program-launch-panel')).not.toBeInTheDocument();
  });

  it('Escape закрывает launch-panel и возвращает фокус на плитку', async () => {
    render(<ProgramsScreen />);
    const craftBtn = within(screen.getByRole('list', { name: 'Программы' })).getByRole('button', { name: 'NEXUS Craft' });
    fireEvent.click(craftBtn);
    expect(screen.getByTestId('program-launch-panel')).toBeTruthy();
    // Simulate Escape (wrap in act so the resulting state update flushes)
    await act(async () => {
      fireKeyEvent(document, { key: 'Escape', code: 'Escape' });
    });
    expect(screen.queryByTestId('program-launch-panel')).not.toBeInTheDocument();
    // focus should return to tile
    expect(craftBtn).toHaveFocus();
  });

  it('downloadable-программы: секция Установка с installer UI (состояние idle → «СКАЧАТЬ»)', () => {
    render(<ProgramsScreen />);
    const craftBtn = within(screen.getByRole('list', { name: 'Программы' })).getByRole('button', { name: 'NEXUS Craft' });
    fireEvent.click(craftBtn);
    // installer section present
    expect(screen.getByRole('heading', { name: 'Установка' })).toBeTruthy();
    // idle state → button says «СКАЧАТЬ»
    const dlBtn = within(screen.getByTestId('program-launch-panel')).getByRole('button', { name: /СКАЧАТЬ/ });
    expect(dlBtn).toBeTruthy();
  });

  it('href!=null программы (bus, craft, office, tplayer, vloader): кнопка «Открыть экран» в launch-panel', () => {
    render(<ProgramsScreen />);
    const busBtn = within(screen.getByRole('list', { name: 'Программы' })).getByRole('button', { name: 'NEXUS Bus' });
    fireEvent.click(busBtn);
    expect(screen.getByRole('link', { name: /Открыть экран/ })).toHaveAttribute('href', '/bus-desktop');
    // office
    const backBtn = screen.getByRole('button', { name: /Назад к программам/ });
    fireEvent.click(backBtn);
    const officeBtn = within(screen.getByRole('list', { name: 'Программы' })).getByRole('button', { name: 'NEXUS Office' });
    fireEvent.click(officeBtn);
    expect(screen.getByRole('link', { name: /Открыть экран/ })).toHaveAttribute('href', '/tools/office');
  });

  it('programs без href (swarm, igma, nexuslink): НЕТ кнопки «Открыть экран»', () => {
    render(<ProgramsScreen />);
    const swarmBtn = within(screen.getByRole('list', { name: 'Программы' })).getByRole('button', { name: 'NEXUS SWARM' });
    fireEvent.click(swarmBtn);
    expect(screen.queryByRole('link', { name: /Открыть экран/ })).not.toBeInTheDocument();
  });

  it('installer-секция для downloadable: Target chips (КУДА / ХРАНИЛИЩЕ всегда) рендерятся', () => {
    render(<ProgramsScreen />);
    const craftBtn = within(screen.getByRole('list', { name: 'Программы' })).getByRole('button', { name: 'NEXUS Craft' });
    fireEvent.click(craftBtn);
    expect(screen.getByText('КУДА')).toBeTruthy();
    expect(screen.getByRole('button', { name: /ХРАНИЛИЩЕ/ })).toBeTruthy();
    // ЗАГРУЗКИ gated on URL.createObjectURL, ПАПКА on showDirectoryPicker —
    // neither is present in jsdom, so they legitimately stay hidden there.
  });

  it('panel-header бейдж «ЛОКАЛЬНО» виден когда панель закрыта', () => {
    render(<ProgramsScreen />);
    expect(screen.getByText('ЛОКАЛЬНО')).toBeTruthy();
  });

  it('панель скрыта — нет заголовка «Программы» в accessibility tree (aria-labelledby only when closed)', () => {
    render(<ProgramsScreen />);
    const craftBtn = within(screen.getByRole('list', { name: 'Программы' })).getByRole('button', { name: 'NEXUS Craft' });
    fireEvent.click(craftBtn);
    // h1 «Программы» не в a11y tree (aria-labelledby убран)
    const heading = screen.queryByRole('heading', { name: 'Программы' });
    expect(heading).not.toBeInTheDocument();
  });
});

describe('ProgramsScreen — UI-3: каталог, поиск, фильтры, пины', () => {
  const listItems = () => within(screen.getByRole('list', { name: 'Программы' })).getAllByRole('listitem');
  const tileNames = () => listItems().map((li) => li.textContent ?? '');

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('тулбар: поиск, фильтры (ВСЕ/ГОТОВО/СКАЧАТЬ/СКОРО), пин-счётчик скрыт без пинов', () => {
    render(<ProgramsScreen />);
    expect(screen.getByRole('searchbox', { name: 'Поиск по программам' })).toBeTruthy();
    const group = screen.getByRole('group', { name: 'Фильтр по статусу' });
    for (const label of ['ВСЕ', 'ГОТОВО', 'СКАЧАТЬ', 'СКОРО']) {
      expect(within(group).getByRole('button', { name: label })).toBeTruthy();
    }
    expect(within(group).getByRole('button', { name: 'ВСЕ' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('programs-pinned-count')).not.toBeInTheDocument();
  });

  it('поиск фильтрует список по имени (регистронезависимо)', () => {
    render(<ProgramsScreen />);
    expect(tileNames()).toHaveLength(9);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по программам' }), { target: { value: 'craft' } });
    const names = tileNames();
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('NEXUS Craft');
  });

  it('поиск по описанию тоже работает (нет совпадений в имени)', () => {
    render(<ProgramsScreen />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по программам' }), { target: { value: 'агент' } });
    const names = tileNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n.includes('NEXUS'))).toBe(true);
  });

  it('пустой результат запроса → EmptyState «Ничего не найдено»', () => {
    render(<ProgramsScreen />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по программам' }), { target: { value: 'zzz-нет-такого' } });
    expect(screen.getByText(/Ничего не найдено/)).toBeTruthy();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('фильтр «СКОРО» оставляет только IGMA', () => {
    render(<ProgramsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'СКОРО' }));
    const names = tileNames();
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('NEXUS IGMA');
    expect(screen.getByRole('button', { name: 'СКОРО' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('фильтр «ГОТОВО» исключает soon', () => {
    render(<ProgramsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'ГОТОВО' }));
    const names = tileNames();
    expect(names.every((n) => !n.includes('IGMA'))).toBe(true);
  });

  it('пин плитки: счётчик появляется, не затирается поиском, персистит в localStorage', () => {
    render(<ProgramsScreen />);
    const pin = screen.getByTestId('pin-igma'); // soon-тайл тоже пинится
    fireEvent.click(pin);
    expect(screen.getByTestId('programs-pinned-count').textContent).toContain('1');
    expect(JSON.parse(window.localStorage.getItem('nexus.programs.pinned')!)).toEqual(['igma']);
    // поиск не сбрасывает пины
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по программам' }), { target: { value: 'craft' } });
    expect(screen.getByTestId('programs-pinned-count').textContent).toContain('1');
  });

  it('запиненные программы идут первыми в списке', () => {
    render(<ProgramsScreen />);
    // сначала все в манифестном порядке: bus первый
    expect(screen.getByRole('list', { name: 'Программы' }).textContent!.indexOf('NEXUS Bus')).toBeLessThan(
      screen.getByRole('list', { name: 'Программы' }).textContent!.indexOf('NEXUS IGMA'),
    );
    fireEvent.click(screen.getByTestId('pin-igma'));
    // теперь IGMA (запинена) — первой
    expect(screen.getByRole('list', { name: 'Программы' }).textContent!.indexOf('NEXUS IGMA')).toBeLessThan(
      screen.getByRole('list', { name: 'Программы' }).textContent!.indexOf('NEXUS Bus'),
    );
  });

  it('открепить: счётчик уходит, localStorage обновляется', () => {
    window.localStorage.setItem('nexus.programs.pinned', JSON.stringify(['craft']));
    render(<ProgramsScreen />);
    expect(screen.getByTestId('programs-pinned-count').textContent).toContain('1');
    const pin = screen.getByTestId('pin-craft');
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(pin);
    expect(screen.queryByTestId('programs-pinned-count')).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('nexus.programs.pinned')!)).toEqual([]);
  });

  it('LaunchPanel: чип «ЗАКРЕПЛЕНО»/«ЗАКРЕПИТЬ» переключает пин', () => {
    render(<ProgramsScreen />);
    fireEvent.click(within(screen.getByRole('list', { name: 'Программы' })).getByRole('button', { name: 'NEXUS Craft' }));
    const panel = screen.getByTestId('program-launch-panel');
    const chip = within(panel).getByRole('button', { name: 'ЗАКРЕПИТЬ' });
    fireEvent.click(chip);
    expect(within(panel).getByRole('button', { name: 'ЗАКРЕПЛЕНО' })).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem('nexus.programs.pinned')!)).toEqual(['craft']);
    // закрываем и открываем заново — пин сохранился
    fireEvent.click(screen.getByRole('button', { name: /Назад к программам/ }));
    fireEvent.click(within(screen.getByRole('list', { name: 'Программы' })).getByRole('button', { name: 'NEXUS Craft' }));
    expect(within(screen.getByTestId('program-launch-panel')).getByRole('button', { name: 'ЗАКРЕПЛЕНО' })).toBeTruthy();
  });
});

// fireKeyEvent helper for key events
function fireKeyEvent(element: Element | Document, event: { key: string; code: string }) {
  element.dispatchEvent(new KeyboardEvent('keydown', event));
}