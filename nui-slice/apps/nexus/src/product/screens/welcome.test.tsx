// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/welcome',
  useSearchParams: () => new URLSearchParams(''),
}));

import { WelcomeScreen } from './welcome';
import { loadProfile, resetProfileStore } from '../profile/profile-store';

describe('welcome — ALICE-only (директива 02.11)', () => {
  beforeEach(() => { resetProfileStore(); push.mockReset(); });
  afterEach(cleanup);

  it('приветствие по времени суток с именем оператора по умолчанию (Yury)', () => {
    render(<WelcomeScreen />);
    const g = screen.getByTestId('welcome-greeting').textContent ?? '';
    expect(g).toMatch(/Добр(ое утро|ый день|ый вечер|ой ночи), Yury/);
  });

  it('арт-фон + герой AGENT-A; карточек выбора персон нет', () => {
    render(<WelcomeScreen />);
    expect(document.querySelector('[data-testid="art-panel"] img[src$="welcome-backdrop.webp"]'))
      .not.toBeNull();
    expect(document.querySelector('[data-assistant="alice"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-persona]')).toHaveLength(0);
    expect(document.querySelector('[data-testid="welcome-detail"]')).toBeNull();
  });

  it('всплывающее меню имени открыто по умолчанию (role=dialog)', () => {
    render(<WelcomeScreen />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Имя оператора')).toBeInTheDocument();
    expect(within(dialog).getByText(/A\.L\.I\.C\.E\./)).toBeInTheDocument();
  });

  it('«Начать работу» сохраняет профиль (персона+тема alice) и ведёт на /home', async () => {
    render(<WelcomeScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Начать работу' }));
    expect(push).toHaveBeenCalledWith('/home');
    const saved = loadProfile();
    expect(saved?.agentId).toBe('alice');
    expect(saved?.themeId).toBe('alice');
    expect(saved?.name).toBe('Yury');
  });

  it('имя из поля переопределяет дефолт', async () => {
    render(<WelcomeScreen />);
    await userEvent.type(screen.getByLabelText('Имя оператора'), 'Ada');
    await userEvent.click(screen.getByRole('button', { name: 'Начать работу' }));
    expect(loadProfile()?.name).toBe('Ada');
  });

  it('закрытие меню оставляет кнопку «Начать» для повторного открытия', async () => {
    render(<WelcomeScreen />);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Начать' }));
    expect(screen.getByRole('dialog')).not.toBeNull();
  });
});
