#!/usr/bin/env python3
"""Visual-3 V1: обрезка арта NEU из AI2_ref в apps/nexus/public/art/*.webp.

Волна Visual-3 (docs/superpowers/plans/runtime-wave3-visual-dispatch.md), трек V1.
Источники — референсы пользователя в D:/nexus/AI2_ref (не коммитятся).
Выход — webp ≤300 КБ на файл; манифест пишется рядом (MANIFEST.md генерится
из ASSETS ниже, чтобы файл и описание не расходились).

Правила обрезки (диспетч §«Правила волны»):
- в обрезки не попадают цифры, подписи, названия миссий, имена, элементы UI;
  каждый бокс проверен визуально на полном разрешении;
- только арт: портреты, города, фоны, свечения, текстуры.

Координаты даны в пикселях исходников (x0, y0, x1, y1), сняты просмотром
полос/областей. Источники RGB; сохраняем webp q82, ресайз до `w` сохраняя
пропорцию (LANCZOS). Скрипт идемпотентен: повторный запуск перезаписывает
те же файлы.
"""
import os
from PIL import Image

REF = r"D:/nexus/AI2_ref"
OUT = r"D:/nexus/apps/nexus/public/art"

SRC_SPACE = os.path.join(REF, "A.L.I.C.E. — пространство мысли.png")
SRC_NUE1 = os.path.join(REF, "NEU", "NUE1.png")
SRC_MAIN = os.path.join(REF, "NEU", "MAIN.png")
SRC_START = os.path.join(REF, "NEU", "start.png")
SRC_MAIN7 = os.path.join(REF, "NEU", "main7.png")
# --- волна XVIII: героини и портреты по Models/<имя> (эталон персонажей) ---
SRC_ALICE_FIG = os.path.join(REF, "Models", "ALICE", "Кибер-ангел в небесном наряде.png")
SRC_ARCH_FIG = os.path.join(REF, "Models", "ARCH", "Изображение ChatGPT 15 окт. 2026 г., 23_10_55-1.png")
SRC_ARCH_FACE = os.path.join(REF, "Models", "ARCH", "Изображение ChatGPT 15 окт. 2026 г., 23_11_35-9.png")
SRC_CODEX_FIG = os.path.join(REF, "Models", "CODEX", "Изображение ChatGPT 15 окт. 2026 г., 23_41_05-1.png")
SRC_CODEX_FACE = os.path.join(REF, "Models", "CODEX", "Изображение ChatGPT 15 окт. 2026 г., 23_41_44-9.png")
SRC_MECH_FIG = os.path.join(REF, "Models", "MECH", "Изображение ChatGPT 15 окт. 2026 г., 23_46_54-1.png")
SRC_MECH_FACE = os.path.join(REF, "Models", "MECH", "Изображение ChatGPT 15 окт. 2026 г., 23_47_39-9.png")

# (имя файла, источник, box, ширина webp, назначение, alt)
ASSETS = [
    # --- /welcome + /agent-select (экран 1) ---
    ("welcome-backdrop.webp", SRC_SPACE, (0, 0, 1004, 778), 1200, 64,
     "Фон экрана /welcome и карточек выбора агента: светлый небесный город "
     "и портрет A.L.I.C.E. слева; зона логин-карточки и подпись исключены. "
     "q=64: фон под скримом, проверено — бендинга нет (perf W4).",
     "Золотистый небесный город и профиль A.L.I.C.E., декоративный фон"),
    ("alice-portrait-gold.webp", SRC_SPACE, (60, 60, 560, 620), 520,
     "Крупный портрет A.L.I.C.E. (золотая нейрокорона) для hero-блока "
     "/home и главной карточки /agent-select.",
     "Портрет ассистента A.L.I.C.E. — профиль с золотой нейронной короной"),
    # --- пять карт ассистентов /agent-select (по start.png) ---
    ("agent-arch.webp", SRC_START, (100, 252, 242, 468), 300,
     "Арт карточки A.R.C.H. для /agent-select (верхняя часть карты, без имени).",
     "Образ ассистента A.R.C.H. — мраморная фигура с сияющей сферой"),
    ("agent-mech.webp", SRC_START, (320, 252, 488, 468), 300,
     "Арт карточки M.E.C.H. для /agent-select.",
     "Образ ассистента M.E.C.H. — андроид с синим оптическим ядром"),
    ("agent-alice.webp", SRC_START, (564, 252, 736, 468), 300,
     "Арт карточки A.L.I.C.E. для /agent-select.",
     "Образ ассистента A.L.I.C.E. — светлый портрет"),
    ("agent-codex.webp", SRC_START, (809, 252, 978, 468), 300,
     "Арт карточки C.O.D.E.X. для /agent-select.",
     "Образ ассистента C.O.D.E.X. — фигура в капюшоне с голограммой"),
    ("agent-forge.webp", SRC_START, (1057, 252, 1228, 468), 300,
     "Арт карточки F.O.R.G.E. для /agent-select.",
     "Образ ассистента F.O.R.G.E. — красный кристаллический орнамент"),
    # --- /home (экран 2, тёмная тема по NUE1) ---
    ("alice-portrait-nue.webp", SRC_NUE1, (1130, 295, 1275, 600), 300,
     "Светящийся женский профиль из центральной панели NUE1 — тёмный "
     "вариант портрета A.L.I.C.E. для /home.",
     "Светящийся профиль A.L.I.C.E. на тёмном фоне"),
    # --- /mission-control (экран 3) ---
    ("world-map.webp", SRC_MAIN, (266, 395, 478, 628), 480,
     "Мировая карта со светящимися дугами — фон блока Live Systems; "
     "точки и числа рисует только реальный источник данных.",
     "Светящаяся карта мира, декоративный фон"),
    # --- /forge (экран 4) ---
    ("forge-city.webp", SRC_MAIN, (1610, 242, 1915, 386), 680,
     "Городской вьюпорт из панели F.O.R.G.E. — фон превью-вьюпорта /forge.",
     "Небесный город на закате — вьюпорт F.O.R.G.E."),
    # --- главная /home (волна XVII, W4): герой и KPI-орб по main7 ---
    ("alice-hero-main7.webp", SRC_MAIN7, (700, 55, 1100, 440), 800,
     "Герой-арт главной: профиль A.L.I.C.E. с золотыми волосами-нитями и "
     "жемчугом на светлом фоне (main7.png, правый фрагмент героя; заголовок "
     "ALICE, список слов справа и все числа вне обрезки).",
     "Профиль A.L.I.C.E. с золотыми нитями и жемчугом, декоративный герой"),
    ("kpi-orb-gold.webp", SRC_MAIN7, (1290, 208, 1472, 390), 360,
     "Золотая орба с орбитами и жемчужинами из карточки SYSTEM STATUS "
     "(main7.png) — арт для KPI-полосы /home; числа и подписи вне обрезки, "
     "значения рисует только рантайм.",
     "Золотая орба со светящимися орбитами, декоративный арт"),
    # --- оболочка ---
    ("shell-glow.webp", SRC_NUE1, (200, 0, 1672, 46), 1600,
     "Верхняя декоративная полоса NUE1 (тёмные золотые дуги) — подложка "
     "рамки окна / верхнего свечения оболочки.",
     "Тёмные золотые дуги, декоративная полоса"),
    # --- волна XVIII: героини (полная фигура) и портреты по Models/ ---
    ("heroine-alice.webp", SRC_ALICE_FIG, (560, 10, 1120, 935), 560,
     "Героиня A.L.I.C.E. в полный рост (небесный наряд, золотые нити) — "
     "сцена ALICE и hero-блоки; фон студийный серый, без текста.",
     "Героиня A.L.I.C.E. в полный рост, жемчужно-золотой наряд"),
    ("heroine-alice@2x.webp", SRC_ALICE_FIG, (560, 10, 1120, 935), 1120,
     "То же @2x.", "Героиня A.L.I.C.E. в полный рост"),
    ("portrait-alice.webp", SRC_ALICE_FIG, (680, 0, 980, 360), 400,
     "Портрет A.L.I.C.E. (лицо и нейрокорона) — аватар/agent-select.",
     "Портрет A.L.I.C.E. — лицо с золотой нейрокороной"),
    ("portrait-alice@2x.webp", SRC_ALICE_FIG, (680, 0, 980, 360), 800,
     "То же @2x.", "Портрет A.L.I.C.E."),
    ("heroine-arch.webp", SRC_ARCH_FIG, (130, 10, 900, 1530), 560,
     "Героиня A.R.C.H. в полный рост (мрамор, лавровая корона, золото).",
     "Героиня A.R.C.H. в полный рост, мраморное платье с золотом"),
    ("heroine-arch@2x.webp", SRC_ARCH_FIG, (130, 10, 900, 1530), 1120,
     "То же @2x.", "Героиня A.R.C.H. в полный рост"),
    ("portrait-arch.webp", SRC_ARCH_FACE, (100, 30, 930, 1100), 400,
     "Портрет A.R.C.H. (лицо, лавровая корона).",
     "Портрет A.R.C.H. — лицо с лавровой короной"),
    ("portrait-arch@2x.webp", SRC_ARCH_FACE, (100, 30, 930, 1100), 800,
     "То же @2x.", "Портрет A.R.C.H."),
    ("heroine-codex.webp", SRC_CODEX_FIG, (120, 10, 910, 1530), 560,
     "Героиня C.O.D.E.X. в полный рост (чёрная вуаль, золотой орбитальный "
     "нимб).",
     "Героиня C.O.D.E.X. в полный рост, тёмная вуаль и золото"),
    ("heroine-codex@2x.webp", SRC_CODEX_FIG, (120, 10, 910, 1530), 1120,
     "То же @2x.", "Героиня C.O.D.E.X. в полный рост"),
    ("portrait-codex.webp", SRC_CODEX_FACE, (60, 30, 960, 1080), 400,
     "Портрет C.O.D.E.X. (лицо и орбитальный нимб).",
     "Портрет C.O.D.E.X. — лицо с золотым орбитальным нимбом"),
    ("portrait-codex@2x.webp", SRC_CODEX_FACE, (60, 30, 960, 1080), 800,
     "То же @2x.", "Портрет C.O.D.E.X."),
    ("heroine-mech.webp", SRC_MECH_FIG, (170, 10, 810, 1440), 560,
     "Героиня M.E.C.H. в полный рост (белый корпус, синие оптические "
     "каналы).",
     "Героиня M.E.C.H. в полный рост, белый андроид с синей подсветкой"),
    ("heroine-mech@2x.webp", SRC_MECH_FIG, (170, 10, 810, 1440), 1120,
     "То же @2x.", "Героиня M.E.C.H. в полный рост"),
    ("portrait-mech.webp", SRC_MECH_FACE, (90, 30, 990, 1100), 400,
     "Портрет M.E.C.H. (лицо, механические двойные пучки).",
     "Портрет M.E.C.H. — лицо с механическими узлами и синей подсветкой"),
    ("portrait-mech@2x.webp", SRC_MECH_FACE, (90, 30, 990, 1100), 800,
     "То же @2x.", "Портрет M.E.C.H."),
]


# Адаптивные варианты тяжёлого фона (волна XVII, W4): исходник —
# AI2_ref/NEU/Alice/backalice.png (1672x941). Форматы webp q82 + avif q70,
# ширины 640/1280/1672; больше 1672 нет смысла — исходник не шире.
# PNG-вариант намеренно не режется: при ≤400 КБ ткани дают бендинг —
# легаси-URL /art/backalice.png остаётся для совместимости до переключения
# оболочки на image-set (зона W3).
SRC_BACKALICE = os.path.join(REF, "NEU", "Alice", "backalice.png")
BACKALICE_VARIANTS = [
    ("backalice", w, h, fmt) for (w, h) in ((640, 360), (1280, 720), (1672, 941)) for fmt in ("webp", "avif")
]


def build_variants() -> list:
    rows = []
    im = Image.open(SRC_BACKALICE).convert("RGB")
    for name, w, h, fmt in BACKALICE_VARIANTS:
        c = im.resize((w, h), Image.LANCZOS)
        path = os.path.join(OUT, f"{name}-{w}.{fmt}")
        if fmt == "webp":
            c.save(path, "WEBP", quality=82, method=6)
        else:
            c.save(path, "AVIF", quality=70)
        kb = os.path.getsize(path) // 1024
        assert kb <= 400, f"{name}-{w}.{fmt}: {kb} КБ > 400 КБ бюджета"
        rows.append((f"{name}-{w}.{fmt}", SRC_BACKALICE, f"(resize {w}x{h})", f"{w}x{h}", kb,
                     f"Адаптивный вариант фона A.L.I.C.E. ({fmt}), ширина {w}px",
                     "Жемчужно-белые ткани и золотые нити, декоративный фон"))
        print(f"  {name}-{w}.{fmt:20s} {w}x{h}  {kb} КБ")
    return rows


def build() -> None:
    os.makedirs(OUT, exist_ok=True)
    rows = []
    for row in ASSETS:
        # (имя, источник, box, ширина[, quality], назначение, alt)
        fname, src, box, w = row[:4]
        quality, purpose, alt = (row[4], row[5], row[6]) if len(row) == 7 else (82, row[4], row[5])
        im = Image.open(src)
        x0, y0, x1, y1 = box
        assert x1 <= im.width and y1 <= im.height, f"{fname}: box вне {src}"
        c = im.crop(box)
        h = round(c.height * w / c.width)
        c = c.resize((w, h), Image.LANCZOS)
        path = os.path.join(OUT, fname)
        c.save(path, "WEBP", quality=quality, method=6)
        kb = os.path.getsize(path) // 1024
        assert kb <= 300, f"{fname}: {kb} КБ > 300 КБ бюджета"
        rows.append((fname, src, box, f"{w}x{h}", kb, purpose, alt))
        print(f"  {fname:28s} {w}x{h}  {kb} КБ")
    rows.extend(build_variants())
    return rows


def manifest(rows) -> None:
    lines = [
        "# Манифест арта NEU (волна Visual-3, V1)",
        "",
        "Генерируется `scripts/build-neu-art.py`. Источники — референсы",
        "`AI2_ref/` (локальная коллекция, в репо не входит). Обрезки проверены",
        "визуально: без цифр, подписей, названий и элементов интерфейса.",
        "",
        "| Файл | Источник | Обрезка (x0,y0,x1,y1) | Размер | Вес | Назначение | Alt |",
        "|---|---|---|---|---|---|---|",
    ]
    for fname, src, box, size, kb, purpose, alt in rows:
        rel = os.path.relpath(src, r"D:/nexus").replace("\\", "/")
        lines.append(f"| `art/{fname}` | `{rel}` | `{box}` | {size} | {kb} КБ | {purpose} | {alt} |")
    lines += [
        "",
        "Бюджет: ≤300 КБ/файл (кропы), ≤400 КБ на самый большой вариант",
        "фона; ≤1,5 МБ арта на маршрут. Крупные фоны (`welcome-backdrop`,",
        "`shell-glow`) подключать с `loading=\"lazy\"` или через CSS",
        "`background-image` на неблокирующих слоях.",
        "",
        "Фон `backalice-*`: легаси-URL `/art/backalice.png` (2,2 МБ) держится",
        "для совместимости; подключение по `image-set()` —",
        "`image-set(url('/art/backalice-640.avif') 640w, "
        "url('/art/backalice-1280.avif') 1280w, url('/art/backalice-1672.avif') 1672w)`",
        "с теми же webp как fallback-тип (зона W3: app-shell).",
    ]
    path = os.path.join(OUT, "MANIFEST.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"  MANIFEST.md обновлён ({len(rows)} ассетов)")


if __name__ == "__main__":
    manifest(build())
