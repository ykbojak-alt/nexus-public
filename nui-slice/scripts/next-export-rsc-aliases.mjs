#!/usr/bin/env node
/**
 * next-export-rsc-aliases — починка раскладки RSC-payload статического экспорта.
 *
 * Next 16.4.0 (`output: 'export'`) раскладывает payload страничного сегмента
 * как КАТАЛОГ: `<route>/__next.<route>/__PAGE__.txt`, а клиентский роутер при
 * prefetch сегмента запрашивает ФАЙЛ: `<route>/__next.<route>.__PAGE__.txt`.
 * Имена расходятся — prefetch уходит в 404 на каждой ссылке, кэш роутера не
 * прогревается (первый переход на маршрут всегда платит полный RSC-запрос),
 * а лог хоста засоряется 404-ми.
 *
 * Проверено на экспорте 20.10 (браузер, статический экспорт):
 *   404 → /settings/__next.settings.__PAGE__.txt?_rsc=…
 *   404 → /agents/__next.agents.__PAGE__.txt?_rsc=…  (и ещё 5 маршрутов)
 *   экспорт при этом содержит settings/__next.settings/__PAGE__.txt
 *
 * Навигация при этом не сломана: payload страницы берётся из `<route>.txt`,
 * который в раскладке есть. Скрипт дописывает недостающие плоские алиасы
 * (байт в байт) — prefetch отдаёт 200. Идемпотентен, безопасен: при любой
 * нештатной ситуации печатает предупреждение и не роняет сборку.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const DEFAULT_EXPORT = 'apps/nexus/out';

/**
 * Для каждого каталога `<route>/__next.<name>/` с файлом `__PAGE__.txt`
 * создаёт рядом плоский алиас `<route>/__next.<name>.__PAGE__.txt`.
 * @returns {string[]} созданные пути (относительно корня экспорта)
 */
export function ensureRscAliases(exportDir) {
  const root = resolve(exportDir);
  const created = [];
  if (!existsSync(root)) return created;

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      if (entry.name.startsWith('__next.')) {
        const payload = join(path, '__PAGE__.txt');
        const alias = join(dir, `${entry.name}.__PAGE__.txt`);
        if (existsSync(payload) && statSync(payload).isFile() && !existsSync(alias)) {
          writeFileSync(alias, readFileSync(payload));
          created.push(relative(root, alias).split('\\').join('/'));
        }
      }
      walk(path);
    }
  };
  walk(root);
  return created;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
if (isMain) {
  const exportDir = process.argv[2] ?? DEFAULT_EXPORT;
  try {
    const created = ensureRscAliases(exportDir);
    console.log(`next-export-rsc-aliases: ${created.length} алиасов в ${exportDir}`);
    for (const p of created.slice(0, 5)) console.log(`  ${p}`);
    if (created.length > 5) console.log(`  … ещё ${created.length - 5}`);
  } catch (e) {
    // раскладка RSC — улучшение, а не условие сборки: гасим, но говорим.
    console.warn(`next-export-rsc-aliases: пропущено (${e instanceof Error ? e.message : e})`);
  }
}
