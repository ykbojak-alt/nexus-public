/**
 * Генератор docs/product/tokens-reference.md (wave-XV W2): единственный
 * источник правды — токен-конвейер. Колонки: имя, значение (:root + дельты по
 * темам), контраст против surface.panel (для hex-цветов), где используется
 * (скан var(--nexus-*) по css packages/ui + apps/nexus), пример. Без меток
 * времени — вывод детерминирован, тест актуальности сравнивает байт-в-байт.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTokens, loadTokenSources, loadCanonicalThemes } from './build-tokens';
import { validateTokenSet } from './validate-tokens';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT_FILE = join(ROOT, 'docs', 'product', 'tokens-reference.md');

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
const cssName = (path: string) => `--nexus-${path.split('.').map(kebab).join('-')}`;

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

/** Все css-файлы под dir (рекурсивно, детерминированный порядок). */
function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory() && e.name !== 'node_modules') out.push(...cssFiles(p));
    else if (e.isFile() && e.name.endsWith('.css')) out.push(p);
  }
  return out;
}

/** Карта var-имени → отсортированный список файлов, где оно встречается. */
function scanUsage(dirs: string[]): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  const re = /var\((--nexus-[\w-]+)/g;
  for (const dir of dirs) {
    let files: string[] = [];
    try { files = cssFiles(dir); } catch { /* dir absent */ }
    for (const file of files) {
      const rel = relative(ROOT, file).split(sep).join('/');
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(re)) {
        const list = usage.get(m[1]) ?? [];
        if (!list.includes(rel)) list.push(rel);
        usage.set(m[1], list.sort());
      }
    }
  }
  return usage;
}

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export async function renderTokenReference(): Promise<string> {
  const sources = loadTokenSources();
  const flat = validateTokenSet(sources);
  const themes = await loadCanonicalThemes();
  const { css } = buildTokens(sources, themes);
  const blocks = parseBlocks(css);
  const root = blocks.get('root')!;
  const themeIds = [...blocks.keys()].filter((k) => k !== 'root');
  const usage = scanUsage([
    join(ROOT, 'packages', 'ui', 'src'),
    join(ROOT, 'apps', 'nexus', 'src'),
  ]);

  const panel = root.get('--nexus-surface-panel') ?? '';
  const panelRgb = /^#[0-9a-fA-F]{6}$/.test(panel) ? hex2rgb(panel) : null;

  // Семейства в порядке первого появления.
  const groups = new Map<string, typeof flat>();
  for (const t of flat) {
    const fam = t.path.split('.')[0];
    (groups.get(fam) ?? groups.set(fam, []).get(fam)!).push(t);
  }

  const lines: string[] = [
    '# Справочник токенов NEXUS',
    '',
    '<!-- AUTO-GENERATED: packages/tokens/scripts/gen-token-reference.ts — не редактировать вручную. -->',
    '',
    `Источник: \`packages/tokens/src/**/*.tokens.json\` + канонические темы (\`packages/themes\`).`,
    `Токенов: ${flat.length}. Тем: ${themeIds.length} (${themeIds.join(', ')}).`,
    '',
    'Колонка «Δ темы» — только отличия от `:root` (наследованные значения не повторяются).',
    '«Контраст» — отношение hex-цвета к `surface.panel` оболочки `:root`; для color-mix и не-цветов — «—».',
    'Пустые значения — `null`, недоступные — `unavailable`; нули не выдумываются.',
    '',
  ];

  for (const [fam, tokens] of groups) {
    lines.push(`## ${fam}`);
    lines.push('');
    lines.push('| Токен | Тип | :root | Δ темы | Контраст | Использование | Пример |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const t of tokens) {
      const name = cssName(t.path);
      const rootVal = root.get(name);
      // Композитный токен (typography) раскладывается на -font-* и т.п.
      const composite = rootVal === undefined
        ? [...root.keys()].filter((k) => k.startsWith(`${name}-`))
        : [];
      const shown = rootVal ?? (composite.length ? `(composite → ${composite.length} vars)` : 'null');
      const deltas = themeIds
        .map((id) => {
          const v = blocks.get(id)!.get(name);
          return v !== undefined && v !== rootVal ? `${id}: ${v}` : null;
        })
        .filter(Boolean)
        .join('<br>');
      let contrast = '—';
      if (typeof shown === 'string' && /^#[0-9a-fA-F]{6}$/.test(shown) && panelRgb) {
        contrast = `${ratio(hex2rgb(shown), panelRgb).toFixed(2)}:1`;
      }
      const used = (usage.get(name) ?? []).slice(0, 3).join('<br>') || '—';
      const total = (usage.get(name) ?? []).length;
      const usedCell = total > 3 ? `${used}<br>+${total - 3}` : used;
      lines.push(`| \`${t.path}\` | ${t.type} | \`${esc(String(shown))}\` | ${esc(deltas) || '—'} | ${contrast} | ${usedCell} | \`var(${name})\` |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export async function runGenTokenReference(): Promise<void> {
  const md = await renderTokenReference();
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, md, 'utf8');
  console.log(`tokens-reference -> ${OUT_FILE}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runGenTokenReference();
}
