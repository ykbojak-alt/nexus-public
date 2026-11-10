import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildTokens,
  loadCanonicalThemes,
  loadTokenSources,
} from '../scripts/build-tokens';
import { resolveReferences, validateTokenSet } from '../scripts/validate-tokens';

/**
 * nexus-scene-pack.json contract (wave-XIV W2 → V0):
 * versioned scene package — five assistant palettes, glass/gold MI params,
 * HUD type surface, motion surface. One value, one source: every pack value
 * must equal the resolved token at its declared path, never a re-typed number.
 */

const ASSISTANTS = ['arch', 'mech', 'alice', 'codex', 'forge'] as const;
const MI_PARAMS = {
  glass: ['color', 'roughness', 'metallic', 'opacity', 'emissive', 'fresnel'],
  gold: ['color', 'metallic', 'roughness', 'emissive', 'emissiveStrength', 'fresnel'],
} as const;

const RE_HEX = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

async function pack() {
  const sources = loadTokenSources();
  const flat = validateTokenSet(sources);
  const resolved = resolveReferences(flat);
  const themes = await loadCanonicalThemes();
  const out = buildTokens(sources, themes);
  return {
    pack: JSON.parse(out.unrealScenePack) as any,
    scene: JSON.parse(out.unrealScene) as any,
    flat,
    resolved,
    themes,
  };
}

function resolveTheme(flat: ReturnType<typeof validateTokenSet>, themes: Awaited<ReturnType<typeof loadCanonicalThemes>>, id: string) {
  const theme = themes.find((candidate) => candidate.id === id);
  if (!theme) throw new Error(`Missing canonical theme: ${id}`);
  const merged = flat.map((token) => theme.tokens[token.path] != null
    ? { ...token, value: theme.tokens[token.path] }
    : token);
  return resolveReferences(merged);
}

describe('unreal scene pack', () => {
  it('carries the v1 schema header and the bridge field contract', async () => {
    const { pack: p } = await pack();
    expect(p.schema).toBe('nexus-scene-pack/v1');
    expect(p.schemaVersion).toBe(1);
    // matches NexusSceneState.h FSceneSnapshot::ActiveAssistant (nexus-scene-v1)
    expect(p.bridge.field).toBe('activeAssistant');
    expect(p.bridge.vocabulary).toEqual([...ASSISTANTS]);
    expect(p.bridge.fallback).toBe('alice');
    expect(p.geometry.radii).toBeDefined();
  });

  it('covers five assistants with palette + persona + materials + glow', async () => {
    const { pack: p, scene } = await pack();
    for (const id of ASSISTANTS) {
      const a = p.assistants[id];
      expect(a, `assistant ${id} missing`).toBeDefined();
      expect(a.theme).toBe(id);
      expect(Object.keys(a.palette).sort()).toEqual(Object.keys(scene.themes[id]).sort());
      for (const path of Object.keys(scene.themes[id]))
        expect(a.palette[path], `${id}.palette.${path}`).toBe(scene.themes[id][path]);
      for (const path of ['accent.glowColor', 'depth.core.shadow', 'glow.soft', 'glow.active', 'glow.core'])
        expect(a.glow[path], `${id}.glow.${path}`).toBe(scene.themes[id][path]);
      for (const k of ['accent', 'edge', 'text']) {
        expect(a.persona[k], `${id}.persona.${k}`).toMatch(RE_HEX);
      }
      for (const [mat, params] of Object.entries(MI_PARAMS)) {
        for (const param of params) {
          expect(a.materials[mat][param], `${id}.${mat}.${param} missing`).toBeDefined();
        }
      }
    }
  });

  it('material values are UE-ready — colors hex, scalars numbers', async () => {
    const { pack: p } = await pack();
    for (const id of ASSISTANTS) {
      const { glass, gold } = p.assistants[id].materials;
      for (const c of [glass.color, glass.emissive, gold.color, gold.emissive]) {
        expect(c, `${id} material color`).toMatch(RE_HEX);
        expect(c).not.toContain('color-mix');
      }
      for (const s of [glass.roughness, glass.metallic, glass.opacity, glass.fresnel,
        gold.metallic, gold.roughness, gold.emissiveStrength, gold.fresnel]) {
        expect(typeof s, `${id} material scalar`).toBe('number');
      }
    }
    // gold recipe stays canonical across assistants (MI_Alice_GoldWire canon)
    expect(p.assistants.forge.materials.gold.metallic).toBe(1);
    expect(p.assistants.forge.materials.gold.roughness).toBe(0.22);
    // per-theme emissive: mech gold glows blue, alice stays gold
    expect(p.assistants.mech.materials.gold.emissive).not.toBe(
      p.assistants.alice.materials.gold.emissive,
    );
  });

  it('one source: every pack value equals the resolved token at its path', async () => {
    const { pack: p, scene, flat, resolved, themes } = await pack();
    const typeOf = new Map(flat.map((t) => [t.path, t.type]));
    // material scalars — raw token number, not a string
    const materialPaths = [
      'material.glass.roughness', 'material.glass.metallic', 'material.glass.opacity',
      'material.glass.fresnel', 'material.gold.metallic', 'material.gold.roughness',
      'material.gold.emissiveStrength', 'material.gold.fresnel',
    ];
    for (const path of materialPaths) {
      expect(typeOf.get(path), `${path} type`).toBe('number');
      const param = path.split('.').pop()!;
      const mat = path.split('.')[1];
      for (const id of ASSISTANTS) {
        expect(p.assistants[id].materials[mat][param], `${id}.${path}`)
          .toBe(resolved.get(path));
      }
    }
    // Colors are compared against the same scene resolver, including baked mixes.
    for (const id of ASSISTANTS) {
      const a = p.assistants[id];
      const themeResolved = resolveTheme(flat, themes, id);
      expect(a.persona.accent).toBe(themeResolved.get(`personaAccent.${id}`));
      expect(a.persona.edge).toBe(themeResolved.get(`personaEdge.${id}`));
      expect(a.persona.text).toBe(themeResolved.get(`personaText.${id}`));

      expect(a.materials.glass.color).toBe(themeResolved.get('material.glass.color'));
      expect(a.materials.glass.emissive).toBe(a.palette['surface.glass']);
      expect(a.materials.gold.color).toBe(themeResolved.get('material.gold.color'));
      expect(a.materials.gold.emissive).toBe(a.palette['accent.glowColor']);
      for (const mat of ['glass', 'gold'] as const) {
        for (const param of MI_PARAMS[mat]) {
          const tokenPath = `material.${mat}.${param}`;
          if (['color', 'emissive'].includes(param)) {
            expect(typeOf.get(tokenPath), `${tokenPath} type`).toBe('color');
          } else {
            expect(typeOf.get(tokenPath), `${tokenPath} type`).toBe('number');
            expect(a.materials[mat][param]).toBe(themeResolved.get(tokenPath));
          }
        }
      }
    }

    // Shared geometry: every exported radius is the resolved NEU primitive.
    const radiusPaths = [
      'radius.none', 'radius.xs', 'radius.sm', 'radius.md',
      'radius.lg', 'radius.xl', 'radius.2xl', 'radius.full',
    ];
    for (const path of radiusPaths) {
      expect(typeOf.get(path), `${path} type`).toBe('dimension');
      expect(p.geometry.radii[path], `geometry.radii.${path}`).toBe(resolved.get(path));
    }

    // Motion is shared by all five styles and equals every duration/easing source token.
    const motionTokens = flat.filter((x) => /^(duration|easing)\./.test(x.path));
    for (const t of motionTokens) {
      const sourceValue = Array.isArray(resolved.get(t.path))
        ? (resolved.get(t.path) as unknown[]).join(', ')
        : resolved.get(t.path);
      expect(p.motion[t.path], `motion.${t.path}`).toBe(sourceValue);
    }
    for (const id of ASSISTANTS) {
      expect(p.assistants[id].theme).toBe(id);
      for (const t of motionTokens)
        expect(p.motion[t.path], `${id}.motion.${t.path}`).toBeDefined();
    }
  });

  it('hud surface: families + roles, sizes never below 13px', async () => {
    const { pack: p } = await pack();
    expect(p.hud.families.ui).toContain('Inter Tight');
    expect(p.hud.families.mono).toContain('IBM Plex Mono');
    for (const [role, spec] of Object.entries<any>(p.hud.roles)) {
      const px = parseFloat(spec.fontSize);
      expect(px, `hud role ${role}`).toBeGreaterThanOrEqual(13);
    }
  });

  it('is deterministic across builds', async () => {
    const a = buildTokens(loadTokenSources(), await loadCanonicalThemes()).unrealScenePack;
    const b = buildTokens(loadTokenSources(), await loadCanonicalThemes()).unrealScenePack;
    expect(a).toBe(b);
  });

  it('data file lands in the UE content tokens dir (generated, not authored)', () => {
    const f = join(
      dirname(fileURLToPath(import.meta.url)), '..', '..', '..',
      'integrations', 'unreal', 'NexusRuntimeScene', 'Content', 'Nexus', 'tokens',
      'nexus-scene-pack.json',
    );
    expect(existsSync(f), 'run `nx build tokens` first').toBe(true);
    const disk = JSON.parse(readFileSync(f, 'utf8'));
    expect(disk.schema).toBe('nexus-scene-pack/v1');
  });
});
