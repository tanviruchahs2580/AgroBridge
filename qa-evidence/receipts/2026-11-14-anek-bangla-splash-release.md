# Anek Bangla font upgrade + splash badge fix + 1.4.3 release — evidence receipt

- Date: 2026-11-14
- Commit: branch `feature/bangla-font-splash-polish` (release commit `release: v1.4.3 (versionCode 14003)`)
- Machine / OS: Windows 10.0.26300, **Node v24.19.0** (project pins Node 22 — no 22 available on this machine; every executed result is non-transferable), Python 3.12 + Playwright (Chromium headless), fontTools 4.x for font metrics
- Scope: primary-face swap Hind Siliguri → Anek Bangla (variable, self-hosted), the Bangla-first type system it rides on (WS1, previously uncommitted), native+in-app splash badge fix, PageHeader action-slot wrap fix, API hardening (WS2, previously uncommitted), version bump 1.4.2 → 1.4.3. Does not cover: Play store upload, release signing, any schema/migration change (none in this release).

## Result

The owner-reported defects were reproduced, diagnosed and fixed: (1) the Bangla face read generic — the app now renders **Anek Bangla** end-to-end (verified by computed styles and screenshots on the real app); (2) the native splash showed white slivers around the logo tile — the bitmap is regenerated as a concentric white rounded-square badge (verified by reading the regenerated PNG); (3) one 3px overflow the new metrics exposed on `/notifications` at 360px — fixed and caught green by the repo's own `visual-contract` e2e. All declared gates green; the release ships through PR + CI.

## Commands and results

| # | Command | Result |
|---|---|---|
| 1 | `npm run typecheck` | pass |
| 2 | `npm run test --workspace apps/api` | pass — **137 files / 759 passed / 1 skipped, exit 0** (SQLite) |
| 3 | `npm run test:unit --workspace apps/web` | pass — **44 files / 310 tests, exit 0** with `--fileParallelism=false` (this machine's ~0.7 GB free memory kills parallel forks workers — infra, not tests; affected files pass serially) |
| 4 | `npm run lint --workspace apps/web` + `node scripts/qa/lint-budget.mjs` | pass — web 0 errors/0 warnings (budget 0); api 124 warnings ≤ 143 |
| 5 | `cd apps/api && npx eslint src tests` | pass — 0 errors, 124 warnings |
| 6 | `npm run build --workspace apps/web` + `node apps/web/scripts/preflight.mjs` | pass — entry 131.62 kB gzip ≤ 132 kB; fonts 337 KB ≤ 520 KB (was 486); CSP hash unchanged; Lighthouse budgets assert |
| 7 | `node scripts/drift-check.mjs` / `todo-gate.mjs` / `check-versions.mjs` | pass — "no schema drift"; no TODOs; versions consistent **1.4.3 / 14003** |
| 8 | `npx playwright test e2e/a11y.spec.ts` (PLAYWRIGHT_BASE_URL=local stack) | pass — 5 tests: login, login error, shell routes, remaining routes, **dark theme** — zero critical/serious axe violations |
| 9 | `npx playwright test e2e/visual-contract.spec.ts` | pass after the fix — first run **FAILED**: "notifications (360): horizontal overflow at 360px (scrollWidth 363 > clientWidth 360)" — the honest failure that drove the PageHeader fix |
| 10 | `npx playwright test e2e/console-health.spec.ts e2e/splash-verify.spec.ts` | pass — 1 + 3 tests (splash: enterprise splash 3 viewports, reduced-motion, webdriver-skip) |
| 11 | Browser matrix (self-hosted Playwright, 390/360/768/1440 × light/dark × 9 routes, bn-BD, dsf 2, seeded account 01700000002) | pass — 64 probes pre-swap + 16 overflow probes post-swap: **0 console errors, 0 page errors, 0 overflow after the fix**; computed `font-family` = "Anek Bangla" first, body 16px/26px (1.62), h1 20px/700/32px; `document.fonts.check('700 16px "Anek Bangla"')` true |
| 12 | Splash bitmap regeneration `python -I scripts/android-splash-icon.py` | pass — 5 densities written (288→1152px); regenerated `drawable-xxhdpi/splash_logo.png` read back and visually verified: white rounded-square badge, even rim, no corner slivers |
| 13 | Font metrics (`fontTools` on the shipped woff2 + canvas advance-width measurement in the live browser) | measured — Anek: upm 2000, hhea 2500/−1232 (1.866 em line box); Anek/Segoe width ratio 0.918 → `size-adjust: 92%`, `ascent-override: 136%`, `descent-override: 67%` |
| 14 | `npm run qa:knip` | **not determined** — cannot run on this machine (oxc-parser memory requirement; known constraint) |

## Deviations

1. **The e2e a11y/visual-contract/console-health/splash-verify subset ran against the local dev stack** (API :4000 with the AUD-134 rate-limit headroom env vars, `dev.db` brought current with `npx prisma migrate deploy` + seed — additive, local-only; 2 pending migrations applied). CI runs the same specs against its own provisioned stack.
2. **The PageHeader change is a shared-component edit** (`ui.tsx` action slot `shrink-0` → `min-w-0`) — assessed blast radius first: only Notifications passes a multi-control action; the other three `action=` call sites pass single elements, which behave identically.
3. **`docs/engineering/` (untracked from the earlier session) ships in the typography commit** — it is the engineering-conventions doc the WS1 work referenced.
4. **Two historical comments in `ui.tsx`/`i18n.ts` still cite Hind Siliguri measurements** ("measured at 13px, Hind Siliguri…"). The decisions they justify were re-validated empirically under Anek (zero overflow across the matrix, a11y green), but the prose attributions are left as history rather than rewritten — flagged as a cleanup candidate.

## Known gaps

- Node 24, not the pinned Node 22 (above). knip not determined (above).
- The visual evidence is computed styles + tool-captured screenshots + one direct bitmap read — not a human visual sign-off. Key artifacts: `$TEMP/ab-audit/post-home-light.png` (Anek rendered in the real app), `$TEMP/ab-audit/post-login-light.png`, the regenerated splash PNGs in `apps/web/android/app/src/main/res/drawable-*/`.
- Lighthouse CI and the full 28-spec e2e suite run in CI on this release (not executed locally beyond the subset).
- The native splash fix is verified at the asset level; on-device verification happens via the debug APK built from the merged commit (delivered separately).

## Open decisions for the owner

1. Play upload (`play-upload.yml`) is a separate, explicit action — not part of this release.
2. A signed release AAB/APK can be cut from the same commit (`android-release.yml`) when the owner wants it.
