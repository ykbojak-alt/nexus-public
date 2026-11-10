#!/usr/bin/env python3
"""Compare current public WebP/AVIF art with declared AI2_ref crops."""
from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "apps/nexus/public"
ART = PUBLIC / "art"
EVIDENCE = ROOT / "docs/verification/evidence/wave-xxiv-w4-asset-pipeline"

NEU = ROOT / "AI2_ref/NEU"
REF = ROOT / "AI2_ref"
SPECS = [
    ("backalice-1672.webp", NEU / "Alice/backalice.png", None, "Adaptively downsize original to output dimensions"),
    ("backalice-1672.avif", NEU / "Alice/backalice.png", None, "Adaptively downsize original to output dimensions"),
    ("backalice-1280.webp", NEU / "Alice/backalice.png", None, "Adaptively downsize original to output dimensions"),
    ("backalice-1280.avif", NEU / "Alice/backalice.png", None, "Adaptively downsize original to output dimensions"),
    ("backalice-640.webp", NEU / "Alice/backalice.png", None, "Adaptively downsize original to output dimensions"),
    ("backalice-640.avif", NEU / "Alice/backalice.png", None, "Adaptively downsize original to output dimensions"),
    ("agent-alice.webp", NEU / "start.png", (564, 252, 736, 468), "Crop from declared generator box"),
    ("agent-arch.webp", NEU / "start.png", (100, 252, 242, 468), "Crop from declared generator box"),
    ("agent-codex.webp", NEU / "start.png", (809, 252, 978, 468), "Crop from declared generator box"),
    ("agent-forge.webp", NEU / "start.png", (1057, 252, 1228, 468), "Crop from declared generator box"),
    ("agent-mech.webp", NEU / "start.png", (320, 252, 488, 468), "Crop from declared generator box"),
    ("welcome-backdrop.webp", REF / "A.L.I.C.E. — пространство мысли.png", (0, 0, 1004, 778), "Crop from declared generator box"),
    ("alice-portrait-gold.webp", REF / "A.L.I.C.E. — пространство мысли.png", (60, 60, 560, 620), "Crop from declared generator box"),
    ("alice-hero-main7.webp", NEU / "main7.png", (700, 55, 1100, 440), "Crop from declared generator box"),
    ("kpi-orb-gold.webp", NEU / "main7.png", (1290, 208, 1472, 390), "Crop from declared generator box"),
    ("alice-portrait-nue.webp", NEU / "NUE1.png", (1130, 295, 1275, 600), "Crop from declared generator box"),
    ("world-map.webp", NEU / "MAIN.png", (266, 395, 478, 628), "Crop from declared generator box"),
    ("forge-city.webp", NEU / "MAIN.png", (1610, 242, 1915, 386), "Crop from declared generator box"),
]


def compare(source: Path, box: tuple[int, int, int, int] | None, output: Path) -> dict:
    with Image.open(source) as original:
        ref = original.convert("RGB")
    if box is not None:
        ref = ref.crop(box)
    with Image.open(output) as candidate:
        out = candidate.convert("RGB")
    if ref.size != out.size:
        ref = ref.resize(out.size, Image.Resampling.LANCZOS)
    diff = ImageChops.difference(ref, out)
    histogram = diff.histogram()
    samples = out.width * out.height * 3
    abs_sum = sum(value * (i % 256) for i, value in enumerate(histogram))
    squared_sum = sum(value * (i % 256) ** 2 for i, value in enumerate(histogram))
    mae = abs_sum / samples
    mse = squared_sum / samples
    psnr = None if mse == 0 else 10 * math.log10((255 * 255) / mse)
    # Exact per-channel p99 absolute error from the RGB difference histogram.
    counts = [0] * 256
    for value in range(256):
        counts[value] = sum(histogram[channel * 256 + value] for channel in range(3))
    threshold = math.ceil(samples * 0.99)
    total = 0
    p99 = 255
    for value, count in enumerate(counts):
        total += count
        if total >= threshold:
            p99 = value
            break
    return {
        "output": output.relative_to(ROOT).as_posix(),
        "source": source.relative_to(ROOT).as_posix(),
        "source_crop_or_resize": box if box else "resize full original",
        "dimensions": {"width": out.width, "height": out.height},
        "bytes": output.stat().st_size,
        "mean_absolute_channel_error_0_255": round(mae, 3),
        "p99_absolute_channel_error_0_255": p99,
        "psnr_db": None if psnr is None else round(psnr, 2),
    }


def labeled_panel(path: Path, title: str, width: int, height: int) -> Image.Image:
    with Image.open(path) as image:
        image = image.convert("RGB")
    image.thumbnail((width, height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height + 30), "#f3f0e8")
    canvas.paste(image, ((width - image.width) // 2, 30 + (height - image.height) // 2))
    ImageDraw.Draw(canvas).text((8, 8), title, fill="#222222")
    return canvas


def main() -> None:
    results = []
    for filename, source, box, method in SPECS:
        output = ART / filename
        if source.is_file() and output.is_file():
            row = compare(source, box, output)
            row["method"] = method
            results.append(row)

    EVIDENCE.mkdir(parents=True, exist_ok=True)
    result_path = EVIDENCE / "source-output-quality.json"
    result_path.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    source = NEU / "Alice/backalice.png"
    back_outputs = [ART / "backalice-1672.webp", ART / "backalice-1672.avif"]
    panels = [labeled_panel(source, "Source: AI2_ref/NEU/Alice/backalice.png", 960, 540)]
    panels.extend(labeled_panel(path, f"Converted: {path.name}", 960, 540) for path in back_outputs if path.is_file())
    comparison = Image.new("RGB", (960 * len(panels), 570), "#e5e0d6")
    for index, panel in enumerate(panels):
        comparison.paste(panel, (960 * index, 0))
    comparison.save(EVIDENCE / "backalice-source-vs-webp-avif.png", optimize=True)

    # Compact, side-by-side source/output sheet for portrait and scene-preview art.
    names = [
        "welcome-backdrop.webp", "alice-portrait-gold.webp", "alice-portrait-nue.webp",
        "alice-hero-main7.webp", "agent-alice.webp", "agent-arch.webp",
        "agent-codex.webp", "agent-forge.webp", "agent-mech.webp",
        "world-map.webp", "forge-city.webp",
    ]
    rows = []
    for row in results:
        name = Path(row["output"]).name
        if name not in names:
            continue
        source_path = ROOT / row["source"]
        box = row["source_crop_or_resize"]
        if isinstance(box, (list, tuple)):
            with Image.open(source_path) as im:
                ref = im.convert("RGB").crop(tuple(box))
        else:
            with Image.open(source_path) as im:
                ref = im.convert("RGB")
        with Image.open(ROOT / row["output"]) as im:
            current = im.convert("RGB")
        ref.thumbnail((360, 360), Image.Resampling.LANCZOS)
        current.thumbnail((360, 360), Image.Resampling.LANCZOS)
        h = max(ref.height, current.height) + 28
        strip = Image.new("RGB", (740, h), "#f3f0e8")
        draw = ImageDraw.Draw(strip)
        draw.text((8, 6), f"{name} — source | current", fill="#222222")
        strip.paste(ref, (5, 25))
        strip.paste(current, (375, 25))
        rows.append(strip)
    sheet = Image.new("RGB", (740, sum(x.height for x in rows)), "#ddd8ce")
    y = 0
    for row in rows:
        sheet.paste(row, (0, y))
        y += row.height
    sheet.save(EVIDENCE / "portraits-and-scene-art-source-vs-output.png", optimize=True)

    print(f"Measured {len(results)} source/output pairs.")
    print(f"Metrics: {result_path.relative_to(ROOT)}")
    for row in results:
        print(
            f"{Path(row['output']).name}: {row['dimensions']['width']}x{row['dimensions']['height']}, "
            f"MAE={row['mean_absolute_channel_error_0_255']}, "
            f"p99={row['p99_absolute_channel_error_0_255']}, PSNR={row['psnr_db']} dB"
        )


if __name__ == "__main__":
    main()
