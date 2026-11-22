# ADR-0025 — Async work: outbox + scheduled workers (Phase A design)

- Status: **proposed** (waits DR-07 approval; supersedes ADR-0010's "no job queue" only after it)
- Date: 2026-11-23
- Deciders: engineering (design); owner approves the mechanism
- Findings: ARC-04, REL-04, REL-05

## Context

Side effects run inline with the request: SMS, notifications, post-payment effects, retention,
reconciliation. ADR-0010's answer was "no job queue" — correct for the pilot, but the audit's
ARC-04/REL-04/REL-05 note the costs: a slow dependency back-pressures the request, a crash loses
half-completed side effects, and the retention cron runs inside an HTTP function with no lock and
no missed-run alert.

## Options compared

| Mechanism | Verdict |
|---|---|
| **A. DB outbox + scheduled endpoint** (recommended) | No new infrastructure; the transaction that changes state inserts the outbox row — atomicity is free; a secret-guarded scheduled endpoint (like the existing retention trigger) claims rows with a lease. Fits Vercel's cron cadence; the failure mode is bounded and visible |
| B. External queue (pg-boss/BullMQ) | Real workers and back-pressure, but a new dependency and a new always-on host (the compose topology is a scaffold that has never run); the serverless runtime cannot host a worker process |
| C. Dedicated worker host | Maximum control; an ops surface the team does not have yet (one maintainer, no paging sink) |

## Proposed design (option A, no code yet)

- `Outbox` table: `type`, `payload` (JSON string in the SQLite chain, the native type when DR-01
  lands), `status` (`PENDING`/`PROCESSING`/`DONE`/`DEAD`), `attempts`, `nextAttemptAt`,
  `lockedUntil`, `lastError`, unique `idempotencyKey`.
- Enqueue **inside** the business transaction — the existing `claimPendingPayment` pattern shows
  the shape.
- Processor: a secret-guarded endpoint on the Vercel cron cadence; claims with a lease
  (PostgreSQL `FOR UPDATE SKIP LOCKED` behind a dialect guard; conditional-update claim on SQLite);
  bounded batches; exponential backoff + jitter; dead-letter after N attempts; run records.
- Handlers idempotent (keyed by the outbox row), never trust at-least-once delivery to be once.
- Migration of inline side effects **one at a time behind flags**: SMS sends, notifications,
  post-payment effects, retention, reconciliation — in that order of risk.
- Metrics + alerts: oldest-pending age, dead-letter count; read-only admin visibility.

## Verification plan (when approved)

Crash mid-job → retried once; duplicate delivery → idempotent; two processors → single claim
(UJ-13); PostgreSQL profile for the lease semantics.

## Decision requested

Approve option A (this supersedes ADR-0010's "no queue" — an owner decision) or pick B/C.
