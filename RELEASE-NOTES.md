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

### Полная сборка (Deck UI / ядро)

```sh
# 1) Nexus Deck UI (исходники в этом репо)
cd nui-slice
pnpm install --frozen-lockfile
pnpm build
# 2) Ядро: cargo metadata (без полной сборки)
cargo metadata --no-deps --manifest-path nexus-deck-core/Cargo.toml
cargo metadata --no-deps --manifest-path Cargo.toml
```

### Локальный хост Deck

```sh
# из корня репозитория (после cargo build -p nue-host)
cargo run -p nue-host -- --root <DECK_OUT_DIR> --remote <BACKEND_BASE>
# <DECK_OUT_DIR> — сборка Deck-UI (nui-slice/apps/nexus/out)
# <BACKEND_BASE> — адрес удалённого backend фермы (owner-gated)
```

## Что показать судье за 3 минуты (из публичного репо)

1. **Демо**: `python demos/iikuznitsa-agentic/demo_stand.py` → 32/32 PASS.
2. **Исходный тур**: `docs/public/{architecture,sequence,threat-model,mock-vs-real,verify}.md`.
3. **Запуск ядра**: `cargo metadata --no-deps --manifest-path nexus-deck-core/Cargo.toml` +
   `PYTHONPATH="$PWD" python -c "import tools.nexus_core.api; print('ok')"`.
4. **Deck-UI**: `cd nui-slice && pnpm install --frozen-lockfile && pnpm build`
   → `apps/nexus/out/` (экраны `/workflow`, `/deck`, `/newf`).
5. **Локальный хост**: `cargo build -p nue-host`; `nx-nue-host` на
   `127.0.0.1:8869` без бандла может отдавать только API-контур фермы
   (проекции `/api/core/*`, `/api/deck/*`), БЕЗ UI-экранов.

> **ВАЖНО**: экраны `/workflow`, `/deck`, `/newf` — часть **полного
> продукта**, чьи исходники NUI живут во внутреннем репозитории фермы
> (`apps/nexus`, `packages/*`). В публичном репо — Deck-UI-срез
> (`nui-slice/`), который собирается в эти экраны.
> Публичный репо даёт ядро, nue-host, Deck-UI-срез, демо-стенд и
> документацию; десктоп-приложение NUE не публикуется (решение владельца).
> Никаких обещаний, которых репо не выполняет.

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
| Deck-UI-срез (`nui-slice/`) | source (собирается pnpm build) |
| Десктоп NUE (полный продукт) | вне репо (решение владельца) |
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
