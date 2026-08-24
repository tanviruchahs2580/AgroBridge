# Architecture

## System overview

```
Farmer / Admin / B2B (React SPA, bn/en)
        │  HTTPS, JWT bearer
        ▼
AgroBridge API  (Express + TypeScript, modular monolith)
 ├── middleware: request-id → helmet → cors → rate-limit → auth(JWT+status) → RBAC → zod validation
 ├── domains:
 │    identity · farms · weather · ai-agent · disease · marketplace
 │    services/bookings · procurement · payments/wallet · membership
 │    notifications · admin · audit
 ├── providers (swappable adapters):
 │    WeatherProvider      mock | openweather
 │    AIProvider           offline-agro-engine | openai-compatible (+fallback)
 │    PaymentProvider      sandbox | (gateway slot)
 │    NotificationProvider in-app DB (+ SMS slot)
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
   enforced per-query (farmers' queries are always scoped to their own rows).
6. **AI safety**: input sanitization, grounded retrieval, confidence thresholds with mandatory expert-
   verification notes, no direct action execution by the AI (orders/payments require explicit user flows).
7. **No fake production data**: demo/mock providers are selected explicitly via env; sandbox payment
   responses are labelled `providerMode: "sandbox"`.
