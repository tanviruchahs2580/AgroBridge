# Changelog

All notable changes to AgroBridge are documented here.

**How this file is written (stated 2026-11-10, F-54).** The changelog is a **release artefact**:
an entry is written at release time, with the release record — not by every PR. A released
heading names the release: the version when `version.json` was bumped, otherwise the production
commit and the PR range. Work in flight stays under `[Unreleased]` until its release record cuts
it out. The rule this replaces (“update under `[Unreleased]` in every PR”, still worded
that way in `CONTRIBUTING.md` §Pull requests — reported for alignment) is falsified by the
history: 86% of behaviour-changing commits had no entry (measured in
`docs/audit/2026-11-10-full-qa-audit.md` F-54).

> **Note on the sections dated before 2026-11-03.** The 2026-10-24, 2026-10-28 and 2026-10-29
> sections below each shipped in a production release (identities in `docs/STATUS.md`); they
> remain under `[Unreleased]` because their release records predate the heading convention
> above. A future release record should move the older waves under dated headings — do not
> delete them.

## [1.4.3] — 2026-11-14

### The Bangla face is Anek Bangla, and the type system behind it was rebuilt
- **Owner verdict that drove this release: the app's Bangla did not read enterprise-grade.** The
  primary face is now **Anek Bangla** (Ek Type's 2022 UI family) — one variable woff2 per script
  subset (wght 100–800), self-hosted in `public/fonts/`, replacing Hind Siliguri's eight static
  files. Total font payload drops ~351 KB → ~337 KB *including* the Noto fallback family kept for
  glyph coverage, and the preflight budget headroom grows from 34 KB to 183 KB.
- Behind the face, the typography system was rebuilt Bangla-first: a 9-step scale with explicit
  Latin/`[lang="bn"]` line-height pairs (≥1.45× Latin, ≥1.55× Bengali — Bengali's matra zone and
  stacked conjuncts need the room), heading roles (`.h1`/`.h2`/`.card-title`/`.stat`) binding
  size + weight + tracking once, the fake-weight ladder removed (`font-extrabold` had silently
  rendered as 700; every weight is now a real face of the variable font), negative tracking banned
  on Bengali-capable text, and one numeral policy through `formatNumber` (Bengali digits in bn
  mode). The metric-tuned `Anek Bangla Fallback` face (`size-adjust: 92%`, ascent 136% / descent
  67% — measured against Anek's 1.866 em line box) kills the first-paint swap reflow on Slow-4G.
  Documented in `docs/design-tokens.md`; the engineering conventions doc records the drift item.
- Verified: full browser matrix (4 viewports × light + dark × 9 routes, locale `bn-BD`) — zero
  console errors, zero horizontal overflow before one exception (below); the repo's a11y suite
  (axe, light + dark, critical/serious blocking) green; `visual-contract`, `console-health` and
  `splash-verify` e2e green; 44 web unit files / 310 tests and the 137-file API suite green.

### Fixed (the splash logo's white corners, and one overflow the new metrics exposed)
- **The launch screen showed white slivers around the logo on the green backdrop.** The native
  splash bitmap drew a white *disc* behind the 16dp-radius logo tile; a circle can never cover a
  rounded square, so the tile's corners exposed white — reported from the field by the owner. The
  artwork is now a white rounded-square badge concentric with the tile (even 4dp rim, no slivers,
  matching the Android app-icon shape), regenerated for all five densities by
  `scripts/android-splash-icon.py`, and the in-app splash (`Splash.tsx`) renders the same badge so
  the platform → WebView hand-over shows one continuous surface.
- **Notifications overflowed 360px by 3px under the new metrics.** `PageHeader`'s action slot was
  `shrink-0`, which pinned the badge + two buttons at max-content width even though the content
  could wrap; the slot is now `min-w-0` so multi-control actions wrap (truncation stays banned on
  Bengali-capable labels). Caught by the `visual-contract` e2e at 360×640, re-run green.

### Fixed (API hardening — conservative, no dependency change)
- **`GET /organizations` returned unbounded nested lists.** The module now caps one response body
  (`ORG_LIST_CAPS`: 50 members/org, 50 farms/org, 50 plots/farm — the `FARM_LIST_CAPS` discipline)
  and ships `_count.members` alongside the truncated slice so truncation is visible, pinned by
  `tests/org-list-caps.test.ts`.
- **Three routes parsed query strings by hand.** `GET /admin/audit-logs`, `GET /admin/withdrawals`
  and `GET /notifications` now go through `validate({ query })` with explicit Zod schemas: the
  audit-log filters (`entityType`/`actorId`/`action`) the indexes already support actually filter,
  an unknown withdrawal status or notification category fails loud with 400 instead of silently
  returning every row, and the documented AUD-116 clamp behaviour (malformed pagination clamps,
  still 200) is preserved inside the schema — pinned by `tests/query-validation.test.ts`.
- **`server.ts` closes idle HTTP keep-alive connections in the signal handler** so a shutdown
  drains in-flight requests instead of waiting out the keep-alive timeout.
- **`vitest.config.pg.ts` mirrors the SQLite coverage thresholds exactly** (82/72/84/84) — the
  PostgreSQL profile could previously run without the ratchet.
- Recorded as **ADR-0022** (`docs/adr/`): capped slice + `X-Total-Count` is the list contract, the
  ok/fail envelope is the only response shape, list queries go through `validate({ query })`, and
  Express stays on 4.x / OTel stays deferred until a sink exists.

### Ship gates for this release
- Local (Node 24.19.0 — the project pins Node 22 and this machine has no 22; results are
  non-transferable to the pin): `npm run typecheck` clean; API suite 137 files / 759 passed /
  1 skipped; web unit 44 files / 310 passed; web lint 0/0 and api eslint 0 errors (124 warnings ≤
  143 budget); build + preflight green (entry 131.62 kB gzip ≤ 132, fonts 337 KB ≤ 520);
  drift-check, todo-gate, version gates green; e2e subset (a11y, visual-contract, console-health,
  splash-verify) green. knip: not run — the machine's memory cannot start its parser (known
  constraint). Evidence: `qa-evidence/receipts/2026-11-13-typography-and-backend-hardening.md` and
  `qa-evidence/receipts/2026-11-14-anek-bangla-splash-release.md`.
- No schema or migration change is part of this release; none was pending.



## [Unreleased]

### Deployed (2026-10-29 production at 3e8b5c4 — PRs #81, #83; record #84)
- **Production runs the enterprise-audit remediation and the public-language fix.** Web and API both
  report `3e8b5c4`; `/ready` reports `db: true` with the schema applied 11/11; the
  deploy-verification gate passed on the merge, and the observed web bundle was built at
  2026-10-29T04:48Z. Both release PRs passed 19/19 checks before merge — the 14 CI jobs (including
  the SQLite and PostgreSQL suites and the 52-spec browser suite), CodeQL, the ZAP DAST baseline,
  Docker build and compose smoke, Trivy, gitleaks, and both Vercel previews.
- Verified in a browser against the live site after the deploy: the public legal pages in both
  languages with the language control that had been missing, the not-found page following the
  visitor's choice, registration with its consent gate (submit disabled until the box is ticked),
  twelve authenticated screens with no console errors and no horizontal overflow, the admin route
  denied to a farmer, the personal-data export, and account deletion ending with the deleted
  credentials refused (`401`). The throwaway account used for that pass was deleted at the end of it.
- No schema, migration, dependency, environment-variable or workflow change is part of this release;
  no migration was pending or applied.

### Fixed (2026-10-29 the public legal pages ignored the visitor's language)
- **Read the policy as an English-speaking visitor on the deployed site and you got Bengali —
  whatever you had chosen.** Switching to English on the login page correctly stores the choice
  (`agrobridge.auth_lang`) and the toggle confirms it; opening `/privacy` then rendered Bengali with
  **no language control on the page at all**. The same shape applied to `/terms`,
  `/account-deletion` and the not-found page. Those are the public URLs Google Play requires, and a
  reviewer reading the policy is exactly that visitor: someone with no account, reading an
  English-language store listing, who cannot read Bengali.
- Cause: each public surface decided the language for itself. The auth screens read the stored
  choice; the legal documents and the 404 used `session?.lang ?? "bn"`, which for an anonymous
  visitor is always Bengali — and neither offered a toggle. The page that most needs to be readable
  by anyone was the one that ignored the reader.
- Fix: `apps/web/src/lib/publicLanguage.tsx` now owns the public language key, the hook and the
  language pill. The auth screens, the legal documents and the not-found page all read from it, and
  `AuthShell`'s private copy of the hook and the toggle — the duplication that let the surfaces
  diverge — is gone. The legal pages carry the control themselves, since a policy URL can be the
  first page a visitor ever sees. A choice made here stays a *reading* choice: the authenticated app
  still follows the account language, so nothing flips the product underneath the user.
- Tests: four component tests pin it — the default for a first-time visitor, the stored choice
  carrying into the policy, the control switching and persisting, and switching back (so it is not a
  one-way door). New module at 100 % statement coverage; the suite's coverage floors are all
  cleared.
- Measured after the fix: entry bundle unchanged at 130.2 kB gzip against the 132 kB budget.

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

### Changed (2026-10-28 splash clock restored — #78)
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

### Fixed (2026-10-28 Android launch screen — #75)
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

### Fixed (2026-10-24 deep-audit remediation — AUD-V3, #70)
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

### Added (2026-10-24 deep-audit remediation — AUD-V3, #70)
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

### Changed (2026-10-24 deep-audit remediation — AUD-V3, #70)
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

## [1.4.2] - 2026-11-11 — audit remediation release (AUD-2026-11-10-FULL)

> `version.json` bumped `1.4.1/14001` → `1.4.2/14002` for this release; the previous
> production release (`3f1c991`) shipped on `1.4.1` with no bump. Findings referenced as
> `F-nn` are `docs/audit/2026-11-10-full-qa-audit.md`. Schema: two additive migrations
> (`20261110120000_money_idempotency_keys`, `20261110130000_fk_relation_indexes`) applied
> before this deploy — no applied migration was edited.

### Fixed — the money path is idempotent end to end (F-01, F-02, F-03, F-04, F-05, F-23, F-24, F-25)
- Withdrawal creation goes through the existing idempotency middleware and a
  `@@unique([userId, clientRequestId])` backstop; a replay returns the original response
  instead of creating a second hold. The web wallet sends a stable key per attempt.
- The confirming SSLCommerz webhook claims through the same helper the sandbox path uses, so
  a client idempotency key survives confirmation (it was overwritten, which for MEMBERSHIP —
  the one purpose without a payable-state guard — meant a retry could mint a second payable
  intent). The cancel/supersede paths preserve the key the same way (F-23).
- Payment intents carry a real `intentKey` column with a unique index; the same-key race that
  PostgreSQL's READ COMMITTED allowed is closed, and the legacy `metaStr`-only rows replay.
- The gateway return URLs carry the `/api/v1` mount prefix, so a buyer returning from hosted
  checkout reaches the 303 hand-off instead of a JSON 404 — `deploy-verify.yml` asserts this
  live. The session request sends `notify_url` and the v4 customer/product fields (live
  gateway acceptance still needs one sandbox rehearsal — the only unverified item).
- A captured payment the webhook cannot apply is audited (`PAYMENT_NOT_CLAIMABLE`), counted
  and logged with `tranId`/`paymentId` instead of being acknowledged silently.
- A gateway refund's wallet DEBIT is unchanged (BR-35, deliberate) and is now labelled
  platform bookkeeping in the response and notification.

### Fixed — authorisation is one mechanism, and the inventory is true (F-06, F-08, F-63a, F-64, F-75)
- An organisation `VIEWER` can no longer rename or delete another member's farm —
  `assertFarmAccess` is capability-aware, deletion is audited, and the cascade is protected.
- All nineteen inline role lists across six modules are replaced by declared permissions;
  `payments:read:any` and `procurement:read:any` scope the two handler-level reads. The
  route-role matrix now reports the model as built, and `tests/permission-reachability` fails
  when a permission is neither enforced nor recorded as deliberately unused. The 13-role ×
  route equivalence matrix pins every decision the swap could have changed.
- REGIONAL_MANAGER and AREA_MANAGER can see the booking queue they assign from
  (`bookings:read:any`, territory-scoped); the unassigned-region fallback is unchanged and
  asserted (ODL-007).
- Refunds and withdrawal decisions enforce separation of duties — an actor cannot approve
  their own payout.
- Product/service lifecycle: a wrong price can be corrected and a product retired
  (`PATCH /products/:id`); `isActive` is no longer a permanently-true predicate.

### Fixed — the AI advisory path (F-07, F-22, F-43, F-44, F-45, F-62, F-101)
- Farm context (crop, stage, district) moved inside the delimited untrusted-reference block
  and is sanitised and allow-listed; `cropName` — user-controlled — can no longer inject into
  the system message. `PROMPT_VERSION` v2.
- Hosted-path confidence is evidence-based (retrieval score + answer support) instead of a
  hardcoded 0.75/0.45; an unsupported answer loses its citations and raises the flag.
- The unreviewed-agrochem guard applies to both engines, not just the offline one.
- The `sec` prefix false positive is fixed (whole-word Latin matching, explicit `*` stems);
  the test that asserted the wrong retrieval now asserts the refusal.
- The monthly budget guard reserves before it spends, estimates when a provider omits usage,
  fails closed on metering failure, and has tests for the 429, fallback and Dhaka-boundary
  paths. Tier limits are real (×1/×4/×10) and the seed no longer promises "Unlimited".
- Outbound PII (BD phone in both digit sets, email, NID/bank digit runs) is redacted before
  the third-party model.

### Fixed — privacy and the legal text (F-10, F-11, F-12)
- The privacy policy states the real processing region (US East, `iad1`) with an explicit
  cross-border-transfer clause, and the in-app legal text is the single source of it.
- Account deletion anonymises farm geo fields and advisory free text, matching what
  `docs/data-protection.md` and the Play data-safety table claim.

### Fixed — the web app (F-09, F-29, F-33..F-42, F-93, F-97..F-100)
- The offline queue's cross-account guard is live: `setSession` is wired, so a queued write
  from one account cannot replay under the next account's token on a shared phone.
- WCAG 2.5.3 label-in-name on both language toggles; login no longer applies the
  registration password policy; registration keeps the visitor's language choice; an
  unmapped grade value no longer crashes Sell Crop; server validation messages no longer
  claim "this field is required" for a filled field; lists page instead of truncating
  silently; the theme toggle repaints on a live OS change; Playwright no longer reuses a
  sibling project's dev server on 5173.
- Bengali terminology settled on খামার for "farm", with the dictionary pinned to
  `contracts/roles.json`; coverage floors raised 40/30/36/42 → 64/52/62/66.

### Changed — the verification layer can fail again (F-13, F-14, F-30, F-31, F-46, F-47, F-66..F-68, F-92)
- The documented duplication gate is fixed (0.66%, was 3.42% and red) and cannot be satisfied
  by narrowing CI's scope any more; `qa:knip` runs and gates unused exports.
- The response-contract fixture probes 36 endpoints with no vacuous empty-array shapes, and
  refuses to write when a probe fails.
- The test database is lock-guarded, so two runs on one checkout do not corrupt each other
  any more (reproduced live during the audit as 50 failures that looked like a regression).
- Both doc gates resolve against the tracked file set and cover `AGENTS.md`, `CHANGELOG.md`,
  `STATUS.md` and the root policy files.
- Round-numbered test files are renamed to behaviour names; source-text assertions are now
  runtime clamps.

### Changed — CI/CD and the release path (F-15, F-18, F-20, F-27, F-78, F-80..F-88)
- The security scenario that always self-skipped in CI now runs (the :4100 probe is wired).
- The container path refuses to deploy without an explicit image tag, ships its config mounts
  and a migrate stage; TLS terminates on 443 and the Trivy waiver's rationale matches the
  artefact.
- Wallet reconciliation is scheduled (Vercel cron → `GET /ops/reconcile-wallet`, CRON_SECRET
  guarded, 500 on mismatch) instead of documented on a VM that does not exist.
- An authorisation-failure alert exists with firing and quiet cases; the metrics no longer
  label every pre-handler refusal as `unmatched`; the dead provider-health registry is wired.
- Dependabot has limits and major-version ignores during the stabilisation window; the
  install-script allow-list is enforced with `--strict-allow-scripts`; concurrency groups
  cover the Android and CodeQL workflows; `.dockerignore` stops shipping ~130 MB of local
  artefacts into builds.

### Removed — slop and repo entropy (F-90, F-95, F-96, F-53)
- `tmp_fix_routes.mjs` (a stale 596-line generator for the payments file), four debug APKs,
  four zero-byte logs, `New folder/`, `api-full-validation.sh`; the fabricated
  `phase8-state-cleanup.md` is archived with a rejection banner; the two Trivy ignore files
  are one.

### Measured (2026-11-11)
- API suite: **134 files, 749 passed / 1 skipped, 0 failed**; coverage
  **87.46 / 77.57 / 91.86 / 89.73** (floors 82/72/84/84, held upwards).
- Web: **276 tests passing**, coverage **67.05 / 55.42 / 64.79 / 69.58**, lint 0 warnings,
  entry bundle 130.07 kB gzip (budget 132), preflight 12/12.
- Duplication **0.66%** (was 3.42% and failing); lint warnings **120/143** (was saturated at
  143/143); the contract fixture probes **36** endpoints (was 24, partly vacuous).

### Changed (2026-11-10 documentation integrity, legal text and the release record)

- **The privacy policy is one document again, and it describes the system truthfully (F-10, F-11).**
  `apps/web/src/features/legal/content.ts` is the single source of the privacy text; the root
  `PRIVACY_POLICY.md` is its markdown mirror and was rewritten in the same change. The hosting row
  no longer claims "Bangladesh/Singapore": API functions and the primary database execute in the
  **United States (US East, `iad1`)**, and an explicit cross-border-transfer clause states what
  leaves Bangladesh, where it goes, why, and the mitigations. The false "no identifying data"
  analytics claim is gone; the weather/AI providers and the 180-day retention row now match the
  published text; the crash-monitoring purpose claim was removed (no crash-reporting sink exists,
  `AGENTS.md` §14). `docs/data-protection.md` carries the post-fix deletion behaviour (farm geo
  fields and advisory text — marked as landing in the same remediation wave) and its own false
  crash/device-ID row was corrected.
- **The evidence layer is honest about what is not in the repository (F-21).** Every citation into
  the machine-local `.audit/**` tree is now marked as not-in-repo with its reason (the 2026-11-10
  full-qa audit's own re-probe cited where one exists); `.audit/`, `.audit-archive/` and
  `.agent-evidence/` are in `.gitignore` with reasons (previously excluded only by
  `.git/info/exclude`, which is not cloned); `AGENTS.md` is tracked, so both doc gates now cover it
  (F-79).
- **Line-number citations in the core documents were re-anchored to symbols (F-21b).**
  `docs/business-rules.md`, `docs/threat-model.md`, `docs/slo.md`, `docs/runtime-contract.md`,
  `docs/legal-compliance-checklist.md`, `docs/architecture.md`, `docs/security.md`,
  `docs/database.md`, `docs/retention-and-logs.md` and `docs/STATUS.md` now contain **zero**
  `file:line` citations — 226 occurrences re-anchored to symbol, route or file form (preferred:
  `` `symbol` in `path` ``, which cannot rot while three streams edit the API sources). The same
  pass covered `docs/UI_UX_CONTRACT.md`, `docs/asset-provenance.md`, `docs/ai.md`,
  `docs/glossary-bn-en.md` and the launch docs, and fixed citations to the 2026-11-10 renamed test
  suites.
- **The two contradicting tracked audit reports carry dated banners (F-21c).** Both now state that
  their verified SHAs are not ancestors of `main` (they live only on unmerged `chore/*` branches),
  that their verdicts are superseded, and that the current audit is
  `docs/audit/2026-11-10-full-qa-audit.md`. The decision trail is kept, not deleted.
- **The module inventory is 15 directories, in both places that state it (F-51)** — `AGENTS.md` §4
  and `docs/architecture.md` (the omissions were `membership` and `ops`; `ops/routes.ts` carries
  the retention trigger, a data-deletion surface).
- **`AGENTS.md` §9 now matches what CI actually runs (F-16).** The phantom
  `scripts/qa/license-allowlist.json` is replaced by the two real files and their two gates
  (`scripts/licence-allowlist.json` → `node scripts/licence-gate.mjs`, CI; repo-root
  `license-allowlist.json` → `npm run qa:licenses`, not in CI), and the gate list gains
  drift-check, todo-gate, lint-budget, check-versions, commitlint, generated-docs freshness, the
  IaC scan and ZAP — plus the fact that five CI jobs are not required checks.
- **The ADR index is complete (F-55):** 0017–0021 indexed, 0014/0015 marked superseded in the
  index, and `ADR-0001-login-gated-marketplace-catalog.md` renamed to
  `0001-login-gated-marketplace-catalog.md` so `ls docs/adr` sorts.
- **`docs/generated/` is generated again (F-52, F-53, F-89).** 16 byte-identical archive copies
  were returned to `docs/archive/` (their content is untouched there), leaving only the three
  files the generators write; `docs/api.md` now points at `docs/generated/route-matrix.md` instead
  of a path that never existed; the React-Query proposal now sits in the archive behind a
  **rejected proposal** banner (no such dependency exists; `AGENTS.md` §4 forbids it).
- **One traceability document (F-56):** `docs/traceability.md` is retired to a redirect stub;
  `docs/qa/test-traceability.md` is the live map and tracks the renamed suites.
- **One current launch-readiness record.** `docs/PLAY_STORE_LAUNCH_AUDIT.md` (a `NO-GO` on 1.3.0)
  moved to `docs/archive/2026-11-10/` with a banner naming what closed each blocker — including the
  two false HIGH findings (no `.env` was ever tracked in any ref; no react-query/tanstack package
  exists) — and the surviving register is `docs/PLAY_STORE_LAUNCH_PLAN.md` with the requirements
  gate in `docs/play/store-readiness-checklist.md`.
- **Bengali terminology resolved (F-93):** Farm → **খামার** is standardised across the dictionary
  (`grep -c ফার্ম apps/web/src/lib/i18n.ts` → 0); `docs/web-glossary.md` is superseded to a pointer
  at `docs/glossary-bn-en.md`, the single authority.
- **The agronomist review sheet lists the real corpus (F-101):** the seven `KNOWLEDGE_BASE` ids,
  replacing two ids that do not exist and adding the omitted `rice-urea`.
- **The deployment doc names the runtime schema correctly (F-61):**
  `apps/api/prisma/postgres/schema.prisma` is the copy production runs; the auxiliary copy and the
  duplicate compose line are labelled as such, and the known-broken `exec … migrate deploy` step is
  flagged rather than silently repeated. `docs/STATUS.md` states the branch-protection truth
  (ruleset `25297401` is active) and the five CI jobs that are not required checks (F-65); its
  stale "52-spec browser suite" count is replaced by 22 Playwright spec files with the command.
- **Benefit copy is no longer a sold-but-absent promise (F-62):** the wallet renders the per-tier
  "AI advisory limit ×4 / ×10" copy the seed now carries, and the legacy "Unlimited AI advisory"
  key maps to honest wording for rows seeded before the fix.
- Verified in this pass: `node scripts/qa/link-check.mjs` clean (55 relative targets, tracked set),
  `node scripts/qa/claims-check.mjs` clean, `node apps/api/scripts/route-matrix.mjs --check` up to
  date (87 routes), and the regenerated `docs/erd.md` / `docs/env-reference.md` /
  `docs/generated/erd.mmd` all `--check` clean.

## [2026-11-03] — production release 3f1c991 (PRs #88, #89, #90; record #91)

> App version stayed `1.4.1` — no `version.json` bump was made for this release; it is
> identified by the production commit. The record commit (#91) and its correction (#92) are
> docs-only.

### Deployed (2026-11-03 production at 3f1c991)
- **Production runs the quiet-surfaces pass.** Web and API both report `3f1c991` (web `version.json`
  built 2026-11-03T09:17:00Z; API `/health` `env: production`), and the deploy-verification gate
  passed on the merge. Supersedes the `3e8b5c4` stamp: `dd58587` (#88, #89) had been live since
  2026-10-30 without a STATUS update, and this record covers both it and #90.
- Verified against the live site, not just the build: the shipped entry chunk
  (`/assets/index-Bjeuj7BB.js`, 404,950 bytes) contains **zero** occurrences of the twelve removed
  strings and one of each replacement, the dashboard and services pages render the simplified
  layout, and the login screen carries the task heading with no hero copy. The public-language fix
  from #83 is visible working: this browser carried `agrobridge.auth_lang=en` and the live login
  rendered English until the visitor switched it.
- Verified that the Android artifact matches: the debug APK CI built from `3f1c991`
  (`agrobridge-debug-apk`) bakes `version.json` with commit `3f1c991`, its bundled entry chunk
  (`assets/public/assets/index-Bjeuj7BB.js`) was **byte-identical** to the chunk serving from
  `3f1c991` (SHA-256 `c3df0367e000b844f8eb712da7896fc2e45c018bcc4e05438cbb411ac1764b9c`,
  404,950 bytes), and `AndroidManifest.xml` carries `versionName` 1.4.1 / `com.agrobridge.app`.
  A device or emulator was not available on the verification machine, so the APK was checked by
  content rather than run.
- **How to re-check the APK against a later deployment.** The docs-only merge that carried this
  record (`84cf9c0`) rebuilt the bundle from identical sources, so the file serving today is
  `index-o4UoFM_O.js` and its hash differs. The build stamp is compiled into every chunk, which
  changes each chunk's content hash and therefore the lazy-route filename table in the entry: the
  two builds have the **same byte length** (404,950) and every differing region lies inside Vite's
  `__vite__mapDeps` array. Compare an APK against the chunk built from its *own* commit, not against
  whatever the CDN serves today.
- Production hardening re-probed while there: none of the seeded demo credentials authenticate
  (`401` for all four demo phones), a farmer token gets `403` from `/admin/metrics` and
  `/admin/users`, the withdrawal endpoint refuses a below-minimum amount (`400`), an amount above
  the available balance (`422`) and an unknown channel (`400`), registration refuses a
  100-character password, a missing consent flag and a 9-digit phone, and a negative farm area is
  rejected.
- No schema, migration, dependency, environment-variable or workflow change is part of this release;
  no migration was pending or applied (`/ready`: schema applied 11/11).
- Checks on the merge: 19/19 on PR #90, then the push-triggered CI (13 jobs), CodeQL and the
  deploy-verification job all green on `3f1c991`.

### Changed (2026-11-03 the interface carries state and actions, not copy — #90)
- **Every screen now shows what is true and what can be done, and stops there.** The web app had
  accumulated copy that described the screen back to the reader, sold the product on the screens of
  the people already using it, and repeated in a sentence what a heading, a label or a button had
  already said. The rule now applied throughout is the one Linear and Apple Notes follow: a screen
  states its state and offers its actions, and assumes the person reading it can read.
- Removed, per surface:
  - **Shell** — the slogan under the app name in the header, and the same slogan in the document
    title on routes with no title of their own. The header is the mark and the name.
  - **Auth** — the brand panel's headline and its three value bullets, the identical block repeated
    below the card on mobile, the "AI in every farmer's hand" line in both places, and the three
    subtitles ("Sign in to your account", "Create your farm account in minutes", "Enter your number,
    take the code, set a new password"). Login's heading is now "Login" — the task — instead of
    "Welcome", which named the user's arrival rather than the screen. Also gone: the "fix the
    highlighted errors and try again" line, which the highlighted errors said themselves.
  - **Home** — the "Farm readiness" badge above the state headline, the sentence under every state
    ("Weather risks detected — take precautionary action"), the two "add your first crop" lines that
    repeated the empty cards' own titles, the "AI • AgroBridge" badge and "How can I help your farm
    today?" line, and the four sub-lines under the quick-action tiles.
  - **Services** — the hero (a "Platform-listed" badge, a slogan headline, a subtitle, a "Find a
    service" button that focused the search field below, a service count, and a summary panel
    counting the categories the filter chips already name), the "How it works" section (three steps
    describing the dialog the next tap opens), the "Why AgroBridge" section (three claims), and the
    closing CTA. The page is now: title, search, filters, sort, catalogue, bookings.
  - **MyFarm** — the counts-chips card (it tallied the tasks listed under it), the "Tomorrow &
    upcoming" card (the same crops, stages and planting dates as the farm cards below, twice), and
    the "My Farm AI" card (an AI badge, a sentence counting the active crops, a disclaimer about the
    sentence). The weather risk that card carried now sits directly above today's tasks, where it can
    change what the farmer does.
  - **Settings, Advisor, Notifications, Onboarding, Market, MyOrders, 404, splash** — the settings
    subtitle, the long district/upazila explanation (replaced by a three-word caption next to the
    fields), the "your number is verified — you can withdraw" restatement of the Verified badge, the
    example question in the empty advisor chat (the input's own placeholder says it), the
    notification-preferences description, the "confirm your profile and continue" line above the Next
    button, and the empty-state descriptions on market, orders, bookings and services.
- **Two shared components lost the prop that carried the pattern**, so it cannot come back by
  accident: `PageHeader` has no `subtitle`, and `EmptyState` has no `description`. An empty state
  that genuinely needs a second line needs an action — which is the `action` prop it already had.
- **Service cards no longer invent content.** Eight per-category "fallback descriptions" ("Fast spray
  without trampling — even coverage") were rendered as though the provider had written them; a
  service with no description now shows none. The "New — no ratings yet" chip is gone too: an absent
  rating is absent, not a label. The card's two buttons ("View details" and "Book now") were wired to
  the same handler and opened the same dialog, so the card now has the one action it performs.
- **Honesty rules were preserved, not traded for brevity.** Where a sentence existed to prevent the
  UI from asserting something it did not know, it stayed — shortened, not deleted. The readiness
  meter's "from your records and today's weather" became a three-word caption that still drops the
  weather half when the weather read failed; `farmDataUnavailable`, `weatherUnavailable` and
  `alertsUnavailable` are untouched; the AI advisory disclaimer, the sandbox-payment note and the
  account-deletion disclosure are untouched in full.
- **Not copy, but measured**: `apps/web/src/lib/i18n.ts` loses **81 entries**. The identity is exact
  at the rebase point: `main` declares 612, this branch declares 531, 531 = 612 − 81. A key that
  nothing references already failed the unit suite; it now also fails on a marketing-shaped *name*
  (`tagline`, `hero*`, `promo`, `slogan`) — the rule written down in `docs/ui-copy.md` and made
  mechanical in `src/lib/i18n.deadkeys.test.ts`.
- Verified (rebased onto `dd58587`, which landed #88/#89 while this branch was open): web unit suite
  **214 passed / 27 files** (baseline 212/26 — +1 is the new ratchet, +1 file is main's advisor
  sources spec); typecheck, lint (0 warnings), `i18n:check` (378 referenced, 531 declared, 0 missing,
  0 inline language ternaries) and the build all clean; `node scripts/qa/lint-budget.mjs` web 0/0;
  `link-check` and `claims-check` clean. Browser suites against an isolated stack (API `:4599`,
  web `:5301`): **chromium 91 passed / 1 skipped** — the axe scans of `/`, `/market`, `/wallet`,
  `/services`, `/orders`, `/sell`, `/settings`, `/notifications` and the login error state in both
  themes with zero critical/serious violations, `visual-contract` at 390 px **and** 360 px with no
  horizontal overflow, `console-health` with no console errors or failed requests, and main's new
  scenario acceptance specs — plus **firefox + webkit 12/12**. One spec, `[ADM-01]`, needed
  `E2E_DB_URL` because it reads ground truth from a SQLite file and defaults to CI's `test.db`; with
  the stack's own database it passes (9/9 in that file). A screenshot pass reviewed `/login`, `/`,
  `/services`, `/farm`, `/market`, `/settings` and the 404 at 390 px and 1280 px. Commands, numbers
  and the rebase resolution: `qa-evidence/receipts/2026-11-03-quiet-surfaces.md`.

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
