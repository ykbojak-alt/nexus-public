import type { NexusThemeDefinition } from '../core/types';

/**
 * AURUM-DARK — ref-parity 21.10, тёмный вариант золотой линии
 * (`ЭЛИС-главная-референс-2026-10-15.jpg`, MAIN.png лево/право):
 * тёплый charcoal ≈ #12100C под панелями, champagne-золото, кремовый текст.
 *
 * Светлая половина пары — существующая `alice` (ivory + gold); тёмная тянет
 * nexus-каркас и смещает поверхности в тёплый коричневый через color-mix
 * с gold.800/900 — без новых примитивных рамп. Дельта минимальна: акцент,
 * состояния и focus-ринг унаследованы (контракт-гейты покрывают тему
 * автоматически — излучаемый блок [data-theme] идёт в общий реестр).
 */
export const aurumDarkTheme: NexusThemeDefinition = {
  id: 'aurum-dark',
  extends: 'nexus',
  description: 'Warm charcoal + champagne gold (ЭЛИС dark ref).',
  tokens: {
    // Тёплая подложка: obsidian-глубина + ~10-14% gold.800 → charcoal #13110F
    // (реф #12100C), ступени поднимаются по той же формуле от своих баз.
    'surface.root': 'color-mix(in srgb, {color.obsidian.950} 90%, {color.gold.800})',
    'surface.environment': 'color-mix(in srgb, {color.obsidian.900} 90%, {color.gold.800})',
    'surface.base': 'color-mix(in srgb, {color.obsidian.850} 90%, {color.gold.800})',
    'surface.panel': 'color-mix(in srgb, {color.obsidian.800} 88%, {color.gold.800})',
    'surface.elevated': 'color-mix(in srgb, {color.obsidian.700} 88%, {color.gold.800})',
    // Вторичный текст тёплый: titanium.300 (нейтральный серый) → ivory.600 —
    // та же яркость, тёплый шампань-оттенок линии референса.
    'text.secondary': '{color.ivory.600}',
  },
};
