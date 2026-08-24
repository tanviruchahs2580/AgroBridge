# Operations

## Health & readiness
- `GET /health` — liveness (no DB). Use for restart probes.
- `GET /ready` — checks DB round-trip; returns 503 when the database is unreachable.
  Docker HEALTHCHECKs are wired for both API and web containers.

## Logging
Structured JSON via pino (`service`, `requestId`, level, time). Authorization headers, passwords and
tokens are redacted. Ship stdout to your log platform (e.g., Loki/CloudWatch).

## Metrics to watch (via platform or logs)
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
