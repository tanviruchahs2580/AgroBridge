# Asset provenance inventory (DOC-09)

Every shipped image/font/table asset, where it came from, and its licence status.
`OWNER` in the right column means the rights answer is owner-side — those are
questions for the repository owner, not engineering assumptions.

| Asset | Purpose | Origin | Rights |
|---|---|---|---|
| `apps/web/public/fonts/hind-siliguri-{400,500,600}.woff2` | UI Bengali/Devanagari text face | Hind Siliguri (Google Fonts, SIL Open Font License 1.1) | OFL — redistribution permitted with reserved-name note |
| `apps/web/public/brand/logo-emblem.png` | brand emblem | generated in-repo (brand build script) | project-owned |
| `apps/web/public/brand/logo-mark.png` | brand mark | generated in-repo | project-owned |
| `apps/web/public/icon.svg` | favicon/manifest vector source | generated in-repo | project-owned |
| `apps/web/public/icons/*.png` | apple-touch/favicon/manifest 192/512/maskable | derived from `public/icon.svg` in-repo | project-owned |
| `apps/web/public/images/*` | UI photography/illustration | **OWNER**: per-file source provenance not recorded — to be confirmed (AUD-151 lineage) | OWNER |
| `play/feature-graphic-1024x500.png` | Play Store feature graphic | derived from brand assets in-repo | project-owned |
| `play/icon-512.png` | Play Store app icon | derived from brand assets in-repo | project-owned |
| `play/screenshots/*` | Play Store screenshots | captured from the running app (device frames by Play) | app screenshots = project-owned; Play frame artwork = Google branding terms |
