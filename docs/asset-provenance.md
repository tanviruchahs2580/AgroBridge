# Asset provenance

Inventory of the shipped static assets under `apps/web/public/**` (from `git ls-files
apps/web/public/`) plus the Play listing artwork in `play/`, with the provenance that can be
established from the repository. Where nothing in the repository records an origin or licence, the
row says **UNKNOWN — owner must supply licence or asset must be removed**. No source is guessed and
no licence is assumed beyond what is quoted below.

Method: `git ls-files` for the inventory; font family names read from filenames and cross-checked
against the CSS/`<link>` usage; licence text fetched from the upstream Google Fonts repository on
**2026-10-19**.

## Fonts — licences identified

The eight `hind-siliguri-*` files are subsets (bengali / latin, weights 400–700) of **Hind
Siliguri**; the three `noto-bengali-*` files are subsets of **Noto Sans Bengali** (the CSS at
`apps/web/src/index.css:85-105` documents that the 500/700 duplicates were byte-identical and were
collapsed to the 400 file). Both upstream families are released under the **SIL Open Font License,
Version 1.1**:

| Upstream family | Licence | Licence text fetched | Copyright line in that file |
|---|---|---|---|
| Hind Siliguri | SIL OFL 1.1 | `https://raw.githubusercontent.com/google/fonts/main/ofl/hindsiliguri/OFL.txt` (accessed 2026-10-19) | "Copyright (c) 2015 Indian Type Foundry (info@indiantypefoundry.com)" |
| Noto Sans Bengali | SIL OFL 1.1 | `https://raw.githubusercontent.com/google/fonts/main/ofl/notosansbengali/OFL.txt` (accessed 2026-10-19) | "Copyright 2022 The Noto Project Authors (https://github.com/notofonts/bengali)" |

| Asset | Family (from filename) | Used by | Provenance status |
|---|---|---|---|
| `fonts/hind-siliguri-bengali-400.woff2` | Hind Siliguri (Bengali subset) | `apps/web/src/index.css:14`; preloaded in `apps/web/index.html:17` | OFL 1.1 as above; subset origin (who cut the subset) not recorded |
| `fonts/hind-siliguri-bengali-500.woff2` | Hind Siliguri | `index.css:32` | same |
| `fonts/hind-siliguri-bengali-600.woff2` | Hind Siliguri | `index.css:50`; preloaded `index.html:17` | same |
| `fonts/hind-siliguri-bengali-700.woff2` | Hind Siliguri | `index.css:68` | same |
| `fonts/hind-siliguri-latin-400.woff2` | Hind Siliguri Latin | `index.css:23`; preloaded `index.html:18` | same |
| `fonts/hind-siliguri-latin-500.woff2` | Hind Siliguri Latin | `index.css:41` | same |
| `fonts/hind-siliguri-latin-600.woff2` | Hind Siliguri Latin | `index.css:59` | same |
| `fonts/hind-siliguri-latin-700.woff2` | Hind Siliguri Latin | `index.css:77` | same |
| `fonts/noto-bengali-400.woff2` | Noto Sans Bengali | `index.css:96` (weights 500 at `:105` and 700 reuse this same file by design); preloaded `index.html:19` | OFL 1.1 as above |
| `fonts/noto-bengali-latin.woff2` | Noto Sans Bengali Latin subset | `index.css:132` | same, by filename; the `unicode-range` declared there is U+0000-00FF + U+0131/U+0152-0153/U+02BB-02BC/U+02C6/U+02DA/U+02DC/U+0304/U+0308/U+0329/U+2000-206F/U+20AC/U+2122/U+2191/U+2193/U+2212/U+2215/U+FEFF/U+FFFD |
| `fonts/noto-bengali-latin-ext.woff2` | Noto Sans Bengali Latin-Ext subset | `index.css:123` | same, by filename |

OFL 1.1 requires the copyright notice and the licence text to accompany the font software when it
is redistributed. No OFL text file is committed alongside `apps/web/public/fonts/`; adding the two
`OFL.txt` files (or a single `fonts/LICENSE.txt` quoting both notices) is an owner-side tidy-up.
Item for the owner: record which tool/version produced the subsets.

## Brand and icons

| Asset | Where used | Provenance status |
|---|---|---|
| `brand/logo-mark.png` | App shell, splash, auth shell (`apps/web/src/App.tsx`, `Splash.tsx`, `AuthShell.tsx`) | No provenance record in the repository. **UNKNOWN — owner must supply licence or asset must be removed.** If it was commissioned or AI-generated for AgroBridge, record that fact and the terms here. |
| `brand/logo-emblem.png` | Auth shell (`AuthShell.tsx`) | same as above |
| `brand/login-bg-desktop.webp`, `brand/login-bg-mobile.webp`, `brand/login-bg-mobile-full.webp` | Auth shell (`AuthShell.tsx`) | **Owner-supplied 2026-11-12** (in-session, file `photo_6318961606678746552_y.jpg`, 720×1280): the owner provided the original photograph and directed that the login hero show it. Terms recorded here by owner instruction; no third-party licence applies per the owner. `login-bg-desktop.webp` was verified to **be** that photograph — squashed to the photo's own 720×1280 frame the mean absolute pixel difference is 6.7, smaller than the 11.0 a two-pixel self-shift produces. `login-bg-mobile-full.webp` was **not** — it was a hand-recomposed variant of the scene (difference 55.8), so on 2026-11-12 it was recropped from the owner's photograph by `apps/web/scripts/login-hero-mobile-2026-11-12.py`; both sides of the auth shell now show the same picture. `login-bg-mobile.webp` remains the 640w strip crop used by the desktop panel's `srcSet`. |
| `icon.svg` | Source vector (masthead-style mark drawn as SVG paths) | In-repo authored SVG; covered by the repository's MIT `LICENSE`. No separate attribution recorded. |
| `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable.png` | PWA manifest (`public/manifest.webmanifest` icons) | Derivative of the brand mark; same open question as `logo-mark.png`. **UNKNOWN — owner must record origin.** |
| `icons/apple-touch-icon.png`, `icons/favicon-64.png` | Platform icon slots | same as `icon.svg`/brand derivatives; **UNKNOWN — owner must record origin.** |
| `images/services/agronomist.jpg`, `combine.jpg`, `drone.jpg`, `land-leveller.png`, `power-tiller.jpg`, `soil-test.jpg`, `thresher.jpg`, `tractor.jpg` | Referenced by the services feature (`apps/web/src/components/service/ServiceCard.tsx`, `apps/web/src/features/services/Services.tsx`) | No provenance record in the repository. **UNKNOWN — owner must supply licence or asset must be removed.** These are the images the Play listing and the services page render. |
| `images/hero-farm.jpg` | Home farm-readiness panel (`apps/web/src/features/home/Home.tsx`) | **Owner-supplied 2026-11-12** (in-session, file `photo_6316709806865060868_y.jpg`): the owner provided the photograph and directed its use as the panel background. Terms recorded here by owner instruction; no third-party licence applies per the owner. |

## Unreferenced service images (flagged)

`git ls-files apps/web/public/images/services/` listed eleven files; the UI maps eight category keys
(`apps/web/src/components/service/heroImages.ts` — one map, after the duplicate copies in
`ServiceCard.tsx` and `Services.tsx` were collapsed into it). Three were tracked but referenced by no
source file, and byte-identical to a file that is used:

| Asset | Status |
|---|---|
| `images/services/leveler.jpg` | **REMOVED 2026-10-28.** Byte-identical to `land-leveller.png` (SHA-256 match) and referenced by no source file. |
| `images/services/soil.jpg` | **REMOVED 2026-10-28.** Byte-identical to `soil-test.jpg`. |
| `images/services/tiller.jpg` | **REMOVED 2026-10-28.** Byte-identical to `power-tiller.jpg`. |

The reference check behind that removal: `git grep --untracked "images/services/<name>"` over
`apps/web/src`, `apps/web/e2e` and `apps/web/index.html`, plus a check that each remaining file is
reached through the single hero map. The provenance question for the eight images that remain is
still open and still the owner's call — their rows above are unchanged.

## Other public files (not images or fonts)

| Asset | Purpose | Provenance status |
|---|---|---|
| `manifest.webmanifest` | PWA install metadata (name, theme, icons) | In-repo authored; covered by the repository licence |
| `sw.js` | One-time service-worker kill switch (ADR-0008) | In-repo authored |

## Play listing artwork (`play/`)

| Asset | Status |
|---|---|
| `play/icon-512.png`, `play/feature-graphic-1024x500.png` | No provenance record. **UNKNOWN — owner must supply/confirm the source.** |
| `play/screenshots/*.jpg` (10 files, phone-01-login … phone-10-delete-account) | Device screenshots of this app; they contain demo UI only. No capture log is committed. The images they show (service photos, login backgrounds) inherit the UNKNOWN status above. |

## What would close this file

1. Owner records, for each UNKNOWN row, either (a) the source/licence, or (b) a replacement asset
   whose terms are recorded in-repo.
2. The two upstream `OFL.txt` texts are committed next to the font files.
3. The three unreferenced service images are removed or referenced and documented.
