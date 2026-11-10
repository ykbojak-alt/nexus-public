#!/usr/bin/env node
/**
 * sync:ai2-static (Task 17) — copy the static Next export into the AI-2
 * desktop host package.
 *
 *   pnpm sync:ai2-static -- --target D:\ai2_pilot\ai2 [--source apps/nexus/out]
 *
 * Safety contract:
 * - target must be an AI-2 repo: <target>/ai2/server/static/index.html
 *   (the legacy UI) must exist — we never write into an unknown tree;
 * - the legacy index.html is never modified;
 * - the whole static/nexus/ dir is replaced atomically-ish: stale hashed
 *   assets from previous builds do not linger;
 * - source must look like a Next export (contains index.html).
 *
 * Asset rebase: the export references `/_next/…` URLs. The host serves the
 * bundle under /_nexus (Task 18), so copied text files have every `/_next/`
 * literal rewritten to `/_nexus/_next/` — including the Turbopack publicPath
 * constant in runtime chunks and flight-payload references. The source `out/`
 * tree is left untouched for normal browser use.
 * (Next's own path-form assetPrefix is used instead of env config because
 * Next 16.4.0 crashes with it on Windows — TypeError "Missing parameter name
 * at 2" on both Turbopack and webpack builds.)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRscAliases } from './next-export-rsc-aliases.mjs';

const DEFAULT_SOURCE = 'apps/nexus/out';
const NEXUS_DIR = join('ai2', 'server', 'static', 'nexus');
const LEGACY_INDEX = join('ai2', 'server', 'static', 'index.html');
const ASSET_PREFIX = process.env.NEXUS_ASSET_PREFIX || '/_nexus';
const TEXT_EXT = new Set(['.html', '.txt', '.js', '.mjs', '.css', '.json', '.map', '.svg']);

function fail(message) {
  throw new Error(`sync-ai2-static: ${message}`);
}

function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else if (entry.isFile()) copyFileSync(s, d);
  }
}

export function validateTarget(target) {
  const abs = resolve(target);
  if (!existsSync(abs)) {
    fail(`AI-2 target does not exist: ${abs}`);
  }
  // Legacy UI presence is the fingerprint of the real AI-2 static tree.
  if (!existsSync(join(abs, LEGACY_INDEX))) {
    fail(`AI-2 target must contain ${LEGACY_INDEX.replaceAll('\\', '/')} — ` +
      `${abs} does not look like the AI-2 repository`);
  }
  return abs;
}

export function validateSource(source) {
  const abs = resolve(source);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    fail(`export directory does not exist: ${abs} (run "pnpm nx build nexus" first)`);
  }
  if (!existsSync(join(abs, 'index.html'))) {
    fail(`export directory has no index.html: ${abs} — is it a Next static export?`);
  }
  return abs;
}

/** Rebase `/_next/` asset URLs to the host mount point inside copied files. */
function rebaseAssetUrls(dir, prefix) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      rebaseAssetUrls(p, prefix);
    } else if (entry.isFile() && TEXT_EXT.has(extname(entry.name).toLowerCase())) {
      const text = readFileSync(p, 'utf8');
      const rebased = text.replaceAll('/_next/', `${prefix}/_next/`);
      if (rebased !== text) writeFileSync(p, rebased);
    }
  }
}

/** Copy the export into <target>/ai2/server/static/nexus (validated). */
export async function syncAi2Static({ target, source = DEFAULT_SOURCE } = {}) {
  const targetAbs = validateTarget(target ?? fail('--target <AI-2 repo path> is required'));
  const sourceAbs = validateSource(source);
  const dest = join(targetAbs, NEXUS_DIR);
  // Replace wholesale: Next assets are content-hashed, stale files must go.
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  copyTree(sourceAbs, dest);
  rebaseAssetUrls(dest, ASSET_PREFIX);
  // RSC-payload сегмента: клиент запрашивает <route>/__next.<route>.__PAGE__.txt,
  // а экспорт кладёт каталог <route>/__next.<route>/__PAGE__.txt — дописываем
  // плоские алиасы и здесь, чтобы хост, синканный со старым экспортом, тоже
  // отдавал prefetch без 404. До манифеста: алиасы должны попасть в него.
  const rscAliases = ensureRscAliases(dest);
  writeManifest(dest);
  const files = countFiles(dest);
  return { target: targetAbs, source: sourceAbs, dest, files, rscAliases };
}

/**
 * Deterministic bundle manifest (roadmap D9): sorted [{path, bytes, sha256}]
 * of the copied + rebased bytes — no wall clock, no platform separators, so
 * identical exports produce identical manifests on any machine. Lets the
 * host, packaging and QA verify integrity without diffing trees.
 */
function writeManifest(dest) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) files.push(p);
    }
  };
  walk(dest);
  const rows = files.sort().map((p) => {
    const bytes = readFileSync(p);
    return {
      path: dest === p ? p : p.slice(dest.length + 1).split(sep).join('/'),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });
  const manifest = { version: 1, files: rows };
  writeFileSync(join(dest, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
  }
  return n;
}

function parseArgs(argv) {
  const args = { target: undefined, source: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') args.target = argv[++i];
    else if (argv[i] === '--source') args.source = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: sync-ai2-static --target <AI-2 repo> [--source <export dir>]');
      process.exit(0);
    }
  }
  return args;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  try {
    const result = await syncAi2Static(parseArgs(process.argv.slice(2)));
    console.log(`synced ${result.files} files → ${result.dest}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
