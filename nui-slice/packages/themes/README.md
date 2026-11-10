# @nexus/themes

NEXUS theme engine: реестр канонических тем, resolution и extension API.

## API

```ts
import {
  themeRegistry,        // Map<ThemeId, ResolvedNexusTheme> — 6 канонических
  resolveTheme,         // (id | definition) → ResolvedNexusTheme; unknown id → 'nexus'
  createNexusTheme,     // ({ id, extends?, tokens }) → definition для registerTheme
  registerTheme,        // (definition) → добавляет в registry
} from '@nexus/themes';
```

- **Канонические темы**: `nexus` (obsidian/gold, база), `alice` (ivory,
  светлая), `mech` (obsidian/blue), `forge` (graphite/amber), `codex`
  (graphite/antique gold), `arch` (deep obsidian/violet).
- **Fallback**: `resolveTheme('unknown').id === 'nexus'` — детерминированно.
- **Extension**: `extends` цепочка child-over-parent; циклы обрезаны;
  неизвестный родитель → `nexus`.

## Связь с tokens

`@nexus/tokens` `tokens:build` загружает `themeRegistry` и эмитит
`[data-theme="<id>"]` блоки для каждой зарегистрированной темы —
theme overrides это token-level (`{ref}`/`color-mix`), не CSS-переопределения
компонентов.

```ts
createNexusTheme({
  id: 'sage',
  extends: 'nexus',
  tokens: { 'accent.primary': '{color.green.400}' },
});
```
