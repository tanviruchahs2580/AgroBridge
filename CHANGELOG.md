# Changelog

All notable changes to AgroBridge are documented here.

## [Unreleased]

### Fixed (2026-10-29 four auth rate limiters shared one store — a Redis deployment would 500 the recovery path)
- **`otpStore` was passed to four limiters** (OTP request, OTP verify, password forgot, password
  reset). `express-rate-limit` refuses a store used by two limiters — `unsharedStore()` raises
  `ERR_ERL_STORE_REUSE` on the second limiter's first request, which the error handler turns into a
  500 — and the counter key it hands the store comes only from the request, so even separate
  instances would have written the same Redis key and enforced one budget between four routes.
  Both halves are invisible without `REDIS_URL`: locally and in CI every limiter quietly gets its
  own in-memory store, which is why a 514-test suite and a 52-spec browser run never saw it. With
  Redis configured — the shape `docs/security.md` itself recommends for multi-instance correctness
  — the whole account-recovery path would have failed.
- Fixed: one store instance per limiter, each with its own key namespace
  (`createRedisStore(url, windowMs, prefix)` → `rl:<limiter>:<key>`, used by `decrement`/`resetKey`
  too). The data-export limiter gains a store like its siblings; its memory-only window meant the
  documented "5 exports/hour" was really "5 per instance" in production.
- Guards, because a rule nothing checks drifts back: `tests/rate-limit-store-wiring.test.ts` reads
  the source and fails if any store is referenced twice, if a prefix is missing or duplicated, or if
  a limiter with a window declares no store; `tests/rate-limit-redis.test.ts` gains a
  namespace-isolation case. Run against the pre-fix file the guard reports `otpStore` ×3; against
  the fixed one, nothing. No rate-limit value changed — the policy numbers are identical.

### Fixed (2026-10-29 the generated route inventory could not see 18 endpoints it was meant to guard)
- `apps/api/scripts/route-matrix.mjs` listed 11 module files while `app.ts` mounts 20 routers, so
  `weather`, `notifications`, `organizations` and `ops` were never inventoried — including
  `GET /ops/retention`, the one route among them that is public. A second cause: the parser
  attributed a declaration to the router symbol in front of it, so `plotsRouter()` and
  `cropsRouter()`, which build their routers as a fluent chain off `Router({ mergeParams: true })`,
  were invisible — an entire resource family. The drift check and the deny-by-default PUBLIC
  allowlist were both narrower than the API they guard.
- Inventory 67 → 85 routes. The ops retention trigger is added to the PUBLIC allowlist with its
  justification (constant-time `CRON_SECRET` bearer, 503 when unset) — it already shipped; the entry
  makes it visible rather than relaxing anything. A new test asserts every router mounted in
  `app.ts`, or by a module's own router, appears in the inventory. Every recovered endpoint was
  probed on a running build: `/weather`, `/notifications`, `/organizations`, `/farms/:id/plots` and
  `/farms/crops` answer 401, `/ops/retention` 403, `/membership/plans` 200, an unknown path 404.

### Fixed (2026-10-29 the legal switcher's chip led to a page that does not exist, and admins had no mobile entry)
- The document switcher on the public legal pages built its links as `/${docId}`, so the third chip
  pointed at `/deletion` — no route serves it; the route is `/account-deletion`. Fixed at the
  source: the id → path pairs live in one table (`features/legal/routes.ts`) that the router renders
  its routes from and the switcher links from, with two unit tests pinning the agreement.
- The `/admin` link carried `hidden sm:inline-flex`, so an administrator on a phone — the platform
  this product actually ships on — had no navigation path to the panel. One anchor now serves both
  widths: an icon with the accessible name below `sm`, the text label above.

### Fixed (2026-10-29 nine of thirteen roles rendered as raw enum strings)
- The server assigns thirteen roles; the UI labelled five, one of which (`QC_OFFICER`) the server
  cannot issue at all. Anywhere a role rendered — the admin user table, the audit-log actor — the
  other nine printed as `REGIONAL_MANAGER` inside Bengali copy.
- `contracts/roles.json` now declares the vocabulary. `apps/api/tests/role-contract.test.ts` asserts
  `PERMISSIONS`, `VALID_ROLES` and the schema's own column comment all equal it;
  `apps/web/src/lib/labels.roles.test.ts` asserts every role has a real Bengali and English label,
  that the Bengali one is actually Bengali, and that an unknown role still falls back to the raw
  string. The nine missing labels are added; `QC_OFFICER` stays as a documented legacy label so a
  historical row still renders as words.

### Fixed (2026-10-29 user-facing claims that the product cannot evidence)
- **Services:** the hero badged "Verified" over a line saying only "Active services and providers",
  and `ServiceProvider` carries no verification field — providers are operator-onboarded through
  `providers:manage` and listed when `isActive`. Both strings now read "Platform-listed" in Bengali
  and English, which is true and still tells a farmer these are not anonymous listings.
- **Privacy policy:** the Bengali retention row promised automatic backup deletion within 30 days;
  nothing implements that, and the English row had already been corrected to "platform-managed".
  Both languages, `features/legal/content.ts` (both strings) and the two engineering documents that
  cited the old sentence now state the verified position. No legal wording was invented — the text
  was aligned to the claim the earlier correction established.
- **`AI_HOURLY_LIMIT`** was documented in `.env.example` and `docs/env-reference.md`, parsed into the
  validated env, and then ignored: the limiter hardcoded 30. It now reads the variable. And
  `JWT_REFRESH_SECRET`, which is validated but unused (refresh tokens are opaque random values
  stored as SHA-256 hashes, never JWTs), is documented as reserved in both places rather than left
  looking load-bearing.

### Changed (2026-10-29 one territory predicate; the unassigned case is no longer silent)
- `GET /api/v1/procurement` re-listed the territory roles inline and re-read the region by hand,
  duplicating the rule `lib/territory.ts` already owns. The queue now asks the library, so the list
  and the mutation guards cannot disagree.
- A territory manager with **no region assigned** is unrestricted: the queue returns every region's
  offers — each row carrying the farmer's name and phone — and the review/payout guards treat a null
  region as no limit, so the same account can act on another region's record. That state is one
  `PATCH /admin/users/:id` away (role set, region omitted) and it contradicts how BR-23 reads.
  Tightening a permission boundary is an owner decision, so the default is unchanged; what changed
  is that it is now logged (`territory.unassigned`), documented as BR-23a in
  `docs/business-rules.md` and in `docs/security.md`, and pinned in both directions by
  `apps/api/tests/territory-unassigned.test.ts` — a decision-pinning test whose failure message
  names the four places to update together.
- Docs: five statements that had drifted from the tree are corrected (`security.md` claimed no DAST
  job and no build attestation — both exist; `STATUS.md` said the AUD-V3 work was undeployed — it
  merged as #70; the compliance checklist said consent capture was absent — it is required and
  audited; README/testing carried test totals that disagreed with each other for the same date).
  Volatile counts are replaced by the command that produces them. Two deliberate boundaries that
  look like oversights (the operator refund route's missing ownership filter, owner-only farm-event
  writes) are recorded in `docs/security.md` so they are not "fixed" by mistake later.

### Removed (2026-10-29 dead weight)
- **68 dictionary keys nothing references** — 5,412 bytes of Bengali and English copy, mostly
  leftovers from earlier copy revisions. The dictionary ships inside the entry bundle, so this is
  weight on every page load. Removed by a mechanical criterion (a key's identifier must appear
  somewhere in `apps/web/src` outside the dictionary, which covers indirect map lookups) and checked
  by hand for the one blind spot, string-built keys; `src/lib/i18n.deadkeys.test.ts` is a hard-zero
  ratchet in the style of the existing inline-ternary one.
- **Three tracked images** (`leveler.jpg`, `soil.jpg`, `tiller.jpg`) that no source file referenced
  and that were byte-identical to a file that is used — 671 kB out of the shipped asset set. The
  reference check and the SHA-256 matches are recorded in `docs/asset-provenance.md`.
- **The write-only `localStorage.ab_onboarded` key**, which the onboarding flow set and nothing ever
  read — including `docs/ui-ux-renovation/feature-preservation-matrix.md` describing it as the
  mechanism behind the skip action. Every observable behaviour (the flow, the skip button, the
  redirect home) is unchanged; remembering onboarding completion would be a deliberate small feature,
  not a restoration.
- **A duplicated eight-entry hero-image map** (one copy inline in JSX inside the booking dialog) —
  now one module, `components/service/heroImages.ts`.

### Measured (2026-10-29)
- Entry bundle 131.3 → **130.2 kB gzip** against the 132 kB budget, and all JS 213.7 → **211.8 kB**
  (budget 225), CSS 11.9 (budget 15), fonts 486.3 (budget 520). The preflight caught this work's own
  growth at 132.0 kB; the weight came out of the dictionary rather than out of the budget, so the
  entry bundle is now below both the budget and the pre-change baseline with nine new bilingual role
  labels included. Images shipped 2,428 → 1,771 kB (budget 2,600).
- API suite **526 passed / 1 skipped** (95 files); web unit **205 passed**; the browser suite
  **52 passed / 52** against the production build; typecheck, lint, i18n, knip, jscpd, licences,
  versioncode, route-matrix drift, preflight and the docs gates all green.

### Changed (2026-10-28 splash clock restored to the pacing the shipped build used)
- **The splash animation runs at its original pacing again: ~2.7s plus a 0.28s exit
  fade (≈3.1s on screen), measured from the built bundle.** The clock had been
  compressed to ~1.4s on 2026-10-22 (`fae678c`) to keep the splash's
  largest-contentful paint inside the Lighthouse budget; the field build predates
  that compression, so the compiled app a user had was paced at 2.7s and the
  compressed clock read as the welcome animation being skipped. Only the clock
  moved — the seed → brand → loading → exit sequence, every visual, and the
  settle-don't-fade logo hand-over from the fix below are unchanged
  (`tBrand` 900ms, `tLoading` 1100ms, progress 1100→2600ms, `tExit`/`tDone`
  2600/2680ms, 280ms hand-off).
- The splash is the app's largest-contentful paint, so this raises LCP by roughly
  the added 1.5s. Measured locally against the built bundle with the same
  Lighthouse settings CI uses (`@lhci/cli` mobile, 3 runs, `apps/web/lighthouserc.json`):
  median LCP 4.92s against the 5.00s ceiling, median FCP 2.86s against 3.00s —
  inside the gate, but with little room. The budget was set around the compressed
  clock; raising the clock again re-raises that cost.

### Fixed (2026-10-28 Android launch screen — no extra screen before the splash)
- **Tapping the icon on Android went through two extra screens before the branded
  splash.** Reproduced on an Android 13 image: the platform launch screen held a
  ~176dp emblem, then the WebView painted **pure white**, then the document painted
  its own light surface colour (`#F4F7F2`) — two blank seconds — and only then did
  `Splash.tsx` draw. Three separate causes, all closed:
  - the launch icon was a 108dp inset-of-a-bitmap that the platform scaled into its
    288dp icon box, so the mark landed at 176dp where the in-app splash then drew a
    64dp one. `res/drawable/splash_icon.xml` is now a bitmap generated at 288dp of
    *pixels* per density by `scripts/android-splash-icon.py`, carrying the in-app
    splash's own logo group (120dp ring track, 64dp white disc, 56dp rounded logo
    tile), so the mark is the same size and shape on both sides of the hand-over;
  - the WebView's background was unset, i.e. white. `android.backgroundColor` in
    `capacitor.config.ts` now paints it the splash backdrop;
  - the document painted `--color-surface-bg` until React's first commit. The
    `#root:empty` rule in `src/index.css` paints the splash backdrop for exactly
    that window and stops matching on the commit that renders the splash.
- **`splash_background` had drifted from the colour tokens.css pins it to.** The
  1.4.1 asset re-brand moved `res/values/colors.xml` to `#012823` while
  `--color-splash-from` stayed `#0A2F1F`, so the backdrop shifted green the moment
  the WebView took over. `splash_background` is back to `#0A2F1F`;
  `ic_launcher_background` keeps the owner-sampled `#012823` (launcher-icon art).
- **The splash restarted its own logo.** The mark faded up from `opacity: 0` while
  the launch screen was showing the same mark on the same backdrop, which read as
  the logo blinking out and back in. It is now rendered settled; ring progress,
  shimmer, particles, typography and the exit zoom are unchanged.

### Fixed (2026-10-24 deep-audit remediation — AUD-V3)
- **Live payment gateway reconciliation was verifying with the wrong keys.** The SSLCommerz
  Validation API was sent the checkout *session key* as `val_id`, and the Transaction Query API the
  same value as `orderNo`; the real `val_id` was stored and never used. The adapter now sends each
  API its own key (`val_id` from payment meta; our `tran_id`/refNo as `orderNo`), rounds gateway
  amounts to paisa exactly once, and refuses to confirm a success verdict that carries no usable
  amount.
- **The amount cross-check the webhook enforces now covers every confirmation path.**
  `GET /payments/:id/status` and the hosted-checkout return funnel through one
  `reconcileLiveVerdict` rule: a gateway verdict whose amount differs from the payment is refused
  (payment stays PENDING, `PAYMENT_RECONCILE_AMOUNT_MISMATCH` audited) instead of marking the order
  PAID.
- **`/metrics` is no longer effectively public in production.** The private-address allowance was
  an allow-everything rule behind the platform load balancer (verified live: anonymous 200 with the
  full Prometheus output). Production now requires `METRICS_TOKEN` (constant-time compare) and
  fails closed when it is unset; non-production keeps the local-Prometheus convenience.
- **The offline queue no longer double-sends on boot.** `flushAll` had no in-flight mutex while
  boot + the online-event registration both fired it — every queued mutation was replayed twice
  and the "saved" toast doubled. Concurrent flushes now share one pass (pinned by tests).
- **Closing the checkout wizard by navigating away no longer disables session-expiry handling for
  the tab.** `setCriticalFlow(true)` leaked on unmount; every later 401 was swallowed.
- **A losing cross-tab token refresh no longer logs that tab out.** When another tab rotates the
  refresh family first, the loser retries once with the winner's token instead of clearing the
  session.
- **Three non-money state machines settle races in the database now**, matching the money paths'
  claim-atomic convention: one ACTIVE crop cycle per plot (partial unique index), agronomist
  reviews claim PENDING→REVIEWED exactly once, and a booking cancel can no longer be resurrected
  by a racing assign. The MEMBERSHIP side-effect branch reads inside its transaction.
- **The Redis rate-limit window is atomic** (one Lua round trip for INCR+EXPIRE+TTL) and heals
  TTL-less orphan keys instead of locking an account's bucket until manual deletion.
- **Upload magic-byte checks match full format signatures** — a bare `RIFF` prefix accepted WAV/AVI
  as WebP and two bytes accepted non-PNG streams.
- Client validation mirrors the server's bounds (password ≤ 72, offer quantity ≤ 1,000,000 kg); the
  offline banner's copy is honest about what actually queues (cart writes); advisor chat bubbles key
  by identity; the offlineQueue header names its real hash (djb2, not SHA-256).

### Added (2026-10-24 deep-audit remediation — AUD-V3)
- **The data-retention policy actually runs.** A daily Vercel cron (`GET /api/v1/ops/retention`,
  `CRON_SECRET`-guarded, fail-closed, audited) executes the ADR-0011 windows from a single shared
  executor (`apps/api/src/shared/retention.ts`); the four tables that previously grew without bound
  (analytics events, notifications, AI usage logs, advisory queries) are covered at 180 days.
  Operator action: set `CRON_SECRET` in Vercel before the next deploy.
- **External uptime probe** (`.github/workflows/uptime-probe.yml`): every 15 minutes from
  GitHub-hosted runners — web 200, `/health`, `/ready` (incl. `db:true`), web `version.json`, with
  a latency summary. Outage detection no longer depends on a user noticing.
- **ESLint warning ratchet** in CI (`scripts/qa/lint-budget.mjs`, budget api 143 / web 0 at CI's src-tests scope): new
  warnings fail the build; the exceptions table in CONTRIBUTING is the only way to raise it.
- **Production rollback runbook** (`docs/runbooks/live-deployment.md` §Rollback): Vercel instant
  rollback for both projects, migrations stay forward-only with the compensating-migration path.
- OTP live-challenge uniqueness is enforced by a partial unique index (one live challenge per user
  and purpose) with a retry-on-race issuance flow; `Wallet` carries `updatedAt`; search is
  case-insensitive consistently on SQLite and PostgreSQL (`ciContains`).

### Changed (2026-10-24 deep-audit remediation — AUD-V3)
- **Dev toolchain upgraded to clear every advisory:** vitest 3.2.7 → 4.1.12 (clears the tinypool
  RCE-class chain and mocker path traversal), vite 6.0.3 → 6.4.5 (launch-editor high). Full API
  (514) and web (198) suites pass; production dependencies remain 0-vulnerability. The failure
  path's queue lookup degrades honestly instead of letting an internal module error replace the
  user's network error.
- **ADR registry de-collided.** Numbers 0012-0016 each had two accepted ADRs; the 2026-10-21 wave
  re-decided under 0017-0021, the two genuinely superseded decisions carry SUPERSEDED banners, and
  the registry's references point where they claim.
- `docs/retention-and-logs.md` now matches the retention code (its "no script deletes audit logs"
  claim was false the day it shipped) and PRIVACY_POLICY.md states the platform-managed backup
  window honestly instead of promising a 30-day auto-expiry nothing implemented.
- Weather provider failures answer 502 `WEATHER_PROVIDER_UNAVAILABLE` (503 when our circuit
  breaker refuses) instead of a generic 500 — never a fabricated forecast.
- Load-test gate: the quota-limited AI phase is exempt from the error-rate assertion (its 429s are
  the limiter working), so the exit code means something again.

## [1.4.1] - 2026-10-19

### Fixed (2026-10-19 audit-remediation pass — durability, recovery, gates)
- **Uploads survive redeploys.** Production stored disease photos on the serverless instance disk
  (lost on every deploy). A `db` storage provider keeps bytes in `StoredObject`, `/ready` reports
  `storage { provider, durable }`, and the release gate fails until production reports a durable
  provider (ADR-0012). Operator action: set `STORAGE_PROVIDER=db` (or `s3`).
- **Password recovery exists.** `POST /auth/password/forgot` + `/reset` (SMS code via the new HTTP
  SMS gateway, `SMS_PROVIDER=http`), enumeration-safe, purpose-separated OTP challenges, all
  refresh tokens revoked on success; a matching `/reset` screen in the web app.
- **Login is throttled per account** (hashed phone key, unknown numbers treated identically) on top
  of the per-IP limiter; duplicate registration answers neutrally instead of confirming an account.
- **The offline queue is session-scoped and expires after 72 h** — a shared device can no longer
  replay one user's queued writes under the next user's session; storage failures surface in the UI.
- **Failed upload purges are retried** (`PendingUploadPurge` + `npm run purge:uploads --workspace
  apps/api`), and account deletion reports pending purges instead of claiming full success.
- **Advisory answers are auditable**: persisted history and the usage log carry `kbVersion`,
  `promptVersion` and the request id; money rows carry the request id.
- Notification category preferences are honoured by the delivery path.
- **Honesty fixes**: stale test counts removed from README/CONTRIBUTING (a claims checker now guards
  them), `/metrics` doc claim corrected, duplicated bcrypt figures de-duplicated, the root endpoint
  no longer reports a literal `1.0`, the lockfile's root version matches `version.json`.
- Session diaries and the self-issued "certification status" summary are archived under
  `docs/archive/2026-10-19/` behind a banner; `docs/STATUS.md` is the honest current-state page.

### Added (2026-10-18 enterprise architecture pass — web edge & delivery)
- **The static site now carries its own edge security policy (ADR-0008).** It shipped only HSTS
  before: no CSP, `nosniff`, frame or referrer policy on the origin that runs the app's JavaScript
  and holds the tokens. Both `vercel.json` files now set CSP (`script-src 'self'` plus the inline
  theme-boot script's SHA-256 hash, `frame-ancestors 'none'`, no `unsafe-inline` for scripts),
  `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` and `Cross-Origin-Opener-Policy`. Rationale per header: `docs/deployment.md` §7.
- **Immutable caching for hashed assets** (`/assets/*` → one year, `immutable`; fonts/icons/images/
  brand → a week with `stale-while-revalidate`) while the document, `version.json` and `sw.js` keep
  revalidating. Every hashed chunk used to be revalidated on every visit.
- **`apps/web/scripts/preflight.mjs`, wired into the `web-quality` CI job and asserted live by the
  deploy gate**: recomputes the inline script's hash from the *built* HTML, requires the API origin
  from `.env.production` in `connect-src`, requires both Vercel configs to carry identical headers,
  and enforces byte budgets (entry bundle, total JS/CSS gzip, fonts, images) — the repo's Lighthouse
  config is `workflow_dispatch`-only and would never fail a build.
- **`resourceKeys.ts` + a guard test**: `/farms` was fetched under three different cache keys while
  `invalidate()` matches exactly, so a mutation through one name could not refresh the others. One
  shared key, and the build fails if a feature fetches `/farms` without it.

### Fixed (2026-10-18 enterprise architecture pass — web edge & delivery)
- **The CSP hash would have blocked the theme boot in production, caught before merge.** The working
  tree had CRLF endings (`core.autocrlf` on Windows) while Vercel builds LF bytes, so a rebuilt
  inline script hashed differently from the committed CSP — silently degrading to a theme flash on
  every reload. `.gitattributes` now forces `eol=lf` (the index was already 100% LF, so no committed
  content changed) and the preflight fails on any CR byte in a built inline script.
- **Every queued offline mutation showed the toast twice**: the queue notified React *and* dispatched
  a window event that `App.tsx` also subscribed to. One notification path now.
- **Four byte-identical Bengali font files shipped, two of them preloaded** (~343 kB of the payload,
  210 kB of it on the critical path, one of the four referenced nowhere). One file, three weight
  faces.
- **`docs/security.md` no longer describes the static site as having no headers** (it did, correctly,
  for a few hours), and `docs/deployment.md`'s PostgreSQL step no longer points at the retired Render
  service or the wrong schema copy.

### Added (2026-10-18 enterprise architecture pass — release integrity)
- **Schema state is part of the release contract and the deploy gate enforces it (ADR-0007).** `/ready`
  reports `schema: { known, applied, latest }` (read from `_prisma_migrations`, 60 s per-instance
  cache, honest `known:false` — never a 500 — where the table is absent) and `limiterStore`, and
  `deploy-verify.yml` fails that merge's verification run when production's newest applied migration
  is behind the newest in `apps/api/prisma/postgres/migrations`, naming the remediation command.

### Fixed (2026-10-18 enterprise architecture pass)
- **Production had 2 of 5 migrations applied — the pending-payment partial unique index and six
  hot-query indexes had never reached the database.** Found by querying production directly during
  the architecture audit; every gate was green throughout, because the schema was the one release
  artifact nothing compared. Applied with the documented `scripts/deploy-migrations.mjs` after
  verifying no duplicate PENDING intents existed; `migrate status` is now up to date and all seven
  indexes are present. Evidence: `qa-evidence/receipts/2026-10-18-schema-drift-and-release-contract.md`.
- **`.env.example` documented `API_BASE_URL`, a variable no code ever read** — an operator setting it
  got no effect while payment-gateway return URLs silently derived from the request host. The example
  now names `API_PUBLIC_URL`, which `env.ts` and the payment routes actually read.
- **`.trivyignore` carried an expired waiver date (2026-09-30) that disagreed with the register**
  (`SECURITY_WAIVERS.md`: 2026-12-31). Reconciled to the register with the renewal recorded; the
  production dependency tree was re-audited the same day (`npm audit --omit=dev` = 0).
- **`docs/security.md` understated the shipped controls and misdescribed the audit gate** (it claimed
  a non-blocking high-severity audit; CI fails on moderate+ for production dependencies). Rewritten
  to match the code, including the per-instance rate-limit caveat and the static-site header gap.


### Fixed (2026-10-18 live verification round)
- **The committed-receipt rule could never commit a receipt.** `.gitignore` excluded
  `qa-evidence/` *as a directory*, and git cannot re-include a file under an excluded
  directory, so both `!qa-evidence/receipts/…` negations were inert: every receipt that
  `CONTRIBUTING.md` requires was silently dropped on `git add` (the 2026-10-17 receipt sat
  on disk, untracked, until this round). The ignore now targets `qa-evidence/*`, so
  receipts are committable while the rest of `qa-evidence/` stays local.
- **The sell-crop quantity field reported the wrong unit.** `SellCrop` validated the kilos
  field with `errAmountInvalid` — "সঠিক পরিমাণ (টাকা) লিখুন।" / "Enter a valid amount in
  taka." — so a farmer who typed 0 kg was told to enter a valid amount of *money*. The
  wallet's withdrawal form uses that key correctly, for taka; the sell form now has its own
  `errQuantityInvalid` ("…(কেজি)…" / "…in kg.") at both validation sites. Found by testing
  production as a user — evidence in `qa-evidence/receipts/2026-10-18-live-verification.md`.

## [1.4.0] - 2026-10-17

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
