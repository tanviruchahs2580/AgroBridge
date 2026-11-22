# DR-11 — Hosting region / latency budget

Status: open decision (owner) · Inputs: `docs/runbooks/latency-probe.md`, ADR-0018 · Recorded: 2026-11-23 (WP-09)

## The facts already in the repository (not assumptions)

- API functions and the Neon primary are co-located in `iad1` (ADR-0018); the function↔database
  hop is cheap (measured ≈1.2 ms for the auth status read — R-2 of the audit cross-check).
- The leg a Bangladeshi user pays is **client → API over the public internet**, once per request.
  Nothing in the repo measures it; the probe script exists so the owner can.
- Moving **only** the functions closer to users while the database stays in `iad1` makes every
  request worse: the function↔database hop becomes the intercontinental leg. The order of any move
  is **database first, then functions** (plan doc §4.4).

## Options

| Option | What it costs | What it buys | Consequence |
|---|---|---|---|
| **A. Stay `iad1`** (default until measured otherwise) | Nothing; Bangladesh↔US-East RTT stays in every request | Nothing, but the measured number may be inside budget | Close DR-11 with the probe receipts as the evidence; revisit if the pilot grows a Dhaka office using the admin surfaces heavily |
| B. Database first → Singapore or Mumbai, functions follow | Neon plan/region limits (region availability to be verified in the console — **E7**), a data migration (OA-12), a new ADR superseding ADR-0018 | The biggest single RTT reduction available for Bangladesh users | Cutover outline below; Vercel function region pin becomes a config change (never applied by engineering without approval, R2) |
| C. Edge-cache reads in-country | Only viable for public, cacheable reads (product catalog) | Sub-second reads for the catalog | Does not help authenticated farmer flows (wallet, orders, advisory); a CDN policy change, not a region move |

## Proposed budget to decide against

**Authenticated reads p95 ≤ 600 ms on 4G from Dhaka** — engineering's proposal, not a signed SLO
(`docs/slo.md` adoption is OA-05/DR-06-adjacent and stays owner-gated). The number is derived from:
TLS handshake + one RTT + server processing + payload — on typical BD mobile networks the
handshake and RTT alone are ~250–350 ms against US-East; 600 ms leaves headroom for server work
without pretending the RTT away.

## Cutover outline (option B — a plan, not a decision)

1. Verify Neon supports the target region on the current plan (console check, owner).
2. New Neon project/branch in the target region; restore/branch from primary.
3. Run the migration chain on the copy; `prisma migrate deploy` no-op check.
4. Verify from Dhaka with the latency probe (receipt committed).
5. Switch `DATABASE_URL` on the API, then pin the Vercel function region to the same region.
6. Keep the old region as rollback for one soak window; drop after.
Rollback: reverse step 5–6 with the still-running old primary (it remains authoritative until step 5).

## What the owner must supply to close this

1. Probe receipts from at least two Bangladeshi networks, two times of day (runbook above).
2. The signed p95 budget (accept or amend the 600 ms proposal).
3. If option B: Neon plan/region confirmation (OA-12) and approval for the config changes.
