import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error — .mjs has no type declarations
import { syncAi2Static } from './sync-ai2-static.mjs';

/** Fixture tree helpers — the AI-2 side layout sync validates against. */
const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'nexus-sync-'));
  dirs.push(d);
  return d;
}

function makeAi2Target(): string {
  const target = tempDir();
  mkdirSync(join(target, 'ai2/server/static'), { recursive: true });
  writeFileSync(join(target, 'ai2/server/static/index.html'), '<!doctype html>legacy ui');
  return target;
}

function makeExport(): string {
  const source = tempDir();
  mkdirSync(join(source, '_next/static/chunks'), { recursive: true });
  writeFileSync(join(source, 'index.html'),
    '<!doctype html><link href="/_next/static/app.css" rel="stylesheet"/>' +
    '<script src="/_next/static/chunks/app.js"></script>nexus');
  writeFileSync(join(source, '_next/static/chunks/app.js'),
    'const CHUNK_BASE_PATH="/_next/";console.log(1)');
  writeFileSync(join(source, '_next/static/app.css'), ':root{}');
  writeFileSync(join(source, 'index.txt'), 'self.__next_f=["/_next/static/chunks/app.js"]');
  return source;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('syncAi2Static (Task 17)', () => {
  it('refuses a target without ai2/server/static', async () => {
    const wrong = tempDir();
    await expect(syncAi2Static({ target: wrong, source: makeExport() }))
      .rejects.toThrow(/AI-2 target/i);
  });

  it('refuses when the legacy index.html is missing (wrong repo)', async () => {
    const target = tempDir();
    mkdirSync(join(target, 'ai2/server/static'), { recursive: true });
    // no legacy index.html — not the AI-2 static tree we expect
    await expect(syncAi2Static({ target, source: makeExport() }))
      .rejects.toThrow(/AI-2 target/i);
  });

  it('refuses a source export without index.html', async () => {
    const target = makeAi2Target();
    const source = tempDir();
    await expect(syncAi2Static({ target, source })).rejects.toThrow(/index\.html|export/i);
  });

  it('copies index and hashed Next assets into static/nexus', async () => {
    const target = makeAi2Target();
    const source = makeExport();
    await syncAi2Static({ target, source });
    const nexus = join(target, 'ai2/server/static/nexus');
    expect(existsSync(join(nexus, 'index.html'))).toBe(true);
    expect(existsSync(join(nexus, '_next/static/chunks/app.js'))).toBe(true);
    expect(existsSync(join(nexus, '_next/static/app.css'))).toBe(true);
  });

  it('never touches the legacy index.html', async () => {
    const target = makeAi2Target();
    const legacyPath = join(target, 'ai2/server/static/index.html');
    const before = readFileSync(legacyPath, 'utf8');
    await syncAi2Static({ target, source: makeExport() });
    expect(readFileSync(legacyPath, 'utf8')).toBe(before);
  });

  it('replaces stale nexus bundle on re-sync (idempotent)', async () => {
    const target = makeAi2Target();
    const s1 = makeExport();
    await syncAi2Static({ target, source: s1 });
    // stale asset from a previous build must disappear
    const stale = join(target, 'ai2/server/static/nexus/_next/static/stale.js');
    mkdirSync(join(stale, '..'), { recursive: true });
    writeFileSync(stale, 'old');
    const s2 = makeExport();
    await syncAi2Static({ target, source: s2 });
    const nexus = join(target, 'ai2/server/static/nexus');
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(join(nexus, 'index.html'))).toBe(true);
    expect(readdirSync(nexus).sort()).toEqual(['_next', 'index.html', 'index.txt', 'manifest.json']);
  });

  it('writes a deterministic manifest (sorted paths, sha256 of rebased bytes)', async () => {
    const target = makeAi2Target();
    const source = makeExport();
    await syncAi2Static({ target, source });
    const nexus = join(target, 'ai2/server/static/nexus');
    const manifest = JSON.parse(readFileSync(join(nexus, 'manifest.json'), 'utf8'));
    expect(manifest.version).toBe(1);
    const paths = manifest.files.map((f: { path: string }) => f.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toContain('index.html');
    expect(paths).not.toContain('manifest.json'); // manifest never lists itself
    for (const f of manifest.files) {
      expect(f.path).not.toContain('\\'); // posix separators, machine-agnostic
      const bytes = readFileSync(join(nexus, f.path));
      expect(f.bytes).toBe(bytes.length);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    // identical source → byte-identical manifest (no wall clock inside)
    const target2 = makeAi2Target();
    await syncAi2Static({ target: target2, source });
    expect(readFileSync(join(target2, 'ai2/server/static/nexus/manifest.json'), 'utf8'))
      .toBe(readFileSync(join(nexus, 'manifest.json'), 'utf8'));
  });

  it('rebases /_next/ asset URLs to the host mount in copied text files', async () => {
    const target = makeAi2Target();
    const source = makeExport();
    await syncAi2Static({ target, source });
    const nexus = join(target, 'ai2/server/static/nexus');
    const html = readFileSync(join(nexus, 'index.html'), 'utf8');
    const js = readFileSync(join(nexus, '_next/static/chunks/app.js'), 'utf8');
    const txt = readFileSync(join(nexus, 'index.txt'), 'utf8');
    for (const text of [html, js, txt]) {
      expect(text).toContain('/_nexus/_next/');
      expect(text).not.toContain('"/_next/');   // quoted asset references
      expect(text).not.toContain('=/_next/');   // html attribute references
    }
    // source export stays pristine for normal browser use
    expect(readFileSync(join(source, 'index.html'), 'utf8')).toContain('"/_next/static/chunks/app.js"');
  });
});
