/**
 * tokenize-css — codemod «литерал → токен» (wave-XIV W2).
 *
 *   node tools/codemods/tokenize-css.mjs <paths/globs> [--write] [--json] [--min-score N]
 *
 * Режим по умолчанию — dry-run: печатает таблицу
 *   файл:строка | литерал | токен | статус(replaced-candidate|ambiguous|unmatched)
 * --write применяет только однозначные замены (exact). Ambiguous — всегда в отчёт.
 * Карта токенов — packages/tokens/generated/tokens.css (:root block), т.е.
 * тот же источник, что и у гейта. Сначала `nx build tokens`.
 *
 * Shebang здесь был бы помехой: vite (vitest) ставит shebang не в начало
 * вывода при ESM-экспортах — модуль падает с «Invalid or unexpected token».
 * Запуск — `node tools/codemods/tokenize-css.mjs …`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const AS_JSON = args.includes('--json');
const paths = args.filter((a) => !a.startsWith('--'));

const ROOT = join(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..');
const TOKENS_CSS = join(ROOT, 'packages', 'tokens', 'generated', 'tokens.css');

/* ---------- token map: resolved value -> var name ---------- */
export function loadTokenMap() {
  const css = readFileSync(TOKENS_CSS, 'utf8');
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  const byValue = new Map();
  for (const m of root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const val = m[2].trim();
    if (val.startsWith('var(') || val.startsWith('calc(')) continue;
    const key = normVal(val);
    if (!byValue.has(key)) byValue.set(key, []);
    byValue.get(key).push(m[1]);
  }
  return byValue;
}
const normVal = (v) => {
  v = v.trim();
  if (v.startsWith('#')) {
    let s = v.slice(1).toUpperCase();
    if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join('');
    return `#${s}`;
  }
  return v;
};

/* ---------- collectors ---------- */
const VAR_CALL = /var\([^)]*\)/g;
function* literals(css) {
  /* маскируем комментарии (литералы в тексте — не код), сохраняя длину,
     чтобы индексы перезаписи остались верными */
  const masked = css
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(VAR_CALL, (m) => ' '.repeat(m.length));
  for (const m of masked.matchAll(/#[0-9a-fA-F]{3,8}\b/g))
    yield { kind: 'color', idx: m.index, lit: m[0] };
  for (const m of masked.matchAll(/border(?:-[\w-]+)?-radius\s*:\s*([^;}]+)/g)) {
    /* смещение внутри значения — по позиции литерала, а не indexOf по всему
       совпадению: в «border-radius: 1px 1px» indexOf нашёл бы первую «1px»
       дважды и вторая замена встала бы не туда */
    const base = m.index + m[0].indexOf(m[1]);
    for (const r of m[1].matchAll(/([\d.]+)px/g))
      yield { kind: 'radius', idx: base + r.index, lit: r[0] };
  }
  for (const m of masked.matchAll(/font-size\s*:\s*([\d.]+)px/g))
    yield { kind: 'fontSize', idx: m.index + m[0].indexOf(m[1]), lit: `${m[1]}px` };
  for (const m of masked.matchAll(/z-index\s*:\s*(-?\d+)/g)) {
    const n = parseInt(m[1], 10);
    if (n >= 0 && n <= 2) continue; // 0–2 — легальная локальная укладка (как в гейте)
    yield { kind: 'zIndex', idx: m.index + m[0].indexOf(m[1]), lit: m[1] };
  }
}

function suggest(lit, kind, byValue) {
  const key = normVal(lit);
  if (kind === 'color') {
    const exact = byValue.get(key);
    if (exact) return { status: 'exact', token: pick(exact, 'color') };
    // ближайший по RGB (только для отчёта)
    const near = nearestColor(key, byValue);
    if (near) return { status: 'ambiguous', token: near.token, dist: near.dist };
    return { status: 'unmatched' };
  }
  const num = parseFloat(lit);
  /* числовые семейства жёсткие: font-size → type.*, radius → radius.*,
     z-index → layer.*; совпадение в чужом семействе — ambiguous, не exact */
  const family = { radius: /^--nexus-radius-/, fontSize: /^--nexus-type-/,
    zIndex: /^--nexus-layer-/ }[kind];
  // pill-идиома: radius ≥999px → radius.full (9999px), на проверку человеку
  if (kind === 'radius' && num >= 999)
    return { status: 'ambiguous', token: '--nexus-radius-full', dist: 0 };
  const exact = byValue.get(kind === 'zIndex' ? String(num) : `${num}px`);
  if (exact) {
    const tk = pick(exact, kind);
    return family.test(tk)
      ? { status: 'exact', token: tk }
      : { status: 'ambiguous', token: tk, dist: 0 };
  }
  const cands = [...byValue.keys()].filter((k) => /px$|^\d+$/.test(k));
  let best = null;
  for (const k of cands) {
    const tk = pick(byValue.get(k), kind);
    if (!family.test(tk)) continue;
    const kn = parseFloat(k);
    const d = Math.abs(kn - num) / Math.max(1, num);
    if (!best || d < best.d) best = { d, k, tk };
  }
  if (best && best.d <= 0.25)
    return { status: 'ambiguous', token: best.tk, dist: best.d };
  return { status: 'unmatched' };
}

function pick(vars, kind) {
  const pref = { color: /--nexus-(?:color|text|accent|border|state|surface|depth|chart)-/,
    radius: /--nexus-radius-/, fontSize: /--nexus-type-/, zIndex: /--nexus-layer-/ }[kind];
  return vars.find((v) => pref.test(v)) ?? vars[0];
}
const rgb = (h) => { const s = normVal(h).slice(1); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
function nearestColor(hex, byValue) {
  let best = null;
  const [r, g, b] = rgb(hex);
  for (const [k, vars] of byValue) {
    if (!k.startsWith('#')) continue;
    const [r2, g2, b2] = rgb(k);
    const d = Math.sqrt((r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2) / 441.67;
    if (!best || d < best.dist) best = { dist: d, token: pick(vars, 'color') };
  }
  return best && best.dist <= 0.08 ? best : null;
}

/* ---------- per-file transform (чистая функция — покрыта тестом) ---------- */
export function transformCss(css, byValue) {
  const report = [];
  let out = css;
  let delta = 0;
  /* КРИТИЧНО: literals() выдаёт кандидатов ПО ВИДАМ (цвета → радиусы →
     шрифты → z-index), а замена считает смещение от предыдущих правок.
     Порядок обязан быть по возрастанию индекса — иначе var() встаёт не на
     своё место и CSS портится (правка ломала файлы: «textvar(...)mary»). */
  const candidates = [...literals(css)].sort((a, b) => a.idx - b.idx);
  for (const { kind, idx, lit } of candidates) {
    const s = suggest(lit, kind, byValue);
    if (s.status === 'exact') {
      const rep = `var(${s.token}, ${lit})`;
      report.push({ kind, idx, lit, token: s.token, status: s.status });
      out = out.slice(0, idx + delta) + rep + out.slice(idx + delta + lit.length);
      delta += rep.length - lit.length;
    } else {
      report.push({ kind, idx, lit, token: s.token ?? null, status: s.status, dist: s.dist });
    }
  }
  return { css: out, report };
}

/* ---------- walk files ---------- */
function* walk(target) {
  if (target.includes('*')) {
    const out = execSync(`git -C "${ROOT}" ls-files "${target}"`, { encoding: 'utf8' });
    for (const f of out.split('\n').filter(Boolean)) yield join(ROOT, f);
    return;
  }
  const st = statSync(target);
  if (st.isDirectory()) {
    for (const e of readdirSync(target)) {
      if (e === 'node_modules' || e === 'generated' || e === 'dist' ||
        e === 'storybook-static' || e === '.next' || e === 'out' || e === '.turbo') continue;
      yield* walk(join(target, e));
    }
    return;
  }
  if (target.endsWith('.css')) yield target;
}

export function runCodemod() {
  const byValue = loadTokenMap();
  const report = [];
  const touched = new Map();

  for (const t of paths.length ? paths : ['packages', 'apps']) {
    for (const file of walk(isAbsolute(t) ? t : join(ROOT, t))) {
      const css = readFileSync(file, 'utf8');
      const rel = (file.startsWith(ROOT + sep) ? file.slice(ROOT.length + 1) : file)
        .replaceAll('\\', '/');
      const { css: out, report: rows } = transformCss(css, byValue);
      for (const r of rows) {
        const line = css.slice(0, r.idx).split('\n').length;
        report.push({ file: rel, line, literal: r.lit, token: r.token, status: r.status === 'exact' ? 'replaced' : r.status, ...(r.dist !== undefined ? { dist: r.dist } : {}) });
      }
      if (WRITE && out !== css) { writeFileSync(file, out); touched.set(rel, true); }
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ mode: WRITE ? 'write' : 'dry-run', files: touched.size, report }, null, 2));
  } else {
    const rows = report.map((r) =>
      `${r.file}:${r.line}  ${r.literal.padEnd(12)} -> ${(r.token ?? '—').padEnd(42)} ${r.status}`);
    console.log(`tokenize-css ${WRITE ? 'WRITE' : 'DRY-RUN'} — ${report.length} литералов`);
    console.log(rows.join('\n'));
    const counts = report.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
    console.log(`итого: ${JSON.stringify(counts)}`);
  }
  return { report, touched };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) runCodemod();
