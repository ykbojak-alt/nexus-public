import { describe, expect, it } from 'vitest';
import {
  buildTokens,
  loadCanonicalThemes,
  loadTokenSources,
} from '../scripts/build-tokens';

/**
 * unreal-scene-tokens.json contract (dispatch 13.10, Task 2):
 * deterministic per-theme export of the scene token surface from
 * docs/product/unreal-runtime-scene-theme-map.md §1–2 — real resolved
 * semantic values for W4's material layer; no hand palette.
 */
describe('unreal scene token export', () => {
  const SCENE_PATHS = [
    'depth.environment.bg', 'depth.surface.bg', 'depth.panel.bg',
    'depth.elevated.bg', 'depth.core.bg', 'depth.core.shadow',
    'surface.glass',
    'text.primary', 'text.secondary', 'text.tertiary',
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `chart.series.${i}`),
    'state.online', 'state.info', 'state.paused', 'state.offline',
    'state.waiting', 'state.warning', 'state.error',
    'border.subtle', 'border.default', 'border.strong', 'border.active',
    'border.success', 'border.warning', 'border.error',
    'duration.fast', 'duration.normal', 'duration.slow', 'easing.standard',
    'accent.glowColor', 'glow.soft', 'glow.active', 'glow.core',
    'opacity.grid', 'scene.fresnelStrength',
  ];

  async function exportJson() {
    const out = buildTokens(loadTokenSources(), await loadCanonicalThemes());
    return JSON.parse(out.unrealScene) as {
      themes: Record<string, Record<string, string>>;
    };
  }

  it('covers every canonical theme with the full scene surface', async () => {
    const scene = await exportJson();
    for (const theme of ['nexus', 'mech', 'forge', 'codex', 'arch', 'alice', 'aurum-dark']) {
      const tokens = scene.themes[theme];
      expect(tokens, `theme ${theme} missing`).toBeDefined();
      for (const path of SCENE_PATHS) {
        expect(tokens[path], `${theme}.${path} missing`).toBeTruthy();
      }
    }
  });

  it('emits resolved values — no {refs}, no var(), no undefined', async () => {
    const scene = await exportJson();
    for (const [theme, tokens] of Object.entries(scene.themes)) {
      for (const [path, value] of Object.entries(tokens)) {
        expect(value, `${theme}.${path}`).not.toMatch(/^\{.*\}$/);
        expect(value, `${theme}.${path}`).not.toContain('var(');
        expect(value, `${theme}.${path}`).not.toBe('undefined');
      }
    }
  });

  it('emits UE-ready values — no color-mix, colors are sRGB hex', async () => {
    const scene = await exportJson();
    // acceptance finding → W2/W4: UE cannot evaluate CSS color-mix; the
    // export must bake it. Allowed formats: #RRGGBB[AA], Npx/Nms scalars,
    // cubic-bezier quadruples, "0 0 Npx 0 #hex" shadow strings.
    const allowed =
      /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$|^[\d.]+(ms|px)$|^[\d.]+$|^[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*[\d.]+$|^0 0 [\d.]+px 0 #[0-9A-Fa-f]{6,8}$/;
    for (const [theme, tokens] of Object.entries(scene.themes)) {
      for (const [path, value] of Object.entries(tokens)) {
        expect(value, `${theme}.${path}`).not.toContain('color-mix');
        expect(value, `${theme}.${path}`).toMatch(allowed);
      }
    }
    // alpha is preserved, not dropped: a translucent token keeps its alpha byte
    expect(scene.themes.nexus['border.subtle']).toMatch(/^#[0-9A-Fa-f]{8}$/);
    // 0%-mix = fully transparent "no surface color", not black-opaque
    expect(scene.themes.nexus['depth.core.bg']).toBe('#0A0A0C00');
  });

  it('is deterministic across builds', async () => {
    const a = await exportJson();
    const b = await exportJson();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('theme overrides actually land (alice differs from nexus)', async () => {
    const scene = await exportJson();
    // alice text.primary is near-black, nexus is ivory — a real override
    // proves per-theme re-resolution, not a duplicated base map.
    expect(scene.themes.alice['text.primary']).not.toBe(
      scene.themes.nexus['text.primary'],
    );
    // status vocabulary honestly differs: alice uses 700-ramp state colors
    expect(scene.themes.alice['state.online']).not.toBe(
      scene.themes.nexus['state.online'],
    );
  });
});
