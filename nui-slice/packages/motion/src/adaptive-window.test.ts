import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  adaptiveWindowMotion, ADAPTIVE_WINDOW_MOTION_MS,
  ADAPTIVE_WINDOW_BREAKPOINTS, ADAPTIVE_WINDOW_SIZES,
} from './adaptive-window';
import { AdaptiveShell, AdaptiveRail, AdaptiveStrip, AdaptiveMain, AdaptiveLabel } from './adaptive-window-components';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const css = readFileSync(join(__dirname, 'adaptive-window.module.css'), 'utf-8');

describe('adaptiveWindow — примитивы адаптивного окна AGENT-A (волна XVII, задача 4)', () => {
  it('брейкпоинты и размеры по брифу Yury 17.10', () => {
    expect(ADAPTIVE_WINDOW_BREAKPOINTS.iconsAt).toBe(1000);
    expect(ADAPTIVE_WINDOW_BREAKPOINTS.singleAt).toBe(560);
    expect(ADAPTIVE_WINDOW_SIZES.railIconWidth).toBe(72);
    expect(ADAPTIVE_WINDOW_SIZES.stripHeight).toBe(52);
  });

  it('глаголы: rail 240ms, labels 140ms, strip 240ms; reduce/snapshot → 0', () => {
    expect(ADAPTIVE_WINDOW_MOTION_MS.rail).toBe(240);
    expect(ADAPTIVE_WINDOW_MOTION_MS.labels).toBe(140);
    expect(ADAPTIVE_WINDOW_MOTION_MS.strip).toBe(240);
    for (const verb of ['rail', 'labels', 'strip'] as const) {
      expect(adaptiveWindowMotion(verb, 'launch', { reducedMotion: true }).durationMs).toBe(0);
      expect(adaptiveWindowMotion(verb, 'glide', { snapshot: true }).reduced).toBe(true);
    }
  });

  it('CSS: container query на 1000px (рельс→72px) и 560px (strip→52px)', () => {
    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('@container nexus-window (max-width: 1000px)');
    expect(css).toContain('@container nexus-window (max-width: 560px)');
    expect(css).toContain('--nexus-adaptive-rail-w: 72px');
    expect(css).toContain('--nexus-adaptive-strip-h: 52px');
  });

  it('reduced motion removes the delayed rail visibility transition', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.rail');
    expect(reduced).toContain('transition: none;');
    expect(reduced).toContain('transition-delay: 0s;');
  });

  it('нет layout-сдвига: анимируются только треки грида и opacity', () => {
    // запрещены margin/width/padding-переходы на контенте — только
    // grid-template-*, opacity, max-width подписи, visibility рельса
    const transitions = css.match(/transition:[^;]+;/g) ?? [];
    for (const t of transitions) {
      // голые width/height/margin/padding запрещены; max-width подписи
      // и visibility рельса — легальны (соседей не двигают)
      expect(t).not.toMatch(/(^|[\s,])(width|height|margin|padding|top|left|right|bottom)[\s,]/);
    }
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('компоненты рендерят три режима и разметку слоёв', () => {
    const shell = renderToStaticMarkup(
      createElement(AdaptiveShell, { mode: 'single', 'data-testid': 'w' } as never,
        createElement(AdaptiveStrip, null, 'иконки'),
        createElement(AdaptiveRail, null, createElement(AdaptiveLabel, null, 'Раздел')),
        createElement(AdaptiveMain, null, 'контент')),
    );
    expect(shell).toContain('data-force="single"');
    expect(shell).toContain('иконки');
    expect(shell).toContain('Раздел');
    // auto → без data-force
    const auto = renderToStaticMarkup(createElement(AdaptiveShell, null, 'x'));
    expect(auto).not.toContain('data-force');
    // icons
    const icons = renderToStaticMarkup(createElement(AdaptiveShell, { mode: 'icons' }, 'x'));
    expect(icons).toContain('data-force="icons"');
  });
});
