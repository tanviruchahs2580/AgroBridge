# Verification receipt — schema drift found in production, release contract closed (2026-10-18)

Why this file exists: the finding below is about **production state**, which no CI run can
reproduce and no local log records. The numbers are produced by commands a reader can re-run;
the audit that found it is described in the final report of the 2026-10-18 architecture pass.

**Machine:** Windows 11 (win32 10.0.26300), Node 24.19.0, npm 11.17.0, Docker 29.7.2, Vercel CLI 59.9.1
**Baseline commit:** `6786a24` (main, deployed to both Vercel projects)

## 1. What was wrong

`prisma migrate status` against the production Neon database, before remediation:

```
5 migrations found in prisma/migrations
Following migrations have not yet been applied:
20261016000000_payment_pending_per_user
20261016010000_status_created_at_idx
20261018000000_hot_query_indexes
```

Production had **2 of 5** migrations applied. The three missing ones were:

| Migration | Missing in production |
|---|---|
| `20261016000000_payment_pending_per_user` | partial unique index `Payment(userId, purposeType, purposeId) WHERE status='PENDING'` — the database-level half of "one live payment intent per user and purpose" |
| `20261016010000_status_created_at_idx` | composite `(status, createdAt)` indexes for the status-sorted admin/member lists |
| `20261018000000_hot_query_indexes` | the Phase 3 hot-query indexes: `Product(isActive, category)`, `Order(userId, createdAt)`, `AuditLog(createdAt)` |

Every gate was green while this was true: `deploy-verify` proves the deployed **commit**, `/health`
proves the process, `/ready` proved only that a `SELECT 1` succeeded. The schema was the one
release artifact nothing compared. The repository's own changelog claimed those indexes existed —
the repository was right, production was wrong, and no check could tell the difference.

Pre-flight check before touching anything (read-only): no duplicate PENDING intents existed, so the
partial unique index could be created without first reconciling data.

```
 userId | purposeType | purposeId | pending_count
--------+-------------+-----------+---------------
(0 rows)
 payments_total | pending
              4 |       0
```

## 2. Remediation (the documented procedure, not a new one)

`apps/api/scripts/deploy-migrations.mjs` — idempotent and baseline-aware, the same script
`docs/runbooks/live-deployment.md` prescribes:

```
Applying migration `20261016000000_payment_pending_per_user`
Applying migration `20261016010000_status_created_at_idx`
Applying migration `20261018000000_hot_query_indexes`
All migrations have been successfully applied.
```

After:

```
Database schema is up to date!      # prisma migrate status
AuditLog_createdAt_idx · Order_status_createdAt_idx · Order_userId_createdAt_idx
Payment_status_createdAt_idx · Payment_user_purpose_pending_key
Product_isActive_category_idx · Withdrawal_status_createdAt_idx
```

Live API unaffected: `/health` 200 (`commit 6786a24`), `/ready` `{"db":true}`, login for the
reviewer account 200 with a token. The deployed API's compatibility with the new constraint is not
a hope: CI's PostgreSQL job runs this same migration chain (`158 passed` at this commit).

## 3. What now prevents a repeat (same PR)

- `/ready` reports `schema: { known, applied, latest }` — the applied chain, cached 60 s per
  instance, `known:false` (never a 500) where no migrations table exists.
- `deploy-verify.yml` gained a step that compares `schema.latest` with the newest directory in
  `apps/api/prisma/postgres/migrations` and fails after the 10-minute window with the remediation
  command in the message. Applied migrations are therefore part of what "production is current"
  means (ADR-0007).
- Verified locally before pushing: the workflow YAML parses with the four expected steps; the local
  dev API's `/ready` returns `{"schema":{"known":true,"applied":9,"latest":"20261018000000_hot_query_indexes"},"limiterStore":"memory"}`
  after the local database was brought up to the chain (and returns the previous value for up to
  60 s — the cache, observed rather than assumed).
- The gate is expected to **fail until this PR's API build is deployed**; that is the design, not a
  regression. The post-merge run of `Deploy verification` is the proof it passes against a
  production that includes the change.

## 4. Local gates for this change

| Gate | Command | Result |
|---|---|---|
| API lint | `cd apps/api && npx eslint src tests` | 0 problems |
| API typecheck | `cd apps/api && npm run typecheck` | clean |
| API suite | `cd apps/api && npx vitest run` | **159 passed / 1 skipped** (160) — +2 tests for the readiness contract |

## 5. Claims from the audit that I verified myself (not taken on trust)

| Claim | Verification |
|---|---|
| Foreign-key indexes missing on `Booking.farmId/serviceId/providerId`, `OrderItem.productId`, `FarmEvent.plotId`, `DiseaseCase.cropCycleId`, `ProcurementOrder.farmId`, `ServiceProvider.userId` | read `schema.prisma` model by model — confirmed; queued for the DB pass, not fixed here |
| `.env.example` documents `API_BASE_URL`, which no code reads | `grep` for readers: none; `env.ts:12` + `payments/routes.ts:54` read `API_PUBLIC_URL` — fixed in this PR |
| `.trivyignore` waiver expired 2026-09-30 while `SECURITY_WAIVERS.md` says 2026-12-31 | both files read — reconciled in this PR to the register's date with the renewal recorded |
| Local dev database was one migration behind the chain | `apps/api/prisma/dev.db` readout: `applied: 8` → after `prisma migrate deploy`, `applied: 9` |
