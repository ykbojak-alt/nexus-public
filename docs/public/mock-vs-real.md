# Что остаётся mock / source-only / owner-gated

| Компонент | Статус | Объяснение |
|---|---|---|
| **Core runtime** (`tools/nexus_core`, `nexus-deck-core`) | source + тесты | Полный код; тесты запускаются (demo 32/32) |
| **Мock-совместимость** (`CORE_MOCK=1`, `MockPTYBackend`) | **mock** | Есть для тестов/CI без реальных PTY |
| **ConPTY-бинарники** | **fetch-by-script** | Не входят в репо; `fetch-conpty.ps1` (sha256-пин) качает на Windows. Без него на Windows demo не поднимет терминалы: 8/32 FAIL |
| **Ghostty** (`vendor/ghostty`) | gitlink (upstream) | Пин `291fd050…` в `.gitmodules`; checkout при `git submodule update --init` |
| **NUE-бандл** (`apps/nexus/out`, ~920 МБ) | **вне репо** | Строится из `apps/nexus` отдельно; `nue-host --root <NUE_OUT_DIR>` |
| **nue-host** (`crates/nue-host`) | source + тесты | Security-тесты 9/9 (`cargo test -p nue-host`) |
| **Локальная ферм-проекция** (`crates/nue-host/src/farm.rs`) | source-only + mock | Whitelist-проекции `/api/deck/*` и `/api/core/*`; без реального зеркала |
| **NexusLink / ai2 backend** (`/v1/*`, `/api/*`) | **owner-gated** | Рабочие адреса в коде заменены на `example.invalid`; задаются `--remote`/конфигом |
| **Agentic-режим демо** (`--agentic`) | owner-gated | Требует живого NexusLink + `incoming_token`; без него честный scripted-fallback |
| **AEGIS admin tokens** | owner-gated | `AEGIS_ADMIN_KEYS` и т.п. задаются env; в репо только примеры/`gate-policy.example.json` |
| **Секреты/конфиги** | отсутствуют | Ни токенов, ни `.env` с реальными значениями |

## Открытые вопросы для owner

- Подтвердить Apache-2.0 для корня (первый-party код без собственного LICENSE).
- Выбрать способ публикации Ghostty: submodule-пин (как сейчас) — ок.
- Подтвердить, что demo-стенд и tools/nexus_core — публикуемы (авторское право).
- Владелец решит, кому принадлежат авторские права на baseline + спринт-серию
  (авторы коммитов: CODEX / FORGE / QODER / NEO2).
