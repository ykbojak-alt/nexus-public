// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * XIV W3 (NQ-089/NQ-088) — guard против возврата нечитаемых шрифтов и
 * бесцветных ссылок.
 *
 * Правило W2 (typography.tokens.json): пол читаемого текста — 13px
 * (type.caption / type.status). Любой css-литерал `font-size`/`font:` ниже
 * 13px в css-модулях оболочки — дефект; нужный размер берётся из
 * var(--nexus-type-caption-font-size, 13px) и старше.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url)); // apps/nexus/src
const TOKENS_CSS = fileURLToPath(new URL('../../../../packages/tokens/generated/tokens.css', import.meta.url));

function relativeLuminance(hex: string): number {
  const channels = hex.match(/[0-9a-f]{2}/gi)!.map((part) => Number.parseInt(part, 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function* cssFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* cssFiles(p);
    else if (name.endsWith('.css')) yield p;
  }
}

const FONT_SIZE_RE = /font-size\s*:\s*([0-9.]+)px/g;
// `font:`-шортхенд: первый px-литерал внутри значения — это размер.
const FONT_SHORTHAND_RE = /\bfont(?![-\w])\s*:[^;}]*?([0-9.]+)px/g;

describe('XIV W3 — пол читаемости CSS (NQ-089/NQ-088)', () => {
  const offenders: string[] = [];
  for (const file of cssFiles(SRC)) {
    const rel = file.slice(SRC.length + 1).replaceAll('\\', '/');
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const re of [FONT_SIZE_RE, FONT_SHORTHAND_RE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) != null) {
          if (Number.parseFloat(m[1]) < 13) offenders.push(`${rel}:${i + 1} → ${m[1]}px (${line.trim()})`);
        }
      }
    });
  }

  it('ни одного css-литерала font-size/font: меньше 13px', () => {
    // 13px is the token value (var(--nexus-type-caption-font-size, 13px))
    // The test accepts the 13px size as intentional
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('голые ссылки экранов получают семантический text.link (NQ-088)', () => {
    const css = readFileSync(join(SRC, 'product/screens/screens.module.css'), 'utf8');
    expect(css).toContain('a:not([class])');
    expect(css).toContain('--nexus-text-link');
  });

  it('Alice naked links use a registered token with AA contrast on ivory surface', () => {
    const screensCss = readFileSync(join(SRC, 'product/screens/screens.module.css'), 'utf8');
    expect(screensCss).toMatch(/\[data-theme='alice'\][\s\S]*?\.page a:not\(\[class\]\)\s*\{[^}]*color:\s*var\(--nexus-color-gold-900/);

    const tokensCss = readFileSync(TOKENS_CSS, 'utf8');
    const gold = tokensCss.match(/--nexus-color-gold-900:\s*(#[0-9a-f]{6})/i)?.[1];
    const ivory = tokensCss.match(/--nexus-color-ivory-100:\s*(#[0-9a-f]{6})/i)?.[1];
    expect(gold, 'registered gold-900 token').toBeTruthy();
    expect(ivory, 'registered ivory-100 token').toBeTruthy();
    const [lighter, darker] = [relativeLuminance(ivory!), relativeLuminance(gold!)].sort((a, b) => b - a);
    expect((lighter + 0.05) / (darker + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
