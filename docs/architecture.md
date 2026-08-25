# Architecture

## System overview

```
Farmer / Admin / B2B (React SPA, bn/en)
        │  HTTPS, JWT bearer
        ▼
AgroBridge API  (Express + TypeScript, modular monolith)
 ├── middleware: request-id → helmet → cors → rate-limit → auth(JWT+status) → RBAC → zod validation → metrics
 ├── domains:
 │    identity · farms · weather · ai-agent · disease · marketplace
 │    services/bookings · procurement · payments/wallet · membership
 │    notifications · admin · audit · organizations (multi-tenant)
 ├── providers (swappable adapters):
 │    WeatherProvider      mock | openweather
 │    AIProvider           offline-agro-engine | openai-compatible (+fallback)
 │    PaymentProvider      sandbox | sslcommerz (live, signature-verified webhook)
 │    NotificationProvider in-app DB (+ SMS slot)
 │    StorageProvider      local FS | s3 (STORAGE_PROVIDER)
 ├── observability: /health, /ready, /metrics (prom-client), pino logs, requestId
 └── Prisma ORM
        ▼
SQLite (dev/test) ⇄ PostgreSQL (production target)
```

## Design decisions

1. **Modular monolith** with strict domain folders (`src/modules/*`). High-load domains can be
   extracted later without touching call sites because cross-domain access goes through the API layer.
2. **Provider abstraction everywhere** (weather/AI/payment/notification). Business logic never
   imports a concrete vendor SDK.
3. **Money as integers** (`*_Paisa`) to avoid float errors. Quantities are floats only for physical
   measures (kg, bigha).
4. **Transactional consistency** where it matters: checkout decrements stock and creates the order in
   a single Prisma transaction; procurement payout updates payment + wallet + ledger + PO atomically.
5. **Server-side authorization**: role→permission map in `middleware/rbac.ts`; resource ownership is
   enforced per-query (farmers' queries are always scoped to their own rows). **Multi-tenancy:** `Organization` + `OrganizationMember` join; farms carry `organizationId`; CORPORATE/COOPERATIVE see `OR(ownerId, organizationId in members)`; cross-tenant leakage proven absent by security-matrix tenant test.
6. **AI safety**: input sanitization, grounded retrieval, confidence thresholds with mandatory expert-
   verification notes, no direct action execution by the AI (orders/payments require explicit user flows).
7. **No fake production data**: demo/mock providers are selected explicitly via env; sandbox payment
   responses are labelled `providerMode: "sandbox"`; `sslcommerz` adapter implements signature verification and is only instantiated when creds present.
8. **Observability:** Prometheus `/metrics` (`agrobridge_http_requests_total`, `http_request_duration_seconds`, `db_up`, `ai_requests_total`, `payment_intents_total` + default process metrics) scraped by monitoring; alert rules in `docs/operations.md`.
9. **Storage abstraction:** `StorageProvider` interface + `LocalStorageProvider`; disease images via `getStorageProvider()` — prod can switch to S3 without code change (see `STORAGE_PROVIDER`).
