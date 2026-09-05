# Changelog

All notable changes to AgroBridge are documented here.

## [Unreleased]

### Fixed
- **Production boot deadlock (P0, live):** every Render deploy after the Phase 4 provider fail-fast failed with `SMS_PROVIDER sandbox forbidden in production` — the gate rejected every value the enum allows (sandbox *and* none), and mock-weather/offline-AI likewise, so the service could never boot without paid provider contracts and stayed pinned to an older commit. The gate now aborts production startup **unless** the operator sets `ALLOW_PLACEHOLDER_PROVIDERS=1`, which boots with a loud startup warning listing every placeholder in use; genuine misconfigurations (e.g. `openweather` without an API key) remain hard failures.

## [1.3.7] - 2026-09-05

### Fixed
- **AI wrong-topic at high confidence (P0, live):** a farmer asking "ধানের সেচ কখন দিব?" on an active rice cycle got the rice-blast disease answer at "85% grounded". Root cause: `aiagent/routes.ts` auto-passes the active crop as `cropName`, and retrieval counted that hint as strong topical evidence for every same-crop KB entry, so authoring order decided the winner. Retrieval v2: an answer now requires a topical keyword hit (a crop mention or crop hint alone never grounds one), normalized matching (য়-collision, hasanta/ZWJ stripping) with Banglish aliases ("paani kakhon dibo" → irrigation), and confidence is calibrated to actual match strength — weak evidence yields the honest low-confidence fallback instead of a false 85%.
- **Money line items didn't sum (P1):** `formatBDT` rounded every line to whole taka, so the checkout receipt showed 1,850 − 56 + 50 ≠ 1,845. Whole taka still render without decimals; amounts carrying paisa render exactly (1,844.50), so displayed line items now always sum to the displayed total (unit-tested).
- **Wallet missed marketplace payments (P1):** the transactions list only showed the wallet ledger; `Payment` records (ORDER/BOOKING/PROCUREMENT, incl. refunds as credits) from `GET /payments` are now merged chronologically, with wallet-credit rows excluded to avoid double-counting.
- **Dead login affordances (P2):** removed the no-op "forgot password" link; the Google sign-in button (no backend flow) is now hidden behind `VITE_GOOGLE_SIGNIN=1` instead of shipping a button that only alerts. Demo-credential hints verified already DEV-gated (finding retracted).
- **Splash replayed on every hard navigation (P2):** the cold-start splash now honors the `agro_splash_done` sessionStorage flag it already wrote — deep links and reloads within a session no longer replay it; first paint of a session is unchanged.
- **`isOnline()` missed transitions before first subscription (found by unit suite):** the online/offline reconciler bound listeners but never read `navigator.onLine` until the next event or 2s poll; it now reconciles once at bind time.
- **APK login "internet issue" (phone-reported, v1.3.3–v1.3.6):** the hosted Render API spins down when idle; a cold request took ~35s to accept while the APK gave up at 30s (10s before v1.3.5). Request ceiling raised to 45s and a fire-and-forget `wakeBackend()` health ping now runs at app boot, warming the instance during the splash/login screen. Baked API base URL verified correct inside the v1.3.3–v1.3.6 APKs (not the cause).
- **CORS config drift:** `render.yaml` defined `CORS_ORIGINS` but the API reads `WEB_ORIGIN` — the blueprint value was silently ignored. Key renamed and Capacitor WebView origins (`https://localhost`, `capacitor://localhost`, `http://localhost`) added so APK/PWA cross-origin requests are covered. (The live service was originally created via dashboard, so its dashboard env stays source of truth — kept in sync at deploy time.)

### Added
- **Web unit-test layer wired up (P2):** `apps/web` had committed test files with no runner (vitest was never a dependency, no script). Added `vitest` + `jsdom`, `vitest.config.ts` (unit scope; Playwright stays on `test:e2e`), `npm test`/`test:unit`, plus new tests for money formatting/line-sum invariance, `paymentPurposeLabel`, and API retrieval regression. Web unit suite: 91 green; API suite: 125 passed / 1 skipped.

## [1.3.6] - 2026-09-05

### Changed
- **Branding:** Login tagline replaced — "স্মার্ট কৃষি, সমৃদ্ধ ভবিষ্যৎ" → "AI কৃষকের হাতে" (single active UI location, zero-regression swap).

### Added
- **Motion (UI at-rest unchanged):** unified `PageTransition` on all 12 routes (was /services only); Market product-grid entrance stagger (0–180ms); Services card stagger (50ms/card, capped); add-to-cart instant "✓ কার্টে যোগ হয়েছে" acknowledgment (transient, 1.2s) with bilingual `addedToCart` key. All transform/opacity-only, `prefers-reduced-motion` honored.

### Fixed
- **E2E flake (CI):** `splash-verify` brand assertion scoped to the splash subtree — the page h1 legitimately coexists under the splash overlay while "/" redirects to /login; the page-wide `h1` locator raced the redirect commit (strict-mode violation on CI). Assertion strength unchanged.

## [1.3.5] - 2026-09-04
- APK cold-start timeout 10s→30s (Render free-plan wake), fixed API base URL + Capacitor CORS. See git log.

## [1.3.4] - 2026-09-04
- APK version-code bump for fixed API URL. See git log.

## [1.3.3] - 2026-09-03

### Fixed
- **AI relevance (P1):** Irrigation questions ("When should I irrigate my rice field?" / "ধানের জমিতে পানি কখন দেব?") were answered with rice-blast disease advice at 85% "grounded" confidence. Root cause: every KB entry of a crop repeats the crop-name keyword, so a bare crop mention scored equally with the actual topic. Retrieval now uses tiered scoring — topical keywords (weighted, phrases higher) always outrank crop-name aliases; caller-provided crop context stays authoritative. Regression test added (`ai-eval.test.ts`).
- **My Farm:** "3 important tasks" headline was hardcoded; it now reflects the real task count (Bengali pluralization preserved).
- **Home:** Greeting rendered a duplicated 👋 (i18n string already contains it).

### Added
- **Dark theme (designed):** New additive `dark.css` token layer — renders only under OS dark scheme; light mode byte-identical. Warm dark-green surface ramp, remapped cards/nav/dot-pattern/shimmer, WCAG-conscious text hierarchy.
- **Booking sheet a11y:** Services booking sheet now exposes `role="dialog"` + `aria-modal` + `aria-label`, moves focus in on open, closes on Escape, and restores focus on close.

## [1.3.2] - 2026-09-03

### Fixed
- **Modal (P0):** Shared `Modal` rendered inside `#main` while `useDialogA11y` marked `#main` `inert` — the dialog blocked itself (Wallet withdraw modal was completely unclickable). `Modal` now renders through a portal to `document.body`; markup and styling unchanged.
- **Checkout (P0):** `enterprise-enter` keyframes retained `transform: scale(1)` via `fill-mode: both`, keeping a permanent stacking context on every animated section — fixed overlays (checkout "Done" button, modals) painted below the fixed `BottomNav`/`TopBar`. Final keyframe is now `transform: none`: identical pixels at rest, no lingering stacking context.
- **Notifications (P1):** "Mark all read" from a filtered tab never refreshed the unread badge (only the ALL-tab load recomputes counters). Counters are now zeroed deterministically on success — server marks everything read.
- **Dark mode (P1):** Removed the `prefers-color-scheme: dark` stone-50/100 swaps that rendered a half-dark hybrid (black page behind white cards) for OS-dark users. The locked design is light-only; a dark theme needs a designed token set first.

## [1.3.1] - 2026-09-03

### Fixed
- **Splash (Android 12+):** Removed the extra OEM-colored pre-launch screen (sage on HyperOS). The platform launch splash reads only `android:windowSplashScreenBackground` / `android:windowSplashScreenAnimatedIcon`, which were missing — added `values-v31/styles.xml` with both, pointing at the brand `#0A2F1F` background and a new `splash_icon` vector (white disc + green sprout) that mirrors the in-app Splash. Tap → branded launch animation → login, with no foreign screen in between. Completes the 1.3.0 splash work, which only set the library-prefixed attrs (used on API 24-30 only).
- **Splash (API 24-30):** Added `windowSplashScreenAnimatedIcon` to the compat theme so pre-12 devices get the same branded icon.

## [1.3.0] - 2026-09-01

### Fixed
- **Splash:** Eliminated white native launch screen; native splash now uses #0A2F1F to match React Splash (capacitor.config.ts, styles.xml, splash.png assets)
- **Lint:** Fixed conditional hook violation in Splash.tsx (moved hooks before early return) and empty catch in App.tsx
- **Accessibility:** Removed tabIndex=-1 from Login password toggle (keyboard users can now reach it)
- **Accessibility:** Increased ErrorBanner dismiss button to 44px touch target (WCAG AAA)
- **Security:** Added top-level password/token redaction in Pino logger (logger.ts)
- **Security:** Set android:allowBackup=false in AndroidManifest (financial app protection)
- **Security:** Added HSTS and Permissions-Policy headers to NGINX prod config
- **Security:** Added registration rate limiter (10/hr) to prevent mass account creation
- **Data:** Fixed hardcoded weather coords in MyFarm.tsx to use browser geolocation with fallback
- **Types:** Fixed 3 `any` types in ui.tsx touch handlers (React.TouchEvent)
- **Hygiene:** Deleted backup files services.page.backup.tsx and Services.tsx.backup (572 lines dead code)
- **Docs:** Added MIT license field to all package.json files

### Added
- **Config:** Created .editorconfig for consistent formatting
- **Config:** Created values/colors.xml for splash_background #0A2F1F (Android 12+ windowSplashScreenBackground)
- **Docs:** Initial CHANGELOG.md

## [1.2.0] - Previous
- See git log for earlier changes.

## [1.1.2] - Previous
- See git log for earlier changes.
