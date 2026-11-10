#!/usr/bin/env python3
"""Build a factual inventory of raster/vector assets under apps/nexus/public."""
from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "apps/nexus/public"
SRC = ROOT / "apps/nexus/src"
OUT = ROOT / "docs/verification/wave-XXIV-W4-art-registry.json"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".ico", ".svg"}

MANIFEST_ROW = re.compile(r"^\|\s*`art/([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|")


def text_files() -> list[tuple[Path, str]]:
    result = []
    for path in SRC.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in {".ts", ".tsx", ".js", ".jsx", ".css", ".json"}:
            continue
        try:
            result.append((path, path.read_text(encoding="utf-8")))
        except (UnicodeError, OSError):
            continue
    return result


def read_art_manifest() -> dict[str, dict[str, str]]:
    manifest = PUBLIC / "art/MANIFEST.md"
    rows: dict[str, dict[str, str]] = {}
    if not manifest.is_file():
        return rows
    for line in manifest.read_text(encoding="utf-8").splitlines():
        match = MANIFEST_ROW.match(line)
        if not match:
            continue
        name, source, crop, dimensions, weight, purpose, alt = match.groups()
        rows[f"art/{name}"] = {
            "source": source,
            "crop": crop,
            "manifestDimensions": dimensions.strip(),
            "manifestWeight": weight.strip(),
            "purpose": purpose.strip(),
            "alt": alt.strip(),
        }
    return rows


def provenance(rel: str, manifest: dict[str, dict[str, str]], slide_sources: list[Path]) -> dict:
    if rel in manifest:
        row = manifest[rel]
        source = row["source"]
        if source.startswith("AI2_ref/"):
            return {
                **row,
                "source": source,
                "author": "нет данных",
                "license": "нет данных",
                "attribution": "нет данных",
                "rightsNote": "AI2_ref/AI2REF — происхождение/референс, не лицензия; только внутреннее использование подтверждено локально.",
            }
        return {**row, "author": "нет данных", "license": "нет данных", "attribution": "нет данных"}

    if rel.startswith("art/alice-slide-") and re.search(r"alice-slide-\d+\.(?:png|webp)$", rel):
        match = re.search(r"alice-slide-(\d+)\.", rel)
        source_name = "нет данных"
        if match:
            index = int(match.group(1)) - 1
            copied_source = PUBLIC / f"art/alice-slide-{index + 1:02d}.png"
            if 0 <= index < len(slide_sources) and copied_source.is_file():
                if hashlib.sha256(copied_source.read_bytes()).digest() == hashlib.sha256(slide_sources[index].read_bytes()).digest():
                    source_name = f"AI2_ref/NEU/Alice/backNEW/{slide_sources[index].name}"
        return {
            "source": source_name,
            "crop": "полный кадр; PNG-копия или WebP-производное slideshow",
            "purpose": "Публичная копия/производное слайда A.L.I.C.E.; в текущем коде нет ссылки на это имя.",
            "alt": "нет данных",
            "author": "нет данных",
            "license": "нет данных",
            "attribution": "нет данных",
            "rightsNote": "AI2_ref — внутренний референс, не лицензия; право публичного распространения требует подтверждения.",
        }

    if rel.startswith("slides/alice-slide-"):
        return {
            "source": slide_source_for(rel, slide_sources),
            "crop": "полный кадр, resize",
            "purpose": "Фоновый слайд темы A.L.I.C.E.; индекс 01–61, размер из суффикса имени.",
            "alt": "Декоративный фон темы A.L.I.C.E.",
            "author": "нет данных",
            "license": "нет данных",
            "attribution": "нет данных",
            "rightsNote": f"AI2_ref — внутренний референс, не лицензия. В текущем backNEW {len(slide_sources)} PNG, а output 61 слайд; нумерация не подтверждает точный provenance каждого файла.",
        }

    if rel.startswith("durak/"):
        source_name = "нет данных"
        crop = "см. scripts/build-durak-assets.py"
        leaf = Path(rel).name
        if rel.startswith("durak/agents/bg-"):
            names = {
                "alice": "A.L.I.C.E. — пространство мысли.png",
                "arch": "Пять ИИ-агентов в золотом Нексусе.png",
                "codex": "Пять ИИ-агентов в золотом Нексусе.png",
                "forge": "Пять ИИ-агентов в золотом Нексусе.png",
                "mech": "Пять ИИ-агентов в золотом Нексусе.png",
            }
            source_name = names.get(leaf.removeprefix("bg-").removesuffix(".webp"), "нет данных")
        elif rel.startswith("durak/agents/"):
            source_name = "Золотая команда агентов A.L.I.C.E.png"
        elif rel.startswith("durak/faces/spades-") or leaf == "back-spades.webp" or leaf == "back.webp":
            source_name = "cards/Роскошная колода Пики_ Хаос и Свобода.png"
        elif rel.startswith("durak/faces/hearts-") or leaf == "back-hearts.webp":
            source_name = "cards/Роскошная колода Червей_ Любовь и символика.png"
        elif rel.startswith("durak/faces/diamonds-14"):
            source_name = "cards/Роскошная колода бубновых карт.png"
        elif rel.startswith("durak/faces/diamonds-"):
            source_name = "cards/Бархатная колода бубновых придворных карт.png"
        elif rel.startswith("durak/faces/clubs-14"):
            source_name = "cards/Королевская колода треф в готическом стиле.png"
        elif rel.startswith("durak/faces/clubs-"):
            source_name = "cards/Барочная колода_ портреты трефовых фигур.png"
        elif leaf == "back-diamonds.webp":
            source_name = "cards/Концепт колоды Бубны_ Власть и Ресурс.png"
        elif leaf == "back-clubs.webp":
            source_name = "cards/Роскошная колода крестей в стиле стимпанк.png"
        return {
            "source": f"D:/Downloads/AI2_ref/{source_name}" if source_name != "нет данных" else source_name,
            "crop": crop,
            "purpose": "Игровой арт «Дурак»: лица карт, рубашка или портрет/фон ассистента.",
            "alt": "Назначение определяется рангом/мастью или id ассистента в имени файла.",
            "author": "нет данных",
            "license": "нет данных",
            "attribution": "нет данных",
            "rightsNote": "Источник — локальные AI-2 референсы по скрипту; авторские права/условия не подтверждены.",
        }

    if rel.startswith("sols/"):
        item = Path(rel).name
        usage = "Авторская колода SOLAS, 64 карты." if "/cards/" in f"/{rel}" else "Рубашка/фон колоды SOLAS."
        return {
            "source": "references/concepts/2026-10-13-solas-oracle-pack (README/meta: исходники D:/Downloads/AI2_ref/song); точная исходная PNG для данного файла — нет данных",
            "crop": "нет данных",
            "purpose": usage,
            "alt": "Иллюстрация колоды SOLAS; текстовый alt в продукте по имени/данным карты — нет данных в файловом реестре.",
            "author": "нет данных",
            "license": "нет данных",
            "attribution": "нет данных",
            "rightsNote": "Пакет называет колоду авторской, но автора/лицензию исходных изображений не фиксирует.",
        }

    if rel == "alice/alice-light.png":
        return {
            "source": "нет данных",
            "crop": "нет данных",
            "purpose": "Назначение не установлено; ссылка в приложении не найдена.",
            "alt": "нет данных",
            "author": "нет данных",
            "license": "нет данных",
            "attribution": "нет данных",
            "rightsNote": "Не удалять: неиспользуемый кандидат требует решения владельца и поиска источника.",
        }

    return {
        "source": "нет данных",
        "crop": "неприменимо или нет данных",
        "purpose": "нет данных",
        "alt": "нет данных",
        "author": "нет данных",
        "license": "нет данных",
        "attribution": "нет данных",
        "rightsNote": "Источник/назначение из локальных метаданных не установлены.",
    }


def slide_source_for(rel: str, slide_sources: list[Path]) -> str:
    match = re.search(r"alice-slide-(\d+)-", rel)
    index = int(match.group(1)) - 1 if match else -1
    copied_source = PUBLIC / f"art/alice-slide-{index + 1:02d}.png"
    if 0 <= index < len(slide_sources) and copied_source.is_file():
        if hashlib.sha256(copied_source.read_bytes()).digest() == hashlib.sha256(slide_sources[index].read_bytes()).digest():
            return f"AI2_ref/NEU/Alice/backNEW/{slide_sources[index].name}"
    return "AI2_ref/NEU/Alice/backNEW/*.png; exact output-to-source mapping is нет данных"


def uses_for(rel: str, source_files: list[tuple[Path, str]]) -> list[dict[str, str]]:
    name = Path(rel).name
    hits = []
    for path, text in source_files:
        if rel in text or f"/{rel}" in text or name in text:
            hits.append({"path": path.relative_to(ROOT).as_posix(), "match": "literal path/name"})

    # These groups are addressed by typed runtime templates rather than a literal filename.
    if rel.startswith("durak/faces/"):
        return [{"path": "apps/nexus/src/product/durak/screen.tsx", "match": "dynamic template /durak/faces/{suit}-{rank}.webp"}]
    if rel.startswith("durak/agents/bg-"):
        return [{"path": "apps/nexus/src/product/durak/screen.tsx", "match": "dynamic template /durak/agents/bg-{personaId}.webp"}]
    if rel.startswith("durak/agents/"):
        return [
            {"path": "apps/nexus/src/product/durak/screen.tsx", "match": "dynamic template /durak/agents/{personaId}.webp"},
            {"path": "apps/nexus/src/product/chess/screen.tsx", "match": "dynamic template /durak/agents/{personaId}.webp"},
        ]
    if rel.startswith("durak/back-"):
        return [{"path": "apps/nexus/src/product/durak/screen.tsx", "match": "dynamic template /durak/back-{suit}.webp"}]
    if rel == "durak/back.webp":
        return [{"path": "apps/nexus/src/product/games/screen.tsx", "match": "literal /durak/back.webp"}]
    if rel.startswith("sols/cards/"):
        matches = [{"path": "apps/nexus/src/product/oracle/screen.tsx", "match": "dynamic template /sols/cards/{NN}.webp"}]
        if name == "43.webp":
            matches.append({"path": "apps/nexus/src/product/games/screen.tsx", "match": "literal promo /sols/cards/43.webp"})
        return matches
    if rel.startswith("sols/backs/"):
        return [{"path": "apps/nexus/src/product/oracle/screen.tsx", "match": "dynamic template /sols/backs/{section}.webp"}]
    if rel.startswith("slides/alice-slide-"):
        return [{"path": "apps/nexus/src/product/app-shell.tsx", "match": "dynamic slideshow URL uses /art/alice-slide-{NN}-1280.webp; files are under /slides/ (path mismatch)"}]
    if rel.startswith("art/alice-slide-"):
        return [{"path": "apps/nexus/src/product/app-shell.tsx", "match": "no exact file URL: app requests /art/alice-slide-{NN}-1280.webp; these files are unreferenced source copies/other sizes"}] if "/1280." in rel else []
    return hits


def dimensions(path: Path) -> dict:
    if path.suffix.lower() == ".svg":
        text = path.read_text(encoding="utf-8", errors="replace")
        root = re.search(r"<svg\b([^>]*)", text, flags=re.I | re.S)
        attrs = root.group(1) if root else ""
        viewbox = re.search(r"\bviewBox=[\"']([^\"']+)", attrs, flags=re.I)
        width = re.search(r"\bwidth=[\"']([^\"']+)", attrs, flags=re.I)
        height = re.search(r"\bheight=[\"']([^\"']+)", attrs, flags=re.I)
        return {"width": width.group(1) if width else None, "height": height.group(1) if height else None, "viewBox": viewbox.group(1) if viewbox else None}
    try:
        with Image.open(path) as image:
            return {"width": image.width, "height": image.height}
    except Exception:
        return {"width": None, "height": None}


def main() -> None:
    manifest = read_art_manifest()
    sources = text_files()
    ai2_slide_dir = ROOT / "AI2_ref/NEU/Alice/backNEW"
    slide_sources = sorted(ai2_slide_dir.glob("*.png")) if ai2_slide_dir.is_dir() else []
    assets = []
    for path in sorted(PUBLIC.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTS:
            continue
        rel = path.relative_to(PUBLIC).as_posix()
        info = provenance(rel, manifest, slide_sources)
        uses = uses_for(rel, sources)
        duplicate_sha = hashlib.sha256(path.read_bytes()).hexdigest()
        if rel == "alice/alice-light.png" or not uses:
            usage_status = "unreferenced_candidate"
        elif rel.startswith("slides/alice-slide-") and "/art/" in uses[0]["match"]:
            usage_status = "reference_path_mismatch"
        else:
            usage_status = "referenced"
        assets.append({
            "path": f"apps/nexus/public/{rel}",
            "format": path.suffix.lower().lstrip("."),
            "bytes": path.stat().st_size,
            "dimensions": dimensions(path),
            "sha256": duplicate_sha,
            "purpose": info["purpose"],
            "source": info["source"],
            "crop_or_transform": info["crop"],
            "author": info["author"],
            "license": info["license"],
            "attribution_required": info["attribution"],
            "alt_or_accessibility": info["alt"],
            "used_by": uses,
            "usage_status": usage_status,
            "rights_note": info["rightsNote"],
        })

    by_hash: dict[str, list[str]] = defaultdict(list)
    for asset in assets:
        by_hash[asset["sha256"]].append(asset["path"])
    duplicates = [
        {"sha256": digest, "paths": paths}
        for digest, paths in sorted(by_hash.items()) if len(paths) > 1
    ]
    unreferenced = [a["path"] for a in assets if a["usage_status"] == "unreferenced_candidate"]
    path_mismatches = [a["path"] for a in assets if a["usage_status"] == "reference_path_mismatch"]

    result = {
        "registry_version": 1,
        "generated_by": "scripts/build-web-art-registry.py",
        "scope": "Raster/vector files in apps/nexus/public. Does not include inline SVGs, font files, generated out/ copies, or Unreal-only assets.",
        "assets_count": len(assets),
        "total_bytes": sum(a["bytes"] for a in assets),
        "sha256_duplicate_groups": duplicates,
        "unreferenced_candidates": unreferenced,
        "reference_path_mismatches": path_mismatches,
        "assets": assets,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Registry: {OUT.relative_to(ROOT)}")
    print(f"Assets: {len(assets)}, bytes: {result['total_bytes']}, exact duplicate groups: {len(duplicates)}")
    print(f"Unreferenced candidates: {len(unreferenced)}, path mismatches: {len(path_mismatches)}")
    for group in duplicates:
        print("DUPLICATE:", " | ".join(group["paths"]))


if __name__ == "__main__":
    main()
