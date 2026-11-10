# RELEASE-NOTES — NEXUS public submission (спринт 2628 ноября)

Версия: 0.1.0 (public-ready draft)
Дата: 2026-11-10

## Что вошло в спринт (по коммитам)

- **feat(newf)** — roster-клиент: проекции `/api/deck/roster` и OSC-карта
  бейджей (CODEX).
- **fix(deck)** — SSE-кадры с плоскими address/state, локальные переходы без
  полного refetch (CODEX).
- **fix(nue-host)** — закрыт обход root через абсолютный путь Windows и
  NTFS-ADS; добавлены Host-валидация, 405 на не-GET статике, 411 на chunked;
  9 регресс-тестов (FORGE).
- **docs(nue-host)** — README, SECURITY (модель угроз), CHANGELOG (FORGE).
- **chore(repo)** — гигиена: .gitignore, исключение артефактов, gitlink
  ghostty, THIRD-PARTY-NOTICES.md, conpty-бинарники с лицензией (QODER).
- **docs(public)** — architecture, verify, sequence, threat-model,
  mock-vs-real (QODER).

Полная история: `git log --oneline` (baseline + 12 коммитов).

## Как запустить

### Демо-стенд (32/32)

```sh
# Windows: сначала подтянуть ConPTY не нужно — бинарники уже в репо.
# (перепроверка: powershell -ExecutionPolicy Bypass -File nexus-deck-core/scripts/fetch-conpty.ps1 -Dest tools/nexus_core)

python demos/iikuznitsa-agentic/demo_stand.py
```

Ожидается: `RESULT: 32/32 PASS, 0 FAIL, 0 SKIP`.

### Полная сборка (nx-app / nexus-core)

```sh
git submodule update --init --recursive   # обязателен: vendor/ghostty
cargo metadata --no-deps --manifest-path nexus-deck-core/Cargo.toml
cargo metadata --no-deps --manifest-path nexus-deck-nue/Cargo.toml
# сборка: cd nexus-deck-nue && cargo build --release  (вне демо)
```

### Локальный хост NUE

```sh
# из nexus-deck-nue (после сборки)
nx-nue-host --root <NUE_OUT_DIR> --remote <BACKEND_BASE>
# <NUE_OUT_DIR> — предсобранный NUE static export (вне этого репо)
# <BACKEND_BASE> — адрес удалённого ai2 backend (owner-gated)
```

## Что показать судье за 3 минуты

1. `python demos/iikuznitsa-agentic/demo_stand.py` → 32/32 PASS.
2. `/workflow` (локальный хост) — живой ростер агентов через
   `/api/deck/roster` (проекции фермы).
3. `/deck` — deck-экран (список агентов/терминалов).
4. `/newf` — NEWF-панели.
5. `/api/core/audit/verify` → `ok:true` (aegis + gate_trail).

## Что осталось за фермой

- Реальные backend-адреса (ai2, зеркало deck) — owner-gated; в коде
  плейсхолдеры (`example.invalid`), настраиваются `--remote`/конфигом.
- Агентные roles/терминалы в демо — scripted; agentic-режим требует NexusLink.
- Локальный контур фермы (сессии, машины) — вне репо.

## mock / source-only / owner-gated (кратко)

| Компонент | Статус |
|---|---|
| Core runtime + тесты | source |
| Mock-совместимость (`CORE_MOCK=1`) | mock |
| ConPTY-бинарники | включены (MIT) |
| Ghostty | gitlink (MIT) |
| NUE-бандл (`out/`) | вне репо (собирается отдельно) |
| nue-host | source + тесты |
| Проекции `/api/deck/*` | source-only (whitelist) |
| NexusLink / ai2 backend | owner-gated |
| Agentic-режим демо | owner-gated |
| Секреты/конфиги | отсутствуют |

Подробно: `docs/public/mock-vs-real.md`.

## Валидация релиза

- `cargo test -p nue-host` → 22/22.
- Demo-стенд → 32/32.
- Секрет-скан индекса → 0.
- Внутренние идентификаторы → 0.
- `git status` → чисто.
