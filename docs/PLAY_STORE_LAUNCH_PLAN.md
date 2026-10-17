# AgroBridge — Play Store Launch Plan & Issue Register (Round 10)

**Date:** 2026-10-17 · **Baseline:** `main` @ `e2fa9f1` (clean tree, CI green)
**Goal:** after the owner connects domain/host (and, if real money is wanted, gateway
credentials), the app is submittable to Google Play with no remaining launch blocker.
**Method:** three independent read-only audits (web frontend, API/security, Android/Play
release path) at the commit above, each finding verified against source before being
entered here. Prior rounds (1–9) are recorded in `EXECUTION_LOG.md` and
`ENTERPRISE_CERTIFICATION_STATUS.md`; this register supersedes those where they conflict.

Legend — **B** = hard Google Play submission blocker · **P0/P1/P2/P3** = severity for the
running product (P0 broken/unsafe for users, P1 significant, P2 quality, P3 polish).

---

## A. Google Play submission blockers

| ID | Pri | Finding | Evidence | Fix in this round |
|---|---|---|---|---|
| PS-1 | **B, P0** | **No account-deletion path.** Google Play requires apps that let users create accounts to offer in-app deletion *and* a web deletion URL. The API endpoint exists but nothing in the UI calls it, and the published policy promises "Settings → Delete Account". | `apps/api/src/modules/auth/routes.ts:323` (`DELETE /auth/me`); no `/settings` route in `apps/web/src/App.tsx:276-291`; `PRIVACY_POLICY.md:69,145` | New `/settings` screen with a guarded delete flow + public `/account-deletion` page |
| PS-2 | **B** | **No hosted privacy policy / terms URL.** Policy exists only as markdown; root `vercel.json` rewrites every path to `/index.html` so it cannot be served as a file, and Play requires a public URL. | `PRIVACY_POLICY.md`; `vercel.json`; `docs/PLAY_STORE_LAUNCH_AUDIT.md:16` | In-app `/privacy` + `/terms` routes (stable URLs that work the moment a domain exists) from one typed content module |
| PS-3 | **B, P0** | **Release AAB is silently debug-signed.** Gradle reads `android/key.properties` but CI writes `android/app/key.properties`, and the release build falls back to the debug key instead of failing. Play rejects wrongly-signed uploads. | `apps/web/android/app/build.gradle:6,41`; `.github/workflows/android-release.yml:67-74` | Read from both locations, hard-fail without a real keystore, and assert the signer in CI |
| PS-4 | **B** | **Legal entity / contact details are placeholders**, and the policy describes password+OTP login differently from the shipped flow. Play review and the data-safety form must match reality. | `PRIVACY_POLICY.md:11,98,109,155` | Corrected policy content with a single `LEGAL_ENTITY` block the owner fills once |
| PS-5 | **B** | **No store listing raw material.** No feature graphic (1024×500), no phone screenshots, no short/full description in bn or en. Only the 512×512 icon exists. | `apps/web/public/icons/icon-512.png` is the only asset; `qa-screenshots/**` are desktop browser captures | Generated feature graphic + real phone-size screenshots + bn/en listing copy under `play/` |
| PS-6 | **B, P1** | **Version codes are hardcoded and already drifted** (`13007 / "1.3.7"` while `package.json` says 1.0.0, CHANGELOG says 1.3.7, `docs/archive/2026-08-09/RELEASE_MANIFEST.md` says 1.5.0, the on-disk APK says 1.4.0). Re-running the release workflow re-uses a code Play will reject. | `apps/web/android/app/build.gradle:18-19` | Single source of truth + build-time stamping, monotonic in CI |

## B. Product defects that would be visible on day one

| ID | Pri | Finding | Evidence | Fix in this round |
|---|---|---|---|---|
| X-1 | **P0** | **Expanding an order crashes the page.** The UI reads `item.product.name` / `item.product.pricePaisa`; the API returns line items with snapshot fields only, and the hand-written TS interface hides the mismatch. | `apps/web/src/features/orders/MyOrders.tsx:15-37,220-221`; `apps/api/src/modules/marketplace/routes.ts:168`; `OrderItem` = `nameSnapshot/unitPricePaisa` (`prisma/schema.prisma:259-271`) | Render from the snapshots the API actually sends; add a regression test |
| X-2 | **P0** | **Checkout silently discards the delivery address.** The wizard validates name/phone/address, then posts with no body; the API `safeParse`s an empty object, so the order is created with no shipping details, and My Orders reads `addressLine`/`phone` fields that do not exist in the schema. | `apps/web/src/features/marketplace/Market.tsx:229`; `apps/api/src/modules/marketplace/routes.ts:234-239`; `Order` has `shipping*` only (`schema.prisma:235-257`) | Send the body, validate with the `validate` middleware (hard 400 instead of a silent drop), read the correct fields |
| X-3 | **P0** | **Production lets any user self-confirm a payment for free.** `PAYMENT_PROVIDER` defaults to `sandbox`, the production placeholder gate does not cover payments, and `POST /payments/:id/confirm` only refuses when the provider is *not* sandbox — so on the live deployment an order/membership can be marked PAID with no money moving. | `apps/api/src/config/env.ts:26,56-68`; `apps/api/src/modules/payments/routes.ts:163-165` | Include payments (+ storage) in the production gate; require an explicit opt-in flag for sandbox confirmation in production; return an honest error otherwise |
| X-4 | **P1** | **The real gateway is never called.** `createPayment`/`verifyPayment` exist but no route invokes them, so configuring `PAYMENT_PROVIDER=sslcommerz` produces a checkout that can never complete. | `apps/api/src/providers/payment/sslcommerz.ts:48,115`; no callers in `src/modules/**` | Invoke the adapter from `/payments/intent` and add an idempotent status-check endpoint the client can poll |
| X-5 | **P1** | **Weather is wrong for every Android user.** `navigator.geolocation` is used without any Android location permission, so it always fails and silently falls back to Rangpur (25.9/89.1). | `apps/web/src/lib/geo.ts:7-17`; `AndroidManifest.xml` declares only INTERNET + CAMERA | Resolve coordinates from the user's district (profile/farm data) — no permission, more accurate, works offline in the APK |
| X-6 | **P1** | **Withdrawals are unreachable.** Wallet withdrawals and procurement payouts require `phoneVerified`, the UI has a dedicated error for it, but there is no OTP screen anywhere. | `apps/api/src/modules/payments/routes.ts:429,302`; `apps/web/src/lib/errors-ui.ts:15`; no OTP UI in `features/**` | Phone-verification section in the new settings screen |
| X-7 | **P1** | **Wallet membership "success" can be a lie** when the provider is not sandbox: the client toasts success and refreshes balances without any payment step having happened. | `apps/web/src/features/wallet/Wallet.tsx:139-147`; `Market.tsx:246-261` | Drive the UI from the payment response (redirect when a gateway URL exists, honest pending/unsupported states otherwise) |
| X-8 | **P2** | Product analytics never reaches the API: events are beaconed without an `Authorization` header, get 401, and the admin analytics screen shows an empty dataset as if it were real. | `apps/web/src/lib/analytics.ts:31-41`; `apps/api/src/modules/analytics/routes.ts:27` | Send through the authenticated API client, drop events that fail |

## C. Security / authorization hardening

| ID | Pri | Finding | Evidence | Fix in this round |
|---|---|---|---|---|
| S-1 | **P1** | `GET /admin/users` has no `users:read` gate, so REGIONAL_MANAGER / AREA_MANAGER / PROCUREMENT_MANAGER can page through every user's name, phone and email. | `apps/api/src/modules/admin/routes.ts:16-21,67`; `rbac.ts:11-25` | Add the permission gate |
| S-2 | **P1** | An ADMIN can promote any account (including itself) to SUPER_ADMIN, which holds the wildcard permission. | `apps/api/src/modules/admin/routes.ts:91-97`; `rbac.ts:10` | Only a SUPER_ADMIN may grant ADMIN/SUPER_ADMIN; no self-escalation |
| S-3 | P2 | Checkout has no idempotency key: two overlapping submits create two orders and decrement stock twice. | `marketplace/routes.ts:230-300` | Client-generated key + unique index, replay-safe |
| S-4 | P2 | `GET /admin/metrics` and `/admin/analytics/summary` bypass the permission map. | `admin/routes.ts:24,258` | Add `requirePermission("admin:metrics")` |
| S-5 | P2 | Unmapped Prisma `P2003` turns a farm delete with linked bookings/POs into a raw 500. | `middleware/errorHandler.ts:26-32`; `Booking/ProcurementOrder.farmId` are `RESTRICT` | Map to 409 with an actionable message |
| S-6 | P2 | `jwt.verify` has no algorithm allowlist; `/auth/otp/verify` has no rate limiter; `/auth/logout` takes an unvalidated body. | `middleware/auth.ts:24`; `auth/routes.ts:291,178` | Pin `HS256`, add a limiter, validate the body |
| S-7 | P2 | Territory-scoped roles can act on out-of-region records by id (`/procurement/:id/review`, `/payments/payouts`, `/bookings/:id/assign`). | `procurement/routes.ts:118`; `payments/routes.ts:294`; `services/routes.ts:148` | Apply the same region predicate used by the list endpoints |
| S-8 | P3 | Unbounded `findMany`s, missing indexes on hot sort paths, unpinned `ACCESS_TOKEN_TTL`. | `organizations/routes.ts:42`; `admin/routes.ts:121`; `prisma/schema.prisma:485` | Add caps/indexes where the migration is additive |

## D. Android / release engineering

| ID | Pri | Finding | Evidence | Fix in this round |
|---|---|---|---|---|
| A-1 | **P1** | `CAMERA` is declared but never requested. A declared-but-ungranted CAMERA can break the `<input capture>` path on Android 11+, and an unused sensitive permission invites Play review friction. | `AndroidManifest.xml:44`; only camera use is `Advisor.tsx:146` | Remove the declaration (the intent-based capture needs no permission) |
| A-2 | **P1** | Edge-to-edge is on for API 36 but nothing handles the **top** inset — the sticky header can sit under the status bar on Android 15+. | `App.tsx:142`; only bottom insets used (`ui.tsx:329,512`) | Add the top inset to the shell/header |
| A-3 | P1 | The bundled web bundle inside `android/app/src/main/assets/public` is stale relative to `apps/web/dist`, and no build carries a version/commit stamp, so a locally built AAB can ship an old app. | asset `index-BFZg6tkT.js` vs dist `index-Dbznn19N.js` | `version.json` (version + commit) written at build time; CI asserts `dist == assets/public` |
| A-4 | P2 | Inert Capacitor `SplashScreen` plugin config (plugin not installed) and template leftovers (default test package, unreferenced splash drawables). | `capacitor.config.ts:24-32`; `capacitor.plugins.json` = `[]`; `androidTest/.../ExampleInstrumentedTest.java:21` | Remove the dead config/artifacts |
| A-5 | P2 | Release builds still permit cleartext to emulator/loopback hosts; no monochrome icon layer; launcher foreground has the background baked in. | `res/xml/network_security_config.xml:8-13`; `mipmap-anydpi-v26/` | Move dev exceptions to the debug source set; add a monochrome layer |
| A-6 | P2 | No push notifications (no FCM, no plugin) while the product surfaces in-app notifications; Play's minimum-functionality review also favours real native capability. | `capacitor.plugins.json` = `[]` | Out of scope without the owner's Firebase project — documented as the single remaining native capability gap |

## E. Deliberately NOT fixed in this round (with reason)

- **Real gateway credentials / live mode** — needs the owner's SSLCommerz merchant account.
  The code path is now real, so credentials alone activate it (PS/X-4).
- **Push notifications (FCM)** — needs the owner's Firebase project (`google-services.json`)
  and a plugin install; documented as A-6 with the exact steps.
- **Object storage for disease photos** — the API now refuses to boot in production with
  local storage unless explicitly acknowledged, and the S3 adapter is wired; enabling it
  needs the owner's bucket credentials.
- **Replacing localStorage token storage with httpOnly cookies** — a cross-cutting auth
  change with real regression risk on the APK; recorded, not attempted pre-launch.
- **`minifyEnabled`/R8 and code shrinking** — the app has no native libs and no reflection
  surface, but enabling shrinking without device verification could break the WebView
  bridge; deferred to the first post-launch release with a real device test.
- The remaining P2/P3 items in sections C/D that are not listed above are recorded here and
  tracked for the next round.

---

## Execution order

1. Product defects X-1, X-2, X-8 (correctness first, regression-tested).
2. Payment integrity X-3, X-4, X-7 (money paths) + section C authorization fixes.
3. Play compliance PS-1, PS-2, PS-4 (settings, deletion, policy pages, phone verification).
4. Android/release PS-3, PS-6, A-1…A-5 + build stamp.
5. Play package PS-5 (listing assets + copy) + data-safety mapping + submission runbook.
6. Full gates, real-browser verification, commit/push, remote CI verification, report.

---

## Outcome (2026-10-17, end of round)

Everything in sections A–D above is **implemented, tested and verified locally**, except the
items in §E. Verification evidence:

| Gate | Result |
|---|---|
| API suite (`npm run test --workspace apps/api`) | **148 passed / 1 skipped** (11 new regression tests in `tests/round10-regressions.test.ts`) |
| Web unit (`npm run test:unit --workspace apps/web`) | **108 passed** |
| Web lint (eslint + jsx-a11y) | **0 problems** |
| i18n dictionary check | 320 keys referenced, **0 missing** |
| api + web typecheck | clean |
| api + web production build | pass; `dist/version.json` = `1.4.0` + commit stamp |
| Playwright e2e (`--workers=1`) | **24/24 passed** (20 pre-existing + 4 new in `e2e/settings-account.spec.ts`) |
| Real-browser verification | Settings, legal pages, Home and the deletion flow inspected in Chromium at 360×640; screenshots in `play/screenshots/` |

Two claims from the audit pass did **not** survive verification and were dropped: `GET
/admin/analytics/summary` already carried the `admin:metrics` permission, and the VitePWA
omission is deliberate and documented in `vite.config.ts`.

What remains is owner-only and is listed in §E plus the runbook: domain/host connection, the
upload keystore and Play app record, optional gateway/Firebase/S3 credentials.
