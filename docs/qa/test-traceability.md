# Test traceability

Capability → representative test files → suite → CI job. Test file names are real paths in this
repository (`apps/api/tests/…`, `apps/web/src/**/*.test.ts(x)`, `apps/web/e2e/…`); no counts are
quoted because they move every round — take totals from your own run (the README says the same).

Priority: **P0** = money, auth, tenancy, data integrity; **P1** = core product journeys; **P2** =
supporting surfaces. CI job ids are the job keys in `.github/workflows/ci.yml`.

| Capability | Pri | Representative tests | Suite | CI job |
|---|---|---|---|---|
| Registration, login, refresh rotation + reuse detection, logout | P0 | `journey-auth.test.ts`; `auth-hardening.test.ts`; `login-timing-equalisation.test.ts` | api | `api-quality`, `api-postgres` |
| Phone OTP verification | P0 | `auth-hardening.test.ts` (OTP suite) | api | `api-quality`, `api-postgres` |
| Account deletion (anonymize, block with pending money) and data export | P0 | `auth-hardening.test.ts`; `auth-deletion-completion.test.ts`; `auth-export.test.ts` | api | `api-quality`, `api-postgres` |
| Auth/financial rate limiting and 429 envelope | P0 | `auth-rate-limit-envelope.test.ts`; `rate-limit-envelope.test.ts`; `rate-limit-redis.test.ts` | api | `api-quality`, `api-postgres` |
| Server-side RBAC and privilege-escalation resistance | P0 | `security-matrix.test.ts`; `rbac-fixes.test.ts` | api | `api-quality`, `api-postgres` |
| IDOR/BOLA across orders, payments, notifications, advisories, disease cases | P0 | `cross-user-negative.test.ts`; `security-matrix.test.ts`; `farm-event-sync-scoping.test.ts` | api | `api-quality`, `api-postgres` |
| Tenant (organization) isolation | P0 | `tenant-isolation.test.ts` | api | `api-quality`, `api-postgres` |
| CORS origin policy and security headers | P0 | `cors-origin-policy.test.ts`; `security-observability.test.ts` | api | `api-quality`, `api-postgres` |
| Log redaction (PII, tokens) | P0 | `log-redaction.test.ts` | api | `api-quality`, `api-postgres` |
| Marketplace checkout pricing, delivery fee, membership discount | P0 | `journey-marketplace.test.ts` | api | `api-quality`, `api-postgres` |
| Checkout idempotency (key + cart-claim) and cancel/restock | P0 | `checkout-idempotency.test.ts`; `checkout-idempotency-key.test.ts`; `order-cancel-restock.test.ts` | api | `api-quality`, `api-postgres` |
| Oversell prevention under parallel checkout (PostgreSQL) | P0 | `concurrency.test.ts` | api (PG profile) | `api-postgres` |
| Payment intent lifecycle, sandbox confirm, webhook signature/amount/replay | P0 | `payments-integrity.test.ts`; `payments-webhook-amount.test.ts`; `payment-confirm-webhook-race.test.ts` | api | `api-quality`, `api-postgres` |
| Refund rules and provider-mode behaviour | P0 | `payments-integrity.test.ts` (refunds); `payments-refund-provider-mode.test.ts` | api | `api-quality`, `api-postgres` |
| Wallet withdrawals, holds, approve/reject, race safety | P0 | `wallet-withdrawals.test.ts`; `withdrawal-race.test.ts`; `timezone-boundaries.test.ts` | api | `api-quality`, `api-postgres` |
| Procurement QC pipeline, grade/moisture math, payout credit | P0 | `journey-services-procurement.test.ts`; `unit-core.test.ts` (price engine) | api | `api-quality`, `api-postgres` |
| Concurrent payouts credit once | P0 | `concurrency.test.ts` | api (PG profile) | `api-postgres` |
| Disease upload hardening (size, MIME, magic bytes, EXIF) and storage durability | P0 | `disease-upload-hardening.test.ts`; `storage-db-provider.test.ts` | api | `api-quality`, `api-postgres` |
| Farm records: farm → plot → crop lifecycle, task calendar | P1 | `journey-farm.test.ts`; `unit-core.test.ts` (lifecycle stages) | api | `api-quality`, `api-postgres` |
| Offline-first farm events, `clientUuid` idempotency, owner scoping | P1 | `journey-farm.test.ts`; `farm-event-sync-scoping.test.ts` | api | `api-quality`, `api-postgres` |
| Weather providers, cache freshness, provenance fields | P1 | `journey-weather-ai-disease.test.ts`; `weather-cache.test.ts`; `weather-provenance.test.ts`; `unit-core.test.ts` (risk engine) | api | `api-quality`, `api-postgres` |
| AI grounding, low-confidence honesty, history, feedback | P1 | `journey-weather-ai-disease.test.ts`; `ai-eval.test.ts`; `ai-feedback.test.ts`; `ai-history-refs.test.ts`; `ai-versioning.test.ts` | api | `api-quality`, `api-postgres` |
| AI prompt-injection posture and provider adapter failure taxonomy | P1 | `ai-prompt-injection.test.ts`; `ai-provider-adapter.test.ts`; `ai-eval-harness.test.ts`; `ai-eval-degradation.test.ts` | api | `api-quality`, `api-postgres` |
| Service catalog, booking lifecycle, pricing units, rating | P1 | `journey-services-procurement.test.ts`; `services-pricing-rating.test.ts` | api | `api-quality`, `api-postgres` |
| Notifications and cross-user isolation | P1 | `journey-admin.test.ts`; `cross-user-negative.test.ts` | api | `api-quality`, `api-postgres` |
| Admin metrics, user suspension with instant revocation, audit log viewer | P1 | `journey-admin.test.ts`; `admin-pagination-bounds.test.ts`; `security-matrix.test.ts` | api | `api-quality`, `api-postgres` |
| Response contract, error envelope, list totals | P1 | `response-contract.test.ts`; `money-list-total-count.test.ts`; `misc-hardening.test.ts` | api | `api-quality`, `api-postgres` |
| Environment parity and placeholder fail-fast, cost guard | P1 | `env-parity.test.ts`; `env-cost-guard.test.ts` | api | `api-quality`, `api-postgres` |
| Schema parity across dialect copies and migration chain | P0 | `schema-parity.test.ts`; `docs-route-parity.test.ts` | api | `api-quality`; drift itself by `api-migration-drift` |
| Web session handling, API client, error mapping | P1 | `apps/web/src/lib/api.test.ts`; `apps/web/src/lib/session.test.tsx`; `apps/web/src/lib/useResource.test.tsx` | web | `web-quality` |
| Web offline queue (allow-list, dedupe, flush outcomes) | P1 | `apps/web/src/lib/offlineQueue.test.ts` | web | `web-quality` |
| Bengali/English dictionary parity and formatting | P1 | `apps/web/src/lib/i18n.test.ts`; `apps/web/src/lib/format.test.ts`; `apps/web/src/lib/resourceKeys.test.ts` | web | `web-quality` |
| Advisor UI (answer metadata, feedback, history refresh) | P1 | `apps/web/src/features/advisor/*.test.ts(x)` | web | `web-quality` |
| Farmer journey end to end (register/login → farm → advisory → order) | P1 | `apps/web/e2e/farmer-journey.spec.ts`; `english-mode.spec.ts` | e2e (Playwright) | `web-e2e` |
| Offline behaviour in a real browser | P1 | `apps/web/e2e/offline.spec.ts` | e2e | `web-e2e` |
| Settings, account deletion surface, admin guard | P1 | `apps/web/e2e/settings-account.spec.ts`; `admin-guard.spec.ts` | e2e | `web-e2e` |
| Accessibility and visual contract | P1 | `apps/web/e2e/a11y.spec.ts`; `visual-contract.spec.ts` | e2e | `web-e2e` |
| Console health (no uncaught errors in journeys) | P2 | `apps/web/e2e/console-health.spec.ts`; `splash-verify.spec.ts`; `gui-e2e-test.spec.ts` | e2e | `web-e2e` |
| Android debug artifact builds | P1 | workflow build only (no device instrumentation in CI) | android | `android-build` |
| Secret scan, container scan, IaC scan, dependency audit | P0 | workflow scanners, not unit tests | repo | `gitleaks`, `trivy-scan`, `iac-scan`, `security-scan` |
| Docker images build and compose smoke (db + api) | P1 | workflow steps | repo | `docker-build`, `compose-smoke` |

## How the suites run

| Suite | Command (from `docs/testing.md`) | Database | Notes |
|---|---|---|---|
| api (SQLite) | `npx vitest run` in `apps/api` | fresh `prisma/test.db` per run | default profile; one PostgreSQL-gated test skips by design |
| api (PostgreSQL) | `npm run test:pg` in `apps/api` | real PostgreSQL 17, provisioned from the production schema + migration chain | concurrency and race tests run here |
| web unit | `npm run test:unit` in `apps/web` | none | vitest + jsdom |
| web e2e | `npm run test:e2e` in `apps/web` | seeded SQLite via the running API | Playwright chromium (all specs) + firefox/webkit smoke subset |

## Gaps this map keeps visible

- **No device-level Android testing.** `android-build` produces an APK; nothing runs on a device or
  emulator in CI (`.audit/v2/BASELINE.md` records the same environment limitation).
- **No load or soak test in CI.** The only load figure in the repo is the local autocannon profile
  in `docs/testing.md`; `qa-evidence/P1-loadtest-local.log` is a one-off run, not a gate.
- **No XSS or CSRF-specific test** despite the localStorage token decision (see
  `docs/threat-model.md`, abuse cases without a dedicated test).
- **No production smoke test job.** Post-deploy verification steps exist in
  `docs/runbooks/live-deployment.md` but are executed by hand; `deploy-verify.yml` checks the
  release contract, not user journeys.
- **AI evaluation is threshold-gated, not accuracy-certified.** The frozen held-out set with
  pre-registered thresholds runs in `ai-eval-harness.test.ts`; the KB content itself is pending
  agronomist review (`docs/agronomy-review-sheet.md`).
