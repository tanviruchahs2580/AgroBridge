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
`503 OVERLOADED` + `Retry-After` rather than accepting more work. **Understand what it buys and
what it costs before changing it, because it does not manufacture capacity — it only shapes how
the capacity an instance has is spent.** Measured on the audited box (4 physical cores, ~200 req/s
sustainable for a mixed authenticated read load) under an unbounded 1 000-user burst of that mix,
all four settings in one session:

| Setting | 2xx served (useful) | useful req/s | p50 | Over 30 s | `503` shed |
|---|---|---|---|---|---|
| guard off | 14 995 | 187/s | 863 ms | 9.7 % | 0 |
| ceiling 256 | 12 068 | 151/s | 892 ms | 11.7 % | 0 |
| ceiling 128 (default) | 15 834 | **198/s** | **816 ms** | **8.1 %** | 1 094 |
| ceiling 24 *(measured in a separate run the day before)* | 3 803 | 47/s | **385 ms** | 6.1 % | 21 807 |

Three facts to hold together:

- **The guard is not capacity.** The off / 256 / 128 rows sit inside this box's run-to-run noise
  for useful throughput; none of them made the instance capable of more work. Only scaling does.
- **A low ceiling trades useful throughput for latency.** At ceiling 24 admitted requests held a
  385 ms p50 while useful work fell to 47/s — a quarter of what the instance demonstrably did with
  the guard off. Shed fast, but you are refusing work the machine could have done.
- **A ceiling above what the instance sustains protects nothing.** Past saturation, arriving
  requests wait in the socket accept backlog where no middleware runs — neither admitted nor
  refused — so callers still hang for tens of seconds and the `503` never gets emitted.

So the ceiling is a policy dial with an arithmetic range: **ceiling roughly = sustainable req/s ×
the worst wait an admitted request may see.** On the audited box (≈200 req/s, sub-second admitted
latency) 128 sits at that crossover and measured best on every axis in the comparison above; a
deployment that values serving overflow over admitting-quickly should raise it, and one that
values never holding a caller should lower it, knowing the useful-throughput price. For a
*sustained* overload — where every request is genuinely work that must happen — no in-process
ceiling helps at all; only more instances do.

No in-process guard can refuse a request it never gets to run: for a true flood, keep
connection-level limiting at the edge too (`SERVER_MAX_CONNECTIONS` is that knob inside this
process). Watch the `503` rate in `agrobridge_http_requests_total` after a change — a guard that
trips constantly is misconfigured, not protective. `MAX_CONCURRENT_REQUESTS=0` disables it (the
pre-audit behaviour: unbounded queueing).

## Incident quick reference
- **Requests waiting 30 s+, p95 in the tens of seconds** → the instance is saturated. Check whether
  `503 OVERLOADED` is being returned; if it is not, `MAX_CONCURRENT_REQUESTS` is unset or too high.
- **`503 DB_POOL_EXHAUSTED`** → pool starvation: raise `DATABASE_CONNECTION_LIMIT`, reduce the
  instance count, or find the query holding connections (`docs/database.md`).
- **API up but /ready failing** → database connectivity/credentials; see troubleshooting doc.
- **Spike of 401s after deploy** → JWT secret rotation invalidates old tokens (expected; users re-login).
- **AI provider outage** → gateway automatically falls back to the offline grounded engine.
