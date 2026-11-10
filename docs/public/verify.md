# Воспроизведение проверки / security notes

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

## Манифесты Rust

```sh
cargo metadata --no-deps --manifest-path nexus-deck-core/Cargo.toml
cargo metadata --no-deps --manifest-path nexus-deck-nue/Cargo.toml
```

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

Тесты: `nexus-deck-nue/crates/nue-host/tests/security.rs` (9 кейсов).

## Политики и аудит

- `tools/nexus_core/gate-policy.example.json` — пример политики.
- `tools/nexus_core/alert_rules.json` — паттерны событий.
- AEGIS: `env AEGIS_ADMIN_KEYS='...'` (пример в demo_stand.py);
  в dev-режиме без токенов — loopback-only.
