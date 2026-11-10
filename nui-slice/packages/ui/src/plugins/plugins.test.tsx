import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  PluginCard, PluginStatusBadge, RightPanelTabBar, PluginGroup,
} from '../index';

/* FIXTURE — все данные ниже синтетические тестовые, не из хоста. */
const FX = {
  builtin: { id: 'neu.home', title: 'Домашний экран', description: 'Блоки /home в слотах', icon: 'nav.command' as const },
  local: { id: 'local.weather', title: 'Погодная панель', description: null },
  tabs: [
    { id: 't1', title: 'Лента событий' },
    { id: 't2', title: 'Файлы' },
    { id: 't3', title: 'Терминал', closable: false },
  ],
};

describe('PluginStatusBadge', () => {
  it('all four statuses render Russian labels and domain data attr', () => {
    const { rerender } = render(<PluginStatusBadge status="active" />);
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Активен');
    expect(screen.getByTestId('status-badge')).toHaveAttribute('data-plugin-status', 'active');
    for (const [st, label] of [['failed', 'Ошибка'], ['overridden', 'Переопределён'], ['restart-required', 'Нужен перезапуск']] as const) {
      rerender(<PluginStatusBadge status={st} />);
      expect(screen.getByTestId('status-badge')).toHaveTextContent(label);
    }
  });
});

describe('PluginCard', () => {
  it('renders verbatim facts; switch toggles enabled', async () => {
    const onToggle = vi.fn();
    render(<PluginCard {...FX.builtin} enabled status="active" onToggle={onToggle} />);
    expect(screen.getByText('Домашний экран')).toBeInTheDocument();
    expect(screen.getByText('Блоки /home в слотах')).toBeInTheDocument();
    expect(screen.getByText('Активен')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('builtin card disables the switch honestly; null description → «Нет описания»', () => {
    render(<PluginCard {...FX.local} builtin enabled status="overridden" onToggle={() => {}} />);
    expect(screen.getByText('Нет описания')).toBeInTheDocument();
    const sw = screen.getByRole('switch');
    expect(sw).toBeDisabled();
    expect(sw).toHaveAccessibleName(/встроенный — выключить нельзя/);
  });

  it('status null renders no badge (неизвестно — не выдумываем)', () => {
    render(<PluginCard {...FX.local} enabled={false} status={null} onToggle={() => {}} />);
    expect(screen.queryByTestId('status-badge')).not.toBeInTheDocument();
  });
});

describe('RightPanelTabBar', () => {
  it('tablist semantics: activate on click, close calls onClose, actions labeled', async () => {
    const onActivate = vi.fn(); const onClose = vi.fn();
    const onSplit = vi.fn(); const onFullscreen = vi.fn();
    render(<RightPanelTabBar tabs={FX.tabs} activeId="t1"
      onActivate={onActivate} onClose={onClose} onSplit={onSplit} onFullscreen={onFullscreen} />);
    const list = screen.getByRole('tablist', { name: 'Вкладки панели' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    await userEvent.click(tabs[1]);
    expect(onActivate).toHaveBeenCalledWith('t2');
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть вкладку «Лента событий»' }));
    expect(onClose).toHaveBeenCalledWith('t1');
    // не закрываемая вкладка — без кнопки ×
    expect(screen.queryByRole('button', { name: 'Закрыть вкладку «Терминал»' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Разделить панель' }));
    expect(onSplit).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Панель во весь экран' }));
    expect(onFullscreen).toHaveBeenCalledWith(true);
  });

  it('fullscreen mode flips the action label and marks aria-pressed', () => {
    render(<RightPanelTabBar tabs={FX.tabs} activeId="t1" mode="fullscreen" onFullscreen={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Выйти из полноэкранного режима' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('arrow keys move selection (roving tabindex)', async () => {
    const onActivate = vi.fn();
    render(<RightPanelTabBar tabs={FX.tabs} activeId="t1" onActivate={onActivate} />);
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onActivate).toHaveBeenCalledWith('t2');
    await userEvent.keyboard('{ArrowLeft}');
    expect(onActivate).toHaveBeenCalledWith('t1');
  });
});

describe('PluginGroup', () => {
  it('renders title + count; children inside list role', () => {
    render(<PluginGroup title="Встроенные" count={2}>
      <div role="listitem">Плагин А</div>
      <div role="listitem">Плагин Б</div>
    </PluginGroup>);
    expect(screen.getByRole('heading', { name: /Встроенные/ })).toHaveTextContent('2');
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
  });

  it('empty group shows honest empty label, no list', () => {
    render(<PluginGroup title="Локальные" emptyLabel="Локальных плагинов нет" />);
    expect(screen.getByText(/Локальных плагинов нет/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
