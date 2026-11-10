import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildTokens,
  loadCanonicalThemes,
  loadTokenSources,
} from '../scripts/build-tokens';

/**
 * Start-scenes consistency (wave VI.6 / VII.5): the five-assistant
 * vocabulary and every authored value must agree across the bridge rig,
 * the scene builder, and V2's SourceArt JSON files. Fails on any drift —
 * a value with no `source`/`proposed` marker is an invented value.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const UE = `${ROOT}integrations/unreal/NexusRuntimeScene`;

const ASSISTANTS = ['alice', 'arch', 'codex', 'forge', 'mech'] as const;
const M_START_METAL_PARAMS = new Set([
  'Base', 'Emissive', 'Rough', 'Metal', 'EmissiveStrength',
]);
// Params allowed on non-M_Start_Metal entries (translucent/decal/etc.)
const EXTRA_PARAMS = new Set(['Opacity', 'Specular', 'mask']);

function read(p: string) {
  return readFileSync(p, 'utf-8');
}

function palKeys(): string[] {
  const src = read(`${UE}/Tools/_work/build_agent_scene.py`);
  const m = src.match(/PAL = \{([\s\S]*?)\n\}/);
  if (!m) throw new Error('PAL dict not found in build_agent_scene.py');
  return [...m[1].matchAll(/'(\w+)': dict\(/g)].map((x) => x[1]);
}

function rigKeys(): string[] {
  const src = read(`${UE}/Tools/_work/set_active.py`);
  const m = src.match(/YS = \{([^}]+)\}/);
  if (!m) throw new Error('YS dict not found in set_active.py');
  return [...m[1].matchAll(/'(\w+)':/g)].map((x) => x[1]);
}

function json(p: string) {
  return JSON.parse(read(p));
}

describe('start-scenes consistency (V2 materials/lighting files)', () => {
  it('assistant vocabulary is identical across PAL, selection rig and bridge contract', () => {
    const pal = palKeys().sort();
    const rig = rigKeys().sort();
    const want = [...ASSISTANTS].sort();
    expect(pal).toEqual(want);
    expect(rig).toEqual(want);
    // Bridge contract line lives in set_active.py docstring — same vocab.
    const src = read(`${UE}/Tools/_work/set_active.py`);
    expect(src).toContain('arch|mech|alice|codex|forge');
  });

  it('scene-lighting.json covers exactly the five assistant maps', () => {
    const doc = json(`${UE}/SourceArt/materials/scene-lighting.json`);
    expect(Object.keys(doc.scenes).sort()).toEqual([...ASSISTANTS].sort());
    for (const [id, s] of Object.entries<any>(doc.scenes)) {
      expect(s.map, `${id} map`).toMatch(/^\/Game\/Maps\/StartScene/);
      expect(s.ref, `${id} ref`).toContain('AI2_ref/');
      expect(s.lights?.key, `${id} key light`).toBeTruthy();
      expect(s.exposure, `${id} exposure`).toBeTruthy();
    }
  });

  it('every authored value across V2 JSON files is sourced — nothing invented', () => {
    const files = [
      ['scene-lighting.json', 'scenes'],
      ['apply-map.json', 'scenes'],
      ['scene-props.json', 'materials'],
      ['scene-labels.json', 'labels'],
      ['alice-ideal-scene.json', null],
    ] as const;
    const check = (obj: unknown, path: string) => {
      if (obj == null || typeof obj !== 'object') return;
      for (const [k, v] of Object.entries<any>(obj)) {
        // marker/meta keys — their payload IS the annotation, not a fact.
        if (k === 'comment' || k === 'note' || k === 'why' || k === 'was' ||
          k === 'proposed' || k === 'fix' || k === 'mask' || k === 'source' ||
          k === 'action' || k === 'dependsOn' || k === 'rule') continue;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          if ('value' in v || 'tint' in v || 'intensity' in v) {
            const ok = v.source != null || v.proposed != null ||
              v.fix != null || v.note != null;
            expect(ok, `${path}.${k} has no provenance marker`).toBe(true);
          }
          check(v, `${path}.${k}`);
        }
      }
    };
    for (const [file, root] of files) {
      const doc = json(`${UE}/SourceArt/materials/${file}`);
      check(root === null ? doc : doc[root], `${file}:${root ?? '*'}`);
    }
    // apply-map rows without `action` must carry a concrete value+source.
    const am = json(`${UE}/SourceArt/materials/apply-map.json`);
    for (const [id, s] of Object.entries<any>(am.scenes)) {
      for (const [i, e] of s.apply.entries()) {
        if ('action' in e) continue;
        expect(e.source, `${id}.apply[${i}] missing source`).toBeTruthy();
        expect(e.value ?? e.property, `${id}.apply[${i}] empty`).toBeTruthy();
        expect(e.actor ?? e.mi, `${id}.apply[${i}] has no target`).toBeTruthy();
      }
    }
  });

  it('material params stay inside declared contracts (alice + scene props)', () => {
    for (const file of ['alice-materials.json', 'scene-props.json']) {
      const doc = json(`${UE}/SourceArt/materials/${file}`);
      const declared = doc.parents?.M_Start_Metal
        ? new Set<string>(doc.parents.M_Start_Metal.params)
        : M_START_METAL_PARAMS;
      for (const [name, mat] of Object.entries<any>(doc.materials)) {
        if (mat.delegate) continue; // MetaHuman-owned — out of scope
        for (const p of Object.keys(mat.params ?? {})) {
          const ok =
            declared.has(p) || EXTRA_PARAMS.has(p) || mat.parent == null;
          expect(ok, `${file}:${name}.${p} outside M_Start_Metal contract`).toBe(
            true,
          );
        }
      }
    }
  });

  it('NEU personas map every assistant to its own theme (agent-select contract)', () => {
    // personas.ts entries: { id: 'alice', name: 'AGENT-A', themeId: 'alice', ... }
    const src = read(`${ROOT}packages/mock-data/src/personas.ts`);
    const pairs = [
      ...src.matchAll(/id: '(\w+)',\s*name: '[^']+',\s*themeId: '(\w+)'/g),
    ];
    const map = Object.fromEntries(pairs.map((m) => [m[1], m[2]]));
    for (const a of ASSISTANTS) {
      expect(map[a], `persona ${a} missing or themeId ≠ id`).toBe(a);
    }
  });

  it('NEU shell [data-theme] resolves to the same colors the UE export bakes', async () => {
    // VIII.2: the shell applies data-theme=<themeId> and reads --nexus-*;
    // the UE export bakes the same token source. Drift between the two
    // renderers means the shell shows a different assistant color than UE.
    const out = buildTokens(loadTokenSources(), await loadCanonicalThemes());
    const ue = JSON.parse(out.unrealScene).themes as Record<
      string,
      Record<string, string>
    >;
    const cssVar = (p: string) => `--nexus-${p.replace(/\./g, '-')}`;
    // Only tokens emitted as plain hex in CSS — color-mix vars (glow etc.)
    // are baked for UE by the exporter and format-checked elsewhere.
    const COMPARE = [
      'depth.panel.bg', 'depth.surface.bg', 'depth.elevated.bg',
      'text.primary', 'text.secondary',
      'state.online', 'state.paused', 'state.offline',
      'state.warning', 'state.error',
      'border.default', 'border.strong', 'border.active',
    ];
    // CSS cascade: theme blocks carry overrides only; base lives in :root.
    const vars = (block: string) =>
      Object.fromEntries(
        [...block.matchAll(/(--nexus-[\w-]+):\s*([^;]+);/g)].map((m) => [
          m[1],
          m[2].trim(),
        ]),
      );
    const root = vars(
      out.css.match(/:root \{\n([\s\S]*?)\n\}/)![1],
    );
    for (const id of ASSISTANTS) {
      const block = out.css.match(
        new RegExp(`\\[data-theme="${id}"\\] \\{\\n([\\s\\S]*?)\\n\\}`),
      );
      expect(block, `css [data-theme="${id}"] block missing`).toBeTruthy();
      const merged = { ...root, ...vars(block![1]) };
      for (const path of COMPARE) {
        const cssVal = merged[cssVar(path)];
        expect(cssVal, `${id} ${cssVar(path)} missing in css`).toBeTruthy();
        if (cssVal.startsWith('#')) {
          expect(
            cssVal.toUpperCase(),
            `${id}.${path}: shell css ${cssVal} ≠ ue ${ue[id][path]}`,
          ).toBe(ue[id][path].toUpperCase());
        }
      }
    }
  });

  it('wave-XV: rounded window frame geometry is theme-invariant, hairline follows assistant accent', async () => {
    // MAIN/NUE1 reference: 24px rounded corners and identical rail geometry
    // for every assistant; only the hairline palette changes.
    const out = buildTokens(loadTokenSources(), await loadCanonicalThemes());
    const vars = (block: string) =>
      Object.fromEntries(
        [...block.matchAll(/(--nexus-[\w-]+):\s*([^;]+);/g)].map((m) => [
          m[1],
          m[2].trim(),
        ]),
      );
    const root = vars(
      out.css.match(/:root \{\n([\s\S]*?)\n\}/)![1],
    );
    expect(root['--nexus-window-frame-radius']).toBe('24px');
    expect(root['--nexus-window-frame-header-height']).toBe('72px');
    expect(root['--nexus-window-frame-rail-width']).toBe('272px');
    expect(root['--nexus-window-frame-strip-width']).toBe('56px');
    expect(root['--nexus-layout-inspector-min']).toBe('340px');
    const hairlines = new Set<string>();
    for (const id of ['nexus', 'alice', ...ASSISTANTS, 'aurum-dark']) {
      const block = out.css.match(
        new RegExp(`\\[data-theme="${id}"\\] \\{\\n([\\s\\S]*?)\\n\\}`),
      )!;
      const themed = vars(block[1]);
      expect(themed['--nexus-window-frame-radius'], `${id} radius`).toBeUndefined();
      expect(themed['--nexus-window-frame-header-height'], `${id} header height`).toBeUndefined();
      expect(themed['--nexus-window-frame-rail-width'], `${id} rail width`).toBeUndefined();
      expect(themed['--nexus-window-frame-strip-width'], `${id} strip width`).toBeUndefined();
    }
    for (const id of ASSISTANTS) {
      const block = out.css.match(
        new RegExp(`\\[data-theme="${id}"\\] \\{\\n([\\s\\S]*?)\\n\\}`),
      )!;
      const themed = vars(block[1]);
      // Geometry must NOT be re-declared per theme — same frame everywhere.
      expect(themed['--nexus-window-frame-radius'], `${id} redefines radius`)
        .toBeUndefined();
      expect(themed['--nexus-window-frame-header-height'], `${id} redefines header height`)
        .toBeUndefined();
      expect(themed['--nexus-window-frame-rail-width'], `${id} redefines full rail width`)
        .toBeUndefined();
      expect(themed['--nexus-window-frame-strip-width'], `${id} redefines strip width`)
        .toBeUndefined();
      expect(themed['--nexus-window-frame-hairline'], `${id} hairline missing`)
        .toMatch(/^#[0-9A-Fa-f]{6}$/);
      hairlines.add(themed['--nexus-window-frame-hairline']);
    }
    // Five assistants → five distinct accent hairlines.
    expect(hairlines.size).toBe(5);
  });

  it('wave-IX IX.2: hero tokens are pinned — identical on every theme', async () => {
    // The MAIN hero is authored art: its palette must resolve to the same
    // values under all themes (no [data-theme] overrides for hero.*).
    const out = buildTokens(loadTokenSources(), await loadCanonicalThemes());
    const rootBlock = out.css.match(/:root \{\n([\s\S]*?)\n\}/)![1];
    expect(rootBlock).toContain('--nexus-hero-gold: #C9A45C');
    expect(rootBlock).toContain('--nexus-hero-substrate: #0F0F13');
    for (const id of [...ASSISTANTS, 'nexus']) {
      const block = out.css.match(
        new RegExp(`\\[data-theme="${id}"\\] \\{\\n([\\s\\S]*?)\\n\\}`),
      );
      if (!block) continue;
      expect(block[1], `${id} overrides pinned hero.*`).not.toContain(
        '--nexus-hero-',
      );
    }
  });

  it('non-PAL intensities are honestly marked proposed, not passed off as facts', () => {
    const doc = json(`${UE}/SourceArt/materials/scene-lighting.json`);
    // arch & forge have no intensity values in PAL — they must be proposed.
    for (const id of ['arch', 'forge']) {
      const key = doc.scenes[id].lights.key;
      expect(key.proposed, `${id}.key must be proposed (PAL lacks intensity)`).toBeTruthy();
    }
    // alice/codex/mech carry real PAL intensities — marked pal, never proposed.
    for (const id of ['alice', 'codex', 'mech']) {
      const key = doc.scenes[id].lights.key;
      expect(key.source, `${id}.key intensity must come from PAL`).toBe('pal');
    }
  });
});
