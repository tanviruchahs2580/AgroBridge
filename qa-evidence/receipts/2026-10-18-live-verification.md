# Verification receipt — live verification round, 2026-10-18

Why this file exists: the numbers below were produced on a workstation. CI run IDs are the
durable evidence for anything CI produces; this covers the local gates, the production
walkthrough and the one defect that walkthrough found.

**Machine:** Windows 11 (win32 10.0.26300), Node 24.19.0, npm 11.17.0, Docker 29.7.2,
Vercel CLI 59.9.1, gh 2.98.0
**Baseline commit:** `6282ca8` (both Vercel projects serving it at the start of the round)
**Question this round answered:** is production running the reviewed source, and does every
user-facing screen and parameter work there — not just locally?

## 1. Local gates (the commands CI runs, on the workstation)

| Gate | Command | Result |
|---|---|---|
| API lint | `cd apps/api && npx eslint src tests` | 0 problems |
| API typecheck | `cd apps/api && npm run typecheck` | clean |
| API suite (SQLite) | `cd apps/api && npx vitest run --coverage` | **157 passed / 1 skipped** (24 files), coverage thresholds met, exit 0 |
| API suite (PostgreSQL 17) | fresh PG 17 container → `node scripts/provision-postgres.mjs` → `npx vitest run --config vitest.config.pg.ts` | **158 passed** (see §4 for the trap this hit first) |
| Web lint | `cd apps/web && npm run lint` | 0 problems |
| i18n dictionary | `cd apps/web && npm run i18n:check` | 321 referenced / 527 declared / 0 missing |
| Web unit | `cd apps/web && npm run test:unit` | **126 passed** (7 files) |
| Web build | `cd apps/web && npm run build` | pass (includes `tsc --noEmit`) |
| E2E journeys | `cd apps/web && npx playwright test` (local stack) | **27/27 passed** (2.1 min) |
| Functional sweep (local) | `node scripts/qa/full-functional-sweep.mjs` | **39 passed / 0 failed / 0 skipped** |
| Prod dependency audit | `npm audit --omit=dev --audit-level=moderate` | 0 vulnerabilities |
| Secret-scan heuristic | the `security-scan` job's `git grep` patterns, run locally | clean |

Deviation worth recording: the first `vitest --coverage` run died inside global setup —
the running dev API server held `query_engine-windows.dll.node`, exactly the papercut
`tests/global-setup.ts` documents. Stopping `npm run dev --workspace apps/api` and
re-running produced the figures above; the server was restarted afterwards.

## 2. Production: is live the reviewed source?

| Probe | Result |
|---|---|
| `curl $API/health` | `{"ok":true,…,"commit":"6282ca8","env":"production"}` |
| `curl $API/ready` | `{"ok":true,"ready":true,"db":true}` |
| `curl $WEB/version.json` | `{"version":"1.4.0","commit":"6282ca8","builtAt":"2026-10-17T20:51:17.281Z"}` |
| `sha256sum` — live `assets/index-*.js` vs a local `npm run build` of the same commit | **identical** (`e8264f68…`, 450 544 bytes) |

That last row is the strongest form of "in sync" available without trusting a timestamp:
the deployed bundle is byte-for-byte the artifact this tree builds, so the running web
includes the reviewed source exactly. `/apps/web/.env.production` and the project env both
point the bundle at `https://agro-bridge-api-vantiq-systems.vercel.app/api/v1` (the only
API host referenced in the live bundle; no retired Render host remains).

## 3. Production: user-level walkthrough

Access note: the demo passwords were rotated off `Demo@1234` per CERT-01 and are held by
the product owner, so the walkthrough used the product's own signup instead — a throwaway
farmer (`01900000123`, "Live QA Verify"), one farm added (রংপুর, 3 বিঘা), then the product.

| Gate | Command | Result |
|---|---|---|
| Live sweep | `SWEEP_MODE=live SWEEP_PHONE=… SWEEP_PASSWORD=… node scripts/qa/full-functional-sweep.mjs` | **38 passed / 0 failed / 2 skipped** (40 checks) |
| Browser walkthrough (real UI, own session) | signup → Home → My Farm (add farm) → Advisor → Market → Orders → Services → Sell Crop → Wallet → Notifications → Settings → legal pages → 404 | every screen rendered live data; no crash, no blank screen |

The two skips are the script's own live-mode policy, printed with their reasons: creating a
crop offer (the procurement record cannot be removed) and the admin console (no admin
credentials on production — the farmer-denied-admin direction *is* asserted, and passed).

The sweep's live buyer journey ran for real against production: cart → checkout with
delivery details → sandbox payment → order history, which came back with the address it was
given ("order placed and paid, address round-trips, history renders"). One test order
exists under the reviewer account as a result — the sweep's documented behaviour.

### Two live failures that were the fixture, not the app

The first live sweep (same account, *before* any farm existed) scored 36/2/2:

- *"readiness basis not rendered"* — with no farm, `/` shows the empty state ("শুরু করতে
  খামার যোগ করুন") instead of the readiness meter, so there is no basis caption to find.
  After adding a farm the same page renders **82 %** with "আপনার তথ্য ও আজকের আবহাওয়ার
  ভিত্তিতে" and district weather (রংপুর, 29.3°).
- *"sell-crop empty submit produced no validation feedback"* — with no farm, the submit
  button is **disabled** and the form says "বুকিং দিতে আগে 'আমার ফার্ম'-এ ফার্ম যোগ করুন।"
  (screenshot: `qa-evidence/sweep-live/11-sell-crop.jpg`); the sweep clicked a disabled
  control. With a farm, the same click yields three `role="alert"` messages.

The re-run with a farm present scored **38 passed / 0 failed / 2 skipped**. Conclusion:
both were the account state the sweep was pointed at, and the app's behaviour in each case
is the correct one.

## 4. The defect this round found (and the fix shipped with this receipt)

In that "three alerts" state the quantity field (কেজি) reported `errAmountInvalid` —
"সঠিক পরিমাণ (টাকা) লিখুন।" / "Enter a valid amount in taka." The wallet's withdrawal form
uses that key correctly (its field *is* taka); the sell form was reusing it for kilos, so a
farmer who typed 0 kg was told to enter an amount of money.

Fix: a distinct `errQuantityInvalid` key plus both `SellCrop` call sites (`submit` and
`onBlur`). Verified on the local build — the same empty submit now reports
"সঠিক পরিমাণ (কেজি) লিখুন।" — and re-verified on production after the deploy (run ID in the
PR / final report).

Trap hit while verifying it (recorded because it cost a full suite run): the PostgreSQL
profile was run twice against the same database. `provision-postgres.mjs` re-seeds with
upserts, which does **not** restore stock that an earlier run decremented, so the
response-contract probe's checkout failed with no stock and the test died reading
`order.body.data.id`. Dropping and recreating the database (what CI's `postgres:17-alpine`
service container gives every job) reproduced CI: **158 passed**. The profile expects a
fresh database, and now says so here rather than leaving the next reader to rediscover it.

## 5. Not verifiable from this workstation (named, not hidden)

- **Admin console against production** — no admin credentials (§3). Covered locally by the
  sweep's admin checks (metrics/users/audit/analytics) and the API's admin journey suite.
- **Record-creating flows in production** beyond the sanctioned buyer journey — skipped by
  the sweep's policy; covered by e2e + the PG concurrency suites.
- **Android APK on a device** — CI builds the debug APK; no device in this session.
