// @vitest-environment node
/**
 * Раскладка RSC-payload статического экспорта (Next 16.4.0).
 *
 * Экспорт кладёт payload страничного сегмента как КАТАЛОГ
 * `<route>/__next.<route>/__PAGE__.txt`, а клиентский роутер при prefetch
 * сегмента запрашивает ФАЙЛ `<route>/__next.<route>.__PAGE__.txt` — имена
 * расходятся, prefetch уходит в 404 на каждой ссылке. Шаг сборки
 * `scripts/next-export-rsc-aliases.mjs` дописывает плоские алиасы.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureRscAliases } from '../../../../scripts/next-export-rsc-aliases.mjs';

function fakeExport(): string {
  const root = mkdtempSync(join(tmpdir(), 'nexus-export-'));
  mkdirSync(join(root, 'settings', '__next.settings'), { recursive: true });
  writeFileSync(join(root, 'settings', '__next.settings', '__PAGE__.txt'), 'FLIGHT-SETTINGS');
  mkdirSync(join(root, 'agents', '__next.agents'), { recursive: true });
  writeFileSync(join(root, 'agents', '__next.agents', '__PAGE__.txt'), 'FLIGHT-AGENTS');
  return root;
}

describe('next-export-rsc-aliases', () => {
  it('дописывает плоский алиас рядом с каталогом сегмента (байт в байт)', () => {
    const root = fakeExport();
    const created = ensureRscAliases(root).sort();
    expect(created).toEqual([
      'agents/__next.agents.__PAGE__.txt',
      'settings/__next.settings.__PAGE__.txt',
    ]);
    expect(readFileSync(join(root, 'settings', '__next.settings.__PAGE__.txt'), 'utf8')).toBe('FLIGHT-SETTINGS');
  });

  it('идемпотентен: второй прогон ничего не меняет', () => {
    const root = fakeExport();
    ensureRscAliases(root);
    expect(ensureRscAliases(root)).toEqual([]);
  });

  it('отсутствующий или пустой экспорт — без алиасов и без исключения', () => {
    expect(ensureRscAliases(join(tmpdir(), 'nexus-export-missing-'))).toEqual([]);
    const empty = mkdtempSync(join(tmpdir(), 'nexus-export-empty-'));
    expect(ensureRscAliases(empty)).toEqual([]);
  });

  it('каталог сегмента без __PAGE__.txt не трогает', () => {
    const root = mkdtempSync(join(tmpdir(), 'nexus-export-'));
    mkdirSync(join(root, 'slides', '__next.slides'), { recursive: true });
    expect(ensureRscAliases(root)).toEqual([]);
    expect(existsSync(join(root, 'slides', '__next.slides.__PAGE__.txt'))).toBe(false);
  });
});
