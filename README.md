# NEXUS — публичный сабмит-репозиторий (staging)

Данный репозиторий — **материализация публичной подачи** NEXUS для
хакатона **ИИкузница / Softline (спринт 2628 ноября)**. Он собран
строго по allowlist из `SUBMISSION-REPO-SCOPE.md` (внутренний документ
фермы; в публичное дерево не входит).

## Что это

NEXUS — платформа агентной инфраструктуры. В этом репозитории:

- **`nexus-deck-core/`** — Rust workspace ядра `nx` (супервизор
  терминалов, API, политики AEGIS-гейта, схемы).
- **`nexus-deck-nue/`** — Rust workspace приложения `nx-app` (GPUI) и
  локального хоста NUE-клиента `nue-host`.
- **`tools/nexus_core/`** — Python API-слой (REST + SSE), политики,
  тесты; используется demo-стендом.
- **`demos/iikuznitsa-agentic/`** — воспроизводимый demo-стенд
  (32/32 PASS в scripted-режиме).
- **`docs/public/`** — материалы для судей: архитектура, API,
  безопасность, воспроизведение проверки.

## Быстрый старт (для судьи)

### Python demo-стенд (без внешних зависимостей)

```sh
python demos/iikuznitsa-agentic/demo_stand.py
```

Требования: Python 3.10+ (проверено на 3.15). Скрипт сам поднимает
локальный `api.py` на `127.0.0.1:5801`, прогоняет 32 проверки (offline
empty state, handoff-документ, gated core-операции deny→approval,
SSE-след, audit verify) и возвращает `0` при полном PASS. Детали —
в `demos/iikuznitsa-agentic/README-RUNBOOK.md`.

### Импорт Python-ядра

```sh
PYTHONPATH="$PWD" python -c "import tools.nexus_core.api; print('ok')"
```

### Rust-манифесты (без сборки)

```sh
cargo metadata --no-deps --manifest-path nexus-deck-core/Cargo.toml
cargo metadata --no-deps --manifest-path nexus-deck-nue/Cargo.toml
```

(Полная сборка `nx-app`/`nx` в этот репозиторий не входит; см.
`docs/public/` про границы claims.)

## Границы claims (честно)

- **Baseline import предшествует спринту.** См. `SOURCE-PROVENANCE.md`:
  исходные репозитории, commit IDs, дерево импортированных путей.
- Во время спринта (2628 ноября) в этом дереве появилась/изменилась:
  - ветка `nue-host` (ранее `crates/nue-host` в app workspace);
  - security-фикс `nue-host` (N-1…N-7, `crates/nue-host/tests/security.rs`);
  - demo-стенд `demos/iikuznitsa-agentic/`;
  - отдельные sanity-правки в `tools/nexus_core` (см. git log).
- Что остаётся **mock / source-only / owner-gated**:
  - `CORE_MOCK=1` mock-совместимость (MockPTYBackend) — код есть, тесты используют;
  - live-бэкенды (`:4435/:4436/:4433`, NexusLink) — в публичном дереве
    **не присутствуют**, в `nue-host` заменены на `https://example.invalid`;
  - agentic-режим demo требует живого NexusLink (`127.0.0.1:5679`) —
    без него стенд честно падает в scripted-fallback;
  - AEGIS/token-механизмы — owner-gated, в публичном дереве только как
    код и `example`-конфиги, без секретов.

## Лицензии

См. `LICENSE` (Apache-2.0, owner-review), `NOTICE`, и компонентные
licenses/notices в `nexus-deck-core/` и `nexus-deck-nue/`.
