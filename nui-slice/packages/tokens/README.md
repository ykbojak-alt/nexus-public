# @nexus/tokens

NEXUS design tokens: DTCG-источники, pipeline генерации, выходные CSS-артефакты.

## Использование

```ts
import '@nexus/tokens/generated/tokens.css'; // обязательный entry — темы/density живут здесь
```

Импорт `tokens.css` — **единственная точка активации** `--nexus-*` переменных,
`[data-theme]` и `[data-density]` блоков. Без него компоненты работают на
per-component fallback-литералах (деградация, не отказ). См. контракт в
`docs/superpowers/plans/window-2-contracts.md`.

## Pipeline

```
src/primitives → src/semantic → src/components   (DTCG JSON, {ref} ссылки)
        ↓  nx run tokens:build  (scripts/build-tokens.ts)
generated/tokens.css      — :root + [data-theme] + [data-density] блоки
generated/tokens.{ts,d.ts} — typed token values
generated/tailwind-theme.css
generated/theme-manifest.json
```

- **Naming (frozen):** `chart.gridMajor` → `--nexus-chart-grid-major`
  (kebab-case каждый сегмент).
- **Alpha-варианты:** только `color-mix(in srgb, {color.<prim>} N%, transparent)`
  — hex8-литералов нет нигде (полный перевод 2026-10-12).
- **Валидация при билде:** unresolved `{ref}`, циклы, неизвестные `$type`
  — билд падает, а не эмитит битый CSS.
- **Density:** `[data-density="calm|standard|dense"]` блоки со
  `scale 1.15/1/0.85` + весь `space.*` ramp как `calc(base × scale)`.
- **Темы:** билд загружает `themeRegistry` из `@nexus/themes` и эмитит
  `[data-theme="<id>"]` блок для каждой зарегистрированной темы.

## Проверки

```
corepack pnpm nx run tokens:build --skip-nx-cache
corepack pnpm nx test tokens
```
