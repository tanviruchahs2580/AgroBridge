# Architecture

> **Owner:** engineering · **Purpose:** as-built system design and the ADR index · **Last verified:** 2026-10-19 (branch `audit/v2-remediation`; re-verify with the claims/link checks in CI).


See also: [threat-model.md](threat-model.md) · [slo.md](slo.md) · [runtime-contract.md](runtime-contract.md)
· [business-rules.md](business-rules.md) · [STATUS.md](STATUS.md).

## System overview

```
Farmer / Buyer / Admin / B2B partner
   ├── React SPA (bn/en, Vite)        apps/web         — static bundle on the Vercel edge
   └── Android app via Capacitor      apps/web/android — the same bundle in a WebView shell
        │  HTTPS, JWT bearer (access 15 min, rotating refresh 7 d)
        ▼
AgroBridge API  (Express + TypeScript, modular monolith, apps/api)
 ├── request pipeline (app.ts): helmet → cors → json 1 MB / urlencoded 200 kB
 │        → requestContext (X-Request-Id) → metricsMiddleware → rate limit /api/*
 │        → routers (per-router requireAuth → requirePermission → validate)
 ├── modules: auth · farms · weather · aiagent · disease · marketplace · services
 │        · procurement · payments · notifications · admin · organizations · analytics
 │        (membership is a service; membershipRouter is exported by payments/routes.ts)
 ├── providers (swappable adapters):
 │    WeatherProvider      mock | openweather
 │    AIProvider           offline-agro-engine | openai-compatible (offline fallback outside production)
 │    PaymentProvider      sandbox | sslcommerz (signature-verified webhook only)
 │    NotificationProvider in-app DB (+ SMS slot)
 │    StorageProvider      local | s3 | db (STORAGE_PROVIDER)
 ├── observability: /health, /ready, /metrics (prom-client), pino logs, requestId
 └── Prisma ORM
        ▼
SQLite (dev/test) · PostgreSQL (production, Neon — see docs/runbooks/live-deployment.md)
```

The pipeline order above is `apps/api/src/app.ts:57-87,133-151`; it is the corrected form of the
previously documented order (`request-id → helmet → cors → rate-limit → auth → RBAC → validation
→ metrics`), which did not match the code: the body parsers run before `requestContext`, both run
before `metricsMiddleware`, the rate limiter is mounted only on `/api/*`, and auth/RBAC/validation
are per-route middleware inside each module router rather than a global chain.

## C4 level 1 — System context

```mermaid
flowchart TB
  farmer["Farmer"]
  buyer["Buyer / Dealer / B2B partner"]
  admin["Admin and operations staff"]
  web["AgroBridge web SPA<br/>React + Vite, bn/en"]
  android["AgroBridge Android app<br/>Capacitor shell over the same bundle"]
  api["AgroBridge API<br/>Express modular monolith"]
  pg[("PostgreSQL<br/>Neon, via Prisma")]
  weather["OpenWeather API"]
  ai["OpenAI-compatible provider"]
  pay["SSLCommerz gateway"]
  sms["SMS provider"]
  store["S3-compatible object storage"]
  farmer --> web
  farmer --> android
  buyer --> web
  admin --> web
  web -->|"HTTPS + JWT bearer"| api
  android -->|"HTTPS + JWT bearer"| api
  api --> pg
  api -->|"weather, AI, payment, SMS, uploads"| weather
  api --> ai
  api --> pay
  api --> sms
  api --> store
  pay -.->|"IPN webhook, signature-verified"| api
```

Source of truth: `apps/api/src/app.ts` (mounts, pipeline), `apps/web/src/lib/api.ts` (client base
URL), `apps/api/src/providers/*/index.ts` (provider selection).

## C4 level 2 — Containers

```mermaid
flowchart TB
  subgraph edge["Vercel edge — observed web edge region bom1"]
    spa["Static SPA bundle<br/>apps/web/dist, CSP by hash, no service worker"]
  end
  subgraph fn["Vercel Functions — observed API execution region iad1"]
    pipe["Request pipeline<br/>helmet → cors → body parsers<br/>→ requestContext → metrics → rate limit"]
    api["Express app<br/>apps/api/src/app.ts"]
  end
  limiter[("Rate-limit store<br/>Redis when REDIS_URL is set,<br/>otherwise per-instance memory")]
  pg[("PostgreSQL — Neon pooler<br/>Prisma client")]
  providers["Provider adapters<br/>weather · AI · payment · SMS · storage"]
  prom["Prometheus scrape of /metrics<br/>prom-client registry"]

  spa -->|"fetch /api/v1/*"| pipe
  pipe --> api
  api --> limiter
  api --> pg
  api --> providers
  prom -->|"GET /metrics, token-guarded"| api
```

Region evidence: live `X-Vercel-Id: bom1::iad1::…` (`.audit/evidence/E-V2-live-probes.txt:40`);
platform limits and the absence of `maxDuration`/`regions` config are documented in
[runtime-contract.md](runtime-contract.md).

## C4 level 3 — API components (sketch)

```mermaid
flowchart LR
  subgraph pipeline["app.ts request pipeline"]
    helmet["helmet"] --> cors["cors"] --> body["body parsers"] --> ctx["requestContext"] --> metrics["metricsMiddleware"] --> rl["global limiter /api/*"]
  end
  rl --> auth["auth — login, refresh rotation, OTP, deletion, export"]
  rl --> farms["farms — farms, plots, crop cycles, events"]
  rl --> weather["weather — advisories over provider cache"]
  rl --> aiagent["aiagent — advisory, history, feedback"]
  rl --> disease["disease — upload intake, review workflow"]
  rl --> marketplace["marketplace — products, cart, orders"]
  rl --> services["services — service catalog, bookings"]
  rl --> procurement["procurement — offers, QC state machine"]
  rl --> payments["payments — intent, confirm, refund, webhook, wallet"]
  rl --> notifications["notifications"]
  rl --> admin["admin — metrics, users, audit logs, withdrawals"]
  rl --> organizations["organizations — multi-tenant membership"]
  rl --> analytics["analytics — first-party events"]
  payments --> walletrouter["wallet and membership routers<br/>exported from payments/routes.ts"]
```

Module directories: `apps/api/src/modules/*` (admin, aiagent, analytics, auth, disease, farms,
marketplace, membership, notifications, organizations, payments, procurement, services, weather).
`membership` contains only `service.ts`; the membership router is exported from
`apps/api/src/modules/payments/routes.ts`.

## Sequence diagrams

Each diagram's source of truth is the file named in its caption; runbook-level operational steps
live in `docs/runbooks/`.

### Login and refresh-token rotation

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant A as authRouter
  participant DB as PostgreSQL via Prisma
  C->>A: POST /api/v1/auth/login
  A->>A: normalizeBdPhone, zod validate, loginLimiter
  A->>DB: findUnique User by phone
  A->>A: bcrypt compare, dummy hash when user is absent
  A->>DB: insert RefreshToken sha256(raw), expiry REFRESH_TOKEN_TTL_DAYS
  A-->>C: accessToken, refreshToken, user
  C->>A: POST /api/v1/auth/refresh
  A->>DB: findUnique RefreshToken by tokenHash
  A->>DB: updateMany revoke WHERE id AND revokedAt IS NULL
  alt claim lost, token replayed
    A->>DB: revoke every remaining token of the user
    A-->>C: 401 refresh token invalid or expired
  else claim won
    A->>DB: insert a new RefreshToken
    A-->>C: new accessToken, new refreshToken
  end
```

Source of truth: `apps/api/src/modules/auth/routes.ts:168-224` (login at 168, rotation claim at
206-218, reuse detection at 211-216).

### Checkout and idempotency

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant O as ordersRouter
  participant DB as PostgreSQL via Prisma
  C->>O: POST /api/v1/orders/checkout with optional clientRequestId
  O->>O: checkoutLimiter 40 per 15 min, zod validate
  O->>DB: findFirst Order by userId and clientRequestId
  alt key already used
    DB-->>O: existing order
    O-->>C: 200 the SAME order, no side effects
  else new key or no key
    O->>DB: BEGIN
    O->>DB: read cart with items and product stock
    O->>DB: cartItem deleteMany as the duplicate-submit claim
    O->>DB: product updateMany decrement WHERE stockQty gte qty
    O->>O: totals — subtotal, membership discount, delivery fee
    O->>DB: create Order with item snapshots
    O->>DB: COMMIT
    O-->>C: 201 order
  end
  Note over O,DB: a lost race replays the winner by key with 200
```

Source of truth: `apps/api/src/modules/marketplace/routes.ts:341-482` (replay lookup at 341-343,
checkout handler at 356, cart claim at 392-395, stock decrement at 400-408, totals at 411-413,
lost-race replay at 470-478).

### Payment confirm and gateway webhook

```mermaid
sequenceDiagram
  autonumber
  participant G as SSLCommerz
  participant W as payments webhook router
  participant DB as PostgreSQL via Prisma
  participant N as Notification service
  G->>W: POST /api/v1/payments/webhook/sslcommerz
  W->>W: recompute MD5 verify_sign, timing-safe compare
  alt signature mismatch
    W-->>G: 401 INVALID_SIGNATURE
  else signature valid
    W->>DB: findFirst Payment by refNo
    alt already SUCCEEDED or REFUNDED
      W-->>G: 200 processed false, reason already_final
    else PENDING
      W->>W: verify amount in BDT paisa and currency
      W->>DB: BEGIN claim updateMany PENDING to SUCCEEDED
      W->>DB: applyPaymentSideEffects for ORDER, BOOKING or MEMBERSHIP
      W->>DB: COMMIT
      W->>N: payment confirmed notification
      W-->>G: 200 processed true
    end
  end
```

Source of truth: `apps/api/src/modules/payments/webhook.ts:26-110` (signature at 36-43, amount
check at 60-72, claim at 85-92). The sandbox confirm path (`POST /payments/:id/confirm`) funnels
through the same `claimAndApplyPayment` claim in `apps/api/src/modules/payments/routes.ts:217-251`.

### Procurement payout

```mermaid
sequenceDiagram
  autonumber
  participant M as Procurement manager
  participant P as paymentsRouter
  participant DB as PostgreSQL via Prisma
  participant N as Notification service
  M->>P: POST /api/v1/payments/payouts with poId
  P->>P: requirePermission procurement:pay, zod validate
  P->>DB: load ProcurementOrder plus owner phoneVerified
  P->>P: assertSubjectInRegion, status must be COLLECTED
  P->>DB: BEGIN
  P->>DB: updateMany status COLLECTED to PAID as the atomic claim
  P->>DB: create Payment purposeType PROCUREMENT, method WALLET_CREDIT
  P->>DB: wallet upsert increment balancePaisa
  P->>DB: insert WalletTransaction CREDIT with balanceAfterPaisa
  P->>DB: COMMIT
  P->>N: crop payment credited notification
  P-->>M: 201 payment and new wallet balance
```

Source of truth: `apps/api/src/modules/payments/routes.ts:461-539` (atomic claim at 484-490,
wallet credit and ledger at 504-519).

### Offline sync replay

```mermaid
sequenceDiagram
  autonumber
  participant U as User on a flaky connection
  participant Q as offlineQueue.ts
  participant LS as localStorage
  participant API as AgroBridge API
  U->>Q: state-changing request while offline
  Q->>Q: isQueueable — POST, PATCH, DELETE on events, cart, orders
  Q->>Q: never queue /orders/checkout
  Q->>LS: persist entry with clientUuid and payload hash
  Note over Q,LS: dedupe by clientUuid, then by payload hash
  U->>Q: online event or app boot
  Q->>Q: flushAll, replayed in order
  loop every queued entry
    Q->>API: replay the original method and URL
    alt success
      Q->>LS: remove the entry
    else 401 or 403 first strike
      Q->>LS: keep the entry for one more flush
    else 409 or 422
      Q->>LS: drop the entry, notify a conflict for review
    else other 4xx
      Q->>LS: drop the entry, notify the loss
    else network error or 5xx
      Q->>LS: keep the entry for the next flush
    end
  end
```

Source of truth: `apps/web/src/lib/offlineQueue.ts:199-243` (allow-list at 25-43, enqueue dedupe
at 154-180, flush semantics at 199-235).

### AI advisory

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant R as aiagent route
  participant G as providers/ai/gateway.ts
  participant PR as AI provider
  participant DB as PostgreSQL via Prisma
  C->>R: POST /api/v1/ai/advisory question, lang, optional cropName
  R->>R: requireAuth, aiLimiter 30 per hour, zod validate
  R->>DB: load farmer, membership tier, latest farm and active crop context
  R->>G: askAgroAgent question with context
  G->>G: resolveProvider from AI_PROVIDER and OPENAI_API_KEY
  G->>DB: monthly spend sum when the hosted provider is selected
  alt provider call succeeds
    PR-->>G: answer with confidence, groundedRefs, provider, model
    G->>DB: AiUsageLog row and AdvisoryQuery row
    G-->>R: answer
  else provider fails outside production
    G->>PR: OfflineAgroEngine fallback
    G->>DB: usage row with the offline provider
    G-->>R: answer
  else provider fails in production
    G->>G: mark provider DOWN, surface 502 AI_PROVIDER_UNAVAILABLE
    G-->>C: error envelope
  end
  R-->>C: ok answer with kbVersion and promptVersion
```

Source of truth: `apps/api/src/modules/aiagent/routes.ts:33-80` and
`apps/api/src/providers/ai/gateway.ts:38-90` (budget guard at 25-31, fallback only outside
production at 70-88).

## Design decisions

1. **Modular monolith** with strict domain folders (`src/modules/*`). High-load domains can be
   extracted later without touching call sites because cross-domain access goes through the API layer.
2. **Provider abstraction everywhere** (weather/AI/payment/notification/storage). Business logic never
   imports a concrete vendor SDK: adapters use `fetch` directly
   (`apps/api/src/providers/ai/openai-compat.ts:163`, `apps/api/src/providers/weather/openweather.ts:13`).
3. **Money as integers** (`*_Paisa`) to avoid float errors. Quantities are floats only for physical
   measures (kg, bigha).
4. **Transactional consistency** where it matters: checkout decrements stock and creates the order in
   a single Prisma transaction; procurement payout updates payment + wallet + ledger + PO atomically.
5. **Server-side authorization**: role→permission map in `middleware/rbac.ts`; resource ownership is
   enforced per-query (farmers' queries are always scoped to their own rows). **Multi-tenancy:** `Organization` + `OrganizationMember` join; farms carry `organizationId`; CORPORATE/COOPERATIVE see `OR(ownerId, organizationId in members)`; cross-tenant leakage proven absent by `apps/api/tests/tenant-isolation.test.ts`.
6. **AI safety**: input sanitization, grounded retrieval, confidence thresholds with mandatory expert-
   verification notes, no direct action execution by the AI (orders/payments require explicit user flows).
   The offline fallback to `OfflineAgroEngine` is a non-production path only; production surfaces
   `AI_PROVIDER_UNAVAILABLE` instead of silently degrading (`apps/api/src/providers/ai/gateway.ts:70-83`).
7. **No fake production data**: demo/mock providers are selected explicitly via env; sandbox payment
   responses are labelled `providerMode: "sandbox"`; `sslcommerz` adapter implements signature verification and is only instantiated when creds present.
8. **Observability:** Prometheus `/metrics` with metric names as actually registered —
   `agrobridge_http_requests_total`, `agrobridge_http_request_duration_seconds`, `agrobridge_db_up`,
   `agrobridge_ai_requests_total`, `agrobridge_payment_intents_total` plus default process metrics
   (`apps/api/src/infrastructure/metrics.ts:6-38`). Alert rules are materialized in
   `monitoring/alert_rules.yml` (narrated in `docs/operations.md`).
9. **Storage abstraction:** `StorageProvider` interface with `local | s3 | db` implementations
   (`apps/api/src/providers/storage/index.ts`); disease images via `getStorageProvider()` — `db` is the
   production default because instance-disk uploads are lost on redeploy (ADR-0012).

## Architecture Decision Records (`docs/adr/`)

- [0001 — Marketplace catalog is login-gated by design](adr/ADR-0001-login-gated-marketplace-catalog.md)
- [0002 — Hand-rolled web data layer](adr/0002-hand-rolled-data-layer.md) (`api()` + `useResource`, no query library)
- [0003 — Token storage in localStorage](adr/0003-token-storage-in-localstorage.md) (accepted XSS risk; cookie migration trigger)
- [0004 — Dual-dialect Prisma](adr/0004-dual-dialect-prisma.md) (SQLite dev / PostgreSQL prod; every schema copy must be updated)
- [0005 — Provider adapters](adr/0005-provider-adapters.md) (weather/AI/payment/storage; `ALLOW_PLACEHOLDER_PROVIDERS` fail-fast)
- [0006 — Version single source](adr/0006-version-single-source.md) (`version.json`; `RELEASE_MANIFEST.md` is historical)
- [0007 — Schema state in the release contract](adr/0007-schema-state-in-release-contract.md) (`/ready` reports the applied migration chain; the deploy gate compares it)
- [0008 — Static site edge policy](adr/0008-static-site-edge-policy.md) (CSP by hash, cache split, build-time preflight)
- [0009 — Offline sync policy](adr/0009-offline-sync-policy.md) (write queue allow-list, `clientUuid` idempotency, owner-scoped replay)
- [0010 — Job durability](adr/0010-job-durability.md) (no server-side queue; Redis is rate-limit-only and fails open)
- [0011 — Data retention](adr/0011-data-retention.md) (financial rows retained; deletion anonymizes identity)
- [0012 — Durable uploads in the database](adr/0012-durable-uploads-in-database.md) (`STORAGE_PROVIDER=db`; the release gate rejects instance-disk uploads)
- [0013 — Admin/payout step-up decision](adr/0013-admin-payout-step-up-decision.md) (risk accepted with compensating controls; re-decide at the named triggers)
- [0014 — OpenAPI contract strategy](adr/0014-openapi-contract-strategy.md) (docs/api.md + the response-contract fixture are the gate; generated OpenAPI deferred with triggers)
- [0015 — Tenancy / RLS decision](adr/0015-tenancy-rls-decision.md) (application scoping now; RLS prototype plan with `SET LOCAL app.user_id`)
- [0016 — Payment provider selection](adr/0016-payment-provider-selection.md) (SSLCommerz; hosted checkout keeps PCI scope out; activation is an owner gate)
