// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PanelSkeleton } from './skeleton-panel';

describe('PanelSkeleton (UI-5)', () => {
  it('рендерит 4 баров-скелетона с role=status и data-testid', () => {
    render(<PanelSkeleton hint="Читаю метрики…" />);
    const root = screen.getByTestId('panel-skeleton');
    expect(root.getAttribute('role')).toBe('status');
    expect(root.querySelectorAll('[data-state="loading"]')).toHaveLength(4);
    // подсказка доступна скринридерам (sr-only)
    expect(root.textContent).toContain('Читаю метрики…');
  });
});
