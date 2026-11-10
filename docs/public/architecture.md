# NEXUS — публичная архитектура (сокращённо)

## Общая картина

NEXUS: терминальный рантайм для кодинг-агентов (ядро `nx`) + нативный
десктоп-клиент (приложение `nx-app`, GPUI) + клиент NUE (Next.js static
export), который хостится локально внутри `nx-app` через `nue-host`.

```
┌───────────────────────────┐      ┌───────────────────────────────┐
│  nexus-deck-core (Rust)   │      │  nexus-deck-nue (Rust, GPUI) │
│  - супервизор терминалов  │      │  - nx-app (окно, моды)       │
│  - API: /api/core/*       │◄────►│  - nue-host (HTTP + прокси)  │
│  - AEGIS gate/audit       │      │  - манифесты Cargo, defaults │
└──────────┬────────────────┘      └──────────────┬────────────────┘
           │                                      │
           │ PYTHONPATH (api.py)                  │ --root <NUE_OUT_DIR>
           │                                      │ --remote <backend>
  ┌────────▼────────────────┐      ┌──────────────▼────────────────┐
  │ tools/nexus_core (Python)│      │ NUE-клиент (static export)    │
  │ REST + SSE, политики     │      │ /v1/* → прокси на remote      │
  └──────────┬────────────────┘      └──────────────────────────────┘
             │
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
- **`nue-host`** (`nexus-deck-nue/crates/nue-host`) — локальный HTTP-сервер
  для NUE-бандла (static export) с прокси `/v1/*` на удалённый backend.
  Безопасность N-1…N-7 (см. `security.md`).
- **`nx-app`** — GPUI-приложение; моды (JS) в `defaults/mods/` рисуются
  нативным GPU. В публичном дереве все внешние URL заменены на
  `example.invalid` — рабочие адреса задаются настройками.

## Протоколы

- Терминальный поток: raw bytes; статус — OSC 7501.
- API: JSON over HTTP (REST) + SSE для событий (`/api/core/events`).
- Аутентификация: `Authorization`/`X-API-Key`/`X-Nexus-Key`-заголовки;
  в dev-режиме loopback-only (см. `tools/nexus_core/api.py`).
