import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * NQ-081 (спек-часть A). Блок [data-theme] mounting INSIDE another themed
 * subtree (assistant-screen.tsx:116,214 wrap each persona screen in a nested
 * NexusThemeProvider) resolves custom properties from the nearest ancestor,
 * never from :root. A theme that merely equals the :root value therefore does
 * not inherit that value under a foreign shell — it inherits the shell's.
 *
 * Measured on the deployed export 2026-11-02: under an alice shell the
 * assistant rail panels of /codex and /mech painted ivory #F8F8F0 under cream
 * text #F6F0E4 — 1.06:1, while /arch kept 16.19 because arch re-declares
 * --nexus-depth-panel-bg. So the surface ramp must be declared in full by
 * every theme block, not only where it differs from :root.
 */

type Blocks = Map<string, Map<string, string>>;

function parseBlocks(css: string): Blocks {
  const blocks: Blocks = new Map();
  const flat = css.replace(/@media[^{}]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const re = /(:root|\[data-theme="([\w-]+)"\])\s*\{([^}]*)\}/g;
  for (const m of flat.matchAll(re)) {
    const vars = new Map<string, string>();
    for (const v of m[3].matchAll(/(--nexus-[\w-]+):\s*([^;]+);/g)) {
      vars.set(v[1], v[2].trim());
    }
    blocks.set(m[2] ?? 'root', vars);
  }
  return blocks;
}

const SURFACE_RE = /^--nexus-(surface-[\w-]+|depth-[\w-]+-bg)$/;

/** Cascade a nested scope: ancestor declarations, then the persona's own. */
function nest(blocks: Blocks, shell: string, persona: string): Map<string, string> {
  const out = new Map<string, string>(blocks.get('root')!);
  for (const scope of [shell, persona]) {
    for (const [k, v] of blocks.get(scope) ?? []) out.set(k, v);
  }
  return out;
}

const hex2rgb = (h: string): [number, number, number] => {
  const s = h.trim();
  return [
    parseInt(s.slice(1, 3), 16) / 255,
    parseInt(s.slice(3, 5), 16) / 255,
    parseInt(s.slice(5, 7), 16) / 255,
  ];
};
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (r: [number, number, number]) =>
  0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]);
const ratio = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('theme scope isolation (NQ-081): surface ramp is declared per theme', () => {
  const css = readFileSync(join(ROOT, 'generated', 'tokens.css'), 'utf8');
  const blocks = parseBlocks(css);
  const root = blocks.get('root')!;
  const surfaceVars = [...root.keys()].filter((k) => SURFACE_RE.test(k));

  it(':root carries a surface ramp to isolate', () => {
    expect(surfaceVars.length).toBeGreaterThanOrEqual(10);
  });

  it('every [data-theme] block declares the whole surface ramp locally', () => {
    const themes = [...blocks.keys()].filter((k) => k !== 'root');
    expect(themes.length).toBeGreaterThanOrEqual(6);
    const offenders: string[] = [];
    for (const theme of themes) {
      const own = blocks.get(theme)!;
      for (const v of surfaceVars) {
        if (!own.has(v)) offenders.push(`${theme}: ${v}`);
      }
    }
    expect(offenders, `наследуются из чужой области: ${offenders.join(', ')}`).toEqual([]);
  });

  it('a persona nested in a foreign light shell keeps a dark panel surface', () => {
    const offenders: string[] = [];
    for (const persona of ['codex', 'mech', 'arch', 'forge']) {
      const scoped = nest(blocks, 'alice', persona);
      const panel = scoped.get('--nexus-depth-panel-bg') ?? '';
      if (!/^#[0-9A-Fa-f]{6}$/i.test(panel.trim())) continue;
      const ink = scoped.get('--nexus-text-on-art') ?? '#F6F0E4';
      const r = ratio(hex2rgb(ink), hex2rgb(panel));
      if (r < 4.5) offenders.push(`${persona} в alice-оболочке: ${ink} на ${panel} = ${r.toFixed(2)}`);
    }
    expect(offenders, offenders.join('; ')).toEqual([]);
  });

  it('codex and mech panel surfaces stay dark under an alice shell', () => {
    for (const persona of ['codex', 'mech']) {
      const panel = nest(blocks, 'alice', persona).get('--nexus-depth-panel-bg')!;
      expect(panel, `${persona} под alice`).toMatch(/^#[0-9A-Fa-f]{6}$/i);
      expect(lum(hex2rgb(panel)), `${persona} panel ${panel} too light`).toBeLessThan(0.08);
    }
  });
});
