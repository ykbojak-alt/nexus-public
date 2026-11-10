import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTokens, loadTokenSources, loadCanonicalThemes } from '../scripts/build-tokens';
import type { FlatToken } from '../scripts/validate-tokens';

/**
 * Wave-XIV W2 readability gates (Yury priority «шрифты слишком трудно
 * читаемы» 2026-10-16), enforced as tests so CI — not memory — holds them:
 *  1. every type.* role ≥ 13px (body/utility floor; display roles are ≥18px)
 *  2. zero font-size literals <13px anywhere in repo css — scan, not trust.
 *     Violations are reported file:line + owning window so the fix lands
 *     in the right queue.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCAN_DIRS: Array<{ dir: string; owner: string }> = [
  { dir: 'apps/nexus/src', owner: 'W3' },
  { dir: 'packages/ui/src', owner: 'W2' },
  { dir: 'packages/tokens/src', owner: 'W2' },
];

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (e === 'node_modules' || e === '.next' || e === 'generated') continue;
      yield* walk(p);
    } else if (e.endsWith('.css')) {
      yield p;
    }
  }
}

// font-size: <NN>px|rem|em literal (var() values skipped — token fallbacks
// are ≥13px by construction and a <13px fallback IS a violation to catch).
// 0px allowed (icon-only resets). rem/em flagged under 0.8125 (=13px).
const FS_RE = /font-size\s*:\s*([0-9.]+)(px|rem|em)\b/g;
// font: <...> <NN>px shorthand — first px number is the size.
const FONT_RE = /^\s*font\s*:\s*[^;]*?([0-9.]+)px/;

const under13 = (v: number, unit: string) =>
  unit === 'px' ? v < 13 : v < 0.8125;

function fontSizeLiterals(tokens: FlatToken[]) {
  const hits: Array<{ path: string; size: string }> = [];
  const visit = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => visit(item, `${path}[${i}]`));
    } else if (value != null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if ((key === 'fontSize' || key === 'font-size') && typeof child === 'string') {
          const match = child.match(/^([\d.]+)px$/);
          if (match && parseFloat(match[1]) < 13) hits.push({ path: `${path}.${key}`, size: child });
        }
        visit(child, `${path}.${key}`);
      }
    }
  };
  for (const token of tokens) visit(token.value, token.path);
  return hits;
}

describe('readability gates (wave-XIV)', async () => {
  const { css, flat } = buildTokens(loadTokenSources(), await loadCanonicalThemes());

  it('every type.* font-size ≥13px in generated tokens.css', () => {
    const fails: string[] = [];
    for (const m of css.matchAll(/(--nexus-type-[\w-]+-font-size)\s*:\s*([0-9.]+)px/g)) {
      if (parseFloat(m[2]) < 13) fails.push(`${m[1]} = ${m[2]}px`);
    }
    expect(fails).toEqual([]);
  });

  it('no fontSize literal below 13px in any source token', () => {
    expect(fontSizeLiterals(flat)).toEqual([]);
  });

  it('source-token font-size gate detects a planted sub-13px value', () => {
    const planted = [{
      path: 'screenType.compact.kpiLabel',
      type: 'typography',
      value: { fontSize: '12px', lineHeight: '16px' },
    }];
    expect(fontSizeLiterals(planted)).toEqual([
      { path: 'screenType.compact.kpiLabel.fontSize', size: '12px' },
    ]);
  });

  it('screenType compact/regular roles keep line height and numeric alignment', () => {
    const byPath = new Map(flat.map((token) => [token.path, token.value]));
    const textRoles = ['kpiLabel', 'starterChip', 'listenLabel', 'sectionLabel', 'supporting'];
    const fails: string[] = [];
    for (const density of ['compact', 'regular']) {
      for (const role of textRoles) {
        const value = byPath.get(`screenType.${density}.${role}`) as Record<string, unknown> | undefined;
        const size = typeof value?.fontSize === 'string' ? parseFloat(value.fontSize) : NaN;
        const lineHeight = typeof value?.lineHeight === 'string' ? parseFloat(value.lineHeight) : NaN;
        if (size < 13 || !Number.isFinite(size)) fails.push(`${density}.${role} fontSize=${value?.fontSize}`);
        if (lineHeight < 16 || !Number.isFinite(lineHeight)) fails.push(`${density}.${role} lineHeight=${value?.lineHeight}`);
      }
      for (const role of ['kpiValue', 'kpiStrong']) {
        const numeric = byPath.get(`screenType.${density}.${role}`) as Record<string, unknown> | undefined;
        const size = typeof numeric?.fontSize === 'string' ? parseFloat(numeric.fontSize) : NaN;
        const lineHeight = typeof numeric?.lineHeight === 'string' ? parseFloat(numeric.lineHeight) : NaN;
        if (size < 13 || !Number.isFinite(size)) fails.push(`${density}.${role} fontSize=${numeric?.fontSize}`);
        if (lineHeight < 16 || !Number.isFinite(lineHeight)) fails.push(`${density}.${role} lineHeight=${numeric?.lineHeight}`);
        if (numeric?.fontVariantNumeric !== 'tabular-nums')
          fails.push(`${density}.${role} fontVariantNumeric=${numeric?.fontVariantNumeric}`);
      }
    }
    expect(fails).toEqual([]);
    expect(css).toMatch(/--nexus-screen-type-compact-kpi-value-font-variant-numeric:\s*tabular-nums/);
    expect(css).toMatch(/--nexus-screen-type-regular-kpi-strong-font-variant-numeric:\s*tabular-nums/);
  });

  it('no font-size literal <13px in repo css (owner-tagged scan)', () => {
    const hits: string[] = [];
    for (const { dir, owner } of SCAN_DIRS) {
      let files: string[] = [];
      try { files = [...walk(join(ROOT, dir))]; } catch { continue; }
      for (const f of files) {
        const rel = relative(ROOT, f).replace(/\\/g, '/');
        readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          for (const m of line.matchAll(FS_RE)) {
            const v = parseFloat(m[1]);
            if (v > 0 && under13(v, m[2])) hits.push(`[${owner}] ${rel}:${i + 1} ${m[0]}`);
          }
          const sh = line.match(FONT_RE);
          if (sh && parseFloat(sh[1]) > 0 && parseFloat(sh[1]) < 13)
            hits.push(`[${owner}] ${rel}:${i + 1} ${sh[0].trim()}`);
        });
      }
    }
    // Report is the deliverable: dispatcher gets the owner-tagged list;
    // suite fails only if the count is non-zero.
    expect(hits).toEqual([]);
  });

  it('no var() font-size fallback <13px in repo css', () => {
    const hits: string[] = [];
    for (const { dir, owner } of SCAN_DIRS) {
      let files: string[] = [];
      try { files = [...walk(join(ROOT, dir))]; } catch { continue; }
      for (const f of files) {
        const rel = relative(ROOT, f).replace(/\\/g, '/');
        readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          for (const m of line.matchAll(/font-size\s*:\s*var\([^)]*,\s*([0-9.]+)px\s*\)/g)) {
            if (parseFloat(m[1]) < 13) hits.push(`[${owner}] ${rel}:${i + 1} ${m[0].trim()}`);
          }
        });
      }
    }
    expect(hits).toEqual([]);
  });
});
