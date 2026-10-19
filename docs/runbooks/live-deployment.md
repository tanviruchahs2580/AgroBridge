# Runbook — Live Deployment (Vercel + Neon)

## Current production topology (2026-10-15)

| Component | Host | URL | Notes |
|---|---|---|---|
| Web SPA | Vercel project `agrobridge-web` | https://agrobridge-web.vercel.app | bundle bakes `VITE_API_BASE_URL` at build time |
| API | Vercel project `agro-bridge-api` | https://agro-bridge-api-vantiq-systems.vercel.app | Express via @vercel/node, framework `null` |
| Database | Neon (Vercel Marketplace), resource `neon-cyclamen-coin` | injected as `DATABASE_URL` (+`POSTGRES_*` vars) | Neon free tier; pooled + unpooled URLs both provided |

The previous API host (Render `agrobridge-vfbz.onrender.com`) is **retired**: its free
PostgreSQL instance expired (~30-day free-tier limit) and took login down (see
`ENTERPRISE_CERTIFICATION_STATUS.md` addendum 2026-10-15). The Render dashboard service is
not part of the live path anymore.

## API deploy pipeline (Vercel, prebuilt)

Vercel's remote builder regenerates the function bundle with its own TypeScript settings
and traces only the current-platform Prisma engine, so **`api/index.ts` must not be
type-dependent on the builder's program**, and the Prisma client must be patched into the
bundle after `vercel build`. The pipeline below is deterministic and committed:

```bash
cd apps/api
vercel build --prod                                    # → .vercel/output (Build Output API)
node scripts/patch-vercel-output.mjs                   # PG client + rhel engine into bundle
rm -rf ../../.vercel/output && cp -r .vercel/output ../../.vercel/output
cd ../..                                               # deploy from repo ROOT
vercel deploy --prebuilt --prod --yes                  # remote rootDirectory=apps/api joins paths from root
```

Deploy happens from the **repo root** because both Vercel projects declare
`Root Directory: apps/…`; deploying from the subfolder double-joins the path. The repo
root's `.vercel/project.json` is linked to `agro-bridge-api`; the web is linked from
`apps/web/.vercel/`.

### Function bundle facts (vercel.json)

- `framework: null` — avoids the Express preset's workspace-wide TS program check.
- entry `api/index.js` (plain JS) imports `../dist/app.js` produced by
  `npx tsc -p tsconfig.build.json` in `buildCommand` — the repo's own compile is the
  single source of truth; the builder never type-checks `src/`.
- `src/lib/prisma`-adjacent runtime needs `node_modules/.prisma/client` — delivered by
  `scripts/patch-vercel-output.mjs` (regenerates the PG client and replaces the traced
  one, including both engine binaries).

### Env vars (project `agro-bridge-api`, Production + Preview)

| Key | Value / origin |
|---|---|
| `DATABASE_URL` (+`POSTGRES_*`) | injected by the Neon marketplace integration |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | random 32-byte hex, generated 2026-10-15 |
| `WEB_ORIGIN` | comma list: `https://agrobridge-web.vercel.app`, `https://agro-bridge-api-vantiq-systems.vercel.app`, `https://localhost`, `capacitor://localhost`, `http://localhost:5173`, `http://localhost:4173`, `http://localhost:8080` |
| `NODE_ENV` | `production` |
| `ALLOW_PLACEHOLDER_PROVIDERS` | `1` (mock weather / offline AI / sandbox SMS — accepted placeholders) |
| `STORAGE_PROVIDER` | `db` — uploads are stored in the database (`StoredObject`) and survive redeploys. Use `s3` + `S3_*` when object storage is provisioned; `local` is rejected by the deploy gate because instance-disk uploads are lost on redeploy (ADR-0012). |
| `UPLOAD_BASE_DIR` | only meaningful with `STORAGE_PROVIDER=local` (serverless writable dir, e.g. `/tmp/agrobridge-uploads`); irrelevant to `db`/`s3` |

## Database migrations

Neon DB is fresh + migration chain applied (`scripts/deploy-migrations.mjs` — idempotent,
baseline-aware) and seeded once with `ALLOW_DEMO_SEED=1` + `NODE_ENV=production`
(CERT-01 hygiene: after seeding, the 5 demo passwords were rotated off the public
`Demo@1234`; current values are held by the product owner).

```bash
cd apps/api
set -a; source .env.local; set +a      # .env.local carries the Neon-injected URLs
export DATABASE_URL="$DATABASE_URL_UNPOOLED"   # direct connection for DDL
node scripts/deploy-migrations.mjs
```

**Migrations are enforced by the deploy gate since 2026-10-18 (ADR-0007).** `/ready` reports the
applied chain (`schema: { known, applied, latest }`) and `deploy-verify.yml` compares `latest` with
the newest directory in `apps/api/prisma/postgres/migrations`. Deploying code whose migrations were
not applied therefore **fails the verification run for that merge**, carrying this section's command
in the failure message. The gap it closes was real, not theoretical: three migrations — the
pending-payment partial unique index and six hot-query indexes — sat unapplied in production for two
days while every gate stayed green, and were applied by hand on 2026-10-18.

## Web deploy

```bash
cd apps/web
vercel deploy --prod        # production env VITE_API_BASE_URL is set on the project
```

`apps/web/.env.production` mirrors the project env var for CI/docker builds (Android APK
CI bakes the API URL from this file — keep both in sync on any endpoint change).

## Android APK

1. Merge the API-URL change to `main` (`apps/web/.env.production`).
2. Dispatch the **Android Debug APK** workflow (`android-debug-apk.yml`, manual):
   `gh workflow run "Android Debug APK"`.
3. Artifact `agrobridge-debug-apk` = Capacitor debug APK with the live API baked in.

## Post-deploy verification (run in order)

```bash
BASE=https://agro-bridge-api-vantiq-systems.vercel.app
curl -s $BASE/health            # {"ok":true,...}
curl -s $BASE/ready             # {"ok":true,"ready":true,"db":true}
curl -s -X POST $BASE/api/v1/auth/login -H 'Content-Type: application/json' \
     -d '{"phone":"<demo-phone>","password":"<demo-password>"}'
# then GET /api/v1/wallet/summary with the token (CERT-06 regression probe)
```

Web: bundle at `https://agrobridge-web.vercel.app/assets/index-*.js` must reference the
API base URL above (no `agrobridge-vfbz.onrender.com` remnants), and a real browser login
must land on `হোম` (verified 2026-10-15 with the demo farmer).
