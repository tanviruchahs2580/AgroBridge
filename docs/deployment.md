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
2. Client for runtime builds: `npx prisma generate --schema prisma/postgres/schema.prisma` — the
   production copy (the one carrying the serverless engine target), which
   `scripts/patch-vercel-output.mjs` regenerates into the Vercel function bundle, and the copy the
   CI PostgreSQL job now provisions from (ADR-0007). The retired Render service is on no deploy path.
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
1. `/health` returns ok; `/ready` reports `db:true`, the applied `schema` chain and the
   `limiterStore` in use (the deploy gate asserts all three on every push to `main`, ADR-0007).
2. Seeded admin login works; farmer demo login works.
3. Register a fresh farmer → create farm → plot → crop.
4. Weather endpoint returns advisories for farm coordinates.
5. AI advisory answers a KB question with confidence + refs.
6. Marketplace checkout completes and stock decrements.
7. Sandbox payment marks an order PAID.
8. Procurement offer → QC → PO → collect → payout credits wallet.
9. Admin metrics load; audit log shows the actions above.
10. Confirm the operational knobs were set deliberately rather than left at defaults:
    `MAX_CONCURRENT_REQUESTS` (size it to the instance — `docs/operations.md`),
    `DATABASE_CONNECTION_LIMIT` (the fleet total must fit the database's `max_connections`),
    `BCRYPT_POOL_SIZE`, and `REDIS_URL` if more than one instance runs.

**Note on `/metrics`:** unauthenticated outside production, and in production it answers any source
in a private range or anyone holding `METRICS_TOKEN`. That is deliberate — it is the scrape
endpoint — but it exposes route inventory, status distributions and traffic shape, so on a
deployment whose network is not fully trusted, set `METRICS_TOKEN` and reach it over the private
network instead of relying on the address check alone.

## 7. Static-site edge policy (headers, CSP, caching)

The SPA is served by Vercel from `apps/web/dist`. Its edge policy lives in **two** config files
that must stay identical: the repo-root `vercel.json` (what the Vercel Git integration reads,
because the project's root directory is the repository root) and `apps/web/vercel.json` (what the
documented CLI flow `cd apps/web && vercel deploy --prod` reads). `apps/web/scripts/preflight.mjs`
fails the build if they diverge, because a deploy path that silently ships a weaker policy is
worse than none.

| Rule | Value | Why |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'`; `script-src 'self' 'sha256-…'`; `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob:`; `font-src 'self'`; `connect-src 'self' <api origins>`; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'` | the origin that runs the app's JavaScript shipped no CSP at all until 2026-10-18 |
| `X-Content-Type-Options` | `nosniff` | MIME-confusion defence |
| `X-Frame-Options` | `DENY` | no framing; the Capacitor app loads bundled assets, not this origin |
| `Referrer-Policy` | `no-referrer` | matches the API |
| `Permissions-Policy` | `camera=(self), microphone=(), geolocation=(), payment=(), usb=()` | the app declares no location permission; `camera=(self)` keeps the `<input capture>` disease-photo intake working |
| `Cross-Origin-Opener-Policy` | `same-origin` | |
| `Cache-Control` on `/assets/*` | `public, max-age=31536000, immutable` | Vite content-hashes those names; revalidating every chunk on every visit was pure latency |
| `Cache-Control` on `/fonts`, `/icons`, `/images`, `/brand` | `public, max-age=604800, stale-while-revalidate=86400` | not hash-named, so a week with background refresh |
| the document, `version.json`, `sw.js` | left revalidating (Vercel default) | a pinned `index.html` would strand a client on an old bundle |

Three details that are easy to get wrong:

- **The inline theme-boot script is allowlisted by hash.** It stays inline deliberately: an external
  file is a render-blocking round trip before first paint on exactly the slow connections this app
  targets. Edit that script and the hash must change in both configs — the preflight recomputes it
  from the **built** HTML (not the source, which the bundler could rewrite) and fails otherwise, and
  it also fails if `script-src` ever gains `'unsafe-inline'`.
- **`connect-src` names the API origins explicitly.** Change `VITE_API_BASE_URL`
  (`apps/web/.env.production`) without adding that origin and every API call is blocked in
  production — while dev keeps working, because no CSP is served locally. Checked by the preflight.
- **`upgrade-insecure-requests` is part of the policy** and only has an effect over http, so a local
  header-simulating server must drop that one directive or the document's own subresources get
  rewritten to https and fail.

Verification is layered: the preflight runs on every pull request (static, deterministic);
`deploy-verify.yml` asserts the live headers plus the immutable/revalidate cache split after every
push to `main`; and the performance budgets (entry bundle, total JS/CSS gzip, fonts, images) are
byte budgets inside `preflight.mjs`, because this repo's Lighthouse config is
`workflow_dispatch`-only and would never fail a build.

## Rollback
- App: redeploy previous image/build tag; API is stateless.
- DB: restore snapshot per [disaster-recovery](disaster-recovery.md); migrations are append-only and
  forward-only — write compensating migration instead of down-migrating.

## Backup & restore
See [disaster-recovery.md](disaster-recovery.md).
