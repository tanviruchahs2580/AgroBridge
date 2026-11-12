# One-off login-hero generator (2026-11-12), same convention as
# brand-assets-2026-10-16.py: owner-provided input, Lanczos, natural WebP q=85.
#
# WHY THIS EXISTS
# `brand/login-bg-desktop.webp` is the owner's photograph (verified: squashed to
# the photo's own 720x1280 frame the mean absolute difference is 6.7, less than
# the 11.0 produced by shifting the photo two pixels against itself).
# `brand/login-bg-mobile-full.webp` was NOT: it was a hand-recomposed variant of
# the scene (docs/archive/2026-10-19/EXECUTION_LOG.md: "Recomposed (1078x2360):
# drone anchored top-right"). Measured against the photo at the same frame it
# differs by 55.8, and its drone-to-sun distance is 0.83x the photo's while its
# drone is 1.06x wider — a different perspective, not a crop. On the login page
# that put the drone on top of the wordmark and pushed the farmer off the left
# edge.
#
# The owner supplied the original photograph and a mock of the intended mobile
# screen (2026-11-12). This script recrops the photograph to that mock so the
# mobile hero and the desktop hero are finally the same picture.
#
# Inputs:  the owner's photograph (720x1280).
# Output:  apps/web/public/brand/login-bg-mobile-full.webp
#
# The crop window and the hero geometry it pairs with are recorded together in
# AuthShell.tsx; change one and you must re-measure the other.

from PIL import Image
import os

SRC = r"C:\Users\DST\Downloads\photo_6318961606678746552_y.jpg"   # owner-supplied 2026-11-12
OUT = r"C:\Users\DST\projects\Agro bridge app\apps\web\public\brand\login-bg-mobile-full.webp"

# Fractions of the source: keep the right-hand 74% of the width and everything
# below the top 21.7%; the mock drops the uppermost sky. Derived by fitting the
# mock: with this window shown at full-bleed in an 85dvh band the drone lands at
# y=66 with a 178px body, which is exactly what the mock shows.
X0, Y0, X1, Y1 = 0.202, 0.217, 0.940, 1.0
OUT_W = 756   # same width class as the asset it replaces, for the LCP budget

src = Image.open(SRC).convert("RGB")
w, h = src.size
crop = src.crop((round(w * X0), round(h * Y0), round(w * X1), round(h * Y1)))
print(f"source {src.size} -> crop {crop.size} (aspect {crop.width / crop.height:.3f})")

out = crop.resize((OUT_W, round(crop.height * OUT_W / crop.width)), Image.LANCZOS)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
out.save(OUT, "WEBP", quality=85, method=6)
print(f"wrote {OUT} {out.size} aspect {out.width / out.height:.3f} "
      f"{os.path.getsize(OUT) / 1024:.0f} KB")
