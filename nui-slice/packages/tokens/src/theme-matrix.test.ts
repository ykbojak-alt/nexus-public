import { describe, it, expect } from 'vitest';
import { buildTokens, loadTokenSources, loadCanonicalThemes } from '../scripts/build-tokens';

/**
 * Wave-XIV theme matrix: 5 assistants × dark/light shell × standard/dense.
 * Cells checked at token level — what a browser would resolve:
 *  - personaText ≥4.5:1 and personaEdge ≥3:1 on the shell's surface.panel
 *  - text ramp ≥4.5:1 on the shell's panel (ramped down only for disabled)
 *  - density blocks scale space.* only — type.* and tap targets never shrink
 */
const ASSISTANTS = ['alice', 'mech', 'forge', 'codex', 'arch'] as const;
const SHELLS = ['nexus', 'alice'] as const; // dark / light shells
const DENSITIES = ['standard', 'dense'] as const;

type RGB = [number, number, number];
const hex2rgb = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (r: RGB) => 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]);
const ratio = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

function parseBlocks(css: string): Map<string, Map<string, string>> {
  const blocks = new Map<string, Map<string, string>>();
  const flat = css.replace(/@media[^{}]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const re = /(:root|\[data-theme="(\w+)"\]|\[data-density='(\w+)'\])\s*\{([^}]*)\}/g;
  for (const m of flat.matchAll(re)) {
    const vars = new Map<string, string>();
    for (const v of m[4].matchAll(/(--nexus-[\w-]+):\s*([^;]+);/g)) vars.set(v[1], v[2].trim());
    blocks.set(m[2] ?? (m[3] != null ? `density:${m[3]}` : 'root'), vars);
  }
  return blocks;
}
const cssName = (p: string) =>
  `--nexus-${p.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[._]/g, '-').toLowerCase()}`;

describe('theme matrix: 5 assistants × shells × density (wave-XIV)', async () => {
  const { css } = buildTokens(loadTokenSources(), await loadCanonicalThemes());
  const blocks = parseBlocks(css);
  const root = blocks.get('root')!;
  const get = (vars: Map<string, string>, path: string) =>
    vars.get(cssName(path)) ?? root.get(cssName(path)) ?? '';

  it('personaText/personaEdge hold AA/non-text floors on both shells, all 5 assistants', () => {
    const fails: string[] = [];
    for (const shell of SHELLS) {
      const vars = blocks.get(shell);
      expect(vars, `shell ${shell} missing`).toBeTruthy();
      const bg = hex2rgb(get(vars!, 'surface.panel'));
      for (const p of ASSISTANTS) {
        const tx = get(vars!, `personaText.${p}`);
        const eg = get(vars!, `personaEdge.${p}`);
        if (tx.startsWith('#')) {
          const r = ratio(hex2rgb(tx), bg);
          if (r < 4.5) fails.push(`${p}-text on ${shell}: ${r.toFixed(2)}`);
        } else fails.push(`${shell} personaText.${p} not hex`);
        if (eg.startsWith('#')) {
          const r = ratio(hex2rgb(eg), bg);
          if (r < 3) fails.push(`${p}-edge on ${shell}: ${r.toFixed(2)}`);
        } else fails.push(`${shell} personaEdge.${p} not hex`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('text ramp ≥4.5:1 on each shell panel (matrix cells reuse shell theme)', () => {
    const fails: string[] = [];
    for (const shell of SHELLS) {
      const vars = blocks.get(shell)!;
      const bg = hex2rgb(get(vars, 'surface.panel'));
      for (const role of ['text.primary', 'text.secondary', 'text.tertiary'] as const) {
        const r = ratio(hex2rgb(get(vars, role)), bg);
        if (r < 4.5) fails.push(`${shell} ${role}: ${r.toFixed(2)}`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('Alice GlassPanel stays ivory, including the reduced-transparency fallback', () => {
    const alice = blocks.get('alice')!;
    expect(get(alice, 'glassPanel.bg')).toContain('#FBF8F1');
    expect(get(alice, 'glassPanel.bgElevated')).toContain('#F6F0E4');

    const reduced = css.slice(css.indexOf('@media (prefers-reduced-transparency: reduce)'));
    const aliceFallback = reduced.slice(reduced.indexOf('[data-theme="alice"] {'));
    expect(aliceFallback).toContain('--nexus-glass-panel-bg: color-mix(in srgb, #FBF8F1 90%, var(--nexus-surface-root');
    expect(aliceFallback).toContain('--nexus-glass-panel-bg-elevated: color-mix(in srgb, #F6F0E4 92%, var(--nexus-surface-root');
    expect(aliceFallback).not.toContain('--nexus-glass-panel-bg: color-mix(in srgb, #1A1A21');
  });

  it('link states and persona identity meet contrast in all 5 × 2 shell cells (NQ-088/NQ-081)', () => {
    const fails: string[] = [];
    const minima: Array<{ ratio: number; pair: string }> = [];
    const cellRows: string[] = [];
    const textRoles = ['link.color', 'link.hover', 'link.visited', 'link.focus', 'link.disabled'] as const;
    const edgeRoles = ['link.icon', 'link.iconDisabled', 'link.edge', 'link.focusRing'] as const;

    for (const persona of ASSISTANTS) {
      for (const shell of SHELLS) {
        // Dark shell uses each assistant's own themed palette; light shell is
        // the canonical Alice shell with per-persona text/edge overrides.
        const vars = shell === 'alice' ? blocks.get('alice')! : blocks.get(persona)!;
        const bg = hex2rgb(get(vars, 'surface.panel'));
        let cellTextMin = Number.POSITIVE_INFINITY;
        let cellEdgeMin = Number.POSITIVE_INFINITY;
        for (const role of textRoles) {
          const fg = get(vars, role);
          if (!fg.startsWith('#')) { fails.push(`${persona}/${shell} ${role} not hex`); continue; }
          const r = ratio(hex2rgb(fg), bg);
          cellTextMin = Math.min(cellTextMin, r);
          minima.push({ ratio: r, pair: `${persona}/${shell} ${role}` });
          if (r < 4.5) fails.push(`${persona}/${shell} ${role}: ${r.toFixed(2)}`);
        }
        for (const role of edgeRoles) {
          const fg = get(vars, role);
          if (!fg.startsWith('#')) { fails.push(`${persona}/${shell} ${role} not hex`); continue; }
          const r = ratio(hex2rgb(fg), bg);
          cellEdgeMin = Math.min(cellEdgeMin, r);
          minima.push({ ratio: r, pair: `${persona}/${shell} ${role}` });
          if (r < 3) fails.push(`${persona}/${shell} ${role}: ${r.toFixed(2)}`);
        }

        const personaText = get(vars, `personaText.${persona}`);
        const personaEdge = get(vars, `personaEdge.${persona}`);
        const textRatio = ratio(hex2rgb(personaText), bg);
        const edgeRatio = ratio(hex2rgb(personaEdge), bg);
        cellTextMin = Math.min(cellTextMin, textRatio);
        cellEdgeMin = Math.min(cellEdgeMin, edgeRatio);
        minima.push({ ratio: textRatio, pair: `${persona}/${shell} personaText` });
        minima.push({ ratio: edgeRatio, pair: `${persona}/${shell} personaEdge` });
        if (textRatio < 4.5) fails.push(`${persona}/${shell} personaText: ${textRatio.toFixed(2)}`);
        if (edgeRatio < 3) fails.push(`${persona}/${shell} personaEdge: ${edgeRatio.toFixed(2)}`);
        cellRows.push(`${persona}/${shell}: text=${cellTextMin.toFixed(2)} non-text=${cellEdgeMin.toFixed(2)}`);
      }
    }

    const textMin = minima.filter((m) => /link\.(color|hover|visited|focus|disabled)|personaText/.test(m.pair))
      .sort((a, b) => a.ratio - b.ratio)[0];
    const edgeMin = minima.filter((m) => /link\.(icon|iconDisabled|edge|focusRing)|personaEdge/.test(m.pair))
      .sort((a, b) => a.ratio - b.ratio)[0];
    console.info(`5×2 contrast matrix minima: text ${textMin?.ratio.toFixed(2)} (${textMin?.pair}); non-text ${edgeMin?.ratio.toFixed(2)} (${edgeMin?.pair})`);
    console.info(`5×2 contrast cells: ${cellRows.join('; ')}`);
    expect(fails).toEqual([]);
  });

  it('full 5 × 2 × 2 theme/shell/density matrix keeps contrast and type sizes', () => {
    const fails: string[] = [];
    const rows: string[] = [];
    const fontTokens = [...root.entries()].filter(([key]) => /^--nexus-type-.*-font-size$/.test(key));
    expect(fontTokens.length).toBeGreaterThan(0);

    for (const persona of ASSISTANTS) {
      for (const shell of SHELLS) {
        const theme = shell === 'alice' ? 'alice' : persona;
        const vars = blocks.get(theme)!;
        const panel = get(vars, 'surface.panel');
        const textValues = ['text.primary', 'text.secondary', 'text.tertiary'].map((role) => ({
          role,
          ratio: ratio(hex2rgb(get(vars, role)), hex2rgb(panel)),
        }));
        const personaText = ratio(hex2rgb(get(vars, `personaText.${persona}`)), hex2rgb(panel));
        const personaEdge = ratio(hex2rgb(get(vars, `personaEdge.${persona}`)), hex2rgb(panel));
        const textMin = Math.min(...textValues.map(({ ratio: value }) => value), personaText);
        const fontMin = Math.min(...fontTokens.map(([key, fallback]) =>
          parseFloat(vars.get(key) ?? fallback),
        ));
        for (const { role, ratio: value } of textValues) {
          if (value < 4.5) fails.push(`${persona}/${shell} ${role}: ${value.toFixed(2)}`);
        }
        if (personaText < 4.5) fails.push(`${persona}/${shell} personaText: ${personaText.toFixed(2)}`);
        if (personaEdge < 3) fails.push(`${persona}/${shell} personaEdge: ${personaEdge.toFixed(2)}`);
        if (fontMin < 13) fails.push(`${persona}/${shell} font-size min ${fontMin}px`);

        for (const density of DENSITIES) {
          const densityVars = blocks.get(`density:${density}`)!;
          const densityTypeOverrides = [...densityVars.keys()].filter((key) => key.startsWith('--nexus-type-'));
          if (densityTypeOverrides.length > 0) fails.push(`${density} overrides type roles: ${densityTypeOverrides.join(', ')}`);
          rows.push(`${persona}/${shell}/${density}: text=${textMin.toFixed(2)} edge=${personaEdge.toFixed(2)} font=${fontMin}px`);
        }
      }
    }

    console.info(`5×2×2 theme/shell/density cells (${rows.length}): ${rows.join('; ')}`);
    expect(rows).toHaveLength(20);
    expect(fails).toEqual([]);
  });

  it('density blocks scale space.* only — never type.* or tap targets', () => {
    const fails: string[] = [];
    for (const d of DENSITIES) {
      const vars = blocks.get(`density:${d}`);
      expect(vars, `density ${d} block missing`).toBeTruthy();
      for (const key of vars!.keys()) {
        if (key.startsWith('--nexus-type-') || key === '--nexus-icon-strip-tap-size')
          fails.push(`${d} redefines ${key}`);
      }
    }
    // tap zone stays ≥24px (WCAG 2.2) at any density — the token is fixed.
    const tap = root.get('--nexus-icon-strip-tap-size');
    if (!tap || parseFloat(tap) < 24) fails.push(`iconStrip.tapSize ${tap} < 24px`);
    expect(fails).toEqual([]);
  });

  it('all type.* roles ≥13px under dense too (density cannot shrink type)', () => {
    const dense = blocks.get('density:dense')!;
    for (const m of css.matchAll(/(--nexus-type-[\w-]+-font-size)\s*:\s*([0-9.]+)px/g)) {
      // density blocks never redeclare type vars → resolved value is the root one
      if (parseFloat(m[2]) < 13) expect.unreachable(`${m[1]} = ${m[2]}px`);
    }
    expect(dense.get('--nexus-space-4')).toContain('calc'); // sanity: dense block real
  });
});
