# ADR-0004 — Dual-dialect Prisma: SQLite for dev/test, PostgreSQL for production, one model in three files

- Status: accepted (with a standing maintenance rule)
- Date: 2026-10-18
- Deciders: engineering; arrangement already in force, recorded by the Phase 4 quality review

## Context

Prisma does not support two providers for one schema, so the repository keeps the model
definition **three times** and the migration history **twice**:

| File / chain | Dialect | Used by |
|---|---|---|
| `apps/api/prisma/schema.prisma` | SQLite | local dev, unit/e2e tests, CI (zero-setup, reproducible) |
| `apps/api/prisma/schema.postgresql.prisma` | PostgreSQL | `provision-postgres.mjs`, backup rehearsal, CI schema validation |
| `apps/api/prisma/postgres/schema.prisma` | PostgreSQL + `binaryTargets = ["native", "rhel-openssl-3.0.x"]` | the Vercel serverless function (Amazon Linux 2023 engine) |
| `apps/api/prisma/migrations/` | SQLite chain | `prisma migrate deploy` in dev/test |
| `apps/api/prisma/postgres/migrations/` | PostgreSQL chain | `db:migrate:pg` → `scripts/deploy-migrations.mjs` (idempotent, baseline-aware) |

The client is selected at install/build time by `scripts/generate-prisma.mjs`, wired as the
**root `postinstall`**:

- `VERCEL=1` / `VERCEL_ENV` set → `prisma/postgres/schema.prisma`;
- everywhere else → `prisma/schema.prisma`.

`apps/api/vercel.json` additionally runs `scripts/vercel-build-api.mjs`, which regenerates the
PostgreSQL client during `buildCommand` so a build that skips lifecycle scripts
(`--ignore-scripts`) still gets the right client. `scripts/deploy-migrations.mjs` picks the
migration chain by `DATABASE_URL` prefix.

Drift between the copies is guarded by `apps/api/tests/schema-parity.test.ts`, which compares the
SQLite and PostgreSQL schemas model-by-model, field-by-field and index-by-index at test time —
index drift had already shipped once (the SQLite chain carried `[status, createdAt]` composites
the PostgreSQL chain lacked).

**Why the Vercel switch is load-bearing.** Until 2026-10-17 the root postinstall generated the
SQLite client unconditionally, so every Vercel build (GitHub integration and CLI prebuilt alike)
bundled an SQLite Prisma client; all DB-backed routes then failed with
`URL must start with the protocol 'file:'`. The first prebuilt deploy to production (2026-10-17,
round 9) served 500s on login for a few minutes until the switch was fixed and redeployed. The
`postinstall` → `generate-prisma.mjs` commit (`d6460aa`, 2026-10-17) is the fix that made the
production path work. This is a separate incident from the 2026-10-15 login outage, whose root
cause was a Render free-tier PostgreSQL instance expiring (INC-2026-10-15 in
`ENTERPRISE_CERTIFICATION_STATUS.md` §9) — that outage is what forced the re-platform to
Vercel + Neon, where the postinstall switch became critical in the first place.

## Decision

Keep the dual-dialect arrangement. Keep SQLite as the default developer/CI dialect (no external
service, deterministic CI) and PostgreSQL as the only production dialect. Keep
`scripts/generate-prisma.mjs` as the environment-driven client generator.

**Standing rule: any schema change must update every copy.** A model/field/index change touches
`prisma/schema.prisma`, `prisma/schema.postgresql.prisma` and `prisma/postgres/schema.prisma`,
plus a migration in each chain that needs it — the parity test fails otherwise. The three
PostgreSQL copies are intentionally identical in models; only `binaryTargets` differs.

## Consequences

- Local development and CI need no database server; production runs real PostgreSQL (Neon)
  through the same application code.
- The cost is triple maintenance and a deploy-time failure mode: a schema edited in one copy is a
  latent production break. The parity test and the "update every copy" rule are the controls.
- The postinstall/`buildCommand` pair must stay aligned; removing either without checking
  `VERCEL=1` handling reintroduces the SQLite-client-in-production failure.
- See also `docs/runbooks/live-deployment.md` (current topology and deploy pipeline) and ADR-0006
  for how the release/version side of deployment is tracked.
