#!/usr/bin/env python3
"""Crop Durak card faces + agent avatars from AI-2 reference boards.

Source: D:/Downloads/AI2_ref (user-provided concept refs).
Output: apps/nexus/public/durak/{faces,agents}/ — webp.

Координаты:
- A-9 доски (spades/hearts, ~1673x940): явные боксы A9_BOXES, сняты edge-сканом
  (предыдущая сетка x0=215 step=145 давала дрейф к правым картам — карты ~150-200px).
- 5x2 доски (1536x1024): col=i*307, row=0|1*500, карта почти в ячейку.
- Мультиагент (1672x941): бюсты по фигурам референса.
"""
import os
from PIL import Image

REF = r"D:/Downloads/AI2_ref"
OUT = r"D:/nexus/apps/nexus/public/durak"
FACE_W = 300
AGENT_SZ = 320

os.makedirs(f'{OUT}/faces', exist_ok=True)
os.makedirs(f'{OUT}/agents', exist_ok=True)


def crop_save(img, box, path, width=FACE_W, inset=2):
    # Врезка на 2px со всех сторон — срезает внешние артефакты рамки доски.
    x0, y0, x1, y1 = box
    c = img.crop((x0 + inset, y0 + inset, x1 - inset, y1 - inset))
    h = round(c.height * width / c.width)
    c.resize((width, h), Image.LANCZOS).save(path, 'WEBP', quality=90)
    print(f"  {os.path.relpath(path, OUT)}  {box}")


def avatars():
    team = Image.open(os.path.join(REF, 'Золотая команда агентов A.L.I.C.E.png'))
    # Хуманоидные портреты — круглые бабблы «Золотая команда агентов» (1670x942).
    boxes = {
        'alice': (team, (340, 168, 575, 438)),
        'forge': (team, (838, 198, 942, 300)),
        'mech': (team, (654, 258, 756, 352)),
        'codex': (team, (1022, 272, 1126, 368)),
        'arch': (team, (579, 438, 683, 534)),
    }
    for name, (img, box) in boxes.items():
        c = img.crop(box)
        h = round(c.height * 240 / c.width)
        c.resize((240, h), Image.LANCZOS).save(
            f'{OUT}/agents/{name}.webp', 'WEBP', quality=88)
        print(f'  agents/{name}.webp  {box}')


# Явные боксы — замерены edge-сканом по исходным доскам (13.10, правка после «кривой нарезки»).
A9_BOXES = {
    'spades': {
        # Пики_ Хаос и Свобода.png (1673x940)
        'top': {
            14: (241, 28, 401, 303), 6: (1047, 28, 1190, 303),
            7: (1203, 28, 1351, 303), 8: (1363, 28, 1506, 303),
            9: (1519, 28, 1663, 303),
        },
        'mid': {
            10: (249, 360, 442, 652), 11: (460, 360, 647, 652),
            12: (662, 360, 858, 652), 13: (872, 360, 1066, 652),
        },
        'back': (1109, 360, 1306, 652),
    },
    'hearts': {
        # Червей_ Любовь и символика.png (1672x941)
        'top': {
            14: (233, 26, 386, 310), 6: (1033, 26, 1183, 310),
            7: (1194, 26, 1343, 310), 8: (1354, 26, 1502, 310),
            9: (1513, 26, 1653, 310),
        },
        'mid': {
            10: (238, 361, 409, 659), 11: (422, 361, 581, 659),
            12: (593, 361, 755, 659), 13: (766, 361, 945, 659),
        },
        'back': (984, 361, 1230, 659),
    },
}


def a9_board(fname, suit, save_back=True):
    """A-9 в верхнем ряду, 10 J Q K + рубашка + коробка в среднем."""
    img = Image.open(os.path.join(REF, fname))
    p = A9_BOXES[suit]
    for rank, box in {**p['top'], **p['mid']}.items():
        crop_save(img, box, f'{OUT}/faces/{suit}-{rank}.webp')
    if save_back:
        crop_save(img, p['back'], f'{OUT}/back-{suit}.webp')
        if suit == 'spades':
            # Легаси-плитка /games и запасной вариант.
            crop_save(img, p['back'], f'{OUT}/back.webp')


# Рубашки остальных колод — с их собственных досок.
EXTRA_BACKS = {
    # Концепт колоды Бубны_ Власть и Ресурс.png (1672x941) — красная рубашка с алмазом.
    'diamonds': ('cards/Концепт колоды Бубны_ Власть и Ресурс.png', (1154, 366, 1350, 718)),
    # Роскошная колода крестей в стиле стимпанк.png (1672x941) — синяя стимпанк-рубашка.
    'clubs': ('cards/Роскошная колода крестей в стиле стимпанк.png', (1025, 356, 1307, 704)),
}


def extra_back(fname, suit, box):
    img = Image.open(os.path.join(REF, fname))
    crop_save(img, box, f'{OUT}/back-{suit}.webp')


def board5x2(fname, suit):
    """1536x1024: top J Q K 10 9 / bottom 8 7 6 5 4."""
    img = Image.open(os.path.join(REF, fname))
    cw, rh = 307, 500
    for i, rank in enumerate([11, 12, 13, 10, 9]):
        crop_save(img, (i * cw + 4, 6, (i + 1) * cw - 4, 494),
                  f'{OUT}/faces/{suit}-{rank}.webp')
    for i, rank in enumerate([8, 7, 6, 5, 4]):
        if rank in (8, 7, 6):
            crop_save(img, (i * cw + 4, 506, (i + 1) * cw - 4, 994),
                      f'{OUT}/faces/{suit}-{rank}.webp')


def ace_from(fname, suit):
    """Готическая доска 1536x1024: top A 2 3 4 5."""
    img = Image.open(os.path.join(REF, fname))
    crop_save(img, (4, 6, 303, 494), f'{OUT}/faces/{suit}-14.webp')


# Фоны панелей агентов — декоративные зоны UI-референсов в палитре персоны
# (без аватарок, лиц и карточных досок). Четыре фона — среды агентов с доски
# «Пять ИИ-агентов в золотом Нексусе», кроп над заголовками карточек-выбора.
AGENT_BGS = {
    'alice': ('A.L.I.C.E. — пространство мысли.png', (640, 140, 1040, 560)),
    'forge': ('Пять ИИ-агентов в золотом Нексусе.png', (345, 150, 650, 540)),
    'mech': ('Пять ИИ-агентов в золотом Нексусе.png', (1010, 140, 1310, 540)),
    'codex': ('Пять ИИ-агентов в золотом Нексусе.png', (1345, 90, 1655, 535)),
    'arch': ('Пять ИИ-агентов в золотом Нексусе.png', (665, 150, 990, 400)),
}


def agent_bgs():
    """Фоновые кропы панелей агентов — декоративные зоны референсов
    в цветовой палитре персоны (под аватарку, без лиц/фигур)."""
    for name, (fname, box) in AGENT_BGS.items():
        c = Image.open(os.path.join(REF, fname)).convert('RGB').crop(box)
        h = round(c.height * 560 / c.width)
        c.resize((560, h), Image.LANCZOS).save(
            f'{OUT}/agents/bg-{name}.webp', 'WEBP', quality=86)
        print(f'  agents/bg-{name}.webp  {fname} {box}')


import sys
if '--bgs-only' in sys.argv:
    agent_bgs()
else:
    avatars()
    agent_bgs()
    a9_board('cards/Роскошная колода Пики_ Хаос и Свобода.png', 'spades')
    a9_board('cards/Роскошная колода Червей_ Любовь и символика.png', 'hearts')
    for suit, (fname, box) in EXTRA_BACKS.items():
        extra_back(fname, suit, box)
    board5x2('cards/Бархатная колода бубновых придворных карт.png', 'diamonds')
    board5x2('cards/Барочная колода_ портреты трефовых фигур.png', 'clubs')
    ace_from('cards/Роскошная колода бубновых карт.png', 'diamonds')
    ace_from('cards/Королевская колода треф в готическом стиле.png', 'clubs')
    print('done')
