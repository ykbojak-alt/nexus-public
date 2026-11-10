# Воспроизведение проверки / security notes

## После клона: подтянуть сабмодули

Gitlink-публикации при клоне НЕ подтягиваются автоматически. Перед
сборкой `nexus-deck-core` выполните:

```sh
git submodule update --init --recursive
```

Без этого каталог `vendor/ghostty` пуст. **Демо-стенд и тесты
`nue-host` не зависят от ghostty** — они работают и при пустых vendor
(проверено). Полная сборка `nexus-deck-core` — требует.

## Demo-стенд

```sh
cd demos/iikuznitsa-agentic
python demo_stand.py
```

Ожидаемый вывод: `RESULT: 32/32 PASS, 0 FAIL` и `STAND: PASS`, exit code 0.

Сценарии:
- SCENE-0: до старта сервера соединение честно отсутствует (offline empty state).
- SCENE-1: два терминала (agent-a/agent-b) через `POST /api/core/run`.
- SCENE-2: handoff-документ: A пишет версии, B читает; CAS-отказ при
  устаревшем `base_version` → 409.
- SCENE-3: gated операции: `kill prod-db` → deny 403; `doc_put` →
  require_approval; dual-control kill (2 подписи).
- SCENE-4: SSE-события `policy`/`doc`, HMAC content_hash, audit.jsonl,
  `/api/core/audit/verify`.
- SCENE-5: после остановки core обращения падают.

## Импорт Python-ядра

```sh
PYTHONPATH="$PWD" python -c "import tools.nexus_core.api; print('ok')"
```

## Deck-UI (сборка)

```sh
cd nui-slice
pnpm install --frozen-lockfile
pnpm build                  # → apps/nexus/out/
```

Требования: Node.js 20+ и pnpm 9+; на установку зависимостей нужна сеть
до npm-реестра.

## Локальный хост Deck (nue-host)

```sh
cargo build -p nue-host     # из корня репозитория
cargo test -p nue-host      # 42 теста: 19 lib + 8 harden2 + 6 harden3 + 9 security
```

Запуск: `cargo run -p nue-host -- --root <DECK_OUT_DIR> --port 8869
--remote <BACKEND_URL>`. Без бандла Deck-UI хост отдаёт только API-контур
(ростер `/api/deck/roster`, `/api/core/*`, SSE), без экранов.

## Безопасность nue-host (N-1…N-7)

| Тест | Нарушение | Ожидание |
|---|---|---|
| N-1 | абсолютный путь / обход root (`C:/…`, `..`, NTFS ADS) | 404 |
| N-2 | MIME по фактическому файлу (SPA-роут → text/html) | верный content-type |
| N-3 | не-GET/HEAD на статике | 405 |
| N-4 | неизвестный путь | 404 |
| N-5 | Host ≠ localhost/127.0.0.1/[::1] | 421 |
| N-6 | нераспознанный метод прокси | 405 |
| N-7 | префикс `/v1/` вырезается один раз; `..` в прокси | 404 |

Тесты: `crates/nue-host/tests/security.rs` (9 кейсов) + `harden2.rs`
(8) + `harden3.rs` (6, в т.ч. banned-слова).

## Политики и аудит

- `tools/nexus_core/gate-policy.example.json` — пример политики.
- `tools/nexus_core/alert_rules.json` — паттерны событий.
- AEGIS: `env AEGIS_ADMIN_KEYS='...'` (пример в demo_stand.py);
  в dev-режиме без токенов — loopback-only.
