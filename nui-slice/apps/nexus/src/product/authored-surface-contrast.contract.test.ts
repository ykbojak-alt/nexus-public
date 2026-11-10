import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * NQ-072 persistent gate (dispatch wave-6 W2-8): authored-dark game surfaces
 * are theme-invariant, so any text painted on them must resolve to a pinned
 * `*onArt*` role (or an authored literal) holding ≥4.5:1 under EVERY theme —
 * including light ones (`alice`), where theme-tracking text.* collapses to
 * 1.26–2.4:1 (the class route-axe structurally misses: these nodes exist only
 * inside an active game, never in the initial render axe scans).
 *
 * The registry below pins the audited (selector → authored-bg) pairs. The fg
 * value is read live from the module.css — reverting a swap to a themed
 * `text.*`/`accent.primary` re-fails here. New authored surfaces/consumers
 * must be registered; theme chrome (surface.glass panels etc.) does not
 * belong in this list.
 */

type RGB = [number, number, number];
const REPO = join(__dirname, '..', '..', '..', '..');
const TOKENS_CSS = join(REPO, 'packages/tokens/generated/tokens.css');

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
/** alpha-composite fg (with alpha) over bg */
const over = (f: number[], b: RGB): RGB =>
  [0, 1, 2].map((i) => (f[i] * f[3] + b[i] * (1 - f[3])) / 255 / 255) as unknown as RGB;

function parseThemeBlocks(css: string): Map<string, Map<string, string>> {
  const flat = css.replace(/@media[^{}]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const blocks = new Map<string, Map<string, string>>();
  const re = /(:root|\[data-theme="(\w+)"\])\s*\{([^}]*)\}/g;
  for (const m of flat.matchAll(re)) {
    const vars = new Map<string, string>();
    for (const v of m[3].matchAll(/(--nexus-[\w-]+):\s*([^;]+);/g)) vars.set(v[1], v[2].trim());
    blocks.set(m[2] ?? 'root', vars);
  }
  return blocks;
}

const cssBlocks = parseThemeBlocks(readFileSync(TOKENS_CSS, 'utf8'));
const rootVars = cssBlocks.get('root')!;
const themeVars = (name: string) => cssBlocks.get(name) ?? new Map<string, string>();

/** Resolve `var(--nexus-x, fallback)` → value via theme block, else root, else fallback. */
const resolveVar = (expr: string, vars: Map<string, string>): string =>
  expr.replace(/var\((--nexus-[\w-]+)(?:,\s*([^)]+))?\)/g, (_m, name, fb) =>
    (vars.get(name) ?? rootVars.get(name) ?? (fb ?? '')).trim(),
  );

/** css color expr → [r,g,b,alpha] in 0..255 / 0..1 */
function toRGBA(expr: string, vars: Map<string, string>): number[] | null {
  const e = resolveVar(expr, vars).trim();
  const hex = e.match(/^#([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/);
  if (hex) {
    const r = hex2rgb(`#${hex[1]}`);
    return [r[0] * 255, r[1] * 255, r[2] * 255, hex[2] ? parseInt(hex[2], 16) / 255 : 1];
  }
  const rgba = e.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (rgba) {
    return [
      +rgba[1],
      +rgba[2],
      +rgba[3],
      rgba[4] === undefined ? 1 : rgba[4].endsWith('%') ? +rgba[4].slice(0, -1) / 100 : +rgba[4],
    ];
  }
  // color-mix(in srgb, <color> NN%, transparent) → fg at alpha NN%
  const mix = e.match(/^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*transparent\)$/);
  if (mix) {
    const inner = toRGBA(mix[1], vars);
    if (inner) { inner[3] = +mix[2] / 100; return inner; }
  }
  return null;
}

function compositeOver(expr: string, vars: Map<string, string>, bg: RGB): RGB | null {
  const f = toRGBA(expr, vars);
  if (!f) return null;
  const a = f[3] + (1 - f[3]); // bg assumed opaque
  return [
    f[0] * f[3] + bg[0] * 255 * (1 - f[3]) * (1 / a) * a,
    f[1] * f[3] + bg[1] * 255 * (1 - f[3]),
    f[2] * f[3] + bg[2] * 255 * (1 - f[3]),
  ];
}

function ruleBody(css: string, selRe: RegExp): string | null {
  const m = css.match(new RegExp(`[^{}]*${selRe.source}[^{}]*\\{([^{}]*)\\}`));
  return m ? m[1] : null;
}
const declColor = (body: string) => body.match(/(?:^|;)\s*color\s*:\s*([^;]+)/)?.[1]?.trim();

/**
 * Registry: [file, selector-regex, authored-bg (worst-case composite hex), min ratio].
 * bgs are the measured authored literals — opaque composite bases under the
 * text, not the theme page.
 */
const PAIRS: [string, string, string, number][] = [
  // chess — boardArea/boardFrame/promo are literal-dark art
  ['chess', String.raw`\.coord i`, '#16130F', 4.5],
  ['chess', String.raw`\.promoTitle`, '#1B1611', 4.5],
  ['chess', String.raw`\.matChip`, '#100D09', 4.5],
  // durak — tableArea pinned surface.art; log/handArea authored-dark literals
  ['durak', String.raw`\.tableEmpty`, '#0F0F13', 4.5],
  ['durak', String.raw`\.logTitle`, '#0C0B09', 4.5],
  ['durak', String.raw`\.logList[^:]`, '#0C0B09', 4.5],
  ['durak', String.raw`\.logList li\[data-fresh\]`, '#0C0B09', 4.5],
  ['durak', String.raw`\.boutChip`, '#100D09', 4.5],
  ['durak', String.raw`\.deckMeta`, '#0F0F13', 4.5],
  ['durak', String.raw`\.trumpMeta\[data-suit='hearts'\]`, '#0F0F13', 4.5],
  ['durak', String.raw`\.trumpMeta\[data-suit='diamonds'\]`, '#0F0F13', 4.5],
  ['durak', String.raw`\.trumpMeta\[data-suit='spades'\]`, '#0F0F13', 4.5],
  ['durak', String.raw`\.trumpMeta\[data-suit='clubs'\]`, '#0F0F13', 4.5],
  // handArea — authored-градиент как у .log (pinned нижняя зона стола)
  ['durak', String.raw`\.you\b`, '#0C0B09', 4.5],
  ['durak', String.raw`\.handCount`, '#0C0B09', 4.5],
  ['durak', String.raw`\.hint`, '#0C0B09', 4.5],
  // choicePop / resultModal — pinned authored-градиент rgba(26,23,16,.97)→(14,12,9,.97)
  ['durak', String.raw`\.choiceText`, '#1A1710', 4.5],
  ['durak', String.raw`\.choiceCancel[^:]`, '#1A1710', 4.5],
  ['durak', String.raw`\.modalClose[^:]`, '#1A1710', 4.5],
  ['durak', String.raw`\.heading`, '#1A1710', 4.5],
  ['durak', String.raw`\.resultModal \.subtitle`, '#1A1710', 4.5],
  ['durak', String.raw`\.standing[^-a-z]`, '#14100C', 4.5],
  // oracle — cloth/spread/diagrams literal-dark
  // (.deckName НЕ регистрируется: подпись лежит на intro glass-panel — chrome,
  //  theme-tracking; edge-case NQ-074 — pinned-текст на themed-стекле)
  ['oracle', String.raw`\.slotPos`, '#1D2338', 4.5],
  ['oracle', String.raw`\.slotNum`, '#1D2338', 4.5],
  ['oracle', String.raw`\.slot\[data-revealed\] \.slotPos`, '#1D2338', 4.5],
  ['oracle', String.raw`\.session\b`, '#1D2338', 4.5],
  ['oracle', String.raw`\.sessionIntention`, '#1D2338', 4.5],
  ['oracle', String.raw`\.sessionTimer`, '#1D2338', 4.5],
  ['oracle', String.raw`\.sessionSec[^:]`, '#1D2338', 4.5],
  ['oracle', String.raw`\.mapDot\b(?!\[)`, '#12151C', 4.5],
  ['oracle', String.raw`\.mapDot\[data-section='light'\]`, '#12151C', 4.5],
  ['oracle', String.raw`\.mapDot\[data-section='gnosis'\]`, '#12151C', 4.5],
];

const cssCache = new Map<string, string>();
const COMMENTS = /\/\*.*?\*\//gs;
// Базовые правила: @media-блоки (reduced-motion и т.п.) вырезаем, иначе
// ruleBody хватает первый матч селектора внутри медиа-блока, где лежат
// только transition-оверрайды без color.
const MEDIA_BLOCKS = /@media[^{}]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g;
const cssFor = (name: string) => {
  if (!cssCache.has(name)) {
    cssCache.set(
      name,
      readFileSync(join(REPO, 'apps/nexus/src/product', name, `${name}.module.css`), 'utf8')
        .replace(COMMENTS, '')
        .replace(MEDIA_BLOCKS, ''),
    );
  }
  return cssCache.get(name)!;
};

describe('authored-surface contrast (NQ-072 gate)', () => {
  const themes = [...cssBlocks.keys()].filter((k) => k !== 'root');

  for (const [file, sel, bgHex, min] of PAIRS) {
    it(`${file} ${sel} ≥${min}:1 on ${bgHex} under every theme`, () => {
      const body = ruleBody(cssFor(file), new RegExp(sel));
      expect(body, `${file} ${sel} rule missing — registry stale?`).toBeTruthy();
      const fg = declColor(body!);
      expect(fg, `${file} ${sel} has no color decl`).toBeTruthy();
      const bg = hex2rgb(bgHex);
      const fails: string[] = [];
      for (const theme of ['root', ...themes]) {
        const vars = theme === 'root' ? rootVars : themeVars(theme);
        const comp = compositeOver(fg!, vars, bg);
        expect(comp, `${file} ${sel} fg not resolvable: ${fg}`).toBeTruthy();
        const r = ratio(comp!, bg);
        if (r < min) fails.push(`${theme}: ${r.toFixed(2)}`);
      }
      expect(fails).toEqual([]);
    });
  }

  it('pinned roles absent from theme overrides (any theme block redeclaring them = regression)', () => {
    const pinned = [
      '--nexus-text-on-art', '--nexus-text-on-art-dim', '--nexus-text-on-art-muted',
      '--nexus-accent-on-art', '--nexus-surface-art',
    ];
    const fails: string[] = [];
    for (const theme of themes) {
      const vars = themeVars(theme);
      for (const v of pinned) {
        const val = vars.get(v);
        if (val && val !== rootVars.get(v)) fails.push(`${theme}: ${v} → ${val}`);
      }
    }
    expect(fails).toEqual([]);
  });
});
