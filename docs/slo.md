# Service level objectives (PROPOSED — owner sign-off required)

These objectives are **proposals for the product owner**, not agreed targets (decision OD-06 left
SLO targets, alert sink and on-call to the owner; the decision register is **not in this
repository** — see `docs/STATUS.md` §Where the evidence lives). Numbers are
chosen to match what the current single-region pilot topology can actually evidence; nothing here
claims a measurement that does not exist. Items that are not measurable with today's
instrumentation are marked **UNVERIFIED** with the reason.

Measurement reality as of 2026-10-19: the API registers Prometheus metrics at
`apps/api/src/infrastructure/metrics.ts` and Prometheus scrapes `api:4000/metrics`
(`monitoring/prometheus.yml`). There is no external prober, no alert sink, and no paging
destination configured in the repository; every alert in `monitoring/alert_rules.yml` carries a
`runbook:` annotation (verified 2026-11-10). An SLO without a probe and a pager is an
intention, which is why every target below is marked proposed.

## SLIs and SLOs

| ID | SLI | Definition | Proposed SLO | Rationale | Backing metric |
|---|---|---|---|---|---|
| SLO-1 | Availability | Share of 1-minute probe windows where `GET /health` answers 200 with `ok:true` | **99.5% monthly** (pilot) | Single Vercel function region (`iad1`, observed) plus Neon free tier with no failover; 99.5% leaves ≈3 h 36 min/month while the product has no on-call rotation and no alert sink. 99.9% would need a second region and a pager owner. | `up` from the `agrobridge-api` scrape job (`monitoring/prometheus.yml`) — this measures scrape success, not a public probe; `agrobridge_db_up` (`apps/api/src/infrastructure/metrics.ts`) covers the DB dependency leg via `/ready` |
| SLO-2 | API latency (reads) | p95 of `GET` API request duration, observed at the edge/function, monthly | **≤ 500 ms p95** | Matches the existing alert threshold (`ApiHighLatencyP95`, > 0.5 for 10 min) so the SLO and the page fire at the same point. Scoped to reads: `POST /auth/login` is bcrypt-bound by design (~1.2 s p50 in the local baseline, `docs/testing.md`). | `agrobridge_http_request_duration_seconds` histogram (buckets 5 ms → 5 s) with `method`/`route`/`status` labels (`apps/api/src/infrastructure/metrics.ts`) |
| SLO-3 | Error rate | 5xx responses / all responses, 5-minute windows during a calendar month | **≤ 1%** | The alert pages at 5%; 1% is the burn threshold that keeps the page meaningful. 404s from scanner traffic are excluded by the ratio definition only if `status=~"5.."` is used, which it is. | `agrobridge_http_requests_total{status=~"5.."}` over `agrobridge_http_requests_total` (`apps/api/src/infrastructure/metrics.ts`) |
| SLO-4 | Weather data freshness | Share of weather responses whose `fetchedAt` is within 15 minutes of `now` | **95% of responses** (proposed) | The provider cache TTL defaults to 600 s (`WEATHER_CACHE_TTL_SECONDS` in `apps/api/src/config/env.ts`, consumed by `apps/api/src/modules/weather/cache.ts`), so a cache hit is at most 10 min old and the target bounds how often a farmer sees older data. The response exposes `fetchedAt`, `observedAt` and `cached` so the age is visible (the provenance envelope in `apps/api/src/modules/weather/routes.ts`). | **None registered.** No weather-age gauge or histogram exists in `apps/api/src/infrastructure/metrics.ts`. Candidate: log-derived (pino) or a new gauge sampled at response time. **UNVERIFIED** until instrumented |
| SLO-5 | Payment confirmation lag | p95 of `Payment.createdAt → confirmed` for payments that reach `SUCCEEDED` | **≤ 5 minutes** (proposed) | SSLCommerz IPNs are near-immediate and the client also polls `GET /payments/:id/status` (`apps/api/src/modules/payments/routes.ts`); 5 minutes absorbs a delayed/retried IPN before a payment is treated as stuck. | **No duration metric registered.** `agrobridge_payment_intents_total{purpose_type,status}` (`apps/api/src/infrastructure/metrics.ts`) counts created/confirmed/webhook_confirmed, so it can give a confirmation ratio, not a lag. **UNVERIFIED** — needs a histogram or a derivation from `Payment.createdAt` and audit rows |

## Error-budget policy

Monthly error budget = 1 − SLO (e.g. SLO-1 gives ≈3 h 36 min; SLO-3 gives 1% of requests).

1. **0–50% consumed:** normal delivery. Track in the weekly ops read.
2. **50–100% consumed:** reliability work is prioritised ahead of new features for the affected
   surface; deploys to that surface need a rollback plan stated in the PR.
3. **Exhausted:** feature deploys to the affected surface freeze (hotfixes and reliability changes
   still ship); the owner is informed with the breach window and the contributing alert history;
   the freeze lifts when a full calendar week passes inside budget or the owner records an
   exception. Every exception is written down, never implied.
4. **Missed two consecutive months:** the SLO itself is renegotiated (raise the target with
   evidence or lower it with the owner's agreement) rather than silently reported as met.

Pilot caveat: with no alert sink, "informed" today means a human reading `/metrics` or the
Prometheus UI. Until OD-06 is answered, breaches can go unnoticed.

## Alert → SLO mapping

Every alert in `monitoring/alert_rules.yml` maps to at least one SLO. The file's own comments
describe its origin; the mapping below is the contract for why each rule exists.

| Alert (`monitoring/alert_rules.yml`) | Severity | Maps to | Threshold vs SLO | Runbook it needs | `runbook:` link present? |
|---|---|---|---|---|---|
| `High5xxRate` | critical | SLO-3 | Pages at 5%/5 min, five times the 1% objective — a burn-rate page | `docs/operations.md` | Yes (`runbook:`) |
| `ApiHighLatencyP95` | warning | SLO-2 | Fires at > 0.5 s p95/10 min, i.e. exactly at the objective | `docs/runbooks/provider-outage.md` (its Triggers list names this alert; Step 0 localises the layer). A dedicated latency runbook does not exist | Yes (`runbook:` → `provider-outage.md`) |
| `DbDown` | critical | SLO-1 (DB leg) | `agrobridge_db_up == 0` for 2 min is total unavailability of a dependency | `docs/runbooks/chaos-drills.md` (Drill 1 restores a killed PostgreSQL) and `docs/disaster-recovery.md` | Yes (`runbook:`) |
| `PaymentFailures` | critical | SLO-5 | > 5 failed intents/10 min is a leading indicator of confirmation-lag breaches and stuck money | `docs/runbooks/failed-transaction-recovery.md` (its Triggers list names this alert) and `docs/runbooks/provider-outage.md` | Yes (`runbook:`) |
| `AiFallbackSpike` | warning | SLO-3 (advisory surface) | > 10 fallback answers/15 min means the hosted provider is failing; the 5xx ratio can stay green while the feature degrades | `docs/runbooks/provider-outage.md` (AI section) | Yes (`runbook:` → `provider-outage.md`) |
| `InstanceDown` | critical | SLO-1 | `up == 0` is scrape-level unavailability, the primary availability signal | `docs/runbooks/live-deployment.md` (redeploy path) then `docs/runbooks/chaos-drills.md` | Yes (`runbook:`) |

All six alerts carry a `runbook:` annotation (verified 2026-11-10: `grep -n "runbook:"
monitoring/alert_rules.yml` → six matches). The table above is the SLO-mapping contract; the
annotation is the operational link.

## Gaps that block measurement (all UNVERIFIED)

1. **No external availability probe.** Availability is inferred from Prometheus scrape success of
   the internal target; the public `https://…/health` endpoint is not probed from outside
   (the local audit working tree recorded read-only live probes, not a schedule; it is **not in
   this repository** — see `docs/STATUS.md` §Where the evidence lives).
2. **No BD-vantage latency measurement.** SLO-2's "from Bangladesh" vantage is not measured
   anywhere in the repository; the API function executes in `iad1` (observed `X-Vercel-Id:
   bom1::iad1::…`; the 2026-10-19 probe file is **not in this repository**, and the 2026-11-10
   full-qa audit re-observed the same region — `docs/audit/2026-11-10-full-qa-audit.md` §2.4). Treat the 500 ms objective as a
   hypothesis to confirm with a probe from Dhaka.
3. **No weather-freshness metric** (SLO-4) and **no payment-lag histogram** (SLO-5), as noted in
   the table.
4. **No alert sink or on-call destination** (OD-06), so no objective can be paged on today.
5. **No load/capacity baseline from production.** `docs/performance.md` and the local audit
   working tree record local measurements only; no production capacity number is claimed here.
