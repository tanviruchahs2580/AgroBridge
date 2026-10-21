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
| `brand/logo-mark.png` | App shell, splash, auth shell (`apps/web/src/App.tsx:157`, `Splash.tsx:96,187`, `AuthShell.tsx:48,177`) | No provenance record in the repository. **UNKNOWN — owner must supply licence or asset must be removed.** If it was commissioned or AI-generated for AgroBridge, record that fact and the terms here. |
| `brand/logo-emblem.png` | Auth shell (`AuthShell.tsx:150`) | same as above |
| `brand/login-bg-desktop.webp`, `brand/login-bg-mobile.webp`, `brand/login-bg-mobile-full.webp` | Auth shell (`AuthShell.tsx:92,106-107`) | Photographic login backgrounds with no provenance record. **UNKNOWN — owner must supply licence (photographer/stock ID/URL) or replace with an in-repo-licensed image.** |
| `icon.svg` | Source vector (masthead-style mark drawn as SVG paths) | In-repo authored SVG; covered by the repository's MIT `LICENSE`. No separate attribution recorded. |
| `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable.png` | PWA manifest (`public/manifest.webmanifest` icons) | Derivative of the brand mark; same open question as `logo-mark.png`. **UNKNOWN — owner must record origin.** |
| `icons/apple-touch-icon.png`, `icons/favicon-64.png` | Platform icon slots | same as `icon.svg`/brand derivatives; **UNKNOWN — owner must record origin.** |
| `images/services/agronomist.jpg`, `combine.jpg`, `drone.jpg`, `land-leveller.png`, `power-tiller.jpg`, `soil-test.jpg`, `thresher.jpg`, `tractor.jpg` | Referenced by `apps/web/src/components/service/ServiceCard.tsx:25-33` and `apps/web/src/features/services/Services.tsx:405-414` | No provenance record in the repository. **UNKNOWN — owner must supply licence or asset must be removed.** These are the images the Play listing and the services page render. |

## Unreferenced service images (flagged)

`git ls-files apps/web/public/images/services/` lists eleven files; the UI maps only eight category
keys (`ServiceCard.tsx:25-33`, duplicated in `Services.tsx:405-414`). These three are tracked but
referenced by no source file (search across `apps/web/src` and the web config found no reference):

| Asset | Status |
|---|---|
| `images/services/leveler.jpg` | Unreferenced duplicate of the leveller image (`land-leveller.png` is the file the UI uses). No provenance record. **UNKNOWN — owner must supply licence or the file must be removed.** |
| `images/services/soil.jpg` | Unreferenced duplicate of the soil-testing image (`soil-test.jpg` is used). No provenance record. **UNKNOWN — owner must supply licence or remove.** |
| `images/services/tiller.jpg` | Unreferenced duplicate of the power-tiller image (`power-tiller.jpg` is used). No provenance record. **UNKNOWN — owner must supply licence or remove.** |

Removing them shrinks the tracked asset surface; keeping them requires recording a licence. Either
is the owner's call, but leaving them unreferenced and undocumented is the one option that stays
wrong.

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
