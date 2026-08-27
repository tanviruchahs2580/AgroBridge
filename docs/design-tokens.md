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

Stack: `"Inter", "Noto Sans Bengali", system-ui`. Inter 400/500/600/700 latin-only (`unicode-range U+0000-00FF`), Noto only `U+0980-09FF` + required marks. See `src/index.css`.

Type scale (Step 7): `text-xs` 11px/16px, `sm` 13px/18px, `base` 16px/24px, `lg` 18px/28px, `xl` 20px/28px, `2xl` 28px/36px.

## Focus

`--ring-color: #16a34a` `ring-2 ring-offset-2` on all interactive.

## Theming

Dark: `[data-theme="dark"]` swaps stone 50/100/900. `prefers-color-scheme: dark` mirrors.
