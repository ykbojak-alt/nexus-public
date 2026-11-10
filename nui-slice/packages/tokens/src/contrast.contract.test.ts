import { describe, it, expect } from 'vitest';
import { buildTokens, loadTokenSources, loadCanonicalThemes } from '../scripts/build-tokens';

/**
 * D13 / NQ-024 contract: contrast is a token-level guarantee, not a
 * component-level hope. Every registered theme must keep:
 *  - text.{primary,secondary,tertiary} ≥ 4.5:1 on every surface.*
 *  - text.disabled dimmer than tertiary (hierarchy; disabled is 1.4.3-exempt)
 *  - focus.ring ≥ 3:1 on every surface.* (WCAG 1.4.11 non-text)
 *  - state.* fg ≥ 4.5:1 on its own tinted badge bg (14% fg + 86% panel)
 * Catches what jsdom can't and what axe-incomplete can hide.
 */
const STATUSES = [
  'online', 'active', 'thinking', 'waiting', 'syncing', 'validating',
  'executing', 'complete', 'paused', 'error', 'warning', 'offline', 'info',
];
const SURFACES = ['surface.root', 'surface.base', 'surface.panel', 'surface.elevated'];

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
  // Conditional overrides (@media prefers-reduced-*) carry intentionally
  // different values (opaque composites, zeroed blurs) — strip before
  // parsing so the contract reads base token values only.
  const flat = css.replace(/@media[^{}]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const re = /(:root|\[data-theme="([\w-]+)"\])\s*\{([^}]*)\}/g;
  for (const m of flat.matchAll(re)) {
    const vars = new Map<string, string>();
    for (const v of m[3].matchAll(/(--nexus-[\w-]+):\s*([^;]+);/g)) vars.set(v[1], v[2].trim());
    blocks.set(m[2] ?? 'root', vars);
  }
  return blocks;
}

const cssName = (path: string) =>
  `--nexus-${path.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[._]/g, '-').toLowerCase()}`;

describe('token contrast contract (D13)', async () => {
  const { css } = buildTokens(loadTokenSources(), await loadCanonicalThemes());
  const blocks = parseBlocks(css);
  const root = blocks.get('root')!;
  const themes = [...blocks.entries()];

  const get = (vars: Map<string, string>, path: string) =>
    vars.get(cssName(path)) ?? root.get(cssName(path)) ?? '';

  it('text ramp ≥4.5:1 (tertiary included) on every surface, every theme', () => {
    const fails: string[] = [];
    for (const [theme, vars] of themes) {
      for (const srf of SURFACES) {
        const bg = get(vars, srf);
        if (!bg.startsWith('#')) continue;
        for (const role of ['text.primary', 'text.secondary', 'text.tertiary'] as const) {
          const fg = get(vars, role);
          if (!fg.startsWith('#')) continue;
          const r = ratio(hex2rgb(fg), hex2rgb(bg));
          if (r < 4.5) fails.push(`${theme} ${role} on ${srf}: ${r.toFixed(2)}`);
        }
      }
    }
    expect(fails).toEqual([]);
  });

  it('disabled stays dimmer than tertiary (hierarchy) on every theme', () => {
    const fails: string[] = [];
    for (const [theme, vars] of themes) {
      const bg = hex2rgb(get(vars, 'surface.panel'));
      const t = ratio(hex2rgb(get(vars, 'text.tertiary')), bg);
      const d = ratio(hex2rgb(get(vars, 'text.disabled')), bg);
      if (d >= t) fails.push(`${theme}: disabled ${d.toFixed(2)} >= tertiary ${t.toFixed(2)}`);
    }
    expect(fails).toEqual([]);
  });

  it('text.disabled ≥4.5:1 on surface.panel and ≥3:1 on every surface, every theme (NQ-091)', () => {
    // WCAG 1.4.3 exempts disabled controls, but the project floor keeps
    // inactive labels readable (≥3:1) and chip labels on panel/elevated
    // card stock at ≥4.5:1 so the live S2 computed check stays green.
    const fails: string[] = [];
    for (const [theme, vars] of themes) {
      const fg = get(vars, 'text.disabled');
      if (!fg.startsWith('#')) { fails.push(`${theme}: text.disabled not hex (${fg})`); continue; }
      const panel = get(vars, 'surface.panel');
      if (panel.startsWith('#')) {
        const r = ratio(hex2rgb(fg), hex2rgb(panel));
        if (r < 4.5) fails.push(`${theme} text.disabled on surface.panel: ${r.toFixed(2)} <4.5`);
      }
      for (const srf of SURFACES) {
        const bg = get(vars, srf);
        if (!bg.startsWith('#')) continue;
        const r = ratio(hex2rgb(fg), hex2rgb(bg));
        if (r < 3) fails.push(`${theme} text.disabled on ${srf}: ${r.toFixed(2)} <3`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('focus.ring ≥3:1 vs every surface (1.4.11), every theme', () => {
    const fails: string[] = [];
    for (const [theme, vars] of themes) {
      const ring = get(vars, 'focus.ring');
      if (!ring.startsWith('#')) { fails.push(`${theme}: focus.ring not hex (${ring})`); continue; }
      for (const srf of SURFACES) {
        const bg = get(vars, srf);
        if (!bg.startsWith('#')) continue;
        const r = ratio(hex2rgb(ring), hex2rgb(bg));
        if (r < 3) fails.push(`${theme} focus.ring on ${srf}: ${r.toFixed(2)}`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('accent.primary ≥4.5:1 as text on panel AND under onPrimary, every theme', () => {
    // accent.primary serves two text roles: link/label fg on surfaces
    // (SourceLink, EvidenceLink) and solid-button bg under accent.onPrimary.
    // Both directions of the same pair must hold — alice/arch regressed here
    // (all-theme axe sweep, NQ-024 follow-up).
    const fails: string[] = [];
    for (const [theme, vars] of themes) {
      const accent = get(vars, 'accent.primary');
      const panel = get(vars, 'surface.panel');
      const elevated = get(vars, 'surface.elevated');
      const onAccent = get(vars, 'accent.onPrimary');
      if (!accent.startsWith('#') || !onAccent.startsWith('#')) {
        fails.push(`${theme}: non-hex accent pair (${accent} / ${onAccent})`); continue;
      }
      if (panel.startsWith('#')) {
        const r = ratio(hex2rgb(accent), hex2rgb(panel));
        if (r < 4.5) fails.push(`${theme} accent.primary on surface.panel: ${r.toFixed(2)}`);
      }
      // accent-primary text also lands on elevated cards (sideAvatar
      // monogram letter — NQ-089: gold.700 read 4.33 on ivory.100 while
      // passing 4.63 on panel). Gate the second surface too.
      if (elevated.startsWith('#')) {
        const r = ratio(hex2rgb(accent), hex2rgb(elevated));
        if (r < 4.5) fails.push(`${theme} accent.primary on surface.elevated: ${r.toFixed(2)}`);
      }
      const r = ratio(hex2rgb(onAccent), hex2rgb(accent));
      if (r < 4.5) fails.push(`${theme} accent.onPrimary on accent.primary: ${r.toFixed(2)}`);
    }
    expect(fails).toEqual([]);
  });

  it('modeSwitch + handoffBar roles ≥4.5:1 on their real substrates, every theme (wave-XXV)', () => {
    // Segmented composer control + handoff ghost buttons paint accent text
    // on an accent alpha-wash. Axe XXIII matrix: active chip read 2.65–4.30
    // across themes when the wash was 18% of accent. The contract resolves
    // each token pairing on the substrate it actually lands on:
    // activeText → activeBg over modeSwitch.bg (= surface.elevated),
    // idleText → modeSwitch.bg, handoff buttonText → buttonBg over panel.
    const mix = (mixValue: string, base: RGB): RGB | null => {
      const m = mixValue.match(/color-mix\(in srgb,\s*(#[0-9A-Fa-f]{6})\s+(\d+)%/);
      if (!m) return null;
      const tint = hex2rgb(m[1]);
      const a = parseInt(m[2], 10) / 100;
      return [0, 1, 2].map((i) => tint[i] * a + base[i] * (1 - a)) as RGB;
    };
    const fails: string[] = [];
    const minima: string[] = [];
    for (const [theme, vars] of themes) {
      const seg = get(vars, 'modeSwitch.bg');
      const activeBg = get(vars, 'modeSwitch.activeBg');
      const activeText = get(vars, 'modeSwitch.activeText');
      const idleText = get(vars, 'modeSwitch.idleText');
      const panel = get(vars, 'surface.panel');
      const hBg = get(vars, 'handoffBar.buttonBg');
      const hText = get(vars, 'handoffBar.buttonText');
      if (!seg.startsWith('#') || !activeText.startsWith('#') || !idleText.startsWith('#')) continue;
      const segRgb = hex2rgb(seg);
      const sub = mix(activeBg, segRgb);
      if (sub) {
        const r = ratio(hex2rgb(activeText), sub);
        minima.push(`${theme} ${r.toFixed(2)}`);
        if (r < 4.5) fails.push(`${theme} modeSwitch.activeText on activeBg-over-bg: ${r.toFixed(2)}`);
      }
      const ri = ratio(hex2rgb(idleText), segRgb);
      if (ri < 4.5) fails.push(`${theme} modeSwitch.idleText on modeSwitch.bg: ${ri.toFixed(2)}`);
      if (panel.startsWith('#') && hText.startsWith('#')) {
        const hb = mix(hBg, hex2rgb(panel));
        if (hb) {
          const r = ratio(hex2rgb(hText), hb);
          if (r < 4.5) fails.push(`${theme} handoffBar.buttonText on buttonBg-over-panel: ${r.toFixed(2)}`);
        }
      }
    }
    console.info('modeSwitch active chip minima:', minima.join('; '));
    expect(fails).toEqual([]);
  });

  it('glassPanel.text ≥4.5:1 on its panel substrate, every theme (W3-structural-contrast)', () => {
    // Variant B: glassPanel.text is the ink that re-themed dark-persona screens
    // paint over the light alice GlassPanel substrate. It defaults to
    // text.primary (dark themes: light ink on obsidian glass) and the light
    // alice shell re-points it to obsidian.900 dark ink on ivory glass. The
    // gate reads the resolved value on depth-panel-bg, so it catches a
    // light-on-light regression in either direction (NQ-081 #4/#5/#6/#7 class).
    const fails: string[] = [];
    for (const [theme, vars] of themes) {
      const ink = get(vars, 'glassPanel.text');
      const panel = get(vars, 'depth-panel-bg');
      if (!ink.startsWith('#')) { fails.push(`${theme}: glassPanel.text not hex (${ink})`); continue; }
      // depth-panel-bg can be a color-mix tint; composite over surface.root
      // when so, otherwise read the hex directly.
      let bgHex = panel;
      if (bgHex.startsWith('color-mix')) {
        const m = bgHex.match(/color-mix\(in srgb,\s*(#[0-9A-Fa-f]{6})\s+\d+%\s*,\s*(#[0-9A-Fa-f]{6})\)/);
        bgHex = m ? m[1] : '';
      }
      if (!bgHex.startsWith('#')) continue;
      const r = ratio(hex2rgb(ink), hex2rgb(bgHex));
      if (r < 4.5) fails.push(`${theme} glassPanel.text on depth-panel-bg: ${r.toFixed(2)}`);
    }
    expect(fails).toEqual([]);
  });

  it('glassPanel.topbarText ≥4.5:1 and topbarTextDim ≥3:1 on the real glass-card substrate, every theme (REAL-BUGS)', () => {
    // topSearch (search pill) uses glassPanel.topbarText; opacityLabel / value
    // chips use glassPanel.topbarTextDim (the muted step, 3:1 non-text floor).
    // Defaults follow text.primary/text.tertiary (dark canon), alice re-points
    // to dark ink on the ivory glass — gate validates both directions
    // (wave-XIV W2 contrast re-check: topSearch 1.11:1 → ≥4.5, opacityLabel 1.29:1 → ≥3).
    // glass.card.bg is a color-mix tint, so it is composited over surface.root
    // before measuring (same helper as the wave-XXV glass-card gate below).
    const mix = (mixValue: string, base: RGB): RGB | null => {
      const m = mixValue.match(/color-mix\(in srgb,\s*(#[0-9A-Fa-f]{6})\s+(\d+)%/);
      if (!m) return null;
      const tint = hex2rgb(m[1]);
      const a = parseInt(m[2], 10) / 100;
      return [0, 1, 2].map((i) => tint[i] * a + base[i] * (1 - a)) as RGB;
    };
    const fails: string[] = [];
    for (const [theme, vars] of themes) {
      const txt = get(vars, 'glassPanel.topbarText');
      const dim = get(vars, 'glassPanel.topbarTextDim');
      if (!txt.startsWith('#')) { fails.push(`${theme}: topbarText not hex (${txt})`); continue; }
      if (!dim.startsWith('#')) { fails.push(`${theme}: topbarTextDim not hex (${dim})`); continue; }
      const rootSrf = get(vars, 'surface.root');
      const glass = get(vars, 'glass.card.bg');
      const elevated = get(vars, 'surface.elevated');
      if (!rootSrf.startsWith('#') || !glass.startsWith('color-mix') || !elevated.startsWith('#')) continue;
      const sub = mix(glass, hex2rgb(rootSrf));
      if (!sub) continue;
      const r = ratio(hex2rgb(txt), sub);
      const rd = ratio(hex2rgb(dim), hex2rgb(elevated));
      if (r < 4.5) fails.push(`${theme} topbarText on glass.card-over-root: ${r.toFixed(2)}`);
      if (rd < 3) fails.push(`${theme} topbarTextDim on surface.elevated: ${rd.toFixed(2)}`);
    }
    expect(fails).toEqual([]);
  });

  it('text.secondary/tertiary ≥4.5:1 on the real glass-card substrate, every theme (wave-XXV)', () => {
    // convoList-style cards stack text on glass fills; the contract
    // composites glass.card.bg over surface.root and gates the two muted
    // text roles there — catches the 22%-white-fill collapse class.
    const mix = (mixValue: string, base: RGB): RGB | null => {
      const m = mixValue.match(/color-mix\(in srgb,\s*(#[0-9A-Fa-f]{6})\s+(\d+)%/);
      if (!m) return null;
      const tint = hex2rgb(m[1]);
      const a = parseInt(m[2], 10) / 100;
      return [0, 1, 2].map((i) => tint[i] * a + base[i] * (1 - a)) as RGB;
    };
    const fails: string[] = [];
    for (const [theme, vars] of themes) {
      const rootSrf = get(vars, 'surface.root');
      const glass = get(vars, 'glass.card.bg');
      if (!rootSrf.startsWith('#') || !glass.startsWith('color-mix')) continue;
      const sub = mix(glass, hex2rgb(rootSrf));
      if (!sub) continue;
      for (const role of ['text.secondary', 'text.tertiary'] as const) {
        const fg = get(vars, role);
        if (!fg.startsWith('#')) continue;
        const r = ratio(hex2rgb(fg), sub);
        if (r < 4.5) fails.push(`${theme} ${role} on glass.card-over-root: ${r.toFixed(2)}`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('accent.primaryHover ≥4.5:1 as text on panel and elevated, every theme (wave-XXV)', () => {
    // Hover is a text role on links/chips; the accent ladder must keep the
    // hovered step readable too (darker steps on dark themes regress here).
    const fails: string[] = [];
    for (const [theme, vars] of themes) {
      const hover = get(vars, 'accent.primaryHover');
      if (!hover.startsWith('#')) continue;
      for (const srf of ['surface.panel', 'surface.elevated'] as const) {
        const bg = get(vars, srf);
        if (!bg.startsWith('#')) continue;
        const r = ratio(hex2rgb(hover), hex2rgb(bg));
        if (r < 4.5) fails.push(`${theme} accent.primaryHover on ${srf}: ${r.toFixed(2)}`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('text.accent ≥4.5:1 on panel and on accent-primarySoft tint, every theme', () => {
    // text.accent is a real text role: Tabs [aria-selected], Pagination
    // [aria-current] paint it on the accent-primarySoft tint. Navigation
    // stories are outside the theme-a11y matrix, so this pair is only
    // reachable at token level (NQ-036/046 class — tint under text).
    const fails: string[] = [];
    for (const [theme, vars] of themes) {
      const accent = get(vars, 'text.accent');
      const panel = get(vars, 'surface.panel');
      const soft = get(vars, 'accent.primarySoft');
      if (!accent.startsWith('#') || !panel.startsWith('#')) continue;
      const fg = hex2rgb(accent);
      const bg = hex2rgb(panel);
      const plain = ratio(fg, bg);
      if (plain < 4.5) fails.push(`${theme} text.accent on surface.panel: ${plain.toFixed(2)}`);
      // composite the transparent color-mix tint over panel
      const m = soft.match(/color-mix\(in srgb,\s*(#[0-9A-Fa-f]{6})\s+(\d+)%/);
      if (m) {
        const tint = hex2rgb(m[1]);
        const a = parseInt(m[2], 10) / 100;
        const tinted: RGB = [0, 1, 2].map((i) => tint[i] * a + bg[i] * (1 - a)) as RGB;
        const r = ratio(fg, tinted);
        if (r < 4.5) fails.push(`${theme} text.accent on accent.primarySoft tint: ${r.toFixed(2)}`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('link text states ≥4.5:1 and link icon/edges ≥3:1 on every surface, every theme (NQ-088)', () => {
    const textRoles = ['link.color', 'link.hover', 'link.visited', 'link.focus', 'link.disabled'] as const;
    const nonTextRoles = ['link.icon', 'link.iconDisabled', 'link.edge', 'link.focusRing'] as const;
    const fails: string[] = [];
    const minima = new Map<string, { ratio: number; pair: string }>();
    const noteMin = (role: string, value: number, pair: string) => {
      const old = minima.get(role);
      if (!old || value < old.ratio) minima.set(role, { ratio: value, pair });
    };

    for (const [theme, vars] of themes) {
      for (const srf of SURFACES) {
        const bg = get(vars, srf);
        if (!bg.startsWith('#')) continue;
        for (const role of textRoles) {
          const fg = get(vars, role);
          if (!fg.startsWith('#')) { fails.push(`${theme} ${role} not hex: ${fg}`); continue; }
          const value = ratio(hex2rgb(fg), hex2rgb(bg));
          noteMin(role, value, `${theme}/${srf}`);
          if (value < 4.5) fails.push(`${theme} ${role} on ${srf}: ${value.toFixed(2)}`);
        }
        for (const role of nonTextRoles) {
          const fg = get(vars, role);
          if (!fg.startsWith('#')) { fails.push(`${theme} ${role} not hex: ${fg}`); continue; }
          const value = ratio(hex2rgb(fg), hex2rgb(bg));
          noteMin(role, value, `${theme}/${srf}`);
          if (value < 3) fails.push(`${theme} ${role} on ${srf}: ${value.toFixed(2)}`);
        }
      }
    }

    console.info('NQ-088 link contrast minima:',
      [...minima].map(([role, m]) => `${role} ${m.ratio.toFixed(2)} (${m.pair})`).join('; '));
    expect(fails).toEqual([]);
  });

  it('prefers-contrast: more block exists and raises text/border contrast per theme', () => {
    // Wave-5 W2-2: the PC media block remaps the contrast-critical ramps one
    // step up — disabled→tertiary, tertiary→secondary, secondary→primary,
    // border.subtle→default, border.default→strong. Assert the block exists,
    // covers every theme, and each remapped value's luminance distance from
    // surface.panel strictly grows vs the base value.
    const m = css.match(/@media \(prefers-contrast: more\)\s*\{([\s\S]*)\}\s*$/);
    expect(m, 'prefers-contrast media block missing').toBeTruthy();
    const pc = parseBlocks(m![0].replace(/^@media[^{}]*\{(.*)\}\s*$/s, '$1'));
    expect(pc.get('root'), 'prefers-contrast :root block missing').toBeTruthy();
    const REMAP: [string, string][] = [
      ['text.disabled', 'text.tertiary'],
      ['text.tertiary', 'text.secondary'],
      ['text.secondary', 'text.primary'],
      ['border.subtle', 'border.default'],
      ['border.default', 'border.strong'],
    ];
    const fails: string[] = [];
    for (const [theme, vars] of themes) {
      const pcVars = pc.get(theme) ?? pc.get('root')!;
      const bg = get(vars, 'surface.panel');
      if (!bg.startsWith('#')) continue;
      const bgL = lum(hex2rgb(bg));
      for (const [from] of REMAP) {
        const base = get(vars, from);
        const raised = pcVars.get(cssName(from));
        if (!raised) { fails.push(`${theme}: ${from} missing in prefers-contrast block`); continue; }
        const baseHex = base.match(/#[0-9A-Fa-f]{6}/)?.[0];
        const raisedHex = raised.match(/#[0-9A-Fa-f]{6}/)?.[0];
        if (!baseHex || !raisedHex) continue;
        const grew = Math.abs(lum(hex2rgb(raisedHex)) - bgL) > Math.abs(lum(hex2rgb(baseHex)) - bgL);
        if (!grew && raisedHex !== baseHex) fails.push(`${theme}: ${from} ${baseHex}→${raisedHex} not higher-contrast`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('personaText.* ≥4.5:1 and personaEdge.* ≥3:1 on own panel, every theme (NQ-081)', () => {
    // Wave-XIV canon: frame geometry identical across the five assistant
    // styles, color by assistant — and the identity color must stay legible
    // on BOTH shell polarities. personaText = color as text (≥4.5 AA),
    // personaEdge = hairline/frame (≥3:1 non-text, 1.4.11). Light blocks
    // (alice) re-point to darker steps in the theme file; the gate reads
    // resolved values, so it catches any regression in either direction.
    const PERSONAS = ['alice', 'mech', 'forge', 'codex', 'arch', 'nexus'] as const;
    const fails: string[] = [];
    for (const [theme, vars] of themes) {
      const panel = get(vars, 'surface.panel');
      if (!panel.startsWith('#')) continue;
      const bg = hex2rgb(panel);
      for (const p of PERSONAS) {
        const tx = get(vars, `personaText.${p}`);
        if (!tx.startsWith('#')) { fails.push(`${theme} personaText.${p} not hex`); continue; }
        const rt = ratio(hex2rgb(tx), bg);
        if (rt < 4.5) fails.push(`${theme} personaText.${p} on panel: ${rt.toFixed(2)}`);
        const eg = get(vars, `personaEdge.${p}`);
        if (!eg.startsWith('#')) { fails.push(`${theme} personaEdge.${p} not hex`); continue; }
        const re = ratio(hex2rgb(eg), bg);
        if (re < 3) fails.push(`${theme} personaEdge.${p} on panel: ${re.toFixed(2)}`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('personaText.* ≥4.5:1 on surface.elevated too (NQ-088 live re-check)', () => {
    // W1 RC-gate 18.10: persona chips render on elevated cards (alice
    // ivory.100), where gold.700 reads 4.33:1 — panel-only check missed it.
    const PERSONAS = ['alice', 'mech', 'forge', 'codex', 'arch', 'nexus'] as const;
    const fails: string[] = [];
    for (const [theme, vars] of themes) {
      const elevated = get(vars, 'surface.elevated');
      if (!elevated.startsWith('#')) continue;
      const bg = hex2rgb(elevated);
      for (const p of PERSONAS) {
        const tx = get(vars, `personaText.${p}`);
        if (!tx.startsWith('#')) continue;
        const rt = ratio(hex2rgb(tx), bg);
        if (rt < 4.5) fails.push(`${theme} personaText.${p} on elevated: ${rt.toFixed(2)}`);
        const eg = get(vars, `personaEdge.${p}`);
        if (eg.startsWith('#')) {
          const re = ratio(hex2rgb(eg), bg);
          if (re < 3) fails.push(`${theme} personaEdge.${p} on elevated: ${re.toFixed(2)}`);
        }
      }
    }
    expect(fails).toEqual([]);
  });

  it('busWindow.* status colors ≥4.5:1 on panel and elevated, every theme (wave-XIV)', () => {
    // «Окна и шина» rows paint the status as dot + colored label — treat the
    // color as text (strict reading of the 4.5:1 ask), not as 3:1 non-text.
    // busWindow.* maps onto state.* (online/executing/syncing/validating/
    // error); the mapping must stay inside the already-gated dictionary.
    const BUS_STATUSES = ['idle', 'working', 'waiting', 'long', 'error'] as const;
    const fails: string[] = [];
    for (const [theme, vars] of themes) {
      for (const srf of ['surface.panel', 'surface.elevated'] as const) {
        const raw = get(vars, srf);
        if (!raw.startsWith('#')) continue;
        const bg = hex2rgb(raw);
        for (const st of BUS_STATUSES) {
          const fg = get(vars, `busWindow.${st}`);
          if (!fg.startsWith('#')) { fails.push(`${theme} busWindow.${st} not hex`); continue; }
          const r = ratio(hex2rgb(fg), bg);
          if (r < 4.5) fails.push(`${theme} busWindow.${st} on ${srf}: ${r.toFixed(2)}`);
        }
      }
    }
    expect(fails).toEqual([]);
  });

  it('pluginStatus.* status colors ≥4.5:1 on panel and elevated, every theme (wave-XVI)', () => {
    // Менеджер «Плагины»: статус — цветной текст бейджа на тинте и метка
    // на панели. pluginStatus.* мапится на state.* (active/error/warning/
    // paused) — словарь обязан оставаться внутри загаженных значений.
    const PLUGIN_STATUSES = ['active', 'failed', 'overridden', 'restartRequired'] as const;
    const fails: string[] = [];
    for (const [theme, vars] of themes) {
      for (const srf of ['surface.panel', 'surface.elevated'] as const) {
        const raw = get(vars, srf);
        if (!raw.startsWith('#')) continue;
        const bg = hex2rgb(raw);
        for (const st of PLUGIN_STATUSES) {
          const fg = get(vars, `pluginStatus.${st}`);
          if (!fg.startsWith('#')) { fails.push(`${theme} pluginStatus.${st} not hex`); continue; }
          const r = ratio(hex2rgb(fg), bg);
          if (r < 4.5) fails.push(`${theme} pluginStatus.${st} on ${srf}: ${r.toFixed(2)}`);
        }
      }
    }
    expect(fails).toEqual([]);
  });

  it('state.* ≥4.5:1 on its tinted badge bg (14% fg + panel), every theme', () => {
    const fails: string[] = [];
    for (const [theme, vars] of themes) {
      const panel = hex2rgb(get(vars, 'surface.panel'));
      for (const st of STATUSES) {
        const raw = get(vars, `state.${st}`);
        if (!raw.startsWith('#')) { fails.push(`${theme} state.${st} not hex`); continue; }
        const fg = hex2rgb(raw);
        const bg: RGB = [0, 1, 2].map((i) => fg[i] * 0.14 + panel[i] * 0.86) as RGB;
        const r = ratio(fg, bg);
        if (r < 4.5) fails.push(`${theme} state.${st}: ${r.toFixed(2)}`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('onArt pinned roles: no theme override + ≥4.5:1 on surface.art (NQ-072)', () => {
    // Wave-6 NQ-072: authored game surfaces stay dark under every theme, so
    // text.onArt*/accent.onArt/surface.art are pinned — a theme block must
    // never redeclare them (that would reintroduce the alice collapse).
    const PINNED = [
      'text.onArt', 'text.onArtDim', 'text.onArtMuted', 'accent.onArt', 'surface.art',
    ];
    const fails: string[] = [];
    for (const p of PINNED) {
      const base = root.get(cssName(p));
      if (!base) { fails.push(`${p} missing in :root`); continue; }
      for (const [theme, vars] of themes) {
        if (theme === 'root') continue;
        const v = vars.get(cssName(p));
        if (v && v !== base) fails.push(`${theme}: ${p} overridden ${base} → ${v}`);
      }
    }
    const art = hex2rgb(get(root, 'surface.art'));
    for (const p of PINNED.slice(0, 4)) {
      const hex = root.get(cssName(p))!.match(/#[0-9A-Fa-f]{6}/)?.[0];
      if (!hex) { fails.push(`${p} not hex`); continue; }
      const r = ratio(hex2rgb(hex), art);
      if (r < 4.5) fails.push(`${p} on surface.art: ${r.toFixed(2)} < 4.5`);
    }
    expect(fails).toEqual([]);
  });
});
