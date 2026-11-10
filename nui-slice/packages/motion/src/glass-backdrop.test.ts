import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GLASS_BACKDROP,
  GLASS_BACKDROP_VARS,
  compositeScrim,
  contrastOnBackdrop,
  wcagLuminance,
} from './glass-backdrop';

const stylesheet = readFileSync(new URL('./glass-backdrop.module.css', import.meta.url), 'utf8');

// Реальные значения палитры (packages/tokens color.tokens.json) — только
// для замера, новых цветовых токенов модуль не вводит.
const IVORY_50: readonly [number, number, number] = [0xfb / 255, 0xf8 / 255, 0xf1 / 255];
const OBSIDIAN_800: readonly [number, number, number] = [0x1a / 255, 0x1a / 255, 0x21 / 255];
const OBSIDIAN_950: readonly [number, number, number] = [0x0a / 255, 0x0a / 255, 0x0c / 255];
const GOLD_800: readonly [number, number, number] = [0x6f / 255, 0x60 / 255, 0x47 / 255];
const WHITE: readonly [number, number, number] = [1, 1, 1];
const BLACK: readonly [number, number, number] = [0, 0, 0];

describe('NEU glass backdrop contract (wave XVII)', () => {
  it('keeps blur budget: backdrop itself uses filter:blur, zero backdrop-filter layers', () => {
    expect(stylesheet).toContain('filter: blur(var(--nexus-glass-backdrop-art-blur, 24px))');
    // backdrop-filter встречается только в демо-баре, подложка — ни одного.
    const backdropBlock = stylesheet.split('/* ── Демо-бар')[0];
    // свойства, не упоминания в комментариях:
    expect(backdropBlock.match(/backdrop-filter\s*:/g) ?? []).toHaveLength(0);
    expect(GLASS_BACKDROP.maxBlurLayersPerScreen).toBe(4);
  });

  it('exposes transparency/sheen tokens, not colors', () => {
    expect(GLASS_BACKDROP.artBlurPx).toBe(24);
    expect(GLASS_BACKDROP.barBlurPx).toBe(18);
    expect(GLASS_BACKDROP.scrimAlpha).toBe(0.34);
    expect(GLASS_BACKDROP.barAlpha).toBe(0.62);
    expect(GLASS_BACKDROP.barAlphaFallback).toBeGreaterThan(GLASS_BACKDROP.barAlpha);
    expect(GLASS_BACKDROP.sheen).toEqual({ alpha: 0.10, angleDeg: 105 });
    expect(GLASS_BACKDROP_VARS.artBlur).toBe('--nexus-glass-backdrop-art-blur');
    // Цвета — через тему, не литералы: скрим и заливка из var(--nexus-surface-panel).
    expect(stylesheet).toContain('var(--nexus-surface-panel');
    expect(stylesheet).not.toMatch(/background:\s*#[0-9a-fA-F]{3,8}/);
  });

  it('holds WCAG AA ≥4.5 on worst-case art (чисто белый и чисто чёрный)', () => {
    const { scrimAlpha, barAlpha, barAlphaFallback } = GLASS_BACKDROP;
    for (const art of [WHITE, BLACK] as const) {
      // Реальный стек: арт → скрим 34% → заливка бара 62% → текст.
      // light theme: panel ivory.50, текст obsidian.950
      const lightBar = compositeScrim(compositeScrim(art, IVORY_50, scrimAlpha), IVORY_50, barAlpha);
      const lightRatio = (Math.max(wcagLuminance(lightBar), wcagLuminance(OBSIDIAN_950)) + 0.05)
        / (Math.min(wcagLuminance(lightBar), wcagLuminance(OBSIDIAN_950)) + 0.05);
      expect(lightRatio).toBeGreaterThanOrEqual(4.5);
      // dark theme: scrim+bar — obsidian.800, текст ivory.50
      const darkBar = compositeScrim(compositeScrim(art, OBSIDIAN_800, scrimAlpha), OBSIDIAN_800, barAlpha);
      const darkRatio = (Math.max(wcagLuminance(darkBar), wcagLuminance(IVORY_50)) + 0.05)
        / (Math.min(wcagLuminance(darkBar), wcagLuminance(IVORY_50)) + 0.05);
      expect(darkRatio).toBeGreaterThanOrEqual(4.5);
      // fallback-заливка (без backdrop-filter) — не хуже прозрачной.
      const lightFb = compositeScrim(compositeScrim(art, IVORY_50, scrimAlpha), IVORY_50, barAlphaFallback);
      expect(
        (Math.max(wcagLuminance(lightFb), wcagLuminance(OBSIDIAN_950)) + 0.05)
          / (Math.min(wcagLuminance(lightFb), wcagLuminance(OBSIDIAN_950)) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
    }
    // акцентный текст gold.800 на светлом стекле — тоже ≥AA.
    expect(contrastOnBackdrop(WHITE, IVORY_50, scrimAlpha, GOLD_800)).toBeGreaterThanOrEqual(4.5);
  });

  it('degrades without backdrop-filter: opaque fallback, same geometry', () => {
    expect(stylesheet).toContain('@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))');
    expect(stylesheet).toContain('--nexus-glass-bar-bg-strong');
    expect(stylesheet).toContain('backdrop-filter: none');
  });

  it('honours prefers-reduced-motion: sheen drift stops', () => {
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)');
    const rm = stylesheet.slice(stylesheet.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toContain('animation: none');
    // drift — единственная анимация модуля.
    expect(stylesheet.match(/@keyframes/g)?.length).toBe(1);
    expect(GLASS_BACKDROP.sheenDriftMs).toBeGreaterThanOrEqual(10000);
  });

  it('raises opacity under prefers-contrast: more', () => {
    expect(stylesheet).toContain('@media (prefers-contrast: more)');
  });
});
