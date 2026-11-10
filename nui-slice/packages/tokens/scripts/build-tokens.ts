/**
 * Token pipeline (Task 2 / spec §6):
 *   DTCG JSON → flatten → validate → resolve refs → emit artifacts.
 *
 * Outputs into packages/tokens/generated/:
 *   tokens.css · tokens.ts · tokens.d.ts · tailwind-theme.css · theme-manifest.json
 *
 * CSS var convention: --nexus-<dotted path joined by '-'> — every path segment
 * is kebab-cased (chart.gridMajor → --nexus-chart-grid-major, glassPanel.border
 * → --nexus-glass-panel-border; consumed by @nexus/ui). Composite typography
 * tokens emit per-property vars (fontFamily → -font-family, real CSS names).
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { flattenTokens, resolveReferences, validateTokenSet, type FlatToken } from './validate-tokens';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'generated');
const LAYERS = ['primitives', 'semantic', 'components'] as const;

export interface ThemeOverrides { id: string; tokens: Record<string, string> }

/** Load and merge every *.tokens.json under a layer directory. */
export function loadTokenSources(srcDir = SRC_DIR): Record<string, unknown>[] {
  const sources: Record<string, unknown>[] = [];
  for (const layer of LAYERS) {
    const dir = join(srcDir, layer);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.tokens.json')).sort()) {
      sources.push(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    }
  }
  return sources;
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
/** Canonical var name: segments kebab-cased (glassPanel → --nexus-glass-panel-…). */
const cssName = (path: string) => `--nexus-${path.split('.').map(kebab).join('-')}`;

function cssValue(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (v && typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Emit var declarations for one flat token (composite objects fan out per prop). */
function emitVar(path: string, value: unknown): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).map(([prop, v]) => `  ${cssName(path)}-${kebab(prop)}: ${cssValue(v)};`);
  }
  return [`  ${cssName(path)}: ${cssValue(value)};`];
}

function toTsKey(path: string): string {
  return path.replaceAll('.', '_');
}

export interface BuildResult {
  css: string;
  ts: string;
  dts: string;
  tailwind: string;
  manifest: string;
  /** Unreal scene token surface — per-theme resolved values (theme-map §1–2). */
  unrealScene: string;
  /** Unreal scene pack — versioned assistant/materials/hud/motion package
   *  for the nexus-scene-v1 bridge (docs/product/unreal-token-bridge.md). */
  unrealScenePack: string;
  flat: FlatToken[];
}

/** Scene surface/status/motion tokens consumed by the Unreal material layer
 *  (docs/product/unreal-runtime-scene-theme-map.md §1–2). Only real semantic
 *  paths — W4 reads resolved values, never raw hex props. */
const SCENE_TOKEN_PATHS = [
  'depth.environment.bg',
  'depth.surface.bg',
  'depth.panel.bg',
  'depth.elevated.bg',
  'depth.core.bg',
  'depth.core.shadow',
  'surface.glass',
  'text.primary',
  'text.secondary',
  'text.tertiary',
  'chart.series.1',
  'chart.series.2',
  'chart.series.3',
  'chart.series.4',
  'chart.series.5',
  'chart.series.6',
  'chart.series.7',
  'chart.series.8',
  'state.online',
  'state.info',
  'state.paused',
  'state.offline',
  'state.waiting',
  'state.warning',
  'state.error',
  'border.subtle',
  'border.default',
  'border.strong',
  'border.active',
  'border.success',
  'border.warning',
  'border.error',
  'duration.fast',
  'duration.normal',
  'duration.slow',
  'easing.standard',
  'opacity.grid',
  'scene.fresnelStrength',
  'accent.glowColor',
  'glow.soft',
  'glow.active',
  'glow.core',
] as const;

/** `--nexus-glow-color` is a never-set customization hook — the per-theme
 *  glow hue lives in `accent.glowColor`. Scene export resolves the var to
 *  the theme's glow hue at each level's own alpha (soft/active/core keep
 *  their 18/30/45% gradation). */
function sceneResolve(res: Map<string, unknown>, value: unknown): string {
  let out = cssValue(value);
  if (out.includes('var(--nexus-glow-color')) {
    const glow = String(res.get('accent.glowColor') ?? '');
    const hue = glow.match(/color-mix\(in srgb,\s*(#[0-9A-Fa-f]{3,8})/)?.[1];
    out = out.replace(
      /var\(--nexus-glow-color,\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)\)/g,
      (m, _r, _g, _b, a: string) =>
        hue
          ? `color-mix(in srgb, ${hue} ${Number(a) * 100}%, transparent)`
          : m.replace(/^var\(--nexus-glow-color,\s*(.+)\)$/, '$1'),
    );
  }
  return bakeColorMix(out);
}

/** UE materials cannot evaluate CSS `color-mix` (acceptance finding → W2/W4):
 *  bake it at export time. `#C P% over transparent` → `#RRGGBBAA` (alpha =
 *  P%); `#C P% over #B` → composited `#RRGGBB`. Applies inside shadow
 *  strings too (`0 0 48px 0 color-mix(...)` → `0 0 48px 0 #RRGGBBAA`). */
function bakeColorMix(value: string): string {
  return value.replace(
    /color-mix\(in srgb,\s*(#[0-9A-Fa-f]{3,8})\s+([\d.]+)%,\s*(transparent|#[0-9A-Fa-f]{3,8})\)/g,
    (_m, color: string, pct: string, base: string) => {
      const [r, g, b] = hexToRgb(color);
      const p = Number(pct) / 100;
      if (base === 'transparent')
        return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}${hexByte(p * 255)}`;
      const [br, bg, bb] = hexToRgb(base);
      return `#${hexByte(br + (r - br) * p)}${hexByte(bg + (g - bg) * p)}${hexByte(bb + (b - bb) * p)}`;
    },
  );
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function hexByte(n: number): string {
  return Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

/* W2-129: derive the UA color-scheme per theme from the resolved
   surface.root luminance — keeps scrollbars/form controls on-scheme
   without a per-theme hand-maintained flag. Threshold 0.4 sits between
   ivory (~0.93) and the dark family roots (≤0.02). */
function themeColorScheme(resolvedMap: Map<string, unknown>): 'light' | 'dark' {
  const root = resolvedMap.get('surface.root');
  if (typeof root !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(root.trim())) return 'dark';
  const [r, g, b] = hexToRgb(root.trim());
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) > 0.4 ? 'light' : 'dark';
}

/* NQ-081: the surface ramp must be re-declared by every [data-theme] block,
   even where it equals :root. A theme block can mount INSIDE another themed
   subtree (assistant-screen.tsx:116,214 nest a NexusThemeProvider per persona
   under the shell's own data-theme), and custom properties inherit from the
   nearest ancestor, never from :root. Dropping an equal-to-root declaration
   therefore does not yield the root value there — it yields whatever the
   enclosing theme set. Measured on the deployed export: /codex and /mech rail
   panels painted the alice shell's ivory #FBF8F1 under cream text (#F6F0E4) =
   1.06:1, while arch and forge, which override the token and so emitted it,
   stayed readable. Guarded by packages/tokens/src/theme-scope.contract.test.ts. */
function isSurfaceRamp(path: string): boolean {
  return path.startsWith('surface.') || /^depth\.[a-z]+\.bg$/.test(path);
}

export function buildTokens(
  sources: Record<string, unknown>[],
  themes: ThemeOverrides[] = [],
): BuildResult {
  const flat = validateTokenSet(sources);
  const resolved = resolveReferences(flat);

  const rootLines: string[] = [];
  for (const t of flat) rootLines.push(...emitVar(t.path, resolved.get(t.path)));

  const themeBlocks: string[] = [];
  const themeResolutions = new Map<string, Map<string, unknown>>();
  for (const theme of themes) {
    // Re-resolve the full token set per theme: dependents of overridden
    // tokens (depth.*/component aliases) must track theme values, not stay
    // baked at :root. Emit vars whose resolved value changes, plus the whole
    // surface ramp (isSurfaceRamp) so a nested scope cannot borrow the
    // enclosing theme's surfaces.
    const merged = flat.map((t): FlatToken =>
      theme.tokens[t.path] != null ? { ...t, value: theme.tokens[t.path] } : t,
    );
    for (const [path, raw] of Object.entries(theme.tokens)) {
      if (!merged.some((t) => t.path === path)) merged.push({ path, type: 'color', value: raw });
    }
    const themeResolved = resolveReferences(merged);
    themeResolutions.set(theme.id, themeResolved);
    const lines = merged
      .filter(
        (t) =>
          cssValue(themeResolved.get(t.path)) !== cssValue(resolved.get(t.path)) ||
          isSurfaceRamp(t.path),
      )
      .flatMap((t) => emitVar(t.path, themeResolved.get(t.path)));
    // color-scheme in every theme block: inherited into scrollbars and UA
    // widgets of the themed subtree — and of <html> itself once the shell
    // mirrors data-theme onto the document element (W2-129).
    lines.unshift(`  color-scheme: ${themeColorScheme(themeResolved)};`);
    themeBlocks.push(`[data-theme="${theme.id}"] {\n${lines.join('\n')}\n}`);
  }

  // Density contract (§3): scale multiplies the spacing unit, not layout
  // geometry. `[data-density]` blocks redefine the space ramp + expose
  // --nexus-density-scale for consumers that need the factor itself.
  const DENSITY: Record<string, number> = { calm: 1.15, standard: 1, dense: 0.85 };
  const spaceTokens = flat.filter((t) => t.path.startsWith('space.') && t.type === 'dimension');
  const densityBlocks = Object.entries(DENSITY).map(([d, scale]) => {
    const lines = spaceTokens.map(
      (t) => `  ${cssName(t.path)}: calc(${resolved.get(t.path)} * ${scale});`,
    );
    lines.push(`  --nexus-density-scale: ${scale};`);
    return `[data-density='${d}'] {\n${lines.join('\n')}\n}`;
  });

  /* Reduced transparency (prefers-reduced-transparency): surface fills whose
     resolved value is a translucent mix composite over the theme's own
     surface.root instead of `transparent` — same tone, zero see-through;
     surface blurs zero out. Tints, borders and shadows keep alpha — they are
     accents on a base, not surfaces floating over content. */
  const RT_OPAQUE = new Set([
    'surface.overlay',
    'depth.overlay.bg',
    'glassPanel.bg',
    'glassPanel.bgElevated',
    'topBar.bg',
    'glass.rail.bg',
    'glass.topbar.bg',
    'glass.card.bg',
    'glass.statusbar.bg',
  ]);
  const RT_NO_BLUR = new Set([
    'depth.overlay.blur',
    'glassPanel.blur',
    'topBar.blur',
    'glass.rail.blur',
    'glass.topbar.blur',
    'glass.card.blur',
    'glass.statusbar.blur',
  ]);
  const rtLines = (res: Map<string, unknown>) =>
    flat.flatMap((t) => {
      if (RT_OPAQUE.has(t.path)) {
        const v = String(res.get(t.path));
        const opaque = v
          .replace(
            /color-mix\(in srgb,\s*([^,\s]+)\s+([\d.]+)%\s*,\s*transparent\)/,
            (_m, c: string, a: string) =>
              `color-mix(in srgb, ${c} ${a}%, var(--nexus-surface-root, #0A0A0C))`,
          )
          .replace(
            /rgba\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\)/,
            (_m, r: string, g: string, b: string, a: string) =>
              `color-mix(in srgb, rgb(${r},${g},${b}) ${Number(a) * 100}%, var(--nexus-surface-root, #0A0A0C))`,
          );
        return opaque !== v ? [`    ${cssName(t.path)}: ${opaque};`] : [];
      }
      if (RT_NO_BLUR.has(t.path)) return [`    ${cssName(t.path)}: 0px;`];
      return [];
    });
  const rtRoot = rtLines(resolved);
  const rtBlocks = [`  :root {\n${rtRoot.join('\n')}\n  }`];
  for (const theme of themes) {
    const lines = rtLines(themeResolutions.get(theme.id)!);
    if (lines.join('\n') !== rtRoot.join('\n')) {
      rtBlocks.push(`  [data-theme="${theme.id}"] {\n${lines.join('\n')}\n  }`);
    }
  }
  const rtBlock = `@media (prefers-reduced-transparency: reduce) {\n${rtBlocks.join('\n\n')}\n}`;

  /* prefers-contrast: more — contrast-supports remap of the text/border
     hierarchy one step up, resolved per theme. Surfaces, tints, authored-art
     and motion are untouched; ramp order is preserved (tertiary takes
     secondary's value, etc.), so contrast only increases. */
  const PC_REMAP: Record<string, string> = {
    'text.disabled': 'text.tertiary',
    'text.tertiary': 'text.secondary',
    'text.secondary': 'text.primary',
    'border.subtle': 'border.default',
    'border.default': 'border.strong',
  };
  const pcLines = (res: Map<string, unknown>) =>
    Object.entries(PC_REMAP).map(
      ([from, to]) => `    ${cssName(from)}: ${cssValue(res.get(to))};`,
    );
  const pcRoot = pcLines(resolved);
  const pcBlocks = [`  :root {\n${pcRoot.join('\n')}\n  }`];
  for (const theme of themes) {
    const lines = pcLines(themeResolutions.get(theme.id)!);
    if (lines.join('\n') !== pcRoot.join('\n')) {
      pcBlocks.push(`  [data-theme="${theme.id}"] {\n${lines.join('\n')}\n  }`);
    }
  }
  const pcBlock = `@media (prefers-contrast: more) {\n${pcBlocks.join('\n\n')}\n}`;

  /* Document canvas (W2-129): paint <html> with the theme surface before
     React mounts — no white FOUC under a dark persona. Follows the theme
     once data-theme is mirrored onto documentElement; falls back to the
     :root (nexus) values otherwise. */
  const canvasRule =
    `html {\n  background-color: var(--nexus-surface-root, ${String(resolved.get('surface.root'))});` +
    `\n  color: var(--nexus-text-primary, ${String(resolved.get('text.primary'))});` +
    `\n  color-scheme: ${themeColorScheme(resolved)};\n}`;

  const css = `:root {\n${rootLines.join('\n')}\n}\n${canvasRule}\n${themeBlocks.join('\n\n')}\n\n${densityBlocks.join('\n\n')}\n\n${rtBlock}\n\n${pcBlock}`;

  const entries = flat.map((t) => `  ${JSON.stringify(toTsKey(t.path))}: ${JSON.stringify(resolved.get(t.path))},`);
  const ts = `export const tokens = {\n${entries.join('\n')}\n} as const;\nexport type TokenKey = keyof typeof tokens;\n`;
  const dts = `export declare const tokens: Record<string, unknown>;\nexport type TokenKey = string;\n`;

  const tw = flat
    .filter((t) => t.type === 'color' || t.type === 'dimension')
    .map((t) => `  --${t.path.replaceAll('.', '-')}=${cssName(t.path)};`);
  const tailwind = `/* Tailwind bridge: semantic + primitive vars under @theme */\n@theme {\n${tw.join('\n')}\n}\n`;

  const manifest = JSON.stringify({
    name: '@nexus/tokens', version: 1,
    tokenCount: flat.length,
    layers: [...LAYERS],
    themes: themes.map((t) => t.id),
  }, null, 2);

  /* ── Unreal scene pack (wave-XIV W2 → V0) ──────────────────────────────
     Versioned data package consumed by the nexus-scene-v1 bridge: five
     assistant palettes, glass/gold MI parameters, HUD type surface and the
     full motion surface. Values come from the same resolved maps as the
     css/scene exports — one value, one source. */
  const SCENE_PACK_ASSISTANTS = ['arch', 'mech', 'alice', 'codex', 'forge'] as const;
  const RADIUS_PATHS = [
    'radius.none', 'radius.xs', 'radius.sm', 'radius.md',
    'radius.lg', 'radius.xl', 'radius.2xl', 'radius.full',
  ] as const;
  const GLOW_PATHS = [
    'accent.glowColor', 'depth.core.shadow',
    'glow.soft', 'glow.active', 'glow.core',
  ] as const;
  const MATERIAL_PARAM_MAP: Record<string, Record<string, string>> = {
    glass: {
      color: 'material.glass.color',
      roughness: 'material.glass.roughness',
      metallic: 'material.glass.metallic',
      opacity: 'material.glass.opacity',
      emissive: 'material.glass.emissive',
      fresnel: 'material.glass.fresnel',
    },
    gold: {
      color: 'material.gold.color',
      metallic: 'material.gold.metallic',
      roughness: 'material.gold.roughness',
      emissive: 'material.gold.emissive',
      emissiveStrength: 'material.gold.emissiveStrength',
      fresnel: 'material.gold.fresnel',
    },
  };
  const HUD_FONT_PATHS = ['font.ui', 'font.mono', 'font.display'] as const;
  const HUD_ROLE_PATHS = [
    'type.hero', 'type.pageTitle', 'type.sectionTitle', 'type.panelTitle',
    'type.body', 'type.caption', 'type.status', 'type.metric', 'type.code',
  ] as const;

  const packScalar = (v: unknown): unknown => {
    if (typeof v === 'number') return v;
    if (Array.isArray(v)) return v.join(', ');
    const s = String(v);
    return /color-mix|var\(|^#/.test(s) ? bakeColorMix(s) : s;
  };
  const packResolve = (res: Map<string, unknown>, path: string): unknown => {
    const v = res.get(path);
    if (v && typeof v === 'object' && !Array.isArray(v))
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, packScalar(val)]),
      );
    return packScalar(v);
  };

  const rootRes = resolved;
  const hud = {
    families: Object.fromEntries(HUD_FONT_PATHS.map((p) => [p.split('.')[1], packResolve(rootRes, p)])),
    roles: Object.fromEntries(HUD_ROLE_PATHS.map((p) => [p.split('.')[1], packResolve(rootRes, p)])),
  };
  const motionPaths = flat
    .map((t) => t.path)
    .filter((p) => p.startsWith('duration.') || p.startsWith('easing.'))
    .sort();
  const motion = Object.fromEntries(motionPaths.map((p) => [p, packResolve(rootRes, p)]));
  const radii = Object.fromEntries(RADIUS_PATHS.map((p) => [p, packResolve(rootRes, p)]));

  const assistants = Object.fromEntries(
    SCENE_PACK_ASSISTANTS.map((id) => {
      const res = themeResolutions.get(id) ?? rootRes;
      return [
        id,
        {
          theme: id,
          palette: Object.fromEntries(
            SCENE_TOKEN_PATHS.map((p) => [p, sceneResolve(res, res.get(p))]),
          ),
          glow: Object.fromEntries(
            GLOW_PATHS.map((p) => [p, sceneResolve(res, res.get(p))]),
          ),
          persona: {
            accent: packResolve(res, `personaAccent.${id}`),
            edge: packResolve(res, `personaEdge.${id}`),
            text: packResolve(res, `personaText.${id}`),
          },
          materials: Object.fromEntries(
            Object.entries(MATERIAL_PARAM_MAP).map(([mat, params]) => [
              mat,
              Object.fromEntries(
                Object.entries(params).map(([param, path]) => [param, packResolve(res, path)]),
              ),
            ]),
          ),
        },
      ];
    }),
  );

  const unrealScenePack = JSON.stringify({
    schema: 'nexus-scene-pack/v1',
    schemaVersion: 1,
    name: '@nexus/tokens:unreal-scene-pack',
    source: 'docs/product/unreal-token-bridge.md',
    bridge: {
      /** Snapshot field consumed by NexusSceneState.ActiveAssistant
          (nexus-scene-v1, NexusSceneContract.h) — closed vocabulary. */
      field: 'activeAssistant',
      vocabulary: [...SCENE_PACK_ASSISTANTS],
      fallback: 'alice',
      note: 'null/unknown assistant → fallback palette; scene marks UNKNOWN, never invents a palette.',
    },
    hud,
    // Geometry and animation are persona-invariant: one canonical ramp
    // keeps the five assistant styles visually identical.
    geometry: { radii },
    motion,
    assistants,
  }, null, 2) + '\n';

  const sceneThemes = Object.fromEntries(
    [...themeResolutions.keys()].sort().map((id) => [
      id,
      Object.fromEntries(
        SCENE_TOKEN_PATHS.map((p) => [p, sceneResolve(themeResolutions.get(id)!, themeResolutions.get(id)!.get(p))]),
      ),
    ]),
  );
  const unrealScene = JSON.stringify({
    name: '@nexus/tokens:unreal-scene',
    version: 1,
    source: 'docs/product/unreal-runtime-scene-theme-map.md §1–2',
    valueFormat:
      'UE-ready resolved values: colors baked to sRGB hex #RRGGBB | #RRGGBBAA (color-mix resolved at build); ' +
      'non-color as emitted (ms | px | cubic-bezier | "0 0 Npx 0 #hex" shadow)',
    themes: sceneThemes,
  }, null, 2) + '\n';

  return { css, ts, dts, tailwind, manifest, unrealScene, unrealScenePack, flat };
}

/** Test/Storybook entry point from the implementation plan. */
export function buildTokensForTest(): BuildResult {
  return buildTokens(loadTokenSources());
}

/** Load canonical theme definitions for [data-theme] emission. */
export async function loadCanonicalThemes(): Promise<ThemeOverrides[]> {
  const { themeRegistry } = await import('../../themes/src/core/registry');
  return [...themeRegistry.values()].map((t) => ({ id: t.id, tokens: t.tokens }));
}

/**
 * Запись артефакта сборки: во временный файл + атомарный rename.
 *
 * Прямая запись на Windows падает с `UNKNOWN` (errno -4094), если файл
 * кратковременно заблокирован (антивирус, индексатор, читатель) — сборка
 * `tokens:build` из-за этого становилась флакующей и роняла зависимые
 * таргеты (storybook). Rename не оставляет «полузаписанный» артефакт, а
 * короткие повторы переживают транзиентную блокировку.
 */
function writeGenerated(target: string, content: string): void {
  const tmp = `${target}.tmp`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      writeFileSync(tmp, content);
      renameSync(tmp, target);
      return;
    } catch (err) {
      lastError = err;
      try { rmSync(tmp, { force: true }); } catch { /* временный файл мог не появиться */ }
      // Блокировка транзиентная — короткая пауза и следующая попытка.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (attempt + 1));
    }
  }
  throw lastError;
}

/** CLI: write generated artifacts. */
export async function runBuild(): Promise<BuildResult> {
  const result = buildTokens(loadTokenSources(), await loadCanonicalThemes());
  mkdirSync(OUT_DIR, { recursive: true });
  writeGenerated(join(OUT_DIR, 'tokens.css'), result.css);
  writeGenerated(join(OUT_DIR, 'tokens.ts'), result.ts);
  writeGenerated(join(OUT_DIR, 'tokens.d.ts'), result.dts);
  writeGenerated(join(OUT_DIR, 'tailwind-theme.css'), result.tailwind);
  writeGenerated(join(OUT_DIR, 'theme-manifest.json'), result.manifest);
  writeGenerated(join(OUT_DIR, 'unreal-scene-tokens.json'), result.unrealScene);
  writeGenerated(join(OUT_DIR, 'unreal-scene-pack.json'), result.unrealScenePack);
  // Data-only drop for the UE content folder — V0 imports it, W2 owns the bytes.
  const ueTokensDir = join(OUT_DIR, '..', '..', '..', 'integrations', 'unreal',
    'NexusRuntimeScene', 'Content', 'Nexus', 'tokens');
  mkdirSync(ueTokensDir, { recursive: true });
  writeGenerated(join(ueTokensDir, 'nexus-scene-pack.json'), result.unrealScenePack);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await runBuild();
  console.log(`tokens: ${r.flat.length} tokens -> ${OUT_DIR}`);
}
