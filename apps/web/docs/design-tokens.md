# Design Tokens — AgroBridge Web

## Palette
- Primary: `green-700` `#15803d` (brand), `green-800` hover, `green-50` surface
- Neutrals: `stone-50` bg, `stone-200` border, `stone-800` text
- Accent: amber for warnings, red for errors
- Focus ring: `ring-green-600`

## Typography
- Headings: Inter + Noto Sans Bengali, 600–700
- Body: 14–16px, line-height 1.5
- Tokens via `tailwind.config.js`

## Radius / Elevation
- Card: `rounded-xl`, `shadow-sm`
- Button: `rounded-lg`
- Elevation: `shadow-sm` cards, `shadow-xl` dialogs

## Spacing / Safe Area
- Content max-width: `max-w-6xl` with `px-4`
- Bottom nav offset: `bottom-[calc(5rem+env(safe-area-inset-bottom))]`
- Sticky cart: `bottom-[calc(1rem+env(safe-area-inset-bottom))]`

## Icons / PWA
- Source: `public/icon.svg`, generated PNGs via `scripts/generate-icons.mjs`
- Manifest icons (`vite.config.ts`):
  - `icons/icon-192.png` (192×192, purpose any)
  - `icons/icon-512.png` (512×512, purpose any)
  - `icons/icon-maskable.png` (512×512, purpose maskable)
  - `icon.svg` (any, svg)

## Appendix A — Maskable Safe Area (Step 48)

`public/icons/icon-512.png` and `public/icons/icon-maskable.png` are built with an **80% safe circle** so the icon remains legible under Android's maskable cropping (rounded, squircle, etc.).

- Source artwork is centered and scaled to occupy **80% of the canvas diameter** (i.e. 409px of 512px). The outer 10% ring (51px) is kept as transparent/solid padding matching `background_color: #fafaf9`.
- Generation (see `scripts/generate-icons.mjs`): canvas 512×512, inner artwork clipped to circle `r = 204.8` (80% / 2), outer ring fills with background. This guarantees no essential glyph is clipped when the OS applies `maskable` insets.
- Verification:
  ```bash
  # visually check safe area
  npx sharp --help >/dev/null && node scripts/generate-icons.mjs && open public/icons/icon-maskable.png
  # or inspect manifest purpose
  grep -A2 '"purpose": "maskable"' dist/manifest.webmanifest
  ```
- Manifest already declares the maskable icon (`purpose: "maskable"` in `vite.config.ts` VitePWA manifest). `index.html` also links the maskable PNG via `<link rel="maskable" href="/icons/icon-512.png">` for older browsers.
- If regenerating icons, preserve the 80% rule; CI `lighthouserc` checks `maskable-icon` audit.

## Appendix B — Splash & Theming
- Theme color `#166534` (matches `AppTheme` + VitePWA `theme_color`).
- Splash: Capacitor `SplashScreen` duration 1500ms (`capacitor.config.ts`), Android `styles.xml` inherits `Theme.SplashScreen`.

## References
- Tailwind config: `tailwind.config.js`
- Vite PWA: `vite.config.ts`
- Capacitor: `capacitor.config.ts`
