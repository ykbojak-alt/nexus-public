# nue-host

Локальный хост для NUE-клиента (Next.js static export). Раздаёт бандл,
проксирует `/v1/*` на удалённый ai2 host и отдаёт **farm-контур**
`/api/deck/*` и `/api/core/*` — проекции состояния фермы (агентов и
терминалов) в формате 1:1 с зеркалом `farm-mirror` на remote-host.
Используется как debug/локальный вариант запуска NUE без окна `nx-app`.

## Публикация (отдельный корень)

`nue-host` — самодостаточный крейт: `Cargo.toml` не наследует ничего из
workspace (edition `2021`, license `Apache-2.0`, `publish = false`) и несёт
свой `Cargo.lock`. Он может жить и как член workspace NEXUS
(`nexus-deck-nue`, путь `crates/nue-host`), и как отдельный корень верхнего
уровня — достаточно скопировать каталог и собрать:

```sh
cargo build && cargo test
```

Требования:

- **Rust**: stable (edition 2021, MSRV не зафиксирован; проверено на свежем stable).
- **Порт**: по умолчанию `8869`, слушает только `127.0.0.1` (loopback).
- **Зависимости**: только `ureq` (rustls) + `serde_json` — без внешних сервисов.
- **Режим `--demo`**: без живого `nx connect` — см. ниже.

## Запуск

```sh
nx-nue-host [--root <dir>] [--port <n>] [--remote <base>] [--demo]
```

| Флаг | По умолчанию | Назначение |
|---|---|---|
| `--root` | `D:\nexus\apps\nexus\out` | Папка статического экспорта NUE |
| `--port` | `8869` | Локальный порт (слушает только `127.0.0.1`) |
| `--remote` | `https://backend.example.invalid/v1` | Base URL прокси `/v1/*` |
| `--demo` | выкл | Демо-режим: синтетическая ферма, без `nx connect` |

Альтернатива флагу — переменная окружения `NX_NUE_DEMO=1` (значение `1`).

Примеры:

```sh
# обычный запуск на живую ферму
nx-nue-host --root D:\nexus\apps\nexus\out --port 8869 \
  --remote https://backend.example.invalid/v1

# демо-режим без фермы (все 11 форм + SSE, детерминированные кадры ~2с)
nx-nue-host --demo --port 8871
```

## Демо-режим (`--demo` / `NX_NUE_DEMO=1`)

Подходит для презентаций и оффлайн-разработки без фермы:

- **Не** запускает `nx connect` и не делает никаких сетевых вызовов.
- Те же 11 форм `/api/deck|core/*` + SSE-потоки `events` с
  детерминированной последовательностью кадров (таймер ~2с).
- `/api/deck/status` возвращает `"source": "demo"`, `"session": "nx-demo"`
  (живой режим — `"source": "live"`).
- Демо-данные не содержат реальных хостов/путей/секретов (проверяется
  тестами `tests/harden3.rs`).

## Что раздаёт

- **Статический бандл** `apps/nexus/out` (Next.js `output: export`):
  файлы отдаются как есть, MIME — по расширению. Query-строка
  отбрасывается (`path.split("?")[0]`), скрытые пути (dotfiles,
  `node_modules`, `.git`) → 404.
- **SPA-роуты**: путь без расширения резолвится как `{path}.html`
  (например `/workflow` → `workflow.html`), затем `{path}/index.html`;
  иначе — честный 404. Слепого «все несуществующие пути → index.html»
  нет.

## Farm-контур (`/api/deck/*` и `/api/core/*`)

Проекции состояния фермы в JSON, **только GET** (POST/PUT/DELETE → 405).
Формат 1:1 с эталоном — `farm-mirror` на remote-host (тест
`parity_projections_match_mirror` сверяет по 9 кейсам):

| Эндпоинт | Что отдаёт |
|---|---|
| `/api/deck/status` | Диагностика: connected, events_connected, events_seq, machines, session, terminals, uptime_s, version |
| `/api/deck/agents` | Агенты: address, name, state, agent, app, agent_state, agent_msg, turn, title, cols, rows, machine (None-поля выкидываются) |
| `/api/deck/roster` | Ростер: ровно 8 полей — agent_id, name, role(=app), group, term(=addr), model(""), status(=core_state), current_wave(=turn) |
| `/api/deck/terminals`, `/api/deck/machines` | Терминалы (live) и машины |
| `/api/deck/events` | SSE-поток (`event: nx` + data {seq, ts, event}) с heartbeat 15с |
| `/api/core/agents` | Агенты ядра: ровно 6 полей — address, name, state, attention, labels, parent |
| `/api/core/terminals` | Терминалы ядра: ровно 15 полей (exit_code/created_at/exited_at = null, respawn_count = 0) |
| `/api/core/machines`, `/api/core/server`, `/api/core/spaces`, `/api/core/ratings` | Состояние ядра |
| `/api/core/events` | SSE-поток ядра (flat data + heartbeat 15с; при потере фермы — `{"error":"farm_lost"}`) |

Правила проекций:

- **Сортировка** по `address` на всех списках (как зеркало).
- **`_core_state`**: nx dead/exited/finished → "exited"; agent_state
  working|blocked|idle|done → verbatim; иначе "idle".
- **Санитайзеры**: текст режется на 160 символов, контрольные символы
  (кроме `\n`, `\t`) удаляются, home-сегменты маскируются (`C:\Users\***`,
  `/home/***`, `/Users/***`). `cwd`/`argv`/`env`/`pid` не появляются ни в
  одном ответе.
- **Секреты** наружу не уходят: отвечают только whitelist-проекции.

## Что проксирует

- `/v1/*` → `{remote}/*`: метод, заголовки и тело проходят без изменений;
  авторизацию (Bearer / X-API-Key) несёт сам клиент. Прокси не
  аутентифицирует и не добавляет секретов.

## Что НЕ делает

- Не аутентифицирует сам (авторизация — на стороне клиента/апстрима).
- Слушает только `127.0.0.1` — не доступен извне.
- Не хранит состояние: процесс бездисковый, всё — в запросе/ответе.
- Не раздаёт бандл: бандл — **предсобранный статический экспорт**
  (~920 МБ), который в публичный репо НЕ входит и должен быть собран из
  `apps/nexus` или принесён отдельно.

## Точка наблюдения (P-6-3)

Локальный хост видит ферму со своей стороны:

- **Терминалы локальной машины** имеют адреса без машинного префикса:
  `local-farm/term-1`, `local-farm/term-2`, `local-farm/t4` и т.п. (prefix `local`, без `term-1`
  → `local-farm/term-1`).
- **Удалённые машины** — с префиксом: `local-farm/term-1`, `remote-host/t3`.
- Зеркало на remote-host (`farm-mirror`) видит те же терминалы с другой
  точки: `local-farm/term-1` — как `local-farm` + `term-1` (локальные для него —
  это терминалы remote-host).

Проекции и сортировка при этом одинаковы (паритет проверен тестами).

## Безопасность

Модель угроз и применённые правила — в [`SECURITY.md`](SECURITY.md).

## Тесты

```sh
cargo test -p nue-host        # внутри workspace
# или, вне workspace (standalone):
cargo test
```

- `tests/security.rs` — регрессионные тесты безопасности (9/9): обход root
  абсолютным путём/`..`, MIME SPA-фолбэка, 405/404/421/411, Host-валидация.
- `tests/harden2.rs` — паритет форм с зеркалом (deck/agents whitelist,
  roster 8 полей, core 6/15 полей), 405 на не-GET для `/api/*`, 404 на
  скрытые пути, отсутствие cwd/argv/env во всех ответах, маска home,
  регресс query.
- `tests/harden3.rs` — демо-режим (6 тестов): 11 эндпоинтов 200, SSE идёт,
  `"source":"demo"`, roster 8 полей, отсутствие запрещённых слов, паритет
  ключей живого/демо, отсутствие дочерних `nx connect`.
- `src/lib.rs` / `src/farm.rs` (unit) — query-strip, сортировка по address,
  паритет проекций с эталонными значениями (9 кейсов).
