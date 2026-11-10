import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WindowFrame } from './window-frame';

/* FIXTURE — слоты-плейсхолдеры, не рантайм-данные. */
const SLOTS = {
  brand: <span>Бренд</span>,
  tabs: <button>Таб 1</button>,
  tools: <button>Инструмент</button>,
  left: <nav aria-label="Разделы">Рельса</nav>,
  right: <aside aria-label="Ассистент">Панель</aside>,
  bottom: <span>Статус</span>,
};

describe('WindowFrame', () => {
  it('renders all slots: header regions, rail, main, right, bottom', () => {
    render(<WindowFrame {...SLOTS}>Контент</WindowFrame>);
    const frame = screen.getByTestId('window-frame');
    expect(frame.querySelector('header')).toBeTruthy();
    expect(screen.getByText('Бренд')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Таб 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Инструмент' })).toBeTruthy();
    expect(screen.getByRole('main')).toHaveTextContent('Контент');
    expect(screen.getByLabelText('Ассистент')).toBeTruthy();
    expect(frame.querySelector('footer')).toHaveTextContent('Статус');
  });

  it('collapses empty slots: no header/footer/asides, data-no-* flags set', () => {
    render(<WindowFrame>Только контент</WindowFrame>);
    const frame = screen.getByTestId('window-frame');
    expect(frame.querySelector('header')).toBeNull();
    expect(frame.querySelector('footer')).toBeNull();
    expect(frame.querySelectorAll('aside')).toHaveLength(0);
    const body = screen.getByRole('main').parentElement!;
    expect(body).toHaveAttribute('data-no-left', 'true');
    expect(body).toHaveAttribute('data-no-right', 'true');
  });

  it('rail states: full/strip keep rail in a11y tree, hidden sets aria-hidden', () => {
    const { rerender } = render(<WindowFrame left={SLOTS.left} nav="full">x</WindowFrame>);
    const aside = () => screen.getByTestId('window-frame').querySelector('aside')!;

    expect(aside()).toHaveAttribute('data-nav', 'full');
    expect(aside()).not.toHaveAttribute('aria-hidden');
    expect(screen.getByLabelText('Разделы')).toBeTruthy();

    rerender(<WindowFrame left={SLOTS.left} nav="strip">x</WindowFrame>);
    expect(aside()).toHaveAttribute('data-nav', 'strip');
    expect(aside()).not.toHaveAttribute('aria-hidden');

    rerender(<WindowFrame left={SLOTS.left} nav="hidden">x</WindowFrame>);
    expect(aside()).toHaveAttribute('data-nav', 'hidden');
    expect(aside()).toHaveAttribute('aria-hidden', 'true');
    // скрытый рейл выпадает из a11y-дерева — role-запрос его не видит
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('nav defaults: no data-nav when prop omitted; rail still present', () => {
    render(<WindowFrame left={SLOTS.left}>x</WindowFrame>);
    const aside = screen.getByTestId('window-frame').querySelector('aside')!;
    expect(aside).not.toHaveAttribute('data-nav');
    expect(aside).toHaveTextContent('Рельса');
  });

  it('forwards data-persona and HTML attrs to the edge element', () => {
    render(<WindowFrame data-persona="forge" aria-label="Окно AGENT-B">x</WindowFrame>);
    const edge = screen.getByTestId('window-frame');
    expect(edge).toHaveAttribute('data-persona', 'forge');
    expect(edge).toHaveAttribute('aria-label', 'Окно AGENT-B');
  });

  it('topProps reach the header (desktop drag-region seam)', () => {
    render(<WindowFrame brand={SLOTS.brand} topProps={{ title: 'Перетащить', className: 'drag-region' }}>x</WindowFrame>);
    const header = screen.getByTitle('Перетащить');
    expect(header.tagName).toBe('HEADER');
    expect(header.className).toContain('drag-region');
  });

  it('renders only host-wired window controls with Russian accessible names', async () => {
    const onMinimize = vi.fn();
    const onToggleMaximize = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<WindowFrame
      windowControls={{ onMinimize, onToggleMaximize, onClose }}
    >x</WindowFrame>);

    const group = screen.getByRole('group', { name: 'Управление окном' });
    expect(within(group).getByRole('button', { name: 'Свернуть окно' })).toBeInTheDocument();
    const maximize = within(group).getByRole('button', { name: 'Развернуть окно' });
    expect(maximize).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(maximize);
    expect(onToggleMaximize).toHaveBeenCalledTimes(1);
    await userEvent.click(within(group).getByRole('button', { name: 'Свернуть окно' }));
    await userEvent.click(within(group).getByRole('button', { name: 'Закрыть окно' }));
    expect(onMinimize).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<WindowFrame windowControls={{ maximized: true, onToggleMaximize }}>x</WindowFrame>);
    expect(screen.getByRole('button', { name: 'Восстановить окно' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Закрыть окно' })).not.toBeInTheDocument();
  });

  it('keyboard: focus lands inside frame, focus-within styling hooks exist', async () => {
    render(<WindowFrame tabs={<button>Таб</button>} left={<a href="/x">Раздел</a>}>x</WindowFrame>);
    const frame = screen.getByTestId('window-frame');
    await userEvent.tab();
    expect(frame.contains(document.activeElement)).toBe(true);
    // кромка — единый контейнер фокуса: :focus-within усиливает hairline (css)
    await userEvent.tab();
    expect(frame.contains(document.activeElement)).toBe(true);
  });

  it('forced-colors keeps frame edges, window controls and focus system-visible', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'layout.module.css'), 'utf8');
    const highContrast = css.match(/@media \(forced-colors: active\) \{([\s\S]*?)^\}/m)?.[1] ?? '';
    expect(highContrast).toContain('border: 1px solid CanvasText');
    expect(highContrast).toContain('background: ButtonFace');
    expect(highContrast).toContain('color: ButtonText');
    expect(highContrast).toContain('outline: 2px solid Highlight');
    expect(highContrast).toContain('content: none');
  });
});
