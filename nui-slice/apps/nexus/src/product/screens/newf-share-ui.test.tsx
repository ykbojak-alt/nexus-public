// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShareDialog, SharesList } from './newf-share-ui';
import type { NewfBridge } from './newf-live';

afterEach(() => { cleanup(); sessionStorage.clear(); });

function bridge(): NewfBridge {
  return {
    spaces: async () => [],
    terminals: async () => [],
    agents: async () => [],
    screen: async () => '',
    send: async () => {},
    keys: async () => {},
    shareCreate: vi.fn(async () => ({
      token: 'tok-12345678-abcdefgh',
      term: 'local/t1',
      scopes: ['screen'],
      expiresAt: 9999999999,
      viewUrl: '/view/tok-12345678-abcdefgh/screen',
    })),
    shares: vi.fn(async () => [
      { token: 'tok-1234…', term: 'local/t1', scopes: ['screen'], expiresAt: 9999999999, expired: false, hits: 2 },
    ]),
    shareRevoke: vi.fn(async () => ({ revoked: true })),
  };
}

describe('ShareDialog (W38)', () => {
  it('создание: scope/ttl → shareCreate, показывается ссылка + копирование', async () => {
    const b = bridge();
    // viewUrl пустой → ссылка строится из token+выбранного scope (проверяет обе ветки)
    b.shareCreate = vi.fn(async (_term, opts) => ({
      token: 'tok-12345678-abcdefgh',
      term: 'local/t1',
      scopes: opts.scopes ?? ['screen'],
      expiresAt: 9999999999,
      viewUrl: '',
    }));
    render(<ShareDialog bridge={b} term="local/t1" base="http://localhost:5684" onClose={() => {}} />);

    expect(screen.getByTestId('share-scope')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('share-scope'), { target: { value: 'dump' } });
    fireEvent.change(screen.getByTestId('share-ttl'), { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('share-create'));

    await waitFor(() => expect(b.shareCreate).toHaveBeenCalledWith('local/t1', { scopes: ['dump'], ttlS: 1800 }));
    const url = await screen.findByTestId('share-url');
    expect(url).toHaveTextContent('http://localhost:5684/view/tok-12345678-abcdefgh/dump');
    expect(screen.getByTestId('share-copy')).toBeInTheDocument();
  });

  it('ошибка создания → честная плашка', async () => {
    const b = bridge();
    b.shareCreate = vi.fn().mockRejectedValue(new Error('bridge 403: denied'));
    render(<ShareDialog bridge={b} term="local/t1" onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('share-create'));
    await waitFor(() => expect(screen.getByTestId('share-error')).toHaveTextContent(/403/));
  });

  it('закрытие по ×', async () => {
    const onClose = vi.fn();
    render(<ShareDialog bridge={bridge()} term="local/t1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('share-close'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('SharesList (W38)', () => {
  it('список: префикс/term/scope/hits + revoke для сессионного токена', async () => {
    // полный токен лежит в sessionStorage под «nexus.share.<full>»
    sessionStorage.setItem('nexus.share.tok-12345678-abcdefgh', JSON.stringify({}));
    const b = bridge();
    render(<SharesList bridge={b} />);

    await screen.findByTestId('share-tok-1234…');
    expect(screen.getByTestId('share-tok-1234…')).toHaveTextContent('local/t1');
    expect(screen.getByTestId('share-tok-1234…')).toHaveTextContent('2 hits');
    fireEvent.click(screen.getByTestId('share-revoke-tok-1234…'));
    await waitFor(() => expect(b.shareRevoke).toHaveBeenCalledWith('tok-12345678-abcdefgh'));
    await waitFor(() => expect(screen.queryByTestId('share-tok-1234…')).not.toBeInTheDocument());
  });

  it('revoke скрыт, если полного токена нет в сессии (префикс из API)', async () => {
    const b = bridge();
    render(<SharesList bridge={b} />);
    await screen.findByTestId('share-tok-1234…');
    expect(screen.queryByTestId('share-revoke-tok-1234…')).not.toBeInTheDocument();
  });

  it('нет метода shares → ничего не рендерится (честно)', async () => {
    const b = bridge();
    delete b.shares;
    render(<SharesList bridge={b} />);
    expect(screen.queryByTestId('shares-section')).not.toBeInTheDocument();
  });
});
