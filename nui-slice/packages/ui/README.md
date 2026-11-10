# @nexus/ui

NEXUS design-system component library. Transport-free, token-driven,
controlled-first. Общий API — `@nexus/ui`; несколько именованных subpath
экспортируют доступностные примитивы для tree-shaking.

## Публичный API

```tsx
import {
  EmptyState,
  ErrorState,
  GlassSurface,
  LoadingState,
  NexusThemeProvider,
  UnavailableState,
} from '@nexus/ui';
import type {
  AssistantThemeId,
  EmptyStateProps,
  GlassSurfaceProps,
  GlassTone,
  LoadingStateProps,
  NexusThemeId,
  TokenKey,
} from '@nexus/ui';
```

- Runtime-компоненты и константы по умолчанию импортируйте из `@nexus/ui`.
- Разрешены только subpath из `package.json#exports`; произвольные deep
  imports и пути `src/**` запрещены.
- Типы glass/state/theme/token собраны в `src/types/index.ts`, доступны из
  того же корня. Остальные публичные типы также импортируйте из корня.
- CSS-токены подключайте из `@nexus/tokens/generated/tokens.css`; не
  импортируйте исходные JSON/TS токенов из `@nexus/ui`.
- `src/index.ts` — корневой barrel. `src/charts/index.ts` и прочие внутренние
  файлы не поддерживаются как consumer subpath.

### Миграция с deep imports

| Было (deprecated / запрещено) | Стало |
|---|---|
| `@nexus/ui/charts` | `@nexus/ui` |
| Произвольный `@nexus/ui/<group>/<component>` | `@nexus/ui` |
| Прокрутка div с `overflow:auto` без фокуса/имени | `ScrollRegion` из `@nexus/ui/accessibility/scroll-region` |
| `role=list` с кнопками/status прямыми детьми | `List` + `ListItem` из `@nexus/ui/accessibility/list`; пустое состояние — sibling списка |
| Самодельный listbox без стрелок/Home/End | `Listbox` + `ListboxOption` из `@nexus/ui/inputs/listbox` |
| Низкоуровневый Tabs API | `Tabs` из `@nexus/ui/navigation/tabs` или `TabList`/`Tab`/`TabPanel` из `@nexus/ui/navigation/tabs-primitives` |
| Eager `DonutChart` / `FlowSteps` из общего barrel | `@nexus/ui/charts/donut-chart` / `@nexus/ui/charts/flow-steps`; при условной загрузке — framework lazy boundary вокруг subpath import |
| Motion-обёртки из общего barrel | `@nexus/ui/motion` внутри lazy feature, если motion не нужен в первом кадре |
| Самодельный trap в диалоге/меню/tooltip | `Modal`, `Drawer`, `ActionMenu`, `Tooltip` по соответствующим exports |
| `packages/ui/src/...` из другого пакета/приложения | `@nexus/ui` |
| `@/components/...` / локальная копия примитива | подходящий экспорт `@nexus/ui` |
| Тип из файла примитива или `@nexus/themes` для UI-пропсов | type import из `@nexus/ui` |

Механическая миграция: объедините обычные именованные импорты в
`from '@nexus/ui'`; указанные выше primitives можно импортировать из
зафиксированного subpath. Типы помечайте `type`. API contract test проверяет
закрытый allowlist, а не произвольные пути.

### Границы владения

- **Можно:** потреблять root exports, передавать данные/колбэки/слоты,
  использовать документированные типы и CSS custom properties.
- **Нельзя:** импортировать `src/**`, менять внутренние CSS modules, обходить
  компонентные props прямым доступом к внутренним модулям или заводить
  локальные дубли UI без согласования.
- API-файлы `src/index.ts`, `src/types/index.ts`, `package.json` и этот
  контракт принадлежат W2. Публичное изменение проходит typecheck, consumer
  fixture, API contract/story coverage и должно сопровождаться таблицей
  миграции/заметкой о breaking changes.
- `public-api.json` — reviewed export snapshot (`contractVersion: 1`).
  Изменение набора/имён экспортов требует осознанного обновления snapshot и
  migration note; удаление/переименование экспортируемого имени — breaking
  change. `package.json` остаётся `0.0.0`/private в workspace; релизную
  версию и публикацию определяет W1.
- Экраны и интеграционные импорты у W3; motion/art — у W4; acceptance —
  у W5. W2 не редактирует их потребительские файлы вместо владельца.
- `sideEffects` сохраняет CSS-модули как побочные эффекты: нельзя ставить
  literal `false`, пока публичные компоненты импортируют CSS (это удалит
  focus-ring и стили при tree-shaking). TypeScript-компоненты остаются
  tree-shakeable; export map разрешает только reviewed subpaths.

## Setup

```tsx
import { NexusThemeProvider } from '@nexus/ui';
import '@nexus/tokens/generated/tokens.css'; // :root + [data-theme] блоки

<NexusThemeProvider theme="nexus" density="standard">
  <App />
</NexusThemeProvider>
```

- `theme`: `nexus | alice | mech | forge | codex | arch` (+ custom через
  `createNexusTheme`/`registerTheme` из `@nexus/themes`). Неизвестный id →
  `nexus` (детерминированно). Темы применяются через `data-theme` блоки в
  generated CSS — компоненты никогда не ветвятся по id.
- `density`: `calm | standard | dense` → `data-density` атрибут, масштаб
  через `--nexus-density-scale`.

## Компонентные группы

| Группа | Состав |
| --- | --- |
| theme | `NexusThemeProvider`, `useNexusTheme` |
| primitives | `GlassPanel`, `Button`, `IconButton`, `StatusBadge`, `VisuallyHidden` |
| inputs | `TextField`, `TextArea`, `SearchField`, `Combobox`, `Checkbox`, `RadioGroup`, `Select`, `Switch`, `Slider`, `RangeSlider` |
| navigation | `TopBar`, `Sidebar`, `NavItem`, `Breadcrumbs`, `Pagination`, `Tabs`, `CommandPalette`, `IconRail`, `PageHeader` |
| surfaces | `Card`, `Section`, `Divider`, `Toolbar*`, `FloatingPanel`, `Modal`, `Popover`, `Tooltip`, `Drawer`, `Table*`, `ArtPanel`, `GlassSurface`, `CapsuleInput`, `StatusStrip` |
| feedback | `SystemNotice`, `Toast`/`ToastRegion`, `ProgressBar`, `ProgressArc`, `Skeleton`, `ApprovalRequest`, **`LoadingState`**, `EmptyState`, `ErrorState`, **`UnavailableState`** — API/примеры: [ui-state-primitives.md](../../docs/product/ui-state-primitives.md) |
| actions | `SplitButton`, `ActionMenu`, `CommandTrigger`, `Chip` |
| layout | `NexusShell`, `WindowFrame`, `WindowControls`, `CommandLayout` (8+4), `IntelligenceLayout` (7+5), `StudioLayout` (9+3) |
| ai | `Agent*` (`Card`/`Avatar`/`Badge`/`Status`/`Identity`/`Selector`/`Handoff`/`Presence`), `AssistantCard`, `ModelBadge`, `ToolBadge`, `IntegrationBadge`, `RuntimeStatus`, `ConfidenceMeter`, `EvidenceStrength`, `MemoryState` |
| runtime | `RuntimeLauncher`, `WorkspacePicker`, `PermissionMode`, `SessionStatus`, `ConnectionStatus`, `ReadinessItem`, `ContextItem`, `EventRow`, `FileDiffRow`, `SourceLink`, `PlanSummary`, `AudioPlayer`, `ProviderEmbed`, `ServiceCard`, **`RuntimeClientCatalog`**, **`QwenClientCard`**, `AgendaRow`, `DocsItem`, `ProviderSearchResults`, `MessageRow`, `ThreadRow`, `CommentRow`, `Composer`, `JobControl`, `RunTrajectory`/`ToolCallCard` + `maskSecrets`, `grantLiveness`, `*_LABELS`-словари |
| agent-chat | `AgentComposer`, `DiffReviewCard`, `CheckpointMarker`, `UsageMeter`, `FileMention`, `AttachmentList`, `ToolConfirmationCard`, `StreamText`, `SessionRow`, `DelegationTree` |
| plugins | `PluginCard`, `PluginStatusBadge`, `RightPanelTabBar`, `PluginGroup` |
| motion | `AmbientCanvas`, `ParallaxLayer`, `MotionEnter`, `AmbientPulse`, `AmbientGlow`, `staggerDelay`, `ExpandRegion`, `NestedReveal`, `StreamingText`, `BusyDot`, `SendFlash`, `useSendConfirm` |
| metrics | `MetricCard`, `MetricStrip`, `MetricRing`, `StatusGauge`, `ResourceBar`, `Sparkline` |
| game | `ChessPiece` (authored-art, фиксирован между темами) |
| charts | re-export чартов окна 4 (`LineChart`, `AreaChart`, …) + `seriesVar`/`toneVar`/`CHART_CHROME` |
| dev | `ReferenceFrame` |

Полный зафиксированный набор имён — `public-api.json` (reviewed snapshot,
проверяется `src/public-api.contract.test.ts`). Детальные страницы:
состояния — [ui-state-primitives.md](../../docs/product/ui-state-primitives.md),
glass/NUE — [nue-ui-primitives.md](../../docs/product/nue-ui-primitives.md),
токены — [tokens-reference.md](../../docs/product/tokens-reference.md).

## Контракты (кратко)

- **Controlled-first**: `value`/`checked`/`open`/`page` + колбэки.
- **Состояния**: `state` (`loading|ready|empty|error|stale|offline`),
  `freshness` (`live|stale|archived`) — где состояние реально есть.
  `AgentCard`/`MetricCard` принимают их как пропсы.
- **Статусы**: `NexusStatus` — фиксированный словарь; транспортные статусы
  маппятся только через `RuntimeStatus`.
- **Persona ≠ role**: `agentId` (persona/theme) и `role` (runtime truth) —
  разные поля; `AgentCard` визуально отделяет `roleNote`.
- **Честность данных**: категорийная уверенность — дискретная шкала, не
  псевдо-% (`ConfidenceMeter`); `null` метрики → «n/a».
- **Селекторы**: `data-testid="<kebab>"` на интерактивных корнях
  (`...rest` позволяет переопределить); `data-state`/`data-freshness`.
- **Визуальные пропы**: нет `color`/`hex`/`shadow` — вариативность через
  `variant`/`tone`/`status`/`elevation`/`glow`.
- **Runtime-пакет**: компоненты описывают только NEXUS-owned состояние —
  provider internals (аккаунт, переписка, unread, подписка) непредставимы
  по контракту; `connected` только из verified state; provider-owned
  controls не дублируются (`ProviderEmbed` — контейнер, не плеер);
  секреты маскируются до сериализации через `maskSecrets`.

## Языковая политика

Решение Yury (зафиксировано 18.10.2026): **интерфейс — русский**;
английская локализация — после готовности экранов. Сейчас ничего не
переводится. Видимые строки по возможности должны приходить из словарей
(`*_LABELS`, дефолт-пропсы), чтобы английская фаза была заменой данных,
а не переписыванием JSX. Не локализуются: имена ассистентов
(ALICE/ARCH/CODEX/MECH/FORGE), брендовые названия разделов, кодовые
идентификаторы, `data-testid`, названия команд. Инвентаризация зашитых
строк: `docs/verification/wave-XXIV-W2-ui-language-policy.md`.

## Пример экрана

```tsx
<GlassPanel elevation="panel">
  <MetricCard label="Runs" value={vm.count} state={vm.state}
              freshness={vm.freshness} />
  <AgentCard agent={{ id: vm.personaId, name: vm.name }}
             status={vm.presence} state={vm.state} onRetry={refetch} />
</GlassPanel>
```

Полные контракты: `docs/superpowers/plans/window-2-contracts.md`,
инвентарь API: `docs/superpowers/plans/window-2-api-freeze.md`.
