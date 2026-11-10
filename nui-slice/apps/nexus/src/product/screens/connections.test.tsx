// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
  list: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  calendarAgenda: vi.fn(),
  pickedDocuments: vi.fn(),
}));

vi.mock('../data-source', () => ({
  getDataSourceKind: () => 'mock',
  getDataSource: () => ({ services }),
  useDataSource: () => ({ services }),
}));

import { ConnectionsScreen } from './connections';

afterEach(cleanup);
beforeEach(() => {
  for (const fn of Object.values(services)) fn.mockReset();
  services.list.mockResolvedValue([{
    id: 'google-docs.api',
    name: 'Google Docs',
    mode: 'api',
    state: 'connected',
    scopes: ['docs.read'],
    summary: 'Выбранные документы',
    connectable: false,
  }]);
  services.calendarAgenda.mockResolvedValue([]);
  services.pickedDocuments.mockResolvedValue([{
    docId: 'doc-7',
    name: 'План проекта',
    meta: 'Google Docs · выбран через Picker (mock)',
    content: 'Проверяемый документ',
  }]);
});

describe('ConnectionsScreen document picker', () => {
  it('keeps preview, but does not present a fake provider write action', async () => {
    render(<ConnectionsScreen />);
    const docs = await screen.findByTestId('conn-docs');
    expect(within(docs).getByText(/Запись обратно недоступна/)).toBeTruthy();
    expect(within(docs).queryByRole('button', { name: 'Save' })).toBeNull();

    await userEvent.click(within(docs).getByRole('button', { name: 'Preview' }));
    expect(within(docs).getByTestId('doc-preview').textContent).toContain('Проверяемый документ');
  });
});
