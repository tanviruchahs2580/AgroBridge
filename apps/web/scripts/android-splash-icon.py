#!/usr/bin/env python3
"""
Generate the Android launch-screen icon so it matches the in-app React splash
pixel for pixel.

The in-app splash (src/components/Splash.tsx) draws, centred on the brand
backdrop:

  * a 120 dp ring track — 3.5 dp stroke, rgba(255,255,255,0.12)
  * a 64 dp white disc        — bg-white, rounded-full
  * a 56 dp logo              — /brand/logo-mark.png, rounded-2xl (16 dp radius),
                                object-cover inside the 56x56 box

`object-cover` on the 256x207 source scales it to 69.26x56 and crops to the
centre 56x56, i.e. it shows the centre 207x207 px of the source. This script
reproduces that crop, rounds it to 16 dp of a 56 dp box, and composites it into
the disc.

Output is one PNG per density whose *pixel* size is 288 dp (the Android 12+
splash icon canvas), so the framework reports a 288 dp intrinsic size and draws
the artwork at its authored dp size regardless of device density or of whether
the platform scales the drawable into its icon box.

Run from apps/web:  python scripts/android-splash-icon.py
"""
from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw

# dp values, straight from Splash.tsx
CANVAS = 288.0
RING_D = 120.0
RING_STROKE = 3.5
RING_ALPHA = 0.12
DISC_D = 64.0
LOGO_D = 56.0
LOGO_RADIUS = 16.0

DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}

HERE = pathlib.Path(__file__).resolve().parent
WEB = HERE.parent
SRC_LOGO = WEB / "public" / "brand" / "logo-mark.png"
RES = WEB / "android" / "app" / "src" / "main" / "res"

# Supersample the raster edges so the circle and rounded corners stay clean at
# every density; flattened before writing.
SS = 4


def logo_tile(px: int) -> Image.Image:
    """The 56 dp rounded logo tile as Splash.tsx renders it (object-cover crop)."""
    src = Image.open(SRC_LOGO).convert("RGBA")
    w, h = src.size
    side = min(w, h)  # object-cover in a square box: the centre square survives
    left = (w - side) // 2
    top = (h - side) // 2
    tile = src.crop((left, top, left + side, top + side)).resize((px, px), Image.LANCZOS)

    radius = int(round(px * LOGO_RADIUS / LOGO_D))
    mask = Image.new("L", (px * 4, px * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, px * 4 - 1, px * 4 - 1), radius=radius * 4, fill=255
    )
    mask = mask.resize((px, px), Image.LANCZOS)
    out = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    out.paste(tile, (0, 0), mask)
    return out


def build(scale: float) -> Image.Image:
    """One density: a 288 dp canvas drawn at `scale` px per dp."""
    side = int(round(CANVAS * scale))
    big = side * SS
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    c = big / 2.0

    def circle(diameter_dp: float, **kw):
        d = diameter_dp * scale * SS
        draw.ellipse((c - d / 2, c - d / 2, c + d / 2, c + d / 2), **kw)

    # ring track
    stroke = RING_STROKE * scale * SS
    circle(RING_D - RING_STROKE, outline=(255, 255, 255, int(round(255 * RING_ALPHA))), width=int(round(stroke)))
    # white disc
    circle(DISC_D, fill=(255, 255, 255, 255))

    logo_px = int(round(LOGO_D * scale * SS))
    tile = logo_tile(logo_px)
    canvas.alpha_composite(tile, (int(round(c - logo_px / 2)), int(round(c - logo_px / 2))))

    return canvas.resize((side, side), Image.LANCZOS)


def main() -> None:
    for name, scale in DENSITIES.items():
        out_dir = RES / f"drawable-{name}"
        out_dir.mkdir(parents=True, exist_ok=True)
        img = build(scale)
        path = out_dir / "splash_logo.png"
        img.save(path, optimize=True)
        print(f"{path.relative_to(WEB.parent.parent)}  {img.size[0]}px  {path.stat().st_size // 1024}kB")


if __name__ == "__main__":
    main()
