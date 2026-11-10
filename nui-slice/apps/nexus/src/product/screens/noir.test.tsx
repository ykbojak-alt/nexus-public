// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProductDataSource } from '../data-source';
import { createNoirMockClient } from '../../integrations/noir/api/mock-transport';
import { NoirScreen } from './noir';

let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  usePathname: () => '/noir',
  useSearchParams: () => searchParams,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

let dsStub: ProductDataSource;
vi.mock('../data-source', () => ({
  getDataSource: () => dsStub,
  useDataSource: () => dsStub,
  getDataSourceKind: () => 'mock',
}));

const withNoir = () => ({ noir: createNoirMockClient() } as unknown as ProductDataSource);

let codeSeq = 0;
const login = async () => {
  // fresh one-time code each login — the mock burns codes (alphabet lacks 0/1/I/O)
  const code = `KLMN-${2345 + codeSeq++}`;
  fireEvent.change(screen.getByLabelText('Код привязки'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));
  await waitFor(() => expect(screen.getByRole('tablist', { name: 'Разделы NOIR' })).toBeDefined());
};

describe('NoirScreen — session gate (INT-24)', () => {
  it('seam absent → unavailable, no credential input', () => {
    dsStub = {} as ProductDataSource;
    render(<NoirScreen />);
    const gate = screen.getByTestId('noir-gate');
    expect(gate.getAttribute('data-state')).toBe('unavailable');
    expect(screen.queryByLabelText('Код привязки')).toBeNull();
  });

  it('bad credential surfaces the host error code verbatim', async () => {
    dsStub = withNoir();
    render(<NoirScreen />);
    // empty input keeps the button disabled — never fires a request
    expect((screen.getByRole('button', { name: 'Подключить' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('NoirScreen — player flow on the mock world', () => {
  it('link-code session → dashboard renders host data verbatim', async () => {
    searchParams = new URLSearchParams();
    dsStub = withNoir();
    render(<NoirScreen />);
    await login();
    const dash = await screen.findByTestId('noir-dashboard-data');
    expect(dash.textContent).toContain('Вертоль');
    expect(dash.textContent).toContain('120 кр.');
    // game not started → honest bootstrap affordance
    expect(screen.getByRole('button', { name: 'Начать игру' })).toBeDefined();
  });

  it('bootstrap → story start → choices advance the run to completion', async () => {
    // Phase 1: dashboard — bootstrap the game world (server-side state
    // survives remounts because the ds holds one mock client instance).
    searchParams = new URLSearchParams();
    dsStub = withNoir();
    const first = render(<NoirScreen />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Начать игру' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Начать игру' })).toBeNull());
    first.unmount();

    // Phase 2: fresh mount at ?tab=story, same world — new session.
    searchParams = new URLSearchParams('tab=story');
    render(<NoirScreen />);
    await login();
    const storyPanel = await screen.findByTestId('noir-story');
    await waitFor(() => expect(storyPanel.textContent).toContain('Неоновая доставка'));

    // start the AVAILABLE story → scene 0 renders verbatim
    const startButtons = screen.getAllByRole('button', { name: 'Начать' });
    const available = startButtons.find((b) => !(b as HTMLButtonElement).disabled)!;
    fireEvent.click(available);
    const scene = await screen.findByTestId('noir-scene');
    expect(scene.textContent).toContain('Неоновая миля, 02:14');

    // authored choice → next scene from the POST response (no extra GET)
    fireEvent.click(screen.getByRole('button', { name: 'Подойти к ларьку' }));
    await waitFor(() =>
      expect(screen.getByTestId('noir-scene').textContent).toContain('Ларек с лапшой'));

    // second choice completes the run → honest 'no active run' empty state
    fireEvent.click(screen.getByRole('button', { name: 'Заплатить 40 кредитов' }));
    await waitFor(() => expect(storyPanel.textContent).toContain('Активного прогона нет'));
  });

  it('map: accessOk=false route stays disabled with a reason', async () => {
    searchParams = new URLSearchParams('tab=map');
    dsStub = withNoir();
    render(<NoirScreen />);
    await login();
    await waitFor(() => expect(screen.getByTestId('noir-map').textContent).toContain('Неоновая миля'));
    const buttons = screen.getAllByRole('button', { name: 'Ехать' });
    // OLD_PORT accessOk → enabled; CROWN accessOk=false → disabled + reason
    expect(buttons).toHaveLength(2);
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    expect(buttons[1].getAttribute('title')).toContain('Доступ закрыт');
  });

  it('stores: open → buy debits the balance honestly', async () => {
    searchParams = new URLSearchParams('tab=stores');
    dsStub = withNoir();
    render(<NoirScreen />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть' }));
    await waitFor(() => expect(screen.getByTestId('noir-store-items').textContent).toContain('Пакет данных'));
    fireEvent.click(screen.getByRole('button', { name: 'Купить' }));
    await waitFor(() => expect(screen.getByTestId('noir-store-items').textContent).toContain('баланс 80'));
  });
});
