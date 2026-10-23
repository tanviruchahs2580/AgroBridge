# Runbook — Live Deployment (Vercel + Neon)

## Current production topology (2026-10-15)

| Component | Host | URL | Notes |
|---|---|---|---|
| Web SPA | Vercel project `agrobridge-web` | https://agrobridge-web.vercel.app | bundle bakes `VITE_API_BASE_URL` at build time |
| API | Vercel project `agro-bridge-api` | https://agro-bridge-api-vantiq-systems.vercel.app | Express via @vercel/node, framework `null` |
| Database | Neon (Vercel Marketplace), resource `neon-cyclamen-coin` | injected as `DATABASE_URL` (+`POSTGRES_*` vars) | Neon free tier; pooled + unpooled URLs both provided |

The previous API host (Render `agrobridge-vfbz.onrender.com`) is **retired**: its free
PostgreSQL instance expired (~30-day free-tier limit) and took login down (see
archived `ENTERPRISE_CERTIFICATION_STATUS.md` addendum 2026-10-15 (docs/archive/2026-10-19/)). The Render dashboard service is
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

## Rollback (added 2026-10-24 — AUD-V3: the prod runbook had none)

Vercel keeps every production deployment immutable and instant-rollbackable.
The stack is two independent Vercel projects plus the Neon database; roll
them in this order.

**1. Freeze the trigger.** If the incident is code-driven, stop the source of
new deploys first: do not merge to `main` (branch protection keeps main
deploy-gated), and if a bad migration is in flight, see §Database migrations
below before anything else.

**2. Roll back the web project** (stateless, always safe to roll):

```bash
npx vercel ls agrobridge-web          # list production deployments
npx vercel rollback <deployment-url>  # instant, traffic moves in seconds
```

Or in the Vercel dashboard: Deployments → the last good one → ⋯ → "Promote to
Production". Verify with `curl https://agrobridge-web.vercel.app/version.json`
— `commit` must show the commit you intend, not the broken one.

**3. Roll back the API project** the same way (`npx vercel ls
agro-bridge-api-vantiq-systems` → `rollback`), then verify `/health` reports
the expected `commit` and `/ready` reports `db:true`.

**4. Migrations are forward-only — do NOT roll them back.** The API is
written to run with a schema at-or-ahead of its code (columns/migrations are
additive first). Rolling the API image back across a schema migration that
already applied is safe by that design; manually reverting a migration is
not a supported operation. If a migration itself caused the incident:

- stop: do not run more migrations;
- apply the compensating migration (write the inverse as a NEW forward
  migration — see `docs/disaster-recovery.md` §Forward-only migrations);
- if `deploy-migrations.mjs` marked a migration failed mid-chain,
  `npx prisma migrate resolve --rolled-back <name>` after inspection, fix,
  and re-run — the runbook in `docs/disaster-recovery.md` §Restore & recovery
  covers the Neon restore path if data is damaged.

**5. Re-verify after any rollback** with §Post-deploy verification above, and
file the incident note in the release record (the deploy-verify job's commit
assertions will also catch an off-main deployment).
