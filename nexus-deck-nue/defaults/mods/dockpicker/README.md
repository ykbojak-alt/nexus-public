# DockPicker — выбор внешнего окна для встраивания (POC-мод)

UI-пикер кандидатов внешних окон (Windows Terminal) для будущего dock/undock
в NEXUS Deck. Нативный мод gpui-kit, стиль nexus (black/silver/gold).

## Статус

**MOCK FIXTURE** — список кандидатов статичный (title/pid/hwnd/state).
Живых вызовов `dock.*` нет. Кнопки Dock/Detach — локальный mock-стейт
(Set в памяти мода), не реальный репарентинг.

## Graceful degradation (ВАЖНО)

При старте мод проверяет RPC-поверхность ядра: `nx(["schema","--json"])` →
OpenRPC-документ, из него извлекаются имена методов. Состояния:

- **checking** — идёт проверка (плашка-спиннер нет, текст «проверяю…»);
- **ok** — `dock.discover` и `dock.request` есть в схеме → «✓ NDeck dock.*
  доступны», кнопки Dock/Detach активны;
- **missing** — dock.* отсутствуют → плашка **«⚠ requires NDeck core
  integration»**, список read-only, вместо кнопок — «—» (без мёртвых
  контролов);
- **error** — `nx schema` упал (нет ядра/сети/JSON) → та же плашка с текстом
  ошибки.

Так мод честно показывает требуемую интеграцию, а не мёртвые кнопки.

## Что видно

- Шапка: DockPicker + «MOCK FIXTURE» + дата фикстуры.
- Баннер интеграции (см. выше).
- Список кандидатов (4 строки): title · pid · hwnd · state-чип
  (окно/свёрнуто/докнуто на токенах nexus).
  - `minimized` — рядом с строкой «нужен restore» (не докнуть по W91);
  - `docked` — чип «докнуто», кнопка переключается на Detach;
  - при integration ≠ ok кнопок нет вообще.
- Статус-строка: источник фикстуры + текущий mock-докнутый набор hwnd.

## Файлы

- `mod.json` — `{"place":"none","title":"DockPicker","size":360}` (куда
  поставит layout/стек).
- `main.js` — мод (gpui-kit, theme() токены).

## Проверка

- `node --check main.js` — синтаксис.
- `nx-app check D:\nexus\nexus-deck\defaults\mods\dockpicker` — валидация
  мода (обязательна).
- Ручной запуск в nx-app: баннер должен показать «requires NDeck core
  integration» (в текущем ядре dock.* отсутствуют — подтверждено прогоном
  `hc schema --json`).

## Следующие шаги (когда придёт dock.*)

- Подключить `dock_client`-вызовы: discover (реальный список вместо MOCK),
  request/undock (W95/W97 draft-клиент, wiring по
  `docs/DOCK_INTEGRATION_WIRING.md` §4.5).
- Убрать MOCK-данные и mock-docked Set; state строки брать из реального
  `dock.discover` (minimized/уже докнутые исключаются ядром).
