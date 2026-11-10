import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PanelHeader } from './panel-header';

afterEach(cleanup);

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'panel-header.module.css'),
  'utf8',
);

const longTitle =
  'Заголовок панели с очень длинным русским названием, которое должно переноситься целиком и никогда не скрываться за многоточием';

describe('PanelHeader', () => {
  it('renders heading rank by level and honours headingLevel override', () => {
    const { rerender } = render(
      <main>
        <PanelHeader level="panel" title="Плагины" />
      </main>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Плагины' })).toBeInTheDocument();

    rerender(
      <main>
        <PanelHeader level="section" title="Раздел рантайма" />
      </main>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Раздел рантайма' })).toBeInTheDocument();

    rerender(
      <main>
        <PanelHeader level="screen" title="Настройки" />
      </main>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Настройки' })).toBeInTheDocument();

    rerender(
      <main>
        <PanelHeader level="panel" headingLevel={5} title="Глубокий уровень" />
      </main>,
    );
    expect(screen.getByRole('heading', { level: 5, name: 'Глубокий уровень' })).toBeInTheDocument();
  });

  it('exposes titleId for region labelling, keeps icon decorative and text full', async () => {
    render(
      <main>
        <section aria-labelledby="dock-title">
          <PanelHeader
            level="panel"
            title={longTitle}
            titleId="dock-title"
            icon={<svg data-testid="glyph" />}
            subtitle="12 плагинов · локально"
            actions={<button type="button">Закрыть</button>}
          />
        </section>
      </main>,
    );
    const heading = screen.getByRole('heading', { name: longTitle });
    expect(heading).toHaveAttribute('id', 'dock-title');
    expect(heading.textContent).toBe(longTitle);
    expect(screen.getByTestId('glyph').parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('uses title.* tokens for typography and chrome — no literal font sizes', () => {
    for (const level of ['panel', 'section', 'screen']) {
      for (const part of ['font-size', 'line-height', 'font-weight', 'letter-spacing', 'font-family']) {
        expect(CSS, `missing --nexus-title-${level}-${part}`).toContain(`--nexus-title-${level}-${part}`);
      }
    }
    for (const chrome of ['color', 'subtitle-color', 'icon-color', 'divider', 'gap', 'icon-size', 'padding-block', 'padding-inline']) {
      expect(CSS, `missing --nexus-title-${chrome}`).toContain(`--nexus-title-${chrome}`);
    }
    const titleRules = CSS.match(/\.title\s*\{[^}]*\}|\.level\w+\s+\.title\s*\{[^}]*\}/g) ?? [];
    for (const rule of titleRules) {
      expect(rule).not.toMatch(/font-size:\s*\d/);
    }
  });
});
