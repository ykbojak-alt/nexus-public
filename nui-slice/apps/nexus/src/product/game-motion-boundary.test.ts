// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// W4-1007: gameMotion / GAME_MOTION_* — только для игровых экранов.
// UI-компоненты берут DURATION_MS-пресеты или своё семейство; в CSS
// var(--nexus-motion-*) допустим лишь для осознанных authored-моментов
// (ambient loop / entrance / emphasis) — не для interaction feedback.
const SRC = fileURLToPath(new URL('../', import.meta.url)); // apps/nexus/src
const GAME_DIRS = /product[\\/](durak|chess|games|oracle)[\\/]/;
// Shared shell is outside a game subdirectory but owns the game motion API.
const GAME_MOTION_FILES = new Set(['product/game-shell.tsx']);

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'out']);
const collect = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return collect(p);
    return /\.tsx?$/.test(name) && !/\.test\.|\.stories\./.test(name) ? [p] : [];
  });

describe('game-motion boundary (W4-1007)', () => {
  it('registers the shared GameShell as an explicit game-motion boundary file', () => {
    const rel = 'product/game-shell.tsx';
    const source = readFileSync(join(SRC, rel), 'utf8');

    expect(GAME_MOTION_FILES.has(rel)).toBe(true);
    expect(source).toMatch(/GameMotionVerb/);
    expect(source).toMatch(/GameMotionEasing/);
    expect(source).toContain("'--game-motion-verb'");
    expect(source).toContain("'--game-motion-easing'");
  });

  it('gameMotion/GAME_MOTION и типы GameMotion не импортируются вне game-области', () => {
    const offenders: string[] = [];
    for (const file of collect(SRC)) {
      const rel = relative(SRC, file);
      if (GAME_DIRS.test(file) || GAME_MOTION_FILES.has(rel.replace(/\\/g, '/'))) continue;
      const src = readFileSync(file, 'utf8');
      if (/\bgameMotion\b|\bGameMotion(?:Verb|Easing)\b|\bGAME_MOTION_(MS|EASING)\b/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  }, 60_000);

  it('CSS: --nexus-motion-* вне game-модулей — только в отревьюенном allowlist', () => {
    // UI-файлы, которым разрешены motion.* токены — каждый отревьюен как
    // authored-момент (ambient loop / entrance / emphasis), W4-1007.
    // Новый файл в списке = ревью границы, не молчаливое заимствование.
    const allowlist = new Set([
      'app-shell.module.css', // .slide ambient fade → motion.seek
      'screens/home.module.css', // chatPanelEnter / column resize → promote/fly
      'screens/screens.module.css', // skeleton/trace/voice/mic ambient + reveal/snappy emphasis
      'screens/context-usage-indicator.module.css', // compaction pulse → motion.seek (W4-1002)
    ]);
    const offenders: string[] = [];
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        if (SKIP_DIRS.has(name)) return [];
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return walk(p);
        return name.endsWith('.module.css') ? [p] : [];
      });
    for (const file of walk(SRC)) {
      if (GAME_DIRS.test(file)) continue;
      if (!readFileSync(file, 'utf8').includes('--nexus-motion-')) continue;
      const rel = relative(SRC, file).replace(/\\/g, '/').replace(/^product\//, '');
      if (!allowlist.has(rel)) offenders.push(rel);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
