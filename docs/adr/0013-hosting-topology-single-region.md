# ADR-0013: Hosting topology — Vercel functions with Neon PostgreSQL, one region

Status: Accepted · Date: 2026-10-21 · Deciders: engineering; region/cost owner

## Context

The API deploys as Vercel serverless functions (Node) with Neon PostgreSQL
(primary in `iad1`), while the SQLite-and-docker profiles serve development/CI.
Farmers are in Bangladesh (~UTC+6), so the function↔DB round trip dominates.

## Decision

1. API functions and the Neon primary stay in ONE region (co-location beats any
   multi-region fantasy for this latency-critical workload) — observed live as
   `iad1` (AUD-163).
2. The runtime contract (regions, maxDuration, pool sizing, instance
   protections) is published on `docs/runtime-contract.md` and is the place every
   new env knob must be registered. An unknown knob in code without a runtime
   page entry is a docs defect.
3. Scaling is horizontal: instances share nothing; limiter windows need
   `REDIS_URL` when more than one instance exists (ADR-0010); money invariants
   live in the database, never in instance memory.
4. Durability of user uploads is NOT provided by instance disk — the storage
   provider abstraction (`STORAGE_PROVIDER`) must point at object storage or the
   database before production of that feature (AUD-165, tracked).

## Consequences

- Single-region means a regional outage is a full outage — mitigated by the
  backup/restore story, not by multi-region over-engineering for this stage.
- Every instance protection knob is placeholder-safe-by-default (overload guard
  128, pool cpus×2+1): the guard prevents collapse but is not capacity.
