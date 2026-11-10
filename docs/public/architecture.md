# NEXUS — публичная архитектура (сокращённо)

## Общая картина

Публичный репозиторий содержит Nexus Deck: веб-UI (`nui-slice/`),
локальный хост (`crates/nue-host/`), Rust-ядро (`nexus-deck-core/`),
Python-ядро (`tools/nexus_core/`) и демо-стенд (`demos/`).

Десктоп-приложение NUE в публичный репозиторий не входит (решение
владельца, 2026-11-10; см. `SOURCE-PROVENANCE.md`).

```
┌───────────────────────────┐      ┌───────────────────────────────┐
│  nexus-deck-core (Rust)   │      │  nui-slice (Next.js, Deck UI) │
│  - супервизор терминалов  │      │  - apps/nexus/src (web)       │
│  - API: /api/core/*       │◄────►│  - packages/* (общие библиотеки)│
│  - AEGIS gate/audit       │      │  - pnpm workspace, lock        │
└──────────┬────────────────┘      └──────────────┬────────────────┘
           │                                      │
           │ PYTHONPATH (api.py)                  │ --root <DECK_OUT_DIR>
           │                                      │ --remote <backend>
  ┌────────▼────────────────┐      ┌──────────────▼────────────────┐
  │ tools/nexus_core (Python)│      │ crates/nue-host (локальный    │
  │ REST + SSE, политики     │◄────►│ хост): статика Deck-UI +      │
  └──────────┬────────────────┘      │ прокси /v1/* на remote,      │
             │                       │ /api/deck|core/* проекции    │
             │                       └──────────────────────────────┘
  ┌──────────▼────────────────┐
  │ demos/iikuznitsa-agentic  │  demo_stand.py: 32 проверки
  └───────────────────────────┘
```

## Ключевые компоненты

- **Ядро `nx`** (`nexus-deck-core/crates/nexus-core`) — терминальный
  рантайм: spawn/keep-alive, чтение статуса OSC 7501, send/read/wait,
  машины, worktree, send-очереди, двухсторонний control. Типы API живут
  в `api/types.rs`; схема генерируется в `schema/nx.openrpc.json`.
- **AEGIS** — политика гейта (`gate-policy.json`), вердикты deny /
  require_approval / dual_control, HMAC-аудит (`audit.jsonl`) и
  endpoint `/api/core/audit/verify`.
- **`nue-host`** (`crates/nue-host/`) — локальный HTTP-сервер
  (standalone Rust-крэйт): раздаёт статику Deck-UI (сборка
  `nui-slice`), проксирует `/v1/*` на удалённый backend, отдаёт
  проекции `/api/deck/*` и `/api/core/*` (whitelist, mock-ферма).
  Безопасность N-1…N-7 (см. `verify.md`).
- **Deck-UI** (`nui-slice/`) — Next.js-приложение; экраны
  `/workflow`, `/deck`, `/newf`; общие библиотеки в `packages/*`.
  Все внешние URL в коде заменены на `example.invalid` — рабочие адреса
  задаются при запуске хоста.

## Протоколы

- Терминальный поток: raw bytes; статус — OSC 7501.
- API: JSON over HTTP (REST) + SSE для событий (`/api/core/events`).
- Аутентификация: `Authorization`/`X-API-Key`/`X-Nexus-Key`-заголовки;
  в dev-режиме loopback-only (см. `tools/nexus_core/api.py`).
