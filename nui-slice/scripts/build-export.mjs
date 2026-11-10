/**
 * Экспортная сборка nexus (`output: 'export'`).
 *
 * Next не умеет статический экспорт с route handlers в app/api — прокси
 * /api/craft живёт только в dev/standalone. Поэтому route-файлы на время
 * сборки переименовываются в *.export-parked и гарантированно возвращаются
 * (finally), даже если билд упал. Переименование на уровне файлов —
 * каталог app/api занят dev-server/watch, rename папки даёт EPERM.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'apps', 'nexus', 'src', 'app', 'api');

/** Все route.* внутри app/api — паркуем/разпаркуем. */
function routeFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...routeFiles(p));
    else if (/^route\..*[jt]sx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const parked = [];
for (const f of routeFiles(apiDir)) {
  const to = f + '.export-parked';
  fs.renameSync(f, to);
  parked.push([f, to]);
}

let status = 1;
try {
  const r = spawnSync('npx', ['next', 'build', 'apps/nexus'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  status = r.status ?? 1;
  if (status === 0) {
    const a = spawnSync('node', ['scripts/next-export-rsc-aliases.mjs'], {
      cwd: root,
      stdio: 'inherit',
      shell: true,
    });
    status = a.status ?? 1;
  }
} finally {
  for (const [from, to] of parked) {
    if (fs.existsSync(to)) fs.renameSync(to, from);
  }
}
process.exit(status);
