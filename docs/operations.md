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
| Dependency audit | on CI + monthly manual review | `npm audit --audit-level=high` |
| Migration review | before each release | `prisma migrate diff` reviewed in PR |
| Log/PII spot check | quarterly | confirm redaction still effective |

## Scaling path
1. Vertical first (API is stateless — scale horizontally behind a load balancer).
2. Move rate-limit store to Redis when running >1 replica (express-rate-limit store swap).
3. PostgreSQL with connection pooling (pgBouncer) once concurrency grows.
4. Extract heavy domains (AI gateway, notifications fan-out) behind queues when volume justifies.

## Incident quick reference
- **API up but /ready failing** → database connectivity/credentials; see troubleshooting doc.
- **Spike of 401s after deploy** → JWT secret rotation invalidates old tokens (expected; users re-login).
- **AI provider outage** → gateway automatically falls back to the offline grounded engine.
