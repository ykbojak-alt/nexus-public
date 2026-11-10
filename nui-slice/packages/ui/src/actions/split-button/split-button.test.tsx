import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { describe, expect, it } from 'vitest';
import { SplitButton } from './split-button';

const ACTIONS_CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'actions.module.css'),
  'utf8',
);

describe('SplitButton focus resilience', () => {
  it('keeps both keyboard targets accessible without clipping their focus ring', async () => {
    const { container } = render(
      <SplitButton label="Запустить" menuLabel="Дополнительные действия" onClick={() => { }}
        items={[{ id: 'review', label: 'Открыть отчёт' }]} />,
    );
    expect(screen.getByRole('button', { name: 'Запустить' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Дополнительные действия' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    const splitRule = ACTIONS_CSS.match(/\.split\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(splitRule).toContain('overflow: visible');
    expect(splitRule).not.toContain('overflow: hidden');
    const toggleRule = ACTIONS_CSS.match(/\.splitToggle\s*\{([^}]*width:\s*32px[^}]*)\}/)?.[1] ?? '';
    expect(toggleRule).toContain('height: 36px');
  }, 15000);

  it('uses system boundaries and button colors in forced-colors mode', () => {
    const forcedColors = ACTIONS_CSS.match(/@media \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(forcedColors).toContain('border-color: ButtonText');
    expect(forcedColors).toContain('background: ButtonFace');
    expect(forcedColors).toContain('color: ButtonText');
    expect(forcedColors).toContain('border-left-color: ButtonText');
    expect(ACTIONS_CSS).not.toMatch(/\.split[^}]*forced-color-adjust:\s*none/);
  });

  it('has no non-essential motion to preserve under reduced motion', () => {
    for (const selector of ['split', 'splitMain', 'splitToggle']) {
      const rule = ACTIONS_CSS.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      expect(rule).not.toMatch(/\b(?:transition|animation)\s*:/);
    }
  });
});
