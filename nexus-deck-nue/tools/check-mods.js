#!/usr/bin/env node
'use strict';

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modsRoot = join(repoRoot, 'defaults', 'mods');
const args = process.argv.slice(2);
const strictManifest = args.includes('--strict-manifest');
const unknownArgs = args.filter((arg) => arg !== '--strict-manifest');

if (unknownArgs.length > 0) {
  console.error(`ERROR: unknown argument(s): ${unknownArgs.join(', ')}`);
  console.error('Usage: node tools/check-mods.js [--strict-manifest]');
  process.exit(2);
}

if (!existsSync(modsRoot)) {
  console.error(`ERROR: mods directory not found: ${modsRoot}`);
  process.exit(1);
}

const mods = readdirSync(modsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({ name: entry.name, dir: join(modsRoot, entry.name) }))
  .sort((left, right) => left.name.localeCompare(right.name, 'en'));

if (mods.length === 0) {
  console.error(`ERROR: no mod directories found under ${modsRoot}`);
  process.exit(1);
}

function validateManifest(mod) {
  const path = join(mod.dir, 'mod.json');
  if (!existsSync(path)) return 'missing mod.json';

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return `invalid JSON (${error.message})`;
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return 'manifest must be a JSON object';
  }

  if (strictManifest) {
    const missingFields = ['name', 'version', 'entry'].filter((field) => manifest[field] === undefined);
    if (missingFields.length > 0) {
      return `strict manifest requires fields: ${missingFields.map((field) => `"${field}"`).join(', ')}`;
    }
  }

  // Current Deck mod.json contract: `place` is present in every shipped
  // manifest; name/version/entry are not required by the loader. Validate
  // those identity fields when supplied. --strict-manifest requires all three
  // as a migration/preflight check; the runtime loader still does not consume
  // them and always discovers main.js directly.
  if (typeof manifest.place !== 'string' || !manifest.place.trim()) {
    return 'required field "place" must be a non-empty string';
  }
  if (manifest.name !== undefined &&
      (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name !== mod.name)) {
    return `optional field "name" must be the mod directory name (${mod.name})`;
  }
  if (manifest.version !== undefined &&
      (typeof manifest.version !== 'string' || !manifest.version.trim())) {
    return 'optional field "version" must be a non-empty string';
  }
  if (manifest.entry !== undefined &&
      (typeof manifest.entry !== 'string' || !manifest.entry.trim())) {
    return 'optional field "entry" must be a non-empty relative path';
  }

  const entry = manifest.entry ?? 'main.js';
  if (isAbsolute(entry)) return 'entry must stay inside the mod directory';
  const entryPath = resolve(mod.dir, entry);
  const relativeEntry = relative(mod.dir, entryPath);
  if (relativeEntry === '..' || relativeEntry.startsWith(`..${sep}`) || isAbsolute(relativeEntry)) {
    return 'entry must stay inside the mod directory';
  }
  if (!existsSync(entryPath) || !statSync(entryPath).isFile()) return `entry file not found (${entry})`;

  if (manifest.title !== undefined && typeof manifest.title !== 'string') {
    return 'optional field "title" must be a string';
  }
  if (manifest.size !== undefined &&
      (typeof manifest.size !== 'number' || !Number.isFinite(manifest.size) || manifest.size <= 0)) {
    return 'optional field "size" must be a positive finite number';
  }
  if (manifest.focusable !== undefined && typeof manifest.focusable !== 'boolean') {
    return 'optional field "focusable" must be a boolean';
  }
  if (manifest.overlay !== undefined &&
      (!manifest.overlay || typeof manifest.overlay !== 'object' || Array.isArray(manifest.overlay))) {
    return 'optional field "overlay" must be an object';
  }

  return null;
}

let syntaxPassed = 0;
let syntaxFailed = 0;
let manifestPassed = 0;
let manifestFailed = 0;

for (const mod of mods) {
  const file = join(mod.dir, 'main.js');
  const relativePath = relative(repoRoot, file).replaceAll('\\', '/');
  if (!existsSync(file)) {
    syntaxFailed += 1;
    console.error(`FAIL syntax ${relativePath} (missing main.js)`);
  } else {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    const status = result.status === null ? 'no exit code' : `exit ${result.status}`;

    if (result.status === 0 && !result.error) {
      syntaxPassed += 1;
      console.log(`PASS syntax ${relativePath} (${status})`);
    } else {
      syntaxFailed += 1;
      console.error(`FAIL syntax ${relativePath} (${status})`);
      if (result.error) console.error(result.error.message);
      if (result.stdout) process.stderr.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
  }

  const manifestError = validateManifest(mod);
  if (manifestError) {
    manifestFailed += 1;
    console.error(`FAIL manifest ${relative(modsRoot, join(mod.dir, 'mod.json')).replaceAll('\\', '/')} (${manifestError})`);
  } else {
    manifestPassed += 1;
    console.log(`PASS manifest ${relative(modsRoot, join(mod.dir, 'mod.json')).replaceAll('\\', '/')}`);
  }
}

const failed = syntaxFailed + manifestFailed;
const manifestMode = strictManifest ? 'strict' : 'compatible';
console.log(`SUMMARY mode=${manifestMode} mods=${mods.length} syntax_passed=${syntaxPassed} syntax_failed=${syntaxFailed} manifest_passed=${manifestPassed} manifest_failed=${manifestFailed} failed=${failed}`);
process.exitCode = failed === 0 ? 0 : 1;
