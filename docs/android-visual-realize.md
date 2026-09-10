# AgroBridge Android — Visual Realization (390×844) — From 12-Screen Reference

**Date:** 2026-08-28
**Target:** Pixel-perfect match to provided 12-screen grid, 100% functional, Android field-ready.

## 1) Device & Resolution
- **Primary:** `390×844` (Pixel 5, iPhone 12/13), `~3.5" width`, `dpr 3.0`
- **Secondary:** `360×780` (low-end) + `412×915` (Pixel 7) — responsive via fluid grid, no fixed px overflow.
- **Safe Area:** `env(safe-area-inset-top/bottom)` 20px top, 34px bottom (gesture nav). All screens `pt-[env(safe-area-inset-top)]`, `pb-[calc(60px+env(safe-area-inset-bottom))]` for bottom nav.
- **Density:** 8pt base (`4/8/12/16/20/24/32`), 16px horizontal padding on mobile, 20px on ≥375px.

## 2) Global Visual Language (Extracted from Image)
- **BG:** `#F8FAF5` (warm stone) + white cards `rounded-[20px] border #E7E5E4 shadow-card` — image shows very light mint, not pure white.
- **Primary Green:** `#0F7B3F` (header, primary CTA, active nav), accent `#1A9B4A` gradient CTA.
- **Radius:** Card `20px`, Button `12px`, Chip `999px`, IconBox `14px`, BottomNav `16-20px`
- **Shadow:** `0 1px 3px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.04)` default → `0 8px 32px rgba(21,128,61,.12)` hover
- **Typography (Bengali-first):** Hind Siliguri 700 for headings (24-28), Noto Sans Bengali 500 for body (14-16), Inter for numbers tabular. Line-height Bengali `1.6`, letter `-0.02em` on display.
- **Icons:** 20-24px outline stroke 1.75px rounded, duotone with 48px container bg per category (sky/orange/earth/soil) — image shows each service icon is custom (tractor, combine, drone, etc.) inside soft colored square.
- **Motion:** Stagger `60-80ms spring 340/28`, press `0.97`, hover lift `y -4`, skeleton shimmer, no jank on 390.

## 3) Per-Screen Dimension Audit (Measured from Screenshot at ~280px mock, scaled to 390)

### Screen 1 — Splash
- Full bleed farm image `390×844` with `gradient from-black/40 to-black/10` overlay.
- Logo `80×80` + `AgroBridge 28px/700` + `tagline 12px muted` centred top `120px` from top.
- Middle: farmer `200×240` cutout + drone small, text `18px bold Bangla` + `11px` subtitle.
- CTA `Start 390-32px width, 48px height, rounded 12, bg #0F7B3F` fixed bottom `32px + safe`.

### Screen 2 — Login
- White `390×844`, logo `60×60` top `80px`, `AgroBridge 20px` + `আপনাকে স্বাগতম 14px`.
- Inputs `48px height, rounded 12, border #E7E5E4`, prefix `+880` gray box `60px`.
- Primary `48px bg #0F7B3F`, secondary `Google #FFFFFF border, Facebook #1877F2` each `48px`.
- Footer `12px muted` links.

### Screen 3 — Home (Critical)
- Header `56px` greeting `18px bold` + `hand`, weather card `120px height` with `28°C 32px` left, icon 40px right, stats row `3 cols 40px` each.
- Quick actions `4×2 grid gap 12, iconBox 48px, label 12px centred`, banner `80px green gradient + field image right`.
- Bottom nav `60px height, 5 items, icon 24px, label 10px, active green bg #F0FDF4`.

### Screen 4 — My Farm
- Header `My Farm 20px`, stats `3 cards 80×80` (12.5, 3, 2) with icon 32, label 11.
- Farm list: each farm card `80px height, left 12px border accent, title 14px, meta 11px muted, 2 action icons 32px`.
- Task list `48px row`.

### Screen 5 — AI Consult
- Progress bar `85/100 green-50 gold`, AI text `14px line 1.6`, fertilizer images `56×56 rounded 12`.

### Screen 6 — Market Prices
- Header `16px`, list rows `56px height, left 40px iconBox, middle title+meta, right price 14px bold + change 11px green/red`.

### Screen 7 — Agri Input & Screen 8 — Machinery (List, not Grid)
- **Critical:** Image shows **list** (not grid) — row `72px height, left image 56×56 rounded 12, middle title 14px + pill 11px, right price 13px + Detail link 11px green`. Gap `12px`.
- Qty selector `32px` `+ / -` with `1` count.
- Footer cart `48px green bar` with total + CTA.

### Screen 9 — Weather Detail
- Big `28°C 48px`, 5-day strip `48px each day, icon 24`, graph line.

### Screen 10 — Diagnosis
- Camera `120px dashed border, icon 32`, gallery button `48px green outline`, recent cards `72px image 56 left`.

### Screen 11 — Finance
- Two cards `80px green/blue`, empty state `48px illustration`.

### Screen 12 — Profile
- Avatar `80×80 circle`, name `18px`, phone `13px`, list rows `48px, icon 20 left, chevron 16 right, divider 1px`.

## 4) Scale & Density Check
- All touch targets `48-56dp` (image measures 44-48px at 390, passes 48dp = 48px @ 1x, 144px @3x).
- Text `12px` minimum on `390` → `3.1mm` physical, readable in sunlight with `#1A1F1C` on `#FFFFFF` 15:1.
- No horizontal scroll: grid `gap 12`, `padding 16`, `card 390-32=358` fits.

## 5) Implementation Plan
- Phase A: Splash/Login exact (gradient + Google/FB).
- Phase B: Home exact (28°C + 8 actions + banner) — replace current Home hero with screen 3 spec, keep AI 87% as optional? Must match screen 3, so swap.
- Phase C: My Farm + Weather + Diagnosis.
- Phase D: Services/Machinery + Input as list (not grid) with real hero 56px left image.
- Phase E: Market Prices + Finance + Profile.
- Verify via Playwright screenshot diff at 390×844 vs reference.

