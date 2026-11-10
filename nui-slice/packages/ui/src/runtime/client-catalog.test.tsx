import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { RuntimeClientCatalog, type RuntimeClientEntry } from './client-catalog/client-catalog';

const CLIENTS: RuntimeClientEntry[] = [
  { id: 'ig-web', name: 'Instagram', provider: 'Instagram', mode: 'web', state: 'connected', onOpen: () => {} },
  { id: 'ig-api', name: 'Instagram', provider: 'Instagram', mode: 'api', state: 'read-only', scopes: ['ig.read'], summary: 'Чтение медиа', onDisconnect: () => {} },
  { id: 'tg-app', name: 'Telegram', provider: 'Telegram', mode: 'native-app', state: 'region-unavailable', reason: 'Приложение недоступно в регионе' },
  { id: 'gd-api', name: 'Google Drive', provider: 'Google Drive', mode: 'api', state: 'not-connected', onConnect: () => {} },
];

describe('RuntimeClientCatalog', () => {
  it('renders cards grouped by access mode with list semantics', () => {
    render(<RuntimeClientCatalog clients={CLIENTS} />);
    const catalog = screen.getByTestId('runtime-client-catalog');
    expect(catalog).toHaveAttribute('data-state', 'ready');
    expect(catalog).toHaveAttribute('role', 'region');
    const apiGroup = screen.getByRole('region', { name: 'API' });
    expect(within(apiGroup).getAllByTestId('service-card')).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Веб' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Приложение' })).toBeInTheDocument();
    for (const card of within(apiGroup).getAllByTestId('service-card')) {
      expect(card.closest('li')).not.toBeNull();
    }
  });

  it('groups by provider verbatim and supports a flat list', () => {
    const { rerender } = render(<RuntimeClientCatalog clients={CLIENTS} groupBy="provider" />);
    expect(within(screen.getByRole('region', { name: 'Instagram' })).getAllByTestId('service-card')).toHaveLength(2);
    rerender(<RuntimeClientCatalog clients={CLIENTS} groupBy="none" />);
    expect(screen.getAllByTestId('service-card')).toHaveLength(4);
    expect(screen.queryByRole('region', { name: 'API' })).not.toBeInTheDocument();
  });

  it('keeps access mode distinct from connection state', () => {
    render(<RuntimeClientCatalog clients={CLIENTS} groupBy="none" />);
    const cards = screen.getAllByTestId('service-card');
    expect(cards[2]).toHaveAttribute('data-mode', 'native-app');
    expect(cards[2]).toHaveAttribute('data-state', 'region-unavailable');
  });

  it('renders unavailable cards with the verbatim adapter reason', () => {
    render(<RuntimeClientCatalog clients={CLIENTS} groupBy="none" />);
    expect(screen.getByText('Приложение недоступно в регионе')).toBeInTheDocument();
    expect(screen.getByText('Недоступно в регионе')).toBeInTheDocument();
  });

  it('catalog-level unavailable renders an honest state, not an empty grid', () => {
    render(<RuntimeClientCatalog clients={[]} state="unavailable" unavailableReason="runtime не вернул инвентарь" />);
    const catalog = screen.getByTestId('runtime-client-catalog');
    expect(catalog).toHaveAttribute('data-state', 'unavailable');
    expect(screen.getByRole('status')).toHaveTextContent('runtime не вернул инвентарь');
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('empty inventory renders an honest empty state with a reason', () => {
    render(<RuntimeClientCatalog clients={[]} emptyReason="ни один клиент не настроен" />);
    expect(screen.getByRole('status')).toHaveTextContent('Клиенты не подключены');
    expect(screen.getByRole('status')).toHaveTextContent('ни один клиент не настроен');
  });

  it('loading state announces politely', () => {
    render(<RuntimeClientCatalog clients={[]} state="loading" />);
    expect(screen.getByRole('status')).toHaveTextContent('Загружаю список клиентов');
  });

  it('card actions fire and never render unconfirmed high-impact controls', async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    render(<RuntimeClientCatalog clients={[{ id: 'x', name: 'X', mode: 'api', state: 'not-connected', onConnect }]} groupBy="none" />);
    await user.click(screen.getByRole('button', { name: 'Подключить' }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /записать|оплатить|vpn/i })).not.toBeInTheDocument();
  });

  it('axe: no violations across ready/empty/unavailable', async () => {
    const { container } = render(<>
      <RuntimeClientCatalog clients={CLIENTS} />
      <RuntimeClientCatalog clients={[]} emptyReason="нет источников" />
      <RuntimeClientCatalog clients={[]} state="unavailable" unavailableReason="адаптер offline" />
    </>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
