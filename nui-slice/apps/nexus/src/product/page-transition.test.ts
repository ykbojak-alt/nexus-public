// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// CSS-зеркало pageMotion (W4-1005): правило на токенах, reduced-motion ветка,
// селектор — только корень экрана (прямой ребёнок <main> либо корень внутри
// одноуровневой обёртки — экраны ассистентов несут NexusThemeProvider-div,
// W4-1030), вложенные [data-screen] (превью, embeds) не анимируются повторно.
// Easing-токен хранит сырые координаты → только внутри cubic-bezier(var()).
const css = readFileSync(new URL('./app-shell.module.css', import.meta.url), 'utf8');

describe('pageEnter — единый переход экранов (W4-1005)', () => {
  it('правило на токенах: normal duration + enter easing, без литералов', () => {
    expect(css).toContain('@keyframes pageEnter');
    expect(css).toMatch(
      /:global\(main\)\s*>\s*\[data-screen\],\s*:global\(main\)\s*>\s*\*\s*>\s*\[data-screen\]\s*\{\s*animation: pageEnter var\(--nexus-duration-normal, 240ms\)\s*cubic-bezier\(var\(--nexus-easing-enter, 0, 0, 0\.2, 1\)\) backwards;/,
    );
    expect(css).not.toMatch(/animation: pageEnter 240ms/);
    // `both` удерживает transform после финиша → корень экрана становится
    // backdrop-root'ом и стекло панелей перестаёт размывать сцену.
    expect(css).not.toMatch(/animation: pageEnter[^;]*\sboth\s*;/);
    // Голый var(--nexus-easing-*) в shorthand ломает слои (W4-1030).
    expect(css).not.toMatch(/animation: pageEnter[^;]*\svar\(--nexus-easing/);
  });

  it('fade+lift subtle: keyframes только opacity/transform', () => {
    const kf = css.match(/@keyframes pageEnter \{([\s\S]*?)\n\}/)![1];
    expect(kf).toContain('opacity: 0');
    expect(kf).toContain('translateY(4px)');
    expect(kf).not.toMatch(/width|height|grid-template|left|top\b/);
  });

  it('reduced-motion — мгновенная замена (animation: none)', () => {
    const media = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*:global\(main\)\s*>\s*\[data-screen\],\s*:global\(main\)\s*>\s*\*\s*>\s*\[data-screen\]\s*\{\s*animation: none;/,
    );
    expect(media).toBeTruthy();
  });

  it('селектор не задевает вложенные data-screen', () => {
    expect(css).not.toMatch(/main \[data-screen\]/);
  });
});
