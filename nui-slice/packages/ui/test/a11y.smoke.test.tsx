/**
 * Accessibility smoke (Window 5, 2026-10-13): representative axe pass over
 * the interactive surface — Button/IconButton/StatusBadge in a GlassPanel.
 * jsdom-level: catches ARIA/role/name violations; browser-level checks
 * (contrast, focus visibility, hit targets) are Playwright+axe, not here.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';
import { Button } from '../src/actions/button/button';
import { IconButton } from '../src/actions/icon-button/icon-button';
import { StatusBadge } from '../src/feedback/status-badge/status-badge';
import { GlassPanel } from '../src/surfaces/glass-panel/glass-panel';

describe('a11y smoke (jest-axe / jsdom)', () => {
  it('interactive surface has no axe violations', async () => {
    const { container } = render(
      <GlassPanel>
        <Button variant="primary">Запустить</Button>
        <IconButton icon="nav.settings" aria-label="Настройки" />
        <StatusBadge status="online" label="Готов" />
      </GlassPanel>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
