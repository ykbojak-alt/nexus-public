/**
 * token-lint — принудительное использование токенов в css (wave-XIV W2).
 * «Эквивалент stylelint в репозитории»: чистые функции над текстом css —
 * одни и те же правила работают в CI-гейте (token-usage.gates.test.ts),
 * в codemod tools/codemods/tokenize-css.mjs и в отчётах окон.
 *
 * Правила (error — ломает гейт в зоне владельца, warn — в отчёт):
 *   color-literal        hex/rgb()/hsl() вне var() и не как fallback → токен
 *   color-fallback-diff  var()-fallback не совпадает с resolved-значением токена
 *   radius-fallback-diff var()-fallback радиуса не совпадает со значением токена
 *   font-size-min        font-size литерал или var()-fallback < 13px (канон Yury)
 *   line-height-min      line-height < 14px (px) или < 1.1 (unitless)
 *   z-index-scale        z-index литерал вне шкалы layer.* (микро 0–2 — локальная укладка)
 *   radius-off-scale     border-radius px вне шкалы radius.* (50%/pill-идиомы ок)
 *   shadow-off-scale     box-shadow/filter drop-shadow без var()/токена вне @keyframes
 *
 * Прагмы (осознанные исключения, владелец пишет причину):
 *   /* tokenlint allow <rule>|* *\/ — на файл;
 *   /* tokenlint-ignore *\/        — на строку.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface LintViolation {
  rule: string;
  severity: 'error' | 'warn';
  file: string;
  line: number;
  snippet: string;
  message: string;
  suggestion?: string;
}

/**
 * Зоны ответственности для репо-скана: чей CSS ломает гейт (W2), чей —
 * печатается в отчёт (остальные). Политика одного писателя, общая для
 * гейта (token-usage.gates.test.ts) и CLI-долга.
 */
export const TOKEN_SCAN_DIRS: ReadonlyArray<{ dir: string; owner: string }> = [
  { dir: 'packages/ui/src', owner: 'W2' },
  { dir: 'packages/tokens/src', owner: 'W2' },
  { dir: 'packages/themes/src', owner: 'W2' },
  { dir: 'apps/nexus/src', owner: 'W3' },
  { dir: 'packages/motion', owner: 'W4' },
  { dir: 'apps/storybook', owner: 'W5' },
  // зона не распределена диспетчером — репортируем отдельным ведром
  { dir: 'packages/patterns', owner: 'UNASSIGNED' },
  { dir: 'packages/three', owner: 'UNASSIGNED' },
  { dir: 'packages/icons', owner: 'UNASSIGNED' },
  { dir: 'packages/mock-data', owner: 'UNASSIGNED' },
];

function* walkCss(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (e === 'node_modules' || e === '.next' || e === 'generated' || e === 'dist' ||
        e === 'storybook-static') continue;
      yield* walkCss(p);
    } else if (e.endsWith('.css')) {
      yield p;
    }
  }
}

/**
 * Репо-скан тем же кодом линтера, что и гейт: нарушения, сгруппированные по
 * зоне. Общий код — иначе цифры в отчётах расходятся с гейтом.
 */
export function scanTokenDebt(root: string, tokens: Map<string, string>): Map<string, LintViolation[]> {
  const byOwner = new Map<string, LintViolation[]>();
  for (const { dir, owner } of TOKEN_SCAN_DIRS) {
    let files: string[] = [];
    try { files = [...walkCss(join(root, dir))]; } catch { continue; }
    for (const f of files) {
      const rel = relative(root, f).replace(/\\/g, '/');
      const vs = lintCssText(readFileSync(f, 'utf8'), rel, { tokens });
      if (vs.length) byOwner.set(owner, [...(byOwner.get(owner) ?? []), ...vs]);
    }
  }
  return byOwner;
}

/** Сводка по правилам внутри зоны — видно, из чего состоит долг. */
export function summariseByRule(violations: LintViolation[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of violations) out.set(v.rule, (out.get(v.rule) ?? 0) + 1);
  return out;
}

export interface LintContext {
  /** css var → resolved value (из generated tokens.css :root или resolveReferences). */
  tokens: Map<string, string>;
  /** допустимые числовые шкалы */
  layerScale: Set<number>;
  radiusScale: Set<number>;
}

const FILE_ALLOW = /\/\*\s*tokenlint\s+allow\s+([a-z-*\s,]+)\*\//g;
const LINE_IGNORE = /tokenlint-ignore/;

const RE = {
  varCall: /var\(\s*(--[\w-]+)(?:\s*,\s*([^)]*))?\)/g,
  hex: /#[0-9a-fA-F]{3,8}\b/g,
  rgb: /(?:rgba?|hsla?|color)\s*\([^)]*\)/g,
  fontSize: /font-size\s*:\s*([^;}]+)/g,
  lineHeight: /line-height\s*:\s*([^;}]+)/g,
  zIndex: /z-index\s*:\s*(-?\d+)/g,
  radius: /border(?:-[\w-]+)?-radius\s*:\s*([^;}]+)/g,
  boxShadow: /box-shadow\s*:\s*([^;}]+)/g,
  dropShadow: /drop-shadow\s*\(([^)]*)\)/g,
};

const normHex = (h: string) => {
  let s = h.slice(1).toUpperCase();
  if (s.length === 3 || s.length === 4)
    s = s.split('').map((c) => c + c).join('');
  return `#${s}`;
};
const hexRgb = (h: string): [number, number, number] => {
  const s = h.slice(1);
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
const hexByte = (n: number) =>
  Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0').toUpperCase();

function allowed(fileAllows: Set<string>, rule: string) {
  return fileAllows.has(rule) || fileAllows.has('*');
}

/** Быстрый вариант без карты токенов (репо-скан гейта). */
export function lintCssText(
  css: string,
  file: string,
  ctx?: Partial<LintContext>,
): LintViolation[] {
  const tokens = ctx?.tokens ?? new Map<string, string>();
  const layerScale = ctx?.layerScale ?? new Set([50, 60, 70, 100, 110, 120]);
  const radiusScale = ctx?.radiusScale ?? new Set([0, 2, 4, 8, 12, 16, 24, 9999]);
  const out: LintViolation[] = [];
  const push = (v: LintViolation) => out.push(v);

  const fileAllows = new Set<string>();
  for (const m of css.matchAll(FILE_ALLOW))
    m[1].split(/[\s,]+/).filter(Boolean).forEach((r) => fileAllows.add(r));

  const ignored = new Set(
    css.split('\n').map((l, i) => (LINE_IGNORE.test(l) ? i + 1 : 0)).filter(Boolean),
  );
  /* комментарии маскируем (hex/px в тексте — не нарушения), переводы строк
     сохраняем, чтобы номера строк остались верными */
  css = css.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, ' '));

  const lineAt = (idx: number) => css.slice(0, idx).split('\n').length;
  const report = (rule: string, severity: 'error' | 'warn', idx: number, snippet: string, message: string, suggestion?: string) => {
    const line = lineAt(idx);
    if (ignored.has(line) || allowed(fileAllows, rule)) return;
    push({ rule, severity, file, line, snippet: snippet.trim().slice(0, 120), message, suggestion });
  };

  /* --- позиции var(...) — литералы внутри fallback обрабатываются отдельно --- */
  const varSpans: Array<[number, number, string | undefined, string | undefined]> = [];
  for (const m of css.matchAll(RE.varCall))
    varSpans.push([m.index, m.index + m[0].length, m[1], m[2]]);
  const insideVar = (i: number) => varSpans.some(([a, b]) => i >= a && i < b);

  /* color-literal + color-fallback-diff */
  const valueToVars = new Map<string, string[]>();
  for (const [v, val] of tokens) {
    const key = val.startsWith('#') ? normHex(val) : val;
    const arr = valueToVars.get(key) ?? [];
    arr.push(v);
    valueToVars.set(key, arr);
  }

  if (!allowed(fileAllows, 'color-literal')) {
    for (const m of css.matchAll(RE.hex)) {
      if (insideVar(m.index)) continue;
      const hit = valueToVars.get(normHex(m[0]));
      report('color-literal', 'error', m.index, m[0],
        `цвет-литерал ${m[0]} вне токена`,
        hit ? `var(${hit[0]})` : undefined);
    }
    for (const m of css.matchAll(RE.rgb)) {
      if (insideVar(m.index)) continue;
      report('color-literal', 'error', m.index, m[0],
        `цвет-литерал ${m[0].slice(0, 30)}… вне токена`);
    }
  }

  /* fallback: цвет внутри var()-фолбэка не должен расходиться с resolved-
     значением токена. Фолбэк — деградированная аппроксимация (rgba вместо
     baked color-mix, тени строками): сравниваем все цвета в строке после
     запекания mix → #RRGGBBAA с допуском ≤8/255 на канал и ≤0.04 на альфу. */
  const bake = (v: string): string =>
    v.replace(
      /color-mix\(in srgb,\s*(#[0-9A-Fa-f]{3,8})\s+([\d.]+)%,\s*(transparent|#[0-9A-Fa-f]{3,8})\)/g,
      (_m, c: string, p: string, b: string) => {
        const [r, g, bl] = hexRgb(normHex(c));
        const a = Number(p) / 100;
        if (b === 'transparent')
          return `#${hexByte(r)}${hexByte(g)}${hexByte(bl)}${hexByte(a * 255)}`;
        const [br, bg, bb] = hexRgb(normHex(b));
        return `#${hexByte(br + (r - br) * a)}${hexByte(bg + (g - bg) * a)}${hexByte(bb + (bl - bb) * a)}`;
      },
    );
  const colors = (v: string): number[][] =>
    [...bake(v).matchAll(/#([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?|rgba?\(([\d.\s,]+)\)/g)]
      .map((m) => {
        if (m[1]) {
          const [r, g, b] = hexRgb(`#${m[1]}`);
          return [r, g, b, m[2] ? parseInt(m[2], 16) / 255 : 1];
        }
        const parts = m[3].split(/[\s,]+/).filter(Boolean).map(Number);
        return [parts[0], parts[1], parts[2], parts[3] ?? 1];
      });
  const colorsClose = (a: number[][], b: number[][]) =>
    a.length === b.length && a.every((c, i) =>
      c.slice(0, 3).every((ch, j) => Math.abs(ch - b[i][j]) <= 8) &&
      Math.abs(c[3] - b[i][3]) <= 0.04);

  for (const [start, , name, fb] of varSpans) {
    if (!fb || !name) continue;
    const trimmed = fb.trim();
    if (!/^#|rgba?\(|hsla?\(|inset|^[\d.-]/.test(trimmed)) continue;
    const resolved = tokens.get(name);
    if (!resolved) continue;
    const fbColors = colors(trimmed);
    const tkColors = colors(resolved);
    if (fbColors.length === 0 || tkColors.length === 0) continue; // не цветовой фолбэк
    if (!colorsClose(tkColors, fbColors)) {
      // Позиция — из самого совпадения var(): css.indexOf(фолбэка) указывал на
      // ПЕРВОЕ вхождение текста в файле, и отчёт вёл владельца не туда.
      report('color-fallback-diff', 'error', start, `var(${name}, ${trimmed.slice(0, 40)})`,
        `fallback «${trimmed.slice(0, 40)}» ≠ resolved «${resolved.slice(0, 40)}» — фолбэк обязан повторять цвет токена (допуск ±8/255, ±0.04α)`);
    }
  }

  /* radius-fallback-diff: var()-фолбэк радиуса обязан повторять токен.
     Гейт раньше проверял только цвета, поэтому устаревшие радиусы в фолбэках
     (var(--nexus-radius-sm, 8px) при токене 4px) были не видны в отчёте. */
  for (const [start, , name, fb] of varSpans) {
    if (!fb || !name) continue;
    if (!name.startsWith('--nexus-radius-')) continue;
    const resolved = tokens.get(name);
    if (!resolved) continue;
    const trimmed = fb.trim();
    if (trimmed === resolved.trim()) continue;
    report('radius-fallback-diff', 'error', start, `var(${name}, ${trimmed})`,
      `фолбэк радиуса «${trimmed}» ≠ токен «${resolved.trim()}» — фолбэк обязан повторять значение токена`);
  }

  /* font-size-min: литерал и var()-fallback */
  for (const m of css.matchAll(RE.fontSize)) {
    const lit = m[1].match(/^([\d.]+)px/);
    if (lit && parseFloat(lit[1]) < 13)
      report('font-size-min', 'error', m.index, m[0],
        `font-size ${lit[1]}px < 13px — минимум канона (caption=13px)`);
    for (const vm of m[1].matchAll(/var\([^,)]+,\s*([\d.]+)px/g))
      if (parseFloat(vm[1]) < 13)
        report('font-size-min', 'error', m.index, m[0],
          `font-size fallback ${vm[1]}px < 13px`);
  }

  /* line-height-min */
  for (const m of css.matchAll(RE.lineHeight)) {
    const px = m[1].match(/^([\d.]+)px/), unitless = m[1].match(/^([\d.]+)\s*$/);
    if (px && parseFloat(px[1]) < 14)
      report('line-height-min', 'error', m.index, m[0],
        `line-height ${px[1]}px < 14px — ниже читаемого минимума`);
    if (unitless && parseFloat(unitless[1]) < 1.1)
      report('line-height-min', 'error', m.index, m[0],
        `line-height ${unitless[1]} < 1.1 — ниже читаемого минимума`);
  }

  const LAYER_NAMES: Record<number, string> = {
    50: 'dropdown', 60: 'menu', 70: 'drawer', 100: 'modal', 110: 'overlay', 120: 'tooltip',
  };
  const RADIUS_NAMES: Record<number, string> = {
    0: 'none', 2: 'xs', 4: 'sm', 8: 'md', 12: 'lg', 16: 'xl', 24: '2xl', 9999: 'full',
  };

  /* z-index-scale */
  for (const m of css.matchAll(RE.zIndex)) {
    const v = parseInt(m[1], 10);
    if (layerScale.has(v) || v >= 0 && v <= 2) continue; // 0–2 — локальная укладка внутри компонента
    const nearest = [...layerScale].sort((a, b) => Math.abs(a - v) - Math.abs(b - v))[0];
    report('z-index-scale', 'error', m.index, m[0],
      `z-index ${v} вне шкалы layer.* (${[...layerScale].sort((a, b) => a - b).join('/')})`,
      LAYER_NAMES[nearest] ? `var(--nexus-layer-${LAYER_NAMES[nearest]})` : undefined);
  }

  /* radius-off-scale: px-значения вне шкалы; 50% и pill-идиома 999px — ок */
  for (const m of css.matchAll(RE.radius)) {
    const bad = [...m[1].matchAll(/([\d.]+)px/g)]
      .map((x) => parseFloat(x[1]))
      .filter((n) => n !== 999 && !radiusScale.has(n));
    for (const n of bad) {
      const nearest = [...radiusScale].sort((a, b) => Math.abs(a - n) - Math.abs(b - n))[0];
      report('radius-off-scale', 'error', m.index, m[0],
        `border-radius ${n}px вне шкалы radius.*`,
        RADIUS_NAMES[nearest] ? `var(--nexus-radius-${RADIUS_NAMES[nearest]})` : undefined);
    }
  }

  /* shadow-off-scale: литеральные тени вне @keyframes и не 'none'/var() */
  let scan = css;
  scan = scan.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, (m) => ' '.repeat(m.length));
  for (const m of scan.matchAll(RE.boxShadow)) {
    const v = m[1];
    if (/\bnone\b|var\(/.test(v)) continue;
    report('shadow-off-scale', 'error', m.index, m[0],
      `box-shadow вне шкалы shadow.* — используй var(--nexus-shadow-*|glow-*)`);
  }
  for (const m of scan.matchAll(RE.dropShadow)) {
    if (/var\(/.test(m[1])) continue;
    report('shadow-off-scale', 'warn', m.index, m[0],
      `drop-shadow-фильтр без токена — проверь, нет ли роли shadow.*/glow.*`);
  }

  return out.sort((a, b) => a.line - b.line);
}

/**
 * CLI: полный долг по токенам — тот же код, что у гейта
 * (packages/tokens/src/token-usage.gates.test.ts), но печатается ЦЕЛИКОМ:
 * масштаб и список по каждой зоне, а не голова списка. Путь: `pnpm lint:tokens`.
 */
async function runCli(): Promise<void> {
  const { buildTokens, loadTokenSources, loadCanonicalThemes } = await import('./build-tokens');
  const { css } = buildTokens(loadTokenSources(), await loadCanonicalThemes());
  const tokens = new Map<string, string>();
  const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  for (const m of rootBlock.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1], m[2].trim());

  const byOwner = scanTokenDebt(process.cwd(), tokens);
  let total = 0;
  for (const [owner, vs] of [...byOwner].sort((a, b) => a[0].localeCompare(b[0]))) {
    total += vs.length;
    console.log(`\n=== ${owner}: ${vs.length} нарушений ===`);
    const byRule = [...summariseByRule(vs)].sort((a, b) => b[1] - a[1]);
    console.log(`  по правилам: ${byRule.map(([r, n]) => `${r} ${n}`).join(' · ')}`);
    const byFile = new Map<string, number>();
    for (const v of vs) byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1);
    console.log(`  по файлам: ${[...byFile].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(' · ')}`);
    for (const v of vs) console.log(`  [${owner}] ${v.file}:${v.line} ${v.rule} — ${v.snippet}`);
  }
  console.log(`\nИтого: ${total} нарушений.`);
  if (total > 0) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith('token-lint.ts')) {
  await runCli();
}
