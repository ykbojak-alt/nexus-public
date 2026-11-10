// @vitest-environment node
/**
 * Путь доставки в AI-2 хост: `scripts/sync-ai2-static.mjs`.
 *
 * Копирует статический экспорт в `<target>/ai2/server/static/nexus`,
 * перебазирует `/_next/` → `/_nexus/_next/`, дописывает плоские RSC-алиасы
 * (иначе prefetch сегмента уходит в 404) и пишет манифест целостности —
 * алиасы обязаны попасть в манифест, иначе хост посчитает их «untracked».
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncAi2Static } from '../../../../scripts/sync-ai2-static.mjs';

function fakeHost(): string {
  const target = mkdtempSync(join(tmpdir(), 'nexus-host-'));
  const staticDir = join(target, 'ai2', 'server', 'static');
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(staticDir, 'index.html'), '<html>legacy</html>');
  return target;
}

function fakeExport(): string {
  const source = mkdtempSync(join(tmpdir(), 'nexus-export-'));
  writeFileSync(join(source, 'index.html'), '<html>nexus</html>');
  mkdirSync(join(source, '_next', 'static', 'chunks'), { recursive: true });
  writeFileSync(join(source, '_next', 'static', 'chunks', 'a.js'), 'const u="/_next/static/chunks/a.js";');
  mkdirSync(join(source, 'settings', '__next.settings'), { recursive: true });
  writeFileSync(join(source, 'settings', '__next.settings', '__PAGE__.txt'), 'FLIGHT /_next/static/chunks/a.js');
  return source;
}

describe('sync-ai2-static (путь доставки в хост)', () => {
  it('копирует экспорт, перебазирует /_next/ и пишет манифест', async () => {
    const target = fakeHost();
    const source = fakeExport();
    const result = await syncAi2Static({ target, source });
    expect(existsSync(join(result.dest, 'index.html'))).toBe(true);
    expect(readFileSync(join(result.dest, '_next', 'static', 'chunks', 'a.js'), 'utf8'))
      .toContain('/_nexus/_next/');
    const manifest = JSON.parse(readFileSync(join(result.dest, 'manifest.json'), 'utf8'));
    expect(manifest.version).toBe(1);
    expect(manifest.files.length).toBeGreaterThan(0);
  });

  it('дописывает плоский RSC-алиас и вносит его в манифест (иначе хост считает untracked)', async () => {
    const target = fakeHost();
    const source = fakeExport();
    const result = await syncAi2Static({ target, source });
    const alias = join(result.dest, 'settings', '__next.settings.__PAGE__.txt');
    expect(existsSync(alias)).toBe(true);
    // байты совпадают с исходным payload и тоже перебазированы
    expect(readFileSync(alias, 'utf8')).toBe('FLIGHT /_nexus/_next/static/chunks/a.js');
    const manifest = JSON.parse(readFileSync(join(result.dest, 'manifest.json'), 'utf8'));
    expect(manifest.files.some((f: { path: string }) => f.path === 'settings/__next.settings.__PAGE__.txt')).toBe(true);
  });

  it('отказывается писать в незнакомое дерево (нет legacy index.html)', async () => {
    const target = mkdtempSync(join(tmpdir(), 'nexus-not-host-'));
    const source = fakeExport();
    await expect(syncAi2Static({ target, source })).rejects.toThrow(/does not look like the AI-2 repository/);
  });
});
