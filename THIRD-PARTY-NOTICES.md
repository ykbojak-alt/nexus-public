# THIRD-PARTY-NOTICES

Сторонние компоненты в этом репозитории и их лицензии.

## 1. Microsoft ConPTY (ConPTY / OpenConsole)

- **Что**: `tools/nexus_core/conpty/conpty.dll`, `tools/nexus_core/conpty/x64/OpenConsole.exe`
- **Источник**: Microsoft ConPTY, релиз `v1.24.11911.0`
  (`Microsoft.Windows.Console.ConPTY.1.24.260710001.nupkg`).
- **Лицензия**: MIT (Microsoft) — полный текст в
  `nexus-deck-core/distribution/windows/Microsoft.Windows.Console.ConPTY-LICENSE.txt`
  и `-NOTICE.md`.
- **Проверка/воспроизведение**: `nexus-deck-core/scripts/fetch-conpty.ps1`
  (sha256-пины: `conpty.dll` → `39fba271…`, `OpenConsole.exe` → `b7fd936c…`).
- **Использование**: только Windows; демо-стенд требует его для терминалов.
  На Linux/macOS не используется (ForkPTYBackend).

## 2. Ghostty (vendor/ghostty)

- **Что**: `nexus-deck-core/vendor/ghostty`, `nexus-deck-nue/vendor/ghostty`
  — **gitlink (submodule)**.
- **Источник**: https://github.com/ghostty-org/ghostty
- **Ревизия**: `291fd050b9e9c293c8adb6a140742649b7e42d3a` (оба)
- **Лицензия**: MIT (см. `vendor/ghostty/LICENSE` при submodule checkout).
- **Пины**: `.gitmodules` (оба пути).

## 3. GPUI-kit / vendor path-dependencies

- `nexus-deck-nue/vendor/gpui-kit`, `gpui-pre*`, `taffy`, `quickjs-jit-runtime`,
  `zed-xim`, `xim-ctext` — локальные vendored-копии (Apache-2.0 / MIT;
  см. компонентные LICENSE в каждом).
- `nexus-deck-nue/THIRD-PARTY-NOTICES` — агрегированные notices workspace (уже в репо).

## 4. Прочее

- Иконки/системные ассеты в `nexus-deck-nue/defaults/` — см. `THIRD-PARTY-NOTICES`
  (nue) и `LICENSE`.
- Шрифты в `vendor/ghostty` — см. upstream ghostty LICENSE.

## 5. Политика

- При обновлении любых vendored-компонентов проверяйте/обновляйте лицензии и
  пины в `.gitmodules`/`SOURCE-PROVENANCE.md`.
- Производные/оригинальные части NEXUS — Apache-2.0 (`LICENSE` в корне).
