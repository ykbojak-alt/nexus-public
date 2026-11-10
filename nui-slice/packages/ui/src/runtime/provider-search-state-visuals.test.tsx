import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { describe, expect, it } from 'vitest';
import { ProviderSearchResults } from './provider-search-results/provider-search-results';

const RUNTIME_CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'runtime.module.css'),
  'utf8',
);

const LONG_REASON =
  'Источник результатов временно недоступен из-за обслуживания; проверьте состояние подключения и повторите запрос позже без потери исходного объяснения.';

describe('ProviderSearchResults state visuals (wave-XXVI)', () => {
  it('gives loading, empty, error and unavailable distinct text and semantics', async () => {
    const { container } = render(
      <div>
        <ProviderSearchResults source="Каталог" state="loading" />
        <ProviderSearchResults source="Каталог" state="empty" reason="По текущему фильтру записей нет." />
        <ProviderSearchResults source="Каталог" state="error" reason="Запрос завершился ошибкой." />
        <ProviderSearchResults source="Каталог" state="unavailable" reason={LONG_REASON} />
      </div>,
    );

    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(3);
    expect(statuses[0]).toHaveTextContent('Загружаем результаты');
    expect(statuses[1]).toHaveTextContent('Ничего не найдено');
    expect(statuses[1]).toHaveTextContent('По текущему фильтру записей нет.');
    expect(screen.getByRole('alert')).toHaveTextContent('Ошибка поиска');
    expect(screen.getByRole('alert')).toHaveTextContent('Запрос завершился ошибкой.');
    const unavailable = statuses[2];
    expect(unavailable).toHaveTextContent('Поиск недоступен');
    expect(unavailable).toHaveTextContent(LONG_REASON);
    expect(unavailable.textContent).not.toContain('…');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keeps status hierarchy token-driven and long reasons wrap without clipping', () => {
    const rule = (name: string) => RUNTIME_CSS.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    expect(rule('searchResults')).toContain('min-width: 0');
    expect(rule('searchStatusText')).toContain('overflow-wrap: anywhere');
    expect(rule('searchStatusReason')).toContain('overflow-wrap: anywhere');
    expect(rule('searchStatusTitle')).toContain('var(--nexus-text-primary');
    expect(rule('searchStatusReason')).toContain('var(--nexus-text-secondary');
    expect(RUNTIME_CSS).not.toMatch(/\.searchStatus(?:Text|Reason)\s*\{[^}]*text-overflow:\s*ellipsis/);
  });
});
