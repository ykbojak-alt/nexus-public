import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPORTS = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).exports as Record<string, string>;
const SIZE_LIMIT_GZIP_BYTES = 12 * 1024;
const ENTRIES = [
  './accessibility/scroll-region',
  './accessibility/list',
  './inputs/listbox',
  './navigation/tabs',
  './navigation/tabs-primitives',
  './surfaces/modal',
  './surfaces/drawer',
  './actions/action-menu',
  './surfaces/tooltip',
  './charts/donut-chart',
  './charts/flow-steps',
  './motion',
  './compaction',
  './panel-header',
];

describe('@nexus/ui subpath gzip budget', () => {
  it('keeps reviewed lazy-entry JS+CSS below the per-entry gzip ceiling', async () => {
    const localRequire = createRequire(import.meta.url);
    const vitestEntry = localRequire.resolve('vitest');
    const esbuildEntry = createRequire(vitestEntry).resolve('esbuild');
    const { build } = await import(pathToFileURL(esbuildEntry).href);
    const results: string[] = [];

    for (const name of ENTRIES) {
      const target = EXPORTS[name];
      expect(target, `${name} is missing from package exports`).toBeTruthy();
      const entry = resolve(PACKAGE_ROOT, target.replace(/^\.\/src\//, 'src/'));
      const output = await build({
        entryPoints: [entry],
        outfile: join(PACKAGE_ROOT, '.size-contract', `${name.slice(2).replaceAll('/', '-')}.js`),
        bundle: true,
        minify: true,
        format: 'esm',
        platform: 'browser',
        write: false,
        external: ['react', 'react-dom', 'react/jsx-runtime', '@nexus/themes', '@nexus/tokens'],
        loader: { '.module.css': 'local-css', '.css': 'css' },
      });
      const outputFiles = output.outputFiles as Array<{ path: string; contents: Uint8Array }>;
      const jsGzipBytes = outputFiles
        .filter((file) => file.path.endsWith('.js'))
        .reduce((sum, file) => sum + gzipSync(file.contents).length, 0);
      const cssGzipBytes = outputFiles
        .filter((file) => file.path.endsWith('.css'))
        .reduce((sum, file) => sum + gzipSync(file.contents).length, 0);
      const total = jsGzipBytes + cssGzipBytes;
      results.push(`${name}=${total}`);
      expect(total, `${name} gzip JS+CSS (${jsGzipBytes}+${cssGzipBytes})`)
        .toBeLessThan(SIZE_LIMIT_GZIP_BYTES);
    }

    console.info(`@nexus/ui subpath gzip (JS+CSS bytes): ${results.join(', ')}`);
  }, 60_000);
});
