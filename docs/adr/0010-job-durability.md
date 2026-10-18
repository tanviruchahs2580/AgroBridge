# ADR-0010 — No server-side job queue: Redis is rate-limit-only and fails open

- Status: accepted
- Date: 2026-10-18
- Deciders: engineering; decision recorded from the shipped system during the 2026-10-18 audit

## Context

The system needs to answer "what happens to work that must happen later?" for several flows:
payment settlement and webhook ingestion, withdrawal decisions, procurement payouts, wallet
reconciliation and disease-photo intake review. A common answer is "put it on a queue" (BullMQ,
SQS, …). This codebase does not have one, and an audit found the absence was implicit — visible
only to someone who greps for a queue library and finds none.

What exists instead, and why it is not a queue:

- **Redis is present but does one thing.** `REDIS_URL` selects a Redis-backed rate-limit store
  (`apps/api/src/infrastructure/rateLimitRedis.ts`) so limits are shared across instances. It
  holds fixed-window counters and nothing else — no jobs, no locks, no retries.
- **That store fails open.** On any Redis error, `increment()` returns `{totalHits: 0}` — requests
  are allowed by design ("availability beats strict limiting for this product",
  `docs/security.md`). `/ready` therefore reports `limiterStore: "redis" | "memory"` and the API
  logs a production warning when `REDIS_URL` is unset (`apps/api/src/app.ts`): running without
  Redis is an accepted fail-open, made visible rather than silently different.
- **Durability lives in the database, not in a worker.** Every flow that must not lose work is a
  state machine over Prisma rows with atomic claims: payment intents move PENDING → SUCCEEDED
  through a claim-then-apply transaction and the signed gateway webhook is the settlement trigger
  (`apps/api/src/modules/payments/*`); withdrawal requests hold funds in `heldPaisa` until a
  finance decision releases them (`/wallet/withdrawals`, `/admin/withdrawals/:id/decision`);
  procurement offers advance through `QC_PASS → ISSUE_PO → COLLECT`. A process crash mid-flow
  leaves a row in a state a later request or operator action can finish — provided someone or
  something calls it.
- **Background work is cron + scripts, not a worker fleet.**
  `apps/api/scripts/reconcile-wallet.mjs` (daily, exits 1 on mismatch),
  `apps/api/scripts/deploy-migrations.mjs`, `apps/api/scripts/prune-uploads.mjs`, and the
  `deploy-verify.yml` gate are the operational substitutes for a scheduler.

## Decision

1. **Do not introduce a server-side queue for the current topology.** The deployment is a Vercel
   serverless function + Neon PostgreSQL (see `docs/runbooks/live-deployment.md`); a durable
   queue would add an always-on worker and a second state store for flows that are already
   database state machines with webhook-driven completion.
2. **State the guarantee honestly.** Delivery of money-path side effects relies on (a) the
   provider webhook or (b) an explicit reconciliation call (`GET /payments/:id/status`), and on
   the daily wallet reconciliation script for detection. There is **no automatic retry
   scheduler**; a webhook lost twice is caught by reconciliation, not by a retry job. This is the
   documented operating procedure (`docs/runbooks/failed-transaction-recovery.md`), not an
   accident.
3. **Redis stays rate-limit-only and fails open.** No feature may treat Redis as durable. If a
   future cache or lock uses it, that use must declare its own failure mode; the rate limiter's
   fail-open is specific to limiting, not a house style for correctness-critical paths.
4. **The client queue is the one "queue"** (ADR-0009) — local, allow-listed, server-idempotent,
   and explicitly not a sync engine.

## Consequences

- The honest failure mode: a flow that needs "eventually" has to be observed (monitoring alerts
  `PaymentFailures`, `DbDown` in `monitoring/alert_rules.yml`) and finished by an operator path
  that exists. Missing that is an operational risk the runbooks name; it is accepted for the
  current scale.
- Scaling out horizontally does not change job semantics because there are no jobs — the atomic
  DB claims are the concurrency control (proven by `tests/concurrency.test.ts`,
  `withdrawal-race.test.ts`).
- Introducing a queue later (email/SMS fan-out, image processing) is a genuine architecture change
  requiring a new ADR: it must name the transport, the delivery guarantee, the idempotency key,
  and the dead-letter/alerting path — none of which exist today.
