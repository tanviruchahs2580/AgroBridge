# Traceability — journeys → suites → requirements (QAT-01)

The map between what the product promises, the automated suite that guards it,
and where the requirement is enforced in code. *Non-functional rows live in
docs/slo.md (availability/latency) and docs/threat-model.md (STRIDE rows).*

| Requirement / journey | Suite (apps/api/tests) | Code |
|---|---|---|
| Registration, login, refresh rotation+reuse detection, timing-equalised 401s | `journey-auth`, `login-timing-equalisation`, `auth-rate-limit-envelope` | `modules/auth/routes.ts`, `modules/auth/password.ts` |
| Per-account brute-force + per-credential global limits | `rate-limit-keys`, `auth-rate-limit-envelope` | `middleware/rateLimitKeys.ts` |
| Farm → plot → crop lifecycle, farm events idempotent replay, owner scoping | `journey-farm`, `farm-event-sync-scoping` | `modules/farms/routes.ts` |
| Marketplace checkout: stock decrement, idempotent replay, delivery fee | `journey-marketplace`, `checkout-idempotency(-key)` | `modules/marketplace/routes.ts` |
| Orders: cancel-restock, money lists capped with X-Total-Count | `order-cancel-restock`, `money-list-total-count` | `modules/marketplace/routes.ts` |
| Payments: server-side amounts, webhook signature+amount, intent trail | `payments-webhook-amount`, `payment-confirm-webhook-race`, `payments-integrity`, `hardening-round11` | `modules/payments/routes.ts` |
| Refunds: provider-mode honest, wallet ledger legs | `payments-refund-provider-mode`, `wallet-withdrawals`, `withdrawal-race` | `modules/payments/routes.ts` |
| Wallet invariant: ledger == balance, held == pending withdrawals | `wallet-reconciliation` (+ ops script `apps/api/scripts/reconcile-wallet.mjs`) | `apps/api/scripts/reconcile-wallet.mjs` |
| Services market: pricing, provider assignment, rating aggregation | `services-pricing-rating`, `journey-services-procurement` | `modules/services/routes.ts` |
| Procurement pipeline: QC state, payout credits wallet | `journey-services-procurement` | `modules/procurement/routes.ts` |
| Weather advisories: provenance, caching, single-flight | `journey-weather-ai-disease`, `weather-provenance`, `weather-cache`, `weather-single-flight` | `modules/weather/routes.ts` |
| AI agent: grounding, low-confidence honesty, injection resistance, quota | `ai-eval(-harness/-degradation)`, `ai-prompt-injection`, `ai-feedback`, `ai-versioning`, `ai-history-refs` | `modules/aiagent/routes.ts`, `providers/ai/*` |
| Disease intake: upload hardening, review workflow, notifications | `journey-weather-ai-disease`, `disease-upload-hardening` | `modules/disease/routes.ts` |
| Admin: RBAC boundaries, metrics, user search + instant suspension | `journey-admin`, `rbac-fixes`, `security-matrix` | `modules/admin/routes.ts`, `middleware/rbac.ts` |
| Tenancy: cross-farm/cross-org isolation | `cross-user-negative`, `tenant-isolation` | every farmer-facing query |
| Data rights: export, deletion completion | `auth-export`, `auth-deletion-completion` | `modules/auth/dataExport.ts` |
| Env/config: schema-only entry, parity with .env.example, cost guards | `env-parity`, `env-cost-guard` | `config/env.ts` |
| Response shapes consumed by web | `response-contract` (+ committed fixture in `contracts/`) | `modules/*/routes.ts` |
| Schema chain reproduces schema on both dialects | `schema-parity` (+ `drift:check` gate) | `prisma/migrations`, `prisma/postgres` |
| Observability: redaction, metrics, request/trace ids | `log-redaction`, `metrics`, `hardening-round11` (traceparent) | `shared/logging`, `middleware/context.ts` |
| Upload abuse defence + review workflow | `disease-upload-hardening`, `journey-weather-ai-disease` | `modules/disease/routes.ts` |
| Overload/refusal behaviour, idempotent header, trace ids | `admission-and-pool`, `hardening-round11` | `middleware/admission.ts`, `middleware/idempotency.ts` |
| Android build / signed AAB / Play assets | CI `android-build` job + `docs/play/*` | `apps/web/android` |

Registration-tagged regressions from audit rounds land as named suites
(`round10-regressions`, `misc-hardening`, `rbac-fixes`, `checkout-idempotency`)
so every audit finding keeps its regression test after the fix ships.
