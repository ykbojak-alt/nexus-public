// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssistantHero, type AssistantHeroId } from './assistant-hero';

afterEach(cleanup);

const IDS: { id: AssistantHeroId; name: string }[] = [
  { id: 'alice', name: 'AGENT-A' },
  { id: 'arch', name: 'A.R.C.H.' },
  { id: 'codex', name: 'ROLE-1' },
  { id: 'forge', name: 'ROLE-2' },
  { id: 'mech', name: 'M.E.C.H.' },
];

describe('AssistantHero — wave-IX IX.3 (единый герой пяти ассистентов)', () => {
  it.each(IDS)('$id: арт из манифеста, реальный alt, data-assistant', ({ id, name }) => {
    const { container } = render(<AssistantHero assistant={id} mode="m" />);
    const hero = container.querySelector('[data-assistant]');
    expect(hero?.getAttribute('data-assistant')).toBe(id);
    const img = document.querySelector('img');
    expect(img).toBeTruthy();
    expect(decodeURIComponent(img!.getAttribute('src')!)).toContain(`/art/agent-${id}.webp`);
    // образ несёт идентичность — реальный alt, без aria-hidden подмены
    const role = id === 'alice' ? 'ассистента' : 'субагента';
    expect(img!.getAttribute('alt')).toBe(`Образ ${role} ${name}`);
    expect(img!.closest('[aria-hidden="true"]')).toBeNull();
  });

  it.each(IDS)('$id: ассет не грузится → нейтральный пусто-стейт, не фейк-портрет', async ({ id, name }) => {
    render(<AssistantHero assistant={id} />);
    const img = document.querySelector('img');
    img!.dispatchEvent(new Event('error'));
    const state = await screen.findByTestId('empty-state');
    expect(state.textContent).toBe(`Образ ${name} в подготовке`);
    // никакой монограммы-подмены — только честная подпись
    expect(document.querySelector('[data-portrait="empty"] img')).toBeNull();
  });

  it('режим-пилюля + quick-chips: клик зовёт onChip verbatim, группа с подписью', async () => {
    const user = userEvent.setup();
    const onChip = vi.fn();
    render(
      <AssistantHero assistant="forge" mode="Инженерный контур"
        chips={[{ id: 'c1', label: 'Собери план рефактора' }]} onChip={onChip}>
        <h1>Заголовок владельца</h1>
      </AssistantHero>,
    );
    expect(screen.getByText('Инженерный контур')).toBeTruthy();
    expect(screen.getByText('Заголовок владельца')).toBeTruthy();
    const group = screen.getByRole('group', { name: 'Быстрые действия' });
    expect(group).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Собери план рефактора' }));
    expect(onChip).toHaveBeenCalledWith({ id: 'c1', label: 'Собери план рефактора' });
  });

  it('variant=figure: data-атрибут и крупные размеры image', () => {
    const { container } = render(
      <AssistantHero assistant="alice"
        portrait={{ src: '/art/alice-main-hero.webp', variant: 'figure' }} />,
    );
    expect(container.querySelector('[data-variant]')?.getAttribute('data-variant')).toBe('figure');
    const img = document.querySelector('img');
    expect(img!.getAttribute('width')).toBe('600');
    expect(decodeURIComponent(img!.getAttribute('src')!)).toContain('/art/alice-main-hero.webp');
  });

  it('переданный портрет перекрывает дефолт; пустой alt = декоративный образ', () => {
    render(<AssistantHero assistant="mech"
      portrait={{ src: '/art/custom.webp', alt: '' }} />);
    const img = document.querySelector('img');
    expect(decodeURIComponent(img!.getAttribute('src')!)).toContain('/art/custom.webp');
    expect(img!.getAttribute('alt')).toBe('');
  });
});
