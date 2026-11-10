// @vitest-environment node
/**
 * wave-XIII W4: перфоманс-бюджет NEU.
 *
 * Всегда (source-инварианты):
 *  - нет прямых импортов three/@react-three/@nexus/three в приложении —
 *    3D живёт в storybook, приложение не должно его тянуть;
 *  - каждый <img> в product-коде несёт явный loading="lazy"|"eager" —
 *    решение зафиксировано, а не оставлено дефолту.
 *
 * Артефактная часть (когда есть out/ — после `next build`):
 *  - общий бандл (маршрут /_not-found, чистый каркас) ≤ sharedMaxKb;
 *  - любой маршрут ≤ routeMaxKb и ≤ baseline + routeDeltaMaxKb;
 *  - public/art: каждый файл ≤ artFileMaxKb; webp считаются РЕКУРСИВНО —
 *    всё, кроме art/nav/**, в сумму ≤ artTotalMaxKb, а art/nav/** в свою
 *    отдельную квоту ≤ artNavMaxKb (согласование владельца 2026-10-30:
 *    раньше подпапка просто выпадала из подсчёта);
 *    PNG в этих бюджетах не участвуют: гейт ограничен форматом webp, объём
 *    PNG проговорён в public/art/MANIFEST.md, а не прятается за ним.
 * Бюджеты — perf-budgets.json (секция staticExport), числа сверены со сборкой 16.10.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const APP = join(__dirname, '..', '..');
const REPO = join(APP, '..', '..');
const OUT = join(APP, 'out');
const BUDGET = (
  JSON.parse(readFileSync(join(REPO, 'perf-budgets.json'), 'utf-8')) as {
    staticExport: {
      sharedMaxKb: number;
      routeMaxKb: number;
      routeDeltaMaxKb: number;
      artFileMaxKb: number;
      artTotalMaxKb: number;
      artNavMaxKb: number;
    };
  }
).staticExport;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const SRC = join(APP, 'src');
const sources = [...walk(SRC)].filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts'));

describe('перфоманс-бюджет: инварианты исходников', () => {
  it('в приложении нет импортов three/3D-рантайма', () => {
    const offenders = sources.filter((f) => {
      const s = readFileSync(f, 'utf-8');
      return /from\s+['"](three|@react-three\/|@nexus\/three)/.test(s);
    });
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it('каждый <img> в product-коде несёт явный loading', () => {
    const offenders: string[] = [];
    for (const f of sources) {
      if (f.endsWith('.test.tsx') || f.endsWith('.test.ts')) continue;
      const s = readFileSync(f, 'utf-8');
      for (const m of s.matchAll(/<img\b[^>]*>/gs)) {
        if (!/loading=/.test(m[0])) {
          offenders.push(`${relative(SRC, f)}: ${m[0].slice(0, 80)}…`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('перфоманс-бюджет: артефакты сборки', () => {
  const built = existsSync(join(OUT, '_next'));

  it.skipIf(!built)('размер маршрутов в пределах бюджета', () => {
    const re = /(?:src|href)="(\/_next\/[^"]+\.js)"/g;
    const routes = new Map<string, { bytes: number; files: number }>();
    for (const f of walk(OUT)) {
      if (!f.endsWith('.html')) continue;
      let route = '/' + relative(OUT, f).replace(/\\/g, '/').replace(/\.html$/, '');
      if (route.endsWith('/index')) route = route.slice(0, -6) || '/';
      if (routes.has(route)) continue;
      const html = readFileSync(f, 'utf-8');
      const refs = new Set([...html.matchAll(re)].map((m) => m[1]));
      let bytes = 0;
      for (const r of refs) {
        const p = join(OUT, r);
        if (existsSync(p)) bytes += statSync(p).size;
      }
      routes.set(route, { bytes, files: refs.size });
    }
    const baseline = routes.get('/_not-found')!.bytes / 1024;
    expect(baseline).toBeLessThanOrEqual(BUDGET.sharedMaxKb);
    const worst: string[] = [];
    for (const [route, { bytes }] of routes) {
      const kb = bytes / 1024;
      if (kb > BUDGET.routeMaxKb || kb - baseline > BUDGET.routeDeltaMaxKb)
        worst.push(`${route}: ${kb.toFixed(1)} KB`);
    }
    expect(worst).toEqual([]);
  });

  it('арт public/art в пределах бюджета', () => {
    const dir = join(APP, 'public', 'art');
    let total = 0;
    let navTotal = 0;
    const over: string[] = [];
    for (const f of walk(dir)) {
      if (!f.endsWith('.webp')) continue;
      const rel = relative(dir, f).replace(/\\/g, '/');
      const kb = statSync(f).size / 1024;
      if (kb > BUDGET.artFileMaxKb) over.push(`${rel}: ${kb.toFixed(0)} KB`);
      if (rel.startsWith('nav/')) navTotal += kb;
      else total += kb;
    }
    expect(over).toEqual([]);
    expect(total).toBeLessThanOrEqual(BUDGET.artTotalMaxKb);
    expect(navTotal).toBeLessThanOrEqual(BUDGET.artNavMaxKb);
  });
});
