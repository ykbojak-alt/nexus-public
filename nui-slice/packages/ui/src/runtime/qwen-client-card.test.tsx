import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { QwenClientCard } from './qwen-client-card/qwen-client-card';
import { RuntimeClientCatalog } from './client-catalog/client-catalog';

describe('QwenClientCard', () => {
  it('renders name, verbatim version and liveness badge', () => {
    render(<QwenClientCard version="0.24.7" state="ready" />);
    const card = screen.getByTestId('qwen-client-card');
    expect(card).toHaveAttribute('data-client', 'qwen');
    expect(card).toHaveAttribute('data-state', 'ready');
    expect(screen.getByText('Qwen Code')).toBeInTheDocument();
    expect(screen.getByText('v0.24.7')).toBeInTheDocument();
    expect(screen.getByText('Готов')).toBeInTheDocument();
  });

  it('honest unavailable: verbatim reason, no invented subsystems', () => {
    render(<QwenClientCard state="unavailable" reason="клиент не авторизован: qwen oauth отсутствует" />);
    expect(screen.getByText('Недоступен')).toBeInTheDocument();
    expect(screen.getByText('клиент не авторизован: qwen oauth отсутствует')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Подсистемы клиента' })).not.toBeInTheDocument();
    expect(screen.queryByText('Активно')).not.toBeInTheDocument();
  });

  it('unknown is the default — never pretends readiness', () => {
    render(<QwenClientCard />);
    expect(screen.getByTestId('qwen-client-card')).toHaveAttribute('data-state', 'unknown');
    expect(screen.getByText('Нет данных')).toBeInTheDocument();
    expect(screen.queryByText('v0.')).not.toBeInTheDocument();
  });

  it('renders subsystem rows with verbatim detail and states', () => {
    render(<QwenClientCard version="0.24.7" state="ready" subsystems={[
      { kind: 'mcp', state: 'configured', detail: '2 сервера: filesystem, fetch' },
      { kind: 'hooks', state: 'disabled' },
      { kind: 'extensions', state: 'unavailable', detail: 'каталог не отвечает' },
      { kind: 'channels', state: 'unknown' },
    ]} />);
    const list = screen.getByRole('list', { name: 'Подсистемы клиента' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('MCP');
    expect(rows[0]).toHaveTextContent('Настроено');
    expect(rows[0]).toHaveTextContent('2 сервера: filesystem, fetch');
    expect(rows[1]).toHaveTextContent('Хуки');
    expect(rows[1]).toHaveAttribute('data-state', 'disabled');
    expect(rows[3]).toHaveTextContent('Нет данных');
  });

  it('capabilities chips are verbatim; onOpen fires', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<QwenClientCard state="ready" capabilities={['plan', 'auto-edit', 'yolo']} onOpen={onOpen} />);
    expect(screen.getByRole('list', { name: 'Возможности клиента' })).toHaveTextContent('auto-edit');
    await user.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('lives inside RuntimeClientCatalog children slot', () => {
    render(
      <RuntimeClientCatalog clients={[]} groupBy="none" emptyReason="x">
        <QwenClientCard state="not-installed" reason="бинарь qwen не найден в PATH" />
      </RuntimeClientCatalog>,
    );
    // Empty catalog still shows EmptyState — the card is rendered only in ready state.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('axe: no violations', async () => {
    const { container } = render(
      <QwenClientCard version="0.24.7" state="ready"
        subsystems={[{ kind: 'mcp', state: 'active', detail: 'filesystem' }]}
        capabilities={['plan']} onOpen={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
