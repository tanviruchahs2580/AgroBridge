# AgroBridge Design Tokens

Source of truth: `apps/web/src/tokens.css` + `apps/web/tailwind.config.js`

Figma: _placeholder — https://figma.com/file/agrobridge-tokens_

## Color

| Token | Value | Usage |
|---|---|---|
| `--color-brand-50` | #f0fdf4 | card tint, success bg |
| `--color-brand-100` | #dcfce7 | badge bg |
| `--color-brand-200` | #bbf7d0 | chart fill |
| `--color-brand-300` | #86efac | hover tint |
| `--color-brand-400` | #4ade80 | decorative |
| `--color-brand-500` | #22c55e | accent |
| `--color-brand-600` | #16a34a | ring, focus |
| `--color-brand-700` | #15803d | **primary**, buttons, nav active |
| `--color-brand-800` | #166534 | header, text on light |
| `--color-brand-900` | #14532d | pressed |
| `--color-brand-950` | #052e16 | darkest |
| `--color-stone-50` → `900` | #fafaf9→#1c1917 | neutrals |
| `--color-danger-*` | #fef2f2/#fecaca/#991b1b | ErrorBanner |
| `--color-success-*` | #f0fdf4/#bbf7d0/#166534 | success toast |
| `--color-warning-*` | #fffbeb/#fde68a/#92400e | warning |

Tailwind: `bg-brand-700`, `text-stone-600`, etc. map to `var(--color-*)`.

## Spacing (8pt grid)

`--space-1` 4px, `--space-2` 8px, `--space-4` 16px, `--space-6` 24px, `--space-8` 32px. Use `gap-4` (=16px), `space-y-6` (=24px).

## Radius & Shadow

| Token | Value | Usage |
|---|---|---|
| `--radius-lg` | 0.5rem | Button, Input |
| `--radius-xl` | 0.75rem | Card |
| `--radius-2xl` | 1rem | Modal |
| `--shadow-sm` | 0 1px 2px | Card |
| `--shadow-md` | 0 4px 6px | dropdown |
| `--shadow-lg` | 0 10px 15px | Modal |

## Typography

Stack: `"Anek Bangla", "Anek Bangla Fallback", "Noto Sans Bengali", system-ui` (self-hosted woff2 in `public/fonts/`, served offline — APK-safe). Primary face is **Anek Bangla** (owner choice, 2026-11-14, replacing Hind Siliguri): ONE variable woff2 per script subset (bengali + latin, wght 100–800 — every weight in the ladder is a real face; ~198 KB total vs Hind's ~351 KB of static files). Noto Sans Bengali is the coverage-fallback family (`U+0980-09FF` + required marks, latin + latin-ext subsets). The metric-tuned `Anek Bangla Fallback` face (`src/index.css`, size-adjust 92% / ascent 136% / descent 67%, measured against Anek's 1.866 em line box) reduces the swap reflow on slow networks. See `src/index.css`.

Type scale — 9 steps, Bangla-first (rebuilt 2026-11-13; mirrors `--text-*`/`--leading-*` in `tokens.css` and the Tailwind `fontSize` map):

| Step | Size / lh (Latin) | lh (bn, `[lang="bn"]`) | Notes |
|---|---|---|---|
| `2xs` | 11px / 16px | 18px | micro captions only |
| `xs` | 12px / 18px | 19px | caption floor — Bengali below 12px is below the readability bar |
| `sm` | 13px / 20px | 21px | secondary text |
| `md` | 15px / 22px | 24px | compact card/section headings |
| `base` | 16px / 25px | 26px | body |
| `lg` | 18px / 28px | 29px | `.h2` role |
| `xl` | 20px / 30px | 32px | `.h1` role |
| `2xl` | 28px / 38px | 40px | `.stat` role |
| `display` | 34px / 44px | 46px | hero numerals, Latin digits only |

Rules:
- **Heading roles** (`.h1` / `.h2` / `.card-title` / `.stat` in `index.css`) bind size + weight + line-height once; screens do not re-invent headings. Weight ladder is 400/500/600/700 only — the variable axis goes to 800, but heavier weights crush Bengali counters at screen sizes, so `font-extrabold` stays banned by role discipline.
- **No negative letter-spacing on Bengali-capable text** — it compresses matras and stacked conjuncts. `--tracking-display` (-0.02em) is sanctioned only on Latin-digit display numerals. Positive tracking (`--tracking-xs`…`--tracking-wide`) only on uppercase Latin eyebrows or digit-only OTP inputs.
- **One numeral policy**: any displayed number goes through `formatNumber(value, lang)` (`lib/format.ts`) so Bengali digits render in bn mode; raw `{value}` interpolation of user-visible numbers is banned. Money goes through `formatBDT`.
- Body line-height ≥1.45× Latin, ≥1.55× Bengali (`--leading-bn-*` applied via the `[lang="bn"]` rules in `index.css`; `session.tsx` sets `documentElement.lang`).

## Focus

`--ring-color: #16a34a` `ring-2 ring-offset-2` on all interactive.

## Theming

Dark: `[data-theme="dark"]` swaps stone 50/100/900. `prefers-color-scheme: dark` mirrors.
