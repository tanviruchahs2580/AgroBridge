# Operations

## Health & readiness
- `GET /health` — liveness (no DB). Use for restart probes.
- `GET /ready` — checks DB round-trip; returns 503 when the database is unreachable.
  Docker HEALTHCHECKs are wired for both API and web containers.

## Logging
Structured JSON via pino (`service`, `requestId`, level, time). Authorization headers, passwords and
tokens are redacted. Ship stdout to your log platform (e.g., Loki/CloudWatch).

## Metrics

Prometheus-compatible endpoint: `GET /metrics` (no auth, scraped by monitoring).

Exposed:

- `agrobridge_http_requests_total{method,route,status}` — Counter
- `agrobridge_http_request_duration_seconds_bucket{method,route,status}` + sum/count — Histogram (5ms–5s)
- `agrobridge_db_up` — Gauge (1 up, 0 down) set by `/ready`
- `agrobridge_ai_requests_total{provider,status}` — Counter
- `agrobridge_payment_intents_total{purpose_type,status}` — Counter
- Default process: `agrobridge_process_cpu_seconds_total`, `agrobridge_nodejs_heap_*`, etc.

Scrape example (Prometheus `prometheus.yml`):

```yaml
scrape_configs:
  - job_name: agrobridge-api
    metrics_path: /metrics
    static_configs:
      - targets: ["api:4000"]
```

## Alert rules (Prometheus)

```yaml
groups:
  - name: agrobridge
    rules:
      - alert: AgroBridgeHigh5xx
        expr: sum(rate(agrobridge_http_requests_total{status=~"5.."}[5m])) / sum(rate(agrobridge_http_requests_total[5m])) > 0.05
        for: 5m
        labels: { severity: critical }
      - alert: AgroBridgeHighLatency
        expr: histogram_quantile(0.95, sum(rate(agrobridge_http_request_duration_seconds_bucket[5m])) by (le)) > 0.5
        for: 10m
        labels: { severity: warning }
      - alert: AgroBridgeDbDown
        expr: agrobridge_db_up == 0
        for: 2m
        labels: { severity: critical }
      - alert: AgroBridgePaymentFailures
        expr: increase(agrobridge_payment_intents_total{status="failed"}[10m]) > 5
        for: 5m
        labels: { severity: critical }
      - alert: AgroBridgeAiProviderErrors
        expr: increase(agrobridge_ai_requests_total{status="fallback_success"}[10m]) > 20
        labels: { severity: warning }
```

## On-call & escalation (template)

| Role | Contact | Escalation |
|---|---|---|
| Primary on-call | platform@agrobridge.demo | page after 5m alert |
| Secondary | admin@agrobridge.demo | after 15m |
| Incident commander | super@agrobridge.demo | after 30m |

Runbook: triage → mitigate (rollback `git checkout <prev-tag> && docker compose up`) → post-mortem template in `docs/troubleshooting.md`.

## Metrics to watch (legacy / via logs)
- Request rate / 429 rate-limited counts per IP
- 5xx rate (error handler logs every unhandled failure with requestId)
- AI usage: `/admin/ai-usage` (provider, call count, avg latency)
- Business KPIs mirrored in `/admin/metrics`

## Routine tasks
| Task | Frequency | How |
|---|---|---|
| DB backup verification | weekly | restore latest snapshot into scratch instance |
| Dependency audit | on CI (production deps fail on moderate+, full tree reports warnings) + monthly manual review | `npm audit --omit=dev --audit-level=moderate` |
| Migration review | before each release | `prisma migrate diff` reviewed in PR |
| Log/PII spot check | quarterly | confirm redaction still effective |

## Scaling path
1. Scale horizontally behind a load balancer (the API is stateless). Size from measurement before
   promising capacity: the 10k-concurrency audit saw a single instance collapse well below
   10 000 concurrent sessions (`docs/qa/2026-10-21-load-10k-and-condition-report.md`).
2. Move the rate-limit store to Redis when running >1 replica (express-rate-limit store swap).
   Without it each instance enforces its own window, so the effective quota is *(instances × limit)*
   — visible as `limiterStore: memory` on `/ready`.
3. Size the database pool across the whole fleet, not per instance: `DATABASE_CONNECTION_LIMIT` ×
   instances must stay inside the database's `max_connections` (and Neon's pooler ceiling). Unset,
   Prisma uses `cpus × 2 + 1` per instance, which was 9 connections on the audited box.
4. Give password hashing enough capacity before a launch spike. bcrypt runs in `BCRYPT_POOL_SIZE`
   worker threads (default `min(4, cores - 1)`); login throughput is roughly *pool size ÷ cost-12
   hash time*, so a burst larger than that queues no matter how many instances exist — unless the
   pool or the fleet grows.
5. PostgreSQL with connection pooling (pgBouncer) once concurrency grows — under the Prisma pool,
   not instead of it.
6. Extract heavy domains (AI gateway, notifications fan-out) behind queues when volume justifies.

### Tuning the overload guard
`MAX_CONCURRENT_REQUESTS` (default 128) is the point past which an instance answers
`503 OVERLOADED` + `Retry-After` rather than accepting more work. **Size it from measurement,
and size it low.** Measured on the audited box (~150 req/s sustainable for a mixed authenticated
read load) under an unbounded 1 000-user burst of that mix:

| Setting | Requests handled | p50 | Over 30 s | Shed |
|---|---|---|---|---|
| guard off | 12 203 | 954 ms | 13.1 % | 0 |
| ceiling 256 | 11 438 | 1 142 ms | 14.6 % | 0 |
| ceiling 24 | 27 267 | **385 ms** | **6.1 %** | 21 807 `503`s |

The counter-intuitive result is the important one: **too high a ceiling protects nothing.** Once the
event loop is saturated, arriving requests wait in the socket accept backlog, where no middleware
runs — so they are neither admitted nor refused, and the caller still hangs for tens of seconds.
Only a ceiling near (or below) what the instance actually sustains leaves the event loop enough
headroom to *emit* the refusal, and that is what converts a 50-second hang into an immediate retry.

No in-process guard can refuse a request it never gets to run: for a true flood, keep
connection-level limiting at the edge (load balancer / CDN) as well. Watch the `503` rate in
`agrobridge_http_requests_total` after a change — a guard that trips constantly is misconfigured,
not protective. `MAX_CONCURRENT_REQUESTS=0` disables it (the pre-audit behaviour: unbounded
queueing).

## Incident quick reference
- **Requests waiting 30 s+, p95 in the tens of seconds** → the instance is saturated. Check whether
  `503 OVERLOADED` is being returned; if it is not, `MAX_CONCURRENT_REQUESTS` is unset or too high.
- **`503 DB_POOL_EXHAUSTED`** → pool starvation: raise `DATABASE_CONNECTION_LIMIT`, reduce the
  instance count, or find the query holding connections (`docs/database.md`).
- **API up but /ready failing** → database connectivity/credentials; see troubleshooting doc.
- **Spike of 401s after deploy** → JWT secret rotation invalidates old tokens (expected; users re-login).
- **AI provider outage** → gateway automatically falls back to the offline grounded engine.
