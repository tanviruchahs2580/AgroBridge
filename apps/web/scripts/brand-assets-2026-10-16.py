# One-off brand asset generator (2026-10-16). Inputs: the two owner-provided
# images. Outputs: web icons, brand badges, login background variants (webp),
# and the Android launcher/splash emblem bitmaps. Quality rule: WebP q=85
# (natural, not aggressively compressed), Lanczos resampling, light unsharp
# only where upscaling flat-color art.
from PIL import Image, ImageFilter
import os

DL = r"C:\Users\DST\Downloads"
LOGO_SRC = os.path.join(DL, "Screenshot 2026-10-16 130636.png")   # 172x139 badge
BG_SRC = os.path.join(DL, "Smart Farming at Golden Hour.png")     # 941x1672 photo
WEB = r"C:\Users\DST\projects\Agro bridge app\apps\web"
ICONS = os.path.join(WEB, "public", "icons")
BRAND = os.path.join(WEB, "public", "brand")
RES = os.path.join(WEB, "android", "app", "src", "main", "res")
os.makedirs(BRAND, exist_ok=True)

logo = Image.open(LOGO_SRC).convert("RGBA")

# Sample the badge background colour (corner pixel, away from rounded corner)
bg_r, bg_g, bg_b, _ = logo.getpixel((4, 70))
BG = (bg_r, bg_g, bg_b, 255)
print("sampled brand bg:", BG[:3])

# ---- Crop the A+leaf emblem (top-centre of the badge) ----
# Badge is 172x139; emblem occupies roughly x 52..122, y 2..78.
emblem = logo.crop((44, 0, 132, 86))
emblem.load()
print("emblem crop:", emblem.size)

def upscale(im, w, sharpen=True):
    h = round(im.height * w / im.width)
    out = im.resize((w, h), Image.LANCZOS)
    if sharpen:
        out = out.filter(ImageFilter.UnsharpMask(radius=2, percent=70, threshold=2))
    return out

def rounded_tile(im, size, radius_ratio=0.22):
    """El logo on its own background colour, rounded square."""
    tile = Image.new("RGBA", (size, size), BG)
    art = upscale(im, int(size * 0.94))
    tile.paste(art, ((size - art.width) // 2, (size - art.height) // 2), art)
    # rounded-corner alpha like the source badge
    from PIL import ImageDraw
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255)
    tile.putalpha(mask)
    return tile

def centered_on_bg(im, size, fill_ratio=0.62):
    """Emblem centred on the brand background, full-bleed square (launchers)."""
    tile = Image.new("RGBA", (size, size), BG)
    art = upscale(im, int(size * fill_ratio))
    tile.paste(art, ((size - art.width) // 2, (size - art.height) // 2), art)
    return tile

# ---- Web icon set (from the full badge for recognition, emblem for maskables) ----
rounded_tile(logo, 512).save(os.path.join(ICONS, "icon-512.png"))
rounded_tile(logo, 192).save(os.path.join(ICONS, "icon-192.png"))
rounded_tile(logo, 180).save(os.path.join(ICONS, "apple-touch-icon.png"))
centered_on_bg(emblem, 512, 0.66).save(os.path.join(ICONS, "icon-maskable.png"))
centered_on_bg(emblem, 64).save(os.path.join(ICONS, "favicon-64.png"))

# ---- In-app brand badge (used at 36–44 css px; 2x asset = 256w) ----
upscale(logo, 256).save(os.path.join(BRAND, "logo-mark.png"))

# ---- Login background: desktop (full-height) + mobile band (strip crop) ----
bg = Image.open(BG_SRC).convert("RGB")
# Desktop: keep the full portrait composition, 1600px wide, natural WebP q85
desk = bg.resize((1600, round(bg.height * 1600 / bg.width)), Image.LANCZOS)
desk.save(os.path.join(BRAND, "login-bg-desktop.webp"), "WEBP", quality=85, method=6)
# Mobile: top-band strip — sky, drone and field horizon (upper 42% of source)
strip = bg.crop((0, round(bg.height * 0.06), bg.width, round(bg.height * 0.42)))
strip = strip.resize((1080, round(strip.height * 1080 / strip.width)), Image.LANCZOS)
strip.save(os.path.join(BRAND, "login-bg-mobile.webp"), "WEBP", quality=85, method=6)
print("web backgrounds done")

# ---- Android launcher densities ----
DENS = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
for d, s in DENS.items():
    t = centered_on_bg(emblem, s, 0.68)
    t.save(os.path.join(RES, f"mipmap-{d}", "ic_launcher.png"))
    # round variant: circular mask
    from PIL import ImageDraw
    r = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    r.paste(t, (0, 0))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, s - 1, s - 1], fill=255)
    r.putalpha(mask)
    r.save(os.path.join(RES, f"mipmap-{d}", "ic_launcher_round.png"))
    # adaptive foreground: emblem inside 108dp canvas with 66dp safe zone
    fg = centered_on_bg(emblem, round(s * 108 / 48), 0.66)
    fg.save(os.path.join(RES, f"mipmap-{d}", "ic_launcher_foreground.png"))
print("mipmaps done")

# ---- Splash: nodpi emblem bitmap for the v31+ splash icon (66dp circle) ----
emblem_264 = centered_on_bg(emblem, 264, 0.80)
nodpi = os.path.join(RES, "drawable-nodpi")
os.makedirs(nodpi, exist_ok=True)
emblem_264.save(os.path.join(nodpi, "splash_emblem.png"))
# legacy compat splash image (480x320): green bg + centered badge
legacy = Image.new("RGBA", (480, 320), BG)
art = upscale(logo, 200)
legacy.paste(art, ((480 - art.width) // 2, (320 - art.height) // 2), art).convert("RGB")
Image.open(os.path.join(RES, "drawable", "splash.png"))
legacy.convert("RGB").save(os.path.join(RES, "drawable", "splash.png"))
print("splash assets done")
EOF_MARKER_NOT_USED = None
