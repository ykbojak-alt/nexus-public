import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { axe } from 'jest-axe';
import { EmptyState } from './empty-state/empty-state';
import { ErrorState } from './error-state/error-state';
import { LoadingState } from './loading-state/loading-state';
import { UnavailableState } from './unavailable-state/unavailable-state';

describe('state primitives (wave-XVII)', () => {
  it('UnavailableState: polite status, RU default, honest reason — never invented', () => {
    render(<UnavailableState reason="источник не отвечает" hint="Повторите позже" />);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('data-state', 'unavailable');
    expect(screen.getByText('Недоступно')).toBeInTheDocument();
    expect(screen.getByText('источник не отвечает')).toBeInTheDocument();
    expect(el).toHaveTextContent('Повторите позже');
  });

  it('UnavailableState without reason shows title only — no dash, no zero', () => {
    render(<UnavailableState title="Голосовой канал" />);
    const el = screen.getByTestId('unavailable-state');
    expect(el).toHaveTextContent('Голосовой канал');
    expect(el).not.toHaveTextContent('—');
    expect(el).not.toHaveTextContent('0');
  });

  it('UnavailableState inline keeps role=status on one line', () => {
    render(<UnavailableState variant="inline" title="Метрики" reason="runtime не вернул данные" />);
    const el = screen.getByRole('status');
    expect(el.tagName).toBe('P');
    expect(el).toHaveTextContent('Метрики — runtime не вернул данные');
  });

  it('EmptyState renders reason distinctly and announces politely', () => {
    render(<EmptyState title="История пуста" body="Прогонов пока не было" reason="фильтр «сегодня» ничего не нашёл" />);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('data-state', 'empty');
    expect(screen.getByText('фильтр «сегодня» ничего не нашёл')).toBeInTheDocument();
  });

  it('ErrorState keeps role=alert with RU retry', () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveAttribute('data-state', 'error');
    expect(screen.getByText('Что-то пошло не так')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('LoadingState announces politely', () => {
    render(<LoadingState>Загружаем ленту…</LoadingState>);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('data-state', 'loading');
  });

  it('persona tone binds data-persona on every primitive', () => {
    render(
      <>
        <EmptyState title="Пусто" tone="alice" />
        <ErrorState tone="mech" />
        <UnavailableState tone="forge" />
        <LoadingState tone="arch">Загрузка…</LoadingState>
      </>,
    );
    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-persona', 'alice');
    expect(screen.getByTestId('error-state')).toHaveAttribute('data-persona', 'mech');
    expect(screen.getByTestId('unavailable-state')).toHaveAttribute('data-persona', 'forge');
    expect(screen.getByTestId('loading-state')).toHaveAttribute('data-persona', 'arch');
  });

  it('axe: no violations across the four primitives', async () => {
    const { container } = render(
      <div>
        <EmptyState title="Нет записей" reason="фильтр пуст" />
        <ErrorState title="Ошибка загрузки" />
        <UnavailableState title="Канал" reason="офлайн" />
        <LoadingState>Загрузка…</LoadingState>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
