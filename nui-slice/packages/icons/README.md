# @nexus/icons

NEXUS icon registry + `NexusIcon` — stroke-иконки 24×24 по семантическим именам.

## API

```tsx
import { NexusIcon, iconRegistry, type NexusIconName } from '@nexus/icons';

<NexusIcon name="nav.search" />                 // decorative (aria-hidden)
<NexusIcon name="agent.alice" label="ALICE" />  // meaningful → role="img"
```

| Prop | Default | Назначение |
|---|---|---|
| `name` | — | `NexusIconName` — ключ реестра |
| `size` | `16` | px (space.4) |
| `label` | — | осмысленная иконка → `role="img"` + `aria-label`; без него `aria-hidden` |
| `strokeWidth` | `1.5` | толщина stroke |
| `className`/`style` | — | layout-интеграция |

## Реестр

Три семейства, kebab-имена `<family>.<glyph>`:

- `agent.*` — persona-знаки: `nexus`, `alice`, `mech`, `forge`, `codex`, `arch`
- `nav.*` — chrome-навигация: `search`, `settings`, `bell`, `command`
- `act.*` — действия: `play`, `stop`, `close`, `check`, `chevron`
- `status.*` — статусные глифы: `dot`, `info`, `warn`

Неизвестное имя — compile-time ошибка (`NexusIconName` = union из реестра),
не runtime-fallback.

## Контракт

Иконки — stroke-контур на `currentColor`: цвет всегда наследуется от
семантического контекста (`--nexus-*` через компонент), перекраска снаружи
не нужна и не поддерживается.
