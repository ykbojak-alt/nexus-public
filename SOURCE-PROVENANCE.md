# SOURCE-PROVENANCE

**Baseline import предшествует спринту** (хакатон ИИкузница, спринт 2628 ноября).
Этот репозиторий собран из копий allowlist-путей; история сборки — внизу.

## 1. Исходные репозитории

| Поддерево | Источник | Ветка | Commit (исходный) | Дата commit | Грязный на момент импорта |
|---|---|---|---|---|---|
| `nexus-deck-core/` | `D:\nexus\nexus-deck-core` (commit) | master | `9ce385d9c8abb041dd4437476d770365b3fb5282` | 2026-11-07 01:47 +0300 | нет (0 изменений) |
| `nexus-deck-nue/` | `D:\nexus\nexus-deck-nue` (commit) | master | `a902c59fb04e0e672c9276fce4811ce2152be025` | 2026-11-07 18:56 +0300 | 220 изменений (это был рабочий state) |
| `tools/nexus_core/` | `D:\nexus\tools\nexus_core` (worktree) | — | — (path в корневом repo `D:\nexus`, ветка master) | 2026-11-10 | — |
| `demos/iikuznitsa-agentic/` | `D:\nexus\demos\iikuznitsa-agentic` (worktree) | — | — | 2026-11-10 | — |

> Примечание: `nexus-deck-nue/` импортирован **с незакоммиченными правками**
> (220 записей), т.к. это было рабочее состояние ветки `nue-host`.
> После импорта в этот staging внесены только sanity-правки (см. §4).

## 2. Vendored/внешние зависимости

| Путь | Происхождение | Версия/пин | Лицензия |
|---|---|---|---|
| `nexus-deck-core/vendor/ghostty` | https://github.com/ghostty-org/ghostty (gitlink) | commit `291fd050b9e9c293c8adb6a140742649b7e42d3a` — подтверждено идентичностью `src/` с nue-пином; фиксация 2026-11-10 | MIT (см. `vendor/ghostty/LICENSE`) |
| `nexus-deck-nue/vendor/ghostty` | https://github.com/ghostty-org/ghostty (gitlink) | commit `291fd050b9e9c293c8adb6a140742649b7e42d3a` | MIT |
| `nexus-deck-nue/vendor/gpui-kit` и `gpui-pre*`, `taffy`, `quickjs-jit-runtime`, `zed-xim`, `xim-ctext` | локальные path-dependencies (без git-истории в копии) | — | Apache-2.0 / MIT (см. компонентные LICENSE) |
| `tools/nexus_core/conpty/{conpty.dll,x64/OpenConsole.exe}` | Microsoft ConPTY (v1.24.260710001) из `Microsoft.Windows.Console.ConPTY` nupkg | sha256 сверены с pin в `nexus-deck-core/scripts/fetch-conpty.ps1` | MIT (Microsoft) |

## 3. Полный перечень импортированных путей

- `nexus-deck-core/**` (кроме `target/`, `.git`, vendored-бинарьев).
- `nexus-deck-nue/**` (кроме `target/`, `.git`, `nue-host.log`,
  `nexusscratchtick-before.png`).
- `tools/nexus_core/**` (кроме `state/`, `__pycache__/`, `.pytest_cache/`).
- `demos/iikuznitsa-agentic/{demo_stand.py,README-RUNBOOK.md}`.
- `docs/public/**` (заново написано для судей).

## 4. Правки при материализации (sanity/sanitization)

Санитизация «внутреннего» содержимого (локальные пути, внутренние IP/хосты,
имена внутренних машин) — список файлов с описанием изменения:

| Файл | Что изменено |
|---|---|
| `nexus-deck-nue/crates/nue-host/src/lib.rs` | дефолт `DEFAULT_REMOTE` → `https://example.invalid/v1` (реальный remote задаётся `--remote`); комментарий |
| `nexus-deck-nue/crates/nue-host/src/bin/nx-nue-host.rs` | дефолт `--root` → `<NUE_OUT_DIR>`; документация |
| `nexus-deck-nue/src/nue.rs` | `DEFAULT_UPSTREAM` → `https://example.invalid`; `DEFAULT_OUT` → `<NUE_OUT_DIR>` |
| `nexus-deck-nue/defaults/mods/nexuslink/main.js` | `gatewayBaseUrl` → `https://gateway.example.invalid` |
| `nexus-deck-nue/defaults/mods/sysmon/main.js` | `baseUrl` → `https://backend.example.invalid`; `displayName` → "remote" |
| `nexus-deck-nue/defaults/mods/nexustick/main.js` | внутренние target-адреса (`sage-pl/t2c`, `t1r`) → локалные плейсхолдеры |
| `nexus-deck-nue/crates/nue-host/tests/security.rs` | тестовые пути `C:/Users/<user>/...`, `D:/<repo>/...` → синтетические |
| `nexus-deck-nue/src/model.rs` | тестовый `C:/Users/can/...` → `C:/Users/user/...` |
| `tools/nexus_core/presets.json`, `presets.py`, `programs.py`, `test_presets.py` | `D:/nexus` → `<REPO_ROOT>` |
| `tools/nexus_core/pty_backend.py`, `system_metrics.py` | упоминания `roy1` → `Windows` |
| `tools/nexus_core/test_n6_aegis_p5.py`, `test_n6_ratings.py` | упоминания `sage-pl` → безлично |
| `nexus-deck-nue/vendor/**` | копии без `.git` (сабмодуль-пины см. §2) |

Правки **не** меняют поведение/логику (кроме дефолтов remote — они в
публичном дереве намеренно «мёртвые»; рабочий remote задаётся явно).

## 5. Дата импорта

2026-11-10 (локально), `D:\nexus-public-staging`.

## 6. Baseline-коммит

Создан в этом staging-репозитории (см. `git log -1`). Сообщение:
`chore: import pre-existing NEXUS components for hackathon`. Дата —
реальная, без backdating. Авторы не менялись.
