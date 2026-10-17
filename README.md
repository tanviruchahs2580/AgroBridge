# AgroBridge 🌾

**Green Soil. Smart Farm. Secure Future.**

Farmer-centric, AI-powered digital agriculture platform connecting farmers with inputs,
machinery services, procurement, payments and market access.

---

## What is in this repository

| Component | Stack | Path |
|---|---|---|
| API server | Node 22+, Express 4, TypeScript (strict), Prisma | `apps/api` |
| Web app (farmer + admin) | React 18, Vite, Tailwind CSS, Bengali/English UI | `apps/web` |
| Database | SQLite (dev/test, zero-setup) · PostgreSQL in production (Neon via Vercel Marketplace) | `apps/api/prisma` |
| CI | GitHub Actions: lint → typecheck → tests → docker build → audit | `.github/workflows/ci.yml` |
| Containers | Multi-stage Dockerfiles + compose stack | `docker/`, `docker-compose.yml` |

## Core capabilities

- **Auth & RBAC** — phone-based registration, bcrypt passwords, JWT access tokens + rotating
  refresh tokens, immediate revocation on suspension, 13 roles enforced **server-side**.
- **My Farm** — farms → plots → crop cycles with automatic lifecycle staging
  (SEED → GERMINATION → … → HARVEST), stage-aware task calendar, auditable digital farm records.
- **Offline-tolerant sync** — farm events accept a `clientUuid` so replayed offline writes are idempotent.
- **Weather intelligence** — provider-abstracted weather converted to agricultural risk advisories
  (spray warning, rain warning, heat stress, irrigation advice, fungal disease risk). Bengali + English.
- **AI Agro Agent** — grounded retrieval over a curated Bangladesh-crop knowledge base; confidence
  scoring; explicit expert-verification note when confidence is low; prompt-injection sanitization;
  usage telemetry; pluggable OpenAI-compatible adapter; graceful fallback to the offline engine.
- **Disease detection intake** — validated image upload queued for agronomist review
  (`PENDING_REVIEW`). The system **never fabricates an AI diagnosis** without a trained model configured.
- **Marketplace & orders** — catalog with stock, cart, transactional checkout (atomic stock decrement),
  membership-tier discounts, sandbox payment flow clearly labelled as sandbox.
- **Service marketplace** — drone/tractor/harvester/agronomist bookings with provider assignment,
  lifecycle states and rating aggregation.
- **Procurement** — crop offers with auditable grade/moisture price calculation, QC state machine,
  payout that credits the farmer wallet via ledger transactions.
- **Admin control tower** — metrics mapped to live queries, user management, audit log viewer,
  AI usage analytics.
- **Observability** — `/health`, `/ready`, structured pino logs with secret redaction, request IDs on
  every response.

## Quick start (development)

```bash
npm install                      # workspaces install
npm run db:migrate --workspace apps/api   # or: npx prisma migrate dev (in apps/api)
npm run db:seed --workspace apps/api      # demo data (public demo credentials)
npm run dev --workspace apps/api          # API on :4000
npm run dev --workspace apps/web          # Web on :5173 (proxies /api to :4000)
```

### Demo credentials (development seed only — public knowledge, never use in production)

| Role | Phone | Password |
|---|---|---|
| SUPER_ADMIN | 01700000000 | Demo@1234 |
| ADMIN | 01700000001 | Demo@1234 |
| FARMER | 01700000002 | Demo@1234 |
| DEALER | 01700000003 | Demo@1234 |
| PROCUREMENT_MANAGER | 01700000004 | Demo@1234 |

## Tests

```bash
npm run test --workspace apps/api        # API suite (SQLite profile; one PG-gated test skips by design)
npm run test:pg --workspace apps/api     # same suite against a provisioned PostgreSQL (docker postgres)
npm run test --workspace apps/web        # web unit tests (vitest)
npm run test:e2e --workspace apps/web    # Playwright browser suite (needs the local stack + seeded demo farmer)
```

The counts move with every round — on 2026-10-18 the API suite ran **157 passed / 1 skipped**
(take the number from your own run rather than from this file).

The suite provisions a clean SQLite test database via migrations (+demo seed) and exercises the
real HTTP API end-to-end: registration→login→profile, farm→plot→crop, weather advisories, AI agent
grounding & low-confidence behaviour, disease upload→review workflow, marketplace checkout with
stock consistency, service booking lifecycle, procurement pipeline with wallet payout, admin
metrics/RBAC/suspension, notifications, offline-sync idempotency and security baseline checks.

## Production notes

- **Production hardening already runs PostgreSQL** (Neon DB behind the Vercel function; see
  `docs/runbooks/live-deployment.md` — the PG migration chain lives in `apps/api/prisma/postgres/migrations`).
- Configure real providers via env (`WEATHER_PROVIDER=openweather`, `AI_PROVIDER=openai-compatible`,
  payment gateway integration point documented in `docs/architecture.md`). Placeholder providers
  require an explicit `ALLOW_PLACEHOLDER_PROVIDERS=1` (the API refuses to boot on them in production otherwise).
- Generate strong JWT secrets. The API refuses to boot in production with default secrets.
- Docker: `docker compose up --build` after configuring required env vars (dev composition).

## Shipping to Google Play

The whole submission package is in the repository: `docs/play/release-runbook.md` (domain →
AAB → Console, step by step), `docs/play/listing-copy.md` (paste-ready bn/en copy),
`docs/play/data-safety.md` (Console answers traced to the code), `docs/play/reviewer-access.md`
(+ `scripts/play/create-reviewer-account.mjs`), and the artwork in `play/`. The in-app account
deletion Google Play requires lives at **Settings → Account**, and the public pages it points
at are served by the SPA at `/privacy`, `/terms` and `/account-deletion`.

## Documentation index

See `docs/`: [architecture](docs/architecture.md) · [api](docs/api.md) · [database](docs/database.md)
· [ai](docs/ai.md) · [security](docs/security.md) · [testing](docs/testing.md)
· [deployment](docs/deployment.md) · [operations](docs/operations.md)
· [disaster-recovery](docs/disaster-recovery.md) · [troubleshooting](docs/troubleshooting.md)
· [Play release runbook](docs/play/release-runbook.md)
· [code-quality review 2026-10-17](docs/CODE_QUALITY_REVIEW_2026-10-17.md)
· [dependency backlog](docs/DEPENDENCY_BACKLOG.md) · [ADRs](docs/adr/)

## License

MIT — see [LICENSE](LICENSE).
