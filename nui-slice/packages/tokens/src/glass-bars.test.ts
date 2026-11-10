import { describe, it, expect } from 'vitest';
import { buildTokens, loadTokenSources, loadCanonicalThemes } from '../scripts/build-tokens';

/**
 * Glass-bars contract (wave-XVI W2, refs NEU/Alice/* + main2.png):
 *  - each layer bg alpha ∈ [0.35, 0.65] and ≥ glass.minOpacity
 *  - backdrop blur ∈ [14, 28]px, saturate factor = 1.2
 *  - inner border alpha ∈ [0.12, 0.25], top highlight present
 *  - text.primary ≥ 4.5:1 on the layer composited over the theme's own
 *    substrates (surface.root and surface.environment) — every theme
 *  - glass.maxBlurLayers = 4 (screen blur budget)
 */
const LAYERS = ['rail', 'topbar', 'card', 'statusbar'] as const;

type RGB = [number, number, number];
const hex2rgb = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (rgb: RGB) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg: RGB, a: number, bg: RGB): RGB => [
  a * fg[0] + (1 - a) * bg[0],
  a * fg[1] + (1 - a) * bg[1],
  a * fg[2] + (1 - a) * bg[2],
];

/** Parse `color-mix(in srgb, #hex NN%, <rest>)` → {hex, alpha}. */
const mixRe = /color-mix\(in srgb,\s*(#[0-9a-fA-F]{6})\s+([\d.]+)%/;
const parseMix = (v: string) => {
  const m = v.match(mixRe);
  return m ? { hex: m[1], alpha: Number(m[2]) / 100 } : null;
};

function parseBlocks(css: string): Map<string, Map<string, string>> {
  const blocks = new Map<string, Map<string, string>>();
  const flat = css.replace(/@media[^{}]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const re = /(:root|\[data-theme="([\w-]+)"\])\s*\{([^}]*)\}/g;
  for (const m of flat.matchAll(re)) {
    const vars = new Map<string, string>();
    for (const v of m[3].matchAll(/(--nexus-[\w-]+):\s*([^;]+);/g)) vars.set(v[1], v[2].trim());
    blocks.set(m[2] ?? 'root', vars);
  }
  return blocks;
}

describe('glass-bars token contract (wave-XVI)', async () => {
  const { css } = buildTokens(loadTokenSources(), await loadCanonicalThemes());
  const blocks = parseBlocks(css);
  const root = blocks.get('root')!;
  const get = (vars: Map<string, string>, name: string) =>
    vars.get(name) ?? root.get(name) ?? '';

  it('layer spec bands: bg alpha 0.35–0.65, blur 14–28px, border alpha 0.12–0.25', () => {
    const fails: string[] = [];
    for (const [theme, vars] of blocks) {
      for (const layer of LAYERS) {
        const bg = parseMix(get(vars, `--nexus-glass-${layer}-bg`));
        if (!bg) { fails.push(`${theme} glass.${layer}.bg unparseable`); continue; }
        if (bg.alpha < 0.35 || bg.alpha > 0.65)
          fails.push(`${theme} glass.${layer}.bg alpha ${bg.alpha}`);
        const blur = parseFloat(get(vars, `--nexus-glass-${layer}-blur`));
        if (!(blur >= 14 && blur <= 28))
          fails.push(`${theme} glass.${layer}.blur ${blur}px`);
        const border = parseMix(get(vars, `--nexus-glass-${layer}-border`));
        if (!border || border.alpha < 0.12 || border.alpha > 0.25)
          fails.push(`${theme} glass.${layer}.border alpha ${border?.alpha}`);
        if (!get(vars, `--nexus-glass-${layer}-highlight`).includes('color-mix'))
          fails.push(`${theme} glass.${layer}.highlight missing`);
        if (!get(vars, `--nexus-glass-${layer}-shadow`))
          fails.push(`${theme} glass.${layer}.shadow missing`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('text.primary ≥4.5:1 on each glass layer over theme substrates', () => {
    const fails: string[] = [];
    for (const [theme, vars] of blocks) {
      const fg = get(vars, '--nexus-text-primary');
      if (!fg.startsWith('#')) { fails.push(`${theme} text.primary not hex`); continue; }
      for (const substrate of ['--nexus-surface-root', '--nexus-surface-environment']) {
        const under = get(vars, substrate);
        if (!under.startsWith('#')) continue; // art/non-hex substrate — skipped, root covers flat case
        for (const layer of LAYERS) {
          const bg = parseMix(get(vars, `--nexus-glass-${layer}-bg`));
          if (!bg) continue;
          const composite = over(hex2rgb(bg.hex), bg.alpha, hex2rgb(under));
          const r = ratio(hex2rgb(fg), composite);
          if (r < 4.5)
            fails.push(`${theme} ${layer} over ${substrate}: ${r.toFixed(2)} (alpha ${bg.alpha})`);
        }
      }
    }
    expect(fails).toEqual([]);
  });

  it('alphas ≥ glass.minOpacity; saturate = 1.2; blur budget = 4', () => {
    const minOpacity = parseFloat(get(root, '--nexus-glass-min-opacity'));
    expect(minOpacity).toBe(0.55);
    expect(parseFloat(get(root, '--nexus-glass-saturate'))).toBe(1.2);
    expect(parseFloat(get(root, '--nexus-glass-max-blur-layers'))).toBe(4);
    for (const [theme, vars] of blocks) {
      for (const layer of LAYERS) {
        const bg = parseMix(get(vars, `--nexus-glass-${layer}-bg`));
        if (bg && bg.alpha < minOpacity)
          throw new Error(`${theme} glass.${layer}.bg alpha ${bg.alpha} < minOpacity ${minOpacity}`);
      }
    }
  });

  it('reduced-transparency output collapses glass bg to opaque composite', () => {
    const rt = css.match(/@media \(prefers-reduced-transparency: reduce\) \{([\s\S]*)\}\n\n@media \(prefers-contrast/);
    expect(rt).toBeTruthy();
    for (const layer of LAYERS) {
      expect(rt![1]).toContain(`--nexus-glass-${layer}-blur: 0px`);
      expect(rt![1]).toMatch(new RegExp(`--nexus-glass-${layer}-bg: color-mix\\(in srgb, #[0-9A-Fa-f]{6} \\d+%, var\\(--nexus-surface-root`));
    }
  });
});
