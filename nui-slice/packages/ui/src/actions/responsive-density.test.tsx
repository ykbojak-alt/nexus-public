import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { describe, expect, it } from 'vitest';
import { Chip } from './chip/chip';
import { Button } from './button/button';
import { Toolbar, ToolbarGroup } from '../surfaces/toolbar/toolbar';

const UI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SURFACES_CSS = readFileSync(join(UI_ROOT, 'surfaces', 'surfaces.module.css'), 'utf8');
const BUTTON_CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'button', 'button.module.css'), 'utf8');

describe('responsive density controls (wave-XXVI)', () => {
  it('wraps toolbar groups while keeping all Russian labels and hit targets', async () => {
    const labels = [
      'Все диагностические прогоны',
      'Ожидают подтверждения оператора',
      'Завершённые межсервисные проверки',
    ];
    const { container } = render(
      <Toolbar label="Фильтры задач">
        <ToolbarGroup>
          {labels.map((label) => <Chip key={label} onSelect={() => { }}>{label}</Chip>)}
        </ToolbarGroup>
      </Toolbar>,
    );
    const toolbar = screen.getByRole('toolbar', { name: 'Фильтры задач' });
    expect(toolbar).toHaveTextContent(labels.join(''));
    expect(screen.getAllByRole('button')).toHaveLength(labels.length);
    expect(await axe(container)).toHaveNoViolations();

    const rule = (className: string) => SURFACES_CSS.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    expect(rule('toolbar')).toContain('flex-wrap: wrap');
    expect(rule('toolbar')).toContain('min-width: 0');
    expect(rule('toolbarGroup')).toContain('flex-wrap: wrap');
    expect(rule('toolbarGroup')).toContain('min-width: 0');
  });

  it('retains a static loading indicator under reduced motion', () => {
    render(<Button loading>Публикация</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    const reduceRule = BUTTON_CSS.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(reduceRule).toMatch(/\.spinner\s*\{\s*animation:\s*none;/);
    expect(reduceRule).toMatch(/\.root\s*\{\s*transition:\s*none;/);
  });
});
