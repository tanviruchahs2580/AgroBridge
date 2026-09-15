# Deployment Runbook

## Environments
| Env | DB | Notes |
|---|---|---|
| development | SQLite `apps/api/prisma/dev.db` | `npm run dev` (API :4000, Web :5173) |
| test | SQLite `apps/api/prisma/test.db` | provisioned automatically by vitest globalSetup |
| staging/production | PostgreSQL | schema provider switch + migrations below |

## 1. Prerequisites
- Node ≥ 20 (CI uses 22), npm 10+
- PostgreSQL 14+ for staging/production
- Strong secrets: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (64-char random)

## 2. Configure
```bash
cp .env.example .env    # then fill values; never commit .env
```
Required in production: `DATABASE_URL` (Postgres), JWT secrets, `WEB_ORIGIN` (exact origins),
and any real provider credentials (`OPENWEATHER_API_KEY`, `AI_PROVIDER=openai-compatible` +
`OPENAI_API_KEY`). Without them the system runs on clearly-labelled mock/sandbox providers.

## 3. Database switch to PostgreSQL
The PG runtime schema is `apps/api/prisma/schema.postgresql.prisma` (kept in sync with the
SQLite schema by `tests/schema-parity.test.ts`), and its migration chain lives in
`apps/api/prisma/postgres/migrations/`. **Do not** point the default
`npx prisma migrate deploy` at PostgreSQL — `prisma/migrations/` is SQLite-only (provider
mismatch validation error, P1 fixed 2026-09-15).

1. Apply PG migrations from `apps/api`: `npm run db:migrate:pg`
   (i.e. `prisma migrate deploy --schema prisma/postgres/schema.prisma`) with `DATABASE_URL`
   pointing at PostgreSQL.
2. Client for runtime builds: `npx prisma generate --schema prisma/schema.postgresql.prisma`
   (the api Dockerfile already does this via its provider-sed step; Render's buildCommand does).
3. Seed reference data: `npm run db:seed` — in production the seed **skips** unless
   `ALLOW_DEMO_SEED=1` is explicitly set (demo SUPER_ADMIN/ADMIN accounts must never be
   created in production; enforced 2026-09-15).

## 4. Build & run (bare metal / VM)
```bash
npm ci --include-workspace-root
npm run build                      # api → apps/api/dist, web → apps/web/dist
npm run db:migrate:pg -w apps/api  # PostgreSQL: prisma/postgres migrations
NODE_ENV=production node apps/api/dist/server.js
# serve apps/web/dist with nginx/caddy; proxy /api → API service (see docker/web.nginx.conf)
```

## 5. Docker Compose
```bash
export POSTGRES_PASSWORD=... API_DATABASE_URL="postgresql://..." \
       JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=...
docker compose -f docker-compose.yml up --build -d
docker compose -f docker-compose.yml up --build -d
docker compose exec api npx prisma migrate deploy --schema prisma/postgres/schema.prisma
curl -f http://localhost:4000/health && curl -f http://localhost:8080/
```

## 6. Post-deploy verification checklist
1. `/health` returns ok; `/ready` reports `db:true`.
2. Seeded admin login works; farmer demo login works.
3. Register a fresh farmer → create farm → plot → crop.
4. Weather endpoint returns advisories for farm coordinates.
5. AI advisory answers a KB question with confidence + refs.
6. Marketplace checkout completes and stock decrements.
7. Sandbox payment marks an order PAID.
8. Procurement offer → QC → PO → collect → payout credits wallet.
9. Admin metrics load; audit log shows the actions above.

## Rollback
- App: redeploy previous image/build tag; API is stateless.
- DB: restore snapshot per [disaster-recovery](disaster-recovery.md); migrations are append-only and
  forward-only — write compensating migration instead of down-migrating.

## Backup & restore
See [disaster-recovery.md](disaster-recovery.md).
