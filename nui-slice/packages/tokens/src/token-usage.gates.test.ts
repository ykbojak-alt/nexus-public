import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTokens, loadTokenSources, loadCanonicalThemes } from '../scripts/build-tokens';
import {
  lintCssText,
  scanTokenDebt,
  summariseByRule,
} from '../scripts/token-lint';

/**
 * Wave-XIV W2 token-usage gates — «принудительные токены» рядом с
 * 06-materials-gates (readability.gates.test.ts). Правила — token-lint.ts:
 *  color-literal · color-fallback-diff · font-size-min · line-height-min ·
 *  z-index-scale · radius-off-scale · shadow-off-scale.
 *
 * Политика одного писателя: нарушения в зоне W2 (packages/ui, tokens,
 * themes) ломают гейт; нарушения в чужих зонах (apps/nexus — W3,
 * packages/motion — W4, apps/storybook — W5) печатаются в отчёт, но не
 * роняют чужой CI — их таблица уходит в codemod-раздачу.
 *
 * W0: репо-скан и разбивка по правилам — общий код с CLI (`pnpm lint:tokens`),
 *  чтобы цифры в отчётах совпадали с гейтом, а в выводе гейта был виден
 *  реальный масштаб долга (раньше печаталась только голова списка).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function scanAll(tokens: Map<string, string>) {
  return scanTokenDebt(ROOT, tokens);
}

describe('token-usage gates (wave-XIV)', async () => {
  const { css } = buildTokens(loadTokenSources(), await loadCanonicalThemes());
  const tokens = new Map<string, string>();
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  for (const m of root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
    tokens.set(m[1], m[2].trim());

  it('lint rules fire on a planted violation set (sanity)', () => {
    const planted = [
      '.x { color: #C9A45C; }',
      '.y { font-size: 11px; }',
      '.z { z-index: 87; }',
      '.w { border-radius: 7px; }',
      '.v { box-shadow: 0 4px 12px #000; }',
      '.u { color: var(--nexus-accent-primary, #FF0000); }', // фолбэк ≠ токену
      '.t { line-height: 1.0; }',
    ].join('\n');
    const hits = lintCssText(planted, 'planted.css', { tokens });
    const rules = new Set(hits.map((h) => h.rule));
    for (const r of ['color-literal', 'font-size-min', 'z-index-scale',
      'radius-off-scale', 'shadow-off-scale', 'color-fallback-diff', 'line-height-min'])
      expect(rules.has(r), `rule ${r} silent`).toBe(true);
  });

  it('pragma allow/ignore suppress flagged lines honestly', () => {
    const css = '/* tokenlint allow color-literal */\n.a { color: #ABCDEF; }\n' +
      '.b { font-size: 11px; /* tokenlint-ignore */ }';
    expect(lintCssText(css, 'p.css', { tokens })).toEqual([]);
  });

  it('zero violations in W2-owned css (ui/tokens/themes)', () => {
    const byOwner = scanAll(tokens);
    const w2 = byOwner.get('W2') ?? [];
    const errors = w2.filter((v) => v.severity === 'error')
      .map((v) => `[W2] ${v.file}:${v.line} ${v.rule} ${v.snippet}`);
    expect(errors).toEqual([]);
  });

  it('other-owner violations are reported, not enforced by this gate', () => {
    const byOwner = scanAll(tokens);
    for (const [owner, vs] of byOwner) {
      if (owner === 'W2') continue;
      if (vs.length) {
        // W0: видно МАСШТАБ (счётчик + разбивка по правилам и файлам), а не
        // только голова списка. Полный список — `pnpm lint:tokens`.
        const byRule = [...summariseByRule(vs)].sort((a, b) => b[1] - a[1]);
        const byFile = new Map<string, number>();
        for (const v of vs) byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1);
        const head = vs.slice(0, 20).map((v) => `  [${owner}] ${v.file}:${v.line} ${v.rule}`);
        console.log(
          `token-usage ${owner}: ${vs.length} нарушений`
          + ` · правила: ${byRule.map(([r, n]) => `${r} ${n}`).join(', ')}`
          + ` · файлов: ${byFile.size} (топ: ${[...byFile].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, n]) => `${f} ${n}`).join(', ')})`
          + `\n${head.join('\n')}`
          + `\n  полный список: pnpm lint:tokens`,
        );
      }
    }
    expect(true).toBe(true);
  });
});
