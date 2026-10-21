<!-- owner: @tanviruchahs2580 · purpose: how the suites run on both database profiles · last-verified: 2026-10-21 @ 6550a9a -->

# Testing

Framework: **Vitest + Supertest** against the real Express app. Two database profiles:

| Profile | Config | DB | Command |
|---|---|---|---|
| SQLite (fast, default) | `vitest.config.ts` | fresh `prisma/test.db` per run (`migrate deploy` + seed) | `npx vitest run` |
| **PostgreSQL** | `vitest.config.pg.ts` | real PostgreSQL 17 server, provisioned from **the production schema and migration chain** (`prisma/postgres/`) | `DATABASE_URL=… node scripts/provision-postgres.mjs && npx vitest run --config vitest.config.pg.ts` |

The PostgreSQL profile provisions with `prisma migrate deploy` against
`prisma/postgres/schema.prisma` — the same chain `scripts/deploy-migrations.mjs` applies to
production, and the one the deploy gate compares production against (ADR-0007). Until
2026-10-18 it used `prisma db push` against a second schema copy, so CI's PostgreSQL job
built its database from an artifact production never runs and nothing in CI proved the chain
could be applied at all.

The profile expects a **fresh** database: re-provisioning re-seeds with upserts, which does
not restore stock an earlier run decremented, so tests that buy seeded products can fail on a
used database. Drop and recreate it first.

Current totals (2026-10-18, post audit-remediation): **341 passed + 1 skipped on SQLite,
342 passed on PostgreSQL 17** (the skip is the PostgreSQL-gated concurrency test; on PG it runs).
Web unit: 159; web e2e: 30. CI runs the PG profile against postgres:17-alpine.

Local note: the two profiles generate different Prisma clients. After running the PG profile,
regenerate the SQLite client (`npx prisma generate` in `apps/api`) before the SQLite suite —
otherwise the seed runs against a PG-generated client and the suite aborts with a seed error.

E2E limits note (AUD-134): the browser suite makes far more requests than a person. CI's e2e job
therefore raises `RATE_LIMIT_MAX` (2000) and `LOGIN_RATE_LIMIT_MAX` (500) for its throwaway
instance; when running the suite locally against your own server, export the same two variables
(or restart the API between full runs) — otherwise the global 300-req/15-min window is exhausted
mid-suite and unrelated tests fail with 429-driven timeouts. The production policies remain
exercised by the API suites.

## Suites
1. `unit-core.test.ts` — procurement price engine, membership discounts, weather→risk engine,
   crop lifecycle staging + calendar, KB retrieval & sanitization.
2. `journey-auth.test.ts` — registration/login/profile/refresh rotation/logout; enumeration resistance.
3. `journey-farm.test.ts` — farm→plot→crop, lifecycle auto-stage, ownership isolation,
   plot-area validation, offline-sync idempotency.
4. `journey-weather-ai-disease.test.ts` — weather advisories, AI grounding & low-confidence honesty,
   advisory history, disease upload validation + review workflow + notifications.
5. `journey-marketplace.test.ts` — catalog pagination/filtering, checkout with stock decrement,
   delivery fee rule, over-stock rejection, membership discount at checkout.
6. `journey-services-procurement.test.ts` — booking lifecycle incl. RBAC on assignment, rating
   aggregation, sandbox payment; procurement pipeline with auditable math and wallet payout.
7. `journey-admin.test.ts` — live metrics, user search/suspend (instant session revocation),
   audit log contents, AI usage telemetry, notification flows and cross-user isolation.
8. `security-observability.test.ts` — helmet headers, structured 404, malformed JSON → 400,
   oversized payload → 413, forged JWT → 401, CORS origin policy.
9. `concurrency.test.ts` *(PostgreSQL profile)* — parallel checkouts never oversell
   (atomic conditional decrement), concurrent procurement payouts credit exactly once
   (atomic state claim), provider reassignment consistency. **These tests exposed two real
   race conditions that were then fixed** (see CHANGELOG).
10. `security-matrix.test.ts` — IDOR across orders/payments/notifications (404-scoping, no
    existence oracle), privilege-escalation attempts, refresh-token hashing at rest + replay after
    logout, oversized upload abuse, elevated-role permission boundaries, AI hourly quota enforcement.
11. `ai-eval.test.ts` — behavioural evaluation: Bengali disease queries retrieve correct KB entries;
    English parity; Banglish mixed-script grounding; out-of-domain refusal (hallucination guard);
    prompt-injection neutralization; no unverified chemical dosage instructions.
12. `ai-eval-harness.test.ts` + `ai-eval-degradation.test.ts` — the frozen 109-item held-out
    set with pre-registered thresholds (hit-rate, containment, abstention, clarify, language,
    safety referral, p95); the degradation test proves the gate fails on a broken corpus.
    `npm run eval:ai` writes `apps/api/eval-artifacts/ai-eval-latest.json`.
13. `ai-prompt-injection.test.ts` — 51 table-driven injection cases across ten categories.
14. `ai-provider-adapter.test.ts` — the OpenAI-compatible adapter's full failure taxonomy
    (empty/filtered/truncated/429/5xx/timeout, one bounded retry) with stubbed fetch.
15. Audit-remediation regressions: `services-pricing-rating`, `checkout-idempotency`,
    `order-cancel-restock`, `payments-webhook-amount`, `payments-refund-provider-mode`,
    `timezone-boundaries`, `farm-event-sync-scoping`, `cors-origin-policy`, `log-redaction`,
    `admin-pagination-bounds`, `ai-history-refs`.

## Performance baseline (local PostgreSQL 17.5, 10s autocannon bursts)
| Endpoint | req/s | p50 | p90 | p99 |
|---|---|---|---|---|
| GET /health | ~6200 | 1ms | 2ms | 5ms |
| GET /products?pageSize=12 (auth+DB) | ~400 | 23ms | 32ms | 45ms |
| GET /weather (mock provider) | ~620 | 14ms | 20ms | 39ms |
| POST /auth/login (bcrypt cost 12) | ~7–8 | ~1.2s | 1.5s | 1.9s | *(superseded 2026-10-21: hashing moved to the worker pool — see docs/performance.md)*|
| POST /ai/advisory | quota-bound by design (30/h/user) |

Login throughput is intentionally bcrypt-bound (~130–250ms/hash on this hardware class);
scale horizontally behind a load balancer or add progressive throttling before raising the cost.

## CI
`.github/workflows/ci.yml`: lint → typecheck → SQLite suite → **PostgreSQL 17 service job with the
full suite** → web build → Docker image builds → npm audit + secret scan.
