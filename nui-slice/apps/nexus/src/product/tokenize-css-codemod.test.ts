// @vitest-environment node
/**
 * Codemod «литерал → токен» (tools/codemods/tokenize-css.mjs).
 *
 * Регрессия, которую закрывает тест: `literals()` выдаёт кандидатов ПО ВИДАМ
 * (цвета → радиусы → шрифты → z-index), а перезапись считает смещение от
 * предыдущих правок. Порядок не был возрастающим — `var()` вставал не на своё
 * место и CSS портился («textvar(--nexus-type-caption-font-size, 13px)mary»).
 * Плюс смещение радиуса считалось через indexOf по всему совпадению, и
 * второй одинаковый литерал («1px 1px») получал индекс первого.
 */
import { describe, expect, it } from 'vitest';
import { transformCss, loadTokenMap } from '../../../../tools/codemods/tokenize-css.mjs';

const byValue = loadTokenMap();

const CSS = `/* комментарий: 13px и #C9A45C — литералы в тексте не код */
.a {
  color: var(--nexus-text-primary, #F6F0E4);
  font-size: 13px;
  border-radius: 8px;
  z-index: 70;
  box-shadow: 0 0 0 2px #C9A45C;
}
.b { border-radius: 8px 8px 0 0; }
`;

describe('tokenize-css codemod', () => {
  it('подставляет var() ровно на место литерала, файл остаётся валидным', () => {
    const { css: out } = transformCss(CSS, byValue);
    expect(out).toBe(`/* комментарий: 13px и #C9A45C — литералы в тексте не код */
.a {
  color: var(--nexus-text-primary, #F6F0E4);
  font-size: var(--nexus-type-caption-font-size, 13px);
  border-radius: var(--nexus-radius-md, 8px);
  z-index: var(--nexus-layer-drawer, 70);
  box-shadow: 0 0 0 2px var(--nexus-color-gold-500, #C9A45C);
}
.b { border-radius: var(--nexus-radius-md, 8px) var(--nexus-radius-md, 8px) 0 0; }
`);
  });

  it('не разрывает имена токенов и не залезает в комментарии', () => {
    const { css: out } = transformCss(CSS, byValue);
    // сигнатура прежней поломки: var() внутри имени другого токена
    expect(out).not.toMatch(/--nexus-[a-z0-9-]*var\(/);
    // литералы в комментарии остались нетронутыми
    expect(out).toContain('/* комментарий: 13px и #C9A45C — литералы в тексте не код */');
  });

  it('литерал остаётся фолбэком — отрисовка не меняется без токенов', () => {
    const { css: out } = transformCss('.x { font-size: 13px; }', byValue);
    expect(out).toContain('var(--nexus-type-caption-font-size, 13px)');
  });

  it('в отчёте видны и заменённые, и неоднозначные литералы', () => {
    const { report } = transformCss(CSS, byValue);
    const exact = report.filter((r) => r.status === 'exact');
    expect(exact.map((r) => r.lit).sort()).toEqual(['#C9A45C', '13px', '70', '8px', '8px', '8px']);
    // неоднозначные (совпадает значение сразу с несколькими токенами) — в отчёт
    const { report: amb } = transformCss('.x { font-size: 16px; }', byValue);
    expect(amb[0].status).toBe('ambiguous');
  });
});
