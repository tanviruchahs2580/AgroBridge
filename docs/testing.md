# Testing

Framework: **Vitest + Supertest** against the real Express app. Two database profiles:

| Profile | Config | DB | Command |
|---|---|---|---|
| SQLite (fast, default) | `vitest.config.ts` | fresh `prisma/test.db` per run | `npx vitest run` |
| **PostgreSQL** | `vitest.config.pg.ts` | real PostgreSQL 17 server | `DATABASE_URL=… node scripts/provision-postgres.mjs && npx vitest run --config vitest.config.pg.ts` |

Current totals: **79 tests, all passing on BOTH SQLite and PostgreSQL 17.5**
(verified locally against an embedded PostgreSQL 17.5 on Windows; CI runs the PG profile
against postgres:17-alpine).

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

## Performance baseline (local PostgreSQL 17.5, 10s autocannon bursts)
| Endpoint | req/s | p50 | p90 | p99 |
|---|---|---|---|---|
| GET /health | ~6200 | 1ms | 2ms | 5ms |
| GET /products?pageSize=12 (auth+DB) | ~400 | 23ms | 32ms | 45ms |
| GET /weather (mock provider) | ~620 | 14ms | 20ms | 39ms |
| POST /auth/login (bcrypt cost 12) | ~7–8 | ~1.2s | 1.5s | 1.9s |
| POST /ai/advisory | quota-bound by design (30/h/user) |

Login throughput is intentionally bcrypt-bound (~130–250ms/hash on this hardware class);
scale horizontally behind a load balancer or add progressive throttling before raising the cost.

## CI
`.github/workflows/ci.yml`: lint → typecheck → SQLite suite → **PostgreSQL 17 service job with the
full suite** → web build → Docker image builds → npm audit + secret scan.
