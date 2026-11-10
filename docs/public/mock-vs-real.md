# Что остаётся mock / source-only / owner-gated

| Компонент | Статус | Объяснение |
|---|---|---|
| **Core runtime** (`tools/nexus_core`, `nexus-deck-core`) | source + тесты | Полный код; тесты запускаются (demo 32/32) |
| **Mock-совместимость** (`CORE_MOCK=1`, `MockPTYBackend`) | **mock** | Есть для тестов/CI без реальных PTY |
| **ConPTY-бинарники** | включены (MIT) | `conpty.dll`/`OpenConsole.exe` в `tools/nexus_core/conpty/` с лицензией и sha256-пинами; перепроверка — `fetch-conpty.ps1` |
| **Ghostty** (`nexus-deck-core/vendor/ghostty`) | gitlink (upstream) | Пин `291fd050…` в `.gitmodules`; checkout при `git submodule update --init` |
| **Deck-UI** (`nui-slice/`) | source | Исходники + `packages/*` + pnpm workspace; сборка `pnpm build` → `apps/nexus/out/` |
| **nue-host** (`crates/nue-host`) | source + тесты | Standalone crate; 42 теста (`cargo test -p nue-host`) |
| **Локальная ферм-проекция** (`crates/nue-host/src/farm.rs`) | source-only + mock | Whitelist-проекции `/api/deck/*` и `/api/core/*`; без реального зеркала |
| **NexusLink / удалённый backend** (`/v1/*`, `/api/*`) | **owner-gated** | Рабочие адреса в коде заменены на `example.invalid`; задаются `--remote`/конфигом |
| **Agentic-режим демо** (`--agentic`) | owner-gated | Требует живого NexusLink + `incoming_token`; без него честный scripted-fallback |
| **AEGIS admin tokens** | owner-gated | `AEGIS_ADMIN_KEYS` и т.п. задаются env; в репо только примеры/`gate-policy.example.json` |
| **Десктоп-приложение NUE** | вне репо | Решение владельца (2026-11-10); из продуктовой линии NUE опубликован только `crates/nue-host` |
| **Секреты/конфиги** | отсутствуют | Ни токенов, ни `.env` с реальными значениями |

## Открытые вопросы для owner

- Подтвердить Apache-2.0 для корня (первый-party код без собственного LICENSE).
- Подтвердить, что demo-стенд и tools/nexus_core — публикуемы (авторское право).
- Владелец решит, кому принадлежат авторские права на baseline + спринт-серию
  (авторы коммитов: CODEX / FORGE / NEO2).
