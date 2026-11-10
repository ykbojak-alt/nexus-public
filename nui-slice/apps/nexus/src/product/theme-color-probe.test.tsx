import { describe, expect, it } from 'vitest';
import { applyThemeColorMeta } from './theme-color-probe';

describe('theme-color-probe (dsh appearance-probe analog)', () => {
  it('создаёт meta[name=theme-color] и обновляет content', () => {
    document.querySelector('meta[name="theme-color"]')?.remove();
    const meta = applyThemeColorMeta('rgb(10, 10, 12)');
    expect(meta.name).toBe('theme-color');
    expect(meta.content).toBe('rgb(10, 10, 12)');
    applyThemeColorMeta('rgb(251, 248, 241)');
    // Элемент один и тот же — не плодим меты.
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content'))
      .toBe('rgb(251, 248, 241)');
  });
});
