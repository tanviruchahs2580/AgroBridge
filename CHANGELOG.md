# Changelog

All notable changes to AgroBridge are documented here.

## [Unreleased]

### Added (2026-10-17 Play Store launch round)
- **Account deletion, the path Google Play requires.** New `/settings` screen: profile editing, phone verification (the gate on every withdrawal), and Account → "Delete account" with an explicit warning, wired to the existing `DELETE /auth/me`. Proven end-to-end by `apps/web/e2e/settings-account.spec.ts`, which deletes a throwaway account and then asserts the credentials no longer authenticate.
- **Published legal pages at stable URLs.** The SPA now serves `/privacy`, `/terms` and `/account-deletion` from one typed content module (`src/features/legal/content.ts`), reachable without signing in; the deletion page explains what is erased, what is retained (financial records, 5 years) and how to request deletion without app access. `PRIVACY_POLICY.md` 1.1 is corrected to match the shipped app (login is password-based; no crash SDK; no device identifiers; no location).
- **Phone verification UI** — request a code, enter it, see the verified badge; unblocks wallet withdrawals, which the API already required.
- **Real payment-gateway path.** `/payments/intent` now invokes the configured provider (`providers/payment/index.ts`), returns the hosted-checkout URL, and the gateway returns through a public, trust-nothing callback (`/payments/gateway/return/:outcome`) that verifies with the provider before anything is marked paid. New `GET /payments/:id/status` reconciles a payment after the buyer returns.
- **Play submission package**: `docs/play/release-runbook.md`, `listing-copy.md`, `data-safety.md`, `reviewer-access.md`, `scripts/play/create-reviewer-account.mjs`, generated artwork in `play/` (512 icon, 1024×500 feature graphic, ten 1080×1920 screenshots captured from the running app), and `version.json` as the single source of truth for the web bundle and Android `versionName`/`versionCode`.

### Fixed (2026-10-17 live delivery round)
- **The gateway-return redirect built a malformed URL in production**: `WEB_ORIGIN` is a
  comma-separated allow-list (site origin + the Capacitor WebView origin) and the handler
  fed the whole string to `new URL()`, so live answered 303 with
  `https://…vercel.app,https/orders?...`. `primaryOriginOf()` picks and validates the first
  entry, unit-tested against list/whitespace/single/empty/non-URL inputs.

### Added (2026-10-17 live delivery round)
- **scripts/qa/full-functional-sweep.mjs** — a 39-check user-level sweep of every screen and
  action the Playwright specs do not cover (advisor, sell-crop with its confirm dialog,
  notifications, booking, withdrawal validation, phone verification, profile round-trip,
  language/theme persistence, admin surfaces, offline banner, 404). Runs against the local
  stack or production (`SWEEP_MODE=live`), keeps full Playwright failure reasons so a
  selector problem is not mistaken for an application one, and skips record-creating flows
  on production.
- `qa-evidence/` is now gitignored (local QA artifacts: sweep screenshots/results, test logs).

### Fixed (2026-10-17 launch round)
- **CI pinned a setup-node SHA that does not exist** (`…fe5028`; the real v7.0.0 commit is `…fe5020`). Jobs on that pin ran only while GitHub's action-resolution cache held the entry, and died in "Set up job" as soon as a job's content changed — which is what broke the web-quality job on this push, and would have broken `android-release.yml`, the only path that produces the Play upload artifact, on its first run. Every pinned action in `.github/workflows` is now verified against its upstream repository; this was the only non-existent one.
- **Order history crashed when expanded (P0):** `MyOrders` read `item.product.name`/`pricePaisa` and `order.addressLine`/`phone` — none of which the API sends (line items are snapshots, the order carries `shipping*`). Expanding any order threw into the error boundary. It now renders the snapshot fields it is actually given, shows the payment state, and says so plainly when an order predates the delivery form.
- **Checkout silently discarded the delivery address (P0):** the wizard validated name/phone/address and then posted an empty body, and the API `safeParse(...).data` dropped whatever arrived. The client now sends the validated details and the endpoint rejects a malformed value with 400 instead of accepting the order without it. Body-less requests from already-released clients are still accepted.
- **Production could simulate a payment for free (P0):** `PAYMENT_PROVIDER` defaults to sandbox and `/:id/confirm` refused only when the provider was *not* sandbox, so a live deployment marked orders and memberships paid without collecting anything. Sandbox confirmation in production now requires an explicit `ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION=1`; without it the API returns `PAYMENT_GATEWAY_NOT_CONFIGURED` and the UI reports "order placed, payment pending" rather than success. `PAYMENT_PROVIDER` and `STORAGE_PROVIDER` joined the production placeholder gate.
- **Territory roles could act outside their region (P1):** `/procurement/:id/review`, `/payments/payouts` and `/bookings/:id/assign` now apply the same region predicate their list endpoints use.
- **`GET /admin/users` had no permission gate (P1):** REGIONAL/AREA/PROCUREMENT managers could page through every account's name, phone and email; it now requires `users:read`. `GET /admin/metrics` requires `admin:metrics`.
- **ADMIN could mint a SUPER_ADMIN (P1):** granting `ADMIN`/`SUPER_ADMIN`, modifying an admin account, and changing your own role are now SUPER_ADMIN-only or refused.
- **Analytics never reached the API (P1):** events were sent with `sendBeacon`, which cannot carry an `Authorization` header, so every batch was 401-discarded and the admin analytics screen showed an empty dataset as if it were real. Events now go through the authenticated client with the same single-flight token refresh.
- **Weather was wrong for every Android user (P1):** `navigator.geolocation` cannot work in the APK (no location permission is declared), so it always fell back to a hard-coded Rangpur. Weather now resolves from the farmer's profile district (64 districts → 8 divisions), which also means the app declares no location permission at all.
- **Offline queue could replay a checkout:** `/orders/checkout` is no longer queueable, so a queued attempt cannot re-create an order the user already placed.
- **Assorted hardening:** `jwt.verify` pins HS256, `/auth/otp/verify` is rate-limited, `/auth/logout` validates its body, Prisma `P2003` maps to 409 instead of a raw 500, and procurement/booking/farm-deletion mutations write audit rows.

### Changed (2026-10-17 launch round)
- **Android release path fixed.** `key.properties` is read from `android/` *and* `android/app/` (CI wrote one, Gradle read the other), the debug-signing fallback is gone, and the release workflow now fails unless the APK/AAB carries a real upload-key signature. Version comes from `version.json`; the workflow asserts the synced web bundle matches it, so a stale bundle cannot ship.
- **No sensitive Android permission is declared** (CAMERA removed — the file-chooser capture path needs none and an ungranted declaration can break it) and the release build refuses cleartext everywhere; the emulator exceptions moved to the debug source set.
- **Build identity is traceable:** `version.json` (version + commit + timestamp) is emitted into the bundle and shown in Settings.
- **Header/Home polish:** the shell header consumes the Android 15 status-bar inset, the brand tagline no longer wraps at 360px, and Home's meter is labelled "Farm readiness" (computed from the user's own records plus today's weather) with the percentage shown once instead of twice — it was previously "Health score", which read as an agronomic verdict and printed a floor value even with no farm on file.
- Removed dead Android resources (unreferenced splash drawables, template launcher vectors, template tests) and the inert Capacitor `SplashScreen` plugin block (no such plugin is installed).
- CI's web job now runs eslint and the i18n dictionary check, not just typecheck + build.


### Changed (2026-10-16 platform & hygiene)
- **CI budget guard on vendored deps:** root override `source-map-js@^1.2.2` clears GHSA-68fv-2mgg-jv7q (HIGH, event-loop DoS) that failed both the prod-deps audit gate and the container Trivy gate.
- GitHub Actions pinned to commit SHAs everywhere (checkout v7.0.1, setup-node v7.0.0, upload-artifact v7.0.1, setup-java v6.1.0, login/metadata/build-push/buildx/scp/ssh/trivy/chromatic); every workflow now declares least-privilege `permissions`.
- **Render & Fly blueprints removed** (`render.yaml`, `apps/api/fly.toml`): both described the retired platform — creation from them would resurrect dead hosts. Live topology is Vercel (web+API) + Neon PostgreSQL (docs/runbooks/live-deployment.md).
- README/CHANGELOG truth pass: test counts, Node >=22 engines, PostgreSQL stated as running (not "ready-for").

### Fixed (2026-10-16 code review findings)
- **Membership payments were one-shot per tier:** a DB partial unique allowed exactly one PENDING payment per `(purposeType, purposeId)` globally — and MEMBERSHIP's purposeId is the shared tier name. The invariant is now per-user (`Payment_user_purpose_pending_key`, migration in both dialect chains), and the intent supersede is scoped to the acting user (previously one user's checkout cancelled another's).
- **SSLCommerz webhook honesty:** a webhook losing the PENDING claim (superseded intent, concurrent confirmation) reported `processed:true` AND re-notified the user; it now answers `processed:false (not_claimable)` without side effects or duplicate notifications.
- **Booking lifecycle guards:** terminal states are final (no un-cancel / re-complete), transitions validated per state (admin offline cash-settlement path ASSIGNED→COMPLETED kept), cancel/completion fields no longer nulled by unrelated transitions; rating is idempotent (no provider aggregate inflation); provider assignment respects service compatibility.
- **Admin revenue metric** no longer counts farmer procurement payouts (wallet credits) as revenue.
- **Frontend data honesty:** Home/MyFarm dashboard tiles now render real, stage-derived suggestions (which are labeled as suggestions) instead of fabricated task lists/false "AI analysis" claims, and never display ৪.৫★ style trust metadata from seeded demo providers as their own; removed a dead onboarding step, a dead "Remember me" checkbox and the flag-gated Google button that only alerted.
- **Sessions survive offline boots:** a network failure on `/auth/me` no longer wipes valid tokens; a definitive 401 still clears them.
- **Offline queue replay safety:** timed-out online requests are no longer silently queued and replayed (duplicate-order risk) — only true offline failures queue.

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
