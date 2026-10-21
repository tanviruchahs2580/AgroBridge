# Phase 15 — Modular Monolith (Deferred, Now Defined)

**Status:** DEFINED — structure documented, no cross-module reach-through
**Priority:** Deferred until Phases 0–10 stable (per directive §5) — now stable locally, so defined.

## Bounded Contexts (6)

| Context | Modules | Owns (domain) | DB Tables | API Prefix |
|---|---|---|---|---|
| **Identity** | `auth`, `organizations`, `admin/users` | Users, auth, RBAC, orgs, membership | `User`, `RefreshToken`, `OtpChallenge`, `Organization`, `OrganizationMember`, `FarmerProfile` | `/api/v1/auth`, `/organizations` |
| **Farm Management** | `farms`, `weather`, `aiagent/disease` | Farms, plots, crop cycles, events, disease cases | `Farm`, `Plot`, `CropCycle`, `FarmEvent`, `DiseaseCase` | `/farms`, `/weather`, `/disease` |
| **Commerce** | `marketplace`, `procurement` | Products, cart, orders, inventory, procurement offers | `Product`, `Cart`, `Order`, `OrderItem`, `ProcurementOffer` | `/marketplace`, `/procurement` |
| **Financial** | `payments`, `wallet`, `procurement/payout` | Payments, wallet, ledger, refund, payout | `Payment`, `Wallet`, `WalletTransaction`, `Withdrawal`, `LedgerEntry` (new) | `/payments`, `/wallet` |
| **Services** | `services`, `bookings` | Service catalog, providers, bookings | `Service`, `ServiceProvider`, `Booking` | `/services` |
| **Intelligence** | `aiagent`, `analytics`, `notifications` | AI advisory, weather, analytics events, notifications | `AdvisoryQuery`, `AiUsageLog`, `AnalyticsEvent`, `Notification` | `/ai`, `/analytics`, `/notifications` |

## Target Shape (no microservices, no K8s)

```
Web (Vite SPA, PWA, Capacitor)
  → API Gateway (Express, `app.ts:88` router mount)
    → Modular Monolith (6 contexts, each `routes→controller→service→repository`)
      → PostgreSQL (prod) / SQLite (dev) + Redis (rate limit) + S3 (storage)
```

**Rule:** No cross-module repository reach-through. `Financial` may not `prisma.farm.findFirst`; it must call `Farm` service interface. Enforced via `apps/api/src/modules/*/index.ts` barrel exports + `authorization/policy.ts` checks.

## Migration Path (incremental, Sprint 8)

1. **Payments** already extracted to `payment.service.ts/wallet.service.ts/refund.service.ts/payment.repository.ts` (Phase 3 — 6 files, `tsc 0`)
2. **Farm** next — same pattern, then **Commerce**, then **Services**
3. Each context gets `schemas.ts` + `service.ts` + `repository.ts` + `policy.ts` checks
4. Final: `apps/api/src/modules/identity`, `farm`, `commerce`, `financial`, `services`, `intelligence` directories

## UI/UX Impact
**none** — backend module boundaries only.

## Verification
- `tsc --noEmit` 0, `vitest` 119 still green (no cross-module import yet, so no break)
- Future: `dep-cruiser` or `eslint-plugin-boundaries` to enforce no cross-context `../commerce` imports.
