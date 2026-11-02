#!/usr/bin/env python3
"""Gera PNG, ICO e mipmaps Android do ícone JARVES a partir de desenho vetorial rasterizado."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"
FRONTEND = ROOT / "frontend"


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def paint_mark(draw: ImageDraw.ImageDraw, size: int, color: tuple[int, int, int, int]) -> None:
    s = size / 512
    # Letter J stem + hook
    draw.rounded_rectangle((int(214 * s), int(118 * s), int(292 * s), int(330 * s)), radius=int(18 * s), fill=color)
    draw.pieslice((int(140 * s), int(250 * s), int(292 * s), int(402 * s)), start=0, end=180, fill=color)
    draw.pieslice((int(176 * s), int(286 * s), int(256 * s), int(366 * s)), start=0, end=180, fill=(0, 0, 0, 0))
    draw.ellipse((int(328 * s), int(128 * s), int(372 * s), int(172 * s)), fill=color)


def render_icon(size: int, accent: tuple[int, int, int], alt: bool = False) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    radius = int(size * 0.22)
    pad = max(1, size // 64)
    outer = (8, 18, 36, 255) if not alt else (12, 8, 28, 255)
    inner = accent + (255,)
    draw.rounded_rectangle((pad, pad, size - pad - 1, size - pad - 1), radius=radius, fill=outer)
    inset = int(size * 0.08)
    draw.rounded_rectangle(
        (inset, inset, size - inset - 1, size - inset - 1),
        radius=max(8, radius - inset // 2),
        fill=inner,
    )
    mark = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mdraw = ImageDraw.Draw(mark)
    paint_mark(mdraw, size, (8, 13, 26, 255))
    if alt:
        # small antenna for the alternate launcher
        mdraw.rectangle((int(size * 0.48), int(size * 0.12), int(size * 0.52), int(size * 0.22)), fill=(8, 13, 26, 255))
        mdraw.ellipse((int(size * 0.45), int(size * 0.08), int(size * 0.55), int(size * 0.16)), fill=(8, 13, 26, 255))
    glow = mark.filter(ImageFilter.GaussianBlur(radius=max(1, size // 48)))
    layer = Image.alpha_composite(layer, glow)
    layer = Image.alpha_composite(layer, mark)
    mask = rounded_mask(size, radius)
    img.paste(layer, (0, 0))
    img.putalpha(mask)
    return img


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    master = render_icon(1024, (54, 214, 194))
    alt = render_icon(1024, (119, 135, 255), alt=True)
    save_png(master.resize((512, 512), Image.Resampling.LANCZOS), BUILD / "icon.png")
    save_png(master.resize((256, 256), Image.Resampling.LANCZOS), BUILD / "icon-256.png")
    save_png(alt.resize((512, 512), Image.Resampling.LANCZOS), BUILD / "icon-alt.png")
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_images = [master.resize((n, n), Image.Resampling.LANCZOS) for n in ico_sizes]
    master.resize((256, 256), Image.Resampling.LANCZOS).save(
        BUILD / "icon.ico",
        format="ICO",
        sizes=[(n, n) for n in ico_sizes],
        append_images=ico_images,
    )
    densities = {
        "mdpi": 48,
        "hdpi": 72,
        "xhdpi": 96,
        "xxhdpi": 144,
        "xxxhdpi": 192,
    }
    for name, px in densities.items():
        folder = ANDROID_RES / f"mipmap-{name}"
        save_png(master.resize((px, px), Image.Resampling.LANCZOS), folder / "ic_launcher.png")
        save_png(alt.resize((px, px), Image.Resampling.LANCZOS), folder / "ic_launcher_alt.png")
    frontend_assets = FRONTEND / "assets"
    frontend_assets.mkdir(parents=True, exist_ok=True)
    save_png(master.resize((192, 192), Image.Resampling.LANCZOS), frontend_assets / "icon-192.png")
    save_png(master.resize((512, 512), Image.Resampling.LANCZOS), frontend_assets / "icon-512.png")
    print("icons written")


if __name__ == "__main__":
    main()
