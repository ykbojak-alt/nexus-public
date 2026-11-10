# NEXUS — публичный сабмит-репозиторий

NEXUS — платформа агентной инфраструктуры. Этот репозиторий —
материализация публичной подачи для хакатона **ИИкузница / Softline
(спринт 26–28 ноября)**, собранная строго по allowlist из внутреннего
документа `SUBMISSION-REPO-SCOPE.md` (в публичное дерево не входит).

## Состав (что здесь есть)

| Путь | Что это |
|---|---|
| `nui-slice/` | **Nexus Deck UI** — веб-интерфейс (Next.js). Исходники + `packages/*` (общие библиотеки) + корневые `pnpm-workspace.yaml`/`pnpm-lock.yaml`. |
| `crates/nue-host/` | **Локальный хост Deck** — Rust-крэйт `nue-host`: раздаёт сборку Deck-UI и проксирует `/v1/*` на ферму. |
| `nexus-deck-core/` | Rust workspace ядра `nx` (супервизор терминалов, API, политики AEGIS-гейта, схемы). |
| `tools/nexus_core/` | Python API-слой (REST + SSE), политики, тесты; используется demo-стендом. |
| `demos/iikuznitsa-agentic/` | Воспроизводимый demo-стенд (32/32 PASS в scripted-режиме). |
| `docs/public/` | Материалы для судей: архитектура, API, безопасность, воспроизведение проверки. |

Продуктовая линия **NUE (десктоп-приложение NEXUS)** в публичный
репозиторий **не входит** — решение владельца (2026-11-10);
см. `SOURCE-PROVENANCE.md`. Публикуется только Nexus Deck (UI + его
локальный хост) и ядро.

## Быстрый старт (для судьи)

### 1. Демо-стенд (без внешних зависимостей)

```sh
python demos/iikuznitsa-agentic/demo_stand.py
```

Требования: Python 3.10+; на Windows — ConPTY (бинарники включены в
репозиторий, `tools/nexus_core/conpty/`). Скрипт сам поднимает локальный
`api.py`, прогоняет 32 проверки и возвращает `0` при полном PASS. Детали —
`demos/iikuznitsa-agentic/README-RUNBOOK.md`.

### 2. Nexus Deck UI (сборка)

```sh
cd nui-slice
pnpm install --frozen-lockfile   # нужны Node.js 20+ и pnpm 9+ (сеть на npm)
pnpm build                        # → apps/nexus/out/
```

### 3. Локальный хост Deck

```sh
cargo build -p nue-host           # из корня репозитория
cargo test -p nue-host            # 42 теста (19 lib + 8 harden2 + 6 harden3 + 9 security)
```

Запуск: `cargo run -p nue-host -- --root <OUT_DIR> --port 8869
--remote <BACKEND_URL>`. Без бандла Deck-UI хост отдаёт только API-контур
фермы (ростер, SSE), без экранов.

### 4. Импорт Python-ядра

```sh
PYTHONPATH="$PWD" python -c "import tools.nexus_core.api; print('ok')"
```

### 5. Rust-манифесты (без сборки)

```sh
cargo metadata --no-deps --manifest-path nexus-deck-core/Cargo.toml
cargo metadata --no-deps --manifest-path Cargo.toml
```

## Границы claims (честно)

- **Baseline import предшествует спринту.** См. `SOURCE-PROVENANCE.md`:
  исходные репозитории, commit IDs, дерево импортированных путей.
- Во время спринта в этом дереве появилась/изменилась: ветка `nue-host`
  (обособленный крэйт + security-фикс N-1…N-7 + 9 тестов), Deck-UI-срез
  (`nui-slice/`), demo-стенд, отдельные sanity-правки в
  `tools/nexus_core`.
- Что остаётся **mock / source-only / owner-gated**:
  - `CORE_MOCK=1` mock-совместимость (MockPTYBackend) — код есть, тесты
    используют;
  - live-бэкенды фермы — в публичном дереве отсутствуют; в `nue-host`
    заменены на `https://example.invalid`;
  - agentic-режим demo требует живого NexusLink — без него стенд честно
    падает в scripted-fallback;
  - AEGIS/token-механизмы — owner-gated, в публичном дереве только как код
    и `example`-конфиги, без секретов;
  - полная сборка десктоп-приложения NUE — вне репозитория (решение
    владельца).

## Требования окружения (Windows)

ConPTY-бинарники (`conpty.dll`, `OpenConsole.exe`) включены в индекс с их
лицензией (`nexus-deck-core/distribution/windows/`) и sha256-пинами;
перепроверить можно через `nexus-deck-core/scripts/fetch-conpty.ps1`.

## Лицензии

См. `LICENSE` (Apache-2.0), `NOTICE`, `THIRD-PARTY-NOTICES.md` и
компонентные licenses/notices в `nexus-deck-core/`.
