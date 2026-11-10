# craft.* — live probe против solidcraft.exe (дизайн, без запуска)

AGENT-B → AGENT-C · 26.10.2026 · статус: **спроектирован, не запускался**

## 0 · Пререквизиты (сторона AGENT-C)

```powershell
Start-Process -FilePath D:\Temp\solidcraft\target\release\solidcraft.exe `
  -ArgumentList '--control','27990','--sample' -PassThru
# ждём файл: %LOCALAPPDATA%\SolidCraft\control\27990.token
```

Прогон: `node packages\bridge\live-probe.mjs 27990` — скрипт лежит рядом с
`craft-adapter.mjs` (файл `live-probe.mjs`, см. §4). Каждый ответ пишется в
stdout **сырым JSON** («Ожидание ≠ факт» — не пересказывать, paste as-is).

## 1 · Сценарии и ожидания

| # | Вызов | Ожидание (по docs/control-protocol.md + smoke 27990) |
|---|---|---|
| 1 | connect + `ui.inspect` | `ok:true`; `result` — объект; ключи: `adapter` (строка GPU, ранее «Dx12 NVIDIA RTX 3050»), `documents` (число ≥1 при `--sample`), camera/`draw`/`status`; `frame_ms` — число |
| 2 | `engine.commands` | `ok:true`; реестр — массив/объект с `commands`; каждый элемент имеет `id` вида `<area>.<thing>` и `enabled` |
| 3 | `engine.execute` простая команда | id берём **из реестра п.2**, не угадываем: первый `enabled:true` с id из allowlist `document.*`/`ui.*`-in-engine/`parameters.*`/`measure.*`; `ok:true` либо документированный `ok:false` (пишем факт) |
| 4 | `engine.execute file.export` с `allow_paths` | `ok:true`; файл появляется в `D:\nexus\craft-workspace\probe.step`; путь вне allow_paths → `ok:false` `outside the folders` (оба исхода — факт) |
| 5 | `control.pending` | `ok:true`, `result:{pending:null}` когда очередь пуста |
| 6 | `control.running` | `ok:true`, `result:{running:[]}` в простое |

## 2 · Негативные проверки

| # | Действие | Ожидание |
|---|---|---|
| 7 | второе соединение с `token:"0"*64` | `ok:false`, `error` начинается с `unauthorized:`, соединение закрывается |
| 8 | `engine.execute` несуществующий id (`nexus.nope`) | `ok:false`, `error` — строка; приложение не падает |
| 9 | повторный запрос при `busy` | не воспроизводим в smoke — пропуск, пометка `NOT COVERED` |

## 3 · Что НЕ проверять в этом прогоне

- `engine.batch` >1 шага, rollback, timings — отдельный probe.
- Деструктивные команды (delete/undo) — только после allowlist-политики.
- Таймаут 60 с (`running:true`) — нужна длинная команда, не в smoke.

## 4 · live-probe.mjs (дизайн; записать результат verbatim)

```js
import { CraftAdapter } from './craft-adapter.mjs';
const port = Number(process.argv[2] ?? 27990);
const a = CraftAdapter.fromTokenFile(port);
await a.connect(port);
const log = (n, r) => console.log(`[${n}]`, JSON.stringify(r));
log(1, await a.uiInspect());
const cmds = await a.engineCommands(); log(2, cmds.ok ? { ok: true } : cmds);
const list = (cmds.result?.commands ?? cmds.result ?? []);
const pick = list.find(c => c.enabled && /^(document|parameters|measure)\./.test(c.id));
log(3, await a.engineExecute(pick ? pick.id : 'nexus.nope', pick?.params ?? {}));
log(4, await a.engineExecute('file.export', { path: 'D:/nexus/craft-workspace/probe.step' },
  ['D:/nexus/craft-workspace']));
log(5, await a.controlPending());
log(6, await a.controlRunning());
a.close();
// кейс 7 — отдельное соединение с неверным токеном
const bad = new CraftAdapter('0'.repeat(64));
await bad.connect(port);
log(7, await bad.uiInspect());
```

## 5 · Критерий PASS

Все ответы имеют `id` и `ok`; фактические поля `ui.inspect` совпадают с
документированными; `engine.execute` — `ok:true` на выбранной команде или
документированная ошибка; кейс 7 — `unauthorized`. Расхождения фиксируются
verbatim в этом файле (раздел «Факт» — заполнить после прогона).

## Факт (заполняется AGENT-C)

_пусто — прогон не выполнялся_
