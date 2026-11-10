# THIRD-PARTY-NOTICES

Сторонние компоненты в этом репозитории и их лицензии.
Аудит: 2026-11-10. Каждый компонент имеет LICENSE-файл в репо или
подтверждённый upstream-источник.

## Таблица компонентов

| Компонент | Где | Источник + версия/ревизия | Лицензия | Файл лицензии в репо | Применимость |
|---|---|---|---|---|---|
| **Microsoft ConPTY** | `tools/nexus_core/conpty/` | Microsoft `v1.24.11911.0` (`1.24.260710001.nupkg`) | MIT | `nexus-deck-core/distribution/windows/Microsoft.Windows.Console.ConPTY-LICENSE.txt` + `-NOTICE.md` | обязателен на Windows (демо-терминалы); опционален на Linux/macOS |
| **Ghostty** | `nexus-deck-core/vendor/ghostty`, `nexus-deck-nue/vendor/ghostty` (gitlink) | https://github.com/ghostty-org/ghostty @ `291fd050b9e9c293c8adb6a140742649b7e42d3a` | MIT | `vendor/ghostty/LICENSE` (после `git submodule update`) | обязателен для полной сборки `nx-app`/`nexus-core`; тесты nue-host и демо не требуют |
| **gpui-kit** | `nexus-deck-nue/vendor/gpui-kit` | Longbridge (2024-2026) | Apache-2.0 | `vendor/gpui-kit/LICENSE-APACHE` | обязателен (workspace dep) |
| **gpui-pre (все: apple/linux/macos/wgpu/windows/pre)** | `nexus-deck-nue/vendor/gpui-pre*` | Zed Industries (2022-2025) | Apache-2.0 | `vendor/gpui-pre*/LICENSE-APACHE` | обязателен (workspace dep) |
| **quickjs-jit-runtime** | `nexus-deck-nue/vendor/quickjs-jit-runtime` | quickjs-jit (Longbridge) | MIT | `vendor/quickjs-jit-runtime/LICENSE` + `licenses/QuickJS.txt`, `licenses/QuickJS-source.txt` | обязателен |
| **taffy** | `nexus-deck-nue/vendor/taffy` | DioxusLabs | MIT | `vendor/taffy/LICENSE` | обязателен |
| **zed-xim** | `nexus-deck-nue/vendor/zed-xim` | Zed Industries | MIT | `vendor/zed-xim/LICENSE` | обязателен |
| **xim-ctext** | `nexus-deck-nue/vendor/xim-ctext` | ctext | MIT | `vendor/xim-ctext/LICENSE` | обязателен |
| **Шрифты** | `nexus-deck-nue/assets/fonts/`, `defaults/mods/win98/fonts/` | Geist (Vercel), JetBrains Mono, PixelatedMS Sans Serif, PxPlus, Symbols Nerd Font | SIL OFL / CC0 / MSSansSerif | `assets/fonts/*.txt`, `defaults/mods/win98/fonts/LICENSE-*` | обязателен (ассеты UI) |
| **Иконки** | `nexus-deck-nue/defaults/icons/` | LobeHub, Lucide | Apache-2.0 / ISC | `defaults/icons/LICENSE-LobeHub.txt`, `defaults/icons/LICENSE-Lucide.txt`, `defaults/icons/LICENSES.md` | обязателен (ассеты UI) |
| **Прочие код-зависимости** | Cargo.lock (nue), `nexus-deck-nue/THIRD-PARTY-NOTICES` | см. генерённый манифест (SHA256-пины внутри) | Apache/MIT/прочие | `THIRD-PARTY-NOTICES` (nue) + `licenses/` | обязателен для сборки |

## Происхождение и проверка

- ConPTY: перепроверка `scripts/fetch-conpty.ps1` (sha256-пины:
  `conpty.dll` → `39fba271…`, `OpenConsole.exe` → `b7fd936c…`).
- Ghostty: пин в `.gitmodules` (оба пути); источник публичный.
- gpui/quickjs/taffy/xim/zed: локальные vendored-копии с LICENSE внутри.
- Полный список зависимостей Rust: `nexus-deck-nue/THIRD-PARTY-NOTICES`
  (генерируется `just notices`).

## Что НЕ вошло / требует подтверждения владельца

- `tools/nexus_core` (Python, first-party) — не имеет собственного LICENSE;
  решение владельца по Apache-2.0 (см. README/SOURCE-PROVENANCE).
- Если какой-либо компонент не может подтвердить лицензию — не публиковать
  до подтверждения владельцем.

## Политика

- При обновлении vendored-компонентов — обновлять этот файл и `.gitmodules`.
- Локальные/оригинальные части NEXUS — Apache-2.0 (`LICENSE` в корне).
