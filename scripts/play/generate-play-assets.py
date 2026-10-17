#!/usr/bin/env python3
"""
Generate the Google Play listing artwork and the Android splash emblems from the
brand art already in the repo (apps/web/public/brand/*, public/icons/*).

Run from the repository root:

    python scripts/play/generate-play-assets.py

Outputs (committed):
    play/icon-512.png                Play Console app icon (512x512, 32-bit, no alpha)
    play/feature-graphic-1024x500.png
    apps/web/android/app/src/main/res/drawable-*/splash_emblem.png  (xhdpi..xxxhdpi)

Requires Pillow (PIL) — a maintainer tool, not a runtime dependency.
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BRAND = os.path.join(ROOT, "apps", "web", "public", "brand")
ICONS = os.path.join(ROOT, "apps", "web", "public", "icons")
RES = os.path.join(ROOT, "apps", "web", "android", "app", "src", "main", "res")
PLAY = os.path.join(ROOT, "play")

# Brand background (matches values/ic_launcher_background.xml and colors.xml).
BG = (1, 40, 35)
BG_LIGHT = (10, 47, 31)  # capacitor splash backgroundColor, used for the gradient end


def load(path):
    return Image.open(path).convert("RGBA")


def content_bbox(img, bg=BG, tol=18):
    """Bounding box of everything that differs from the flat brand background."""
    px = img.load()
    w, h = img.size
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 8 and (abs(r - bg[0]) > tol or abs(g - bg[1]) > tol or abs(b - bg[2]) > tol):
                if x < minx:
                    minx = x
                if y < miny:
                    miny = y
                if x > maxx:
                    maxx = x
                if y > maxy:
                    maxy = y
    if maxx < 0:
        raise SystemExit("no content found — background colour changed?")
    return (minx, miny, maxx + 1, maxy + 1)


def scale_to_fit(img, box_w, box_h, upscale_sharpen=True):
    w, h = img.size
    ratio = min(box_w / w, box_h / h)
    size = (max(1, int(w * ratio)), max(1, int(h * ratio)))
    out = img.resize(size, Image.LANCZOS)
    if upscale_sharpen and ratio > 1.15:
        out = out.filter(ImageFilter.UnsharpMask(radius=1.4, percent=110, threshold=3))
    return out


def paste_center(canvas, img, cx, cy):
    canvas.alpha_composite(img, (int(cx - img.width / 2), int(cy - img.height / 2)))


def find_font(names, size):
    for n in names:
        for base in (r"C:\Windows\Fonts", "/usr/share/fonts", "/Library/Fonts"):
            p = os.path.join(base, n)
            if os.path.exists(p):
                try:
                    return ImageFont.truetype(p, size)
                except Exception:
                    continue
    return ImageFont.load_default()


def build_icon():
    """512x512 Play listing icon: the emblem alone, centred on the brand colour.

    Matches the launcher icon (emblem-only) rather than the PWA icon, which also
    carries a wordmark that Play renders too small to read.
    """
    src = load(os.path.join(RES, "mipmap-xxxhdpi", "ic_launcher_foreground.png"))
    emblem = src.crop(content_bbox(src))
    canvas = Image.new("RGBA", (512, 512), BG + (255,))
    # Emblem occupies ~58% of the canvas: Play adds its own corner rounding and
    # scales the icon down in listings, so generous margin keeps it legible.
    fitted = scale_to_fit(emblem, int(512 * 0.58), int(512 * 0.58), upscale_sharpen=False)
    paste_center(canvas, fitted, 256, 256)
    out = canvas.convert("RGB")
    os.makedirs(PLAY, exist_ok=True)
    path = os.path.join(PLAY, "icon-512.png")
    out.save(path, "PNG", optimize=True)
    print(f"wrote {path} {out.size}")


def build_feature_graphic():
    """1024x500 Play feature graphic.

    Composed entirely from the repository's own brand artwork (lockup cropped
    from logo-mark.png) so the store banner uses the real typography instead of
    a re-creation in an approximate font.
    """
    W, H = 1024, 500
    # Flat brand background: the lockup is cropped from brand art whose own
    # background is this exact colour, so pasting it is seamless. A gradient
    # here left a visible rectangle around the pasted lockup.
    canvas = Image.new("RGBA", (W, H), BG + (255,))

    lockup = load(os.path.join(BRAND, "logo-mark.png"))
    lockup = lockup.crop(content_bbox(lockup))
    lockup = scale_to_fit(lockup, 430, 330)
    paste_center(canvas, lockup, 265, H // 2)

    # Divider
    d = ImageDraw.Draw(canvas)
    d.line([(520, 96), (520, H - 96)], fill=(255, 255, 255, 38), width=2)

    title_font = find_font(["seguisb.ttf", "segoeuib.ttf", "arialbd.ttf"], 34)
    body_font = find_font(["segoeui.ttf", "arial.ttf"], 25)
    tx = 566
    d.text((tx, 128), "Grow more with", font=body_font, fill=(226, 240, 230, 255))
    d.text((tx, 160), "AgroBridge", font=title_font, fill=(255, 255, 255, 255))
    bullets = [
        "AI crop advice in Bangla",
        "Weather risk alerts",
        "Buy inputs, sell harvest",
    ]
    y = 224
    for b in bullets:
        d.ellipse([tx, y + 10, tx + 9, y + 19], fill=(74, 222, 128, 255))
        d.text((tx + 22, y), b, font=body_font, fill=(214, 232, 220, 255))
        y += 46

    out = canvas.convert("RGB")
    os.makedirs(PLAY, exist_ok=True)
    path = os.path.join(PLAY, "feature-graphic-1024x500.png")
    out.save(path, "PNG", optimize=True)
    print(f"wrote {path} {out.size}")


def build_splash_emblems():
    """Higher-density splash emblems.

    The emblem shipped only at drawable-xhdpi (132px), so it was upscaled by the
    platform on xxhdpi/xxxhdpi devices — visible softness on the launch screen.
    """
    src = load(os.path.join(BRAND, "logo-emblem.png"))
    emblem = src.crop(content_bbox(src))
    targets = {"xhdpi": 132, "xxhdpi": 198, "xxxhdpi": 264}
    for density, px in targets.items():
        out = scale_to_fit(emblem, px, px)
        if out.width != px or out.height != px:
            # keep the square canvas the inset drawable expects
            sq = Image.new("RGBA", (px, px), (0, 0, 0, 0))
            paste_center(sq, out, px / 2, px / 2)
            out = sq
        path = os.path.join(RES, f"drawable-{density}", "splash_emblem.png")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        out.save(path, "PNG", optimize=True)
        print(f"wrote {path} {out.size}")


if __name__ == "__main__":
    build_icon()
    build_feature_graphic()
    build_splash_emblems()
