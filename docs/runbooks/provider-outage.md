# Runbook — Provider Outage (weather / AI / payment / SMS / storage / Redis)

The API is built around provider adapters (`apps/api/src/providers/*`, ADR-0005): every external
dependency is selected by env and can degrade or fail without taking the rest of the product down.
This runbook says what each outage looks like, how to confirm it, and what to do — the honest
option first, the knob second.

## Triggers

- Prometheus alert from `monitoring/alert_rules.yml`: `High5xxRate` (5xx > 5%/5m),
  `ApiHighLatencyP95` (> 500 ms p95/10m), `DbDown`, `PaymentFailures` (> 5 failed intents/10m).
- User report: weather card empty, AI answers "offline", OTP never arrives, payment stuck.
- Provider status page / vendor email.

## Step 0 — Localise before touching knobs (5 minutes)

```bash
# 1. Which layer? Liveness vs readiness vs a single provider.
curl -s https://agro-bridge-api-vantiq-systems.vercel.app/health   # ok:true + commit
curl -s https://agro-bridge-api-vantiq-systems.vercel.app/ready    # db:true + schema{} + limiterStore
docker compose -f docker-compose.prod.yml logs --since 30m api | grep -E "requestId|error"

# 2. Which provider? The failing call is named in the error envelope's requestId line.
docker compose -f docker-compose.prod.yml logs --since 30m api | grep -F "<requestId from user report>"
```

`/ready` is the readiness signal: `db:true` means the database answered `SELECT 1`; the
`schema` block reports the applied migration chain (ADR-0007); `limiterStore` reports whether
rate limiting is on Redis or per-instance memory. A 503 from `/ready` is a **DB incident**, not
a provider incident — go to the DB section below.

## Weather provider (`WEATHER_PROVIDER=openweather`, `OPENWEATHER_API_KEY`)

- Normal degradation: `WEATHER_PROVIDER=mock` serves fixture weather. The adapter
  (`apps/api/src/providers/weather/openweather.ts`) throws on non-2xx; the route surfaces the
  error envelope, it does not invent data.
- Confirm: `curl -s -H "Authorization: Bearer <token>" "…/api/v1/weather?lat=23.8&lng=90.4"`.
- Mitigation, in order: (1) retry — upstream may be transient; (2) if the outage is sustained,
  set `WEATHER_PROVIDER=mock` and redeploy **only** if the deployment already accepts
  placeholders (`ALLOW_PLACEHOLDER_PROVIDERS=1`) — production refuses to boot with placeholder
  providers otherwise; (3) put a user-facing note up if the mock data could mislead spraying
  decisions. Record the switch in `CHANGELOG.md` (the historical `EXECUTION_LOG.md` is archived under `docs/archive/2026-10-19/`); switch back when the vendor recovers.

## AI provider (`AI_PROVIDER=openai-compatible`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`)

- Degradation is designed-in: when the LLM call fails, the grounded offline KB engine answers
  (`apps/api/src/providers/ai/gateway.ts`), with `provider` in the response naming what actually
  served. Users still get an answer; it just is not LLM-generated.
- Monthly spend guard: once `AI_MONTHLY_BUDGET_PAISA` is exhausted the API returns
  `AI_BUDGET_EXCEEDED` and the offline engine serves — expected, not an incident. If it fires
  early, check `GET /api/v1/admin/ai-usage`.
- Confirm: `curl -s -X POST …/api/v1/ai/advisory -d '{"question":"…","lang":"bn"}'` and read
  `provider` / `model` in the response.
- Do **not** fabricate an answer path in a hurry: the offline engine already is the honest
  degradation. If OpenAI is down for a long window, no action is required beyond awareness.

## Payment gateway (`PAYMENT_PROVIDER=sslcommerz`, `SSLCOMMERZ_*`)

- Webhooks are the primary settlement path (`POST /api/v1/payments/webhook/sslcommerz`,
  signature-verified). The hosted-checkout return (`POST /api/v1/payments/gateway/return/:outcome`)
  is a UX path that asks the gateway whether money actually moved; it never trusts the request.
- During a gateway outage: intents may be created but not completed. Reconciliation is
  `GET /api/v1/payments/:id/status` (per-payment) — the endpoint re-verifies a PENDING payment
  with the provider and settles it if paid. Run it per affected order; see
  failed-transaction-recovery.md if anything stays inconsistent.
- Falling back to `PAYMENT_PROVIDER=sandbox` in production is **refused unless**
  `ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION=1` — that flag lets buyers complete simulated payments.
  Treat it as a demo-only lever (pilots), never as an outage mitigation: reporting an unpaid
  order as paid is deceptive.

## SMS provider (`SMS_PROVIDER=sandbox|none`)

- `sandbox` logs OTP codes instead of sending (`apps/api/src/providers/notification/service.ts`);
  `none` delivers nothing. `apps/api/src/providers/health.ts` reports SMS as `DOWN` in
  production for both — a conscious placeholder, not a live channel. The OTP response echoes
  `devCode` outside production only.
- If OTP delivery is business-critical, configure a real provider before promising phone
  verification to users. Support must never read an OTP out of logs to a caller who cannot
  prove account ownership.

## Storage (`STORAGE_PROVIDER=s3|local`, `S3_*`, `UPLOAD_BASE_DIR`)

- `local` writes to `UPLOAD_BASE_DIR` (compose mounts the `uploads` volume at
  `/app/apps/api/uploads`) — a redeploy that loses the volume loses photos. `s3` failures
  surface as upload errors; disease intake returns a controlled error, never a half-written case.
- Confirm an upload path with one real photo through the app, not a synthetic GET.

## Database (Neon / compose `db`) — `DbDown`

```bash
curl -s https://agro-bridge-api-vantiq-systems.vercel.app/ready   # 503 {"db":false} while down
docker compose -f docker-compose.prod.yml ps                      # compose stack: db healthy?
```

- Compose: `docker compose -f docker-compose.prod.yml up -d db` (healthcheck `pg_isready` gates
  the API container). The chaos-drills runbook has the full kill/recovery drill.
- Neon: check the Neon console status; the free tier has suspended databases before
  (archived: `docs/archive/2026-10-19/ENTERPRISE_CERTIFICATION_STATUS.md`, 2026-10-15 incident). If it is a suspension, restore the
  project in the console — no API change is needed; instances reconnect.
- If schema state is suspect after recovery, verify `/ready`'s `schema.latest` against the newest
  directory in `apps/api/prisma/postgres/migrations` (ADR-0007) and apply with
  `apps/api/scripts/deploy-migrations.mjs` (idempotent, baseline-aware).

## Redis (`REDIS_URL`) — documented fail-open

Redis backs shared rate-limit windows only; **it is not a job queue** (ADR-0010). On Redis
failure `apps/api/src/infrastructure/rateLimitRedis.ts` fails open (requests allowed) and
`/ready` reports `limiterStore`. Fail-open is accepted (docs/security.md): availability beats
strict limiting here, and the blast radius is a temporarily higher per-instance quota.

## Verification (after any mitigation)

- [ ] `/health` ok, `/ready` `db:true`, `schema.latest` unchanged
- [ ] The originally failing user journey retried end-to-end in the app
- [ ] No new 5xx in `docker compose logs`/Vercel logs for 10 minutes
- [ ] The knob you changed is recorded (who/when/why) and has a revert plan
- [ ] Monitoring alert resolves (the alert, not just the metric)

## Rollback

Every mitigation above is an env change: revert the value and redeploy (JWT-class restarts are
not involved). Nothing in this runbook mutates data; if data looks wrong, stop and go to
failed-transaction-recovery.md — do not "fix" rows by hand.

## Owner

On-call engineer (currently repo owner `@tanviruchahs2580`), with the provider-console holder
for vendor-side actions. Escalation path and incident template: `docs/operations.md`.

## Evidence record

| Date | Provider | Symptom | Detected by | Action | Reverted | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |
