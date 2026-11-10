import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Codemod tools/codemods/tokenize-css.mjs — dry-run таблица и --write.
 * Фикстура — временная css вне репо: проверяем, что exact-литерал
 * маппится на токен, неоднозначное/нет совпадения — только в отчёт,
 * комментарии и var() не трогаются, dry-run не пишет на диск.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CODEMOD = join(ROOT, 'tools', 'codemods', 'tokenize-css.mjs');

const FIXTURE = [
  '.a { color: #C9A45C; }',                 // exact — gold.500 в :root
  '.b { border-radius: 7px; }',             // ambiguous → radius.sm 8px
  '.c { font-size: 9px; }',                 // unmatched (< 13px, далеко от шкалы)
  '.d { color: var(--nexus-x, #123456); }', // внутри var() — не трогаем
  '/* #C9A45C в комментарии — не код */',
].join('\n');

function run(dir: string, extra = '') {
  const out = execSync(`node "${CODEMOD}" "${dir}" --json ${extra}`, {
    encoding: 'utf8',
  });
  return JSON.parse(out) as {
    mode: string;
    report: Array<{ literal: string; token: string | null; status: string }>;
  };
}

describe('tokenize-css codemod (wave-XIV)', () => {
  it('dry-run: exact -> токен, near -> ambiguous, far -> unmatched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokz-'));
    try {
      writeFileSync(join(dir, 'fixture.css'), FIXTURE);
      const { report } = run(dir);
      const by = (lit: string) => report.find((r) => r.literal === lit);

      expect(by('#C9A45C')?.status).toBe('replaced');
      expect(by('#C9A45C')?.token).toMatch(/^--nexus-/);
      expect(by('7px')?.status).toBe('ambiguous');
      expect(by('7px')?.token).toBe('--nexus-radius-md'); // 8px ближе, чем 4px
      expect(by('9px')?.status).toBe('unmatched');

      // литерал внутри var() и комментария не собирается
      expect(report.some((r) => r.literal === '#123456')).toBe(false);
      expect(report.filter((r) => r.literal === '#C9A45C')).toHaveLength(1);

      // dry-run не пишет на диск
      expect(readFileSync(join(dir, 'fixture.css'), 'utf8')).toBe(FIXTURE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--write переписывает только exact-замены, остальное сохраняет', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokz-'));
    try {
      const file = join(dir, 'fixture.css');
      writeFileSync(file, FIXTURE);
      run(dir, '--write');
      const out = readFileSync(file, 'utf8');
      expect(out).toMatch(/color: var\(--nexus-[\w-]+, #C9A45C\)/);
      expect(out).toContain('border-radius: 7px');
      expect(out).toContain('font-size: 9px');
      expect(out).toContain('var(--nexus-x, #123456)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
